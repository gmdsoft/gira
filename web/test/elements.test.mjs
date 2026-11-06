import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { generateHTML, generateJSON } from '@tiptap/html';
import { extensions, editExtensions, ElementInputRules } from '../src/extensions.js';
import { decisionBlock, makeSlashItems } from '../src/slash-menu.js';
import { STATUS_COLORS } from '../src/inline-element-view.js';
import { convertStorage } from '../../scripts/convert-storage.mjs';
const schema = getSchema(editExtensions);
const p = { type: 'paragraph', content: [{ type: 'text', text: '결정 사항' }] };

test('결정 목록과 원본 Confluence 결정은 같은 모델과 보기로 보존된다', () => {
  const storage = '<ac:adf-node type="decision-list"><ac:adf-attribute key="local-id">list-id</ac:adf-attribute><ac:adf-node type="decision-item"><ac:adf-attribute key="state">DECIDED</ac:adf-attribute><ac:adf-content><p>결정 사항</p></ac:adf-content></ac:adf-node></ac:adf-node>';
  for (const source of [storage, `<ac:adf-extension>${storage}<ac:adf-fallback><p>중복되면 안 되는 폴백</p></ac:adf-fallback></ac:adf-extension>`]) {
    const { doc, stats } = convertStorage(source);
    schema.nodeFromJSON(doc).check();
    assert.deepEqual(stats.unsupportedMacros, {});
    assert.equal(doc.content[0].attrs.attrs['local-id'], 'list-id');
    assert.equal(doc.content[0].content[0].attrs.attrs.state, 'DECIDED');
    const expected = generateHTML({ type: 'doc', content: [decisionBlock([p])] }, extensions);
    assert.equal(generateHTML(doc, extensions), expected);
    const parsed = generateJSON(expected, extensions);
    assert.equal(parsed.content[0].attrs.adfType, 'decision-list');
    assert.equal(parsed.content[0].content[0].attrs.adfType, 'decision-item');
  }
});

test('패널 5종과 상태 10색, 날짜와 레이아웃 1~5열을 게시 모델로 직렬화한다', () => {
  for (const macro of ['info', 'note', 'tip', 'success', 'warning', 'error']) {
    const panelType = macro === 'tip' ? 'success' : macro;
    const { doc, stats } = convertStorage(`<ac:structured-macro ac:name="${macro}"><ac:rich-text-body><p>패널</p></ac:rich-text-body></ac:structured-macro>`);
    schema.nodeFromJSON(doc).check();
    assert.deepEqual(stats.unsupportedMacros, {});
    assert.equal(doc.content[0].attrs.panelType, panelType);
    assert.match(generateHTML(doc, extensions), new RegExp(`panel-${panelType}`));
    const inserted = { type: 'doc', content: [{ type: 'panel', attrs: { panelType }, content: [p] }] };
    assert.match(generateHTML(inserted, extensions), new RegExp(`panel-${panelType}`));
  }
  for (const color of STATUS_COLORS) {
    const { doc } = convertStorage(`<p><time datetime="2026-11-06"/><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">진행</ac:parameter><ac:parameter ac:name="colour">${color}</ac:parameter></ac:structured-macro></p>`);
    schema.nodeFromJSON(doc).check();
    assert.match(generateHTML(doc, extensions), new RegExp(`status-${color}`));
    assert.match(generateHTML(doc, extensions), /2026-11-06/);
  }
  const items = makeSlashItems({ openImageDialog() {} });
  for (let n = 1; n <= 5; n++) {
    let inserted;
    const chain = { focus() { return this; }, deleteRange() { return this; }, insertContent(doc) { inserted = doc; return this; }, run() { return true; } };
    items.find(i => i.label === `레이아웃 ${n}단`).run({ chain: () => chain }, { from: 1, to: 1 });
    schema.nodeFromJSON({ type: 'doc', content: [inserted] }).check();
    const html = generateHTML({ type: 'doc', content: [inserted] }, extensions);
    assert.equal((html.match(/class="layout-column"/g) || []).length, n);
  }
});

test('자동 변환은 커서 앞 텍스트만 교체하고 결정 안에 커서를 놓는다', () => {
  const rules = ElementInputRules.config.addInputRules();
  for (const [text, expected] of [['문장 ->', '문장 →'], ['인사 :)', '인사 🙂'], ['<>', '']]) {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
    const state = EditorState.create({ schema, doc });
    const tr = state.tr;
    const rule = rules.find(rule => rule.find.test(text));
    const match = rule.find.exec(text);
    rule.handler({ state: { schema, doc, tr }, range: { from: 1 + match.index, to: text.length + 1 }, match });
    tr.doc.check();
    assert.equal(tr.doc.textContent, expected);
    if (text === '<>') { assert.equal(tr.doc.firstChild.attrs.adfType, 'decision-list'); assert.equal(tr.selection.$from.parent.type.name, 'paragraph'); }
  }
});
