#!/usr/bin/env node
// Jira Cloud → 새 서비스 DB 임포터 (PoC: 프로젝트 단위, 최신 상태만).
// 읽기 전용 GET 요청만 사용한다. 변경 이력(changelog)·워크로그는 PoC 범위 밖.
// 대형 프로젝트(1만+ 이슈)를 위해 페이지 단위로 수집·적재한다 (메모리에 전체를 들지 않음).
// 이슈 필드의 스프린트 배열(gh-sprint)에서 스프린트도 함께 이관한다.
//
// 사용법: node scripts/jira-import-project.mjs --project SIMSIM [--wipe] [--since <ISO 시각>]

import { parseArgs } from 'node:util';
import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({
  options: {
    project: { type: 'string' },
    wipe: { type: 'boolean', default: false },
    since: { type: 'string' }, // 증분 동기화 (ISO 시각)
  },
});
if (!args.project) {
  console.error('사용법: node scripts/jira-import-project.mjs --project <KEY> [--wipe]');
  process.exit(1);
}

// 증분 동기화: --since <ISO 시각> 이면 그 이후 수정된 이슈만 (시간대 오차 대비 1시간 앞당김)
function sinceClause() {
  if (!args.since) return '';
  const t = new Date(new Date(args.since).getTime() - 60 * 60 * 1000);
  if (Number.isNaN(t.getTime())) throw new Error(`--since 형식 오류: ${args.since}`);
  const p = (n) => String(n).padStart(2, '0');
  return ` AND updated >= "${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}"`;
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

// ---------- 프로젝트 메타 ----------

console.log(`프로젝트 ${args.project} 조회...`);
const project = await get(`/rest/api/3/project/${encodeURIComponent(args.project)}`);
console.log(`  ${project.id} ${project.key} "${project.name}" (${project.projectTypeKey}/${project.style})`);

console.log('상태·필드 사전·버전 조회...');
const [statusesByType, fields, versions] = await Promise.all([
  get(`/rest/api/3/project/${project.key}/statuses`),
  get(`/rest/api/3/field`),
  get(`/rest/api/3/project/${project.key}/versions`),
]);
const statuses = new Map();
for (const t of statusesByType) {
  for (const s of t.statuses) statuses.set(Number(s.id), { name: s.name, category: s.statusCategory.key });
}
// 스프린트 커스텀 필드 id (예: customfield_10020)
const SPRINT_FIELD = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id ?? null;
console.log(`  상태 ${statuses.size} / 필드 ${fields.length} / 버전 ${versions.length} / 스프린트 필드 ${SPRINT_FIELD ?? '없음'}`);

// ---------- 사전 적재 (이슈보다 먼저 있어야 하는 것들) ----------

if (args.wipe) {
  console.log('기존 데이터 삭제...');
  await query(`DELETE FROM jira_issue_links WHERE inward_issue IN (SELECT id FROM jira_issues WHERE project_id = $1)
                  OR outward_issue IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [project.id]);
  await query(`DELETE FROM jira_comments WHERE issue_id IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [project.id]);
  await query(`DELETE FROM jira_attachments WHERE issue_id IN (SELECT id FROM jira_issues WHERE project_id = $1)`, [project.id]);
  await query(`DELETE FROM jira_issues WHERE project_id = $1`, [project.id]);
  await query(`DELETE FROM jira_sprints WHERE project_id = $1`, [project.id]);
  await query(`DELETE FROM jira_versions WHERE project_id = $1`, [project.id]);
  await query(`DELETE FROM jira_boards WHERE project_id = $1`, [project.id]);
  await query(`DELETE FROM jira_projects WHERE id = $1`, [project.id]);
}

await query(
  `INSERT INTO jira_projects (id, key, name, project_type, style, raw)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, raw = EXCLUDED.raw`,
  [project.id, project.key, project.name, project.projectTypeKey ?? null, project.style ?? null,
   JSON.stringify({ description: project.description ?? null, avatarUrls: project.avatarUrls ?? null })]);

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

// ---------- 사용자/스프린트 캐시 ----------

const userIdByAccount = new Map(); // accountId → users.id
async function ensureUsers(accountIds) {
  const missing = [...accountIds].filter((id) => id && !userIdByAccount.has(id));
  if (!missing.length) return;
  const found = new Map();
  for (let i = 0; i < missing.length; i += 90) {
    const batch = missing.slice(i, i + 90);
    const qs = batch.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const res = await get(`/rest/api/3/user/bulk?${qs}&maxResults=100`);
    for (const u of res.values ?? []) found.set(u.accountId, { displayName: u.displayName ?? u.accountId, email: u.emailAddress || null });
  }
  for (const id of missing) {
    const u = found.get(id) ?? { displayName: '(알 수 없는 사용자)', email: null };
    const { rows } = await query(
      `INSERT INTO users (email, confluence_account_id, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`, [u.email, id, u.displayName]);
    userIdByAccount.set(id, rows[0].id);
  }
}
const uid = (u) => (u?.accountId ? userIdByAccount.get(u.accountId) ?? null : null);

// 구형 스프린트 직렬화 문자열("...Sprint@..[id=5,name=..,state=..]") 대응
function parseSprint(s) {
  if (!s) return null;
  if (typeof s === 'object') {
    return { id: Number(s.id), name: s.name ?? `스프린트 ${s.id}`, state: s.state ?? 'closed',
             start: s.startDate ?? null, end: s.endDate ?? s.completeDate ?? null };
  }
  const get1 = (k) => String(s).match(new RegExp(`${k}=([^,\\]]*)`))?.[1];
  const id = Number(get1('id'));
  if (!id) return null;
  return { id, name: get1('name') ?? `스프린트 ${id}`, state: (get1('state') ?? 'closed').toLowerCase(),
           start: get1('startDate') || null, end: get1('completeDate') || get1('endDate') || null };
}
const seenSprints = new Set();
async function ensureSprints(sprintList) {
  for (const sp of sprintList) {
    if (!sp || seenSprints.has(sp.id)) continue;
    const state = ['future', 'active', 'closed'].includes(sp.state) ? sp.state : 'closed';
    await query(
      `INSERT INTO jira_sprints (id, project_id, name, state, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state
       WHERE jira_sprints.project_id = EXCLUDED.project_id`,
      [sp.id, project.id, sp.name, state, sp.start, sp.end]);
    seenSprints.add(sp.id);
  }
}

// ---------- 이슈 스트리밍 수집·적재 ----------

console.log('이슈 수집·적재 (페이지 단위)...');
const names = (list) => (list ?? []).map((x) => x.name ?? String(x)).filter(Boolean);
const parentPairs = []; // [issueId, parentId]
const knownIds = new Set();
let total = 0, cmtCount = 0, attCount = 0, linkCount = 0, extraCmtFetch = 0;
const seenLinks = new Set();

// JQL 시각은 원본 계정 시간대(KST)로 해석된다 — UTC 값을 넣으면 9시간 더 넓게 가져와 누락이 없다
const jql = encodeURIComponent(`project = "${project.key}"${sinceClause()} ORDER BY created ASC`);
let token = null;
for (;;) {
  const qs = `jql=${jql}&maxResults=100&fields=*all${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`;
  const page = await get(`/rest/api/3/search/jql?${qs}`);
  const fetched = page.issues ?? [];
  if (!fetched.length) break;
  // 충돌 가드: 같은 id가 로컬에서 만든 이슈(fields_raw '{}')이거나 다른 프로젝트 이슈이면 덮어쓰지 않는다
  const { rows: clash } = await query(
    `SELECT id, issue_key FROM jira_issues
      WHERE id = ANY($1::bigint[]) AND (project_id <> $2 OR fields_raw::text = '{}')`,
    [fetched.map((x) => Number(x.id)), project.id]);
  const clashIds = new Set(clash.map((r) => String(r.id)));
  for (const c of clash) {
    const src = fetched.find((x) => String(x.id) === String(c.id));
    console.log(`  ⚠ 충돌 건너뜀: 원본 ${src?.key} (id ${c.id})가 로컬 ${c.issue_key}와 id가 겹침`);
  }
  const issues = fetched.filter((x) => !clashIds.has(String(x.id)));

  // 이 페이지의 사용자·스프린트 먼저 보장 (FK)
  const pageAccounts = new Set();
  const addU = (u) => { if (u?.accountId) pageAccounts.add(u.accountId); };
  for (const iss of issues) {
    const f = iss.fields;
    addU(f.assignee); addU(f.reporter); addU(f.creator);
    for (const c of f.comment?.comments ?? []) { addU(c.author); addU(c.updateAuthor); }
    for (const a of f.attachment ?? []) addU(a.author);
  }
  await ensureUsers(pageAccounts);
  if (SPRINT_FIELD) {
    const sprintObjs = issues.flatMap((iss) => (iss.fields[SPRINT_FIELD] ?? []).map(parseSprint)).filter(Boolean);
    await ensureSprints(sprintObjs);
  }

  // 댓글이 잘린 이슈는 추가 조회 (페이지 내 동시 6)
  const commentsByIssue = new Map();
  await mapLimit(issues, 6, async (iss) => {
    const c = iss.fields.comment ?? { comments: [], total: 0 };
    let list = c.comments ?? [];
    if ((c.total ?? 0) > list.length) {
      list = [];
      let startAt = 0;
      for (;;) {
        const cp = await get(`/rest/api/3/issue/${iss.id}/comment?startAt=${startAt}&maxResults=100`);
        list.push(...(cp.comments ?? []));
        startAt += cp.comments?.length ?? 0;
        if (startAt >= (cp.total ?? 0) || !(cp.comments ?? []).length) break;
      }
      extraCmtFetch++;
      const extraAccounts = new Set();
      for (const cm of list) { if (cm.author?.accountId) extraAccounts.add(cm.author.accountId); }
      await ensureUsers(extraAccounts);
    }
    if (list.length) commentsByIssue.set(iss.id, list);
  });

  for (const iss of issues) {
    const f = iss.fields;
    const sprintArr = SPRINT_FIELD ? (f[SPRINT_FIELD] ?? []).map(parseSprint).filter(Boolean) : [];
    // 현재 소속 = 열린(비완료) 스프린트가 있으면 그것, 없으면 마지막(완료) 스프린트 — Jira 멤버십 규칙
    const openSp = sprintArr.find((s) => s.state !== 'closed');
    const sprintId = openSp ? openSp.id : (sprintArr.length ? sprintArr[sprintArr.length - 1].id : null);
    const { comment: _c, attachment: _a, issuelinks: _l, ...rawRest } = f;
    await query(
      `INSERT INTO jira_issues
         (id, project_id, issue_key, issue_type_id, status_id, summary, description_adf,
          priority, resolution, assignee_id, reporter_id, sprint_id, labels, fix_versions, components,
          created_at, updated_at, resolved_at, fields_raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
         status_id = EXCLUDED.status_id, summary = EXCLUDED.summary,
         description_adf = EXCLUDED.description_adf, priority = EXCLUDED.priority,
         resolution = EXCLUDED.resolution, assignee_id = EXCLUDED.assignee_id, sprint_id = EXCLUDED.sprint_id,
         labels = EXCLUDED.labels, fix_versions = EXCLUDED.fix_versions, components = EXCLUDED.components,
         updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at, fields_raw = EXCLUDED.fields_raw
       WHERE jira_issues.project_id = EXCLUDED.project_id`,
      [iss.id, project.id, iss.key, f.issuetype?.id ?? null, f.status?.id ?? null,
       f.summary ?? '(제목 없음)', f.description ? JSON.stringify(f.description) : null,
       f.priority?.name ?? null, f.resolution?.name ?? null,
       uid(f.assignee), uid(f.reporter), sprintId,
       f.labels ?? [], names(f.fixVersions), names(f.components),
       f.created ?? null, f.updated ?? null, f.resolutiondate ?? null,
       JSON.stringify(rawRest)]);
    knownIds.add(Number(iss.id));
    if (f.parent?.id) parentPairs.push([Number(iss.id), Number(f.parent.id)]);

    for (const c of commentsByIssue.get(iss.id) ?? []) {
      await query(
        `INSERT INTO jira_comments (id, issue_id, body_adf, author_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET body_adf = EXCLUDED.body_adf, updated_at = EXCLUDED.updated_at
         WHERE jira_comments.issue_id = EXCLUDED.issue_id`,
        [c.id, iss.id, c.body ? JSON.stringify(c.body) : null, uid(c.author), c.created ?? null, c.updated ?? null]);
      cmtCount++;
    }
    for (const a of f.attachment ?? []) {
      await query(
        `INSERT INTO jira_attachments (id, issue_id, filename, media_type, file_size, source_url, author_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url
         WHERE jira_attachments.issue_id = EXCLUDED.issue_id`,
        [a.id, iss.id, a.filename ?? '(이름 없음)', a.mimeType ?? null, a.size ?? null,
         a.content ?? null, uid(a.author), a.created ?? null]);
      attCount++;
    }
    for (const l of f.issuelinks ?? []) {
      if (seenLinks.has(l.id)) continue;
      seenLinks.add(l.id);
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

  total += issues.length;
  console.log(`  ${total}건 적재...`);
  if (page.isLast || !page.nextPageToken) break;
  token = page.nextPageToken;
}

// 부모 연결 (이관 범위 안의 이슈만)
let parentCnt = 0;
for (const [id, pid] of parentPairs) {
  // 증분 동기화에서는 상위가 이번 수집에 없을 수 있으므로 DB에 이미 있는지도 본다
  const ok = knownIds.has(pid)
    || (await query(`SELECT 1 FROM jira_issues WHERE id = $1`, [pid])).rows.length > 0;
  if (ok) {
    await query(`UPDATE jira_issues SET parent_id = $2 WHERE id = $1`, [id, pid]);
    parentCnt++;
  }
}

// 링크 양끝이 범위 밖(dangling)인 행은 그대로 둔다 — 뷰어가 '이관 범위 밖'으로 표시
// 신규 생성 ID가 이관 ID와 겹치지 않게 시퀀스 보정 (스프린트 포함)
await query(`SELECT setval('jira_sprints_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM jira_sprints), (SELECT last_value FROM jira_sprints_id_seq)))`);

console.log(`완료: 이슈 ${total} (부모 연결 ${parentCnt}) / 스프린트 ${seenSprints.size} / 사용자 ${userIdByAccount.size}`
  + ` / 댓글 ${cmtCount} (추가 조회 ${extraCmtFetch}이슈) / 첨부 ${attCount} / 링크 ${linkCount} / 버전 ${versions.length}`);
await closeDb();
