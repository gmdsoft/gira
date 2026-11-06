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

test('서식 있는 캡션과 이미지 링크·빈 대체 텍스트가 게시와 HTML 왕복에서 유지된다', () => {
  const { doc } = convertStorage('<p><ac:image><ri:url ri:value="/sample.png"/><ac:caption><p>샘플 <strong>굵게</strong> <em>기울임</em> <a href="https://example.org/caption">링크</a></p></ac:caption></ac:image></p>');
  const media = doc.content[0].content[0];
  media.attrs.href = 'https://example.org/image';
  media.attrs.alt = '';
  assert.equal(media.content[0].type, 'mediaCaption');
  assert.ok(media.content[0].content.some(n => n.marks?.some(m => m.type === 'bold')));
  getSchema(extensions).nodeFromJSON(doc).check();
  const html = generateHTML(doc, extensions);
  assert.match(html, /alt=""/);
  assert.match(html, /href="https:\/\/example.org\/image"/);
  assert.match(html, /<strong>굵게<\/strong>/);
  const parsed = generateJSON(html, extensions);
  const restored = parsed.content[0].content.find(n => n.type === 'media');
  assert.equal(restored.attrs.href, media.attrs.href);
  assert.equal(restored.content[0].type, 'mediaCaption');
  assert.ok(restored.content[0].content.some(n => n.marks?.some(m => m.type === 'link')));
});
test('기존 문자열 캡션과 안전하지 않은 이미지 링크를 처리한다', () => {
  const html = generateHTML(docFor({ src: '/sample.png', caption: '기존 캡션', href: 'javascript:alert(1)' }), extensions);
  assert.match(html, /class="media-legacy-caption">기존 캡션<\/span>/);
  assert.doesNotMatch(html, /<a /);
});

test('캡션 Enter는 이미지와 캡션을 보존하고 다음 문단으로 이동한다', async () => {
  const { EditorState, TextSelection } = await import('@tiptap/pm/state');
  const { MediaCaption } = await import('../src/image-caption.js');
  const schema = getSchema(extensions);
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'media', attrs: { src: '/a.png' }, content: [{ type: 'mediaCaption', content: [{ type: 'text', text: '캡션' }] }] }] }] });
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 4) });
  const editor = { get state() { return state; }, view: { dispatch(tr) { state = state.apply(tr); } } };
  const shortcuts = MediaCaption.config.addKeyboardShortcuts.call({ editor, name: 'mediaCaption' });
  assert.equal(shortcuts.Enter(), true);
  assert.equal(state.doc.childCount, 2);
  assert.equal(state.doc.firstChild.firstChild.firstChild.textContent, '캡션');
  assert.equal(state.selection.$from.parent.type.name, 'paragraph');
  assert.equal(state.selection.$from.index(0), 1);
});
test('캡션에서 문단 정렬과 제목 변경은 거부하고 글자 입력은 허용한다', async () => {
  const { EditorState, TextSelection } = await import('@tiptap/pm/state');
  const { MediaCaption } = await import('../src/image-caption.js');
  const schema = getSchema(extensions);
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'media', attrs: { src: '/a.png' }, content: [{ type: 'mediaCaption', content: [{ type: 'text', text: '캡션' }] }] }] }] });
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 4), plugins: MediaCaption.config.addProseMirrorPlugins() });
  assert.equal(state.apply(state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 })), state);
  assert.equal(state.apply(state.tr.setNodeMarkup(0, undefined, { textAlign: 'right' })), state);
  assert.match(state.apply(state.tr.insertText('추가')).doc.textContent, /추가/);
});
