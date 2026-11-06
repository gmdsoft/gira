import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { generateHTML } from '@tiptap/html';
import { createHTMLDocument } from 'zeed-dom';
import { extensions } from '../src/extensions.js';
import { makeSlashItems } from '../src/slash-menu.js';

// 오프라인 DOM에 이벤트 등록만 보완해 실제 목차 클릭 핸들러를 확인한다.
test('슬래시 목차 삽입, 게시 직렬화, 제목 갱신과 이동', () => {
  const previous = globalThis.document;
  const document = createHTMLDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (...args) => {
    const el = createElement(...args);
    el.addEventListener = (type, handler) => { el[type] = handler; };
    return el;
  };
  globalThis.document = document;
  try {
    let inserted;
    const chain = { focus() { return this; }, deleteRange() { return this; },
      insertContent(value) { inserted = value; return this; }, run() { return true; } };
    makeSlashItems({}).find((item) => item.label === '목차').run({ chain: () => chain }, { from: 1, to: 4 });
    assert.equal(inserted.attrs.name, 'toc');
    const schema = getSchema(extensions);
    const makeDoc = (text) => schema.nodeFromJSON({ type: 'doc', content: [inserted,
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] }] });
    const editor = { isEditable: true, state: { doc: makeDoc('처음 제목') },
      on(event, handler) { this.refresh = handler; }, off(event, handler) { assert.equal(handler, this.refresh); },
      view: { nodeDOM(pos) { assert.equal(pos, 2); return { scrollIntoView() { moved = true; } }; } } };
    let moved = false;
    const macro = extensions.find((ext) => ext.name === 'cfMacro');
    const view = macro.config.addNodeView()({ node: editor.state.doc.firstChild, editor });
    assert.match(view.dom.textContent, /처음 제목/);
    editor.state.doc = makeDoc('바뀐 <제목>');
    editor.refresh();
    assert.match(view.dom.textContent, /바뀐 <제목>/);
    assert.doesNotMatch(view.dom.textContent, /처음 제목/);
    view.dom.querySelector('a').click({ preventDefault() {} });
    assert.equal(moved, true);
    const html = generateHTML(editor.state.doc.toJSON(), extensions);
    assert.match(html, /data-macro="toc"/);
    assert.match(html, /<h2>바뀐 &lt;제목&gt;<\/h2>/);
    view.destroy();
  } finally { globalThis.document = previous; }
});
