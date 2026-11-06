import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { transformWithEsbuild } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { sourceLink, safeUrl, embedUrl } from '../src/jira/adf-links.js';
import { AdfBlockMarks, AdfTextMarks, PreservedAdf, PreservedAdfInline, PreservedMedia, PreservedMediaInline, adfToTiptap, tiptapToAdf } from '../src/jira/adf-convert.js';

const original = 'https://gmdsoft.atlassian.net';
test('원본 이슈/문서 주소 판정 및 안전한 임베드', () => {
  for (const path of ['/browse/TEST-12', '/jira/software/c/projects/TEST/issues/TEST-12', '/jira/software/c/projects/TEST/boards/1?selectedIssue=TEST-12']) {
    assert.deepEqual(sourceLink(original + path), { kind: 'issue', key: 'TEST-12', href: '/browse/TEST-12' });
  }
  for (const path of ['/wiki/spaces/TEST/pages/123/Title', '/wiki/pages/viewpage.action?pageId=123']) {
    assert.equal(sourceLink(original + path).path, '/wiki/pages/viewpage.action?pageId=123');
  }
  assert.equal(sourceLink(original + '/wiki/x/abc_12').path, '/wiki/x/abc_12');
  assert.equal(sourceLink('https://example.org/browse/TEST-12'), null);
  assert.equal(sourceLink('https://gmdsoft.atlassian.net.evil.org/browse/TEST-12'), null);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(embedUrl('https://www.figma.com/embed?embed_host=share&url=test'), 'https://www.figma.com/embed?embed_host=share&url=test');
  assert.equal(embedUrl('https://www.figma.com.evil.org/embed'), null);
  assert.equal(embedUrl('https://example.org/embed'), null);
});
const doc = { type: 'doc', version: 1, content: [
  { type: 'heading', attrs: { level: 2 }, marks: [{ type: 'alignment', attrs: { align: 'end' } }], content: [{ type: 'text', text: '제목' }] },
  { type: 'paragraph', marks: [{ type: 'alignment', attrs: { align: 'center' } }], content: [
    { type: 'text', text: '배경', marks: [{ type: 'backgroundColor', attrs: { color: '#ffeebb' } }] },
    { type: 'inlineCard', attrs: { url: original + '/browse/TEST-12' } },
  ] },
  { type: 'mediaSingle', content: [{ type: 'media', attrs: { type: 'external', url: 'https://example.org/image.png' }, marks: [{ type: 'border', attrs: { size: 3, color: '#123456' } }] }] },
  { type: 'blockCard', attrs: { url: original + '/wiki/spaces/TEST/pages/123/Title' } },
  { type: 'embedCard', attrs: { url: 'https://example.org/card' } },
  { type: 'embedCard', attrs: { url: 'https://www.figma.com/embed?url=test' } },
  { type: 'decisionList', attrs: { localId: 'synthetic-list' }, content: [{ type: 'decisionItem', attrs: { state: 'DECIDED', localId: 'synthetic-item' }, content: [{ type: 'text', text: '합성 결정' }] }] },
] };
test('실제 편집기 스키마를 거쳐 편집·저장해도 노드와 마크 보존', () => {
  const schema = getSchema([StarterKit, AdfBlockMarks, AdfTextMarks, PreservedAdf, PreservedAdfInline, PreservedMedia, PreservedMediaInline]);
  const editorDoc = schema.nodeFromJSON(adfToTiptap(doc));
  editorDoc.check();
  assert.deepEqual(tiptapToAdf(editorDoc.toJSON()), doc);
  const changed = editorDoc.toJSON();
  changed.content[0].content[0].text = '수정 제목';
  const expected = structuredClone(doc); expected.content[0].content[0].text = '수정 제목';
  assert.deepEqual(tiptapToAdf(schema.nodeFromJSON(changed).toJSON()), expected);
});
test('합성 ADF 렌더: 정렬·배경·테두리·카드·결정·허용 임베드', async () => {
  const sourceUrl = new URL('../src/jira/adf.jsx', import.meta.url);
  const source = (await readFile(sourceUrl, 'utf8')).replace(/from '([.][^']+)'/g, (_, path) => `from '${new URL(path, sourceUrl).href}'`);
  const { code } = await transformWithEsbuild(source, 'adf.jsx', { loader: 'jsx', jsx: 'transform' });
  const temp = new URL(`.adf-smoke-${process.pid}.mjs`, import.meta.url);
  try {
    await writeFile(temp, code);
    const { default: AdfView } = await import(temp.href);
    const html = renderToStaticMarkup(React.createElement(AdfView, { doc }));
    for (const value of ['text-align:end', 'text-align:center', 'background-color:#ffeebb', 'border-width:3px', 'border-color:#123456', '/browse/TEST-12', 'adf-link-card', '합성 결정', '결정됨', 'sandbox="allow-scripts allow-same-origin"']) assert.ok(html.includes(value), value);
    assert.equal((html.match(/<iframe/g) ?? []).length, 1);
    assert.equal(doc.content[1].content[1].attrs.url, original + '/browse/TEST-12');
  } finally { await unlink(temp).catch(() => {}); }
});
