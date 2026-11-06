import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerGiraCards } from '../src/gira-cards.mjs';
import { generateHTML, generateJSON } from '@tiptap/html';
import { extensions } from '../../web/src/extensions.js';

test('이슈 카드는 키만 저장하며 HTML 왕복 후에도 Gira 링크를 유지한다', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'jiraIssue', attrs: { key: 'NEXT-123' } }] }] };
  const html = generateHTML(doc, extensions);
  assert.match(html, /href="\/api\/gira\/issues\/NEXT-123\/open"/);
  assert.match(html, /data-issue-key="NEXT-123"/);
  const restored = generateJSON(html, extensions);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.content[0].content[0])), doc.content[0].content[0]);
});

test('조회자 인증 전달, 최신 상태 재조회, 비공개·오류 시 키만 반환, Gira 이동', async (t) => {
  const app = Fastify();
  await app.register(cookie);
  registerGiraCards(app, { giraUrl: 'https://gira.example/' });
  t.after(() => app.close());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let status = '진행 중';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://gira.example/api/issue/NEXT-123');
    assert.equal(options.headers.cookie, 'gmd_sid=test-session');
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ summary: '테스트 제목', status_name: status, description: '노출하지 않을 상세' });
  };
  const request = () => app.inject({ url: '/api/gira/issues/NEXT-123', headers: { cookie: 'gmd_sid=test-session' } });
  const first = await request();
  assert.equal(first.headers['cache-control'], 'private, no-store');
  assert.deepEqual(first.json(), { key: 'NEXT-123', summary: '테스트 제목', status: '진행 중' });
  status = '완료';
  assert.equal((await request()).json().status, '완료');
  assert.equal(calls, 2);
  for (const code of [401, 403, 404, 500]) {
    globalThis.fetch = async () => Response.json({ summary: '비공개 제목' }, { status: code });
    assert.deepEqual((await request()).json(), { key: 'NEXT-123' });
  }
  globalThis.fetch = async () => { throw new Error('timeout'); };
  assert.deepEqual((await request()).json(), { key: 'NEXT-123' });
  assert.equal((await app.inject('/api/gira/issues/invalid')).statusCode, 400);
  const redirect = await app.inject('/api/gira/issues/NEXT-123/open');
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, 'https://gira.example/browse/NEXT-123');
});

test('슬래시 이슈 명령은 정규화한 키를 삽입하고 취소·잘못된 입력은 보존한다', async (t) => {
  const { makeSlashItems } = await import('../../web/src/slash-menu.js');
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  let input = ' next-123 ';
  let inserted;
  let deleted = false;
  const chain = {
    focus() { return this; },
    deleteRange() { deleted = true; return this; },
    insertContent(content) { inserted = content; return this; },
    run() { return true; },
  };
  globalThis.window = { prompt: () => input, alert: () => {} };
  const item = makeSlashItems({}).find((item) => item.label === '이슈');
  item.run({ chain: () => chain }, { from: 1, to: 4 });
  assert.deepEqual(inserted[0], { type: 'jiraIssue', attrs: { key: 'NEXT-123' } });
  for (input of [null, '', 'not a key']) {
    deleted = false;
    item.run({ chain: () => chain }, {});
    assert.equal(deleted, false);
  }
});
