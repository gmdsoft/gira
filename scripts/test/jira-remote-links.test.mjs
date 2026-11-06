import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteLinkRow, syncRemoteLinks } from '../lib/jira-remote-links.mjs';
import { confluencePageId, remoteLinkView } from '../../server/src/jira-remote-links.mjs';
import { jiraGet } from '../lib/jira-source-get.mjs';
const link = { id: 12, object: { title: '합성 문서', url: 'https://docs.example/wiki/pages/viewpage.action?pageId=42', icon: { url16x16: 'https://docs.example/icon.png' } }, application: { type: 'com.atlassian.confluence', name: 'Confluence' }, relationship: 'mentioned in' };
test('원격 링크 응답을 메타데이터와 함께 변환', () => {
  assert.deepEqual(remoteLinkRow(1, link), [1, link.object.url, '합성 문서', '12', 'com.atlassian.confluence', 'Confluence', 'mentioned in', link.object.icon.url16x16]);
  assert.throws(() => remoteLinkRow(1, {}));
});
test('pageId 추출과 Gonfluence 주소, 원본 보존', () => {
  assert.equal(confluencePageId(link.object.url), '42');
  for (const url of ['bad', 'https://example/?pageId=abc', 'https://example/']) assert.equal(confluencePageId(url), null);
  const row = { url: link.object.url, app_type: link.application.type };
  assert.equal(remoteLinkView(row, 'https://gon.example/').open_url, 'https://gon.example/wiki/pages/viewpage.action?pageId=42');
  assert.equal(remoteLinkView(row).open_url, row.url);
  assert.equal(remoteLinkView({ ...row, app_type: 'other' }, 'https://gon.example').open_url, row.url);
});
test('반복 동기화 upsert와 삭제 범위, 동시 6 제한', async () => {
  const stored = new Map(); let active = 0, max = 0;
  const get = async () => { active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 1)); active--; return [link]; };
  const query = async (sql, values) => {
    if (sql.startsWith('INSERT')) {
      assert.match(sql, /ON CONFLICT \(source_id\) DO UPDATE/);
      stored.set(values[3], values);
    } else { assert.match(sql, /source_id IS NOT NULL/); }
  };
  await syncRemoteLinks([{ id: 1 }], { get, query });
  await syncRemoteLinks([{ id: 1 }], { get: async () => [{ ...link, object: { ...link.object, title: '수정' } }], query });
  assert.equal(stored.size, 1); assert.equal(stored.get('12')[2], '수정');
  await syncRemoteLinks(Array.from({ length: 14 }, (_, id) => ({ id })), { get, query });
  assert.equal(max, 6);
});
test('실패한 조회는 삭제하지 않고 빈 응답은 원본 링크만 정리', async () => {
  let calls = 0;
  await assert.rejects(syncRemoteLinks([{ id: 1 }], { get: async () => { throw Error('failed'); }, query: async () => calls++ }));
  assert.equal(calls, 0);
  await syncRemoteLinks([{ id: 1 }], { get: async () => [], query: async (sql, values) => { assert.match(sql, /source_id IS NOT NULL/); assert.deepEqual(values, [1, []]); } });
});
test('GET만 사용하고 429 Retry-After 재시도', async () => {
  const waits = []; let attempts = 0;
  const get = jiraGet('https://jira.example', 'synthetic', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://jira.example/rest/api/3/issue/1/remotelink');
      assert.ok(options.method == null || options.method === 'GET');
      return attempts++ === 0 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : Response.json([link]);
    }, sleep: async ms => waits.push(ms),
  });
  assert.deepEqual(await get('/rest/api/3/issue/1/remotelink'), [link]);
  assert.deepEqual(waits, [2000]); assert.equal(attempts, 2);
});
