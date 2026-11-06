#!/usr/bin/env node
// 사용: node scripts/jira-attach-media-ids.mjs [--project NEXT] [--limit 100]
import { parseArgs } from 'node:util';
import { configureDb, query, closeDb } from '../server/src/db.mjs';
import { fillMediaIds } from './lib/jira-media.mjs';
try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
const { values } = parseArgs({ options: { project: { type: 'string' }, limit: { type: 'string' } } });
const limit = values.limit === undefined ? null : Number(values.limit);
if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('--limit 은 양의 정수여야 합니다.');
if (!process.env.GIRA_DATABASE_URL || !process.env.ATLASSIAN_SITE || !process.env.ATLASSIAN_EMAIL || !process.env.ATLASSIAN_API_TOKEN) throw new Error('Gira DB 및 Atlassian 환경변수가 필요합니다.');
configureDb({ url: process.env.GIRA_DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
try {
  const { rows } = await query(`SELECT a.id FROM jira_attachments a JOIN jira_issues i ON i.id = a.issue_id
    JOIN jira_projects p ON p.id = i.project_id
    WHERE (a.media_id IS NULL OR a.media_id = '') AND a.id < 1000000000000
    AND ($1::text IS NULL OR p.key = $1) ORDER BY a.id LIMIT $2`, [values.project ?? null, limit]);
  const result = await fillMediaIds(rows, {
    query, site: process.env.ATLASSIAN_SITE,
    auth: 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64'),
  }, (p) => { if (p.done % 100 === 0 || p.done === p.total) console.log(JSON.stringify(p)); });
  console.log('완료', result);
  if (result.failed) process.exitCode = 1;
} finally { await closeDb(); }
