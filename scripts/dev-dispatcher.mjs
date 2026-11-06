#!/usr/bin/env node
// 개발참여 디스패처: GIRA 개발 프로젝트의 이슈를 하위 코딩 에이전트(헤드리스)에게 맡기고 결과를 기록한다.
// 자동 실행하지 않는다 — 운영자가 개발 세션에서 이슈를 읽고(scripts/gira-issue.mjs) 이 스크립트로 맡긴다.
//
// 대상: 상태 '해야 할 일'류(new) + 레이블 agent:codex | agent:opencode + needs-approval 없음
//       + 아직 맡기지 않은 것(agent-running/agent-done/agent-failed 없음)
// 처리: 이슈 전용 git worktree(../gira-work/<KEY>, 새 브랜치 feature/<key>)에서 실행 →
//       성공 시 브랜치 푸시 + GitHub PR 생성(GITHUB_TOKEN, 없으면 비교 링크) → 결과·PR 링크를 댓글로,
//       상태 '검토' / 실패 시 원래 상태 + agent-failed. 머지·서버 반영은 사람이 PR 검토 후 한다.
// 승인: needs-approval 레이블을 관리자가 이슈 상세에서 지우면 다음 실행에서 대상이 된다.
//
// 사용법:
//   node scripts/dev-dispatcher.mjs                 # 미리보기(dry-run): 무엇을 맡길지 목록만
//   node scripts/dev-dispatcher.mjs --run           # 대상 1건 처리
//   node scripts/dev-dispatcher.mjs --run --all     # 대상 전부 순서대로 처리
//   node scripts/dev-dispatcher.mjs --run --watch 300   # 300초마다 반복
//   node scripts/dev-dispatcher.mjs --run --issue GIRA-4 [--executor codex|opencode] [--note "추가 지시"]
//        # 지정한 이슈 하나를 처리 (레이블 조건 무시, needs-approval만 차단). --note는 프롬프트에 덧붙인다
// 환경변수: GIRA_DATABASE_URL, (선택) GITHUB_TOKEN(PR 생성), PR_BASE_BRANCH(기본 master),
//          CODEX_MODEL, OPENCODE_MODEL, AGENT_TIMEOUT_MIN(기본 40)
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configureDb, query, closeDb, DATA_DIR } from '../server/src/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }
configureDb({
  url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL,
  schemas: ['schema-core.sql', 'schema-jira.sql'],
});

const { values: args } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    watch: { type: 'string' },
    issue: { type: 'string' },
    executor: { type: 'string' },
    note: { type: 'string' },
  },
});

const PROJECT = 'GIRA';
const WORK_DIR = path.join(ROOT, '..', 'gira-work');
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MIN ?? 40) * 60 * 1000;
const WORKER_GUIDE = readFileSync(path.join(ROOT, 'server', 'src', 'dev-agent', 'worker.md'), 'utf8');

const adfText = (doc) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text') out.push(n.text);
    for (const c of n.content ?? []) walk(c);
    if (n.type === 'paragraph') out.push('\n');
  };
  walk(doc);
  return out.join('').trim();
};
const textToAdf = (text) => ({
  type: 'doc', version: 1,
  content: String(text).split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
});

async function statusId(name) {
  const { rows } = await query(`SELECT id FROM jira_statuses WHERE name = $1 ORDER BY id LIMIT 1`, [name]);
  return rows[0]?.id ?? null;
}

const ISSUE_COLS = `i.id, i.issue_key, i.summary, i.description_adf, i.labels, i.status_id, i.reporter_id,
            t.name AS type_name, p.issue_key AS parent_key, p.summary AS parent_summary`;

async function oneIssue(key) {
  const { rows } = await query(
    `SELECT ${ISSUE_COLS}
       FROM jira_issues i
       JOIN jira_projects pr ON pr.id = i.project_id AND pr.key = $1
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN jira_issues p ON p.id = i.parent_id
      WHERE i.issue_key = $2`, [PROJECT, key.toUpperCase()]);
  return rows[0] ?? null;
}

// 프롬프트 보강: 이슈 댓글(사람이 단 보충 설명)과 첨부 파일 경로
async function issueExtras(issueId) {
  const { rows: comments } = await query(
    `SELECT c.body_adf, c.created_at, u.display_name FROM jira_comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.issue_id = $1 ORDER BY c.created_at`, [issueId]);
  const { rows: atts } = await query(
    `SELECT filename, media_type, local_key FROM jira_attachments WHERE issue_id = $1 AND local_key IS NOT NULL ORDER BY id`,
    [issueId]);
  return {
    comments: comments.map((c) => `- ${c.display_name ?? '?'}: ${adfText(c.body_adf).replace(/\n+/g, ' / ')}`),
    files: atts.map((a) => ({ name: a.filename, type: a.media_type, path: path.join(DATA_DIR, a.local_key) })),
  };
}

async function candidates() {
  const { rows } = await query(
    `SELECT i.id, i.issue_key, i.summary, i.description_adf, i.labels, i.status_id, i.reporter_id,
            t.name AS type_name, p.issue_key AS parent_key, p.summary AS parent_summary
       FROM jira_issues i
       JOIN jira_projects pr ON pr.id = i.project_id AND pr.key = $1
       JOIN jira_statuses s ON s.id = i.status_id AND s.category = 'new'
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN jira_issues p ON p.id = i.parent_id
      WHERE (i.labels && ARRAY['agent:codex','agent:opencode'])
        AND NOT (i.labels && ARRAY['needs-approval','agent-running','agent-done','agent-failed'])
      ORDER BY split_part(i.issue_key, '-', 2)::int`, [PROJECT]);
  return rows;
}

// 처리 기록은 GIRA 에이전트 계정 이름으로 남긴다 (없으면 이슈 보고자)
let agentId;
async function agentUserId(fallback) {
  if (agentId === undefined) {
    const { rows } = await query(`SELECT id FROM users WHERE confluence_account_id = 'gira-agent'`);
    agentId = rows[0]?.id ?? null;
  }
  return agentId ?? fallback;
}

async function comment(issueId, authorId, text) {
  authorId = await agentUserId(authorId);
  await query(
    `INSERT INTO jira_comments (id, issue_id, body_adf, author_id, created_at, updated_at)
     VALUES (nextval('jira_comment_id_seq'), $1, $2, $3, now(), now())`,
    [issueId, JSON.stringify(textToAdf(text)), authorId]);
  await query(`UPDATE jira_issues SET updated_at = now() WHERE id = $1`, [issueId]);
}

const setLabels = (id, add = [], remove = []) => query(
  `UPDATE jira_issues SET labels = (
     SELECT coalesce(array_agg(DISTINCT l), '{}') FROM unnest(array_cat(labels, $2::text[])) l WHERE NOT (l = ANY($3::text[]))
   ), updated_at = now() WHERE id = $1`, [id, add, remove]);

function git(...a) { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); }

function prepareWorktree(key) {
  const dir = path.join(WORK_DIR, key);
  const branch = `feature/${key.toLowerCase()}`;
  if (!existsSync(dir)) {
    const exists = git('branch', '--list', branch);
    if (exists) git('worktree', 'add', dir, branch);
    else git('worktree', 'add', '-b', branch, dir, 'master');
  }
  return { dir, branch };
}

function buildPrompt(it, extras, note) {
  const spec = it.labels.includes('spec-update') ? '예 — docs/alpha-spec.md 해당 부분도 고칠 것 (Gonfluence 원본 게시는 머지 후 사람이)' : '아니오';
  const files = extras.files.length
    ? `\n### 첨부 파일 (읽기 전용 경로 — 스크린샷·로그는 열어서 확인할 것)\n${extras.files.map((f) => `- ${f.name} (${f.type ?? '?'}): ${f.path}`).join('\n')}\n`
    : '';
  const comments = extras.comments.length ? `\n### 이슈 댓글\n${extras.comments.join('\n')}\n` : '';
  const extra = note ? `\n### 운영자 추가 지시 (이슈 내용보다 우선)\n${note}\n` : '';
  return `${WORKER_GUIDE}

---
## 이슈
- 키: ${it.issue_key}  (커밋 메시지 첫 줄에 이 키를 넣을 것)
- 유형: ${it.type_name ?? '작업'}
- 제목: ${it.summary}
${it.parent_key ? `- 상위: ${it.parent_key} ${it.parent_summary}\n` : ''}- 명세서 갱신 필요: ${spec}

### 내용
${adfText(it.description_adf) || it.summary}
${files}${comments}${extra}`;
}

function runAgent(executor, dir, prompt, images = []) {
  return new Promise((resolve) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'gira-agent-'));
    const lastFile = path.join(tmp, 'last.txt');
    let cmd; let argv;
    if (executor === 'codex') {
      cmd = 'codex';
      argv = ['exec', '-C', dir, '--sandbox', 'workspace-write', '-o', lastFile];
      for (const img of images) argv.push(`--image=${img}`); // 스크린샷은 이미지 입력으로도 (= 형식: 뒤 인자 흡수 방지)
      argv.push('-');
      if (process.env.CODEX_MODEL) argv.splice(1, 0, '-m', process.env.CODEX_MODEL);
    } else {
      cmd = 'opencode';
      argv = ['run', '--auto', '--title', 'GIRA 처리'];
      if (process.env.OPENCODE_MODEL) argv.push('-m', process.env.OPENCODE_MODEL);
      for (const img of images) argv.push('-f', img);
      argv.push(prompt); // opencode는 메시지를 인자로 받는다
    }
    const child = spawn(cmd, argv, { cwd: dir, env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      let last = '';
      try { last = readFileSync(lastFile, 'utf8').trim(); } catch { /* opencode는 표준출력 */ }
      resolve({ code, last: last || out.trim().slice(-6000) });
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, last: String(e.message) }); });
    // codex는 '-' 로 표준입력에서 프롬프트를 받는다 (opencode는 위에서 인자로 전달)
    child.stdin.end(executor === 'codex' ? prompt : '');
  });
}

// GitHub: origin(git@github.com:owner/repo.git 또는 https)에 브랜치를 푸시하고 PR을 연다.
// PR 생성은 GITHUB_TOKEN(.env, repo 권한)이 있으면 REST API로, 없으면 비교 링크만 남긴다.
async function openPullRequest(it, branch, report) {
  try {
    git('push', '-u', 'origin', branch);
  } catch (e) {
    return { note: `브랜치 푸시 실패: ${String(e.message).split('\n')[0]}` };
  }
  const m = git('remote', 'get-url', 'origin').match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
  if (!m) return { note: `브랜치 푸시 완료: ${branch} (GitHub 원격이 아니라 PR은 만들지 않음)` };
  const [, owner, repo] = m;
  const base = process.env.PR_BASE_BRANCH ?? 'master';
  const compare = `https://github.com/${owner}/${repo}/compare/${base}...${branch}?expand=1`;
  if (!process.env.GITHUB_TOKEN) return { note: `브랜치 푸시 완료 — PR 만들기: ${compare}` };
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'gira-dev-dispatcher',
    },
    body: JSON.stringify({
      title: `${it.issue_key}: ${it.summary}`,
      head: branch,
      base,
      body: `GIRA 이슈 ${it.issue_key} 처리 결과 (GIRA 에이전트 자동 생성)\n\n${report.slice(0, 6000)}`,
      draft: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { url: body.html_url };
  // 이미 열린 PR이 있으면 그 링크를 찾아 쓴다
  if (res.status === 422) {
    const q = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=open`, {
      headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'user-agent': 'gira-dev-dispatcher' },
    }).then((x) => x.json()).catch(() => []);
    if (q[0]?.html_url) return { url: q[0].html_url };
  }
  return { note: `PR 생성 실패(${res.status}: ${body.message ?? ''}) — 수동으로: ${compare}` };
}

async function processOne(it, { executor: forced, note } = {}) {
  const executor = forced ?? (it.labels.includes('agent:codex') ? 'codex' : 'opencode');
  const original = it.status_id;
  const inProgress = await statusId('진행 중');
  const review = await statusId('검토');
  await setLabels(it.id, ['agent-running']);
  if (inProgress) await query(`UPDATE jira_issues SET status_id = $2 WHERE id = $1`, [it.id, inProgress]);
  const { dir, branch } = prepareWorktree(it.issue_key);
  await comment(it.id, it.reporter_id, `처리 시작 — ${executor === 'codex' ? 'Codex' : 'OpenCode'} 헤드리스, 브랜치 ${branch}`);
  console.log(`▶ ${it.issue_key} (${executor}) ${it.summary}`);

  const extras = await issueExtras(it.id);
  const images = extras.files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type ?? '') && existsSync(f.path)).map((f) => f.path);
  const r = await runAgent(executor, dir, buildPrompt(it, extras, note), images);
  // 에이전트 실행(수십 분) 동안 이슈 번호가 바뀔 수 있으므로(로컬 번호 대역 이동 등) 키로 다시 조회한다
  const { rows: cur } = await query(`SELECT id FROM jira_issues WHERE issue_key = $1`, [it.issue_key]);
  if (!cur.length) { console.log(`  ✗ ${it.issue_key} 이슈가 사라짐 — 결과 기록 생략`); return; }
  it.id = cur[0].id;
  // 에이전트가 남긴 미커밋 변경은 디스패처가 커밋한다 — 샌드박스(codex workspace-write)는 worktree의
  // git 메타데이터(본 저장소 .git/worktrees/…)에 쓸 수 없어 에이전트가 직접 커밋하지 못할 수 있다
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim();
    if (dirty) {
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-F', '-'], {
        cwd: dir,
        input: `${it.issue_key}: ${it.summary}\n\n${r.last.slice(0, 3000)}\n\n(GIRA 에이전트 — ${executor} 처리 결과를 디스패처가 커밋)`,
      });
    }
  } catch (e) { console.log(`  커밋 실패: ${String(e.message).split('\n')[0]}`); }
  let commits = 0;
  try { commits = Number(git('rev-list', '--count', `master..${branch}`)); } catch { /* 무시 */ }
  const ok = r.code === 0 && commits > 0;
  // 성공 시: 브랜치를 GitHub에 푸시하고 PR을 만든다 (머지는 사람이 검토 후)
  let pr = null;
  if (ok) pr = await openPullRequest(it, branch, r.last);
  await comment(it.id, it.reporter_id, [
    `${ok ? '처리 완료 — PR 검토 대기' : '처리 실패 — 확인 필요'} (${executor}, 종료 코드 ${r.code}, 커밋 ${commits}개, 브랜치 ${branch})`,
    pr?.url ? `PR: ${pr.url}` : (pr?.note ?? ''),
    '',
    r.last.slice(0, 6000),
  ].join('\n'));
  if (ok) {
    await setLabels(it.id, ['agent-done'], ['agent-running']);
    if (review) await query(`UPDATE jira_issues SET status_id = $2 WHERE id = $1`, [it.id, review]);
  } else {
    await setLabels(it.id, ['agent-failed'], ['agent-running']);
    await query(`UPDATE jira_issues SET status_id = $2 WHERE id = $1`, [it.id, original]);
  }
  console.log(`  ${ok ? '✓ 검토로 이동' : '✗ 실패'} (커밋 ${commits})`);
}

async function tick() {
  if (args.issue) {
    const it = await oneIssue(args.issue);
    if (!it) { console.log(`${args.issue} 이슈가 없습니다.`); return; }
    if (it.labels.includes('needs-approval')) { console.log(`${it.issue_key}는 승인 대기(needs-approval)라 처리하지 않습니다.`); return; }
    if (it.labels.includes('agent-running')) { console.log(`${it.issue_key}는 이미 처리 중입니다.`); return; }
    const executor = args.executor ?? (it.labels.includes('agent:opencode') ? 'opencode' : 'codex');
    if (!['codex', 'opencode'].includes(executor)) { console.log('--executor는 codex 또는 opencode'); return; }
    if (!args.run) { console.log(`미리보기: ${it.issue_key} → ${executor} (${it.summary}) — --run 으로 실행`); return; }
    await setLabels(it.id, [], ['agent-done', 'agent-failed']);
    await processOne(it, { executor, note: args.note });
    return;
  }
  const list = await candidates();
  if (!args.run) {
    console.log(list.length ? '맡길 이슈 (미리보기 — --run 으로 실행):' : '맡길 이슈가 없습니다.');
    for (const it of list) {
      console.log(`  ${it.issue_key}  ${it.labels.includes('agent:codex') ? 'codex   ' : 'opencode'}  ${it.summary}`);
    }
    return;
  }
  for (const it of (args.all ? list : list.slice(0, 1))) await processOne(it);
  if (!list.length) console.log('맡길 이슈가 없습니다.');
}

try {
  if (args.watch) {
    const sec = Math.max(60, Number(args.watch) || 300);
    for (;;) { await tick(); await new Promise((r) => setTimeout(r, sec * 1000)); }
  } else {
    await tick();
  }
} finally {
  await closeDb();
}
