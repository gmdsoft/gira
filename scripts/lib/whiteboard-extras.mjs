// 화이트보드 이미지 원본·댓글을 Gonfluence에 보관 (GIRA-78) — 임포터와 소급 스크립트가 같이 쓴다.
//  - 이미지: DATA_DIR/att-cache/<content id>/<파일 이름> + attachments 행 (파일 이름 = whiteboardImageName, 보기가 /api/att로 읽는다)
//  - 댓글: comments 행 (kind inline, inline_ref = 보드 댓글 요소의 ci, 원본 댓글 id 그대로)
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { DATA_DIR } from '../../server/src/db.mjs';
import { convertStorage } from '../convert-storage.mjs';

const LOCAL_ID_FLOOR = 1000000000000;
const safeName = (name) => name.replace(/[^\w.\-]+/g, '_'); // /api/att 캐시 경로 규칙과 같다

export async function storeWhiteboardExtras(query, contentId, { images = [], comments = [] }, { uid = () => null, dataDir = DATA_DIR } = {}) {
  let stored = 0, commented = 0;
  if (images.length) {
    // 시퀀스가 원본 id 대역에 있으면(서버가 한 번도 안 뜬 새 DB) 로컬 대역으로 올린다
    await query(`SELECT setval('attachment_id_seq', GREATEST(${LOCAL_ID_FLOOR}, (SELECT last_value FROM attachment_id_seq)))`);
    const dir = path.join(dataDir, 'att-cache', String(contentId));
    await mkdir(dir, { recursive: true });
    for (const img of images) {
      await writeFile(path.join(dir, safeName(img.filename)), img.buffer);
      await query(
        `INSERT INTO attachments (id, content_id, filename, media_type, file_size, version, created_at)
         VALUES (nextval('attachment_id_seq'), $1, $2, $3, $4, 1, now())
         ON CONFLICT (content_id, filename, version) DO UPDATE SET media_type = EXCLUDED.media_type, file_size = EXCLUDED.file_size`,
        [contentId, img.filename, img.mimeType, img.buffer.length]);
      stored++;
    }
  }
  for (const c of comments) {
    let doc = null;
    if (c.xhtml?.trim()) { try { doc = convertStorage(c.xhtml).doc; } catch { /* 본문 없이 적재 */ } }
    await query(
      `INSERT INTO comments (id, content_id, kind, inline_ref, resolved, doc, author_id, created_at)
       VALUES ($1, $2, 'inline', $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, resolved = EXCLUDED.resolved, inline_ref = EXCLUDED.inline_ref
       WHERE comments.content_id = EXCLUDED.content_id`,
      [c.id, contentId, c.markerRef, !!c.resolved, doc ? JSON.stringify(doc) : null, uid(c.authorId), c.createdAt ? new Date(c.createdAt) : null]);
    commented++;
  }
  return { images: stored, comments: commented };
}
