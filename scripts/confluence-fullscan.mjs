#!/usr/bin/env node
// 원본 Confluence 전체 문서 본문(storage) 호환성 전수 조사 — GET만 사용한다.
// 모든 스페이스의 현재 페이지·블로그 본문을 받아 우리 변환기(convert-storage.mjs)로 돌려 보고,
// 페이지별로 미지원 매크로·동적 매크로·모르는 태그·ADF 노드/확장(Forge·Connect 앱) 종류를 기록한다.
//
// 출력 (analysis/raw/ 는 gitignore — 사내 문서 제목 포함):
//   analysis/raw/fullscan.json          페이지별 결과
//   analysis/raw/fullscan-samples.json  ADF 확장 키별 storage 샘플(최대 3개)
// 사용: node scripts/confluence-fullscan.mjs [--spaces KEY1,KEY2] [--concurrency 4]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { convertStorage } from './convert-storage.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수로 직접 */ }
const SITE = (process.env.ATLASSIAN_SITE ?? 'https://gmdsoft.atlassian.net').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('--spaces') ? new Set(arg('--spaces').split(',')) : null;
const CONC = Number(arg('--concurrency', 4));
const OUT = 'analysis/raw/fullscan.json';

async function get(path, attempt = 0) {
  const res = await fetch(path.startsWith('http') ? path : SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} GET ${path}`);
  return res.json();
}

// ADF 확장 키·제목을 storage에서 직접 뽑는다 (변환기 stats는 짧은 이름만 남기므로)
function adfExtensions(xhtml) {
  const out = [];
  const re = /<ac:adf-node type="(extension|bodied-extension|inline-extension)">([\s\S]*?)<\/ac:adf-node>/g;
  let m;
  while ((m = re.exec(xhtml))) {
    const body = m[2];
    const attr = (k) => new RegExp(`<ac:adf-attribute key="${k}">([^<]*)</ac:adf-attribute>`).exec(body)?.[1] ?? '';
    const title = /<ac:adf-parameter key="extension-title">([^<]*)</.exec(body)?.[1] ?? /<ac:adf-parameter key="title">([^<]*)</.exec(body)?.[1] ?? '';
    out.push({ node: m[1], type: attr('extension-type'), key: attr('extension-key'), title, start: m.index });
  }
  return out;
}

const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), spaces: {} };
const samplesPath = 'analysis/raw/fullscan-samples.json';
const samples = existsSync(samplesPath) ? JSON.parse(readFileSync(samplesPath, 'utf8')) : {};
const save = () => { writeFileSync(OUT, JSON.stringify(state)); writeFileSync(samplesPath, JSON.stringify(samples, null, 1)); };

const inv = JSON.parse(readFileSync('analysis/raw/inventory.json', 'utf8'));
const spaces = inv.spaces.filter((s) => (!ONLY || ONLY.has(s.key)) && !state.spaces[s.key]?.done);
console.error(`대상 스페이스 ${spaces.length}개`);

async function scanSpace(s) {
  const rec = { key: s.key, name: s.name, pages: [], errors: [] };
  for (const kind of ['pages', 'blogposts']) {
    let next = `/wiki/api/v2/spaces/${s.id}/${kind}?body-format=storage&limit=100&status=current`;
    while (next) {
      let data;
      try { data = await get(next); } catch (e) { rec.errors.push(e.message); break; }
      for (const p of data.results ?? []) {
        const xhtml = p.body?.storage?.value ?? '';
        const r = { id: p.id, kind: kind === 'pages' ? (p.subtype === 'live' ? 'live' : 'page') : 'blogpost', title: p.title, bytes: xhtml.length };
        try {
          const { stats } = convertStorage(xhtml);
          for (const k of ['unsupportedMacros', 'dynamicMacros', 'unknownTags']) if (Object.keys(stats[k]).length) r[k] = stats[k];
          const adf = Object.fromEntries(Object.entries(stats.macros).filter(([k]) => k.startsWith('adf:')));
          if (Object.keys(adf).length) r.adf = adf;
        } catch (e) { r.convertError = String(e.message).slice(0, 200); }
        const ext = adfExtensions(xhtml);
        if (ext.length) {
          r.ext = ext.map(({ start, ...x }) => x);
          for (const x of ext) {
            const k = x.key || x.type;
            samples[k] ??= [];
            if (samples[k].length < 3) samples[k].push({ space: s.key, pageId: p.id, title: x.title, xhtml: xhtml.slice(Math.max(0, x.start - 50), x.start + 2500) });
          }
        }
        rec.pages.push(r);
      }
      next = data._links?.next ?? null;
      if (next && !next.startsWith('/wiki')) next = '/wiki' + next;
    }
  }
  rec.done = true;
  state.spaces[s.key] = rec;
  console.error(`${s.key}: ${rec.pages.length}건${rec.errors.length ? ' 오류 ' + rec.errors.length : ''}`);
  save();
}

let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (i < spaces.length) await scanSpace(spaces[i++]); }));
state.finishedAt = new Date().toISOString();
save();
console.error('완료');
