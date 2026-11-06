import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adfPageLink } from '../../server/src/adf-page-links.mjs';
import { remoteLinkView } from '../../server/src/jira-remote-links.mjs';
const options = { publicBase: 'https://docs.example', internalBase: 'http://gonfluence:3001', headers: { cookie: 'gmd_sid=synthetic' } };
test('사용자 인증으로 로컬 문서 제목 조회, 원본 URL 보존 및 공통 매핑', async () => {
  const raw = 'https://gmdsoft.atlassian.net/wiki/spaces/TEST/pages/123/Title';
  const result = await adfPageLink(raw, { ...options, fetchImpl: async (url, init) => {
    assert.equal(url, 'http://gonfluence:3001/api/content/123');
    assert.deepEqual(init.headers, options.headers);
    assert.equal(init.redirect, 'error');
    assert.ok(!init.method || init.method === 'GET');
    return Response.json({ title: '합성 문서' });
  } });
  assert.deepEqual(result, { href: 'https://docs.example/wiki/pages/viewpage.action?pageId=123', title: '합성 문서' });
  const remote = remoteLinkView({ url: raw, app_type: 'com.atlassian.confluence' }, options.publicBase);
  assert.equal(remote.open_url, result.href); assert.equal(remote.url, raw);
});
test('권한 없음/미이관/연결 실패는 제목 없이 Gonfluence 리디렉트 링크', async () => {
  for (const fetchImpl of [async () => new Response('', { status: 403 }), async () => new Response('', { status: 404 }), async () => { throw Error('offline'); }]) {
    assert.deepEqual(await adfPageLink('https://gmdsoft.atlassian.net/wiki/x/3QCnAQ', { ...options, fetchImpl }), { href: 'https://docs.example/wiki/x/3QCnAQ' });
  }
  assert.equal(await adfPageLink('https://example.org/wiki/x/abc', { ...options, fetchImpl: () => assert.fail('외부 주소 조회 금지') }), null);
});

test('화이트보드·데이터베이스·임베드·편집 주소도 문서 id로 (GIRA-70)', async () => {
  const { sourceLink } = await import('../../server/src/adf-source-links.mjs');
  for (const [u, id] of [['https://gmdsoft.atlassian.net/wiki/spaces/MDX/whiteboard/315883918', '315883918'], ['https://gmdsoft.atlassian.net/wiki/spaces/MDX/database/943521921', '943521921'], ['https://gmdsoft.atlassian.net/wiki/spaces/X/pages/edit-v2/777', '777']]) {
    assert.equal(sourceLink(u)?.id, id);
  }
});
