#!/usr/bin/env node
// 이미 이관된 페이지의 '전체 폭 보기' 속성(content-appearance-published)을 수집해 content.full_width에 반영.
// 읽기 전용 GET만 사용. 신규 임포트는 import-space.mjs가 함께 수집하므로 이 스크립트는 소급용.
//
// 사용법: node scripts/import-appearance.mjs

import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
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

// 이관된 페이지만 (source_xhtml이 있는 버전을 가진 page/live)
const { rows } = await query(
  `SELECT DISTINCT c.id FROM content c
    JOIN content_versions v ON v.content_id = c.id AND v.source_xhtml IS NOT NULL
   WHERE c.type IN ('page', 'live') ORDER BY c.id`);
console.log(`대상 페이지: ${rows.length}건`);

let done = 0, full = 0, missing = 0;
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < rows.length) {
    const { id } = rows[i++];
    try {
      const data = await get(`/wiki/api/v2/pages/${id}/properties?key=content-appearance-published`);
      // Confluence 기본은 고정 폭(넓은 블록만 돌출) — 속성이 명시적으로 full-width일 때만 전체 폭
      const isFull = (data.results ?? []).some((p) => String(p.value).replaceAll('"', '') === 'full-width');
      await query(`UPDATE content SET full_width = $2 WHERE id = $1`, [id, isFull]);
      if (isFull) full++;
    } catch (e) {
      if (e.status === 404) missing++; // 원본에서 삭제된 페이지
      else throw e;
    }
    if (++done % 50 === 0) console.log(`  ${done}/${rows.length} (전체 폭 ${full})`);
  }
}));
console.log(`완료: ${done}건 조회, 전체 폭 ${full}건, 원본 없음 ${missing}건`);
await closeDb();
