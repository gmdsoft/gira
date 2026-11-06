// 개인 프로필 이미지 (GIRA-20) — 조직 테이블(users/user_avatars)의 유일한 작성자.
// 관리 서비스(admin-app.mjs)가 등록하고, 변경은 ORG_MIRROR_DATABASE_URL 로 각 앱 DB에 복제된다.
// 앱은 /api/me/avatar 로 이 라우트에 프록시한다 (server/src/avatar.mjs).
import { randomBytes } from 'node:crypto';
import { query, mirrorQuery } from './db.mjs';
import { imageInfo, withAvatar, AVATAR_MAX_BYTES } from './avatar.mjs';

const MIN_SIZE = 16;
const MAX_SIZE = 1024;

const UPSERT = `INSERT INTO user_avatars (user_id, mime, bytes, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
       SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, updated_at = now()`;
const SET_KEY = `UPDATE users SET avatar_key = $2 WHERE id = $1
  RETURNING id, display_name, avatar_key, avatar_external_url`;
const DELETE_BYTES = `DELETE FROM user_avatars WHERE user_id = $1`;
const CLEAR_KEY = `UPDATE users SET avatar_key = NULL WHERE id = $1
  RETURNING id, display_name, avatar_key, avatar_external_url`;
const UPLOAD = `WITH a AS (${UPSERT})
  UPDATE users SET avatar_key = $4 WHERE id = $1
  RETURNING id, display_name, avatar_key, avatar_external_url`;

export function registerAvatarAdmin(app) {
  app.post('/api/me/avatar', async (req, reply) => {
    const part = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => null);
    if (!part) return reply.code(400).send({ error: '이미지 파일을 선택하세요' });
    const buf = await part.toBuffer().catch(() => null);
    if (!buf?.length) return reply.code(400).send({ error: `이미지는 ${AVATAR_MAX_BYTES / 1024}KB 이하여야 합니다` });

    const info = imageInfo(buf);
    if (!info) return reply.code(400).send({ error: 'PNG 또는 JPEG 이미지만 등록할 수 있습니다' });
    if (info.width !== info.height) {
      return reply.code(400).send({ error: '정사각형 이미지로 잘라서 올려야 합니다' });
    }
    if (info.width < MIN_SIZE || info.width > MAX_SIZE) {
      return reply.code(400).send({ error: `이미지 크기는 ${MIN_SIZE}~${MAX_SIZE}px 정사각형이어야 합니다` });
    }

    const key = randomBytes(8).toString('hex');
    const { rows } = await query(UPLOAD, [req.access.userId, info.mime, buf, key]);
    if (!rows.length) return reply.code(404).send({ error: 'user not found' });
    // 복제가 끝난 뒤 응답해야 앱 DB의 /api/avatar 조회가 바로 새 이미지를 본다.
    await mirrorQuery(UPSERT, [req.access.userId, info.mime, buf]);
    await mirrorQuery(SET_KEY, [req.access.userId, key]);
    return withAvatar(rows[0]);
  });

  app.delete('/api/me/avatar', async (req, reply) => {
    await query(DELETE_BYTES, [req.access.userId]);
    const { rows } = await query(CLEAR_KEY, [req.access.userId]);
    if (!rows.length) return reply.code(404).send({ error: 'user not found' });
    await mirrorQuery(DELETE_BYTES, [req.access.userId]);
    await mirrorQuery(CLEAR_KEY, [req.access.userId]);
    return withAvatar(rows[0]);
  });
}
