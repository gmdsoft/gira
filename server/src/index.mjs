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
import { query, DATA_DIR, closeDb } from './db.mjs';
import { decodeTinyToken } from './tinylink.mjs';
import { randomBytes } from 'node:crypto';
import { registerAuth, hashToken } from './auth.mjs';
import { spaceRole, contentAccess, filterViewable, visibleTreeSet } from './perm.mjs';
import { registerMyApiKeys } from './me-keys.mjs';
import { registerSelfMigrate } from './self-migrate.mjs';
import { exportSpace, importSpace } from './gonf-package.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = process.env.ATLASSIAN_EMAIL && process.env.ATLASSIAN_API_TOKEN
  ? 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64')
  : null;

const app = Fastify({
  logger: { level: 'warn' },
  bodyLimit: 32 * 1024 * 1024,
  // 외부 연동용 안정 별칭: /api/v1/* → 내부 라우트 (docs/api-v1.md)
  rewriteUrl(req) {
    const u = req.url;
    if (!u.startsWith('/api/v1/')) return u;
    return u
      .replace(/^\/api\/v1\/pages\/([^/?]+)/, '/api/content/$1')
      .replace(/^\/api\/v1\//, '/api/');
  },
});

// 새 콘텐츠·첨부 ID가 이관된 ID와 겹치지 않도록 시퀀스 보정
await query(`SELECT setval('content_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM content), (SELECT last_value FROM content_id_seq)))`);
await query(`SELECT setval('attachment_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM attachments), (SELECT last_value FROM attachment_id_seq)))`);
await query(`SELECT setval('comment_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM comments), (SELECT last_value FROM comment_id_seq)))`);

await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024, files: 5 } });

// 로그인 세션 + /api/* 인증 훅 (라우트 선언보다 먼저 등록해야 훅이 적용된다)
await registerAuth(app);
registerMyApiKeys(app); // 개인 API 키 셀프 발급
registerSelfMigrate(app, { kind: 'conf' }); // 팀장 셀프 이관 (원본 Confluence → 이 인스턴스)

// 자주 쓰는 권한 검사: 보기/편집 불가 시 403(없으면 404)을 보내고 null 반환
async function requireAccess(req, reply, contentId, need = 'view') {
  const a = await contentAccess(req.access, contentId);
  if (!a.exists) { reply.code(404).send({ error: 'not found' }); return null; }
  if (!a[need]) { reply.code(403).send({ error: need === 'edit' ? '편집 권한이 없습니다' : '볼 수 있는 권한이 없습니다' }); return null; }
  return a;
}

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

app.get('/api/spaces', async (req) => {
  const { rows } = await query(
    `SELECT id, key, name, type, status, homepage_id FROM spaces ORDER BY name`);
  const out = [];
  for (const s of rows) {
    const role = await spaceRole(req.access, s.id);
    if (role) out.push({ ...s, role });
  }
  return out;
});

// 스페이스 생성 — 정책(알파): 팀장·파트장 직책, can_create 그룹 멤버, 사이트 관리자는 일반 스페이스를,
// 일반 구성원은 자신의 개인 스페이스 1개만 만들 수 있다. 생성자는 그 스페이스의 관리자가 된다.
app.post('/api/spaces', async (req, reply) => {
  const userId = req.access.userId;
  const personal = req.body?.type === 'personal';
  const name = req.body?.name?.trim();
  if (personal) {
    const key = '~' + userId;
    const { rows: exist } = await query(`SELECT key FROM spaces WHERE key = $1`, [key]);
    if (exist.length) return reply.code(409).send({ error: '개인 스페이스는 1개만 만들 수 있습니다', key });
    const { rows: me } = await query(`SELECT display_name FROM users WHERE id = $1`, [userId]);
    const spName = name || `${me[0]?.display_name ?? '내'}의 스페이스`;
    const { rows } = await query(
      `INSERT INTO spaces (id, key, name, type, status, created_at)
       VALUES ((SELECT coalesce(max(id), 0) + 1 FROM spaces), $1, $2, 'personal', 'current', now())
       RETURNING id, key, name`, [key, spName]);
    await query(`INSERT INTO space_permissions (space_id, principal_type, principal_id, role)
                 VALUES ($1, 'user', $2, 'admin')`, [rows[0].id, userId]);
    return rows[0];
  }
  if (!req.access.canCreate) {
    return reply.code(403).send({ error: '스페이스를 만들 권한이 없습니다 (팀장·파트장 또는 지정 그룹만)' });
  }
  const key = req.body?.key?.trim()?.toUpperCase();
  if (!name || !key || !/^[A-Z][A-Z0-9]{1,19}$/.test(key)) {
    return reply.code(400).send({ error: '이름과 키(영문 시작, 대문자·숫자 2~20자)를 입력하세요' });
  }
  const { rows: dup } = await query(`SELECT 1 FROM spaces WHERE key = $1`, [key]);
  if (dup.length) return reply.code(409).send({ error: '이미 사용 중인 키입니다' });
  const { rows } = await query(
    `INSERT INTO spaces (id, key, name, type, status, created_at)
     VALUES ((SELECT coalesce(max(id), 0) + 1 FROM spaces), $1, $2, 'global', 'current', now())
     RETURNING id, key, name`, [key, name]);
  await query(`INSERT INTO space_permissions (space_id, principal_type, principal_id, role)
               VALUES ($1, 'user', $2, 'admin')`, [rows[0].id, userId]);
  return rows[0];
});

// 홈 '최근 업데이트' 피드 — 접근 가능한 스페이스의 최신 수정 페이지 (마지막 편집자 포함)
app.get('/api/home/recent', async (req) => {
  const { rows } = await query(
    `SELECT c.id, c.title, c.updated_at, s.id AS space_id, s.key AS space_key, s.name AS space_name,
            u.display_name AS editor
       FROM content c
       JOIN spaces s ON s.id = c.space_id
       LEFT JOIN content_versions v ON v.content_id = c.id AND v.version = c.current_version
       LEFT JOIN users u ON u.id = v.author_id
      WHERE c.type IN ('page', 'live') AND c.status = 'current'
      ORDER BY c.updated_at DESC
      LIMIT 80`);
  const out = [];
  const roleCache = new Map(); // 스페이스 단위 권한 확인 반복 방지
  for (const r of rows) {
    let role = roleCache.get(r.space_id);
    if (role === undefined) { role = await spaceRole(req.access, r.space_id); roleCache.set(r.space_id, role); }
    if (role) out.push(r);
    if (out.length >= 20) break;
  }
  return out;
});

app.get('/api/spaces/:key', async (req, reply) => {
  const { rows } = await query(`SELECT id, key, name, type, status, homepage_id FROM spaces WHERE key = $1`, [req.params.key]);
  if (!rows.length) return reply.code(404).send({ error: 'space not found' });
  const space = rows[0];
  const role = await spaceRole(req.access, space.id);
  if (!role) return reply.code(403).send({ error: '이 스페이스를 볼 수 있는 권한이 없습니다', canRequest: true, key: req.params.key });
  const { rows: tree } = await query(
    `SELECT id, parent_id, type, title, position, status, current_version
       FROM content WHERE space_id = $1 AND status = 'current'
      ORDER BY position NULLS LAST, created_at NULLS LAST, title`, [space.id]);
  const visible = await visibleTreeSet(req.access, space.id, role, tree);
  return { ...space, role, tree: visible ? tree.filter((n) => visible.has(String(n.id))) : tree };
});

app.get('/api/content/:id', async (req, reply) => {
  const acc = await requireAccess(req, reply, req.params.id);
  if (!acc) return;
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
  const { rows: childRows } = await query(
    `SELECT id, type, title FROM content WHERE parent_id = $1 AND status = 'current'
      ORDER BY position NULLS LAST, created_at NULLS LAST, title`, [c.id]);
  const childOk = await filterViewable(req.access, childRows.map((r) => r.id));
  return {
    children: childRows.filter((r) => childOk.has(String(r.id))),
    canEdit: acc.edit, role: acc.role,
    id: c.id, spaceKey: c.space_key, spaceName: c.space_name, parentId: c.parent_id,
    type: c.type, title: c.title, status: c.status, fullWidth: c.full_width, authorName: c.author_name,
    createdAt: c.created_at, updatedAt: c.updated_at, version: ver[0] ?? null,
    labels: labels.map((l) => l.name), attachments,
    commentCounts: Object.fromEntries(counts.map((r) => [r.kind, r.n])),
  };
});

app.get('/api/content/:id/comments', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id)) return;
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
      WHERE c.title = $1 AND ($2::text IS NULL OR s.key = $2) LIMIT 5`, [title, spaceKey || null]);
  const ok = await filterViewable(req.access, rows.map((r) => r.id));
  const hit = rows.find((r) => ok.has(String(r.id)));
  if (!hit) return reply.code(404).send({ error: 'not found' });
  return { id: hit.id, spaceKey: hit.space_key };
});

// 첨부 프록시: 원본 Confluence에서 받아 캐시 후 서빙 (PoC. 운영은 MinIO presigned URL)
app.get('/api/att/:contentId/:filename', async (req, reply) => {
  const { contentId } = req.params;
  if (!await requireAccess(req, reply, contentId)) return;
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

app.get('/api/content/:id/draft', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id, 'edit')) return;
  const { rows } = await query(`SELECT doc, title, base_version, updated_at FROM drafts WHERE content_id = $1`, [req.params.id]);
  if (!rows.length) return reply.code(404).send({ error: 'no draft' });
  return rows[0];
});

app.put('/api/content/:id/draft', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id, 'edit')) return;
  const { doc, title, baseVersion } = req.body;
  const userId = req.access.userId;
  await query(
    `INSERT INTO drafts (content_id, doc, title, base_version, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (content_id) DO UPDATE SET doc = EXCLUDED.doc, title = EXCLUDED.title,
       base_version = EXCLUDED.base_version, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.params.id, JSON.stringify(doc), title?.trim() || null, baseVersion ?? null, userId]);
  return { ok: true, savedAt: new Date().toISOString() };
});

app.delete('/api/content/:id/draft', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id, 'edit')) return;
  await query(`DELETE FROM drafts WHERE content_id = $1`, [req.params.id]);
  return { ok: true };
});

// 게시: 초안(또는 본문 직접 전달)을 새 버전으로
app.post('/api/content/:id/publish', async (req, reply) => {
  const id = req.params.id;
  if (!await requireAccess(req, reply, id, 'edit')) return;
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
  const userId = req.access.userId;
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
  const role = await spaceRole(req.access, sp[0].id);
  if (!role || role === 'viewer') return reply.code(403).send({ error: '이 스페이스에 페이지를 만들 권한이 없습니다' });
  if (parentId != null && !await requireAccess(req, reply, parentId)) return;
  const userId = req.access.userId;
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
  if (!await requireAccess(req, reply, contentId, 'edit')) return;
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'file required' });
  const buf = await file.toBuffer();
  const filename = file.filename;
  const userId = req.access.userId;
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
    const res = await searchSvc.search({ q: q.trim(), spaceKey: space || undefined, type: type || undefined });
    // 권한 필터: 볼 수 없는 문서는 결과에서 제외
    const ok = await filterViewable(req.access, res.hits.map((h) => h.id));
    const hits = res.hits.filter((h) => ok.has(String(h.id)));
    return { ...res, total: res.total - (res.hits.length - hits.length), hits };
  } catch (e) {
    req.log.error(e);
    return reply.code(503).send({ error: '검색 엔진에 연결할 수 없습니다' });
  }
});

// 특정 버전 본문
app.get('/api/content/:id/versions/:v', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id)) return;
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
  if (!await requireAccess(req, reply, id, 'edit')) return;
  const v = Number(req.body?.version);
  if (!v) return reply.code(400).send({ error: 'version required' });
  const { rows } = await query(`SELECT doc FROM content_versions WHERE content_id = $1 AND version = $2`, [id, v]);
  if (!rows.length || !rows[0].doc) return reply.code(404).send({ error: 'version not found or empty' });
  const { rows: cur } = await query(`SELECT current_version FROM content WHERE id = $1`, [id]);
  const next = Number(cur[0].current_version) + 1;
  const userId = req.access.userId;
  await query(
    `INSERT INTO content_versions (content_id, version, doc, message, minor_edit, author_id, created_at)
     VALUES ($1, $2, $3, $4, false, $5, now())`,
    [id, next, JSON.stringify(rows[0].doc), `v${v} 복원`, userId]);
  await query(`UPDATE content SET current_version = $2, updated_at = now() WHERE id = $1`, [id, next]);
  reindex(id);
  return { ok: true, version: next };
});

app.get('/api/content/:id/versions', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id)) return;
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
  const ok = await filterViewable(req.access, rows.map((r) => r.id));
  return rows.filter((r) => ok.has(String(r.id)));
});

// 복사본 만들기: 현재 본문을 형제 페이지로 복제 (첨부 메타·캐시 포함)
app.post('/api/content/:id/copy', async (req, reply) => {
  const id = req.params.id;
  if (!await requireAccess(req, reply, id, 'edit')) return;
  const { rows } = await query(
    `SELECT c.*, s.key AS space_key, v.doc
       FROM content c JOIN spaces s ON s.id = c.space_id
       LEFT JOIN content_versions v ON v.content_id = c.id AND v.version = c.current_version
      WHERE c.id = $1`, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  const src = rows[0];
  const userId = req.access.userId;
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
  if (!await requireAccess(req, reply, id, 'edit')) return;
  const { parentId, spaceKey } = req.body ?? {};
  const { rows: cur } = await query(`SELECT space_id FROM content WHERE id = $1`, [id]);
  if (!cur.length) return reply.code(404).send({ error: 'not found' });
  let targetSpaceId;
  const newParent = parentId ?? null;
  if (newParent != null) {
    if (Number(newParent) === id) return reply.code(400).send({ error: '자기 자신 밑으로는 옮길 수 없습니다' });
    if (!await requireAccess(req, reply, newParent, 'edit')) return;
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
    const targetRole = await spaceRole(req.access, targetSpaceId);
    if (!targetRole || targetRole === 'viewer') return reply.code(403).send({ error: '대상 스페이스에 쓸 권한이 없습니다' });
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
  if (!await requireAccess(req, reply, req.params.id, 'edit')) return;
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
  const role = await spaceRole(req.access, sp[0].id);
  if (!role || role === 'viewer') return reply.code(403).send({ error: '권한이 없습니다' });
  const { rows } = await query(
    `SELECT id, title, type, status, updated_at FROM content
      WHERE space_id = $1 AND status IN ('archived', 'trashed')
      ORDER BY updated_at DESC`, [sp[0].id]);
  const ok = await filterViewable(req.access, rows.map((r) => r.id));
  return rows.filter((r) => ok.has(String(r.id)));
});

// 댓글 작성 (하단 footer / 본문 선택 영역 inline)
app.post('/api/content/:id/comments', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id)) return; // 댓글은 볼 수 있으면 작성 가능
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
  const userId = req.access.userId;
  const { rows } = await query(
    `INSERT INTO comments (id, content_id, kind, inline_ref, doc, author_id, created_at)
     VALUES (nextval('comment_id_seq'), $1, $2, $3, $4, $5, now()) RETURNING id`,
    [req.params.id, k, k === 'inline' ? inlineRef.trim().slice(0, 500) : null, JSON.stringify(body), userId]);
  return { ok: true, id: rows[0].id };
});

// 댓글 해결/재오픈
app.post('/api/comments/:id/resolve', async (req, reply) => {
  const { rows: cm } = await query(`SELECT content_id FROM comments WHERE id = $1`, [req.params.id]);
  if (!cm.length) return reply.code(404).send({ error: 'comment not found' });
  if (!await requireAccess(req, reply, cm[0].content_id)) return;
  const resolved = req.body?.resolved !== false;
  const { rows } = await query(`UPDATE comments SET resolved = $2 WHERE id = $1 RETURNING id`, [req.params.id, resolved]);
  if (!rows.length) return reply.code(404).send({ error: 'comment not found' });
  return { ok: true, resolved };
});

// 레이블 추가/삭제
app.post('/api/content/:id/labels', async (req, reply) => {
  const id = req.params.id;
  if (!await requireAccess(req, reply, id, 'edit')) return;
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
  const ok = await filterViewable(req.access, rows.map((r) => r.id));
  return rows.filter((r) => ok.has(String(r.id)));
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
  const ok = await filterViewable(req.access, rows.map((r) => r.id));
  return rows.filter((r) => ok.has(String(r.id)));
});

// ---------- 권한 관리: 사이트 관리자, 그룹(팀), 스페이스 권한, 페이지 제한, API 키 ----------

function requireAdmin(req, reply) {
  if (req.access.isAdmin) return true;
  reply.code(403).send({ error: '사이트 관리자만 사용할 수 있습니다' });
  return false;
}

// 권한 선택 UI용 사용자·그룹 검색
app.get('/api/principals', async (req) => {
  const q = (req.query.q ?? '').trim();
  const { rows: users } = await query(
    `SELECT id, display_name, email, confluence_account_id FROM users
      WHERE active AND display_name IS NOT NULL AND confluence_account_id IS DISTINCT FROM 'local-dev'
        AND ($1 = '' OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
      ORDER BY display_name LIMIT 10`, [q]);
  const { rows: groups } = await query(
    `SELECT id, name FROM groups WHERE $1 = '' OR name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 10`, [q]);
  const { rows: teams } = await query(
    `SELECT t.id, t.name, p.name AS parent_name
       FROM teams t LEFT JOIN teams p ON p.id = t.parent_id
      WHERE $1 = '' OR t.name ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%'
      ORDER BY coalesce(p.name, t.name), t.parent_id NULLS FIRST, t.name LIMIT 15`, [q]);
  return {
    users: users.map((u) => ({ type: 'user', id: u.id, name: u.display_name, email: u.email, accountId: u.confluence_account_id })),
    groups: groups.map((g) => ({ type: 'group', id: g.id, name: g.name })),
    teams: teams.map((t) => ({
      type: 'team', id: t.id, part: !!t.parent_name,
      name: t.parent_name ? `${t.parent_name} / ${t.name}` : t.name,
    })),
  };
});


// 스페이스 권한 (스페이스 admin 이상)
async function requireSpaceAdmin(req, reply, spaceKey) {
  const { rows: sp } = await query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
  if (!sp.length) { reply.code(404).send({ error: 'space not found' }); return null; }
  const role = await spaceRole(req.access, sp[0].id);
  if (role !== 'admin') { reply.code(403).send({ error: '스페이스 관리자만 변경할 수 있습니다' }); return null; }
  return sp[0].id;
}

app.get('/api/spaces/:key/permissions', async (req, reply) => {
  const spaceId = await requireSpaceAdmin(req, reply, req.params.key);
  if (!spaceId) return;
  const { rows } = await query(
    `SELECT p.principal_type, p.principal_id, p.role,
            CASE p.principal_type
              WHEN 'user' THEN u.display_name
              WHEN 'group' THEN g.name
              WHEN 'team' THEN CASE WHEN tp.id IS NULL THEN t.name ELSE tp.name || ' / ' || t.name END
              ELSE '로그인한 모든 사용자' END AS name
       FROM space_permissions p
       LEFT JOIN users u ON p.principal_type = 'user' AND u.id = p.principal_id
       LEFT JOIN groups g ON p.principal_type = 'group' AND g.id = p.principal_id
       LEFT JOIN teams t ON p.principal_type = 'team' AND t.id = p.principal_id
       LEFT JOIN teams tp ON tp.id = t.parent_id
      WHERE p.space_id = $1 ORDER BY p.role DESC, name`, [spaceId]);
  return rows;
});

app.put('/api/spaces/:key/permissions', async (req, reply) => {
  const spaceId = await requireSpaceAdmin(req, reply, req.params.key);
  if (!spaceId) return;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  for (const r of rows) {
    if (!['user', 'group', 'team', 'anyone'].includes(r.principalType) || !['viewer', 'editor', 'admin'].includes(r.role)) {
      return reply.code(400).send({ error: '잘못된 권한 행입니다' });
    }
  }
  // 전체 교체. 규칙을 두는 순간 목록에 없는 사용자는 접근 불가가 되므로,
  // 요청자 자신이 잠기지 않도록 항상 본인을 admin으로 보강한다 (사이트 관리자는 제외).
  if (rows.length && !req.access.isAdmin) {
    const self = rows.some((r) => r.principalType === 'user' && Number(r.principalId) === req.access.userId && r.role === 'admin');
    if (!self) rows.push({ principalType: 'user', principalId: req.access.userId, role: 'admin' });
  }
  await query(`DELETE FROM space_permissions WHERE space_id = $1`, [spaceId]);
  for (const r of rows) {
    await query(
      `INSERT INTO space_permissions (space_id, principal_type, principal_id, role)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [spaceId, r.principalType, r.principalType === 'anyone' ? 0 : Number(r.principalId), r.role]);
  }
  return { ok: true, count: rows.length };
});

// 페이지 접근 제한 (편집 권한이 있는 사용자가 설정)
app.get('/api/content/:id/restrictions', async (req, reply) => {
  const acc = await requireAccess(req, reply, req.params.id);
  if (!acc) return;
  const { rows } = await query(
    `SELECT r.rtype, r.principal_type, r.principal_id,
            CASE r.principal_type
              WHEN 'user' THEN u.display_name
              WHEN 'group' THEN g.name
              ELSE CASE WHEN tp.id IS NULL THEN t.name ELSE tp.name || ' / ' || t.name END END AS name
       FROM content_restrictions r
       LEFT JOIN users u ON r.principal_type = 'user' AND u.id = r.principal_id
       LEFT JOIN groups g ON r.principal_type = 'group' AND g.id = r.principal_id
       LEFT JOIN teams t ON r.principal_type = 'team' AND t.id = r.principal_id
       LEFT JOIN teams tp ON tp.id = t.parent_id
      WHERE r.content_id = $1 ORDER BY r.rtype, name`, [req.params.id]);
  // 조상에 걸린 보기 제한(상속)도 함께 보여준다
  const { rows: inherited } = await query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM content WHERE id = $1
       UNION ALL SELECT c.id, c.parent_id FROM content c JOIN up ON c.id = up.parent_id
     )
     SELECT DISTINCT c.id, c.title FROM content_restrictions r
       JOIN up ON up.id = r.content_id AND up.id != $1
       JOIN content c ON c.id = r.content_id
      WHERE r.rtype = 'view'`, [req.params.id]);
  return { restrictions: rows, inheritedFrom: inherited, canEdit: acc.edit };
});

app.put('/api/content/:id/restrictions', async (req, reply) => {
  if (!await requireAccess(req, reply, req.params.id, 'edit')) return;
  const list = Array.isArray(req.body?.restrictions) ? req.body.restrictions : [];
  for (const r of list) {
    if (!['view', 'edit'].includes(r.rtype) || !['user', 'group', 'team'].includes(r.principalType) || !Number(r.principalId)) {
      return reply.code(400).send({ error: '잘못된 제한 행입니다' });
    }
  }
  // 보기 제한을 두면서 자신이 빠지면 저장 직후 본인이 못 보게 되므로 본인을 보강한다
  const hasView = list.some((r) => r.rtype === 'view');
  if (hasView && !req.access.isAdmin) {
    const selfView = list.some((r) => r.rtype === 'view' && r.principalType === 'user' && Number(r.principalId) === req.access.userId);
    if (!selfView) list.push({ rtype: 'view', principalType: 'user', principalId: req.access.userId });
  }
  await query(`DELETE FROM content_restrictions WHERE content_id = $1`, [req.params.id]);
  for (const r of list) {
    await query(
      `INSERT INTO content_restrictions (content_id, rtype, principal_type, principal_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [req.params.id, r.rtype, r.principalType, Number(r.principalId)]);
  }
  return { ok: true };
});

// ---------- 개발참여: Gira의 GIRA 개발 프로젝트로 프록시 ----------
// 서비스 키(GIRA_SERVICE_KEY)로 Gira에 이슈를 만들고, 실제 작성자 이름을 설명에 남긴다.
app.post('/api/dev-feedback', async (req, reply) => {
  const giraUrl = (process.env.GIRA_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  const key = process.env.GIRA_SERVICE_KEY;
  if (!key) return reply.code(500).send({ error: 'GIRA_SERVICE_KEY가 설정되지 않았습니다 (관리자에게 문의)' });
  const { rows: me } = await query(`SELECT display_name FROM users WHERE id = $1`, [req.access.userId]);
  const res = await fetch(giraUrl + '/api/dev-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      kind: req.body?.kind, title: req.body?.title, detail: req.body?.detail,
      author: me[0]?.display_name ?? null, source: 'Gonfluence',
    }),
  });
  const body = await res.json().catch(() => ({}));
  return reply.code(res.status).send(body);
});

// 개발참여 챗봇: Gira의 /api/dev-chat 으로 프록시 (대화 세션은 Gira 쪽에 저장)
async function proxyDevChat(req, reply, method, pathName, body) {
  const giraUrl = (process.env.GIRA_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  const key = process.env.GIRA_SERVICE_KEY;
  if (!key) return reply.code(500).send({ error: 'GIRA_SERVICE_KEY가 설정되지 않았습니다 (관리자에게 문의)' });
  const res = await fetch(giraUrl + pathName, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return reply.code(res.status).send(await res.json().catch(() => ({})));
}
app.post('/api/dev-chat', async (req, reply) => {
  const { rows: me } = await query(`SELECT display_name FROM users WHERE id = $1`, [req.access.userId]);
  return proxyDevChat(req, reply, 'POST', '/api/dev-chat', {
    sessionId: req.body?.sessionId, message: req.body?.message,
    author: me[0]?.display_name ?? null, source: 'Gonfluence',
  });
});
app.get('/api/dev-chat/:id', async (req, reply) => {
  const { rows: me } = await query(`SELECT display_name FROM users WHERE id = $1`, [req.access.userId]);
  return proxyDevChat(req, reply, 'GET',
    `/api/dev-chat/${encodeURIComponent(req.params.id)}?author=${encodeURIComponent(me[0]?.display_name ?? '')}`);
});

// ---------- 스페이스 패키지 내보내기/가져오기 ----------

// 내보내기: 스페이스 관리자(또는 사이트 관리자)
app.get('/api/spaces/:key/export', async (req, reply) => {
  const spaceId = await requireSpaceAdmin(req, reply, req.params.key);
  if (!spaceId) return;
  const { zip } = await exportSpace(spaceId);
  reply.header('content-type', 'application/zip');
  reply.header('content-disposition', `attachment; filename="gonfluence-${req.params.key}-${new Date().toISOString().slice(0, 10)}.zip"`);
  return reply.send(zip.toBuffer());
});

// 가져오기: 생성 권한자(팀장·파트장·지정 그룹·사이트 관리자)
app.post('/api/spaces/import', async (req, reply) => {
  if (!req.access.canCreate) {
    return reply.code(403).send({ error: '스페이스를 가져올 권한이 없습니다 (팀장·파트장 또는 지정 그룹만)' });
  }
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: '패키지(.zip) 파일을 올려주세요' });
  const buf = await file.toBuffer();
  try {
    return await importSpace(buf, req.access.userId);
  } catch (e) {
    if (e.status) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
});

// ---------- 접근 권한 요청 ----------
// 권한 없는 스페이스에 보기/편집을 요청한다. 리소스의 제목·내용은 요청자에게 노출하지 않는다.
app.post('/api/access-requests', async (req, reply) => {
  const { spaceKey, want, reason } = req.body ?? {};
  const w = ['viewer', 'editor'].includes(want) ? want : 'viewer';
  const { rows: sp } = await query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
  if (!sp.length) return reply.code(404).send({ error: 'space not found' });
  const role = await spaceRole(req.access, sp[0].id);
  if (role) return reply.code(400).send({ error: '이미 접근 권한이 있습니다', role });
  const { rows: dup } = await query(
    `SELECT id FROM access_requests
      WHERE resource_type = 'space' AND resource_id = $1 AND user_id = $2 AND status = 'pending'`,
    [sp[0].id, req.access.userId]);
  if (dup.length) return { ok: true, id: dup[0].id, duplicated: true };
  const { rows } = await query(
    `INSERT INTO access_requests (resource_type, resource_id, user_id, want, reason)
     VALUES ('space', $1, $2, $3, $4) RETURNING id`,
    [sp[0].id, req.access.userId, w, (reason ?? '').slice(0, 2000) || null]);
  return { ok: true, id: rows[0].id };
});

// 내 요청 이력 (스페이스 이름은 승인 전 비노출 — 키만 보여준다)
app.get('/api/access-requests/mine', async (req) => {
  const { rows } = await query(
    `SELECT r.id, r.want, r.reason, r.status, r.created_at, r.decided_at,
            s.key AS space_key, d.display_name AS decided_by_name
       FROM access_requests r
       JOIN spaces s ON s.id = r.resource_id
       LEFT JOIN users d ON d.id = r.decided_by
      WHERE r.resource_type = 'space' AND r.user_id = $1
      ORDER BY r.created_at DESC LIMIT 50`, [req.access.userId]);
  return rows;
});

// 승인함: 내가 관리자인 스페이스의 대기 요청 (사이트 관리자는 전체)
app.get('/api/access-requests/inbox', async (req) => {
  const { rows } = await query(
    `SELECT r.id, r.want, r.reason, r.status, r.created_at, r.resource_id,
            s.key AS space_key, s.name AS space_name,
            u.display_name AS user_name, u.email AS user_email
       FROM access_requests r
       JOIN spaces s ON s.id = r.resource_id
       JOIN users u ON u.id = r.user_id
      WHERE r.resource_type = 'space' AND r.status = 'pending'
      ORDER BY r.created_at`);
  const out = [];
  const cache = new Map();
  for (const r of rows) {
    let role = cache.get(r.resource_id);
    if (role === undefined) { role = await spaceRole(req.access, r.resource_id); cache.set(r.resource_id, role); }
    if (role === 'admin') out.push(r);
  }
  return out;
});

app.post('/api/access-requests/:id/decide', async (req, reply) => {
  const approve = !!req.body?.approve;
  const { rows: rq } = await query(
    `SELECT id, resource_id, user_id, want, status FROM access_requests
      WHERE id = $1 AND resource_type = 'space'`, [req.params.id]);
  if (!rq.length) return reply.code(404).send({ error: 'not found' });
  if (rq[0].status !== 'pending') return reply.code(400).send({ error: '이미 처리된 요청입니다' });
  const role = await spaceRole(req.access, rq[0].resource_id);
  if (role !== 'admin') return reply.code(403).send({ error: '이 스페이스의 관리자만 처리할 수 있습니다' });
  if (approve) {
    await query(
      `INSERT INTO space_permissions (space_id, principal_type, principal_id, role)
       VALUES ($1, 'user', $2, $3) ON CONFLICT DO NOTHING`,
      [rq[0].resource_id, rq[0].user_id, rq[0].want]);
  }
  await query(
    `UPDATE access_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
    [req.params.id, approve ? 'approved' : 'denied', req.access.userId]);
  return { ok: true };
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

// 컨테이너 헬스체크·로드밸런서용 (인증 훅은 /api/* 만 가드하므로 로그인 불필요)
app.get('/healthz', async () => {
  await query('SELECT 1');
  return { ok: true, app: 'gonfluence' };
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
console.log(`API http://localhost:${port}`);

// 종료 시그널에서 연결을 정리 (docker stop 등)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    try { await app.close(); await closeDb(); } finally { process.exit(0); }
  });
}
