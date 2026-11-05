#!/usr/bin/env node
// 개발참여 디스패처: GIRA 개발 프로젝트의 이슈를 하위 코딩 에이전트(헤드리스)에게 맡기고 결과를 기록한다.
//
// 대상: 상태 '해야 할 일'류(new) + 레이블 agent:codex | agent:opencode + needs-approval 없음
//       + 아직 맡기지 않은 것(agent-running/agent-done/agent-failed 없음)
// 처리: 이슈 전용 git worktree(../gira-work/<KEY>, 브랜치 feature/<key>)에서 실행 →
//       결과 보고를 댓글로 게시 → 상태 '검토'(성공) / 원래 상태 유지 + agent-failed(실패)
//       머지·서버 반영은 사람이 검토 후 한다 (CLAUDE.md 브랜치 규칙).
// 승인: needs-approval 레이블을 관리자가 이슈 상세에서 지우면 다음 실행에서 대상이 된다.
//
// 사용법:
//   node scripts/dev-dispatcher.mjs                 # 미리보기(dry-run): 무엇을 맡길지 목록만
//   node scripts/dev-dispatcher.mjs --run           # 대상 1건 처리
//   node scripts/dev-dispatcher.mjs --run --all     # 대상 전부 순서대로 처리
//   node scripts/dev-dispatcher.mjs --run --watch 300   # 300초마다 반복
// 환경변수: GIRA_DATABASE_URL, (선택) CODEX_MODEL, OPENCODE_MODEL, AGENT_TIMEOUT_MIN(기본 40)
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configureDb, query, closeDb } from '../server/src/db.mjs';

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

function buildPrompt(it) {
  const spec = it.labels.includes('spec-update') ? '예 — docs/alpha-spec.md 해당 부분도 고칠 것' : '아니오';
  return `${WORKER_GUIDE}

---
## 이슈
- 키: ${it.issue_key}  (커밋 메시지 첫 줄에 이 키를 넣을 것)
- 유형: ${it.type_name ?? '작업'}
- 제목: ${it.summary}
${it.parent_key ? `- 상위: ${it.parent_key} ${it.parent_summary}\n` : ''}- 명세서 갱신 필요: ${spec}

### 내용
${adfText(it.description_adf) || it.summary}
`;
}

function runAgent(executor, dir, prompt) {
  return new Promise((resolve) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'gira-agent-'));
    const lastFile = path.join(tmp, 'last.txt');
    let cmd; let argv;
    if (executor === 'codex') {
      cmd = 'codex';
      argv = ['exec', '-C', dir, '--sandbox', 'workspace-write', '-o', lastFile, '-'];
      if (process.env.CODEX_MODEL) argv.splice(1, 0, '-m', process.env.CODEX_MODEL);
    } else {
      cmd = 'opencode';
      argv = ['run', '--auto', '--title', 'GIRA 처리'];
      if (process.env.OPENCODE_MODEL) argv.push('-m', process.env.OPENCODE_MODEL);
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

async function processOne(it) {
  const executor = it.labels.includes('agent:codex') ? 'codex' : 'opencode';
  const original = it.status_id;
  const inProgress = await statusId('진행 중');
  const review = await statusId('검토');
  await setLabels(it.id, ['agent-running']);
  if (inProgress) await query(`UPDATE jira_issues SET status_id = $2 WHERE id = $1`, [it.id, inProgress]);
  const { dir, branch } = prepareWorktree(it.issue_key);
  await comment(it.id, it.reporter_id, `처리 시작 — ${executor === 'codex' ? 'Codex' : 'OpenCode'} 헤드리스, 브랜치 ${branch}`);
  console.log(`▶ ${it.issue_key} (${executor}) ${it.summary}`);

  const r = await runAgent(executor, dir, buildPrompt(it));
  let commits = 0;
  try { commits = Number(git('rev-list', '--count', `master..${branch}`)); } catch { /* 무시 */ }
  const ok = r.code === 0 && commits > 0;
  await comment(it.id, it.reporter_id, [
    `${ok ? '처리 완료 — 검토 대기' : '처리 실패 — 확인 필요'} (${executor}, 종료 코드 ${r.code}, 커밋 ${commits}개, 브랜치 ${branch})`,
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
