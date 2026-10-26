#!/usr/bin/env node
// confluence-inventory.mjs 보완 수집기.
// v2 스페이스 pages API에 잡히지 않는 유형(폴더, 화이트보드, 데이터베이스, 임베드)과
// 라이브 문서(subtype=live)를 CQL 검색으로 수집하고,
// 폴더 계층을 반영해 페이지 깊이 히스토그램을 다시 계산한다. GET 요청만 사용한다.
//
// 출력:
//   analysis/raw/extra.json      유형별 전체 목록 (제목 포함, git 제외)
//   analysis/summary-extra.json  제목 없는 집계

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

try {
  process.loadEnvFile('.env');
} catch {
  // 환경변수로 직접 넘겨도 된다
}

const SITE = (process.env.ATLASSIAN_SITE ?? 'https://gmdsoft.atlassian.net').replace(/\/$/, '');
const { ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN } = process.env;
if (!ATLASSIAN_EMAIL || !ATLASSIAN_API_TOKEN) {
  console.error('ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN 을 .env 에 설정하세요 (.env.example 참고).');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${ATLASSIAN_EMAIL}:${ATLASSIAN_API_TOKEN}`).toString('base64');

async function get(path, attempt = 0) {
  const res = await fetch(SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return get(path, attempt + 1);
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} — GET ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// CQL 검색 결과를 끝까지 순회한다. _links.next 는 /wiki 기준 상대 경로다.
async function* cqlSearch(cql) {
  let next = `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=100`;
  while (next) {
    const data = await get(next);
    yield* data.results ?? [];
    next = data._links?.next ? '/wiki' + data._links.next : null;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const inc = (map, key, n = 1) => (map[key] = (map[key] ?? 0) + n);
const spaceKeyOf = (result) => result.resultGlobalContainer?.displayUrl?.match(/\/spaces\/([^/?]+)/)?.[1] ?? '?';

const errors = [];
const raw = {};
const perSpace = {};

// 1. CQL로 유형별 목록 수집
const CQL_BY_TYPE = {
  folder: 'type = folder',
  whiteboard: 'type = whiteboard',
  database: 'type = database',
  embed: 'type = embed',
  livePage: 'type = page and subtype = live',
};
for (const [kind, cql] of Object.entries(CQL_BY_TYPE)) {
  const items = [];
  try {
    for await (const r of cqlSearch(cql)) {
      items.push({ id: r.content?.id, title: r.content?.title ?? r.title, spaceKey: spaceKeyOf(r) });
    }
  } catch (e) {
    errors.push(`${kind}: ${e.message}`);
  }
  raw[kind] = items;
  perSpace[kind] = {};
  for (const it of items) inc(perSpace[kind], it.spaceKey);
  console.error(`${kind}: ${items.length}건`);
}

// 2. 폴더 상세(부모, 스페이스)를 조회해 계층을 복원한다
raw.folderDetails = (
  await mapLimit(raw.folder, 8, async (f) => {
    try {
      const d = await get(`/wiki/api/v2/folders/${f.id}`);
      return { id: d.id, title: d.title, parentId: d.parentId, parentType: d.parentType, spaceId: d.spaceId };
    } catch (e) {
      errors.push(`folder ${f.id}: ${e.message}`);
      return null;
    }
  })
).filter(Boolean);

// 3. 폴더를 포함해 페이지 깊이를 다시 계산한다
const inv = JSON.parse(readFileSync('analysis/raw/inventory.json', 'utf8'));
const parents = new Map();
for (const s of inv.spaces) for (const p of s.pages) parents.set(p.id, p.parentId);
for (const f of raw.folderDetails) parents.set(f.id, f.parentId);
const folderIds = new Set(raw.folderDetails.map((f) => f.id));

const depthOf = (id) => {
  let d = 0;
  let viaFolder = false;
  for (let p = parents.get(id); p != null && parents.has(p) && d < 50; p = parents.get(p)) {
    d++;
    if (folderIds.has(p)) viaFolder = true;
  }
  return { d, viaFolder };
};

const pages = { depthHistogram: {}, maxDepth: 0, viaFolder: 0, total: 0 };
for (const s of inv.spaces)
  for (const p of s.pages) {
    const { d, viaFolder } = depthOf(p.id);
    pages.total++;
    inc(pages.depthHistogram, String(d));
    pages.maxDepth = Math.max(pages.maxDepth, d);
    if (viaFolder) pages.viaFolder++;
  }

// 4. 라이브 문서가 기존 인벤토리(v2 pages 목록)에 포함되는지 검증한다
const inventoryIds = new Set([...parents.keys()]);
const liveFound = raw.livePage.filter((p) => inventoryIds.has(p.id)).length;

const topSpaces = (kind, n = 10) =>
  Object.entries(perSpace[kind] ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

const summary = {
  collectedAt: new Date().toISOString(),
  site: SITE,
  counts: Object.fromEntries(Object.entries(CQL_BY_TYPE).map(([k]) => [k, raw[k].length])),
  folders: {
    parentTypes: raw.folderDetails.reduce((m, f) => (inc(m, f.parentType ?? 'spaceRoot'), m), {}),
  },
  pagesWithFolderDepth: pages,
  liveCoverageInInventory: { found: liveFound, total: raw.livePage.length },
  spacesUsing: Object.fromEntries(Object.keys(CQL_BY_TYPE).map((k) => [k, Object.keys(perSpace[k]).length])),
  topSpaces: Object.fromEntries(['whiteboard', 'database', 'folder', 'livePage'].map((k) => [k, topSpaces(k, 5)])),
  errors: { count: errors.length, samples: errors.slice(0, 20) },
};

await mkdir('analysis/raw', { recursive: true });
await writeFile('analysis/raw/extra.json', JSON.stringify(raw, null, 2));
await writeFile('analysis/summary-extra.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
