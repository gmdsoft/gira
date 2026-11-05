// DB 접근 계층. PostgreSQL 16 (로컬: docker-compose.dev.yml, 운영: docker-compose.prod.yml).
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
  schemas: ['schema-core.sql', 'schema.sql'],   // 기동 시 순서대로 적용 (IF NOT EXISTS 멱등)
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
      throw new Error('DATABASE_URL 이 없습니다. docker compose -f docker-compose.dev.yml up -d 후 .env 를 확인하세요.');
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

export async function closeDb() {
  if (pool) await pool.end();
}
