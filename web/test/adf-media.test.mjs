import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { attachmentMaps, matchMedia, fileSize } from '../src/jira/adf-media.js';
import { PreservedMedia, PreservedMediaInline, adfToTiptap, tiptapToAdf } from '../src/jira/adf-convert.js';
const attachments = [
  { id: 1, media_id: 'UUID', filename: 'log.zip', media_type: 'application/zip', file_size: 2048 },
  { id: 2, filename: 'photo.png', media_type: 'image/png' },
];
test('UUID → gira id → alt 순서 및 미일치', () => {
  const maps = attachmentMaps(attachments);
  assert.equal(matchMedia({ id: 'uuid', alt: 'photo.png' }, maps), attachments[0]);
  assert.equal(matchMedia({ id: '2', collection: 'gira', alt: 'log.zip' }, maps), attachments[1]);
  assert.equal(matchMedia({ id: '2' }, maps), null);
  assert.equal(matchMedia({ alt: 'LOG.ZIP' }, maps), attachments[0]);
  assert.equal(matchMedia({ id: 'deleted' }, maps), null);
  assert.equal(fileSize(2048), '2.0 KB'); assert.equal(fileSize(0), '0 B');
});
test('DescEditor 스키마를 거친 미디어 묶음/이미지/inline attrs 왕복 보존', () => {
  const schema = getSchema([StarterKit, PreservedMedia, PreservedMediaInline]);
  const doc = { type: 'doc', version: 1, content: [
    { type: 'mediaGroup', content: Array.from({ length: 5 }, (_, i) => ({ type: 'media', attrs: { type: 'file', id: `uuid-${i}`, collection: 'jira' } })) },
    { type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs: { id: 'image', alt: 'photo.png', collection: 'gira', width: 300 } }] },
    { type: 'paragraph', content: [{ type: 'mediaInline', attrs: { id: 'inline', alt: 'log.zip', collection: 'jira' } }] },
  ] };
  const editorDoc = schema.nodeFromJSON(adfToTiptap(doc));
  editorDoc.check();
  assert.deepEqual(tiptapToAdf(editorDoc.toJSON()), doc);
});
