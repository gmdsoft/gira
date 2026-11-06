#!/usr/bin/env node
// Confluence Cloud → 새 서비스 DB 임포터 (PoC: 스페이스 단위, 최신 버전만).
// 읽기 전용 GET 요청만 사용한다. 전체 버전 이력 이관은 파이프라인 단계에서 확장한다.
//
// 사용법: node scripts/import-space.mjs --space Research [--wipe] [--since <ISO 시각>] [--pages <id,id,...>]
//   --pages: 그 스페이스의 지정한 페이지만 가져온다(확인·시험용). 새 스페이스는 권한 규칙이 없어 사이트 관리자만 보인다

import { parseArgs } from 'node:util';
import { convertStorage } from './convert-storage.mjs';
import { query, closeDb } from '../server/src/db.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({
  options: {
    space: { type: 'string' },
    wipe: { type: 'boolean', default: false },
    since: { type: 'string' }, // 증분 동기화 (ISO 시각): 이후 수정·신규 페이지만 본문까지 받는다
    pages: { type: 'string' }, // 지정 페이지만 (쉼표 구분 id)
  },
});
if (!args.space) {
  console.error('사용법: node scripts/import-space.mjs --space <KEY> [--wipe] [--since <ISO 시각>] [--pages <id,...>]');
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

async function getAll(path) {
  const out = [];
  let next = path;
  while (next) {
    const data = await get(next);
    out.push(...(data.results ?? []));
    next = data._links?.next;
  }
  return out;
}

// v2 API가 시각을 ISO 문자열 또는 epoch 밀리초로 섞어 반환한다 (예: 폴더 createdAt)
function ts(v) {
  if (!v) return null;
  if (/^\d{10,}$/.test(String(v))) return new Date(Number(v)).toISOString();
  return v;
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

console.log(`스페이스 ${args.space} 조회...`);
const spaceRes = await get(`/wiki/api/v2/spaces?keys=${encodeURIComponent(args.space)}`);
const space = spaceRes.results?.[0];
if (!space) { console.error('스페이스를 찾을 수 없습니다.'); process.exit(1); }
console.log(`  ${space.id} ${space.key} "${space.name}" (${space.type})`);

let pages;
if (args.pages) {
  if (args.wipe) { console.error('--pages와 --wipe는 같이 쓸 수 없습니다.'); process.exit(1); }
  const ids = args.pages.split(',').map((x) => x.trim()).filter(Boolean);
  console.log(`지정 페이지 ${ids.length}건 수집 (본문 포함)...`);
  pages = (await mapLimit(ids, 6, (id) => get(`/wiki/api/v2/pages/${id}?body-format=storage`)))
    .filter((p) => { const ok = String(p.spaceId) === String(space.id); if (!ok) console.log(`  ⚠ ${p.id} "${p.title}"는 ${args.space} 스페이스가 아니라 건너뜀`); return ok; });
  console.log(`  페이지 ${pages.length}건`);
} else if (!args.since) {
  console.log('페이지 수집 (본문 포함)...');
  pages = await getAll(`/wiki/api/v2/spaces/${space.id}/pages?body-format=storage&limit=100`);
  console.log(`  페이지 ${pages.length}건`);
} else {
  // 증분: 목록(본문 없이)만 받아 바뀐 페이지를 고르고, 그것만 본문을 받는다 (1시간 여유)
  const since = new Date(new Date(args.since).getTime() - 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) throw new Error(`--since 형식 오류: ${args.since}`);
  const listed = await getAll(`/wiki/api/v2/spaces/${space.id}/pages?limit=250`);
  const { rows: have } = await query(`SELECT id::text AS id FROM content WHERE id = ANY($1::bigint[])`,
    [listed.map((p) => p.id)]);
  const haveIds = new Set(have.map((r) => r.id));
  const changed = listed.filter((p) => !haveIds.has(String(p.id))
    || new Date(p.version?.createdAt ?? 0) >= since);
  console.log(`  페이지 ${listed.length}건 중 변경·신규 ${changed.length}건 (기준 ${since.toISOString()})`);
  pages = await mapLimit(changed, 6, (p) => get(`/wiki/api/v2/pages/${p.id}?body-format=storage`));
}

// 충돌 가드: 원본 페이지와 id가 같은 '로컬에서 만든 페이지'(원본 본문 버전이 하나도 없는 page/live)는
// 덮어쓰지 않는다 — 로컬 번호가 원본 대역 위에서 발급되던 시절의 페이지 보호
{
  const { rows: clash } = await query(
    `SELECT c.id::text AS id, c.title FROM content c
      WHERE c.id = ANY($1::bigint[]) AND c.type IN ('page', 'live')
        AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.content_id = c.id AND v.source_xhtml IS NOT NULL)`,
    [pages.map((p) => p.id)]);
  const clashIds = new Set(clash.map((r) => r.id));
  for (const c of clash) console.log(`  ⚠ 충돌 건너뜀: 원본 페이지 id ${c.id}가 로컬 페이지 "${c.title}"와 겹침`);
  pages = pages.filter((p) => !clashIds.has(String(p.id)));
}

// 폴더: 페이지 부모 체인에 등장하는 폴더를 재귀적으로 수집
const folders = new Map();
{
  const queue = [...new Set(pages.filter((p) => p.parentType === 'folder').map((p) => p.parentId))];
  while (queue.length) {
    const id = queue.shift();
    if (!id || folders.has(id)) continue;
    const f = await get(`/wiki/api/v2/folders/${id}`);
    folders.set(id, f);
    if (f.parentType === 'folder' && f.parentId && !folders.has(f.parentId)) queue.push(f.parentId);
  }
  console.log(`  폴더 ${folders.size}건`);
}

console.log('페이지별 첨부/라벨/댓글 수집...');
let done = 0;
const perPage = await mapLimit(pages, 6, async (p) => {
  const [attachments, labels, footer, inline, props] = await Promise.all([
    getAll(`/wiki/api/v2/pages/${p.id}/attachments?limit=100`),
    getAll(`/wiki/api/v2/pages/${p.id}/labels?limit=100`),
    getAll(`/wiki/api/v2/pages/${p.id}/footer-comments?body-format=storage&limit=100`),
    getAll(`/wiki/api/v2/pages/${p.id}/inline-comments?body-format=storage&limit=100`),
    getAll(`/wiki/api/v2/pages/${p.id}/properties?key=content-appearance-published`).catch(() => []),
  ]);
  if (++done % 25 === 0) console.log(`  ${done}/${pages.length}`);
  // Confluence 기본은 고정 폭(넓은 블록은 돌출 렌더링). 명시적으로 full-width일 때만 전체 폭.
  const fullWidth = props.some((pr) => String(pr.value).replaceAll('"', '') === 'full-width');
  return { attachments, labels, footer, inline, fullWidth };
});

// ---------- 변환 ----------

console.log('본문 변환...');
const convertStats = { ok: 0, empty: 0, failed: 0 };
const docs = pages.map((p) => {
  const xhtml = p.body?.storage?.value ?? '';
  if (!xhtml.trim()) { convertStats.empty++; return { doc: null, xhtml }; }
  try {
    const { doc } = convertStorage(xhtml);
    convertStats.ok++;
    return { doc, xhtml };
  } catch (e) {
    convertStats.failed++;
    console.error(`  변환 실패 ${p.id} "${p.title}": ${e.message}`);
    return { doc: null, xhtml };
  }
});
console.log(`  성공 ${convertStats.ok}, 빈 본문 ${convertStats.empty}, 실패 ${convertStats.failed}`);

// 멘션 accountId 수집 (표시 이름 보강용)
const mentionIds = new Set();
function walk(node, fn) {
  fn(node);
  for (const c of node?.content ?? []) walk(c, fn);
}
for (const { doc } of docs) if (doc) walk(doc, (n) => { if (n.type === 'mention' && n.attrs?.accountId) mentionIds.add(n.attrs.accountId); });

// ---------- 사용자 ----------

const accountIds = new Set(mentionIds);
for (const p of pages) {
  if (p.authorId) accountIds.add(p.authorId);
  if (p.ownerId) accountIds.add(p.ownerId);
  if (p.version?.authorId) accountIds.add(p.version.authorId);
}
for (const f of folders.values()) {
  if (f.authorId) accountIds.add(f.authorId);
  if (f.ownerId) accountIds.add(f.ownerId);
}
for (const pp of perPage) {
  for (const a of pp.attachments) if (a.version?.authorId) accountIds.add(a.version.authorId);
  for (const c of [...pp.footer, ...pp.inline]) if (c.version?.authorId) accountIds.add(c.version.authorId);
}

console.log(`사용자 ${accountIds.size}명 조회...`);
const users = new Map(); // accountId → { displayName, email }
{
  const ids = [...accountIds];
  for (let i = 0; i < ids.length; i += 90) {
    const batch = ids.slice(i, i + 90);
    const qs = batch.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const res = await get(`/wiki/rest/api/user/bulk?${qs}`);
    for (const u of res.results ?? []) {
      users.set(u.accountId, { displayName: u.displayName ?? u.publicName ?? u.accountId, email: u.email || null });
    }
  }
  for (const id of ids) if (!users.has(id)) users.set(id, { displayName: '(알 수 없는 사용자)', email: null });
}

// 멘션 표시 이름 채우기
for (const { doc } of docs) if (doc) walk(doc, (n) => {
  if (n.type === 'mention' && n.attrs?.accountId && !n.attrs.text) {
    n.attrs.text = users.get(n.attrs.accountId)?.displayName ?? '';
  }
});

// ---------- DB 적재 ----------

console.log('DB 적재...');

if (args.wipe) {
  await query(`DELETE FROM content_labels WHERE content_id IN (SELECT id FROM content WHERE space_id = $1)`, [space.id]);
  await query(`DELETE FROM comments WHERE content_id IN (SELECT id FROM content WHERE space_id = $1)`, [space.id]);
  await query(`DELETE FROM attachments WHERE content_id IN (SELECT id FROM content WHERE space_id = $1)`, [space.id]);
  await query(`DELETE FROM content_versions WHERE content_id IN (SELECT id FROM content WHERE space_id = $1)`, [space.id]);
  await query(`UPDATE spaces SET homepage_id = NULL WHERE id = $1`, [space.id]);
  await query(`UPDATE content SET parent_id = NULL WHERE space_id = $1`, [space.id]);
  await query(`DELETE FROM content WHERE space_id = $1`, [space.id]);
  await query(`DELETE FROM spaces WHERE id = $1`, [space.id]);
}

// 사용자 upsert → accountId → users.id 매핑
const userIdByAccount = new Map();
for (const [accountId, u] of users) {
  const { rows } = await query(
    `INSERT INTO users (email, confluence_account_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`, [u.email, accountId, u.displayName]);
  userIdByAccount.set(accountId, rows[0].id);
}
const uid = (accountId) => (accountId ? userIdByAccount.get(accountId) ?? null : null);

const spaceTypeMap = { global: 'global', personal: 'personal', collaboration: 'collaboration', knowledge_base: 'knowledge_base' };
await query(
  `INSERT INTO spaces (id, key, name, type, status, created_at)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
   WHERE spaces.key = EXCLUDED.key`,
  [space.id, space.key, space.name, spaceTypeMap[space.type] ?? 'global', space.status ?? 'current', ts(space.createdAt)]);

// 1차: 콘텐츠 행 (parent_id 없이), 2차: parent_id 업데이트 — FK 순서 문제 회피
for (const f of folders.values()) {
  await query(
    `INSERT INTO content (id, space_id, type, title, position, status, author_id, owner_id, created_at)
     VALUES ($1, $2, 'folder', $3, $4, 'current', $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, position = EXCLUDED.position
     WHERE content.type = 'folder'`,
    [f.id, space.id, f.title ?? '(폴더)', f.position ?? null, uid(f.authorId), uid(f.ownerId), ts(f.createdAt)]);
}
for (const [i, p] of pages.entries()) {
  const subtype = p.subtype === 'live' ? 'live' : 'page';
  await query(
    `INSERT INTO content (id, space_id, type, title, position, status, author_id, owner_id, current_version, full_width, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       space_id = EXCLUDED.space_id, title = EXCLUDED.title, position = EXCLUDED.position,
       status = EXCLUDED.status, current_version = EXCLUDED.current_version,
       full_width = EXCLUDED.full_width, updated_at = EXCLUDED.updated_at`,
    [p.id, space.id, subtype, p.title, p.position ?? null, p.status ?? 'current',
     uid(p.authorId), uid(p.ownerId), p.version?.number ?? 1, perPage[i]?.fullWidth ?? false,
     ts(p.createdAt), ts(p.version?.createdAt)]);
}
const knownIds = new Set([...folders.keys(), ...pages.map((p) => p.id)]);
// 증분 동기화에서는 부모가 이번 수집에 없을 수 있으므로 DB에 있는지도 본다
const inDb = async (id) => (await query(`SELECT 1 FROM content WHERE id = $1`, [id])).rows.length > 0;
const linkable = async (id) => !!id && (knownIds.has(id) || await inDb(id));
for (const f of folders.values()) {
  if (await linkable(f.parentId)) {
    await query(`UPDATE content SET parent_id = $2 WHERE id = $1`, [f.id, f.parentId]);
  }
}
for (const p of pages) {
  if (await linkable(p.parentId)) {
    await query(`UPDATE content SET parent_id = $2 WHERE id = $1`, [p.id, p.parentId]);
  }
}
if (await linkable(space.homepageId)) {
  await query(`UPDATE spaces SET homepage_id = $2 WHERE id = $1`, [space.id, space.homepageId]);
} else if (!args.since && !args.pages) {
  await query(`UPDATE spaces SET homepage_id = NULL WHERE id = $1`, [space.id]);
}

// 버전 (최신만)
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  const { doc, xhtml } = docs[i];
  await query(
    `INSERT INTO content_versions (content_id, version, doc, source_xhtml, message, minor_edit, author_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (content_id, version) DO UPDATE SET doc = EXCLUDED.doc, source_xhtml = EXCLUDED.source_xhtml`,
    [p.id, p.version?.number ?? 1, doc ? JSON.stringify(doc) : null, xhtml,
     p.version?.message ?? null, p.version?.minorEdit ?? false, uid(p.version?.authorId), ts(p.version?.createdAt)]);
}

// 첨부, 라벨, 댓글
const labelIds = new Map();
async function labelId(name) {
  if (labelIds.has(name)) return labelIds.get(name);
  const { rows } = await query(
    `INSERT INTO labels (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
  labelIds.set(name, rows[0].id);
  return rows[0].id;
}

let attCount = 0, cmtCount = 0, lblCount = 0;
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  const pp = perPage[i];
  for (const a of pp.attachments) {
    const attId = String(a.id).replace(/^att/, '');
    await query(
      `INSERT INTO attachments (id, content_id, filename, media_type, file_size, source_url, version, author_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url
       WHERE attachments.content_id = EXCLUDED.content_id`,
      [attId, p.id, a.title ?? '(이름 없음)', a.mediaType ?? null, a.fileSize ?? null,
       a.downloadLink ?? a._links?.download ?? null, a.version?.number ?? 1,
       uid(a.version?.authorId), ts(a.createdAt ?? a.version?.createdAt)]);
    attCount++;
  }
  for (const l of pp.labels) {
    await query(
      `INSERT INTO content_labels (content_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [p.id, await labelId(l.name)]);
    lblCount++;
  }
  for (const kind of ['footer', 'inline']) {
    for (const c of pp[kind]) {
      let doc = null;
      const xhtml = c.body?.storage?.value ?? '';
      if (xhtml.trim()) { try { doc = convertStorage(xhtml).doc; } catch { /* 본문 없이 적재 */ } }
      await query(
        `INSERT INTO comments (id, content_id, kind, inline_ref, resolved, doc, author_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, resolved = EXCLUDED.resolved
         WHERE comments.content_id = EXCLUDED.content_id`,
        [c.id, p.id, kind, c.properties?.['inline-marker-ref'] ?? null,
         c.resolutionStatus === 'resolved', doc ? JSON.stringify(doc) : null,
         uid(c.version?.authorId), ts(c.version?.createdAt)]);
      cmtCount++;
    }
  }
}

console.log(`완료: 콘텐츠 ${knownIds.size} (폴더 ${folders.size}) / 사용자 ${users.size} / 첨부 ${attCount} / 라벨 ${lblCount} / 댓글 ${cmtCount}`);
await closeDb();
