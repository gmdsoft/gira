#!/usr/bin/env node
// 개발 명세서 동기화: 원본은 Gonfluence 문서(GIRA 스페이스 › 개발문서), 저장소의 docs/alpha-spec.md는 사본이다.
// 개발참여 챗봇과 일일 처리 에이전트는 사본(파일)을 읽는다.
//   node scripts/spec-sync.mjs --pull              # Gonfluence 원본 → docs/alpha-spec.md + 캐시
//   node scripts/spec-sync.mjs --cache             # Gonfluence 원본 → 캐시(server/data/alpha-spec.md)만 — 작업 트리를 건드리지 않음
//   node scripts/spec-sync.mjs --push [-m "메시지"] # docs/alpha-spec.md → Gonfluence 새 버전으로 게시
//   node scripts/spec-sync.mjs --create            # (최초 1회) 개발문서 폴더 아래에 문서 생성
// 개발참여 챗봇과 일일 처리는 캐시를 읽는다(매일 일일 처리 시작 때 --cache). 저장소 사본은 명세를 고칠 때만 갱신한다.
// 명세를 고칠 때: Gonfluence에서 직접 편집하거나, --pull → 파일 수정 → (머지 후) --push.
// --push는 사본 머리말의 버전이 원본의 현재 버전과 같을 때만 게시한다 (그 사이 Gonfluence에서 고친 내용을 덮지 않게).
// 환경변수: GONFLUENCE_URL(기본 http://localhost:3001), SPEC_PAGE_ID, SPEC_SYNC_EMAIL(기본 ADMIN_EMAIL) — .env에서 읽는다
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { docToMarkdown, markdownToDoc } from '../server/src/markdown-doc.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const BASE = (process.env.GONFLUENCE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const PAGE_ID = process.env.SPEC_PAGE_ID ?? '1000000000009';
const SPACE_KEY = 'GIRA';
const FOLDER_ID = '1000000000008'; // GIRA 스페이스 › 개발문서
const TITLE = 'Gira·Gonfluence 알파 명세서';
const FILE = path.join(root, 'docs', 'alpha-spec.md');
const CACHE = path.join(process.env.DATA_DIR ?? path.join(root, 'server', 'data'), 'alpha-spec.md');
const EMAIL = process.env.SPEC_SYNC_EMAIL ?? process.env.ADMIN_EMAIL ?? 'pottery@gmdsoft.com';
// 사람에게 보여 줄 주소 (머리말): GONFLUENCE_PUBLIC_URL이 있으면 그것으로
const pageUrl = (id) => `${(process.env.GONFLUENCE_PUBLIC_URL ?? BASE).replace(/\/$/, '')}/s/${SPACE_KEY}/p/${id}`;

// 사본 머리말: 이 줄들은 --push 때 떼어 낸다
const HEADER_MARK = '<!-- spec-sync:';
const header = (id, version) => [
  `${HEADER_MARK} 자동 생성 사본 — 직접 고치지 말고 Gonfluence 원본을 고친 뒤 'node scripts/spec-sync.mjs --pull' -->`,
  `> 원본: Gonfluence GIRA › 개발문서 › ${TITLE} (${pageUrl(id)}), 버전 ${version}`,
  '', '',
].join('\n');
// 머리말 두 줄(표시 주석 + 원본 안내)과 뒤따르는 빈 줄만 떼어 낸다
const stripHeader = (md) => {
  if (!md.startsWith(HEADER_MARK)) return md;
  const lines = md.split('\n');
  let i = 1;
  if (lines[i]?.startsWith('> 원본:')) i++;
  while (lines[i] === '') i++;
  return lines.slice(i).join('\n');
};

const { values: opt } = parseArgs({
  options: { pull: { type: 'boolean' }, cache: { type: 'boolean' }, push: { type: 'boolean' }, create: { type: 'boolean' }, message: { type: 'string', short: 'm' } },
});

let cookie = '';
async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${json.error ?? ''}`);
  return json;
}

await call('POST', '/api/auth/login', { email: EMAIL });

if (opt.create) {
  const md = stripHeader(readFileSync(FILE, 'utf8'));
  const r = await call('POST', '/api/content', { spaceKey: SPACE_KEY, parentId: FOLDER_ID, title: TITLE, markdown: md, message: '저장소 명세서에서 옮겨 옴' });
  console.log(`생성: ${pageUrl(r.id)} — SPEC_PAGE_ID=${r.id}`);
} else if (opt.push) {
  const raw = readFileSync(FILE, 'utf8');
  const md = stripHeader(raw);
  const cur = await call('GET', `/api/content/${PAGE_ID}`);
  const base = Number(/, 버전 (\d+)\s*$/m.exec(raw.split('\n')[1] ?? '')?.[1]);
  if (base !== cur.version?.version) {
    console.error(`원본이 바뀜: 사본은 버전 ${base || '?'} 기준, 원본은 버전 ${cur.version?.version} — --pull로 최신화한 뒤 다시 고치세요`);
    process.exit(1);
  }
  if (docToMarkdown(cur.version?.doc) === docToMarkdown(markdownToDoc(md))) {
    console.log(`바뀐 내용 없음 — 게시하지 않음 (버전 ${cur.version?.version})`);
    process.exit(0);
  }
  await call('POST', `/api/content/${PAGE_ID}/publish`, { markdown: md, message: opt.message ?? '저장소 사본에서 게시' });
  const c = await call('GET', `/api/content/${PAGE_ID}`);
  const text = header(PAGE_ID, c.version?.version) + docToMarkdown(c.version?.doc);
  writeFileSync(FILE, text);
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, text);
  console.log(`게시: ${pageUrl(PAGE_ID)} 버전 ${c.version?.version}`);
} else if (opt.pull || opt.cache) {
  const c = await call('GET', `/api/content/${PAGE_ID}`);
  const text = header(PAGE_ID, c.version?.version) + docToMarkdown(c.version?.doc);
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, text);
  if (opt.pull) writeFileSync(FILE, text);
  console.log(`${opt.pull ? '사본·캐시' : '캐시'} 갱신 ← 버전 ${c.version?.version} (${c.updatedAt})`);
} else {
  console.log('사용법: --pull | --cache | --push [-m 메시지] | --create');
}
