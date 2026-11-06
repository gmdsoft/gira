import { deflateRawSync } from 'node:zlib';

// PlantUML 서버의 URL-safe 압축 형식. 목적지는 관리자 설정 한 곳으로 고정한다.
export function plantumlPath(source) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  const bytes = deflateRawSync(Buffer.from(source));
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)]
      + alphabet[((b & 15) << 2) | (c >> 6)] + alphabet[c & 63];
  }
  return result;
}

export function registerPlantuml(app) {
  app.get('/api/plantuml/svg', async (req, reply) => {
    const base = process.env.PLANTUML_URL;
    if (!base) return reply.code(503).send({ error: 'PlantUML 렌더 서버가 설정되지 않았습니다.' });
    const source = req.query.src;
    if (typeof source !== 'string' || !source || Buffer.byteLength(source) > 32000) return reply.code(400).send({ error: '잘못된 PlantUML 코드' });
    try {
      const url = new URL(`${base.replace(/\/$/, '')}/svg/${plantumlPath(source)}`);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('image/svg+xml')) throw new Error('render');
      return reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .header('Cache-Control', 'no-store').type('image/svg+xml').send(await response.text());
    } catch {
      return reply.code(502).send({ error: 'PlantUML 그림을 불러올 수 없습니다.' });
    }
  });
}
