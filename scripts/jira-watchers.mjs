#!/usr/bin/env node
// 이미 이관된 이슈의 관찰자 소급 (GIRA-69) — 원본은 GET만. fields_raw.watches.watchCount > 0 인 이슈만.
// 사용: node scripts/jira-watchers.mjs [--project KEY]
import { parseArgs } from 'node:util';
import { configureDb, query, closeDb } from '../server/src/db.mjs';
import { jiraGet } from './lib/jira-source-get.mjs';
import { syncWatchers } from './lib/jira-watchers.mjs';
try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 */ }
const { values: args } = parseArgs({ options: { project: { type: 'string' } } });
configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const site = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const get = jiraGet(site, 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64'));
const users = new Map((await query(`SELECT id, confluence_account_id FROM users WHERE confluence_account_id IS NOT NULL`)).rows.map((r) => [r.confluence_account_id, r.id]));
// 새 관찰자도 원본 표시 이름을 보장한다(원본은 GET만).
async function ensureUsers(ids) {
  const missing = [...ids].filter(id => !users.has(id));
  const profiles = new Map();
  for (let i = 0; i < missing.length; i += 90) {
    const qs = missing.slice(i, i + 90).map(id => `accountId=${encodeURIComponent(id)}`).join('&');
    const data = await get(`/rest/api/3/user/bulk?${qs}&maxResults=100`);
    for (const u of data.values ?? []) profiles.set(u.accountId, u);
  }
  for (const id of missing) {
    const u = profiles.get(id);
    const { rows } = await query(`INSERT INTO users (confluence_account_id, display_name, email) VALUES ($1, $2, $3)
      ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      [id, u?.displayName ?? '(알 수 없는 사용자)', u?.emailAddress || null]);
    users.set(id, rows[0].id);
  }
}
const uid = (u) => (u?.accountId ? users.get(u.accountId) ?? null : null);
try {
  const { rows } = await query(`SELECT i.id, i.fields_raw->'watches' AS watches FROM jira_issues i JOIN jira_projects p ON p.id = i.project_id
    WHERE (COALESCE((i.fields_raw->'watches'->>'watchCount')::int, 0) > 0 OR i.watchers_imported_at IS NOT NULL) AND ($1::text IS NULL OR p.key = $1)`, [args.project ?? null]);
  const n = await syncWatchers(rows.map((r) => ({ id: r.id, fields: { watches: { watchCount: r.watches?.watchCount ?? 0 } } })), { get, query, ensureUsers, uid });
  console.log(`완료: 이슈 ${rows.length}개, 관찰자 ${n}건`);
} finally { await closeDb(); }
