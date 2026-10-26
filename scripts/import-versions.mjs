#!/usr/bin/env node
// 이관된 페이지의 전체 버전 이력을 수집한다 (읽기 전용 GET).
// 과거 버전 본문은 v1 historical API로 가져와 변환해 content_versions에 채운다.
//
// 사용법: node scripts/import-versions.mjs --space KEY [--concurrency 6]

import { parseArgs } from 'node:util';
import { convertStorage } from './convert-storage.mjs';
import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({
  options: {
    space: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
  },
});
if (!args.space) { console.error('사용법: node scripts/import-versions.mjs --space <KEY>'); process.exit(1); }

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

async function get(path, attempt = 0) {
  const res = await fetch(SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return get(path, attempt + 1);
  }
  if (!res.ok) { const e = new Error(`${res.status} GET ${path}`); e.status = res.status; throw e; }
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// 대상: 해당 스페이스에서 current_version > 1 이고 과거 버전이 비어 있는 페이지
const { rows: pages } = await query(
  `SELECT c.id, c.title, c.current_version,
          (SELECT count(*) FROM content_versions v WHERE v.content_id = c.id) AS have
     FROM content c JOIN spaces s ON s.id = c.space_id
    WHERE s.key = $1 AND c.type IN ('page','live') AND c.current_version > 1`, [args.space]);
const targets = pages.filter((p) => Number(p.have) < Number(p.current_version));
const totalMissing = targets.reduce((a, p) => a + (Number(p.current_version) - Number(p.have)), 0);
console.log(`${args.space}: 대상 페이지 ${targets.length}건, 수집할 과거 버전 약 ${totalMissing}개`);

// 사용자 매핑 캐시
const userCache = new Map();
async function userIdFor(accountId) {
  if (!accountId) return null;
  if (userCache.has(accountId)) return userCache.get(accountId);
  const { rows } = await query(`SELECT id FROM users WHERE confluence_account_id = $1`, [accountId]);
  let id;
  if (rows.length) id = rows[0].id;
  else {
    let displayName = '(알 수 없는 사용자)';
    try {
      const res = await get(`/wiki/rest/api/user?accountId=${encodeURIComponent(accountId)}`);
      displayName = res.displayName ?? res.publicName ?? displayName;
    } catch { /* 탈퇴 사용자 등 */ }
    const { rows: ins } = await query(
      `INSERT INTO users (confluence_account_id, display_name) VALUES ($1, $2)
       ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = users.display_name RETURNING id`,
      [accountId, displayName]);
    id = ins[0].id;
  }
  userCache.set(accountId, id);
  return id;
}

let done = 0, inserted = 0, failedConv = 0, missing = 0;
await mapLimit(targets, Number(args.concurrency), async (p) => {
  const { rows: haveRows } = await query(`SELECT version FROM content_versions WHERE content_id = $1`, [p.id]);
  const have = new Set(haveRows.map((r) => Number(r.version)));
  for (let v = 1; v < Number(p.current_version); v++) {
    if (have.has(v)) continue;
    let data;
    try {
      data = await get(`/wiki/rest/api/content/${p.id}?status=historical&version=${v}&expand=body.storage,version`);
    } catch (e) {
      if (e.status === 404) { missing++; continue; } // 삭제된 중간 버전
      throw e;
    }
    const xhtml = data.body?.storage?.value ?? '';
    let doc = null;
    if (xhtml.trim()) {
      try { doc = convertStorage(xhtml).doc; } catch { failedConv++; }
    }
    const authorId = await userIdFor(data.version?.by?.accountId);
    await query(
      `INSERT INTO content_versions (content_id, version, doc, source_xhtml, message, minor_edit, author_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (content_id, version) DO NOTHING`,
      [p.id, v, doc ? JSON.stringify(doc) : null, xhtml, data.version?.message ?? null,
       data.version?.minorEdit ?? false, authorId, data.version?.when ?? null]);
    inserted++;
  }
  if (++done % 25 === 0) console.log(`  ${done}/${targets.length} 페이지 (버전 ${inserted}개 적재)`);
});

console.log(`완료: 버전 ${inserted}개 적재, 변환 실패 ${failedConv}, 사라진 버전 ${missing}`);
await closeDb();
