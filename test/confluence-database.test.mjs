import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeDatabase, fetchDatabase } from '../scripts/lib/confluence-database.mjs';
import { decodeCanvas } from '../scripts/research/canvas-decode.mjs';
import { viewRows, databaseValue } from '../web/src/database-model.mjs';
const ids = ['943521921','120422433','135694426','1103429634','47614020'];
for (const id of ids) test(`원본 ${id}: 행·열·보기 순서와 모든 값 보존`, () => {
  const buf = readFileSync(new URL(`./fixtures/database-${id}.ybin`, import.meta.url));
  const raw = decodeCanvas(buf), data = normalizeDatabase(buf);
  assert.deepEqual(data.fields.map(f => f.id), raw.f);
  assert.deepEqual(data.rows.map(r => r.id), raw.e);
  assert.deepEqual(data.views.map(v => v.id), raw.v);
  for (const r of data.rows) for (const [field, c] of Object.entries(raw.ebi[r.id])) assert.deepEqual(r.cells[field], c?.v ?? null);
  assert.equal(data.rows.length, Object.keys(raw.ebi).length);
});
const load = id => normalizeDatabase(readFileSync(new URL(`./fixtures/database-${id}.ybin`, import.meta.url)));
test('선택 필터·정렬 및 숨김 열·보드 그룹·카드 설정', () => {
  const data = load('120422433');
  const view = data.views.find(v => v.name === 'Indonesia');
  const result = viewRows(data, view);
  assert.ok(result.length > 0 && result.length < data.rows.length);
  const country = data.fields.find(f => f.name === 'Country');
  const indonesia = country.options.find(o => o.label === 'Indonesia').id;
  assert.ok(result.every(r => r.cells[country.id].includes(indonesia)));
  const board = load('135694426').views.find(v => v.type === 'board');
  assert.ok(board.groupBy); assert.ok(board.hiddenFields.length > 0);
  const gallery = load('1103429634');
  const video = viewRows(gallery, gallery.views.find(v => v.name === 'Video'));
  assert.ok(video.length > 0 && video.length < gallery.rows.length);
  assert.ok(gallery.views[0].coverField);
  const jid = load('47614020').fields.find(f => f.type === 'jid');
  assert.ok(jid.issueField && jid.jiraField);
});
test('GET 전용 수집·바이너리 보관, 접근 토큰 저장 금지', async () => {
  const binary = readFileSync(new URL('./fixtures/database-943521921.ybin', import.meta.url));
  const result = await fetchDatabase('123', {
    site: 'https://example.test',
    get: async path => path.includes('tenant_info') ? { cloudId: 'cloud' } : path.includes('session/bulk') ? [{ data: { access: { token: 'secret-test' } } }] : { referenceId: 'ref' },
    fetchImpl: async (url, options) => {
      assert.ok(url.includes('database%2Fref')); assert.equal(options.method, undefined);
      assert.equal(options.headers['x-access-token'], 'secret-test');
      return new Response(binary);
    },
  });
  assert.deepEqual(result.binary, binary);
  assert.ok(!JSON.stringify(result.data).includes('secret-test'));
});

test('Jira 파생 필드는 연결한 이슈의 Gira 최신 값과 버전 배열을 표시한다', () => {
  const data = load('47614020'), row = data.rows[0];
  const field = data.fields.find(f => f.jiraField === 'status');
  const key = row.cells[field.issueField][0].k;
  assert.deepEqual(databaseValue(row, field, { [key]: { status: '완료' } }), ['완료']);
  assert.deepEqual(databaseValue(row, field, {}), []);
  assert.deepEqual(databaseValue(row, { ...field, jiraField: 'fixVersions' }, { [key]: { fixVersions: ['1.0', '2.0'] } }), ['1.0', '2.0']);
});
