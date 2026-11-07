// 개발참여 자동 처리 현황 (관리자·GIRA 프로젝트 관리자·기본 담당자 전용 화면의 데이터)
// 이슈 단계별 목록 · 테스트 서버 · 감시기 상태 · 최근 실행 기록(감시기 요약 줄만 — 에이전트 출력 원문은 내보내지 않는다)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { L, classify, loadFlowIssues } from '../../scripts/lib/dev-flow.mjs';
import { list as listTestServers } from '../../scripts/dev-test-server.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG_DIR = path.join(ROOT, 'logs', 'dev-flow');
const ACTION_LABELS = { process: '분석·처리', revise: '추가 요청 반영', finalize: '머지', 'request-approval': '승인 요청 메일', approve: '승인 확인' };

// 감시기 요약 줄: "2026-11-07T12:27:28 GIRA-76 process — claude 실행" (ISO 시각으로 시작하는 줄만)
export function parseWatchLog(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d) (?:(GIRA-\d+) )?(.*)$/.exec(line);
    if (m) out.push({ at: m[1] + 'Z', key: m[2] ?? null, text: m[3].slice(0, 300) });
  }
  return out;
}

function recentLog(limit = 40) {
  let files = [];
  try { files = fs.readdirSync(LOG_DIR).filter((f) => /^\d{4}-\d\d-\d\d\.log$/.test(f)).sort().slice(-3); } catch { return []; }
  return files.flatMap((f) => { try { return parseWatchLog(fs.readFileSync(path.join(LOG_DIR, f), 'utf8')); } catch { return []; } })
    .slice(-limit).reverse();
}

function watcherRunning() {
  try {
    return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).some((pid) => {
      try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('scripts/dev-watch.mjs'); } catch { return false; }
    });
  } catch { return null; }
}

function cronInstalled() {
  try {
    const tab = execFileSync('crontab', ['-l'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    return tab.split('\n').some((l) => !l.trim().startsWith('#') && l.includes('dev-watch.sh'));
  } catch { return false; }
}

// issues: loadFlowIssues 결과 (테스트에서 직접 넣는다)
export function groupIssues(issues, servers = []) {
  const byKey = new Map(servers.map((s) => [s.key, s]));
  const pick = (it) => ({
    key: it.key, summary: it.summary, priority: it.priority, status: it.statusName, assignee: it.assignee ?? null, reporter: it.reporter ?? null,
    updatedAt: it.updatedAt ?? null, labels: it.labels, testServer: byKey.get(it.key)?.apps ?? null,
  });
  const has = (it, l) => it.labels.includes(l);
  const g = { running: [], queued: [], review: [], waitingInfo: [], waitingApproval: [], attention: [], merged: [] };
  for (const it of issues) {
    const action = classify(it);
    // 이미 끝난 이슈: 머지된 것만 '최근 머지됨'에, 검토 중에 완료된 것(머지 대기)은 아래에서 다음 처리 대상으로
    if (it.statusCategory === 'done' && !has(it, L.review)) { if (has(it, L.merged)) g.merged.push(pick(it)); continue; }
    if (has(it, L.running)) g.running.push(pick(it));
    else if (has(it, L.failed) || has(it, L.conflict)) g.attention.push({ ...pick(it), reason: has(it, L.conflict) ? '머지 충돌' : '처리 실패' });
    else if (action) g.queued.push({ ...pick(it), action, actionLabel: ACTION_LABELS[action] ?? action });
    else if (has(it, L.review) && it.statusCategory !== 'done') g.review.push(pick(it));
    else if (has(it, L.info)) g.waitingInfo.push(pick(it));
    else if (has(it, L.approval)) g.waitingApproval.push(pick(it));
    else if (has(it, L.merged)) g.merged.push(pick(it));
  }
  const recent = (a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
  for (const k of Object.keys(g)) g[k].sort(recent);
  g.merged = g.merged.slice(0, 10);
  return g;
}

// 볼 수 있는 사람: 사이트 관리자 · GIRA 프로젝트 관리자 · GIRA 프로젝트 기본 담당자
// (실행 기록에 에이전트가 읽은 이슈 내용·명령이 남으므로 보고자에게는 이슈 화면만 보여 준다)
export async function canSeeDevFlow(query, projectRole, access) {
  if (!access?.userId) return false;
  if (access.isAdmin) return true;
  const { rows } = await query(`SELECT id, default_assignee_id FROM jira_projects WHERE key = 'GIRA'`);
  const gira = rows[0];
  if (!gira) return false;
  if (String(gira.default_assignee_id ?? '') === String(access.userId)) return true;
  return (await projectRole(access, gira.id)) === 'admin';
}

export async function collectDevFlowStatus(query, env = process.env) {
  const servers = listTestServers();
  const issues = await loadFlowIssues(query);
  return {
    now: new Date().toISOString(),
    watcher: { enabled: env.DEV_FLOW === '1', running: watcherRunning(), cron: cronInstalled() },
    groups: groupIssues(issues, servers),
    testServers: servers,
    log: recentLog(),
  };
}
