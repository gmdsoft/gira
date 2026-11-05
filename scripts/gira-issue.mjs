#!/usr/bin/env node
// GIRA 개발 이슈 읽기 (운영자 개발 세션용, 읽기 전용): 챗봇이 등록한 이슈를 처리하기 전에 내용을 확인한다.
//   node scripts/gira-issue.mjs                # 열린 GIRA 이슈 목록 (완료 제외)
//   node scripts/gira-issue.mjs GIRA-4         # 이슈 상세: 설명, 레이블, 상위/하위, 댓글, 첨부(로컬 경로)
//   node scripts/gira-issue.mjs GIRA-4 --status 검토 --comment "처리 결과…" [--label +agent-done,-agent-running]
//        # 처리 기록 (Gira DB만 갱신 — 댓글 작성자는 GIRA 에이전트 계정)
// 처리는 scripts/dev-dispatcher.mjs --run --issue <KEY> 로 맡기거나 세션에서 직접 한다.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { configureDb, query, closeDb, DATA_DIR } from '../server/src/db.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }
configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });

const adfText = (doc) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text') out.push(n.text);
    if (n.type === 'hardBreak') out.push('\n');
    for (const c of n.content ?? []) walk(c);
    if (['paragraph', 'heading', 'listItem'].includes(n.type)) out.push('\n');
  };
  walk(doc);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
};
const d = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '');

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { status: { type: 'string' }, comment: { type: 'string' }, label: { type: 'string' } },
});
const key = positionals[0]?.toUpperCase();
const textToAdf = (text) => ({
  type: 'doc', version: 1,
  content: String(text).split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
});

// 처리 기록: 상태 변경·댓글·레이블 (변경 이력도 남긴다)
async function record(issueKey) {
  const { rows } = await query(
    `SELECT i.id, i.status_id, s.name AS status FROM jira_issues i LEFT JOIN jira_statuses s ON s.id = i.status_id
      WHERE i.issue_key = $1`, [issueKey]);
  const it = rows[0];
  if (!it) throw new Error(`${issueKey} 이슈가 없습니다`);
  const { rows: ag } = await query(`SELECT id FROM users WHERE confluence_account_id = 'gira-agent'`);
  const actor = ag[0]?.id ?? null;
  if (opt.status) {
    const { rows: st } = await query(`SELECT id, name FROM jira_statuses WHERE name = $1 ORDER BY id LIMIT 1`, [opt.status]);
    if (!st.length) throw new Error(`상태 '${opt.status}'가 없습니다`);
    if (String(st[0].id) !== String(it.status_id)) {
      await query(`UPDATE jira_issues SET status_id = $2, updated_at = now() WHERE id = $1`, [it.id, st[0].id]);
      await query(`INSERT INTO jira_changelog (issue_id, author_id, items) VALUES ($1, $2, $3)`,
        [it.id, actor, JSON.stringify([{ field: 'status', fromString: it.status, toString: st[0].name }])]);
      console.log(`상태: ${it.status} → ${st[0].name}`);
    }
  }
  if (opt.label) {
    const parts = opt.label.split(',').map((x) => x.trim()).filter(Boolean);
    const add = parts.filter((x) => !x.startsWith('-')).map((x) => x.replace(/^\+/, ''));
    const del = parts.filter((x) => x.startsWith('-')).map((x) => x.slice(1));
    await query(
      `UPDATE jira_issues SET labels = (
         SELECT coalesce(array_agg(DISTINCT l), '{}') FROM unnest(array_cat(labels, $2::text[])) l WHERE NOT (l = ANY($3::text[]))
       ), updated_at = now() WHERE id = $1`, [it.id, add, del]);
    console.log(`레이블: +[${add}] -[${del}]`);
  }
  if (opt.comment) {
    await query(
      `INSERT INTO jira_comments (id, issue_id, body_adf, author_id, created_at, updated_at)
       VALUES (nextval('jira_comment_id_seq'), $1, $2, $3, now(), now())`,
      [it.id, JSON.stringify(textToAdf(opt.comment)), actor]);
    await query(`UPDATE jira_issues SET updated_at = now() WHERE id = $1`, [it.id]);
    console.log('댓글 추가');
  }
}
try {
  if (key && (opt.status || opt.comment || opt.label)) {
    await record(key);
  } else if (!key) {
    const { rows } = await query(
      `SELECT i.issue_key, i.summary, s.name AS status, t.name AS type, i.labels, i.updated_at, i.priority
         FROM jira_issues i JOIN jira_projects p ON p.id = i.project_id AND p.key = 'GIRA'
         LEFT JOIN jira_statuses s ON s.id = i.status_id LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
        WHERE s.category IS DISTINCT FROM 'done'
        ORDER BY CASE i.priority WHEN 'Highest' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 WHEN 'Medium' THEN 2
                   WHEN 'Low' THEN 3 WHEN 'Lowest' THEN 4 ELSE 2 END, split_part(i.issue_key, '-', 2)::int`);
    if (!rows.length) console.log('열린 GIRA 이슈가 없습니다.');
    for (const r of rows) {
      console.log(`${r.issue_key.padEnd(8)} ${(r.priority ?? '-').padEnd(7)} [${r.status}] ${r.type ?? ''} — ${r.summary}  {${r.labels.join(', ')}}`);
    }
  } else {
    const { rows } = await query(
      `SELECT i.id, i.issue_key, i.summary, i.description_adf, i.labels, i.created_at, i.updated_at, i.priority,
              s.name AS status, t.name AS type, p.issue_key AS parent_key, p.summary AS parent_summary,
              ra.display_name AS reporter, aa.display_name AS assignee
         FROM jira_issues i
         LEFT JOIN jira_statuses s ON s.id = i.status_id LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
         LEFT JOIN jira_issues p ON p.id = i.parent_id
         LEFT JOIN users ra ON ra.id = i.reporter_id LEFT JOIN users aa ON aa.id = i.assignee_id
        WHERE i.issue_key = $1`, [key]);
    const it = rows[0];
    if (!it) { console.log(`${key} 이슈가 없습니다.`); process.exitCode = 1; } else {
      console.log(`${it.issue_key}  ${it.summary}`);
      console.log(`유형 ${it.type ?? '-'} · 상태 ${it.status ?? '-'} · 우선순위 ${it.priority ?? '-'} · 보고자 ${it.reporter ?? '-'} · 담당 ${it.assignee ?? '-'}`);
      console.log(`레이블 ${it.labels.join(', ') || '-'} · 생성 ${d(it.created_at)} · 수정 ${d(it.updated_at)}`);
      if (it.parent_key) console.log(`상위 ${it.parent_key} ${it.parent_summary}`);
      const { rows: subs } = await query(
        `SELECT c.issue_key, c.summary, s.name AS status FROM jira_issues c LEFT JOIN jira_statuses s ON s.id = c.status_id
          WHERE c.parent_id = $1 ORDER BY c.id`, [it.id]);
      for (const c of subs) console.log(`하위 ${c.issue_key} [${c.status}] ${c.summary}`);
      console.log('\n--- 설명 ---\n' + (adfText(it.description_adf) || '(없음)'));
      const { rows: atts } = await query(
        `SELECT filename, media_type, file_size, local_key FROM jira_attachments WHERE issue_id = $1 ORDER BY id`, [it.id]);
      if (atts.length) {
        console.log('\n--- 첨부 ---');
        for (const a of atts) {
          console.log(`${a.filename} (${a.media_type ?? '?'}, ${a.file_size ?? '?'}B)${a.local_key ? ' → ' + path.join(DATA_DIR, a.local_key) : ' (원본 첨부)'}`);
        }
      }
      const { rows: cs } = await query(
        `SELECT c.body_adf, c.created_at, u.display_name FROM jira_comments c LEFT JOIN users u ON u.id = c.author_id
          WHERE c.issue_id = $1 ORDER BY c.created_at`, [it.id]);
      if (cs.length) {
        console.log('\n--- 댓글 ---');
        for (const c of cs) console.log(`[${d(c.created_at)}] ${c.display_name ?? '?'}:\n${adfText(c.body_adf)}\n`);
      }
    }
  }
} finally {
  await closeDb();
}
