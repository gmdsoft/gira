// 개인 API 키 (셀프 발급): 발급한 사용자의 권한으로 동작하는 Bearer 토큰.
// 키는 발급한 앱(DB) 전용이다 — Gira 키는 Gira에서, Gonfluence 키는 Gonfluence에서만 유효.
// 해시만 저장하고 평문은 발급 응답에서 1회만 보여준다. (auth.mjs가 검증)
import { randomBytes } from 'node:crypto';
import { query } from './db.mjs';
import { hashToken } from './auth.mjs';

export function registerMyApiKeys(app) {
  app.get('/api/me/apikeys', async (req) => {
    const { rows } = await query(
      `SELECT id, name, prefix, created_at, last_used_at, revoked_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.access.userId]);
    return rows;
  });

  app.post('/api/me/apikeys', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: '키 이름을 입력하세요' });
    const { rows: n } = await query(
      `SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`, [req.access.userId]);
    if (n[0].n >= 10) return reply.code(400).send({ error: '활성 키는 10개까지 만들 수 있습니다' });
    const token = 'gmd_' + randomBytes(24).toString('base64url');
    const { rows } = await query(
      `INSERT INTO api_keys (user_id, name, prefix, token_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.access.userId, name, token.slice(0, 12), hashToken(token)]);
    return { id: rows[0].id, token }; // 평문은 이 응답에서만
  });

  app.delete('/api/me/apikeys/:id', async (req, reply) => {
    const { rowCount } = await query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [req.params.id, req.access.userId]);
    if (!rowCount) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
