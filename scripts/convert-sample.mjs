#!/usr/bin/env node
// 변환기 검증: 실제 Confluence 페이지 표본을 받아 convert-storage.mjs 로 변환하고
// 커버리지(미지원 태그, 매크로 처리 현황, 실패)를 집계한다. GET 요청만 사용한다.
//
// 표본: 매크로 종류별로 많이 쓰는 페이지 최대 4개 + 전체에서 무작위 200개
// 출력: analysis/convert-sample-report.json

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { convertStorage } from './convert-storage.mjs';

try {
  process.loadEnvFile('.env');
} catch {}

const SITE = (process.env.ATLASSIAN_SITE ?? 'https://gmdsoft.atlassian.net').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

async function get(path, attempt = 0) {
  const res = await fetch(SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} — GET ${path}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  }));
  return results;
}

// 재현 가능한 무작위 표본을 위한 시드 PRNG
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inv = JSON.parse(readFileSync('analysis/raw/inventory.json', 'utf8'));
const all = inv.spaces.flatMap((s) => s.pages);
const byMacro = {};
for (const p of all) for (const m of Object.keys(p.macros)) (byMacro[m] ??= []).push(p);

const picked = new Map();
for (const pages of Object.values(byMacro)) {
  const sorted = [...pages].sort((a, b) => b.storageBytes - a.storageBytes);
  for (const p of [...sorted.slice(0, 2), ...sorted.slice(-2)]) picked.set(p.id, p);
}
const rand = mulberry32(20261024);
while (picked.size < Math.min(all.length, Object.keys(byMacro).length * 4 + 200)) {
  const p = all[Math.floor(rand() * all.length)];
  picked.set(p.id, p);
}
const sample = [...picked.values()];
console.error(`표본 ${sample.length}페이지 변환 시작`);

const agg = { tags: {}, unknownTags: {}, macros: {}, dynamicMacros: {}, unsupportedMacros: {} };
const failures = [];
let converted = 0, emptyBodies = 0, fetchErrors = 0, totalNodes = 0;

const countNodes = (n) => 1 + (n.content ?? []).reduce((a, c) => a + countNodes(c), 0);
const merge = (into, from) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v; };

await mapLimit(sample, 6, async (p) => {
  let body;
  try {
    body = (await get(`/wiki/api/v2/pages/${p.id}?body-format=storage`)).body?.storage?.value ?? '';
  } catch (e) {
    fetchErrors++;
    failures.push({ id: p.id, stage: 'fetch', error: e.message });
    return;
  }
  if (!body.trim()) { emptyBodies++; return; }
  try {
    const { doc, stats } = convertStorage(body);
    JSON.stringify(doc); // 직렬화 가능성 확인
    converted++;
    totalNodes += countNodes(doc);
    for (const k of Object.keys(agg)) merge(agg[k], stats[k]);
  } catch (e) {
    failures.push({ id: p.id, stage: 'convert', error: e.message });
  }
});

const sortDesc = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const report = {
  ranAt: new Date().toISOString(),
  sample: sample.length, converted, emptyBodies, fetchErrors,
  convertFailures: failures.filter((f) => f.stage === 'convert').length,
  totalNodes,
  tags: sortDesc(agg.tags),
  unknownTags: sortDesc(agg.unknownTags),
  macros: sortDesc(agg.macros),
  dynamicMacros: sortDesc(agg.dynamicMacros),
  unsupportedMacros: sortDesc(agg.unsupportedMacros),
  failures: failures.slice(0, 20),
};
await writeFile('analysis/convert-sample-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
