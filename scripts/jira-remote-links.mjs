#!/usr/bin/env node
// 기존 이관 이슈의 원격 링크만 소급 동기화. 원본은 GET만 사용.
import { parseArgs } from 'node:util';
import { query, configureDb, closeDb } from '../server/src/db.mjs';
import { jiraGet } from './lib/jira-source-get.mjs';
import { syncRemoteLinks } from './lib/jira-remote-links.mjs';
try { process.loadEnvFile('.env'); } catch { /* 환경변수 사용 가능 */ }
const { values: args } = parseArgs({ options: { project: { type: 'string' }, limit: { type: 'string' } } });
const limit = args.limit == null ? null : Number(args.limit);
if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('--limit은 양의 정수여야 합니다');
configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const site = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
if (!site || !process.env.ATLASSIAN_EMAIL || !process.env.ATLASSIAN_API_TOKEN) throw new Error('원본 Jira 접속 환경변수가 필요합니다');
const auth = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
const get = jiraGet(site, auth);
let last = 0, total = 0, links = 0;
try {
  for (;;) {
    const size = Math.min(100, limit == null ? 100 : limit - total);
    if (!size) break;
    const { rows } = await query(`SELECT i.id FROM jira_issues i JOIN jira_projects p ON p.id = i.project_id
      WHERE i.id > $1 AND i.id < 1000000000000 AND i.fields_raw::text <> '{}'
        AND ($2::text IS NULL OR p.key = $2) ORDER BY i.id LIMIT $3`, [last, args.project ?? null, size]);
    if (!rows.length) break;
    links += await syncRemoteLinks(rows, { get, query });
    total += rows.length;
    last = rows.at(-1).id;
    console.log(`처리 이슈 ${total} / 원격 링크 ${links}`);
  }
} finally { await closeDb(); }
