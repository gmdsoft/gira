// Jira PoC 앱 서버. 이관된 jira_* 테이블 조회 + 기본 쓰기(이슈/댓글/첨부/스프린트/필터).
// 원본 Jira Cloud API는 읽기 전용(GET, 첨부 프록시)으로만 쓴다 — 쓰기는 전부 로컬 DB.
// 인증은 Confluence 앱과 동일(auth.mjs, 테스트 계정 로그인) — 같은 DB 세션 쿠키를 공유한다.
// 실행: node server/src/jira-viewer.mjs  (기본 0.0.0.0:3002)
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, DATA_DIR } from './db.mjs';
import { registerAuth } from './auth.mjs';
import { parseJql, JqlError } from './jql.mjs';

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
await query(`SELECT setval('jira_sprints_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM jira_sprints), (SELECT last_value FROM jira_sprints_id_seq)))`);

await registerAuth(app); // /api/* 로그인 필수 (auth 라우트 제외)

// React SPA 서빙 (web/dist-jira-app — npm --workspace web run build:jira 로 생성)
const DIST = path.join(here, '..', '..', 'web', 'dist-jira-app');
// wildcard 서빙: 재빌드로 애셋 해시가 바뀌어도 서버 재시작 불필요
await app.register(fastifyStatic, { root: DIST, index: false });
const page = (req, reply) => reply.type('text/html')
  .header('cache-control', 'no-cache') // 재배포 시 옛 빌드가 휴리스틱 캐시로 남지 않도록
  .send(createReadStream(path.join(DIST, 'jira.html')));
app.get('/', page);
app.get('/browse/:key', page);                 // Jira 호환 이슈 주소
app.get('/projects/:pkey/:view', page);        // 프로젝트 뷰 주소 (list|table|board|backlog)

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
  const [projects, statuses, types, assignees, priorities, resolutions] = await Promise.all([
    query(`SELECT id, key, name FROM jira_projects ORDER BY key`),
    query(`SELECT id, name, category FROM jira_statuses ORDER BY
             CASE category WHEN 'new' THEN 0 WHEN 'indeterminate' THEN 1 ELSE 2 END, id`),
    query(`SELECT id, name, subtask FROM jira_issue_types
            WHERE id IN (SELECT DISTINCT issue_type_id FROM jira_issues) ORDER BY subtask, name`),
    query(`SELECT DISTINCT u.id, u.display_name FROM users u
            JOIN jira_issues i ON i.assignee_id = u.id OR i.reporter_id = u.id ORDER BY u.display_name`),
    query(`SELECT DISTINCT priority FROM jira_issues WHERE priority IS NOT NULL`),
    query(`SELECT DISTINCT resolution FROM jira_issues WHERE resolution IS NOT NULL`),
  ]);
  return {
    projects: projects.rows, statuses: statuses.rows, types: types.rows,
    assignees: assignees.rows, priorities: priorities.rows.map((r) => r.priority),
    resolutions: resolutions.rows.map((r) => r.resolution),
  };
});

// 프로젝트 버전 목록 (수정 버전 선택용)
app.get('/api/versions', async (req) => {
  const { rows } = await query(
    `SELECT v.id, v.name, v.released FROM jira_versions v
       JOIN jira_projects p ON p.id = v.project_id
      WHERE p.key = $1 ORDER BY v.name`, [req.query.project]);
  return rows;
});

// 프로젝트의 레이블·컴포넌트 목록 (JQL 자동완성 값 제안용)
app.get('/api/labels', async (req) => {
  const one = async (col) => (await query(
    `SELECT DISTINCT unnest(i.${col}) AS v FROM jira_issues i
       JOIN jira_projects p ON p.id = i.project_id WHERE p.key = $1 ORDER BY v`, [req.query.project]))
    .rows.map((r) => r.v);
  const [labels, components] = await Promise.all([one('labels'), one('components')]);
  return { labels, components };
});

// ---------- 이슈 목록/상세 ----------

// 정렬 가능 컬럼 (화이트리스트 — 쿼리 문자열이 SQL에 직접 들어가지 않도록)
const ISSUE_SORT_COLS = {
  key: `(split_part(i.issue_key, '-', 2))::bigint`,
  summary: 'i.summary',
  type: 't.name',
  assignee: 'u.display_name',
  reporter: 'ur.display_name',
  priority: `CASE i.priority WHEN 'Highest' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2
             WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 WHEN 'Lowest' THEN 4 ELSE 9 END`,
  status: 's.name',
  resolution: 'i.resolution',
  created: 'i.created_at',
  updated: 'i.updated_at',
};

app.get('/api/issues', async (req, reply) => {
  const { project, status, type, assignee, priority, sprint, q } = req.query;
  const cond = ['1=1'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (project) cond.push(`pr.key = ${p(project)}`);
  let jqlOrder = null;
  if (req.query.jql?.trim()) {
    try {
      const r = parseJql(req.query.jql, { p, userId: req.access.userId });
      cond.push(r.where);
      jqlOrder = r.order;
    } catch (e) {
      if (e instanceof JqlError) return reply.code(400).send({ error: `JQL 오류: ${e.message}`, pos: e.pos });
      throw e;
    }
  }
  if (status) cond.push(`i.status_id = ${p(status)}`);
  if (type) cond.push(`i.issue_type_id = ${p(type)}`);
  if (assignee) cond.push(`i.assignee_id = ${p(assignee)}`);
  if (priority) cond.push(`i.priority = ${p(priority)}`);
  if (sprint === 'none') cond.push(`i.sprint_id IS NULL`);
  else if (sprint === 'open') cond.push(`(i.sprint_id IS NULL OR i.sprint_id IN (SELECT id FROM jira_sprints WHERE state <> 'closed'))`);
  else if (sprint) cond.push(`i.sprint_id = ${p(sprint)}`);
  if (q) cond.push(`(i.summary ILIKE ${p('%' + q + '%')} OR i.issue_key ILIKE ${p('%' + q + '%')})`);

  // 정렬 우선순위: 명시된 sort 파라미터(표 머리글 클릭) > JQL ORDER BY > 기본(-key)
  const sortRaw = String(req.query.sort ?? jqlOrder ?? '-key');
  const dir = sortRaw.startsWith('-') ? 'DESC' : 'ASC';
  const col = ISSUE_SORT_COLS[sortRaw.replace(/^-/, '')] ?? ISSUE_SORT_COLS.key;
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  // count에도 본 쿼리와 같은 조인 세트 사용 (JQL 조건이 조인 별칭을 참조)
  const JOINS = `
       FROM jira_issues i
       JOIN jira_projects pr ON pr.id = i.project_id
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN jira_statuses s ON s.id = i.status_id
       LEFT JOIN users u ON u.id = i.assignee_id
       LEFT JOIN users ur ON ur.id = i.reporter_id
       LEFT JOIN jira_sprints sp ON sp.id = i.sprint_id
       LEFT JOIN jira_issues p1 ON p1.id = i.parent_id
       LEFT JOIN jira_issue_types pt1 ON pt1.id = p1.issue_type_id
       LEFT JOIN jira_issues p2 ON p2.id = p1.parent_id
       LEFT JOIN jira_issue_types pt2 ON pt2.id = p2.issue_type_id`;
  const total = (await query(
    `SELECT count(*)::int AS n ${JOINS} WHERE ${cond.join(' AND ')}`, params)).rows[0].n;
  const { rows } = await query(
    `SELECT i.id, i.issue_key, i.summary, i.priority, i.resolution, i.created_at, i.updated_at,
            i.resolved_at, i.sprint_id, i.parent_id, i.labels, i.fix_versions,
            t.name AS type_name, t.subtask,
            s.id AS status_id, s.name AS status_name, s.category AS status_category,
            u.display_name AS assignee_name, ur.display_name AS reporter_name,
            (SELECT count(*)::int FROM jira_issues c WHERE c.parent_id = i.id) AS children_count,
            -- 소속 에픽: 부모 또는 조부모가 에픽이면 그 이슈 (에픽→스토리→하위작업 3단계)
            CASE WHEN pt1.name = '에픽' THEN p1.id WHEN pt2.name = '에픽' THEN p2.id END AS epic_id,
            CASE WHEN pt1.name = '에픽' THEN p1.issue_key WHEN pt2.name = '에픽' THEN p2.issue_key END AS epic_key,
            CASE WHEN pt1.name = '에픽' THEN p1.summary WHEN pt2.name = '에픽' THEN p2.summary END AS epic_summary
       ${JOINS}
      WHERE ${cond.join(' AND ')}
      ORDER BY ${col} ${dir} NULLS LAST, i.id DESC
      OFFSET ${offset} LIMIT ${limit}`, params);
  return { total, rows };
});

app.get('/api/issue/:key', async (req, reply) => {
  const { rows } = await query(
    `SELECT i.*, t.name AS type_name, t.subtask, s.name AS status_name, s.category AS status_category,
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

  const [comments, attachments, links, subtasks, history] = await Promise.all([
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
    query(`SELECT i.issue_key, i.summary, i.priority, i.resolved_at,
                  s.id AS status_id, s.name AS status_name, s.category AS status_category,
                  t.name AS type_name, u.display_name AS assignee_name
             FROM jira_issues i
             LEFT JOIN jira_statuses s ON s.id = i.status_id
             LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
             LEFT JOIN users u ON u.id = i.assignee_id
            WHERE i.parent_id = $1 ORDER BY i.id`, [issue.id]),
    query(`SELECT h.id, h.created_at, h.items, u.display_name AS author_name
             FROM jira_changelog h LEFT JOIN users u ON u.id = h.author_id
            WHERE h.issue_id = $1 ORDER BY h.created_at`, [issue.id]),
  ]);
  return { ...issue, comments: comments.rows, attachments: attachments.rows, links: links.rows,
           subtasks: subtasks.rows, history: history.rows };
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
  if ('parentKey' in b) {
    if (!b.parentKey) sets.push(`parent_id = NULL`);
    else {
      const parent = await issueByKey(String(b.parentKey).trim().toUpperCase());
      if (!parent) return reply.code(400).send({ error: `상위 이슈 ${b.parentKey}를 찾을 수 없습니다` });
      if (parent.project_id !== issue.project_id) return reply.code(400).send({ error: '상위 이슈는 같은 프로젝트여야 합니다' });
      if (parent.id === issue.id) return reply.code(400).send({ error: '자기 자신을 상위로 지정할 수 없습니다' });
      sets.push(`parent_id = ${p(parent.id)}`);
    }
  }
  if ('assigneeId' in b) sets.push(`assignee_id = ${p(b.assigneeId || null)}`);
  if ('priority' in b) sets.push(`priority = ${p(b.priority || null)}`);
  if ('summary' in b && b.summary?.trim()) sets.push(`summary = ${p(b.summary.trim())}`);
  if ('typeId' in b && b.typeId) sets.push(`issue_type_id = ${p(b.typeId)}`);
  if ('labels' in b) sets.push(`labels = ${p(Array.isArray(b.labels) ? b.labels : [])}`);
  if ('resolution' in b) sets.push(`resolution = ${p(b.resolution || null)}`);
  if ('fixVersions' in b) sets.push(`fix_versions = ${p(Array.isArray(b.fixVersions) ? b.fixVersions : [])}`);
  // 설명: ADF 문서(편집기) 또는 플레인 텍스트 (텍스트는 최소 ADF로 변환)
  if ('descriptionAdf' in b) {
    const doc = b.descriptionAdf;
    if (doc != null && doc.type !== 'doc') return reply.code(400).send({ error: 'descriptionAdf는 ADF doc이어야 합니다' });
    sets.push(`description_adf = ${p(doc ? JSON.stringify(doc) : null)}`);
  } else if ('description' in b) {
    sets.push(`description_adf = ${p(b.description?.trim() ? JSON.stringify(textToAdf(b.description)) : null)}`);
  }
  if (!sets.length) return reply.code(400).send({ error: '변경할 필드가 없습니다' });
  sets.push(`updated_at = now()`);
  const before = await issueSnapshot(issue.id);
  await query(`UPDATE jira_issues SET ${sets.join(', ')} WHERE id = $1`, params);
  // 로컬 수정도 Jira처럼 기록(changelog)에 남긴다
  const after = await issueSnapshot(issue.id);
  const items = [];
  for (const [field, label] of Object.entries(SNAP_FIELDS)) {
    if (before[label] !== after[label]) items.push({ field, fromString: before[label], toString: after[label] });
  }
  if (before.desc_md5 !== after.desc_md5) items.push({ field: 'description', fromString: null, toString: null });
  if (items.length) {
    await query(`INSERT INTO jira_changelog (issue_id, author_id, items) VALUES ($1, $2, $3)`,
      [issue.id, req.access.userId, JSON.stringify(items)]);
  }
  return { ok: true };
});

// 기록 비교용 스냅샷 (표시 문자열 기준)
const SNAP_FIELDS = {
  status: 'status', issuetype: 'type', assignee: 'assignee', priority: 'priority', summary: 'summary',
  resolution: 'resolution', labels: 'labels', 'Fix Version': 'fix_versions', Sprint: 'sprint', Parent: 'parent',
};
async function issueSnapshot(id) {
  const { rows } = await query(
    `SELECT i.summary, i.priority, i.resolution,
            array_to_string(i.labels, ', ') AS labels, array_to_string(i.fix_versions, ', ') AS fix_versions,
            s.name AS status, t.name AS type, u.display_name AS assignee,
            sp.name AS sprint, pi.issue_key AS parent,
            md5(coalesce(i.description_adf::text, '')) AS desc_md5
       FROM jira_issues i
       LEFT JOIN jira_statuses s ON s.id = i.status_id
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN users u ON u.id = i.assignee_id
       LEFT JOIN jira_sprints sp ON sp.id = i.sprint_id
       LEFT JOIN jira_issues pi ON pi.id = i.parent_id
      WHERE i.id = $1`, [id]);
  return rows[0];
}

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

app.patch('/api/comments/:id', async (req, reply) => {
  const text = req.body?.text?.trim();
  if (!text) return reply.code(400).send({ error: '내용을 입력하세요' });
  const { rowCount } = await query(
    `UPDATE jira_comments SET body_adf = $2, updated_at = now() WHERE id = $1`,
    [req.params.id, JSON.stringify(textToAdf(text))]);
  if (!rowCount) return reply.code(404).send({ error: 'not found' });
  return { ok: true };
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

// ---------- 사용자 정의 보드 ----------

function validColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) return '컬럼을 1개 이상 구성하세요';
  const seen = new Set();
  for (const c of columns) {
    if (!c?.name?.trim()) return '컬럼 이름을 입력하세요';
    if (!Array.isArray(c.statusIds) || !c.statusIds.length) return `'${c.name}' 컬럼에 상태를 1개 이상 지정하세요`;
    for (const s of c.statusIds) {
      if (seen.has(s)) return '같은 상태를 두 컬럼에 넣을 수 없습니다';
      seen.add(s);
    }
  }
  return null;
}

app.get('/api/boards', async (req) => {
  const { rows } = await query(
    `SELECT b.id, b.name, b.columns FROM jira_boards b
       JOIN jira_projects p ON p.id = b.project_id
      WHERE p.key = $1 ORDER BY b.id`, [req.query.project]);
  return rows;
});

app.post('/api/boards', async (req, reply) => {
  const { projectKey, name, columns } = req.body ?? {};
  if (!projectKey || !name?.trim()) return reply.code(400).send({ error: 'projectKey, name은 필수입니다' });
  const err = validColumns(columns);
  if (err) return reply.code(400).send({ error: err });
  const { rows: pr } = await query(`SELECT id FROM jira_projects WHERE key = $1`, [projectKey]);
  if (!pr.length) return reply.code(404).send({ error: 'project not found' });
  const { rows } = await query(
    `INSERT INTO jira_boards (project_id, name, columns) VALUES ($1, $2, $3) RETURNING id, name, columns`,
    [pr[0].id, name.trim(), JSON.stringify(columns)]);
  return rows[0];
});

app.patch('/api/boards/:id', async (req, reply) => {
  const b = req.body ?? {};
  if ('columns' in b) {
    const err = validColumns(b.columns);
    if (err) return reply.code(400).send({ error: err });
    await query(`UPDATE jira_boards SET columns = $2 WHERE id = $1`, [req.params.id, JSON.stringify(b.columns)]);
  }
  if (b.name?.trim()) await query(`UPDATE jira_boards SET name = $2 WHERE id = $1`, [req.params.id, b.name.trim()]);
  const { rows } = await query(`SELECT id, name, columns FROM jira_boards WHERE id = $1`, [req.params.id]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  return rows[0];
});

app.delete('/api/boards/:id', async (req, reply) => {
  const { rowCount } = await query(`DELETE FROM jira_boards WHERE id = $1`, [req.params.id]);
  if (!rowCount) return reply.code(404).send({ error: 'not found' });
  return { ok: true };
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
