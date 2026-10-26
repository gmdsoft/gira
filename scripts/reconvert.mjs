#!/usr/bin/env node
// DB에 보관된 원본 XHTML(source_xhtml)로 모든 버전 본문을 재변환한다.
// Confluence API를 호출하지 않는다 — 변환기 개선을 기존 문서에 소급 적용할 때 사용.
//
// 사용법: node scripts/reconvert.mjs [--dry-run]

import { parseArgs } from 'node:util';
import { convertStorage } from './convert-storage.mjs';
import { query, closeDb } from '../server/src/db.mjs';

const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

const { rows: userRows } = await query(
  `SELECT confluence_account_id, display_name FROM users WHERE confluence_account_id IS NOT NULL`);
const users = new Map(userRows.map((r) => [r.confluence_account_id, r.display_name]));

function walk(node, fn) { fn(node); for (const c of node.content ?? []) walk(c, fn); }

const { rows } = await query(
  `SELECT content_id, version, source_xhtml FROM content_versions
    WHERE source_xhtml IS NOT NULL ORDER BY content_id, version`);
console.log(`재변환 대상: ${rows.length}개 버전`);

let ok = 0, fail = 0;
for (const r of rows) {
  try {
    const { doc } = convertStorage(r.source_xhtml);
    walk(doc, (n) => {
      if (n.type === 'mention' && n.attrs?.accountId && !n.attrs.text) {
        n.attrs.text = users.get(n.attrs.accountId) ?? '';
      }
    });
    if (!args['dry-run']) {
      await query(`UPDATE content_versions SET doc = $3 WHERE content_id = $1 AND version = $2`,
        [r.content_id, r.version, JSON.stringify(doc)]);
    }
    if (++ok % 500 === 0) console.log(`  ${ok}/${rows.length}`);
  } catch (e) {
    fail++;
    console.error(`실패 ${r.content_id} v${r.version}: ${e.message}`);
  }
}
console.log(`완료: 성공 ${ok}, 실패 ${fail}${args['dry-run'] ? ' (dry-run, DB 미변경)' : ''}`);
await closeDb();
