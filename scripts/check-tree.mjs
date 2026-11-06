#!/usr/bin/env node
// 이관 트리 점검 (GIRA-60) — 원본 Confluence와 Gonfluence의 항목·부모를 비교한다. 원본은 GET만.
//   node scripts/check-tree.mjs --space KEY [--all]
//   기본: Gonfluence에 이미 있는 항목만 부모가 원본과 같은지 본다(샘플 이관용)
//   --all: 원본에 있는데 Gonfluence에 없는 항목 수도 종류별로 센다(전체 이관 점검)
import { parseArgs } from 'node:util';
import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 */ }
const { values: args } = parseArgs({ options: { space: { type: 'string' }, all: { type: 'boolean', default: false } } });
if (!args.space) { console.error('사용: node scripts/check-tree.mjs --space KEY [--all]'); process.exit(1); }
const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
const get = async (path) => {
  const r = await fetch(path.startsWith('http') ? path : SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} GET ${path}`);
  return r.json();
};

// 원본 항목: CQL로 종류 전체 + 조상(부모) — 문서·폴더·데이터베이스·화이트보드·임베드·블로그
const origin = new Map();
const cql = encodeURIComponent(`space="${args.space}" and type in (page, folder, database, whiteboard, embed, blogpost)`);
for (let next = `/wiki/rest/api/content/search?cql=${cql}&expand=ancestors&limit=100`; next;) {
  const page = await get(next);
  for (const c of page.results ?? []) origin.set(String(c.id), { type: c.type, title: c.title, parent: c.type === 'blogpost' ? null : (c.ancestors?.at(-1)?.id ?? null) });
  next = page._links?.next ? '/wiki' + page._links.next : null;
}

const { rows } = await query(`SELECT c.id::text AS id, c.type, c.title, c.parent_id::text AS parent FROM content c JOIN spaces s ON s.id = c.space_id
  WHERE s.key = $1 AND c.id < 1000000000000 AND c.status = 'current'`, [args.space]);
const local = new Map(rows.map((r) => [r.id, r]));

let ok = 0; const wrongParent = [], missingParent = [], extra = [];
for (const [id, l] of local) {
  const o = origin.get(id);
  if (!o) { extra.push(`${id} ${l.type} "${l.title}" — 원본에 없음(삭제·이동?)`); continue; }
  if ((o.parent ?? null) === (l.parent ?? null)) { ok++; continue; }
  if (o.parent && !local.has(String(o.parent))) missingParent.push(`${id} "${l.title}" — 원본 부모 ${o.parent}(${origin.get(String(o.parent))?.type ?? '?'})가 아직 이관되지 않음`);
  else wrongParent.push(`${id} "${l.title}" — 부모 원본 ${o.parent ?? '없음'} / 이관 ${l.parent ?? '없음'}`);
}
console.log(`스페이스 ${args.space}: 원본 ${origin.size}개, 이관 ${local.size}개 — 부모 일치 ${ok}`);
for (const [label, list] of [['부모 다름', wrongParent], ['부모 미이관', missingParent], ['원본에 없음', extra]]) {
  if (!list.length) continue;
  console.log(`  ${label} ${list.length}건`); for (const x of list.slice(0, 10)) console.log('   ', x);
}
if (args.all) {
  const missing = {};
  for (const [id, o] of origin) if (!local.has(id)) missing[o.type] = (missing[o.type] ?? 0) + 1;
  console.log('  원본에만 있는 항목(종류별):', JSON.stringify(missing));
}
if (wrongParent.length) process.exitCode = 1;
await closeDb();
