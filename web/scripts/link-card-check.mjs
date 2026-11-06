import assert from 'node:assert/strict';
import { generateHTML, generateJSON } from '@tiptap/html';
import { extensions } from '../src/extensions.js';
import { internalLink } from '../src/internal-links.js';
const base = 'http://localhost:3001/s/DEV/p/1';
assert.equal(internalLink('/s/DEV/p/123', base).id, '123');
assert.equal(internalLink('/wiki/spaces/DEV/pages/123/Title', base).kind, 'page');
assert.equal(internalLink('http://localhost:3002/browse/GIRA-13', base).kind, 'issue');
for (const url of ['https://example.com/s/DEV/p/1', 'http://localhost:9999/browse/GIRA-13', 'javascript:alert(1)', 'http://localhost:3002/browse/GIRA-13/extra']) {
  assert.equal(internalLink(url, base), null);
}
for (const kind of ['page', 'issue']) {
  const attrs = { kind, href: kind === 'page' ? '/s/DEV/p/123' : 'http://localhost:3002/browse/GIRA-13', title: '제목 <테스트>', status: kind === 'issue' ? '진행 중' : '' };
  const doc = { type: 'doc', content: [{ type: 'linkCard', attrs }] };
  const html = generateHTML(doc, extensions);
  assert.ok(html.includes('제목 &lt;테스트&gt;'));
  assert.ok(html.includes(`href="${attrs.href}"`));
  assert.deepEqual({ ...generateJSON(html, extensions).content[0].attrs }, attrs);
}
console.log('link-card-check: URL 범위, 제목/상태/이동 주소, HTML 왕복 직렬화 통과');
