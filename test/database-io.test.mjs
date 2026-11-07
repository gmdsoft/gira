// 데이터베이스 내보내기·가져오기, 화이트보드 PDF — 합성 데이터만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportTable, toCsv, toHtml, parseCsv, csvTable, inferType, importCsv, suggestMapping, safeFileName } from '../web/src/database-io.mjs';
import { jpegToPdf } from '../web/src/mini-pdf.mjs';

const data = () => ({
  fields: [
    { id: 'f1', name: '이름', type: 't', options: [] },
    { id: 'f2', name: '분류', type: 's', options: [{ id: 'o1', label: 'SNS', color: 'red' }, { id: 'o2', label: 'IM', color: 'blue' }] },
    { id: 'f3', name: '수', type: 'n', options: [] },
    { id: 'f4', name: '담당', type: 'u', options: [] },
  ],
  rows: [
    { id: 'r1', cells: { f1: 'Weibo, "국제"', f2: ['o1'], f3: 3, f4: [{ a: 'acc1', d: '김' }] } },
    { id: 'r2', cells: { f1: 'WeChat', f2: ['o2', 'o1'], f3: 10 } },
    { id: 'r3', cells: { f1: 'Line', f2: ['o2'], f3: 1 } },
  ],
  views: [{ id: 'v1', name: 'IM만', type: 'table', hiddenFields: ['f4'], sort: [{ field: 'f3', ascending: false }], filter: { f: 'f2', t: 'eq', v: ['o2'] }, groupBy: null }],
});

test('내보내기: 현재 보기(필터·정렬·숨김·검색) / 전체, CSV 따옴표·BOM, HTML 이스케이프', () => {
  const d = data();
  const cur = exportTable(d, d.views[0], { useView: true });
  assert.deepEqual(cur.header, ['이름', '분류', '수']);
  assert.deepEqual(cur.body, [['WeChat', 'IM, SNS', '10'], ['Line', 'IM', '1']]);
  const searched = exportTable(d, d.views[0], { useView: true, search: 'line' });
  assert.deepEqual(searched.body.map((r) => r[0]), ['Line']);
  const all = exportTable(d, d.views[0], { useView: false, users: { acc1: { display_name: '김성곤' } } });
  assert.equal(all.body.length, 3); assert.deepEqual(all.header, ['이름', '분류', '수', '담당']); assert.equal(all.body[0][3], '김성곤');
  const csv = toCsv(all);
  assert.ok(csv.startsWith('﻿이름,분류,수,담당\r\n'));
  assert.ok(csv.includes('"Weibo, ""국제""",SNS,3,김성곤'));
  const html = toHtml('<DB>', { header: ['a'], body: [['<b>x</b>']] });
  assert.match(html, /&lt;DB&gt;/); assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/); assert.doesNotMatch(html, /<b>x/);
  assert.equal(safeFileName('a/b:c?'), 'a b c');
});

test('CSV 읽기: 따옴표·줄바꿈·BOM, 머리글 이름 정리, 형식 감지', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","줄\n바꿈"\r\n"say ""hi""",\r\n'), [['a', 'b'], ['x, y', '줄\n바꿈'], ['say "hi"', '']]);
  const t = csvTable('이름,,이름\n1,2,3\n');
  assert.deepEqual(t.headers, ['이름', '필드 2', '이름 (2)']);
  assert.equal(inferType(['1', '2.5', '-3', '1,000']), 'n');
  assert.equal(inferType(['https://a.example', 'http://b.example/x']), 'h');
  assert.equal(inferType(['SNS', 'IM', 'SNS', 'IM, SNS', 'IM']), 's');
  assert.equal(inferType(['가', '나', '다', '라']), 't');
  assert.equal(inferType(['2025-01-02', '2025-03-04']), 't', '날짜는 감지하지 않는다');
});

test('가져오기: 전체 교체 · 새 필드로 추가 · 기존 필드에 맞춰 행 추가', () => {
  let n = 0; const newId = () => `id${++n}`;
  const table = csvTable('Name,Kind,Count,Url\nA,SNS,1,https://a.example\nB,IM,2,\nC,SNS,3,\nD,IM,4,\nE,NEW,5,\n');
  const replaced = importCsv(data(), table, 'replace', { newId });
  assert.deepEqual(replaced.fields.map((f) => [f.name, f.type]), [['Name', 't'], ['Kind', 's'], ['Count', 'n'], ['Url', 'h']]);
  assert.equal(replaced.rows.length, 5);
  assert.equal(replaced.rows[0].cells[replaced.fields[2].id], 1);
  assert.deepEqual(replaced.rows[0].cells[replaced.fields[3].id], [{ u: 'https://a.example' }]);
  assert.equal(replaced.views[0].filter, null); assert.deepEqual(replaced.views[0].hiddenFields, []);

  const added = importCsv(data(), table, 'newFields', { newId });
  assert.equal(added.fields.length, 8); assert.equal(added.rows.length, 5, '기존 3행 오른쪽에 채우고 2행은 아래에 추가');
  assert.equal(added.rows[0].cells.f1, 'Weibo, "국제"', '기존 값은 그대로');

  const base = data();
  const map = suggestMapping(base, ['이름', 'Kind', '수']);
  assert.deepEqual(map, ['f1', '', 'f3']);
  const appended = importCsv(base, csvTable('이름,분류,수\nTelegram,"IM, 새 분류",7\n'), 'append', { mapping: ['f1', 'f2', 'f3'], newId });
  const last = appended.rows.at(-1);
  assert.equal(appended.rows.length, 4); assert.equal(last.cells.f1, 'Telegram'); assert.equal(last.cells.f3, 7);
  const kinds = appended.fields.find((f) => f.id === 'f2');
  assert.deepEqual(last.cells.f2.map((id) => kinds.options.find((o) => o.id === id).label), ['IM', '새 분류'], '없는 선택지는 만든다');
  assert.equal(base.rows.length, 3, '원래 데이터는 바꾸지 않는다');
  assert.throws(() => importCsv(base, table, 'x'), /알 수 없는/);
});

test('PDF: JPEG 한 장을 담은 올바른 구조(xref 위치가 실제 객체 위치와 일치)', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf(jpeg, 400, 200);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/MediaBox \[0 0 300 150\]/);
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(startxref).startsWith('xref'));
  const offs = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `객체 ${i + 1} 위치`));
  assert.ok(pdf.includes(0xd9));
});

test('uid: randomUUID가 없는 환경(http)에서도 UUID v4 형식', async () => {
  const { uid } = await import('../web/src/database-io.mjs');
  const orig = crypto.randomUUID;
  try {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    const a = uid(), b = uid();
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.notEqual(a, b);
  } finally { Object.defineProperty(crypto, 'randomUUID', { value: orig, configurable: true }); }
});
