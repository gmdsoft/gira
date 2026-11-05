// Gonfluence 스페이스 패키지 (.zip): manifest.json + attachments/ (로컬 업로드 파일만).
// 내보내기: 스페이스의 전체 트리(모든 상태)·버전 이력·댓글·레이블·첨부 메타와 참조 사용자.
// 가져오기: 사용자 매칭(email→account_id→생성), 콘텐츠/첨부/댓글 id 재매핑. 키 충돌 시 거부.
// 권한 규칙은 패키지에 담지 않는다 — 가져온 사람이 스페이스 관리자가 된다(기본 비공개 정책).
import AdmZip from 'adm-zip';
import path from 'node:path';
import { stat, mkdir, writeFile } from 'node:fs/promises';
import { getDb, query, DATA_DIR } from './db.mjs';

export const PKG_FORMAT = 'gonfluence-space';

const all = async (sql, params) => (await query(sql, params)).rows;
const safeName = (s) => s.replace(/[^\w.\-]+/g, '_');

export async function exportSpace(spaceId) {
  const [space] = await all(`SELECT * FROM spaces WHERE id = $1`, [spaceId]);
  const content = await all(`SELECT * FROM content WHERE space_id = $1 ORDER BY id`, [spaceId]);
  const ids = content.map((c) => c.id);
  const [versions, attachments, comments, labels] = await Promise.all([
    all(`SELECT * FROM content_versions WHERE content_id = ANY($1::bigint[]) ORDER BY content_id, version`, [ids]),
    all(`SELECT * FROM attachments WHERE content_id = ANY($1::bigint[]) ORDER BY id`, [ids]),
    all(`SELECT * FROM comments WHERE content_id = ANY($1::bigint[]) ORDER BY id`, [ids]),
    all(`SELECT cl.content_id, l.name FROM content_labels cl JOIN labels l ON l.id = cl.label_id
          WHERE cl.content_id = ANY($1::bigint[])`, [ids]),
  ]);
  const users = await all(
    `SELECT DISTINCT u.id, u.email, u.display_name, u.confluence_account_id FROM users u WHERE u.id IN (
       SELECT author_id FROM content WHERE space_id = $1 AND author_id IS NOT NULL
       UNION SELECT owner_id FROM content WHERE space_id = $1 AND owner_id IS NOT NULL
       UNION SELECT author_id FROM content_versions WHERE content_id = ANY($2::bigint[]) AND author_id IS NOT NULL
       UNION SELECT author_id FROM comments WHERE content_id = ANY($2::bigint[]) AND author_id IS NOT NULL
       UNION SELECT author_id FROM attachments WHERE content_id = ANY($2::bigint[]) AND author_id IS NOT NULL
     )`, [spaceId, ids]);

  const zip = new AdmZip();
  const manifest = {
    format: PKG_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    space, content, versions, attachments, comments, labels, users,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  for (const a of attachments) {
    if (a.source_url) continue; // 이관분은 메타만 (원본 프록시)
    const p = path.join(DATA_DIR, 'att-cache', String(a.content_id), safeName(a.filename));
    if (await stat(p).catch(() => null)) zip.addLocalFile(p, `attachments/${a.id}`, safeName(a.filename));
  }
  return { zip, counts: { pages: content.length, versions: versions.length, attachments: attachments.length } };
}

export async function importSpace(buffer, requesterId) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw Object.assign(new Error('manifest.json이 없습니다 — Gonfluence 스페이스 패키지가 아닙니다'), { status: 400 });
  const m = JSON.parse(zip.readAsText(entry));
  if (m.format !== PKG_FORMAT) throw Object.assign(new Error(`지원하지 않는 형식: ${m.format}`), { status: 400 });

  const pool = await getDb();
  const client = await pool.connect();
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  try {
    await client.query('BEGIN');
    if (await one(`SELECT 1 AS x FROM spaces WHERE key = $1`, [m.space.key])) {
      throw Object.assign(new Error(`스페이스 키 ${m.space.key} 가 이미 있습니다`), { status: 409 });
    }

    const userMap = new Map();
    for (const u of m.users ?? []) {
      let row = u.email ? await one(`SELECT id FROM users WHERE email = $1`, [u.email]) : null;
      if (!row && u.confluence_account_id) {
        row = await one(`SELECT id FROM users WHERE confluence_account_id = $1`, [u.confluence_account_id]);
      }
      if (!row) {
        row = await one(
          `INSERT INTO users (email, display_name, confluence_account_id, active)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [u.email ?? null, u.display_name ?? null, u.confluence_account_id ?? null]);
      }
      userMap.set(String(u.id), Number(row.id));
    }
    const mapUser = (id) => (id == null ? null : (userMap.get(String(id)) ?? null));

    const spaceId = Number((await one(`SELECT coalesce(max(id), 0) + 1 AS id FROM spaces`)).id);
    await client.query(
      `INSERT INTO spaces (id, key, name, type, status, homepage_id, icon_key, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
      [spaceId, m.space.key, m.space.name, m.space.type, m.space.status ?? 'current',
       m.space.icon_key ?? null, m.space.created_at ?? null]);

    // 콘텐츠 1차 (parent 없이) → 2차 parent/homepage
    const contentMap = new Map();
    for (const c of m.content ?? []) {
      const row = await one(
        `INSERT INTO content (id, space_id, parent_id, type, title, position, status, author_id, owner_id,
           current_version, full_width, created_at, updated_at)
         VALUES (nextval('content_id_seq'), $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [spaceId, c.type, c.title, c.position ?? null, c.status ?? 'current',
         mapUser(c.author_id), mapUser(c.owner_id), c.current_version ?? null,
         c.full_width ?? false, c.created_at ?? null, c.updated_at ?? null]);
      contentMap.set(String(c.id), Number(row.id));
    }
    for (const c of m.content ?? []) {
      if (c.parent_id == null) continue;
      const nid = contentMap.get(String(c.id));
      const pid = contentMap.get(String(c.parent_id));
      if (pid) await client.query(`UPDATE content SET parent_id = $2 WHERE id = $1`, [nid, pid]);
    }
    if (m.space.homepage_id != null) {
      const hid = contentMap.get(String(m.space.homepage_id));
      if (hid) await client.query(`UPDATE spaces SET homepage_id = $2 WHERE id = $1`, [spaceId, hid]);
    }

    for (const v of m.versions ?? []) {
      const cid = contentMap.get(String(v.content_id));
      if (!cid) continue;
      await client.query(
        `INSERT INTO content_versions (content_id, version, doc, source_xhtml, source_editor, message, minor_edit, author_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [cid, v.version, v.doc ?? null, v.source_xhtml ?? null, v.source_editor ?? null,
         v.message ?? null, v.minor_edit ?? false, mapUser(v.author_id), v.created_at ?? null]);
    }

    const attFiles = [];
    for (const a of m.attachments ?? []) {
      const cid = contentMap.get(String(a.content_id));
      if (!cid) continue;
      await client.query(
        `INSERT INTO attachments (id, content_id, filename, media_type, file_size, s3_key, source_url, sha256, version, author_id, created_at)
         VALUES (nextval('attachment_id_seq'), $1, $2, $3, $4, NULL, $5, NULL, $6, $7, $8)`,
        [cid, a.filename, a.media_type ?? null, a.file_size ?? null, a.source_url ?? null,
         a.version ?? 1, mapUser(a.author_id), a.created_at ?? null]);
      if (!a.source_url) {
        attFiles.push({ entryName: `attachments/${a.id}/${safeName(a.filename)}`, dest: path.join('att-cache', String(cid), safeName(a.filename)) });
      }
    }

    const commentMap = new Map();
    for (const c of m.comments ?? []) {
      const cid = contentMap.get(String(c.content_id));
      if (!cid) continue;
      const row = await one(
        `INSERT INTO comments (id, content_id, parent_id, kind, inline_ref, resolved, doc, author_id, created_at)
         VALUES (nextval('comment_id_seq'), $1, NULL, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [cid, c.kind, c.inline_ref ?? null, c.resolved ?? false, c.doc ?? null,
         mapUser(c.author_id), c.created_at ?? null]);
      commentMap.set(String(c.id), Number(row.id));
    }
    for (const c of m.comments ?? []) {
      if (c.parent_id == null) continue;
      const nid = commentMap.get(String(c.id));
      const pid = commentMap.get(String(c.parent_id));
      if (nid && pid) await client.query(`UPDATE comments SET parent_id = $2 WHERE id = $1`, [nid, pid]);
    }

    for (const l of m.labels ?? []) {
      const cid = contentMap.get(String(l.content_id));
      if (!cid) continue;
      const lab = await one(
        `INSERT INTO labels (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [l.name]);
      await client.query(
        `INSERT INTO content_labels (content_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [cid, lab.id]);
    }

    await client.query(
      `INSERT INTO space_permissions (space_id, principal_type, principal_id, role)
       VALUES ($1, 'user', $2, 'admin') ON CONFLICT DO NOTHING`, [spaceId, requesterId]);

    await client.query('COMMIT');

    for (const f of attFiles) {
      const e = zip.getEntry(f.entryName);
      if (!e) continue;
      const dest = path.join(DATA_DIR, f.dest);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, e.getData());
    }

    return { spaceKey: m.space.key, counts: { pages: contentMap.size, attachments: (m.attachments ?? []).length } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
