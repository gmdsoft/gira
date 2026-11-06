// GIRA-59 임베드 → 문서 본문 (합성 주소)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedDoc, figmaEmbedUrl, confluencePageId } from '../scripts/lib/confluence-embed.mjs';

test('Figma 주소는 임베드 주소로, 이미 임베드면 그대로', () => {
  assert.match(figmaEmbedUrl('https://www.figma.com/proto/abc/Test?node-id=1'), /^https:\/\/www\.figma\.com\/embed\?embed_host=share&url=https%3A%2F%2Fwww\.figma\.com%2Fproto/);
  assert.equal(figmaEmbedUrl('https://www.figma.com/embed?url=x'), null);
  assert.equal(figmaEmbedUrl('https://example.com/a'), null);
});

test('Confluence 문서 주소는 iframe 대신 Gonfluence 링크', () => {
  assert.equal(confluencePageId('https://example.atlassian.net/wiki/spaces/X/pages/12345/Title'), '12345');
  assert.equal(confluencePageId('https://example.atlassian.net/wiki/spaces/X/pages/edit-v2/777'), '777');
  const doc = embedDoc('https://example.atlassian.net/wiki/spaces/X/pages/12345/Title');
  assert.ok(!JSON.stringify(doc).includes('htmlEmbed'));
  assert.match(JSON.stringify(doc), /viewpage\.action\?pageId=12345/);
});

test('그 밖의 주소는 HTML 블록 + 새 탭 링크, 주소 없으면 안내', () => {
  const doc = embedDoc('https://example.com/app');
  assert.equal(doc.content[0].type, 'htmlEmbed');
  assert.equal(doc.content[0].attrs.src, 'https://example.com/app');
  assert.match(JSON.stringify(embedDoc(null)), /주소가 없습니다/);
});
