import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcOptions, calculate, viewRows } from '../web/src/database-model.mjs';
import { validateDatabase } from '../server/src/database-edit.mjs';
import { searchRows } from '../web/src/database-io.mjs';

const data = () => ({
  fields: [{ id: 't', name: '이름', type: 't' }, { id: 'n', name: '금액', type: 'n' }, { id: 's', name: '분류', type: 's', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
  rows: [
    { id: '1', cells: { t: '사과', n: 10, s: ['a'] } },
    { id: '2', cells: { t: '배', n: 2.5, s: ['b'] } },
    { id: '3', cells: { t: '감', n: '7', s: ['a'] } },
    { id: '4', cells: { t: '', s: ['a'] } },
  ],
  views: [{ id: 'v', name: '표', type: 'table', hiddenFields: [], sort: [], calculations: { n: 'sum', t: 'empty' } }],
});

test('열 형식에 맞는 계산만 고를 수 있다', () => {
  assert.deepEqual(calcOptions({ type: 't' }), ['count', 'empty', 'filled']);
  assert.deepEqual(calcOptions({ type: 'n' }), ['count', 'empty', 'filled', 'sum', 'avg', 'min', 'max']);
  assert.equal(calculate('sum', { id: 't', type: 't' }, data().rows), null);
});

test('합계·평균·최소·최대·개수·빈칸·채운 칸', () => {
  const d = data(), n = d.fields[1], t = d.fields[0];
  assert.equal(calculate('sum', n, d.rows), '19.5');
  assert.equal(calculate('avg', n, d.rows), '6.5');
  assert.equal(calculate('min', n, d.rows), '2.5');
  assert.equal(calculate('max', n, d.rows), '10');
  assert.equal(calculate('count', n, d.rows), '4');
  assert.equal(calculate('empty', n, d.rows), '1');
  assert.equal(calculate('filled', t, d.rows), '3');
  assert.equal(calculate('avg', n, []), '—');
});

test('필터·검색 결과 기준으로 계산', () => {
  const d = data(), n = d.fields[1];
  const filtered = viewRows(d, { ...d.views[0], filter: { t: 'eq', f: 's', v: ['a'] } });
  assert.equal(calculate('sum', n, filtered), '17');
  assert.equal(calculate('avg', n, filtered), '8.5');
  const found = searchRows(d.rows, d.fields, '사과', (r, f) => r.cells[f.id], {});
  assert.equal(calculate('sum', n, found), '10');
});

test('계산 설정 저장 검증', () => {
  assert.doesNotThrow(() => validateDatabase(data(), data()));
  const stale = data(); stale.views[0].calculations = { missing: 'count' };
  assert.doesNotThrow(() => validateDatabase(stale, data()));
  for (const bad of [{ n: 'median' }, ['sum'], 'sum']) {
    const d = data(); d.views[0].calculations = bad;
    assert.throws(() => validateDatabase(d, data()));
  }
});
