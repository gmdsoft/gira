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
import { query, DATA_DIR, configureDb, closeDb } from './db.mjs';
import { registerAuth } from './auth.mjs';
import { projectRole, projectRoles } from './perm.mjs';
import { registerMyApiKeys } from './me-keys.mjs';
import { registerSelfMigrate } from './self-migrate.mjs';
import { registerSourceSync } from './source-sync.mjs';
import { exportProject, importProject } from './jira-package.mjs';
import { registerDevChat, triggerDispatch } from './dev-chat.mjs';
import { parseJql, JqlError } from './jql.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '..', '..', '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

// Gira 전용 DB (알파부터 분리). GIRA_DATABASE_URL 미지정 시 기존 단일 DB로 동작한다.
configureDb({
  url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL,
  schemas: ['schema-core.sql', 'schema-jira.sql'],
});

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

const app = Fastify({
  logger: { level: 'warn' },
  bodyLimit: 32 * 1024 * 1024,
  // 외부 연동용 안정 별칭: /api/v1/* → 내부 라우트 (docs/api-v1.md)
  rewriteUrl(req) {
    const u = req.url;
    if (!u.startsWith('/api/v1/')) return u;
    return u
      .replace(/^\/api\/v1\/issues\/([^/?]+)/, '/api/issue/$1')
      .replace(/^\/api\/v1\/search/, '/api/issues')
      .replace(/^\/api\/v1\//, '/api/');
  },
});
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024, files: 5 } });

// 신규 ID가 이관된 ID와 겹치지 않도록 시퀀스 보정
// 로컬에서 만드는 행은 1조 이상 번호를 쓴다 — 원본(Atlassian)은 계속 번호를 발급하므로, '이관 최댓값+1'부터
// 쓰면 원본 동기화 때 같은 id로 덮어쓸 수 있다. 원본 id는 이 값보다 훨씬 작다.
const LOCAL_ID_FLOOR = 1000000000000;
await query(`SELECT setval('jira_issue_id_seq',
  GREATEST(${LOCAL_ID_FLOOR}, (SELECT COALESCE(MAX(id), 1) FROM jira_issues), (SELECT last_value FROM jira_issue_id_seq)))`);
await query(`SELECT setval('jira_comment_id_seq',
  GREATEST(${LOCAL_ID_FLOOR}, (SELECT COALESCE(MAX(id), 1) FROM jira_comments), (SELECT last_value FROM jira_comment_id_seq)))`);
await query(`SELECT setval('jira_attachment_id_seq',
  GREATEST(${LOCAL_ID_FLOOR}, (SELECT COALESCE(MAX(id), 1) FROM jira_attachments), (SELECT last_value FROM jira_attachment_id_seq)))`);
await query(`SELECT setval('jira_sprints_id_seq',
  GREATEST(${LOCAL_ID_FLOOR}, (SELECT COALESCE(MAX(id), 1) FROM jira_sprints), (SELECT last_value FROM jira_sprints_id_seq)))`);

await registerAuth(app); // /api/* 로그인 필수 (auth 라우트 제외)
registerMyApiKeys(app); // 개인 API 키 셀프 발급
registerSourceSync(app, { appName: 'gira' }); // 원본 → 로컬 단방향 동기화 (매일 SOURCE_SYNC_AT, 기본 03:00 KST)
registerSelfMigrate(app, { kind: 'jira' }); // 팀장 셀프 이관 (원본 Jira → 이 인스턴스)

// React SPA 서빙 (web/dist-jira-app — npm --workspace web run build:jira 로 생성)
const DIST = path.join(here, '..', '..', 'web', 'dist-jira-app');
// wildcard 서빙: 재빌드로 애셋 해시가 바뀌어도 서버 재시작 불필요
await app.register(fastifyStatic, { root: DIST, index: false });
const page = (req, reply) => reply.type('text/html')
  .header('cache-control', 'no-cache') // 재배포 시 옛 빌드가 휴리스틱 캐시로 남지 않도록
  .send(createReadStream(path.join(DIST, 'jira.html')));
app.get('/', page);
app.get('/browse/:key', page);                 // Jira 호환 이슈 주소
app.get('/dev-chat', page);                    // 개발참여 챗봇 (새 탭 전용 페이지)
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

// ---------- 프로젝트 접근 판정 ----------
// 규칙 없음 = 비공개(사이트 관리자만). need 미달이면 403/404를 보내고 null을 반환한다.
const roleOk = (role, need) =>
  !!role && !(need === 'editor' && role === 'viewer') && !(need === 'admin' && role !== 'admin');

function denyProject(reply, role, projectKey, need) {
  reply.code(403).send({
    error: role ? '이 작업을 할 권한이 없습니다' : '이 프로젝트에 접근할 수 없습니다',
    canRequest: !role, projectKey, need,
  });
  return null;
}

async function requireProject(req, reply, projectKey, need = 'viewer') {
  const { rows } = await query(`SELECT id, key, default_assignee_id FROM jira_projects WHERE key = $1`, [projectKey]);
  if (!rows.length) { reply.code(404).send({ error: 'project not found' }); return null; }
  const role = await projectRole(req.access, rows[0].id);
  if (!roleOk(role, need)) return denyProject(reply, role, rows[0].key, need);
  return { ...rows[0], role };
}

async function requireProjectId(req, reply, projectId, need = 'viewer') {
  const { rows } = await query(`SELECT id, key FROM jira_projects WHERE id = $1`, [projectId]);
  if (!rows.length) { reply.code(404).send({ error: 'project not found' }); return null; }
  const role = await projectRole(req.access, rows[0].id);
  if (!roleOk(role, need)) return denyProject(reply, role, rows[0].key, need);
  return { ...rows[0], role };
}

// ---------- 메타 ----------

app.get('/api/meta', async (req) => {
  const roles = await projectRoles(req.access);
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
    // 접근 가능한 프로젝트만 노출 (role 포함)
    projects: projects.rows
      .filter((p) => roles.has(String(p.id)))
      .map((p) => ({ ...p, role: roles.get(String(p.id)) })),
    statuses: statuses.rows, types: types.rows,
    assignees: assignees.rows, priorities: priorities.rows.map((r) => r.priority),
    resolutions: resolutions.rows.map((r) => r.resolution),
  };
});

// 프로젝트 관련 인물 — 보고·담당·처리(기록) 이력이 있는 사용자를 최근 활동순으로.
// 아바타 빠른 필터와 담당자 필터가 프로젝트 범위의 사람만 보여주도록 한다.
app.get('/api/people', async (req, reply) => {
  const pr = await requireProject(req, reply, req.query.project);
  if (!pr) return;
  const { rows } = await query(
    `SELECT u.id, u.display_name, max(x.at) AS last_at FROM (
       SELECT assignee_id AS uid, updated_at AS at FROM jira_issues
        WHERE project_id = $1 AND assignee_id IS NOT NULL
       UNION ALL
       SELECT reporter_id, created_at FROM jira_issues
        WHERE project_id = $1 AND reporter_id IS NOT NULL
       UNION ALL
       SELECT h.author_id, h.created_at FROM jira_changelog h
         JOIN jira_issues i ON i.id = h.issue_id
        WHERE i.project_id = $1 AND h.author_id IS NOT NULL
     ) x JOIN users u ON u.id = x.uid AND u.active
     GROUP BY u.id, u.display_name
     ORDER BY max(x.at) DESC NULLS LAST LIMIT 30`, [pr.id]);
  return rows.map((r) => ({ id: r.id, display_name: r.display_name }));
});

// 프로젝트 버전 목록 (수정 버전 선택용)
app.get('/api/versions', async (req, reply) => {
  if (!await requireProject(req, reply, req.query.project)) return;
  const { rows } = await query(
    `SELECT v.id, v.name, v.released FROM jira_versions v
       JOIN jira_projects p ON p.id = v.project_id
      WHERE p.key = $1 ORDER BY v.name`, [req.query.project]);
  return rows;
});

// 프로젝트의 레이블·컴포넌트 목록 (JQL 자동완성 값 제안용)
app.get('/api/labels', async (req, reply) => {
  if (!await requireProject(req, reply, req.query.project)) return;
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
  // 접근 가능한 프로젝트로 범위 제한 (JQL 임의 조건도 이 범위를 벗어날 수 없다)
  const myRoles = await projectRoles(req.access);
  if (!myRoles.size) return { total: 0, rows: [] };
  const cond = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  cond.push(`i.project_id = ANY(${p([...myRoles.keys()])}::bigint[])`);
  if (project) cond.push(`pr.key = ${p(project)}`);
  let jqlOrder = null;
  // jql 파라미터는 여러 개 가능 (보드 필터 + 사용자 필터 AND 결합), ORDER BY는 마지막 것 적용
  for (const one of [].concat(req.query.jql ?? [])) {
    if (!String(one).trim()) continue;
    try {
      const r = parseJql(String(one), { p, userId: req.access.userId });
      cond.push(r.where);
      if (r.order) jqlOrder = r.order;
    } catch (e) {
      if (e instanceof JqlError) return reply.code(400).send({ error: `JQL 오류: ${e.message}`, pos: e.pos });
      throw e;
    }
  }
  if (status) cond.push(`i.status_id = ${p(status)}`);
  if (type) cond.push(`i.issue_type_id = ${p(type)}`);
  if (assignee) cond.push(`i.assignee_id = ${p(assignee)}`);
  if (req.query.who) cond.push(`i.assignee_id = ${p(req.query.who)}`); // 아바타 빠른 필터 (모드 무관)
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
  const proj = await requireProjectId(req, reply, issue.project_id);
  if (!proj) return;
  issue.project_role = proj.role;
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
  const { projectKey, typeId, summary, description, assigneeId, reporterId, priority, parentKey, sprintId,
    labels, components, fixVersions } = req.body ?? {};
  if (!projectKey || !typeId || !summary?.trim()) {
    return reply.code(400).send({ error: 'projectKey, typeId, summary는 필수입니다' });
  }
  const project = await requireProject(req, reply, projectKey, 'editor');
  if (!project) return;
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
  const arr = (v) => Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : [];
  const { rows } = await query(
    `INSERT INTO jira_issues
       (id, project_id, issue_key, issue_type_id, status_id, summary, description_adf,
        priority, assignee_id, reporter_id, parent_id, sprint_id, labels, components, fix_versions,
        created_at, updated_at, fields_raw)
     VALUES (nextval('jira_issue_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now(), '{}')
     RETURNING id, issue_key`,
    [project.id, issueKey, typeId, st[0]?.id ?? null, summary.trim(),
     description?.trim() ? JSON.stringify(textToAdf(description)) : null,
     // 담당자를 비우면 프로젝트 기본 담당자 (GIRA → GIRA 에이전트)
     priority || null, assigneeId || project.default_assignee_id || null, reporterId || userId, parentId, sprintId || null,
     arr(labels), arr(components), arr(fixVersions)]);
  return { id: rows[0].id, issueKey: rows[0].issue_key };
});

app.patch('/api/issue/:key', async (req, reply) => {
  const issue = await issueByKey(req.params.key);
  if (!issue) return reply.code(404).send({ error: 'not found' });
  if (!await requireProjectId(req, reply, issue.project_id, 'editor')) return;
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
  if ('components' in b) sets.push(`components = ${p(Array.isArray(b.components) ? b.components : [])}`);
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
  // 승인: GIRA 개발 이슈에서 needs-approval 레이블이 지워졌고 에이전트 담당이면 바로 처리 시작
  if ('labels' in b && String(before.labels ?? '').includes('needs-approval')
      && !String(after.labels ?? '').includes('needs-approval')
      && /agent:(codex|opencode)/.test(after.labels ?? '')
      && req.params.key.toUpperCase().startsWith('GIRA-')) {
    triggerDispatch();
  }
  return { ok: true };
});

// 기록 비교용 스냅샷 (표시 문자열 기준)
const SNAP_FIELDS = {
  status: 'status', issuetype: 'type', assignee: 'assignee', priority: 'priority', summary: 'summary',
  resolution: 'resolution', labels: 'labels', Component: 'components', 'Fix Version': 'fix_versions', Sprint: 'sprint', Parent: 'parent',
};
async function issueSnapshot(id) {
  const { rows } = await query(
    `SELECT i.summary, i.priority, i.resolution,
            array_to_string(i.labels, ', ') AS labels, array_to_string(i.components, ', ') AS components,
            array_to_string(i.fix_versions, ', ') AS fix_versions,
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
  if (!await requireProjectId(req, reply, issue.project_id, 'editor')) return;
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
  const { rows: cm } = await query(
    `SELECT c.author_id, i.project_id FROM jira_comments c JOIN jira_issues i ON i.id = c.issue_id
      WHERE c.id = $1`, [req.params.id]);
  if (!cm.length) return reply.code(404).send({ error: 'not found' });
  const proj = await requireProjectId(req, reply, cm[0].project_id, 'editor');
  if (!proj) return;
  // 남의 댓글은 프로젝트 관리자만 수정 가능
  if (Number(cm[0].author_id) !== req.access.userId && proj.role !== 'admin') {
    return reply.code(403).send({ error: '본인 댓글만 수정할 수 있습니다' });
  }
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
  if (!await requireProjectId(req, reply, issue.project_id, 'editor')) return;
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
    `SELECT a.filename, a.media_type, a.source_url, a.local_key, i.project_id
       FROM jira_attachments a JOIN jira_issues i ON i.id = a.issue_id WHERE a.id = $1`, [req.params.id]);
  const att = rows[0];
  if (!att) return reply.code(404).send({ error: 'not found' });
  if (!await requireProjectId(req, reply, att.project_id)) return;
  reply.header('content-type', att.media_type ?? 'application/octet-stream');
  reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
  if (att.local_key) return reply.send(createReadStream(path.join(DATA_DIR, att.local_key)));
  if (!att.source_url) return reply.code(404).send({ error: 'no source' });
  const res = await fetch(att.source_url, { headers: { Authorization: AUTH } });
  if (!res.ok) return reply.code(502).send({ error: `원본 응답 ${res.status}` });
  return reply.send(res.body);
});

// ---------- 스프린트 ----------

app.get('/api/sprints', async (req, reply) => {
  if (!await requireProject(req, reply, req.query.project)) return;
  const { rows } = await query(
    `SELECT s.*, (SELECT count(*) FROM jira_issues i WHERE i.sprint_id = s.id) AS issue_count
       FROM jira_sprints s JOIN jira_projects p ON p.id = s.project_id
      WHERE p.key = $1
      ORDER BY CASE s.state WHEN 'active' THEN 0 WHEN 'future' THEN 1 ELSE 2 END,
               s.position ASC NULLS LAST, s.id`,
    [req.query.project]);
  return rows;
});

app.post('/api/sprints', async (req, reply) => {
  const { projectKey, name, goal } = req.body ?? {};
  if (!projectKey || !name?.trim()) return reply.code(400).send({ error: 'projectKey, name은 필수입니다' });
  const pr = await requireProject(req, reply, projectKey, 'editor');
  if (!pr) return;
  const { rows } = await query(
    `INSERT INTO jira_sprints (project_id, name, goal) VALUES ($1, $2, $3) RETURNING *`,
    [pr.id, name.trim(), goal?.trim() || null]);
  return rows[0];
});

app.patch('/api/sprints/:id', async (req, reply) => {
  const { rows: cur } = await query(`SELECT * FROM jira_sprints WHERE id = $1`, [req.params.id]);
  if (!cur.length) return reply.code(404).send({ error: 'not found' });
  if (!await requireProjectId(req, reply, cur[0].project_id, 'editor')) return;
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

// 보드 필터(JQL) 유효성: 문법만 검사 (파라미터는 버린다)
function jqlErrorOf(jql) {
  try { parseJql(jql, { p: () => '$1', userId: 0 }); return null; }
  catch (e) { return e instanceof JqlError ? `JQL 오류: ${e.message}` : (() => { throw e; })(); }
}

app.get('/api/boards', async (req, reply) => {
  if (!await requireProject(req, reply, req.query.project)) return;
  const { rows } = await query(
    `SELECT b.id, b.name, b.columns, b.type, b.jql FROM jira_boards b
       JOIN jira_projects p ON p.id = b.project_id
      WHERE p.key = $1 ORDER BY b.id`, [req.query.project]);
  return rows;
});

app.post('/api/boards', async (req, reply) => {
  const { projectKey, name, columns, jql } = req.body ?? {};
  if (!projectKey || !name?.trim()) return reply.code(400).send({ error: 'projectKey, name은 필수입니다' });
  const err = validColumns(columns) ?? (jql?.trim() ? jqlErrorOf(jql.trim()) : null);
  if (err) return reply.code(400).send({ error: err });
  const pr = await requireProject(req, reply, projectKey, 'editor');
  if (!pr) return;
  const { rows } = await query(
    `INSERT INTO jira_boards (project_id, name, columns, jql) VALUES ($1, $2, $3, $4)
     RETURNING id, name, columns, type, jql`,
    [pr.id, name.trim(), JSON.stringify(columns), jql?.trim() || null]);
  return rows[0];
});

app.patch('/api/boards/:id', async (req, reply) => {
  const { rows: bd } = await query(`SELECT project_id FROM jira_boards WHERE id = $1`, [req.params.id]);
  if (!bd.length) return reply.code(404).send({ error: 'not found' });
  if (!await requireProjectId(req, reply, bd[0].project_id, 'editor')) return;
  const b = req.body ?? {};
  if ('columns' in b) {
    const err = validColumns(b.columns);
    if (err) return reply.code(400).send({ error: err });
    await query(`UPDATE jira_boards SET columns = $2 WHERE id = $1`, [req.params.id, JSON.stringify(b.columns)]);
  }
  if ('jql' in b) {
    const jql = b.jql?.trim() || null;
    if (jql) { const err = jqlErrorOf(jql); if (err) return reply.code(400).send({ error: err }); }
    await query(`UPDATE jira_boards SET jql = $2 WHERE id = $1`, [req.params.id, jql]);
  }
  if (b.name?.trim()) await query(`UPDATE jira_boards SET name = $2 WHERE id = $1`, [req.params.id, b.name.trim()]);
  const { rows } = await query(`SELECT id, name, columns, type, jql FROM jira_boards WHERE id = $1`, [req.params.id]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  return rows[0];
});

app.delete('/api/boards/:id', async (req, reply) => {
  const { rows: bd } = await query(`SELECT project_id FROM jira_boards WHERE id = $1`, [req.params.id]);
  if (!bd.length) return reply.code(404).send({ error: 'not found' });
  if (!await requireProjectId(req, reply, bd[0].project_id, 'editor')) return;
  await query(`DELETE FROM jira_boards WHERE id = $1`, [req.params.id]);
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

// ---------- 개발참여: 신규/수정/버그 제안을 GIRA 개발 프로젝트 이슈로 등록 ----------
// 명세 '의견·버그 리포트' — 로그인한 누구나 등록 가능. Gonfluence는 서비스 키로 프록시 호출하며
// 이때 author(작성자 표시)·source(출처 앱)를 설명에 남긴다.
const DEV_PROJECT_KEY = 'GIRA';
app.post('/api/dev-feedback', async (req, reply) => {
  const KINDS = { feature: '신규 기능', change: '수정 요청', bug: '버그' };
  const { kind, title, detail, author, source } = req.body ?? {};
  if (!KINDS[kind] || !title?.trim()) return reply.code(400).send({ error: '유형과 제목을 입력하세요' });
  const { rows: pr } = await query(
    `SELECT id, key, default_assignee_id FROM jira_projects WHERE key = $1`, [DEV_PROJECT_KEY]);
  if (!pr.length) return reply.code(500).send({ error: '개발 프로젝트가 없습니다 (관리자에게 문의)' });
  const typeName = kind === 'bug' ? '버그' : '작업';
  const { rows: tp } = await query(
    `SELECT id FROM jira_issue_types WHERE name = $1 AND NOT subtask ORDER BY id LIMIT 1`, [typeName]);
  const { rows: st } = await query(`SELECT id FROM jira_statuses WHERE category = 'new' ORDER BY id LIMIT 1`);
  const { rows: mx } = await query(
    `SELECT COALESCE(MAX(split_part(issue_key, '-', 2)::int), 0) + 1 AS n
       FROM jira_issues WHERE project_id = $1`, [pr[0].id]);
  const body = [
    detail?.trim() || title.trim(),
    author ? `— 작성: ${author}` : null,
    source ? `— 출처: ${source}` : null,
  ].filter(Boolean).join('\n\n');
  const { rows } = await query(
    `INSERT INTO jira_issues (id, project_id, issue_key, issue_type_id, status_id, summary,
       description_adf, labels, reporter_id, assignee_id, created_at, updated_at, fields_raw)
     VALUES (nextval('jira_issue_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), '{}')
     RETURNING issue_key`,
    [pr[0].id, `${pr[0].key}-${mx[0].n}`, tp[0]?.id ?? null, st[0]?.id ?? null,
     `[${KINDS[kind]}] ${title.trim()}`, JSON.stringify(textToAdf(body)),
     ['dev-feedback', kind], req.access.userId, pr[0].default_assignee_id ?? null]);
  return { issueKey: rows[0].issue_key };
});

// 개발참여 챗봇 (자연어 요청 → 답변 + GIRA 이슈 자동 생성) — dev-chat.mjs
registerDevChat(app, { textToAdf });

// ---------- 프로젝트 패키지 내보내기/가져오기 ----------

// 내보내기: 프로젝트 관리자(또는 사이트 관리자)
app.get('/api/projects/:key/export', async (req, reply) => {
  const pr = await requireProject(req, reply, req.params.key, 'admin');
  if (!pr) return;
  const { zip } = await exportProject(pr.id);
  reply.header('content-type', 'application/zip');
  reply.header('content-disposition', `attachment; filename="gira-${pr.key}-${new Date().toISOString().slice(0, 10)}.zip"`);
  return reply.send(zip.toBuffer());
});

// 가져오기: 생성 권한자(팀장·파트장·지정 그룹·사이트 관리자)
app.post('/api/projects/import', async (req, reply) => {
  if (!req.access.canCreate) {
    return reply.code(403).send({ error: '프로젝트를 가져올 권한이 없습니다 (팀장·파트장 또는 지정 그룹만)' });
  }
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: '패키지(.zip) 파일을 올려주세요' });
  const buf = await file.toBuffer();
  try {
    return await importProject(buf, req.access.userId);
  } catch (e) {
    if (e.status) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
});

// ---------- 프로젝트 권한 ----------

// 권한 부여 대상 검색 (사용자/그룹/팀 — 조직 데이터는 Gonfluence 관리에서 미러링됨)
app.get('/api/principals', async (req) => {
  const q = (req.query.q ?? '').trim();
  const { rows: users } = await query(
    `SELECT id, display_name, email FROM users
      WHERE active AND display_name IS NOT NULL
        AND confluence_account_id IS DISTINCT FROM 'test-login'
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
    users: users.map((u) => ({ type: 'user', id: u.id, name: u.display_name, email: u.email })),
    groups: groups.map((g) => ({ type: 'group', id: g.id, name: g.name })),
    teams: teams.map((t) => ({
      type: 'team', id: t.id, part: !!t.parent_name,
      name: t.parent_name ? `${t.parent_name} / ${t.name}` : t.name,
    })),
  };
});

app.get('/api/projects/:key/permissions', async (req, reply) => {
  const pr = await requireProject(req, reply, req.params.key, 'admin');
  if (!pr) return;
  const { rows } = await query(
    `SELECT p.principal_type, p.principal_id, p.role,
            CASE p.principal_type
              WHEN 'user' THEN u.display_name
              WHEN 'group' THEN g.name
              WHEN 'team' THEN CASE WHEN tp.id IS NULL THEN t.name ELSE tp.name || ' / ' || t.name END
              ELSE '로그인한 모든 사용자' END AS name
       FROM jira_project_permissions p
       LEFT JOIN users u ON p.principal_type = 'user' AND u.id = p.principal_id
       LEFT JOIN groups g ON p.principal_type = 'group' AND g.id = p.principal_id
       LEFT JOIN teams t ON p.principal_type = 'team' AND t.id = p.principal_id
       LEFT JOIN teams tp ON tp.id = t.parent_id
      WHERE p.project_id = $1 ORDER BY p.role DESC, name`, [pr.id]);
  return rows;
});

app.put('/api/projects/:key/permissions', async (req, reply) => {
  const pr = await requireProject(req, reply, req.params.key, 'admin');
  if (!pr) return;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  for (const r of rows) {
    if (!['user', 'group', 'team', 'anyone'].includes(r.principalType) || !['viewer', 'editor', 'admin'].includes(r.role)) {
      return reply.code(400).send({ error: '잘못된 권한 행입니다' });
    }
  }
  // 요청자 자신이 잠기지 않도록 본인을 admin으로 보강 (사이트 관리자는 제외)
  if (rows.length && !req.access.isAdmin) {
    const self = rows.some((r) => r.principalType === 'user' && Number(r.principalId) === req.access.userId && r.role === 'admin');
    if (!self) rows.push({ principalType: 'user', principalId: req.access.userId, role: 'admin' });
  }
  await query(`DELETE FROM jira_project_permissions WHERE project_id = $1`, [pr.id]);
  for (const r of rows) {
    await query(
      `INSERT INTO jira_project_permissions (project_id, principal_type, principal_id, role)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [pr.id, r.principalType, r.principalType === 'anyone' ? 0 : Number(r.principalId), r.role]);
  }
  return { ok: true, count: rows.length };
});

// ---------- 접근 권한 요청 ----------

app.post('/api/access-requests', async (req, reply) => {
  const { projectKey, want, reason } = req.body ?? {};
  const w = ['viewer', 'editor'].includes(want) ? want : 'viewer';
  const { rows: pr } = await query(`SELECT id FROM jira_projects WHERE key = $1`, [projectKey]);
  if (!pr.length) return reply.code(404).send({ error: 'project not found' });
  const role = await projectRole(req.access, pr[0].id);
  if (role) return reply.code(400).send({ error: '이미 접근 권한이 있습니다', role });
  const { rows: dup } = await query(
    `SELECT id FROM access_requests
      WHERE resource_type = 'project' AND resource_id = $1 AND user_id = $2 AND status = 'pending'`,
    [pr[0].id, req.access.userId]);
  if (dup.length) return { ok: true, id: dup[0].id, duplicated: true };
  const { rows } = await query(
    `INSERT INTO access_requests (resource_type, resource_id, user_id, want, reason)
     VALUES ('project', $1, $2, $3, $4) RETURNING id`,
    [pr[0].id, req.access.userId, w, (reason ?? '').slice(0, 2000) || null]);
  return { ok: true, id: rows[0].id };
});

app.get('/api/access-requests/mine', async (req) => {
  const { rows } = await query(
    `SELECT r.id, r.want, r.reason, r.status, r.created_at, r.decided_at,
            p.key AS project_key, d.display_name AS decided_by_name
       FROM access_requests r
       JOIN jira_projects p ON p.id = r.resource_id
       LEFT JOIN users d ON d.id = r.decided_by
      WHERE r.resource_type = 'project' AND r.user_id = $1
      ORDER BY r.created_at DESC LIMIT 50`, [req.access.userId]);
  return rows;
});

app.get('/api/access-requests/inbox', async (req) => {
  const { rows } = await query(
    `SELECT r.id, r.want, r.reason, r.status, r.created_at, r.resource_id,
            p.key AS project_key, p.name AS project_name,
            u.display_name AS user_name, u.email AS user_email
       FROM access_requests r
       JOIN jira_projects p ON p.id = r.resource_id
       JOIN users u ON u.id = r.user_id
      WHERE r.resource_type = 'project' AND r.status = 'pending'
      ORDER BY r.created_at`);
  const out = [];
  const cache = new Map();
  for (const r of rows) {
    let role = cache.get(r.resource_id);
    if (role === undefined) { role = await projectRole(req.access, r.resource_id); cache.set(r.resource_id, role); }
    if (role === 'admin') out.push(r);
  }
  return out;
});

app.post('/api/access-requests/:id/decide', async (req, reply) => {
  const approve = !!req.body?.approve;
  const { rows: rq } = await query(
    `SELECT id, resource_id, user_id, want, status FROM access_requests
      WHERE id = $1 AND resource_type = 'project'`, [req.params.id]);
  if (!rq.length) return reply.code(404).send({ error: 'not found' });
  if (rq[0].status !== 'pending') return reply.code(400).send({ error: '이미 처리된 요청입니다' });
  const role = await projectRole(req.access, rq[0].resource_id);
  if (role !== 'admin') return reply.code(403).send({ error: '이 프로젝트의 관리자만 처리할 수 있습니다' });
  if (approve) {
    await query(
      `INSERT INTO jira_project_permissions (project_id, principal_type, principal_id, role)
       VALUES ($1, 'user', $2, $3) ON CONFLICT DO NOTHING`,
      [rq[0].resource_id, rq[0].user_id, rq[0].want]);
  }
  await query(
    `UPDATE access_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
    [req.params.id, approve ? 'approved' : 'denied', req.access.userId]);
  return { ok: true };
});

// 컨테이너 헬스체크·로드밸런서용 (인증 훅은 /api/* 만 가드하므로 로그인 불필요)
app.get('/healthz', async () => {
  await query('SELECT 1');
  return { ok: true, app: 'gira' };
});

const port = Number(process.env.JIRA_VIEWER_PORT ?? 3002);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Jira 뷰어: http://0.0.0.0:${port}`);

// 종료 시그널에서 연결을 정리 (docker stop 등)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    try { await app.close(); await closeDb(); } finally { process.exit(0); }
  });
}
