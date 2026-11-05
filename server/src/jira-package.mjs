// Gira 프로젝트 패키지 (.zip): manifest.json + attachments/ (로컬 업로드 파일만).
// 내보내기: 프로젝트 전체(이슈·댓글·첨부 메타·링크·기록·스프린트·보드)와 참조 사용자 목록.
// 가져오기: 사용자는 이메일→account_id 순으로 기존과 매칭(없으면 생성), 이슈/댓글/첨부는
// 새 id로 재매핑, 상태/타입은 이름으로 매칭. 프로젝트 키가 이미 있으면 거부.
// 원본 Jira 첨부(source_url)는 메타만 포함된다 — 파일은 대상 인스턴스에서 프록시로 접근.
import AdmZip from 'adm-zip';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { getDb, query, DATA_DIR } from './db.mjs';

export const PKG_FORMAT = 'gira-project';

const all = async (sql, params) => (await query(sql, params)).rows;

export async function exportProject(projectId) {
  const [project] = await all(`SELECT * FROM jira_projects WHERE id = $1`, [projectId]);
  const issues = await all(`SELECT * FROM jira_issues WHERE project_id = $1 ORDER BY id`, [projectId]);
  const issueIds = issues.map((i) => i.id);
  const inIssues = `issue_id = ANY($1::bigint[])`;
  const [statuses, types, versions, sprints, boards, comments, attachments, changelog, links] = await Promise.all([
    all(`SELECT * FROM jira_statuses ORDER BY id`),
    all(`SELECT * FROM jira_issue_types ORDER BY id`),
    all(`SELECT * FROM jira_versions WHERE project_id = $1 ORDER BY id`, [projectId]),
    all(`SELECT * FROM jira_sprints WHERE project_id = $1 ORDER BY id`, [projectId]),
    all(`SELECT * FROM jira_boards WHERE project_id = $1 ORDER BY id`, [projectId]),
    all(`SELECT * FROM jira_comments WHERE ${inIssues} ORDER BY id`, [issueIds]),
    all(`SELECT * FROM jira_attachments WHERE ${inIssues} ORDER BY id`, [issueIds]),
    all(`SELECT * FROM jira_changelog WHERE ${inIssues} ORDER BY id`, [issueIds]),
    all(`SELECT * FROM jira_issue_links WHERE inward_issue = ANY($1::bigint[]) OR outward_issue = ANY($1::bigint[])`, [issueIds]),
  ]);
  // 참조된 사용자 (매칭용 최소 정보)
  const users = await all(
    `SELECT DISTINCT u.id, u.email, u.display_name, u.confluence_account_id
       FROM users u WHERE u.id IN (
         SELECT assignee_id FROM jira_issues WHERE project_id = $1 AND assignee_id IS NOT NULL
         UNION SELECT reporter_id FROM jira_issues WHERE project_id = $1 AND reporter_id IS NOT NULL
         UNION SELECT author_id FROM jira_comments WHERE ${inIssues.replace('$1', '$2')} AND author_id IS NOT NULL
         UNION SELECT author_id FROM jira_changelog WHERE ${inIssues.replace('$1', '$2')} AND author_id IS NOT NULL
         UNION SELECT author_id FROM jira_attachments WHERE ${inIssues.replace('$1', '$2')} AND author_id IS NOT NULL
         UNION SELECT lead_id FROM jira_projects WHERE id = $1 AND lead_id IS NOT NULL
       )`, [projectId, issueIds]);

  const zip = new AdmZip();
  const manifest = {
    format: PKG_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    project, statuses, types, versions, sprints, boards, issues, comments, attachments, changelog, links, users,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  // 로컬 업로드 첨부 파일 동봉 (이관분 source_url은 메타만)
  for (const a of attachments) {
    if (!a.local_key) continue;
    const p = path.join(DATA_DIR, a.local_key);
    if (await stat(p).catch(() => null)) zip.addLocalFile(p, `attachments/${a.id}`, path.basename(a.local_key));
  }
  return { zip, counts: { issues: issues.length, comments: comments.length, attachments: attachments.length } };
}

export async function importProject(buffer, requesterId) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw Object.assign(new Error('manifest.json이 없습니다 — Gira 프로젝트 패키지가 아닙니다'), { status: 400 });
  const m = JSON.parse(zip.readAsText(entry));
  if (m.format !== PKG_FORMAT) throw Object.assign(new Error(`지원하지 않는 형식: ${m.format}`), { status: 400 });

  const pool = await getDb();
  const client = await pool.connect();
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  try {
    await client.query('BEGIN');

    // 프로젝트: 키 충돌 거부, id는 비어 있으면 유지
    const dup = await one(`SELECT 1 AS x FROM jira_projects WHERE key = $1`, [m.project.key]);
    if (dup) throw Object.assign(new Error(`프로젝트 키 ${m.project.key} 가 이미 있습니다`), { status: 409 });

    // 사용자 매칭: email → confluence_account_id → 생성
    const userMap = new Map(); // old id -> new id
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

    // 상태/타입: 이름 매칭, 없으면 생성 (원본 id가 비어 있으면 유지)
    const freeId = async (table, want) => {
      const used = await one(`SELECT 1 AS x FROM ${table} WHERE id = $1`, [want]);
      if (!used) return Number(want);
      return Number((await one(`SELECT coalesce(max(id), 0) + 1 AS id FROM ${table}`)).id);
    };
    const statusMap = new Map();
    for (const s of m.statuses ?? []) {
      let row = await one(`SELECT id FROM jira_statuses WHERE name = $1`, [s.name]);
      if (!row) {
        const id = await freeId('jira_statuses', s.id);
        row = await one(`INSERT INTO jira_statuses (id, name, category) VALUES ($1, $2, $3) RETURNING id`,
          [id, s.name, s.category]);
      }
      statusMap.set(String(s.id), Number(row.id));
    }
    const typeMap = new Map();
    for (const t of m.types ?? []) {
      let row = await one(`SELECT id FROM jira_issue_types WHERE name = $1 AND subtask = $2`, [t.name, t.subtask]);
      if (!row) {
        const id = await freeId('jira_issue_types', t.id);
        row = await one(`INSERT INTO jira_issue_types (id, name, subtask, description) VALUES ($1, $2, $3, $4) RETURNING id`,
          [id, t.name, t.subtask, t.description ?? null]);
      }
      typeMap.set(String(t.id), Number(row.id));
    }

    const projectId = await freeId('jira_projects', m.project.id);
    await client.query(
      `INSERT INTO jira_projects (id, key, name, project_type, style, lead_id, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [projectId, m.project.key, m.project.name, m.project.project_type ?? null, m.project.style ?? null,
       mapUser(m.project.lead_id), m.project.raw ?? null]);

    // 버전/스프린트 (새 id)
    for (const v of m.versions ?? []) {
      const id = await freeId('jira_versions', v.id);
      await client.query(
        `INSERT INTO jira_versions (id, project_id, name, released, release_date) VALUES ($1, $2, $3, $4, $5)`,
        [id, projectId, v.name, v.released, v.release_date ?? null]);
    }
    const sprintMap = new Map();
    for (const s of m.sprints ?? []) {
      const row = await one(
        `INSERT INTO jira_sprints (project_id, name, goal, state, start_at, end_at, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [projectId, s.name, s.goal ?? null, s.state, s.start_at ?? null, s.end_at ?? null, s.position ?? null]);
      sprintMap.set(String(s.id), Number(row.id));
    }

    // 이슈 1차 (parent 없이), 2차에 parent 연결
    const issueMap = new Map();
    for (const i of m.issues ?? []) {
      const row = await one(
        `INSERT INTO jira_issues (id, project_id, issue_key, issue_type_id, status_id, summary, description_adf,
           priority, resolution, assignee_id, reporter_id, sprint_id, labels, fix_versions, components,
           created_at, updated_at, resolved_at, fields_raw)
         VALUES (nextval('jira_issue_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [projectId, i.issue_key, typeMap.get(String(i.issue_type_id)) ?? null, statusMap.get(String(i.status_id)) ?? null,
         i.summary, i.description_adf ?? null, i.priority ?? null, i.resolution ?? null,
         mapUser(i.assignee_id), mapUser(i.reporter_id),
         i.sprint_id != null ? sprintMap.get(String(i.sprint_id)) ?? null : null,
         i.labels ?? [], i.fix_versions ?? [], i.components ?? [],
         i.created_at ?? null, i.updated_at ?? null, i.resolved_at ?? null, i.fields_raw ?? null]);
      issueMap.set(String(i.id), Number(row.id));
    }
    for (const i of m.issues ?? []) {
      if (i.parent_id == null) continue;
      const nid = issueMap.get(String(i.id));
      const pid = issueMap.get(String(i.parent_id));
      if (pid) await client.query(`UPDATE jira_issues SET parent_id = $2 WHERE id = $1`, [nid, pid]);
    }

    for (const c of m.comments ?? []) {
      const iid = issueMap.get(String(c.issue_id));
      if (!iid) continue;
      await client.query(
        `INSERT INTO jira_comments (id, issue_id, body_adf, author_id, created_at, updated_at)
         VALUES (nextval('jira_comment_id_seq'), $1, $2, $3, $4, $5)`,
        [iid, c.body_adf ?? null, mapUser(c.author_id), c.created_at ?? null, c.updated_at ?? null]);
    }

    const attFiles = []; // [{entryName, localKey}]
    for (const a of m.attachments ?? []) {
      const iid = issueMap.get(String(a.issue_id));
      if (!iid) continue;
      const row = await one(
        `INSERT INTO jira_attachments (id, issue_id, filename, media_type, file_size, source_url, local_key, author_id, created_at)
         VALUES (nextval('jira_attachment_id_seq'), $1, $2, $3, $4, $5, NULL, $6, $7) RETURNING id`,
        [iid, a.filename, a.media_type ?? null, a.file_size ?? null, a.source_url ?? null,
         mapUser(a.author_id), a.created_at ?? null]);
      if (a.local_key) {
        const safe = a.filename.replace(/[^\w.\-]+/g, '_');
        const localKey = path.join('jira-att', String(iid), safe);
        await client.query(`UPDATE jira_attachments SET local_key = $2 WHERE id = $1`, [row.id, localKey]);
        attFiles.push({ entryName: `attachments/${a.id}/${path.basename(a.local_key)}`, localKey });
      }
    }

    for (const h of m.changelog ?? []) {
      const iid = issueMap.get(String(h.issue_id));
      if (!iid) continue;
      // jira_id(원본 history id)는 비운다 — 같은 원본에서 온 데이터가 이미 있으면
      // 유니크 충돌로 이력이 통째로 빠지는 문제를 피한다 (이력 보존이 우선)
      await client.query(
        `INSERT INTO jira_changelog (jira_id, issue_id, author_id, created_at, items)
         VALUES (NULL, $1, $2, $3, $4)`,
        [iid, mapUser(h.author_id), h.created_at ?? null, JSON.stringify(h.items ?? [])]);
    }

    let nextLink = Number((await one(`SELECT coalesce(max(id), 0) + 1 AS id FROM jira_issue_links`)).id);
    for (const l of m.links ?? []) {
      const a = issueMap.get(String(l.inward_issue));
      const b = issueMap.get(String(l.outward_issue));
      if (!a || !b) continue; // 패키지 밖을 가리키는 링크는 버린다
      await client.query(
        `INSERT INTO jira_issue_links (id, link_type, inward_issue, outward_issue) VALUES ($1, $2, $3, $4)`,
        [nextLink++, l.link_type, a, b]);
    }

    for (const b of m.boards ?? []) {
      const cols = (b.columns ?? []).map((c) => ({
        name: c.name, statusIds: (c.statusIds ?? []).map((s) => statusMap.get(String(s))).filter(Boolean),
      }));
      await client.query(
        `INSERT INTO jira_boards (project_id, name, columns, type, jql) VALUES ($1, $2, $3, $4, $5)`,
        [projectId, b.name, JSON.stringify(cols), b.type ?? null, b.jql ?? null]);
    }

    // 가져온 사람이 이 프로젝트의 관리자 (기본 비공개 정책)
    await client.query(
      `INSERT INTO jira_project_permissions (project_id, principal_type, principal_id, role)
       VALUES ($1, 'user', $2, 'admin') ON CONFLICT DO NOTHING`, [projectId, requesterId]);

    // 키 시퀀스 보정 (신규 이슈 번호가 겹치지 않도록)
    await client.query(`SELECT setval('jira_issue_id_seq', GREATEST((SELECT coalesce(max(id),1) FROM jira_issues), (SELECT last_value FROM jira_issue_id_seq)))`);
    await client.query(`SELECT setval('jira_comment_id_seq', GREATEST((SELECT coalesce(max(id),1) FROM jira_comments), (SELECT last_value FROM jira_comment_id_seq)))`);
    await client.query(`SELECT setval('jira_attachment_id_seq', GREATEST((SELECT coalesce(max(id),1) FROM jira_attachments), (SELECT last_value FROM jira_attachment_id_seq)))`);

    await client.query('COMMIT');

    // 첨부 파일은 커밋 후 디스크에 기록 (실패해도 메타는 유효 — source 없음으로 404)
    const { mkdir, writeFile } = await import('node:fs/promises');
    for (const f of attFiles) {
      const e = zip.getEntry(f.entryName);
      if (!e) continue;
      const dest = path.join(DATA_DIR, f.localKey);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, e.getData());
    }

    return { projectKey: m.project.key, counts: { issues: issueMap.size, comments: (m.comments ?? []).length, attachments: (m.attachments ?? []).length } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
