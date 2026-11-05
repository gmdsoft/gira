// 로그인 세션 (개발용 — Entra ID OIDC 도입 전).
// 사용자 목록에서 선택해 로그인하면 서명된 쿠키로 세션을 유지한다.
// Entra 연동 시 이 모듈의 login 라우트만 OIDC 콜백으로 교체하면 된다 (users 테이블은 동일).
import fastifyCookie from '@fastify/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query, DATA_DIR } from './db.mjs';
import { getAccess } from './perm.mjs';

const COOKIE = 'gmd_sid';
// 개발 로그인 화면에 노출할 테스트 계정 (이관된 실제 사용자는 목록에서 숨긴다)
const TEST_ACCOUNT_ID = 'test-login';

export const hashToken = (token) => createHash('sha256').update(token).digest();

// Bearer 토큰 → 사용자 ID (유효하지 않으면 null). 사용 시각을 기록한다.
async function apiKeyUser(token) {
  if (!token.startsWith('gmd_')) return null;
  const { rows } = await query(
    `UPDATE api_keys SET last_used_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id`, [hashToken(token)]);
  return rows.length ? Number(rows[0].user_id) : null;
}

async function cookieSecret() {
  if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;
  const file = path.join(DATA_DIR, '.cookie-secret');
  try { return (await readFile(file, 'utf8')).trim(); } catch { /* 최초 실행 */ }
  const secret = randomBytes(32).toString('hex');
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, secret, { mode: 0o600 });
  return secret;
}

export async function registerAuth(app) {
  await app.register(fastifyCookie, { secret: await cookieSecret() });

  // 최초 관리자: 관리자가 한 명도 없으면 ADMIN_EMAIL(.env, 기본 pottery@gmdsoft.com)을 승격
  const adminEmail = process.env.ADMIN_EMAIL ?? 'pottery@gmdsoft.com';
  await query(
    `UPDATE users SET is_admin = true
      WHERE email = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`, [adminEmail]);

  // 테스트 계정 시드: 로그인 화면에는 이 계정 하나만 보인다 (Entra 전환 시 제거)
  await query(
    `INSERT INTO users (confluence_account_id, display_name, active, is_admin)
     VALUES ($1, '테스트', true, true)
     ON CONFLICT (confluence_account_id) DO NOTHING`, [TEST_ACCOUNT_ID]);

  // /api/* 는 로그인 필수 (auth 라우트 제외). req.access에 권한 컨텍스트를 싣는다.
  // 인증 수단: ① 서명 쿠키(웹) ② Authorization: Bearer API 키(외부 연동)
  app.addHook('preHandler', async (req, reply) => {
    const url = req.raw.url ?? '';
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/auth/')) return;
    let userId = null;
    const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (bearer) {
      userId = await apiKeyUser(bearer);
      if (!userId) return reply.code(401).send({ error: 'invalid api key' });
    } else {
      const signed = req.cookies?.[COOKIE];
      const unsigned = signed ? req.unsignCookie(signed) : { valid: false };
      if (unsigned.valid) userId = Number(unsigned.value);
    }
    const access = userId ? await getAccess(userId) : null;
    if (!access) return reply.code(401).send({ error: 'login required' });
    req.access = access;
  });

  // 로그인 화면용 사용자 목록 (로그인 전 접근 — 개발용. Entra 전환 시 제거)
  // 이관된 실제 사용자는 노출하지 않고 테스트 계정만 내려준다.
  app.get('/api/auth/users', async () => {
    const { rows } = await query(
      `SELECT id, display_name, email FROM users
        WHERE active AND confluence_account_id = $1
        ORDER BY display_name`, [TEST_ACCOUNT_ID]);
    return rows;
  });

  app.post('/api/auth/login', async (req, reply) => {
    const userId = Number(req.body?.userId);
    if (!userId) return reply.code(400).send({ error: 'userId required' });
    const access = await getAccess(userId);
    if (!access) return reply.code(404).send({ error: 'user not found or inactive' });
    reply.setCookie(COOKIE, String(userId), {
      signed: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (bearer) {
      const userId = await apiKeyUser(bearer);
      if (!userId) return reply.code(401).send({ error: 'invalid api key' });
      const { rows } = await query(
        `SELECT id, display_name, email, is_admin FROM users WHERE id = $1 AND active`, [userId]);
      if (!rows.length) return reply.code(401).send({ error: 'not logged in' });
      const access = await getAccess(userId);
      return { ...rows[0], can_create: !!access?.canCreate };
    }
    const signed = req.cookies?.[COOKIE];
    const unsigned = signed ? req.unsignCookie(signed) : { valid: false };
    if (!unsigned.valid) return reply.code(401).send({ error: 'not logged in' });
    const { rows } = await query(
      `SELECT id, display_name, email, is_admin FROM users WHERE id = $1 AND active`, [Number(unsigned.value)]);
    if (!rows.length) return reply.code(401).send({ error: 'not logged in' });
    const access = await getAccess(Number(unsigned.value));
    return { ...rows[0], can_create: !!access?.canCreate };
  });
}
