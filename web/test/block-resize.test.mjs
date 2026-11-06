import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHTML, generateJSON } from '@tiptap/html';
import { extensions } from '../src/extensions.js';

test('블록 폭과 레이아웃 열 비율이 HTML 왕복에서 유지된다', () => {
  const p = { type: 'paragraph' };
  for (const type of ['codeBlock', 'expand', 'layout']) {
    const content = type === 'codeBlock' ? [{ type: 'text', text: 'hello' }] : type === 'expand' ? [p] : [{ type: 'layoutSection', attrs: { kind: 'two_equal' }, content: [5, 95].map(width => ({ type: 'layoutColumn', attrs: { width }, content: [p] })) }];
    const doc = { type: 'doc', content: [{ type, attrs: { blockWidth: 1050 }, content }] };
    const html = generateHTML(doc, extensions);
    assert.match(html, /data-block-width="1050"/);
    const restored = generateJSON(html, extensions).content[0];
    assert.equal(restored.attrs.blockWidth, 1050);
    if (type === 'layout') assert.deepEqual(restored.content[0].content.map(c => c.attrs.width), [5, 95]);
  }
});

test('원본 레이아웃 열 폭을 변환하고 비율을 보존한다', async () => {
  const { convertStorage } = await import('../../scripts/convert-storage.mjs');
  const { doc } = convertStorage('<ac:layout ac:width="1050"><ac:layout-section ac:type="two_equal"><ac:layout-cell ac:width="30"><p>A</p></ac:layout-cell><ac:layout-cell ac:width="70"><p>B</p></ac:layout-cell></ac:layout-section></ac:layout>');
  assert.equal(doc.content[0].attrs.blockWidth, 1050);
  assert.deepEqual(doc.content[0].content[0].content.map(c => c.attrs.width), [30, 70]);
});
