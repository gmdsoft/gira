#!/usr/bin/env node
// 데이터베이스 테스트 자료(.ybin) 만들기 — 원본 스냅샷의 '구조'(필드 id·형식·선택지 id·보기 설정·행 순서)만 남기고
// 이름·글·사용자·링크·이슈 키 같은 값은 모두 가짜로 바꾼다. 원본 사내 데이터는 저장소에 넣지 않는다(공개 저장소).
// 사용: node test/fixtures/make-database-fixtures.mjs <원본 .ybin 폴더(analysis/raw/canvas)>
import * as Y from 'yjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeCanvas } from '../../scripts/research/canvas-decode.mjs';

const KEEP = new Set(['Country', 'Indonesia', 'Video']); // 테스트가 이름으로 찾는 일반 라벨
const IDS = ['943521921', '120422433', '135694426', '1103429634', '47614020'];
const src = process.argv[2] ?? 'analysis/raw/canvas';

function anonymize(raw, seed) {
  let n = 0;
  const fake = (prefix) => `${prefix} ${seed}-${++n}`;
  const fields = {};
  const optionIds = Object.fromEntries(Object.entries(raw.fbi ?? {}).map(([id, f]) => [id, new Set((f.sso ?? []).map((o) => o.i))]));
  const labelMap = {}; // 필드별 원래 라벨 → 가짜 라벨 (선택 칸 일부는 id 대신 라벨 글자를 값으로 저장한다)
  for (const [id, f] of Object.entries(raw.fbi ?? {})) {
    const map = (labelMap[id] = new Map());
    fields[id] = { ...f, n: KEEP.has(f.n) ? f.n : fake('필드'), d: '',
      ...(Array.isArray(f.sso) ? { sso: f.sso.map((o) => { const l = KEEP.has(o.l) ? o.l : fake('선택지'); map.set(o.l, l); return { ...o, l }; }) } : {}) };
  }
  const cell = (c, fieldId) => {
    if (!c || typeof c !== 'object') return c;
    switch (c.t) {
      case 's': return { ...c, v: (c.v ?? []).map((x) => {
        if (typeof x !== 'string' || optionIds[fieldId]?.has(x)) return x; // 선택지 id는 그대로
        if (labelMap[fieldId]?.has(x)) return labelMap[fieldId].get(x);
        return KEEP.has(x) ? x : fake('선택지'); // 지워진 선택지의 라벨 글자 등
      }) };
      case 't': { const t = c.v ? fake('글') : ''; return { ...c, v: t, ...(c.rt != null ? { rt: `<paragraph>${t}</paragraph>` } : {}) }; }
      case 'h': return { ...c, v: (c.v ?? []).map((x, i) => ({ ...x, u: `https://example.com/${seed}/${n}-${i}` })) };
      case 'u': return { ...c, v: (c.v ?? []).map((x) => ({ ...x, a: `user-${seed}-${++n}`, d: `사용자 ${n}` })) };
      case 'ji': return { ...c, v: (c.v ?? []).map((x) => ({ ...x, k: `TEST-${++n}` })) };
      case 'pl': return { ...c, v: (c.v ?? []).map((x) => ({ ...x, c: String(1000 + ++n), a: `ari:cloud:confluence:test:page/${1000 + n}` })) };
      case 'i': return { ...c, v: (c.v ?? []).map((x) => ({ ...x, f: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` })) };
      default: return c; // 선택(s)·숫자(n)·날짜(d)는 구조 그대로
    }
  };
  const entries = {};
  for (const [id, row] of Object.entries(raw.ebi ?? {})) entries[id] = Object.fromEntries(Object.entries(row).map(([k, c]) => [k, cell(c, k)]));
  const views = {};
  for (const [id, v] of Object.entries(raw.vbi ?? {})) views[id] = { ...v, n: KEEP.has(v.n) ? v.n : fake('보기') };
  return { ...raw, fbi: fields, ebi: entries, vbi: views };
}

function encode(data) {
  const doc = new Y.Doc();
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) doc.getArray(key).push(value);
    else if (value && typeof value === 'object') { const m = doc.getMap(key); for (const [k, v] of Object.entries(value)) m.set(k, v); }
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

IDS.forEach((id, i) => {
  const raw = decodeCanvas(readFileSync(`${src}/database-${id}.ybin`));
  const out = encode(anonymize(raw, i + 1));
  writeFileSync(new URL(`./database-${id}.ybin`, import.meta.url), out);
  console.log(id, out.length, 'bytes');
});
