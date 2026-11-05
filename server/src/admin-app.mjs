// 관리 서비스: 조직(사용자·팀·파트·그룹·직책·생성 권한·API 키)의 단일 관리 지점.
// 배포 조합 어디서든 함께 설치된다: Gira+Gonfluence+관리 / Gira+관리 / Gonfluence+관리.
//
// DB 모델: 자체 DB 없이, 설치된 앱 DB의 조직 테이블(schema-core)을 관리한다.
// - ORG_DATABASE_URL: 주 조직 DB (조회·기록, 기본값 DATABASE_URL)
// - ORG_MIRROR_DATABASE_URL: 함께 설치된 다른 앱 DB들(콤마 구분) — 변경이 복제된다
// 실행: node server/src/admin-app.mjs  (기본 0.0.0.0:3003)
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, configureDb, closeDb } from './db.mjs';
import { registerAuth } from './auth.mjs';
import { registerOrgAdmin } from './admin-routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '..', '..', '.env')); } catch { /* 환경변수 직접 지정 가능 */ }

configureDb({
  url: process.env.ORG_DATABASE_URL ?? process.env.DATABASE_URL,
  schemas: ['schema-core.sql'], // 조직 테이블만 (앱 테이블은 각 앱이 관리)
});

const app = Fastify({ logger: { level: 'warn' } });

await registerAuth(app); // /api/* 로그인 필수 (auth 라우트 제외)
registerOrgAdmin(app);   // /api/admin/* (사이트 관리자)

// 관리 SPA (web/dist-admin — npm --workspace web run build:admin)
const DIST = path.join(here, '..', '..', 'web', 'dist-admin');
if (await stat(DIST).catch(() => null)) {
  await app.register(fastifyStatic, { root: DIST, index: false });
  const page = (req, reply) => reply.type('text/html')
    .header('cache-control', 'no-cache')
    .send(createReadStream(path.join(DIST, 'admin.html')));
  app.get('/', page);
}

app.get('/healthz', async () => {
  await query('SELECT 1');
  return { ok: true, app: 'admin' };
});

const port = Number(process.env.ADMIN_PORT ?? 3003);
await app.listen({ port, host: '0.0.0.0' });
console.log(`관리 서비스: http://0.0.0.0:${port}`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    try { await app.close(); await closeDb(); } finally { process.exit(0); }
  });
}
