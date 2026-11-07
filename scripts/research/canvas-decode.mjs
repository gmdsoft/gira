#!/usr/bin/env node
// 데이터베이스·화이트보드 Yjs 스냅샷(.ybin)을 JSON으로 풀기 (GIRA-50·58 조사용).
//   node scripts/research/canvas-decode.mjs <file.ybin>            # 전체 JSON (stdout)
//   node scripts/research/canvas-decode.mjs --summary <폴더>        # 폴더 안 .ybin 전체 요약 (요소·필드 형식 집계)
//
// 구조 메모 (2026-11-06 조사)
// - 데이터베이스: fbi(필드 정의 {n 이름, t 형식, sso 선택지[{i,l,c}], sjf/sfi Jira 필드 원본…}),
//   ebi(항목 id → 필드 id → {t, v}), vbi(보기 {n, t: t 표/g 카드/b 보드, 필터·정렬·숨김}), f/e/v(순서 배열).
//   필드 형식 t: t 텍스트, s 선택, d 날짜, n 숫자, u 사용자, h 링크, i 파일(media id), ji Jira 이슈, jid Jira 필드(값 저장 안 함), pl 페이지 링크
// - 화이트보드: board(요소 id → {t 종류, c 색(float32 BE ×3 RGB), tx 리치 텍스트(바이너리, UTF-8 포함), sh 도형 모양…}),
//   dimensions/paths(배열 [{key:'p#id'|'s#id'|'r#id'|'fs#id'|'bs#id'|'bp#id', val}] — 위치·크기·회전·글자 배율 / 커넥터 s#·e#·se#),
//   zindex(그리는 순서 id 배열). 섹션 안 요소 좌표 기준은 아직 미확인(시제품에서 어긋남).

import * as Y from 'yjs';
import { readFileSync, readdirSync } from 'node:fs';

// 루트 타입을 몰라도 map/array로 시도해 JSON으로
function rootJSON(doc, key) {
  const t = doc.share.get(key);
  if (!t) return undefined;
  return t._map.size ? doc.getMap(key).toJSON() : doc.getArray(key).toJSON();
}
export function decodeCanvas(buf) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buf);
  return Object.fromEntries([...doc.share.keys()].map((k) => [k, rootJSON(doc, k)]));
}

const inc = (m, k, n = 1) => (m[k] = (m[k] ?? 0) + n);
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  if (a[0] === '--summary') {
    const dir = a[1];
    const tally = { whiteboard: { boards: 0, elements: 0, types: {} }, database: { databases: 0, entries: 0, fieldTypes: {}, viewTypes: {} } };
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ybin'))) {
      const j = decodeCanvas(readFileSync(`${dir}/${f}`));
      if (f.startsWith('whiteboard')) {
        tally.whiteboard.boards++;
        for (const el of Object.values(j.board ?? {})) { tally.whiteboard.elements++; inc(tally.whiteboard.types, el.t); }
      } else {
        tally.database.databases++;
        tally.database.entries += Object.keys(j.ebi ?? {}).length;
        for (const fd of Object.values(j.fbi ?? {})) inc(tally.database.fieldTypes, fd.t);
        for (const v of Object.values(j.vbi ?? {})) inc(tally.database.viewTypes, v.t);
      }
    }
    console.log(JSON.stringify(tally, null, 1));
  } else if (a[0]) {
    console.log(JSON.stringify(decodeCanvas(readFileSync(a[0])), null, 1));
  } else {
    console.error('사용: canvas-decode.mjs <file.ybin> | --summary <폴더>');
    process.exit(1);
  }
}
