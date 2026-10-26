#!/usr/bin/env node
// Confluence Cloud 읽기 전용 인벤토리 수집기.
// 마이그레이션 범위 산정과 데이터 모델 설계를 위해 스페이스/페이지/매크로/첨부/권한 통계를 모은다.
// GET 요청만 사용한다.
//
// 사용법:
//   node scripts/confluence-inventory.mjs [--space KEY] [--max-spaces N] [--deep]
//   --deep: 페이지별 첨부파일·라벨·댓글까지 조회 (페이지 수만큼 요청이 늘어남)
//
// 출력:
//   analysis/raw/inventory.json  스페이스·페이지 제목 포함 상세 (git 제외)
//   analysis/summary.json        제목 없는 집계 통계

import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

try {
  process.loadEnvFile('.env');
} catch {
  // 환경변수로 직접 넘겨도 된다
}

const { values: args } = parseArgs({
  options: {
    space: { type: 'string' },
    'max-spaces': { type: 'string' },
    deep: { type: 'boolean', default: false },
  },
});

const SITE = (process.env.ATLASSIAN_SITE ?? 'https://gmdsoft.atlassian.net').replace(/\/$/, '');
const { ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN } = process.env;
if (!ATLASSIAN_EMAIL || !ATLASSIAN_API_TOKEN) {
  console.error('ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN 을 .env 에 설정하세요 (.env.example 참고).');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${ATLASSIAN_EMAIL}:${ATLASSIAN_API_TOKEN}`).toString('base64');

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

async function* paginate(path) {
  let next = path;
  while (next) {
    const data = await get(next);
    yield* data.results ?? [];
    next = data._links?.next;
  }
}

async function collect(path) {
  const out = [];
  for await (const item of paginate(path)) out.push(item);
  return out;
}

// 403/404 는 권한 부족 등으로 흔하므로 전체 수집을 중단하지 않고 기록만 한다
async function tryCollect(path, errors) {
  try {
    return await collect(path);
  } catch (e) {
    errors.push(e.message);
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const inc = (map, key, n = 1) => (map[key] = (map[key] ?? 0) + n);

// storage format(XHTML) 에서 마이그레이션 시 변환이 필요한 요소를 센다
function analyzeStorage(xhtml = '') {
  const macros = {};
  for (const m of xhtml.matchAll(/<ac:structured-macro\b[^>]*\bac:name="([^"]+)"/g)) inc(macros, m[1]);
  const count = (re) => (xhtml.match(re) ?? []).length;
  return {
    bytes: Buffer.byteLength(xhtml),
    macros,
    elements: {
      image: count(/<ac:image\b/g),
      attachmentRef: count(/<ri:attachment\b/g),
      pageLink: count(/<ri:page\b/g),
      userMention: count(/<ri:user\b/g),
      table: count(/<table\b/g),
      taskList: count(/<ac:task-list\b/g),
      layout: count(/<ac:layout\b/g),
      emoticon: count(/<ac:emoticon\b/g),
      inlineCommentMarker: count(/<ac:inline-comment-marker\b/g),
      adfExtension: count(/<ac:adf-extension\b/g),
    },
  };
}

function depthOf(page, byId) {
  let d = 0;
  for (let p = page; p?.parentId && byId.has(p.parentId); p = byId.get(p.parentId)) d++;
  return d;
}

const errors = [];
const summary = {
  collectedAt: new Date().toISOString(),
  site: SITE,
  deep: args.deep,
  spaces: { total: 0, byType: {}, byStatus: {} },
  pages: { total: 0, byStatus: {}, maxDepth: 0, depthHistogram: {}, versionHistogram: {}, totalStorageBytes: 0 },
  blogposts: { total: 0 },
  macros: {},
  elements: {},
  distinctAuthors: 0,
  permissions: { principalTypes: {}, operations: {} },
  attachments: { total: 0, totalBytes: 0, byMediaType: {} },
  labels: { total: 0, distinct: 0 },
  comments: { footer: 0, inline: 0 },
};
const raw = { spaces: [] };
const authors = new Set();
const labelNames = new Set();

const versionBucket = (n) => (n <= 1 ? '1' : n <= 5 ? '2-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '100+');

let spaces = await collect('/wiki/api/v2/spaces?limit=250');
if (args.space) spaces = spaces.filter((s) => s.key === args.space);
if (args['max-spaces']) spaces = spaces.slice(0, Number(args['max-spaces']));
console.error(`스페이스 ${spaces.length}개 수집 시작`);

for (const [si, space] of spaces.entries()) {
  console.error(`[${si + 1}/${spaces.length}] ${space.key}`);
  inc(summary.spaces.byType, space.type);
  inc(summary.spaces.byStatus, space.status);

  const pages =
    (await tryCollect(
      `/wiki/api/v2/spaces/${space.id}/pages?limit=250&status=current&status=archived&body-format=storage`,
      errors,
    )) ?? [];
  const blogposts = (await tryCollect(`/wiki/api/v2/spaces/${space.id}/blogposts?limit=250`, errors)) ?? [];
  const permissions = (await tryCollect(`/wiki/api/v2/spaces/${space.id}/permissions?limit=250`, errors)) ?? [];

  for (const p of permissions) {
    inc(summary.permissions.principalTypes, p.principal?.type ?? 'unknown');
    inc(summary.permissions.operations, `${p.operation?.key}:${p.operation?.targetType}`);
  }

  const byId = new Map(pages.map((p) => [p.id, p]));
  const rawPages = pages.map((p) => {
    const a = analyzeStorage(p.body?.storage?.value);
    const depth = depthOf(p, byId);
    const versions = p.version?.number ?? 1;
    if (p.authorId) authors.add(p.authorId);
    inc(summary.pages.byStatus, p.status);
    inc(summary.pages.depthHistogram, String(depth));
    inc(summary.pages.versionHistogram, versionBucket(versions));
    summary.pages.maxDepth = Math.max(summary.pages.maxDepth, depth);
    summary.pages.totalStorageBytes += a.bytes;
    for (const [k, v] of Object.entries(a.macros)) inc(summary.macros, k, v);
    for (const [k, v] of Object.entries(a.elements)) inc(summary.elements, k, v);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      parentId: p.parentId,
      parentType: p.parentType,
      depth,
      versions,
      authorId: p.authorId,
      createdAt: p.createdAt,
      storageBytes: a.bytes,
      macros: a.macros,
    };
  });

  if (args.deep) {
    await mapLimit(rawPages, 4, async (rp) => {
      const [attachments, labels, footer, inline] = await Promise.all([
        tryCollect(`/wiki/api/v2/pages/${rp.id}/attachments?limit=250`, errors),
        tryCollect(`/wiki/api/v2/pages/${rp.id}/labels?limit=250`, errors),
        tryCollect(`/wiki/api/v2/pages/${rp.id}/footer-comments?limit=250`, errors),
        tryCollect(`/wiki/api/v2/pages/${rp.id}/inline-comments?limit=250`, errors),
      ]);
      for (const at of attachments ?? []) {
        summary.attachments.total++;
        summary.attachments.totalBytes += at.fileSize ?? 0;
        inc(summary.attachments.byMediaType, at.mediaType ?? 'unknown');
      }
      for (const l of labels ?? []) labelNames.add(l.name);
      summary.labels.total += labels?.length ?? 0;
      summary.comments.footer += footer?.length ?? 0;
      summary.comments.inline += inline?.length ?? 0;
      rp.attachments = attachments?.length ?? 0;
      rp.attachmentBytes = (attachments ?? []).reduce((s, at) => s + (at.fileSize ?? 0), 0);
      rp.labels = labels?.map((l) => l.name) ?? [];
      rp.comments = { footer: footer?.length ?? 0, inline: inline?.length ?? 0 };
    });
  }

  summary.spaces.total++;
  summary.pages.total += pages.length;
  summary.blogposts.total += blogposts.length;
  raw.spaces.push({
    id: space.id,
    key: space.key,
    name: space.name,
    type: space.type,
    status: space.status,
    homepageId: space.homepageId,
    pageCount: pages.length,
    blogpostCount: blogposts.length,
    permissionCount: permissions.length,
    pages: rawPages,
  });
}

summary.distinctAuthors = authors.size;
summary.labels.distinct = labelNames.size;
summary.macros = Object.fromEntries(Object.entries(summary.macros).sort((a, b) => b[1] - a[1]));
summary.errors = { count: errors.length, samples: errors.slice(0, 20) };

await mkdir('analysis/raw', { recursive: true });
await writeFile('analysis/raw/inventory.json', JSON.stringify(raw, null, 2));
await writeFile('analysis/summary.json', JSON.stringify(summary, null, 2));
console.error(`완료: 스페이스 ${summary.spaces.total}, 페이지 ${summary.pages.total}, 오류 ${errors.length}`);
console.log(JSON.stringify(summary, null, 2));
