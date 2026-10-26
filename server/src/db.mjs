// DB 접근 계층. PostgreSQL 16 (로컬: docker-compose.dev.yml, 운영: compose의 postgres).
// query(sql, params) → { rows }

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? path.join(here, '..', 'data');

try { process.loadEnvFile(path.join(here, '..', '..', '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL 이 없습니다. docker compose -f docker-compose.dev.yml up -d 후 .env 를 확인하세요.');
}

let pool = null;
let migrated = null;

export async function getDb() {
  if (!pool) pool = new pg.Pool({ connectionString: url });
  if (!migrated) migrated = pool.query(await readFile(path.join(here, 'schema.sql'), 'utf8'));
  await migrated;
  return pool;
}

export async function query(sql, params) {
  return (await getDb()).query(sql, params);
}

export async function closeDb() {
  if (pool) await pool.end();
}
