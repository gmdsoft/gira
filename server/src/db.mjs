// DB 접근 계층. PostgreSQL 16 (로컬: docker/docker-compose.dev.yml, 운영: docker/docker-compose.gira.yml·gonfluence.yml).
// query(sql, params) → { rows }
//
// 앱마다 DB가 다르다 (알파부터 분리):
// - Gonfluence(index.mjs): DATABASE_URL + [schema-core.sql, schema.sql]  (기본값)
// - Gira(jira-viewer.mjs): GIRA_DATABASE_URL + [schema-core.sql, schema-jira.sql]
//   — 첫 query() 전에 configureDb()로 지정한다.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? path.join(here, '..', 'data');

try { process.loadEnvFile(path.join(here, '..', '..', '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

let config = {
  url: undefined,                               // 미지정 시 DATABASE_URL
  // 기동 시 순서대로 적용 (IF NOT EXISTS 멱등). DB_SCHEMAS 환경변수(콤마)로 재지정 가능
  // — 셀프 이관 등 스크립트를 자식 프로세스로 띄울 때 대상 DB에 맞는 스키마만 적용한다.
  schemas: process.env.DB_SCHEMAS
    ? process.env.DB_SCHEMAS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['schema-core.sql', 'schema.sql'],
};
let pool = null;
let migrated = null;

export function configureDb(opts) {
  if (pool) throw new Error('configureDb()는 첫 query() 전에 호출해야 합니다.');
  config = { ...config, ...opts };
}

export async function getDb() {
  if (!pool) {
    const url = config.url ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL 이 없습니다. docker compose -f docker/docker-compose.dev.yml up -d 후 .env 를 확인하세요.');
    }
    pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
    });
    // 유휴 커넥션의 네트워크 오류 등으로 프로세스가 죽지 않도록
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
  }
  if (!migrated) {
    migrated = (async () => {
      for (const file of config.schemas) {
        await pool.query(await readFile(path.join(here, file), 'utf8'));
      }
    })();
  }
  await migrated;
  return pool;
}

export async function query(sql, params) {
  return (await getDb()).query(sql, params);
}

// 조직 데이터(users/teams/groups/user_groups) 미러링: 조직 변경을 다른 앱 DB에도 반영한다.
// ORG_MIRROR_DATABASE_URL: 콤마로 여러 DB 지정 가능. 미설정 시 no-op.
// INSERT는 호출부에서 id를 명시해 모든 DB의 id가 일치하도록 한다. 실패는 로그만 남긴다(주 DB가 원본).
let mirrorPools = null;

export async function mirrorQuery(sql, params) {
  const urls = (process.env.ORG_MIRROR_DATABASE_URL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) return null;
  if (!mirrorPools) {
    mirrorPools = urls.map((url) => {
      const p = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000 });
      p.on('error', (err) => console.error('[db] mirror idle client error', err.message));
      return p;
    });
  }
  for (const p of mirrorPools) {
    try {
      await p.query(sql, params);
    } catch (err) {
      console.error('[db] org mirror failed:', err.message, '--', sql.slice(0, 80));
    }
  }
  return null;
}

export async function closeDb() {
  if (pool) await pool.end();
  for (const p of mirrorPools ?? []) await p.end();
}
