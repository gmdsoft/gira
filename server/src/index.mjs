// API 서버 (PoC).
// - /api/* : 스페이스, 콘텐츠 트리, 본문(ProseMirror JSON), 댓글, 첨부 프록시
// - /wiki/* : 기존 Confluence URL 호환 리다이렉트 (docs/architecture.md)
// - web/dist 가 있으면 SPA 정적 서빙
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import * as searchSvc from './search.mjs';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, DATA_DIR } from './db.mjs';
import { decodeTinyToken } from './tinylink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = process.env.ATLASSIAN_EMAIL && process.env.ATLASSIAN_API_TOKEN
  ? 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64')
  : null;

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 32 * 1024 * 1024 });

// 새 콘텐츠·첨부 ID가 이관된 ID와 겹치지 않도록 시퀀스 보정
await query(`SELECT setval('content_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM content), (SELECT last_value FROM content_id_seq)))`);
await query(`SELECT setval('attachment_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM attachments), (SELECT last_value FROM attachment_id_seq)))`);
await query(`SELECT setval('comment_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM comments), (SELECT last_value FROM comment_id_seq)))`);

await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024, files: 5 } });

// 게시·생성 시 검색 색인 (실패해도 본 동작에는 영향 없음)
async function reindex(contentId) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.title, c.type, c.updated_at, s.key AS space_key, v.doc,
              u.display_name AS author_name,
              coalesce((SELECT array_agg(l.name) FROM content_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.content_id = c.id), '{}') AS labels
         FROM content c JOIN spaces s ON s.id = c.space_id
         LEFT JOIN content_versions v ON v.content_id = c.id AND v.version = c.current_version
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.id = $1`, [contentId]);
    if (!rows.length) return;
    const r = rows[0];
    await searchSvc.indexContent({
      id: r.id, title: r.title, spaceKey: r.space_key, type: r.type,
      labels: r.labels, authorName: r.author_name, updatedAt: r.updated_at, doc: r.doc,
    });
  } catch (e) {
    console.error('[search] 재색인 실패:', e.message);
  }
}

// ---------- API ----------

app.get('/api/spaces', async () => {
  const { rows } = await query(
    `SELECT id, key, name, type, status, homepage_id FROM spaces ORDER BY name`);
  return rows;
});

app.get('/api/spaces/:key', async (req, reply) => {
  const { rows } = await query(`SELECT id, key, name, type, status, homepage_id FROM spaces WHERE key = $1`, [req.params.key]);
  if (!rows.length) return reply.code(404).send({ error: 'space not found' });
  const space = rows[0];
  const { rows: tree } = await query(
    `SELECT id, parent_id, type, title, position, status, current_version
       FROM content WHERE space_id = $1 AND status = 'current'
      ORDER BY position NULLS LAST, title`, [space.id]);
  return { ...space, tree };
});

app.get('/api/content/:id', async (req, reply) => {
  const { rows } = await query(
    `SELECT c.*, s.key AS space_key, s.name AS space_name,
            u.display_name AS author_name
       FROM content c
       JOIN spaces s ON s.id = c.space_id
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.id = $1`, [req.params.id]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  const c = rows[0];
  const { rows: ver } = await query(
    `SELECT v.version, v.doc, v.source_editor, v.created_at, u.display_name AS author_name
       FROM content_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.content_id = $1 AND v.version = $2`, [c.id, c.current_version]);
  const { rows: labels } = await query(
    `SELECT l.name FROM content_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.content_id = $1 ORDER BY l.name`, [c.id]);
  const { rows: attachments } = await query(
    `SELECT id, filename, media_type, file_size, version FROM attachments WHERE content_id = $1 ORDER BY filename`, [c.id]);
  const { rows: counts } = await query(
    `SELECT kind, count(*)::int AS n FROM comments WHERE content_id = $1 GROUP BY kind`, [c.id]);
  const { rows: children } = await query(
    `SELECT id, type, title FROM content WHERE parent_id = $1 AND status = 'current'
      ORDER BY position NULLS LAST, title`, [c.id]);
  return {
    children,
    id: c.id, spaceKey: c.space_key, spaceName: c.space_name, parentId: c.parent_id,
    type: c.type, title: c.title, status: c.status, fullWidth: c.full_width, authorName: c.author_name,
    createdAt: c.created_at, updatedAt: c.updated_at, version: ver[0] ?? null,
    labels: labels.map((l) => l.name), attachments,
    commentCounts: Object.fromEntries(counts.map((r) => [r.kind, r.n])),
  };
});

app.get('/api/content/:id/comments', async (req) => {
  const { rows } = await query(
    `SELECT cm.id, cm.parent_id, cm.kind, cm.inline_ref, cm.resolved, cm.doc, cm.created_at,
            u.display_name AS author_name
       FROM comments cm LEFT JOIN users u ON u.id = cm.author_id
      WHERE cm.content_id = $1 ORDER BY cm.created_at`, [req.params.id]);
  return rows;
});

// 본문 pageLink(제목+스페이스 키) → 콘텐츠 ID
app.get('/api/resolve', async (req, reply) => {
  const { spaceKey, title } = req.query;
  if (!title) return reply.code(400).send({ error: 'title required' });
  const { rows } = await query(
    `SELECT c.id, s.key AS space_key FROM content c JOIN spaces s ON s.id = c.space_id
      WHERE c.title = $1 AND ($2::text IS NULL OR s.key = $2) LIMIT 2`, [title, spaceKey || null]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  return { id: rows[0].id, spaceKey: rows[0].space_key };
});

// 첨부 프록시: 원본 Confluence에서 받아 캐시 후 서빙 (PoC. 운영은 MinIO presigned URL)
app.get('/api/att/:contentId/:filename', async (req, reply) => {
  const { contentId } = req.params;
  const filename = decodeURIComponent(req.params.filename);
  const { rows } = await query(
    `SELECT media_type, source_url FROM attachments
      WHERE content_id = $1 AND filename = $2 ORDER BY version DESC LIMIT 1`, [contentId, filename]);
  if (!rows.length) return reply.code(404).send({ error: 'attachment not found' });
  const { media_type: mediaType, source_url: sourceUrl } = rows[0];

  const safe = filename.replace(/[^\w.\-]+/g, '_');
  const cacheDir = path.join(DATA_DIR, 'att-cache', String(contentId));
  const cachePath = path.join(cacheDir, safe);
  const cached = await stat(cachePath).catch(() => null);
  if (!cached) {
    if (!AUTH || !SITE || !sourceUrl) return reply.code(502).send({ error: 'no source available' });
    const res = await fetch(SITE + '/wiki' + sourceUrl, { headers: { Authorization: AUTH } });
    if (!res.ok) return reply.code(502).send({ error: `upstream ${res.status}` });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, Buffer.from(await res.arrayBuffer()));
  }
  reply.header('cache-control', 'private, max-age=86400');
  if (mediaType) reply.type(mediaType);
  return reply.send(createReadStream(cachePath));
});

// ---------- 편집: 초안, 게시, 생성 ----------
// 인증(Entra ID) 도입 전까지 로컬 개발 사용자로 기록한다.
async function devUserId() {
  const { rows } = await query(
    `INSERT INTO users (confluence_account_id, display_name)
     VALUES ('local-dev', '개발 모드 사용자')
     ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`);
  return rows[0].id;
}

app.get('/api/content/:id/draft', async (req, reply) => {
  const { rows } = await query(`SELECT doc, title, base_version, updated_at FROM drafts WHERE content_id = $1`, [req.params.id]);
  if (!rows.length) return reply.code(404).send({ error: 'no draft' });
  return rows[0];
});

app.put('/api/content/:id/draft', async (req) => {
  const { doc, title, baseVersion } = req.body;
  const userId = await devUserId();
  await query(
    `INSERT INTO drafts (content_id, doc, title, base_version, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (content_id) DO UPDATE SET doc = EXCLUDED.doc, title = EXCLUDED.title,
       base_version = EXCLUDED.base_version, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.params.id, JSON.stringify(doc), title?.trim() || null, baseVersion ?? null, userId]);
  return { ok: true, savedAt: new Date().toISOString() };
});

app.delete('/api/content/:id/draft', async (req) => {
  await query(`DELETE FROM drafts WHERE content_id = $1`, [req.params.id]);
  return { ok: true };
});

// 게시: 초안(또는 본문 직접 전달)을 새 버전으로
app.post('/api/content/:id/publish', async (req, reply) => {
  const id = req.params.id;
  const { rows: cur } = await query(`SELECT current_version FROM content WHERE id = $1`, [id]);
  if (!cur.length) return reply.code(404).send({ error: 'not found' });
  const { rows: dr } = await query(`SELECT doc, title, base_version FROM drafts WHERE content_id = $1`, [id]);
  const doc = req.body?.doc ?? dr[0]?.doc;
  if (!doc) return reply.code(400).send({ error: 'no draft to publish' });
  const newTitle = (req.body?.title ?? dr[0]?.title)?.trim();
  const baseVersion = req.body?.baseVersion ?? dr[0]?.base_version;
  const currentVersion = cur[0].current_version ?? 0;
  if (baseVersion != null && Number(baseVersion) !== Number(currentVersion)) {
    return reply.code(409).send({ error: 'version conflict', currentVersion, baseVersion });
  }
  const next = Number(currentVersion) + 1;
  const userId = await devUserId();
  await query(
    `INSERT INTO content_versions (content_id, version, doc, message, minor_edit, author_id, created_at)
     VALUES ($1, $2, $3, $4, false, $5, now())`,
    [id, next, JSON.stringify(doc), req.body?.message ?? null, userId]);
  await query(`UPDATE content SET current_version = $2, updated_at = now(), title = COALESCE($3, title) WHERE id = $1`,
    [id, next, newTitle || null]);
  await query(`DELETE FROM drafts WHERE content_id = $1`, [id]);
  reindex(id);
  return { ok: true, version: next };
});

// 새 페이지 생성 (Confluence처럼 제목 없이 먼저 만들고 편집기에서 입력)
app.post('/api/content', async (req, reply) => {
  const { spaceKey, parentId } = req.body ?? {};
  const title = req.body?.title?.trim() || '제목 없는 문서';
  if (!spaceKey) return reply.code(400).send({ error: 'spaceKey required' });
  const { rows: sp } = await query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
  if (!sp.length) return reply.code(404).send({ error: 'space not found' });
  const userId = await devUserId();
  const { rows } = await query(
    `INSERT INTO content (id, space_id, parent_id, type, title, status, author_id, owner_id, current_version, created_at, updated_at)
     VALUES (nextval('content_id_seq'), $1, $2, 'page', $3, 'current', $4, $4, 0, now(), now())
     RETURNING id`,
    [sp[0].id, parentId ?? null, title, userId]);
  return { id: rows[0].id, spaceKey };
});

// 첨부 업로드 (로컬 저장. 운영 전환 시 MinIO로 교체)
app.post('/api/content/:id/attachments', async (req, reply) => {
  const contentId = req.params.id;
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'file required' });
  const buf = await file.toBuffer();
  const filename = file.filename;
  const userId = await devUserId();
  const { rows: ver } = await query(
    `SELECT coalesce(max(version), 0) + 1 AS v FROM attachments WHERE content_id = $1 AND filename = $2`,
    [contentId, filename]);
  const safe = filename.replace(/[^\w.\-]+/g, '_');
  const dir = path.join(DATA_DIR, 'att-cache', String(contentId));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, safe), buf);
  await query(
    `INSERT INTO attachments (id, content_id, filename, media_type, file_size, version, author_id, created_at)
     VALUES (nextval('attachment_id_seq'), $1, $2, $3, $4, $5, $6, now())`,
    [contentId, filename, file.mimetype ?? null, buf.length, ver[0].v, userId]);
  return { filename, url: `/api/att/${contentId}/${encodeURIComponent(filename)}` };
});

// 검색
app.get('/api/search', async (req, reply) => {
  const { q, space, type } = req.query;
  if (!q?.trim()) return reply.code(400).send({ error: 'q required' });
  try {
    return await searchSvc.search({ q: q.trim(), spaceKey: space || undefined, type: type || undefined });
  } catch (e) {
    req.log.error(e);
    return reply.code(503).send({ error: '검색 엔진에 연결할 수 없습니다' });
  }
});

// 특정 버전 본문
app.get('/api/content/:id/versions/:v', async (req, reply) => {
  const { rows } = await query(
    `SELECT v.version, v.doc, v.message, v.created_at, v.source_editor,
            (v.source_xhtml IS NOT NULL) AS migrated, u.display_name AS author_name
       FROM content_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.content_id = $1 AND v.version = $2`, [req.params.id, req.params.v]);
  if (!rows.length) return reply.code(404).send({ error: 'version not found' });
  return rows[0];
});

// 과거 버전 복원 → 새 버전으로 게시
app.post('/api/content/:id/restore', async (req, reply) => {
  const id = req.params.id;
  const v = Number(req.body?.version);
  if (!v) return reply.code(400).send({ error: 'version required' });
  const { rows } = await query(`SELECT doc FROM content_versions WHERE content_id = $1 AND version = $2`, [id, v]);
  if (!rows.length || !rows[0].doc) return reply.code(404).send({ error: 'version not found or empty' });
  const { rows: cur } = await query(`SELECT current_version FROM content WHERE id = $1`, [id]);
  const next = Number(cur[0].current_version) + 1;
  const userId = await devUserId();
  await query(
    `INSERT INTO content_versions (content_id, version, doc, message, minor_edit, author_id, created_at)
     VALUES ($1, $2, $3, $4, false, $5, now())`,
    [id, next, JSON.stringify(rows[0].doc), `v${v} 복원`, userId]);
  await query(`UPDATE content SET current_version = $2, updated_at = now() WHERE id = $1`, [id, next]);
  reindex(id);
  return { ok: true, version: next };
});

app.get('/api/content/:id/versions', async (req) => {
  const { rows } = await query(
    `SELECT v.version, v.message, v.minor_edit, v.created_at, u.display_name AS author_name,
            (v.source_xhtml IS NOT NULL) AS migrated
       FROM content_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.content_id = $1 ORDER BY v.version DESC`, [req.params.id]);
  return rows;
});

// ---------- 페이지 관리: 복사·이동·보관/휴지통·댓글 작성·레이블 ----------

const SUBTREE_SQL = `
  WITH RECURSIVE sub AS (
    SELECT id FROM content WHERE id = $1
    UNION ALL
    SELECT c.id FROM content c JOIN sub ON c.parent_id = sub.id
  ) SELECT id FROM sub`;

// 이동 대화상자용 제목 검색 (DB만 사용 — 검색 엔진과 무관하게 동작)
app.get('/api/pages', async (req) => {
  const { space, q } = req.query;
  const { rows } = await query(
    `SELECT c.id, c.title, c.type, s.key AS space_key
       FROM content c JOIN spaces s ON s.id = c.space_id
      WHERE c.status = 'current' AND c.type IN ('page', 'live', 'folder')
        AND ($1::text IS NULL OR s.key = $1)
        AND ($2::text = '' OR c.title ILIKE '%' || $2 || '%')
      ORDER BY c.title LIMIT 20`, [space || null, (q ?? '').trim()]);
  return rows;
});

// 복사본 만들기: 현재 본문을 형제 페이지로 복제 (첨부 메타·캐시 포함)
app.post('/api/content/:id/copy', async (req, reply) => {
  const id = req.params.id;
  const { rows } = await query(
    `SELECT c.*, s.key AS space_key, v.doc
       FROM content c JOIN spaces s ON s.id = c.space_id
       LEFT JOIN content_versions v ON v.content_id = c.id AND v.version = c.current_version
      WHERE c.id = $1`, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  const src = rows[0];
  const userId = await devUserId();
  const hasDoc = !!src.doc;
  const { rows: created } = await query(
    `INSERT INTO content (id, space_id, parent_id, type, title, status, author_id, owner_id, current_version, created_at, updated_at)
     VALUES (nextval('content_id_seq'), $1, $2, 'page', $3, 'current', $4, $4, $5, now(), now())
     RETURNING id`,
    [src.space_id, src.parent_id, `${src.title} (사본)`, userId, hasDoc ? 1 : 0]);
  const newId = created[0].id;
  if (hasDoc) {
    await query(
      `INSERT INTO content_versions (content_id, version, doc, message, author_id, created_at)
       VALUES ($1, 1, $2, '복사본 생성', $3, now())`, [newId, JSON.stringify(src.doc), userId]);
  }
  const { rows: atts } = await query(
    `SELECT DISTINCT ON (filename) filename, media_type, file_size, s3_key, source_url
       FROM attachments WHERE content_id = $1 ORDER BY filename, version DESC`, [id]);
  for (const a of atts) {
    await query(
      `INSERT INTO attachments (id, content_id, filename, media_type, file_size, s3_key, source_url, version, author_id, created_at)
       VALUES (nextval('attachment_id_seq'), $1, $2, $3, $4, $5, $6, 1, $7, now())`,
      [newId, a.filename, a.media_type, a.file_size, a.s3_key, a.source_url, userId]);
    const safe = a.filename.replace(/[^\w.\-]+/g, '_');
    const from = path.join(DATA_DIR, 'att-cache', String(id), safe);
    if (await stat(from).catch(() => null)) {
      const dir = path.join(DATA_DIR, 'att-cache', String(newId));
      await mkdir(dir, { recursive: true });
      await copyFile(from, path.join(dir, safe));
    }
  }
  reindex(newId);
  return { id: newId, spaceKey: src.space_key };
});

// 이동: 다른 부모(또는 다른 스페이스 최상위) 밑으로. 스페이스가 바뀌면 하위 트리 전체를 함께 옮긴다.
app.post('/api/content/:id/move', async (req, reply) => {
  const id = Number(req.params.id);
  const { parentId, spaceKey } = req.body ?? {};
  const { rows: cur } = await query(`SELECT space_id FROM content WHERE id = $1`, [id]);
  if (!cur.length) return reply.code(404).send({ error: 'not found' });
  let targetSpaceId;
  const newParent = parentId ?? null;
  if (newParent != null) {
    if (Number(newParent) === id) return reply.code(400).send({ error: '자기 자신 밑으로는 옮길 수 없습니다' });
    const { rows: p } = await query(`SELECT space_id FROM content WHERE id = $1 AND status = 'current'`, [newParent]);
    if (!p.length) return reply.code(404).send({ error: 'parent not found' });
    targetSpaceId = p[0].space_id;
    const { rows: cyc } = await query(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id FROM content WHERE id = $1
         UNION ALL SELECT c.id, c.parent_id FROM content c JOIN up ON c.id = up.parent_id
       ) SELECT 1 FROM up WHERE id = $2 LIMIT 1`, [newParent, id]);
    if (cyc.length) return reply.code(400).send({ error: '자신의 하위 페이지 밑으로는 옮길 수 없습니다' });
  } else {
    const { rows: sp } = await query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
    if (!sp.length) return reply.code(400).send({ error: 'parentId 또는 spaceKey가 필요합니다' });
    targetSpaceId = sp[0].id;
  }
  await query(`UPDATE content SET parent_id = $2, position = NULL, updated_at = now() WHERE id = $1`, [id, newParent]);
  if (Number(targetSpaceId) !== Number(cur[0].space_id)) {
    const { rows: sub } = await query(SUBTREE_SQL, [id]);
    const ids = sub.map((r) => r.id);
    await query(`UPDATE content SET space_id = $1 WHERE id = ANY($2::bigint[])`, [targetSpaceId, ids]);
    for (const cid of ids) reindex(cid);
  }
  const { rows: sp } = await query(`SELECT key FROM spaces WHERE id = $1`, [targetSpaceId]);
  return { ok: true, spaceKey: sp[0].key };
});

// 보관/휴지통/복원: 하위 트리 전체에 적용
app.post('/api/content/:id/status', async (req, reply) => {
  const status = req.body?.status;
  if (!['current', 'archived', 'trashed'].includes(status)) {
    return reply.code(400).send({ error: 'status는 current|archived|trashed 중 하나' });
  }
  const { rows: sub } = await query(SUBTREE_SQL, [req.params.id]);
  if (!sub.length) return reply.code(404).send({ error: 'not found' });
  const ids = sub.map((r) => r.id);
  await query(`UPDATE content SET status = $1, updated_at = now() WHERE id = ANY($2::bigint[])`, [status, ids]);
  for (const cid of ids) {
    if (status === 'current') reindex(cid);
    else Promise.resolve(searchSvc.removeContent(cid)).catch(() => {});
  }
  return { ok: true, count: ids.length };
});

// 스페이스의 보관·휴지통 목록
app.get('/api/spaces/:key/archived', async (req, reply) => {
  const { rows: sp } = await query(`SELECT id FROM spaces WHERE key = $1`, [req.params.key]);
  if (!sp.length) return reply.code(404).send({ error: 'space not found' });
  const { rows } = await query(
    `SELECT id, title, type, status, updated_at FROM content
      WHERE space_id = $1 AND status IN ('archived', 'trashed')
      ORDER BY updated_at DESC`, [sp[0].id]);
  return rows;
});

// 댓글 작성 (하단 footer / 본문 선택 영역 inline)
app.post('/api/content/:id/comments', async (req, reply) => {
  const { text, doc, kind, inlineRef } = req.body ?? {};
  let body = doc;
  if (!body) {
    const t = (text ?? '').trim();
    if (!t) return reply.code(400).send({ error: 'text 또는 doc이 필요합니다' });
    body = {
      type: 'doc',
      content: t.split(/\n+/).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
    };
  }
  const k = kind === 'inline' ? 'inline' : 'footer';
  if (k === 'inline' && !inlineRef?.trim()) return reply.code(400).send({ error: 'inline 댓글은 inlineRef(선택한 텍스트)가 필요합니다' });
  const userId = await devUserId();
  const { rows } = await query(
    `INSERT INTO comments (id, content_id, kind, inline_ref, doc, author_id, created_at)
     VALUES (nextval('comment_id_seq'), $1, $2, $3, $4, $5, now()) RETURNING id`,
    [req.params.id, k, k === 'inline' ? inlineRef.trim().slice(0, 500) : null, JSON.stringify(body), userId]);
  return { ok: true, id: rows[0].id };
});

// 댓글 해결/재오픈
app.post('/api/comments/:id/resolve', async (req, reply) => {
  const resolved = req.body?.resolved !== false;
  const { rows } = await query(`UPDATE comments SET resolved = $2 WHERE id = $1 RETURNING id`, [req.params.id, resolved]);
  if (!rows.length) return reply.code(404).send({ error: 'comment not found' });
  return { ok: true, resolved };
});

// 레이블 추가/삭제
app.post('/api/content/:id/labels', async (req) => {
  const id = req.params.id;
  const add = (req.body?.add ?? []).map((s) => String(s).trim()).filter(Boolean);
  const remove = (req.body?.remove ?? []).map((s) => String(s).trim()).filter(Boolean);
  for (const name of add) {
    const { rows: l } = await query(
      `INSERT INTO labels (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
    await query(`INSERT INTO content_labels (content_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, l[0].id]);
  }
  if (remove.length) {
    await query(
      `DELETE FROM content_labels USING labels l
        WHERE content_labels.label_id = l.id AND content_labels.content_id = $1 AND l.name = ANY($2::text[])`,
      [id, remove]);
  }
  reindex(id);
  const { rows } = await query(
    `SELECT l.name FROM content_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.content_id = $1 ORDER BY l.name`, [id]);
  return { labels: rows.map((r) => r.name) };
});

// ---------- 매크로 렌더링용 조회 ----------

// profile 매크로: accountId → 사용자 표시 이름
app.get('/api/users/:accountId', async (req, reply) => {
  const { rows } = await query(
    `SELECT display_name, email FROM users WHERE confluence_account_id = $1`, [req.params.accountId]);
  if (!rows.length) return reply.code(404).send({ error: 'user not found' });
  return rows[0];
});

// recently-updated 매크로: 스페이스 최근 변경 페이지
app.get('/api/spaces/:key/recent', async (req, reply) => {
  const limit = Math.min(Number(req.query.limit) || 5, 25);
  const { rows: sp } = await query(`SELECT id FROM spaces WHERE key = $1`, [req.params.key]);
  if (!sp.length) return reply.code(404).send({ error: 'space not found' });
  const { rows } = await query(
    `SELECT c.id, c.title, c.updated_at, u.display_name AS author_name
       FROM content c
       LEFT JOIN content_versions v ON v.content_id = c.id AND v.version = c.current_version
       LEFT JOIN users u ON u.id = v.author_id
      WHERE c.space_id = $1 AND c.status = 'current' AND c.type IN ('page', 'live')
      ORDER BY c.updated_at DESC NULLS LAST LIMIT $2`, [sp[0].id, limit]);
  return rows;
});

// contentbylabel 매크로: 라벨이 달린 페이지
app.get('/api/label-content', async (req, reply) => {
  const labels = String(req.query.label ?? '').split(/[,+\s]+/).filter(Boolean);
  if (!labels.length) return reply.code(400).send({ error: 'label required' });
  const max = Math.min(Number(req.query.max) || 10, 50);
  const { rows } = await query(
    `SELECT DISTINCT c.id, c.title, c.updated_at, s.key AS space_key
       FROM content c
       JOIN spaces s ON s.id = c.space_id
       JOIN content_labels cl ON cl.content_id = c.id
       JOIN labels l ON l.id = cl.label_id
      WHERE c.status = 'current' AND l.name = ANY($1::text[])
        AND ($2::text IS NULL OR s.key = $2)
      ORDER BY c.updated_at DESC NULLS LAST LIMIT $3`,
    [labels, req.query.space || null, max]);
  return rows;
});

// ---------- 기존 Confluence URL 호환 ----------

async function redirectToContent(reply, id) {
  const { rows } = await query(
    `SELECT c.id, s.key FROM content c JOIN spaces s ON s.id = c.space_id WHERE c.id = $1`, [id]);
  if (!rows.length) return reply.code(404).send({ error: `content ${id} not migrated` });
  return reply.redirect(`/s/${rows[0].key}/p/${rows[0].id}`, 301);
}

app.get('/wiki/spaces/:key/pages/:id/*', (req, reply) => redirectToContent(reply, req.params.id));
app.get('/wiki/spaces/:key/pages/:id', (req, reply) => redirectToContent(reply, req.params.id));
app.get('/wiki/pages/viewpage.action', (req, reply) => {
  const id = Number(req.query.pageId);
  if (!id) return reply.code(400).send({ error: 'pageId required' });
  return redirectToContent(reply, id);
});
app.get('/wiki/x/:token', (req, reply) => {
  const id = decodeTinyToken(req.params.token);
  if (!id) return reply.code(400).send({ error: 'bad token' });
  return redirectToContent(reply, id);
});
app.get('/wiki/spaces/:key/overview', (req, reply) => reply.redirect(`/s/${req.params.key}`, 301));
app.get('/wiki/display/:key/*', (req, reply) => reply.redirect(`/s/${req.params.key}`, 301));

// ---------- SPA 정적 서빙 (web/dist 빌드가 있을 때) ----------
const dist = path.join(ROOT, 'web', 'dist');
if (await stat(dist).catch(() => null)) {
  await app.register(fastifyStatic, { root: dist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
console.log(`API http://localhost:${port}`);
