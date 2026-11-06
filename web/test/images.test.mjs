import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHTML, generateJSON } from '@tiptap/html';
import { getSchema } from '@tiptap/core';
import { extensions } from '../src/extensions.js';
import { convertStorage } from '../../scripts/convert-storage.mjs';
const docFor = attrs => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'media', attrs }] }] });
test('이미지 폭·줄 바꿈·테두리는 보기와 복사 왕복에서 보존된다', () => {
  for (const layout of ['wrap-left', 'wrap-right', 'center', 'align-start', 'align-end']) {
    const attrs = { src: '/sample.png', filename: 'sample.png', width: 950, layout, border: true, borderColor: '#44546F', borderWidth: 4 };
    const doc = docFor(attrs);
    const html = generateHTML(doc, extensions);
    assert.match(html, /width="950"/);
    assert.match(html, /media-breakout/);
    assert.match(html, new RegExp(`media-layout-${layout}`));
    const mediaNode = getSchema(extensions).nodeFromJSON(doc).firstChild.firstChild;
    assert.match(mediaNode.type.spec.toDOM(mediaNode)[2][1].style, /border: 4px solid/);
    const parsed = generateJSON(html, extensions);
    const media = parsed.content.flatMap(p => p.content || []).find(n => n.type === 'media');
    for (const [key,value] of Object.entries(attrs)) assert.equal(media.attrs[key], value);
  }
});
test('이관 이미지 기존 속성과 기본 테두리를 유지한다', () => {
  const { doc } = convertStorage('<p><ac:image ac:width="836" ac:align="right" ac:layout="align-end" ac:border="true" ac:alt="설명"><ri:url ri:value="https://example.org/a.png"/><ac:caption>캡션</ac:caption></ac:image></p>');
  getSchema(extensions).nodeFromJSON(doc).check();
  const html = generateHTML(doc, extensions);
  assert.match(html, /width="836"/);
  assert.match(html, /media-right/);
  assert.match(html, /media-layout-align-end/);
  const mediaNode = getSchema(extensions).nodeFromJSON(doc).firstChild.firstChild;
  assert.match(mediaNode.type.spec.toDOM(mediaNode)[2][1].style, /border: 1px solid/);
  assert.match(html, /alt="설명"/);
  assert.match(html, /캡션/);
});
