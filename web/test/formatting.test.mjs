import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { generateHTML, generateJSON } from '@tiptap/html';
import { extensions, editExtensions, ConfluenceShortcuts } from '../src/extensions.js';
import { convertStorage } from '../../scripts/convert-storage.mjs';

const schema = getSchema(editExtensions);
test('원본 글자색과 배경 강조색을 독립적으로 보존하고 게시한다', () => {
  const { doc } = convertStorage('<p><span style="background-color: #fff0b3">강조</span><span style="color: #164b9f; background-color: #baf3db">둘 다</span><small>작게</small><sub>아래</sub><sup>위</sup></p>');
  schema.nodeFromJSON(doc).check();
  const texts = doc.content[0].content;
  assert.deepEqual(texts[0].marks, [{ type: 'highlight', attrs: { color: '#fff0b3' } }]);
  assert.equal(texts[1].marks.length, 2);
  const html = generateHTML(doc, extensions);
  // zeed-dom의 cssText 직렬화 제한과 별개로 브라우저 렌더러가 받는 스타일을 검증한다.
  const node = schema.nodeFromJSON(doc);
  const highlight = node.firstChild.firstChild.marks[0];
  assert.equal(highlight.type.spec.toDOM(highlight)[1].style, 'background-color: #fff0b3; color: inherit');
  const color = node.firstChild.child(1).marks.find(m => m.type.name === 'textColor');
  assert.equal(color.type.spec.toDOM(color)[1].style, 'color: #164b9f');
  assert.match(html, /<small>작게<\/small>/);
  assert.match(html, /<sub>아래<\/sub>/);
  assert.match(html, /<sup>위<\/sup>/);
  const parsed = generateJSON('<p><mark style="background-color: #fff0b3">강조</mark><span style="color: #164b9f; background-color: #baf3db">둘 다</span></p>', extensions);
  const marks = parsed.content[0].content[1].marks;
  assert.ok(marks.some(m => m.type === 'textColor' && m.attrs.color === '#164b9f'));
  assert.ok(marks.some(m => m.type === 'highlight' && m.attrs.color === '#baf3db'));
});
test('서식과 중첩 작업 목록은 편집 및 보기 스키마에서 직렬화된다', () => {
  const text = { type: 'text', text: '서식', marks: ['bold', 'italic', 'underline', 'strike', 'smallText'].map(type => ({ type })) };
  const p = { type: 'paragraph', content: [text] };
  const doc = { type: 'doc', content: [
    ...Array.from({ length: 6 }, (_, i) => ({ type: 'heading', attrs: { level: i + 1 }, content: [text] })),
    { type: 'blockquote', content: [p] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p,
      { type: 'taskList', content: [{ type: 'taskItem', content: [p] }] }] }] },
  ] };
  schema.nodeFromJSON(doc).check();
  const html = generateHTML(doc, extensions);
  assert.match(html, /<h6>/);
  assert.match(html, /<blockquote>/);
  assert.equal((html.match(/class="task-list"/g) || []).length, 2);
});
test('목록 Tab 단축키는 현재 목록 항목 종류에 맞는 명령을 호출한다', () => {
  for (const task of [false, true]) {
    const calls = [];
    const editor = { isActive: () => task, commands: {
      sinkListItem: type => { calls.push(['sink', type]); return true; },
      liftListItem: type => { calls.push(['lift', type]); return true; },
    } };
    const keys = ConfluenceShortcuts.config.addKeyboardShortcuts.call({ editor });
    keys.Tab(); keys['Shift-Tab']();
    assert.deepEqual(calls, [['sink', task ? 'taskItem' : 'listItem'], ['lift', task ? 'taskItem' : 'listItem']]);
  }
});

test('작업 목록 들여쓰기와 내어쓰기가 내용과 체크 상태를 유지한다', async () => {
  const { EditorState, TextSelection } = await import('@tiptap/pm/state');
  const { sinkListItem, liftListItem } = await import('@tiptap/pm/schema-list');
  const p = text => schema.nodes.paragraph.create(null, schema.text(text));
  const item = (text, checked) => schema.nodes.taskItem.create({ checked }, p(text));
  const doc = schema.nodes.doc.create(null, schema.nodes.taskList.create(null, [item('첫째', true), item('둘째', false)]));
  let at;
  doc.descendants((node, pos) => { if (node.isText && node.text === '둘째') at = pos; });
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) });
  const dispatch = tr => { state = state.apply(tr); };
  assert.equal(sinkListItem(schema.nodes.taskItem)(state, dispatch), true);
  state.doc.check();
  assert.equal(state.doc.firstChild.childCount, 1);
  assert.equal(state.doc.firstChild.firstChild.attrs.checked, true);
  assert.equal(liftListItem(schema.nodes.taskItem)(state, dispatch), true);
  state.doc.check();
  assert.equal(state.doc.firstChild.childCount, 2);
  assert.equal(state.doc.textContent, '첫째둘째');
});
