#!/usr/bin/env node
// 이관된 프로젝트마다 원본이 쓰는 상태 목록을 채운다 (원본은 GET만) — 사용: node scripts/jira-project-statuses.mjs
import { query, closeDb } from '../server/src/db.mjs';
import { replaceProjectStatuses } from './lib/jira-project-statuses.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
if (!SITE) throw new Error('ATLASSIAN_SITE 환경변수가 필요합니다.');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

try {
  const { rows } = await query(`SELECT id, key FROM jira_projects WHERE id < 1e12 ORDER BY key`);
  for (const p of rows) {
    const res = await fetch(`${SITE}/rest/api/3/project/${encodeURIComponent(p.key)}/statuses`,
      { method: 'GET', headers: { Authorization: AUTH, Accept: 'application/json' } });
    if (!res.ok) { console.log(`${p.key}: 건너뜀 (${res.status})`); continue; }
    const ids = [...new Set((await res.json()).flatMap((t) => t.statuses.map((s) => Number(s.id))))];
    // 원본 목록에 없지만 이슈가 실제로 쓰는 상태도 남긴다
    const used = await query(`SELECT DISTINCT status_id FROM jira_issues WHERE project_id = $1 AND status_id IS NOT NULL`, [p.id]);
    const known = await query(`SELECT id FROM jira_statuses WHERE id = ANY($1::bigint[])`, [ids]);
    const all = [...new Set([...known.rows.map((r) => Number(r.id)), ...used.rows.map((r) => Number(r.status_id))])];
    await replaceProjectStatuses(p.id, all);
    console.log(`${p.key}: 상태 ${all.length}`);
  }
} finally { await closeDb(); }
