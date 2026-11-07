import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { generateHTML } from '@tiptap/html';
import { convertStorage } from '../../scripts/convert-storage.mjs';
import { extensions, editExtensions } from '../src/extensions.js';
import { safeEmbedUrl, isolatedHtml } from '../../shared/html-embed.mjs';

const macro = (name, body) => `<ac:structured-macro ac:name="${name}">${body}</ac:structured-macro>`;
const hmp = (body, height = '1024px') => `<ac:adf-extension><ac:adf-node type="extension"><ac:adf-attribute key="extension-key">app/hmpcost-html-macro-pro</ac:adf-attribute><ac:adf-attribute key="parameters"><ac:adf-parameter key="guest-params"><ac:adf-parameter key="body">${body}</ac:adf-parameter><ac:adf-parameter key="height">${height}</ac:adf-parameter></ac:adf-parameter></ac:adf-attribute></ac:adf-node></ac:adf-extension>`;
function checked(xhtml) {
  const { doc } = convertStorage(xhtml);
  for (const exts of [extensions, editExtensions]) getSchema(exts).nodeFromJSON(doc).check();
  return { doc, html: generateHTML(doc, extensions) };
}

test('HTML Macro Pro는 UTF-8 전체 HTML·스크립트·원본 높이를 보존한다', () => {
  const source = '<!doctype html><html><body><canvas></canvas><script>document.body.append("차트");</script></body></html>';
  const { doc, html } = checked(hmp(Buffer.from(source).toString('base64')));
  assert.equal(doc.content[0].attrs.html, source);
  assert.equal(doc.content[0].attrs.height, 1024);
  assert.match(html, /srcdoc=/);
  assert.match(html, /allow-scripts allow-popups allow-popups-to-escape-sandbox/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /height="1024"/);
  assert.ok(isolatedHtml(source).startsWith('<!doctype html><meta'));
});

test('구형 html은 CDATA를 보존하고 문단 안에서도 블록 스키마를 만족한다', () => {
  const source = '<iframe src="https://www.figma.com/embed"></iframe><table><tr><td>서명</td></tr></table>';
  const { doc } = checked(`<p>앞${macro('html', `<ac:plain-text-body><![CDATA[${source}]]></ac:plain-text-body>`)}뒤</p>`);
  assert.deepEqual(doc.content.map(n => n.type), ['paragraph', 'htmlEmbed', 'paragraph']);
  assert.equal(doc.content[1].attrs.html, source);
  assert.equal(doc.content[1].attrs.height, 400);
});

test('iframe은 ri:url과 크기를 보존하며 폭은 100%로 표시한다', () => {
  const { doc, html } = checked(macro('iframe', '<ac:parameter ac:name="src"><ri:url ri:value="https://www.notion.so/example"/></ac:parameter><ac:parameter ac:name="height">1000px</ac:parameter><ac:parameter ac:name="width">120%</ac:parameter>'));
  assert.equal(doc.content[0].attrs.source, 'iframe');
  assert.equal(doc.content[0].attrs.width, '120%');
  assert.match(html, /src="https:\/\/www.notion.so\/example"/);
  assert.match(html, /width="100%" height="1000"/);
});

test('잘못된 base64/UTF-8은 실행하거나 예외를 발생시키지 않는다', () => {
  for (const value of ['bad!!', 'abcd=', '/w==']) {
    assert.equal(checked(hmp(value)).doc.content[0].attrs.html, '');
  }
});

test('javascript 및 비공개·현재 서비스 URL을 변환과 렌더 모두에서 거부한다', () => {
  for (const src of ['javascript:alert(1)', 'data:text/html,hello', '/api/pages', 'http://127.0.0.1', 'http://172.21.1.1:3001', 'http://[::1]', 'https://intranet', 'https://app.local']) {
    assert.equal(safeEmbedUrl(src), null);
    assert.equal(checked(macro('iframe', `<ac:parameter ac:name="src">${src}</ac:parameter>`)).doc.content[0].attrs.src, null);
    const html = generateHTML({ type: 'doc', content: [{ type: 'htmlEmbed', attrs: { src } }] }, extensions);
    assert.doesNotMatch(html, /<iframe/);
  }
  assert.equal(safeEmbedUrl('https://docs.example.com/path', 'https://docs.example.com'), null);
});

test('srcdoc CSP는 첫 요소이며 API 연결·폼·base 변경을 차단한다', () => {
  const html = isolatedHtml('<script>fetch("/api/pages")</script>');
  assert.ok(html.startsWith('<meta http-equiv="Content-Security-Policy"'));
  for (const rule of ["connect-src 'none'", "form-action 'none'", "base-uri 'none'", "script-src https: 'unsafe-inline' 'unsafe-eval'"]) assert.ok(html.includes(rule));
});
