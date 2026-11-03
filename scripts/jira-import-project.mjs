#!/usr/bin/env node
// Jira Cloud → 새 서비스 DB 임포터 (PoC: 프로젝트 단위, 최신 상태만).
// 읽기 전용 GET 요청만 사용한다. 변경 이력(changelog)·워크로그는 PoC 범위 밖.
//
// 사용법: node scripts/jira-import-project.mjs --project SIMSIM [--wipe]

import { parseArgs } from 'node:util';
import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({
  options: {
    project: { type: 'string' },
    wipe: { type: 'boolean', default: false },
  },
});
if (!args.project) {
  console.error('사용법: node scripts/jira-import-project.mjs --project <KEY> [--wipe]');
  process.exit(1);
}

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');

async function get(pathOrUrl, attempt = 0) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : SITE + pathOrUrl;
  const res = await fetch(url, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return get(pathOrUrl, attempt + 1);
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} — GET ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

// ---------- 수집 ----------

console.log(`프로젝트 ${args.project} 조회...`);
const project = await get(`/rest/api/3/project/${encodeURIComponent(args.project)}`);
console.log(`  ${project.id} ${project.key} "${project.name}" (${project.projectTypeKey}/${project.style})`);

console.log('상태·필드 사전·버전 조회...');
const [statusesByType, fields, versions] = await Promise.all([
  get(`/rest/api/3/project/${project.key}/statuses`),
  get(`/rest/api/3/field`),
  get(`/rest/api/3/project/${project.key}/versions`),
]);
const statuses = new Map(); // id → { name, category }
for (const t of statusesByType) {
  for (const s of t.statuses) statuses.set(Number(s.id), { name: s.name, category: s.statusCategory.key });
}
console.log(`  상태 ${statuses.size} / 필드 ${fields.length} / 버전 ${versions.length}`);

console.log('이슈 수집 (전체 필드 포함)...');
const issues = [];
{
  const jql = encodeURIComponent(`project = ${project.key} ORDER BY created ASC`);
  let token = null;
  for (;;) {
    const qs = `jql=${jql}&maxResults=100&fields=*all${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`;
    const page = await get(`/rest/api/3/search/jql?${qs}`);
    issues.push(...(page.issues ?? []));
    if (page.isLast || !page.nextPageToken) break;
    token = page.nextPageToken;
    if (issues.length % 300 < 100) console.log(`  ${issues.length}건...`);
  }
  console.log(`  이슈 ${issues.length}건`);
}

// 댓글: 검색 응답의 comment 는 일부만 담길 수 있어, 모자란 이슈만 별도 페이지네이션으로 수집
console.log('댓글 수집...');
const commentsByIssue = new Map(); // issueId → comment[]
{
  let fetched = 0;
  await mapLimit(issues, 6, async (iss) => {
    const c = iss.fields.comment ?? { comments: [], total: 0 };
    let list = c.comments ?? [];
    if ((c.total ?? 0) > list.length) {
      list = [];
      let startAt = 0;
      for (;;) {
        const page = await get(`/rest/api/3/issue/${iss.id}/comment?startAt=${startAt}&maxResults=100`);
        list.push(...(page.comments ?? []));
        startAt += page.comments?.length ?? 0;
        if (startAt >= (page.total ?? 0) || !(page.comments ?? []).length) break;
      }
      fetched++;
    }
    if (list.length) commentsByIssue.set(iss.id, list);
  });
  const total = [...commentsByIssue.values()].reduce((n, l) => n + l.length, 0);
  console.log(`  댓글 ${total}건 (추가 조회 ${fetched}이슈)`);
}

// ---------- 사용자 ----------

const accountIds = new Set();
const addUser = (u) => { if (u?.accountId) accountIds.add(u.accountId); };
for (const iss of issues) {
  const f = iss.fields;
  addUser(f.assignee); addUser(f.reporter); addUser(f.creator);
}
for (const list of commentsByIssue.values()) {
  for (const c of list) { addUser(c.author); addUser(c.updateAuthor); }
}
for (const iss of issues) for (const a of iss.fields.attachment ?? []) addUser(a.author);
addUser(project.lead);

console.log(`사용자 ${accountIds.size}명 조회...`);
const users = new Map(); // accountId → { displayName, email }
{
  const ids = [...accountIds];
  for (let i = 0; i < ids.length; i += 90) {
    const qs = ids.slice(i, i + 90).map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const res = await get(`/rest/api/3/user/bulk?${qs}&maxResults=100`);
    for (const u of res.values ?? []) {
      users.set(u.accountId, { displayName: u.displayName ?? u.accountId, email: u.emailAddress || null });
    }
  }
  for (const id of ids) if (!users.has(id)) users.set(id, { displayName: '(알 수 없는 사용자)', email: null });
}

// ---------- DB 적재 ----------

console.log('DB 적재...');

if (args.wipe) {
  await query(`DELETE FROM jira_issue_links WHERE inward_issue IN (SELECT id FROM jira_issues WHERE project_id = $1)
                  OR outward_issue IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [project.id]);
  await query(`DELETE FROM jira_comments WHERE issue_id IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [project.id]);
  await query(`DELETE FROM jira_attachments WHERE issue_id IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [project.id]);
  await query(`DELETE FROM jira_issues WHERE project_id = $1`, [project.id]);
  await query(`DELETE FROM jira_versions WHERE project_id = $1`, [project.id]);
  await query(`DELETE FROM jira_projects WHERE id = $1`, [project.id]);
}

// 사용자 upsert (Confluence와 같은 Atlassian accountId 체계 공유)
const userIdByAccount = new Map();
for (const [accountId, u] of users) {
  const { rows } = await query(
    `INSERT INTO users (email, confluence_account_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`, [u.email, accountId, u.displayName]);
  userIdByAccount.set(accountId, rows[0].id);
}
const uid = (u) => (u?.accountId ? userIdByAccount.get(u.accountId) ?? null : null);

await query(
  `INSERT INTO jira_projects (id, key, name, project_type, style, lead_id, raw)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lead_id = EXCLUDED.lead_id, raw = EXCLUDED.raw`,
  [project.id, project.key, project.name, project.projectTypeKey ?? null, project.style ?? null,
   uid(project.lead), JSON.stringify({ description: project.description ?? null, avatarUrls: project.avatarUrls ?? null })]);

for (const [id, s] of statuses) {
  await query(
    `INSERT INTO jira_statuses (id, name, category) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category`,
    [id, s.name, s.category]);
}

for (const t of project.issueTypes ?? []) {
  await query(
    `INSERT INTO jira_issue_types (id, name, subtask, description) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, subtask = EXCLUDED.subtask`,
    [t.id, t.name, !!t.subtask, t.description ?? null]);
}

for (const f of fields) {
  await query(
    `INSERT INTO jira_fields (id, name, custom, schema_type) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [f.id, f.name, !!f.custom, f.schema?.type ?? null]);
}

for (const v of versions) {
  await query(
    `INSERT INTO jira_versions (id, project_id, name, released, release_date) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, released = EXCLUDED.released`,
    [v.id, project.id, v.name, !!v.released, v.releaseDate ?? null]);
}

// 이슈 1차 적재 (parent 없이) → 2차 parent 업데이트 (FK 순서 회피)
const names = (list) => (list ?? []).map((x) => x.name ?? String(x)).filter(Boolean);
let cnt = 0;
for (const iss of issues) {
  const f = iss.fields;
  // fields_raw: 검색 응답에 부분만 담기는 comment, 별도 테이블로 가는 attachment/issuelinks 는 제외
  const { comment: _c, attachment: _a, issuelinks: _l, ...rawRest } = f;
  await query(
    `INSERT INTO jira_issues
       (id, project_id, issue_key, issue_type_id, status_id, summary, description_adf,
        priority, resolution, assignee_id, reporter_id, labels, fix_versions, components,
        created_at, updated_at, resolved_at, fields_raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       status_id = EXCLUDED.status_id, summary = EXCLUDED.summary,
       description_adf = EXCLUDED.description_adf, priority = EXCLUDED.priority,
       resolution = EXCLUDED.resolution, assignee_id = EXCLUDED.assignee_id,
       labels = EXCLUDED.labels, fix_versions = EXCLUDED.fix_versions, components = EXCLUDED.components,
       updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at, fields_raw = EXCLUDED.fields_raw`,
    [iss.id, project.id, iss.key, f.issuetype?.id ?? null, f.status?.id ?? null,
     f.summary ?? '(제목 없음)', f.description ? JSON.stringify(f.description) : null,
     f.priority?.name ?? null, f.resolution?.name ?? null,
     uid(f.assignee), uid(f.reporter),
     f.labels ?? [], names(f.fixVersions), names(f.components),
     f.created ?? null, f.updated ?? null, f.resolutiondate ?? null,
     JSON.stringify(rawRest)]);
  if (++cnt % 100 === 0) console.log(`  이슈 ${cnt}/${issues.length}`);
}

const knownIds = new Set(issues.map((i) => Number(i.id)));
let parentCnt = 0;
for (const iss of issues) {
  const pid = Number(iss.fields.parent?.id);
  if (pid && knownIds.has(pid)) {
    await query(`UPDATE jira_issues SET parent_id = $2 WHERE id = $1`, [iss.id, pid]);
    parentCnt++;
  }
}

// 댓글·첨부·링크
let cmtCount = 0, attCount = 0, linkCount = 0;
const seenLinks = new Set();
for (const iss of issues) {
  for (const c of commentsByIssue.get(iss.id) ?? []) {
    await query(
      `INSERT INTO jira_comments (id, issue_id, body_adf, author_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET body_adf = EXCLUDED.body_adf, updated_at = EXCLUDED.updated_at`,
      [c.id, iss.id, c.body ? JSON.stringify(c.body) : null, uid(c.author), c.created ?? null, c.updated ?? null]);
    cmtCount++;
  }
  for (const a of iss.fields.attachment ?? []) {
    await query(
      `INSERT INTO jira_attachments (id, issue_id, filename, media_type, file_size, source_url, author_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url`,
      [a.id, iss.id, a.filename ?? '(이름 없음)', a.mimeType ?? null, a.size ?? null,
       a.content ?? null, uid(a.author), a.created ?? null]);
    attCount++;
  }
  for (const l of iss.fields.issuelinks ?? []) {
    if (seenLinks.has(l.id)) continue;
    seenLinks.add(l.id);
    // 링크는 한쪽 이슈 기준으로 inward/outward 가 담긴다. outward 가 있으면 자신→상대, inward 면 상대→자신.
    const inward = l.outwardIssue ? iss.id : l.inwardIssue?.id;
    const outward = l.outwardIssue ? l.outwardIssue.id : iss.id;
    if (!inward || !outward) continue;
    await query(
      `INSERT INTO jira_issue_links (id, link_type, inward_issue, outward_issue)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [l.id, l.type?.name ?? '(링크)', inward, outward]);
    linkCount++;
  }
}

console.log(`완료: 이슈 ${issues.length} (부모 연결 ${parentCnt}) / 사용자 ${users.size} / 댓글 ${cmtCount} / 첨부 ${attCount} / 링크 ${linkCount} / 버전 ${versions.length}`);
await closeDb();
