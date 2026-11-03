// Jira PoC 뷰어 (읽기 전용). 이관된 jira_* 테이블을 간단한 단일 페이지로 보여준다.
// 실행: node server/src/jira-viewer.mjs  (기본 0.0.0.0:3002)
import Fastify from 'fastify';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '..', '..', '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

const app = Fastify({ logger: { level: 'warn' } });

app.get('/', (req, reply) => {
  reply.type('text/html').send(createReadStream(path.join(here, 'jira-viewer.html')));
});

// 프로젝트·상태·타입·담당자 메타 (필터용)
app.get('/api/meta', async () => {
  const [projects, statuses, types, assignees] = await Promise.all([
    query(`SELECT id, key, name FROM jira_projects ORDER BY key`),
    query(`SELECT id, name, category FROM jira_statuses ORDER BY
             CASE category WHEN 'new' THEN 0 WHEN 'indeterminate' THEN 1 ELSE 2 END, name`),
    query(`SELECT id, name, subtask FROM jira_issue_types
            WHERE id IN (SELECT DISTINCT issue_type_id FROM jira_issues) ORDER BY name`),
    query(`SELECT DISTINCT u.id, u.display_name FROM users u
            JOIN jira_issues i ON i.assignee_id = u.id ORDER BY u.display_name`),
  ]);
  return { projects: projects.rows, statuses: statuses.rows, types: types.rows, assignees: assignees.rows };
});

// 이슈 목록 (PoC 규모라 전체 반환, 최대 1000)
app.get('/api/issues', async (req) => {
  const { project, status, type, assignee, q } = req.query;
  const cond = ['1=1'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (project) cond.push(`pr.key = ${p(project)}`);
  if (status) cond.push(`i.status_id = ${p(status)}`);
  if (type) cond.push(`i.issue_type_id = ${p(type)}`);
  if (assignee) cond.push(`i.assignee_id = ${p(assignee)}`);
  if (q) cond.push(`(i.summary ILIKE ${p('%' + q + '%')} OR i.issue_key ILIKE ${p('%' + q + '%')})`);
  const { rows } = await query(
    `SELECT i.id, i.issue_key, i.summary, i.priority, i.updated_at,
            t.name AS type_name, t.subtask,
            s.name AS status_name, s.category AS status_category,
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

// 이슈 상세: 본문(ADF)·댓글·첨부·링크·하위 이슈
app.get('/api/issue/:key', async (req, reply) => {
  const { rows } = await query(
    `SELECT i.*, t.name AS type_name, s.name AS status_name, s.category AS status_category,
            ua.display_name AS assignee_name, ur.display_name AS reporter_name,
            pi.issue_key AS parent_key, pi.summary AS parent_summary
       FROM jira_issues i
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
       LEFT JOIN jira_statuses s ON s.id = i.status_id
       LEFT JOIN users ua ON ua.id = i.assignee_id
       LEFT JOIN users ur ON ur.id = i.reporter_id
       LEFT JOIN jira_issues pi ON pi.id = i.parent_id
      WHERE i.issue_key = $1`, [req.params.key]);
  const issue = rows[0];
  if (!issue) return reply.code(404).send({ error: 'not found' });
  delete issue.fields_raw; // 상세 화면에서 안 쓰는 대용량 원본은 내리지 않는다

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

// 첨부 프록시 (원본 Jira에서 읽기 전용 GET으로 스트리밍)
app.get('/api/attachment/:id', async (req, reply) => {
  const { rows } = await query(`SELECT filename, media_type, source_url FROM jira_attachments WHERE id = $1`, [req.params.id]);
  const att = rows[0];
  if (!att?.source_url) return reply.code(404).send({ error: 'not found' });
  const res = await fetch(att.source_url, { headers: { Authorization: AUTH } });
  if (!res.ok) return reply.code(502).send({ error: `원본 응답 ${res.status}` });
  reply.header('content-type', att.media_type ?? 'application/octet-stream');
  reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
  return reply.send(res.body);
});

const port = Number(process.env.JIRA_VIEWER_PORT ?? 3002);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Jira 뷰어: http://0.0.0.0:${port}`);
