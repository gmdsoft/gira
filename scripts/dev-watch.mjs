#!/usr/bin/env node
// 개발참여 이슈 자동 처리 감시기 — 할 일을 찾아 한 단계씩 진행한다. 절차: server/src/dev-agent/issue-flow.md
//   node scripts/dev-watch.mjs           # 할 일 처리 (보통 scripts/dev-watch.sh가 잠금을 잡고 실행)
//   node scripts/dev-watch.mjs --dry     # 무엇을 할지 목록만
// 단계(판정은 scripts/lib/dev-flow.mjs classify):
//   request-approval · finalize  → 이 스크립트가 직접 (메일, 테스트 서버 중단, develop 머지·푸시)
//   process · revise             → Claude Code 헤드리스(claude -p)에 이슈 하나씩 맡긴다
// 환경변수: DEV_FLOW_MAX_RUNS(한 번에 맡길 이슈 수, 기본 3), DEV_FLOW_BUDGET_USD(이슈당, 기본 10),
//           DEV_FLOW_MODEL(선택), DEV_FLOW_TIMEOUT_MIN(이슈당, 기본 120)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { configureDb, query, closeDb } from '../server/src/db.mjs';
import { L, classify, orderActions, loadFlowIssues, approverEmails, defaultAssignee, enqueueMail, issueUrl } from './lib/dev-flow.mjs';
import { stop as stopTestServer, WORK } from './dev-test-server.mjs';
import { developDir, mergeToDevelop } from './lib/dev-flow-git.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }
configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const { values: opt } = parseArgs({ options: { dry: { type: 'boolean' } } });
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

const gi = (key, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gira-issue.mjs'), key, ...args], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gira-issue ${key} 실패: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
};
const branchOf = (key) => `feature/${key.toLowerCase()}`;

// 승인 요청: 프로젝트 기본 담당자에게 할당하고 메일 (기본 담당자가 없으면 할당 안 된 채로 둔다)
async function requestApproval(it) {
  const owner = await defaultAssignee(query);
  const to = await approverEmails(query);
  if (to.length) {
    await enqueueMail(query, { to, subject: `[Gira] 승인 요청: ${it.key} ${it.summary}`, url: issueUrl(it.key), issueId: it.id,
      note: '개발 명세서 범위를 넘는 개발참여 이슈입니다. 진행해도 되면 이슈에서 needs-approval 레이블을 지워 주세요. 진행하지 않으려면 이슈를 닫거나 보류로 옮겨 주세요.' });
  }
  gi(it.key, ['--assign', owner && !owner.isAgent ? 'default' : 'none', '--label', `+${L.approvalAsked}`, '--comment',
    owner && !owner.isAgent
      ? `관리자 승인 대기 — 프로젝트 기본 담당자(${owner.name})에게 할당하고 ${to.length ? '메일을 보냈습니다' : '메일 주소가 없어 메일은 보내지 못했습니다'}. 승인되면(needs-approval 레이블 제거) 자동으로 처리를 시작합니다.`
      : '관리자 승인 대기 — 프로젝트 기본 담당자가 없어 할당하지 않았습니다. 승인되면(needs-approval 레이블 제거) 자동으로 처리를 시작합니다.']);
  log(`${it.key} 승인 요청 → ${owner && !owner.isAgent ? `${owner.name} ${to.join(', ')}` : '(기본 담당자 없음, 미할당)'}`);
}

async function finalize(it) {
  const stopped = stopTestServer(it.key);
  const branch = branchOf(it.key);
  const r = mergeToDevelop(developDir(ROOT), branch, `develop: ${it.key} 머지 (개발참여 — 보고자 검토 완료)\n\n${it.summary}`);
  const to = await approverEmails(query);
  if (!r.merged) {
    gi(it.key, ['--label', `+${L.conflict}`, '--comment', `develop 머지 중 충돌이 나서 머지하지 않았습니다. 관리자가 확인해야 합니다.\n${r.conflict}`]);
    await enqueueMail(query, { to, subject: `[Gira] 머지 충돌: ${it.key} ${it.summary}`, url: issueUrl(it.key), issueId: it.id,
      note: `보고자 검토가 끝난 ${branch}를 develop에 머지하다 충돌이 났습니다. 수동으로 머지해 주세요.` });
    log(`${it.key} 머지 충돌 — 기본 담당자에게 알림`);
    return;
  }
  gi(it.key, ['--label', `-${L.review},+${L.merged}`, '--comment',
    `검토 완료 — 테스트 서버를 내리고(${stopped.join(', ') || '없음'}) ${branch}를 develop에 머지했습니다 (${r.head}).\n` +
    (r.pushed ? '원격 develop에 푸시했습니다. ' : `원격 푸시 실패: ${r.pushError}\n`) + '운영 서버 반영(빌드·재시작)은 관리자가 합니다.']);
  await enqueueMail(query, { to, subject: `[Gira] develop 머지됨 — 운영 반영 필요: ${it.key} ${it.summary}`, url: issueUrl(it.key), issueId: it.id,
    note: `${branch} → develop (${r.head})${r.pushed ? ', 원격 푸시 완료' : ', 원격 푸시 실패'}. 운영 서버(3001/3002) 빌드·재시작이 필요합니다.` });
  log(`${it.key} develop 머지 ${r.head}${r.pushed ? ' + 푸시' : ' (푸시 실패)'}`);
}

// Claude Code 헤드리스에 이슈 하나를 맡긴다 — 끝나도 agent-running이 남아 있으면 실패로 표시
function runAgent(it, action) {
  // 승인 요청을 보냈던 이슈가 다시 처리 대상이 됐다 = 관리자가 needs-approval을 지워 승인한 것
  const approved = it.labels.includes(L.approvalAsked) ? `,+${L.approved}` : '';
  gi(it.key, ['--label', `+${L.running},-${L.approvalAsked},-${L.failed}${approved}`]);
  const prompt = `[개발참여 이슈 자동 처리 — 감시기 실행, 사람이 지켜보지 않음]
server/src/dev-agent/issue-flow.md 를 읽고 그 절차의 '${action === 'revise' ? '4. 추가 요청 처리(revise)' : '3. 분석·처리(process)'}' 단계로 ${it.key} 하나만 처리해줘.
감시기가 이미 agent-running 레이블을 달았다. 끝날 때 절차대로 레이블·상태·담당·댓글·메일을 정리한다(agent-running 제거 포함).
질문할 사람이 없으니 판단이 서지 않으면 이슈 댓글로 묻는다(needs-info). 마지막에 한 일을 짧게 출력한다.`;
  const args = ['-p', prompt, '--permission-mode', 'auto', '--add-dir', WORK, '--max-budget-usd', process.env.DEV_FLOW_BUDGET_USD || '10'];
  if (process.env.DEV_FLOW_MODEL) args.push('--model', process.env.DEV_FLOW_MODEL);
  log(`${it.key} ${action} — claude 실행`);
  const r = spawnSync('claude', args, { cwd: ROOT, stdio: 'inherit', timeout: (Number(process.env.DEV_FLOW_TIMEOUT_MIN) || 120) * 60_000 });
  return r.status;
}

async function stillRunning(key) {
  const { rows } = await query(`SELECT $2 = ANY(labels) AS running FROM jira_issues WHERE issue_key = $1`, [key, L.running]);
  return !!rows[0]?.running;
}

try {
  const maxRuns = Number(process.env.DEV_FLOW_MAX_RUNS) || 3;
  let runs = 0;
  const done = new Set();
  for (let round = 0; round < 20; round++) {
    const todo = orderActions((await loadFlowIssues(query)).map((it) => ({ ...it, action: classify(it) })).filter((x) => x.action && !done.has(x.key + x.action)));
    if (opt.dry) { for (const t of todo) console.log(`${t.key} ${t.action} [${t.statusName}] {${t.labels.join(', ')}} ${t.summary}`); if (!todo.length) console.log('할 일 없음'); break; }
    const next = todo.find((t) => !['process', 'revise'].includes(t.action) || runs < maxRuns);
    if (!next) break;
    done.add(next.key + next.action);
    try {
      if (next.action === 'request-approval') await requestApproval(next);
      else if (next.action === 'finalize') await finalize(next);
      else {
        runs++;
        const code = runAgent(next, next.action);
        if (await stillRunning(next.key)) {
          gi(next.key, ['--label', `-${L.running},+${L.failed}`, '--comment', `자동 처리가 정상적으로 끝나지 않았습니다 (종료 코드 ${code ?? '시간 초과'}). 관리자가 확인한 뒤 agent-failed 레이블을 지우면 다시 시도합니다.`]);
          log(`${next.key} 처리 실패로 표시`);
        }
      }
    } catch (e) {
      log(`${next.key} ${next.action} 실패: ${e.message}`);
      try { gi(next.key, ['--label', `+${L.failed}`, '--comment', `자동 처리 단계(${next.action}) 실패: ${e.message.slice(0, 500)}`]); } catch { /* 기록 실패는 로그로만 */ }
    }
  }
} finally {
  await closeDb();
}
