#!/usr/bin/env node
// DB의 모든 콘텐츠(최신 버전)를 OpenSearch에 일괄 색인한다.
import { query, closeDb } from '../server/src/db.mjs';
import { bulkIndex } from '../server/src/search.mjs';

const { rows } = await query(
  `SELECT c.id, c.title, c.type, c.updated_at, s.key AS space_key, v.doc,
          u.display_name AS author_name,
          coalesce((SELECT array_agg(l.name) FROM content_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.content_id = c.id), '{}') AS labels
     FROM content c JOIN spaces s ON s.id = c.space_id
     LEFT JOIN content_versions v ON v.content_id = c.id AND v.version = c.current_version
     LEFT JOIN users u ON u.id = c.author_id
    WHERE c.status = 'current'`);

let total = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200).map((r) => ({
    id: r.id, title: r.title, spaceKey: r.space_key, type: r.type,
    labels: r.labels, authorName: r.author_name, updatedAt: r.updated_at, doc: r.doc,
  }));
  total += await bulkIndex(batch);
  console.log(`  ${Math.min(i + 200, rows.length)}/${rows.length}`);
}
console.log(`색인 완료: ${total}건`);
await closeDb();
