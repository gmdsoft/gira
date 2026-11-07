#!/usr/bin/env node
// 이미 이관된 이슈의 작업 로그 소급 (GIRA-71) — 원본은 GET만. fields_raw.worklog.total > 0 인 이슈만.
// 사용: node scripts/jira-worklogs.mjs [--project KEY]
import { parseArgs } from 'node:util';
import { configureDb, query, closeDb } from '../server/src/db.mjs';
import { jiraGet } from './lib/jira-source-get.mjs';
import { syncWorklogs } from './lib/jira-worklogs.mjs';
try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 */ }
const { values: args } = parseArgs({ options: { project: { type: 'string' } } });
configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const site = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const get = jiraGet(site, 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64'));
const users = new Map((await query(`SELECT id, confluence_account_id FROM users WHERE confluence_account_id IS NOT NULL`)).rows.map((r) => [r.confluence_account_id, r.id]));
// 원본 사용자가 아직 없으면 이름 없이 만들고 나중 동기화에서 채운다
async function ensureUsers(ids) {
  for (const a of ids) if (!users.has(a)) {
    const { rows } = await query(`INSERT INTO users (confluence_account_id, display_name) VALUES ($1, $1)
      ON CONFLICT (confluence_account_id) DO UPDATE SET confluence_account_id = EXCLUDED.confluence_account_id RETURNING id`, [a]);
    users.set(a, rows[0].id);
  }
}
const uid = (u) => (u?.accountId ? users.get(u.accountId) ?? null : null);
try {
  const { rows } = await query(`SELECT i.id, i.fields_raw->'worklog' AS worklog FROM jira_issues i JOIN jira_projects p ON p.id = i.project_id
    WHERE COALESCE((i.fields_raw->'worklog'->>'total')::int, 0) > 0 AND ($1::text IS NULL OR p.key = $1)`, [args.project ?? null]);
  const n = await syncWorklogs(rows.map((r) => ({ id: r.id, fields: { worklog: { total: r.worklog.total, worklogs: [] } } })), { get, query, ensureUsers, uid });
  console.log(`완료: 이슈 ${rows.length}개, 작업 로그 ${n}건`);
} finally { await closeDb(); }
