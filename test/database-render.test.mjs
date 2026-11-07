import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { normalizeDatabase } from '../scripts/lib/confluence-database.mjs';

test('표·카드·보드 읽기 전용 렌더 스모크', async () => {
  const vite = await createServer({ root: new URL('../web', import.meta.url).pathname, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: DatabaseView } = await vite.ssrLoadModule('/src/DatabaseView.jsx');
    for (const [id, type] of [['943521921','table'], ['135694426','board'], ['1103429634','card']]) {
      const data = normalizeDatabase(readFileSync(new URL(`./fixtures/database-${id}.ybin`, import.meta.url)));
      data.views = [data.views.find(v => v.type === type)];
      const html = renderToStaticMarkup(React.createElement(DatabaseView, { page: { id, title: '테스트 DB', data, spaceKey: 'TEST' } }));
      assert.ok(html.includes('읽기 전용 — 원본에서 이관됨'));
      assert.ok(html.includes(type === 'table' ? '<table' : type === 'board' ? 'database-board' : 'database-gallery'));
      assert.ok(html.includes('role="tab"'));
      if (type === 'table') assert.ok(html.includes('<tfoot>') && html.includes('database-calc'));
      assert.ok(!html.includes('contenteditable'));
    }
  } finally { await vite.close(); }
});
