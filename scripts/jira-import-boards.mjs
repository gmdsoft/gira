#!/usr/bin/env node
// Jira Cloud 보드 이관 — 읽기 전용 GET만 사용.
// 프로젝트에 위치(location)가 지정된 보드의 이름·유형(scrum/kanban)·컬럼(상태 매핑)·필터(JQL)를 가져온다.
//
// 사용법: node scripts/jira-import-boards.mjs --project NEXT

import { parseArgs } from 'node:util';
import { query, closeDb } from '../server/src/db.mjs';
import { parseJql, JqlError } from '../server/src/jql.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({ options: { project: { type: 'string' } } });
if (!args.project) { console.error('사용법: node scripts/jira-import-boards.mjs --project <KEY>'); process.exit(1); }

const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
async function get(p) {
  const res = await fetch(SITE + p, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — GET ${p}`);
  return res.json();
}

const { rows: prow } = await query(`SELECT id FROM jira_projects WHERE key = $1`, [args.project]);
if (!prow.length) { console.error(`프로젝트 ${args.project}가 로컬 DB에 없습니다.`); process.exit(1); }
const projectId = prow[0].id;

const list = await get(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(args.project)}&maxResults=50`);
const boards = (list.values ?? []).filter((b) => b.location?.projectKey === args.project);
console.log(`보드 ${boards.length}개 (전체 연관 ${list.total}개 중 프로젝트 위치 보드만)`);

let ok = 0;
for (const b of boards) {
  const conf = await get(`/rest/agile/1.0/board/${b.id}/configuration`);
  const columns = (conf.columnConfig?.columns ?? []).map((c) => ({
    name: c.name, statusIds: (c.statuses ?? []).map((s) => Number(s.id)),
  }));
  let jql = null;
  if (conf.filter?.id) {
    try { jql = (await get(`/rest/api/3/filter/${conf.filter.id}`)).jql || null; }
    catch (e) { console.warn(`  [${b.name}] 필터 ${conf.filter.id} 조회 실패: ${e.message}`); }
  }
  if (jql) {
    try { parseJql(jql, { p: () => '$1', userId: 0 }); }
    catch (e) {
      if (!(e instanceof JqlError)) throw e;
      console.warn(`  [${b.name}] 필터 JQL이 PoC 파서 미지원이라 비워둠: ${e.message}\n    JQL: ${jql}`);
      jql = null;
    }
  }
  await query(
    `INSERT INTO jira_boards (project_id, name, columns, type, jql, source_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_id) DO UPDATE SET
       name = EXCLUDED.name, columns = EXCLUDED.columns, type = EXCLUDED.type, jql = EXCLUDED.jql`,
    [projectId, b.name, JSON.stringify(columns), b.type ?? null, jql, b.id]);
  console.log(`  ✓ ${b.name} (${b.type}) — 컬럼 ${columns.length}개${jql ? `, 필터: ${jql}` : ''}`);

  // 스크럼 보드의 스프린트 표시 순서(백로그 정렬) 반영
  if (b.type === 'scrum') {
    try {
      const sp = await get(`/rest/agile/1.0/board/${b.id}/sprint?state=active,future&maxResults=50`);
      let pos = 0;
      for (const s of sp.values ?? []) {
        await query(`UPDATE jira_sprints SET position = $2 WHERE id = $1`, [s.id, pos++]);
      }
      console.log(`    스프린트 순서 ${pos}개 반영`);
    } catch (e) { console.warn(`    스프린트 순서 조회 실패: ${e.message}`); }
  }
  ok++;
}
console.log(`완료: ${ok}/${boards.length}`);
await closeDb();
