#!/usr/bin/env node
// 원본 Confluence 데이터베이스·화이트보드의 Yjs 스냅샷 받기 — GET만 사용한다 (GIRA-50·58 조사용).
// 공개 REST v2는 본문이 비어 있어 원본 화면과 같은 내부 경로를 쓴다 (명세 '원본 Confluence 호환성' 절).
//   1) GET /wiki/rest/api/content/<id>                       → type, referenceId
//   2) GET /wiki/rest/internal/1.0/canvas/session/bulk?ids=<id> → 접근 토큰(x-access-token), media 토큰
//   3) GET /gateway/api/canvas-tenant-context/site/<cloudId>/api/_internal/collab/<ari>?skipSteps=true&v=2
//      ari: 화이트보드 = referenceId, 데이터베이스 = ari:cloud:canvas:<cloudId>:database/<referenceId>
//
// 사용: node scripts/research/canvas-fetch.mjs <콘텐츠 id> [...] [--out analysis/raw/canvas]
// 출력: <out>/<type>-<id>.ybin (Yjs 업데이트 바이너리) + <type>-<id>.meta.json

import { mkdirSync, writeFileSync } from 'node:fs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수로 직접 */ }
const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = oi >= 0 ? args.splice(oi, 2)[1] : 'analysis/raw/canvas';
if (!args.length) { console.error('사용: node scripts/research/canvas-fetch.mjs <콘텐츠 id> [...] [--out 폴더]'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const getJson = async (path) => {
  const r = await fetch(SITE + path, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} GET ${path}`);
  return r.json();
};
// cloudId는 사이트 정보에서 (GET)
const cloudId = (await (await fetch(SITE + '/_edge/tenant_info')).json()).cloudId;

for (const id of args) {
  try {
    const c = await getJson(`/wiki/rest/api/content/${id}`);
    if (!['whiteboard', 'database'].includes(c.type)) throw new Error(`화이트보드·데이터베이스가 아님: ${c.type}`);
    const ari = c.type === 'whiteboard' ? c.referenceId : `ari:cloud:canvas:${cloudId}:database/${c.referenceId}`;
    const [sess] = await getJson(`/wiki/rest/internal/1.0/canvas/session/bulk?ids=${id}`);
    const r = await fetch(`${SITE}/gateway/api/canvas-tenant-context/site/${cloudId}/api/_internal/collab/${encodeURIComponent(ari)}?skipSteps=true&v=2`,
      { headers: { 'x-access-token': sess.data.access.token } });
    if (!r.ok) throw new Error(`collab ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(`${OUT}/${c.type}-${id}.ybin`, buf);
    writeFileSync(`${OUT}/${c.type}-${id}.meta.json`, JSON.stringify({ id, type: c.type, title: c.title, referenceId: c.referenceId,
      space: c._expandable?.space ?? c._expandable?.container, version: c.version?.number, etag: r.headers.get('etag'), fetchedAt: new Date().toISOString() }, null, 1));
    console.log(`${c.type} ${id} "${c.title}" ${buf.length} bytes`);
  } catch (e) {
    console.error(`${id}: ${e.message}`);
  }
}
