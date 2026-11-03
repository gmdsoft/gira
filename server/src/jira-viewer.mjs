// Jira PoC 앱 서버. 이관된 jira_* 테이블 조회 + 기본 쓰기(이슈/댓글/첨부/스프린트/필터).
// 원본 Jira Cloud API는 읽기 전용(GET, 첨부 프록시)으로만 쓴다 — 쓰기는 전부 로컬 DB.
// 인증은 Confluence 앱과 동일(auth.mjs, 테스트 계정 로그인) — 같은 DB 세션 쿠키를 공유한다.
// 실행: node server/src/jira-viewer.mjs  (기본 0.0.0.0:3002)
import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, DATA_DIR } from './db.mjs';
import { registerAuth } from './auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '..', '..', '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 32 * 1024 * 1024 });
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024, files: 5 } });

// 신규 ID가 이관된 ID와 겹치지 않도록 시퀀스 보정
await query(`SELECT setval('jira_issue_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM jira_issues), (SELECT last_value FROM jira_issue_id_seq)))`);
await query(`SELECT setval('jira_comment_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM jira_comments), (SELECT last_value FROM jira_comment_id_seq)))`);
await query(`SELECT setval('jira_attachment_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM jira_attachments), (SELECT last_value FROM jira_attachment_id_seq)))`);

await registerAuth(app); // /api/* 로그인 필수 (auth 라우트 제외)

app.get('/', (req, reply) => {
  reply.type('text/html').send(createReadStream(path.join(here, 'jira-viewer.html')));
});

// 플레인 텍스트 → 최소 ADF 문서 (PoC 입력용)
const textToAdf = (text) => ({
  type: 'doc', version: 1,
  content: String(text ?? '').split('\n').map((line) => ({
    type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
  })),
});

async function issueByKey(key) {
  const { rows } = await query(`SELECT id, project_id, issue_key FROM jira_issues WHERE issue_key = $1`, [key]);
  return rows[0] ?? null;
}

// ---------- 메타 ----------

app.get('/api/meta', async () => {
  const [projects, statuses, types, assignees, priorities] = await Promise.all([
    query(`SELECT id, key, name FROM jira_projects ORDER BY key`),
    query(`SELECT id, name, category FROM jira_statuses ORDER BY
             CASE category WHEN 'new' THEN 0 WHEN 'indeterminate' THEN 1 ELSE 2 END, id`),
    query(`SELECT id, name, subtask FROM jira_issue_types
            WHERE id IN (SELECT DISTINCT issue_type_id FROM jira_issues) ORDER BY subtask, name`),
    query(`SELECT DISTINCT u.id, u.display_name FROM users u
            JOIN jira_issues i ON i.assignee_id = u.id OR i.reporter_id = u.id ORDER BY u.display_name`),
    query(`SELECT DISTINCT priority FROM jira_issues WHERE priority IS NOT NULL`),
  ]);
  return {
    projects: projects.rows, statuses: statuses.rows, types: types.rows,
    assignees: assignees.rows, priorities: priorities.rows.map((r) => r.priority),
  };
});

// ---------- 이슈 목록/상세 ----------

app.get('/api/issues', async (req) => {
  const { project, status, type, assignee, priority, sprint, q } = req.query;
  const cond = ['1=1'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (project) cond.push(`pr.key = ${p(project)}`);
  if (status) cond.push(`i.status_id = ${p(status)}`);
  if (type) cond.push(`i.issue_type_id = ${p(type)}`);
  if (assignee) cond.push(`i.assignee_id = ${p(assignee)}`);
  if (priority) cond.push(`i.priority = ${p(priority)}`);
  if (sprint === 'none') cond.push(`i.sprint_id IS NULL`);
  else if (sprint) cond.push(`i.sprint_id = ${p(sprint)}`);
  if (q) cond.push(`(i.summary ILIKE ${p('%' + q + '%')} OR i.issue_key ILIKE ${p('%' + q + '%')})`);
  const { rows } = await query(
    `SELECT i.id, i.issue_key, i.summary, i.priority, i.updated_at, i.sprint_id, i.parent_id,
            t.name AS type_name, t.subtask,
            s.id AS status_id, s.name AS status_name, s.category AS status_category,
            u.display_name AS assignee_name
       FROM jira_issues i
       JOIN jira_projects pr ON pr.id = i.project_id
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN jira_statuses s ON s.id = i.status_id
       LEFT JOIN users u ON u.id = i.assignee_id
      WHERE ${cond.join(' AND ')}
      ORDER BY i.id DESC LIMIT 1000`, params);
  return rows;
});

app.get('/api/issue/:key', async (req, reply) => {
  const { rows } = await query(
    `SELECT i.*, t.name AS type_name, s.name AS status_name, s.category AS status_category,
            ua.display_name AS assignee_name, ur.display_name AS reporter_name,
            pi.issue_key AS parent_key, pi.summary AS parent_summary,
            sp.name AS sprint_name
       FROM jira_issues i
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN jira_statuses s ON s.id = i.status_id
       LEFT JOIN users ua ON ua.id = i.assignee_id
       LEFT JOIN users ur ON ur.id = i.reporter_id
       LEFT JOIN jira_issues pi ON pi.id = i.parent_id
       LEFT JOIN jira_sprints sp ON sp.id = i.sprint_id
      WHERE i.issue_key = $1`, [req.params.key]);
  const issue = rows[0];
  if (!issue) return reply.code(404).send({ error: 'not found' });
  delete issue.fields_raw;

  const [comments, attachments, links, subtasks] = await Promise.all([
    query(`SELECT c.id, c.body_adf, c.created_at, u.display_name AS author_name
             FROM jira_comments c LEFT JOIN users u ON u.id = c.author_id
            WHERE c.issue_id = $1 ORDER BY c.created_at`, [issue.id]),
    query(`SELECT id, filename, media_type, file_size, created_at FROM jira_attachments
            WHERE issue_id = $1 ORDER BY created_at`, [issue.id]),
    query(`SELECT l.link_type, l.inward_issue, l.outward_issue,
                  ii.issue_key AS inward_key, ii.summary AS inward_summary,
                  oi.issue_key AS outward_key, oi.summary AS outward_summary
             FROM jira_issue_links l
             LEFT JOIN jira_issues ii ON ii.id = l.inward_issue
             LEFT JOIN jira_issues oi ON oi.id = l.outward_issue
            WHERE l.inward_issue = $1 OR l.outward_issue = $1`, [issue.id]),
    query(`SELECT i.issue_key, i.summary, s.name AS status_name, s.category AS status_category
             FROM jira_issues i LEFT JOIN jira_statuses s ON s.id = i.status_id
            WHERE i.parent_id = $1 ORDER BY i.id`, [issue.id]),
  ]);
  return { ...issue, comments: comments.rows, attachments: attachments.rows, links: links.rows, subtasks: subtasks.rows };
});

// ---------- 이슈 생성/수정 ----------

app.post('/api/issues', async (req, reply) => {
  const { projectKey, typeId, summary, description, assigneeId, priority, parentKey, sprintId } = req.body ?? {};
  if (!projectKey || !typeId || !summary?.trim()) {
    return reply.code(400).send({ error: 'projectKey, typeId, summary는 필수입니다' });
  }
  const { rows: pr } = await query(`SELECT id, key FROM jira_projects WHERE key = $1`, [projectKey]);
  if (!pr.length) return reply.code(404).send({ error: 'project not found' });
  const project = pr[0];
  let parentId = null;
  if (parentKey?.trim()) {
    const parent = await issueByKey(parentKey.trim().toUpperCase());
    if (!parent) return reply.code(400).send({ error: `상위 이슈 ${parentKey}를 찾을 수 없습니다` });
    if (parent.project_id !== project.id) return reply.code(400).send({ error: '상위 이슈는 같은 프로젝트여야 합니다' });
    parentId = parent.id;
  }
  // 새 이슈 키: 프로젝트 내 최대 번호 + 1
  const { rows: mx } = await query(
    `SELECT COALESCE(MAX(split_part(issue_key, '-', 2)::int), 0) + 1 AS n
       FROM jira_issues WHERE project_id = $1`, [project.id]);
  const issueKey = `${project.key}-${mx[0].n}`;
  // 기본 상태: 'new' 카테고리 첫 상태
  const { rows: st } = await query(
    `SELECT id FROM jira_statuses WHERE category = 'new' ORDER BY id LIMIT 1`);
  const userId = req.access.userId;
  const { rows } = await query(
    `INSERT INTO jira_issues
       (id, project_id, issue_key, issue_type_id, status_id, summary, description_adf,
        priority, assignee_id, reporter_id, parent_id, sprint_id, created_at, updated_at, fields_raw)
     VALUES (nextval('jira_issue_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), '{}')
     RETURNING id, issue_key`,
    [project.id, issueKey, typeId, st[0]?.id ?? null, summary.trim(),
     description?.trim() ? JSON.stringify(textToAdf(description)) : null,
     priority || null, assigneeId || null, userId, parentId, sprintId || null]);
  return { id: rows[0].id, issueKey: rows[0].issue_key };
});

app.patch('/api/issue/:key', async (req, reply) => {
  const issue = await issueByKey(req.params.key);
  if (!issue) return reply.code(404).send({ error: 'not found' });
  const b = req.body ?? {};
  const sets = [];
  const params = [issue.id];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if ('statusId' in b) {
    sets.push(`status_id = ${p(b.statusId)}`);
    // done 카테고리로 이동하면 해결 시각 기록, 아니면 해제
    sets.push(`resolved_at = CASE WHEN (SELECT category FROM jira_statuses WHERE id = ${p(b.statusId)}) = 'done'
                                  THEN COALESCE(resolved_at, now()) ELSE NULL END`);
  }
  if ('sprintId' in b) sets.push(`sprint_id = ${p(b.sprintId || null)}`);
  if ('assigneeId' in b) sets.push(`assignee_id = ${p(b.assigneeId || null)}`);
  if ('priority' in b) sets.push(`priority = ${p(b.priority || null)}`);
  if ('summary' in b && b.summary?.trim()) sets.push(`summary = ${p(b.summary.trim())}`);
  if (!sets.length) return reply.code(400).send({ error: '변경할 필드가 없습니다' });
  sets.push(`updated_at = now()`);
  await query(`UPDATE jira_issues SET ${sets.join(', ')} WHERE id = $1`, params);
  return { ok: true };
});

// ---------- 댓글 ----------

app.post('/api/issue/:key/comments', async (req, reply) => {
  const issue = await issueByKey(req.params.key);
  if (!issue) return reply.code(404).send({ error: 'not found' });
  const text = req.body?.text?.trim();
  if (!text) return reply.code(400).send({ error: '내용을 입력하세요' });
  const { rows } = await query(
    `INSERT INTO jira_comments (id, issue_id, body_adf, author_id, created_at, updated_at)
     VALUES (nextval('jira_comment_id_seq'), $1, $2, $3, now(), now()) RETURNING id`,
    [issue.id, JSON.stringify(textToAdf(text)), req.access.userId]);
  await query(`UPDATE jira_issues SET updated_at = now() WHERE id = $1`, [issue.id]);
  return { id: rows[0].id };
});

// ---------- 첨부 ----------

app.post('/api/issue/:key/attachments', async (req, reply) => {
  const issue = await issueByKey(req.params.key);
  if (!issue) return reply.code(404).send({ error: 'not found' });
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'file required' });
  const buf = await file.toBuffer();
  const safe = file.filename.replace(/[^\w.\-]+/g, '_');
  const dir = path.join(DATA_DIR, 'jira-att', String(issue.id));
  await mkdir(dir, { recursive: true });
  const localKey = path.join('jira-att', String(issue.id), safe);
  await writeFile(path.join(DATA_DIR, localKey), buf);
  const { rows } = await query(
    `INSERT INTO jira_attachments (id, issue_id, filename, media_type, file_size, local_key, author_id, created_at)
     VALUES (nextval('jira_attachment_id_seq'), $1, $2, $3, $4, $5, $6, now()) RETURNING id`,
    [issue.id, file.filename, file.mimetype ?? null, buf.length, localKey, req.access.userId]);
  await query(`UPDATE jira_issues SET updated_at = now() WHERE id = $1`, [issue.id]);
  return { id: rows[0].id, filename: file.filename };
});

// 첨부 서빙: 로컬 업로드는 파일에서, 이관분은 원본 Jira 읽기 전용 프록시
app.get('/api/attachment/:id', async (req, reply) => {
  const { rows } = await query(
    `SELECT filename, media_type, source_url, local_key FROM jira_attachments WHERE id = $1`, [req.params.id]);
  const att = rows[0];
  if (!att) return reply.code(404).send({ error: 'not found' });
  reply.header('content-type', att.media_type ?? 'application/octet-stream');
  reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
  if (att.local_key) return reply.send(createReadStream(path.join(DATA_DIR, att.local_key)));
  if (!att.source_url) return reply.code(404).send({ error: 'no source' });
  const res = await fetch(att.source_url, { headers: { Authorization: AUTH } });
  if (!res.ok) return reply.code(502).send({ error: `원본 응답 ${res.status}` });
  return reply.send(res.body);
});

// ---------- 스프린트 ----------

app.get('/api/sprints', async (req) => {
  const { rows } = await query(
    `SELECT s.*, (SELECT count(*) FROM jira_issues i WHERE i.sprint_id = s.id) AS issue_count
       FROM jira_sprints s JOIN jira_projects p ON p.id = s.project_id
      WHERE p.key = $1
      ORDER BY CASE s.state WHEN 'active' THEN 0 WHEN 'future' THEN 1 ELSE 2 END, s.id`,
    [req.query.project]);
  return rows;
});

app.post('/api/sprints', async (req, reply) => {
  const { projectKey, name, goal } = req.body ?? {};
  if (!projectKey || !name?.trim()) return reply.code(400).send({ error: 'projectKey, name은 필수입니다' });
  const { rows: pr } = await query(`SELECT id FROM jira_projects WHERE key = $1`, [projectKey]);
  if (!pr.length) return reply.code(404).send({ error: 'project not found' });
  const { rows } = await query(
    `INSERT INTO jira_sprints (project_id, name, goal) VALUES ($1, $2, $3) RETURNING *`,
    [pr[0].id, name.trim(), goal?.trim() || null]);
  return rows[0];
});

app.patch('/api/sprints/:id', async (req, reply) => {
  const { rows: cur } = await query(`SELECT * FROM jira_sprints WHERE id = $1`, [req.params.id]);
  if (!cur.length) return reply.code(404).send({ error: 'not found' });
  const b = req.body ?? {};
  if (b.state === 'active') {
    // 같은 프로젝트에 활성 스프린트는 하나만
    const { rows: act } = await query(
      `SELECT id FROM jira_sprints WHERE project_id = $1 AND state = 'active' AND id != $2`,
      [cur[0].project_id, req.params.id]);
    if (act.length) return reply.code(409).send({ error: '이미 활성 스프린트가 있습니다. 먼저 완료하세요.' });
    await query(`UPDATE jira_sprints SET state = 'active', start_at = now() WHERE id = $1`, [req.params.id]);
  } else if (b.state === 'closed') {
    await query(`UPDATE jira_sprints SET state = 'closed', end_at = now() WHERE id = $1`, [req.params.id]);
    // Jira 기본 동작: 미완료 이슈는 백로그로 되돌린다 (done은 스프린트에 남김)
    await query(
      `UPDATE jira_issues SET sprint_id = NULL
        WHERE sprint_id = $1 AND status_id NOT IN (SELECT id FROM jira_statuses WHERE category = 'done')`,
      [req.params.id]);
  }
  if (b.name?.trim()) await query(`UPDATE jira_sprints SET name = $2 WHERE id = $1`, [req.params.id, b.name.trim()]);
  if ('goal' in b) await query(`UPDATE jira_sprints SET goal = $2 WHERE id = $1`, [req.params.id, b.goal?.trim() || null]);
  const { rows } = await query(`SELECT * FROM jira_sprints WHERE id = $1`, [req.params.id]);
  return rows[0];
});

// ---------- 저장 필터 ----------

app.get('/api/filters', async (req) => {
  const { rows } = await query(
    `SELECT id, name, params FROM jira_filters WHERE owner_id = $1 ORDER BY name`, [req.access.userId]);
  return rows;
});

app.post('/api/filters', async (req, reply) => {
  const { name, params } = req.body ?? {};
  if (!name?.trim()) return reply.code(400).send({ error: '이름을 입력하세요' });
  const { rows } = await query(
    `INSERT INTO jira_filters (owner_id, name, params) VALUES ($1, $2, $3) RETURNING id, name, params`,
    [req.access.userId, name.trim(), JSON.stringify(params ?? {})]);
  return rows[0];
});

app.delete('/api/filters/:id', async (req, reply) => {
  const { rowCount } = await query(
    `DELETE FROM jira_filters WHERE id = $1 AND owner_id = $2`, [req.params.id, req.access.userId]);
  if (!rowCount) return reply.code(404).send({ error: 'not found' });
  return { ok: true };
});

const port = Number(process.env.JIRA_VIEWER_PORT ?? 3002);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Jira 뷰어: http://0.0.0.0:${port}`);
