import test from 'node:test';
import assert from 'node:assert/strict';
import { linkParts, linkifyDoc, textToAdf } from '../../server/src/linkify.mjs';

test('주소를 링크로, 끝 문장부호·짝 없는 괄호는 뺀다', () => {
  assert.deepEqual(linkParts('참고: https://example.com/a?b=1.'), [
    { text: '참고: ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: '.' }]);
  assert.deepEqual(linkParts('(www.naver.com)').map((p) => p.href ?? null), [null, 'https://www.naver.com', null]);
  assert.deepEqual(linkParts('https://en.wikipedia.org/wiki/A_(b)').map((p) => p.text), ['https://en.wikipedia.org/wiki/A_(b)']);
  assert.deepEqual(linkParts('링크 없음'), [{ text: '링크 없음' }]);
});

test('문서: 링크·코드 표시가 있는 글자와 코드 블록은 그대로', () => {
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '보기 http://a.com 끝' }, { type: 'text', text: 'http://b.com', marks: [{ type: 'code' }] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'http://c.com' }] },
  ] };
  const out = linkifyDoc(doc);
  const p = out.content[0].content;
  assert.equal(p[1].marks[0].attrs.href, 'http://a.com');
  assert.deepEqual(p[3].marks, [{ type: 'code' }]);
  assert.equal(out.content[1].content[0].marks, undefined);
});

test('Gira 입력 글 → ADF: 줄마다 문단, 주소는 link 표시', () => {
  const adf = textToAdf('첫 줄\nPR: https://github.com/x/y/pull/1');
  assert.equal(adf.content.length, 2);
  const link = adf.content[1].content.find((n) => n.marks);
  assert.equal(link.marks[0].type, 'link');
  assert.equal(link.marks[0].attrs.href, 'https://github.com/x/y/pull/1');
});
