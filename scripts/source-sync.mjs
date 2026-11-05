#!/usr/bin/env node
// 원본 동기화(병행 운영기): 이관된 프로젝트/스페이스를 원본 Jira·Confluence와 증분 동기화한다.
// 원본 호출은 전부 읽기 전용(GET) — 기존 임포터를 --since 증분 모드로 실행한다.
// 규칙(명세서 '병행 운영기 동기화'): 원본 우선(같은 항목은 원본 내용으로 갱신), 로컬에서 만든 항목은
// 유지(임포터의 충돌 가드가 같은 id의 로컬 행을 건너뛴다). 원본에서 삭제된 항목은 반영하지 않는다.
//
// 사용법:
//   node scripts/source-sync.mjs --app gira          # Gira: 이관된 Jira 프로젝트 전부
//   node scripts/source-sync.mjs --app gonfluence    # Gonfluence: 이관된 Confluence 스페이스 전부
//   (--key NEXT 처럼 하나만, --since <ISO> 로 기준 시각 강제 가능)
// 서버(jira-viewer / index)가 SOURCE_SYNC_HOURS(기본 3)마다 자동 실행한다.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureDb, getDb, query, closeDb } from '../server/src/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const { values: args } = parseArgs({
  options: { app: { type: 'string' }, key: { type: 'string' }, since: { type: 'string' } },
});
const APPS = {
  gira: {
    kind: 'jira-project',
    db: () => process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL,
    schemas: 'schema-core.sql,schema-jira.sql',
    // 원본에서 온 프로젝트 = 원본 이슈(fields_raw가 비어 있지 않음)가 있는 프로젝트
    targets: `SELECT p.key, (SELECT max(updated_at) FROM jira_issues i
                 WHERE i.project_id = p.id AND i.fields_raw::text <> '{}') AS last_source
               FROM jira_projects p
              WHERE EXISTS (SELECT 1 FROM jira_issues i WHERE i.project_id = p.id AND i.fields_raw::text <> '{}')
              ORDER BY p.key`,
    steps: (key, since) => [
      ['scripts/jira-import-project.mjs', '--project', key, '--since', since],
      ['scripts/jira-import-changelog.mjs', '--project', key, '--since', since],
      ['scripts/jira-import-boards.mjs', '--project', key],
    ],
  },
  gonfluence: {
    kind: 'conf-space',
    db: () => process.env.DATABASE_URL,
    schemas: 'schema-core.sql,schema.sql',
    // 원본에서 온 스페이스 = 원본 본문 버전(source_xhtml)이 있는 콘텐츠가 있는 스페이스
    targets: `SELECT s.key, (SELECT max(c.updated_at) FROM content c WHERE c.space_id = s.id
                 AND EXISTS (SELECT 1 FROM content_versions v WHERE v.content_id = c.id AND v.source_xhtml IS NOT NULL))
                 AS last_source
               FROM spaces s
              WHERE EXISTS (SELECT 1 FROM content c JOIN content_versions v ON v.content_id = c.id
                             WHERE c.space_id = s.id AND v.source_xhtml IS NOT NULL)
              ORDER BY s.key`,
    steps: (key, since) => [['scripts/import-space.mjs', '--space', key, '--since', since]],
  },
};
const A = APPS[args.app];
if (!A) { console.error('사용법: node scripts/source-sync.mjs --app gira|gonfluence [--key KEY] [--since ISO]'); process.exit(1); }
configureDb({ url: A.db(), schemas: A.schemas.split(',') });

function runStep(script, argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...argv], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: A.db(), DB_SCHEMAS: A.schemas },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (e) => resolve({ code: -1, out: String(e.message) }));
  });
}

// 같은 앱의 동기화가 겹치지 않도록 DB 권고 잠금 (서버 여러 대·수동 실행 대비)
const LOCK = args.app === 'gira' ? 7301 : 7302;
const lockClient = await (await getDb()).connect(); // 세션 잠금이라 같은 연결에서 잡고 푼다
const { rows: lk } = await lockClient.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
if (!lk[0].ok) { console.log('다른 동기화가 진행 중 — 건너뜀'); lockClient.release(); await closeDb(); process.exit(0); }

try {
  const { rows: targets } = await query(A.targets);
  const list = args.key ? targets.filter((t) => t.key === args.key) : targets;
  console.log(`[source-sync] ${args.app}: 대상 ${list.map((t) => t.key).join(', ') || '없음'}`);
  for (const t of list) {
    const started = new Date();
    const { rows: st } = await query(
      `SELECT last_synced_at FROM source_sync_state WHERE kind = $1 AND key = $2`, [A.kind, t.key]);
    // 기준 시각: 지정값 > 마지막 성공 시각 > 로컬에 있는 원본 데이터의 최신 수정 시각 > 하루 전
    const base = st[0]?.last_synced_at ?? t.last_source ?? Date.now() - 864e5;
    const since = args.since ?? new Date(base).toISOString();
    let log = `기준 ${since}\n`;
    let ok = true;
    for (const [script, ...argv] of A.steps(t.key, since)) {
      const r = await runStep(script, argv);
      // 임포터 출력에서 요약·경고 줄만 남긴다
      log += `$ ${path.basename(script)} → 종료 ${r.code}\n`
        + r.out.split('\n').filter((l) => /완료|충돌|변경·신규|건 적재|오류|Error|실패/.test(l)).slice(-12).join('\n') + '\n';
      if (r.code !== 0) { ok = false; log += r.out.slice(-1500); break; }
    }
    await query(
      `INSERT INTO source_sync_state (kind, key, last_synced_at, last_run_at, last_status, last_log)
       VALUES ($1, $2, $3, now(), $4, $5)
       ON CONFLICT (kind, key) DO UPDATE SET
         last_synced_at = COALESCE($3, source_sync_state.last_synced_at),
         last_run_at = now(), last_status = $4, last_log = $5`,
      [A.kind, t.key, ok ? started : null, ok ? 'ok' : 'error', log.slice(0, 20000)]);
    console.log(`[source-sync] ${t.key}: ${ok ? '완료' : '실패'}`);
  }
} finally {
  await lockClient.query(`SELECT pg_advisory_unlock($1)`, [LOCK]).catch(() => {});
  lockClient.release();
  await closeDb();
}
