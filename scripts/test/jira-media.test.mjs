import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaLocation, fetchMediaId, fillMediaIds } from '../lib/jira-media.mjs';
const uuid = '4ff455ab-1234-1234-1234-123456789abc';
const location = `https://api.media.atlassian.com/file/${uuid}/binary?token=secret`;
test('Location은 정확한 호스트와 UUID 경로만 허용', () => {
  assert.equal(parseMediaLocation(location), uuid);
  for (const s of [null, '/file/a/binary', location.replace('https:', 'http:'), location.replace('atlassian.com', 'atlassian.com.evil'), location.replace(uuid, 'bad')]) assert.equal(parseMediaLocation(s), null);
});
test('GET manual, 본문 취소, 429/5xx 재시도', async () => {
  let calls = 0, cancelled = 0;
  const result = await fetchMediaId(225313, { site: 'https://example.test', auth: 'test', sleep: async () => {}, fetchImpl: async (url, opts) => {
    assert.match(url, /attachment\/content\/225313$/);
    assert.equal(opts.method, 'GET'); assert.equal(opts.redirect, 'manual');
    const status = [429, 503, 303][calls++];
    return { status, headers: new Headers({ location }), body: { cancel: async () => { cancelled++; } } };
  } });
  assert.equal(result, uuid); assert.equal(cancelled, 3);
});
test('삭제된 첨부는 null, 권한 오류는 실패', async () => {
  const options = { site: 'https://example.test', auth: '', fetchImpl: async () => new Response(null, { status: 404 }) };
  assert.equal(await fetchMediaId(1, options), null);
  options.fetchImpl = async () => new Response(null, { status: 403 });
  await assert.rejects(fetchMediaId(1, options), /403/);
});
test('동시 요청은 최대 6이며 성공 행만 갱신', async () => {
  let active = 0, peak = 0, writes = 0;
  const result = await fillMediaIds(Array.from({ length: 15 }, (_, id) => ({ id })), {
    site: 'https://example.test', auth: '', query: async () => { writes++; },
    fetchImpl: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 1)); active--;
      return new Response(null, { status: 303, headers: { location } });
    },
  });
  assert.equal(peak, 6); assert.equal(writes, 15); assert.equal(result.failed, 0);
});
