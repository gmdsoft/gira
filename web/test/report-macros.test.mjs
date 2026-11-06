import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHTML } from '@tiptap/html';
import { extensions, HYDRATED_MACROS } from '../src/extensions.js';
const names = ['content-report-table', 'tasks-report-macro', 'decisionreport', 'detailssummary', 'change-history', 'profile-picture', 'popular-labels', 'listlabels', 'blog-posts', 'attachments', 'toc-zone', 'native-embed:page', 'recently-updated-dashboard', 'index'];
test('보고서 매크로는 하이드레이션 슬롯을 만들며 toc-zone 본문을 보존한다', () => {
  for (const name of names) {
    assert.ok(HYDRATED_MACROS.has(name), name);
    const html = generateHTML({ type: 'doc', content: [{ type: 'cfMacro', attrs: { name, params: {} }, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '합성 제목' }] }] }] }, extensions);
    assert.ok(html.includes(`data-macro="${name}"`), name);
    assert.match(html, /cf-macro-slot/);
    assert.match(html, /합성 제목/);
  }
});
