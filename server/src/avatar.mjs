// 아바타 표시 우선순위의 단일 정의 (GIRA-20).
//   ① 사용자가 직접 등록한 이미지(users.avatar_key + user_avatars)
//   ② 외부 계정 사진(Entra — users.avatar_external_url, 알파 5단계 연동 시 채움)
//   ③ 기본 표시(이니셜) — URL 없음(null)
// URL 해석은 Gira·Gonfluence가 같이 쓰고, 이미지 바이트는 각 앱 DB의 복제본에서 제공한다.
import { query } from './db.mjs';

// 프로필 이미지 업로드 제한 (앱 프록시와 관리 서비스가 공유)
export const AVATAR_MAX_BYTES = 512 * 1024;

export function resolveAvatar(user) {
  if (!user) return null;
  if (user.avatar_key) return `/api/avatar/${user.id}?v=${encodeURIComponent(user.avatar_key)}`;
  return user.avatar_external_url || null;
}

// /api/auth/me 응답에 싣는 아바타 필드
export function withAvatar(user) {
  return { ...user, avatar_url: resolveAvatar(user) };
}

// 이미지 헤더에서 형식·크기를 읽는다 (지원: PNG, JPEG). 잘못된 파일이면 null.
export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// 아바타 조회·목록 + 개인 설정 업로드 프록시 (Gira/Gonfluence 앱이 등록).
// 업로드 자체는 조직 테이블의 유일한 작성자인 관리 서비스(/api/me/avatar)가 처리한다.
export function registerAvatarRoutes(app) {
  // 이름 → 아바타 URL (Avatar 컴포넌트가 한 번만 읽는다)
  app.get('/api/avatars', async () => {
    const { rows } = await query(
      `SELECT id, display_name, avatar_key, avatar_external_url
         FROM users WHERE active AND display_name IS NOT NULL
        ORDER BY display_name`);
    return rows.map((u) => ({ id: u.id, name: u.display_name, avatar_url: resolveAvatar(u) }));
  });

  app.get('/api/avatar/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid user id' });
    const { rows } = await query(
      `SELECT u.avatar_key, a.mime, a.bytes
         FROM users u JOIN user_avatars a ON a.user_id = u.id
        WHERE u.id = $1 AND u.active`, [id]);
    const row = rows[0];
    if (!row || !row.bytes) return reply.code(404).send({ error: 'no avatar' });
    reply.header('cache-control', 'private, max-age=300');
    if (row.avatar_key) reply.header('etag', `"${row.avatar_key}"`);
    reply.type(row.mime || 'application/octet-stream');
    return reply.send(row.bytes);
  });

  // 관리 서비스 URL — 같은 스택이면 compose 의 admin:3003, 두 스택을 함께 쓰면 활성 관리 주소 지정
  const adminBase = () => (process.env.ORG_ADMIN_URL ?? 'http://127.0.0.1:3003').replace(/\/$/, '');

  async function forward(req, reply, init) {
    let res;
    try {
      res = await fetch(`${adminBase()}/api/me/avatar`, {
        ...init,
        headers: { cookie: req.headers.cookie ?? '' },
      });
    } catch {
      return reply.code(502).send({ error: '관리 서비스에 연결할 수 없습니다' });
    }
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  }

  app.post('/api/me/avatar', async (req, reply) => {
    const part = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => null);
    if (!part) return reply.code(400).send({ error: '이미지 파일을 선택하세요' });
    const buf = await part.toBuffer().catch(() => null);
    if (!buf?.length) return reply.code(400).send({ error: `이미지는 ${AVATAR_MAX_BYTES / 1024}KB 이하여야 합니다` });
    const body = new FormData();
    body.append('file', new Blob([buf], { type: part.mimetype || 'application/octet-stream' }),
      part.filename || 'avatar');
    return forward(req, reply, { method: 'POST', body });
  });

  app.delete('/api/me/avatar', (req, reply) => forward(req, reply, { method: 'DELETE' }));
}
