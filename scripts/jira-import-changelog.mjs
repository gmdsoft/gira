#!/usr/bin/env node
// Jira Cloud 변경 이력(changelog) 이관 — 읽기 전용 GET만 사용.
// search/jql의 expand=changelog로 페이지 단위 수집, 잘린 이슈(total > 반환)만 per-issue 추가 조회.
//
// 사용법: node scripts/jira-import-changelog.mjs --project NEXT [--wipe]

import { parseArgs } from 'node:util';
import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({
  options: { project: { type: 'string' }, wipe: { type: 'boolean', default: false } },
});
if (!args.project) {
  console.error('사용법: node scripts/jira-import-changelog.mjs --project <KEY> [--wipe]');
  process.exit(1);
}

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

async function get(pathOrUrl, attempt = 0) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : SITE + pathOrUrl;
  const res = await fetch(url, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return get(pathOrUrl, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — GET ${url}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const { rows: prow } = await query(`SELECT id FROM jira_projects WHERE key = $1`, [args.project]);
if (!prow.length) { console.error(`프로젝트 ${args.project}가 로컬 DB에 없습니다. 이슈 이관을 먼저 하세요.`); process.exit(1); }
const projectId = prow[0].id;

if (args.wipe) {
  console.log('기존 이관 기록 삭제...');
  await query(`DELETE FROM jira_changelog WHERE jira_id IS NOT NULL
                 AND issue_id IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [projectId]);
}

// 로컬 DB에 있는 이슈만 대상 (FK)
const knownIds = new Set((await query(`SELECT id FROM jira_issues WHERE project_id = $1`, [projectId])).rows.map((r) => Number(r.id)));

const userIdByAccount = new Map();
async function ensureUsers(accountMap) { // accountId → displayName
  const missing = [...accountMap.keys()].filter((id) => !userIdByAccount.has(id));
  for (const id of missing) {
    const { rows } = await query(
      `INSERT INTO users (confluence_account_id, display_name) VALUES ($1, $2)
       ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`, [id, accountMap.get(id) ?? '(알 수 없는 사용자)']);
    userIdByAccount.set(id, rows[0].id);
  }
}

const ITEM_KEYS = ['field', 'fieldtype', 'from', 'fromString', 'to', 'toString'];
const slim = (items) => (items ?? []).map((it) => Object.fromEntries(ITEM_KEYS.map((k) => [k, it[k] ?? null])));

let histCount = 0, issueCount = 0, truncated = 0;
async function saveHistories(issueId, histories) {
  const accounts = new Map();
  for (const h of histories) if (h.author?.accountId) accounts.set(h.author.accountId, h.author.displayName);
  await ensureUsers(accounts);
  for (const h of histories) {
    if (!(h.items ?? []).length) continue;
    await query(
      `INSERT INTO jira_changelog (jira_id, issue_id, author_id, created_at, items)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (jira_id) DO UPDATE SET items = EXCLUDED.items`,
      [h.id, issueId, h.author?.accountId ? userIdByAccount.get(h.author.accountId) : null,
       h.created ?? null, JSON.stringify(slim(h.items))]);
    histCount++;
  }
}

console.log(`프로젝트 ${args.project} 변경 이력 수집...`);
const jql = encodeURIComponent(`project = "${args.project}" ORDER BY created ASC`);
let token = null;
for (;;) {
  const qs = `jql=${jql}&maxResults=100&fields=none&expand=changelog${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`;
  const page = await get(`/rest/api/3/search/jql?${qs}`);
  const issues = (page.issues ?? []).filter((iss) => knownIds.has(Number(iss.id)));
  if (!(page.issues ?? []).length) break;

  // expand에 전부 담긴 이슈는 그대로 저장, 잘린 이슈는 per-issue 페이지 조회
  const partial = [];
  for (const iss of issues) {
    const ch = iss.changelog ?? { histories: [], total: 0 };
    if ((ch.total ?? 0) > (ch.histories ?? []).length) partial.push(iss);
    else await saveHistories(Number(iss.id), ch.histories ?? []);
  }
  // 네트워크 조회는 병렬, DB 저장은 직렬 (users upsert 동시 실행 시 데드락 방지)
  const fetched = [];
  await mapLimit(partial, 6, async (iss) => {
    const all = [];
    let startAt = 0;
    for (;;) {
      const cp = await get(`/rest/api/3/issue/${iss.id}/changelog?startAt=${startAt}&maxResults=100`);
      all.push(...(cp.values ?? []));
      startAt += (cp.values ?? []).length;
      if (cp.isLast || !(cp.values ?? []).length) break;
    }
    fetched.push([Number(iss.id), all]);
  });
  for (const [id, all] of fetched) { await saveHistories(id, all); truncated++; }

  issueCount += issues.length;
  console.log(`  ${issueCount}건 이슈 처리, 기록 ${histCount}건...`);
  if (page.isLast || !page.nextPageToken) break;
  token = page.nextPageToken;
}

console.log(`완료: 이슈 ${issueCount} / 기록 ${histCount} (per-issue 추가 조회 ${truncated}건) / 사용자 ${userIdByAccount.size}`);
await closeDb();
