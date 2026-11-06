#!/usr/bin/env node
// 원본 Jira 전체 이슈 호환성 전수 조사 — GET만 사용한다.
// 모든 프로젝트의 이슈를 fields=*all로 훑어, 프로젝트별로 필드 사용량·ADF 노드/마크 종류·
// 작업 로그·관찰자·투표·첨부·링크·보안 수준 등을 집계한다 (이슈 본문은 저장하지 않음).
//
// 출력 (analysis/raw/ 는 gitignore): analysis/raw/jira/fullscan.json (프로젝트 단위로 이어서 실행 가능)
// 사용: node scripts/jira-fullscan.mjs [--projects A,B] [--concurrency 3]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수로 직접 */ }
const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('--projects') ? new Set(arg('--projects').split(',')) : null;
const CONC = Number(arg('--concurrency', 3));
const OUT = 'analysis/raw/jira/fullscan.json';
mkdirSync('analysis/raw/jira', { recursive: true });

async function get(path, attempt = 0) {
  const res = await fetch(SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 7) {
    await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} GET ${path.slice(0, 120)}`);
  return res.json();
}

const inc = (m, k, n = 1) => (m[k] = (m[k] ?? 0) + n);
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
// ADF 트리에서 노드·마크·확장 종류를 센다
function walkAdf(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (node.type) inc(acc.nodes, node.type);
  for (const m of node.marks ?? []) inc(acc.marks, m.type);
  if (/extension/i.test(node.type ?? '')) inc(acc.ext, `${node.attrs?.extensionType ?? ''}:${node.attrs?.extensionKey ?? ''}`);
  if (node.type === 'inlineCard' || node.type === 'blockCard' || node.type === 'embedCard') {
    try { inc(acc.cardHosts, new URL(node.attrs?.url ?? '').host); } catch { inc(acc.cardHosts, '(data)'); }
  }
  if (node.type === 'media') inc(acc.mediaTypes, node.attrs?.type ?? '?');
  for (const c of node.content ?? []) walkAdf(c, acc);
}
const isAdf = (v) => v && typeof v === 'object' && v.type === 'doc';

const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), projects: {} };
const save = () => writeFileSync(OUT, JSON.stringify(state));

const fieldList = await get('/rest/api/3/field');
state.fields = Object.fromEntries(fieldList.map((f) => [f.id, { name: f.name, custom: f.custom, type: f.schema?.type ?? null, items: f.schema?.items ?? null, customType: f.schema?.custom ?? null }]));
const projects = JSON.parse(readFileSync('analysis/raw/jira/projects.json', 'utf8'))
  .filter((p) => (!ONLY || ONLY.has(p.key)) && !state.projects[p.key]?.done);
console.error(`대상 프로젝트 ${projects.length}개`);

async function scan(p) {
  const r = { key: p.key, name: p.name, type: p.projectTypeKey, style: p.style, issues: 0,
    fieldUse: {}, issueTypes: {}, statusCats: {}, adf: { nodes: {}, marks: {}, ext: {}, cardHosts: {}, mediaTypes: {} },
    worklogIssues: 0, worklogs: 0, timeTracked: 0, watchers: 0, votedIssues: 0, votes: 0, attachments: 0, attachBytes: 0,
    links: 0, linkTypes: {}, subtasks: 0, withParent: 0, security: {}, commentTotal: 0, commentsVisRestricted: 0,
    commentsTruncated: 0, environment: 0, errors: [] };
  const jql = encodeURIComponent(`project = "${p.key}" ORDER BY created ASC`);
  let token = null;
  for (;;) {
    let page;
    try { page = await get(`/rest/api/3/search/jql?jql=${jql}&maxResults=100&fields=*all${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`); }
    catch (e) { r.errors.push(e.message); break; }
    for (const iss of page.issues ?? []) {
      r.issues++;
      const f = iss.fields;
      for (const [k, v] of Object.entries(f)) if (!isEmpty(v)) inc(r.fieldUse, k);
      inc(r.issueTypes, `${f.issuetype?.name}${f.issuetype?.subtask ? '(sub)' : ''}`);
      inc(r.statusCats, f.status?.statusCategory?.key ?? '?');
      for (const v of Object.values(f)) if (isAdf(v)) walkAdf(v, r.adf);
      const cm = f.comment;
      if (cm) {
        r.commentTotal += cm.total ?? 0;
        if ((cm.total ?? 0) > (cm.comments?.length ?? 0)) r.commentsTruncated++;
        for (const c of cm.comments ?? []) { walkAdf(c.body, r.adf); if (c.visibility) r.commentsVisRestricted++; }
      }
      if (f.worklog?.total) { r.worklogIssues++; r.worklogs += f.worklog.total; }
      if (f.timespent) r.timeTracked++;
      r.watchers += f.watches?.watchCount ?? 0;
      if (f.votes?.votes) { r.votedIssues++; r.votes += f.votes.votes; }
      for (const a of f.attachment ?? []) { r.attachments++; r.attachBytes += a.size ?? 0; }
      for (const l of f.issuelinks ?? []) { r.links++; inc(r.linkTypes, l.type?.name ?? '?'); }
      if (f.issuetype?.subtask) r.subtasks++;
      if (f.parent) r.withParent++;
      if (f.security) inc(r.security, f.security.name ?? '?');
      if (f.environment) r.environment++;
    }
    if (page.isLast || !page.nextPageToken || !(page.issues ?? []).length) break;
    token = page.nextPageToken;
  }
  r.done = !r.errors.length;
  state.projects[p.key] = r;
  save();
  console.error(`${p.key}: ${r.issues}건${r.errors.length ? ' 오류 ' + r.errors[0] : ''}`);
}

let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (i < projects.length) await scan(projects[i++]); }));
state.finishedAt = new Date().toISOString();
save();
console.error('완료');
