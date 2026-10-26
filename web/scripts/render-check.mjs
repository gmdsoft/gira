#!/usr/bin/env node
// DB에 적재된 모든 본문 doc을 TipTap 스키마(extensions.js)로 HTML 직렬화해 본다.
// 스키마에 없는 노드/마크가 있으면 여기서 드러난다.
import { generateHTML } from '@tiptap/html';
import { extensions } from '../src/extensions.js';
import { query, closeDb } from '../../server/src/db.mjs';

const { rows } = await query(
  `SELECT v.content_id, c.title, v.doc FROM content_versions v JOIN content c ON c.id = v.content_id WHERE v.doc IS NOT NULL`);

let ok = 0; const failures = [];
for (const r of rows) {
  try {
    generateHTML(r.doc, extensions);
    ok++;
  } catch (e) {
    failures.push({ id: r.content_id, title: r.title, error: e.message });
  }
}
console.log(`render-check: 성공 ${ok}/${rows.length}`);
for (const f of failures.slice(0, 20)) console.log(`  실패 ${f.id} "${f.title}": ${f.error}`);
if (failures.length > 20) console.log(`  … 외 ${failures.length - 20}건`);
await closeDb();
process.exit(failures.length ? 1 : 0);
