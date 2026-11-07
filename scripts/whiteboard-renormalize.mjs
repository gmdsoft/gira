#!/usr/bin/env node
// 이관된 화이트보드를 보관한 원본 바이너리(source_ybin)로 다시 변환한다 — 원본 API 호출 없음.
// 변환기(scripts/lib/confluence-whiteboard.mjs)를 고친 뒤 실행: node scripts/whiteboard-renormalize.mjs [--dry]
//
// --media: 이미 이관된 화이트보드의 이미지 원본·댓글을 원본에서 받아 보관한다 (GIRA-78, 원본에는 GET만).
//   node scripts/whiteboard-renormalize.mjs --media [--ids 123,456] [--dry]
import { query, closeDb } from '../server/src/db.mjs';
import { normalizeWhiteboard, fetchWhiteboardExtras } from './lib/confluence-whiteboard.mjs';
import { storeWhiteboardExtras } from './lib/whiteboard-extras.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const ids = argv.includes('--ids') ? argv[argv.indexOf('--ids') + 1].split(',').filter(Boolean) : null;
try {
  const { rows } = await query(`SELECT content_id, version, source_ybin FROM whiteboard_snapshots WHERE source_ybin IS NOT NULL
    AND ($1::bigint[] IS NULL OR content_id = ANY($1::bigint[]))`, [ids]);
  let ok = 0, failed = 0;
  for (const r of rows) {
    try {
      const data = normalizeWhiteboard(new Uint8Array(r.source_ybin));
      if (!dry) await query(`UPDATE whiteboard_snapshots SET data = $3 WHERE content_id = $1 AND version = $2`, [r.content_id, r.version, JSON.stringify(data)]);
      ok++;
    } catch (e) { failed++; console.log(`${r.content_id} v${r.version}: ${e.message}`); }
  }
  console.log(`${dry ? '(점검만) ' : ''}재변환 완료: 성공 ${ok}, 실패 ${failed}`);
  if (argv.includes('--media')) await backfillMedia(rows);
} finally { await closeDb(); }

async function backfillMedia(rows) {
  const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
  if (!SITE || !process.env.ATLASSIAN_API_TOKEN) throw new Error('ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 필요');
  const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
  const get = async (p) => { const r = await fetch(SITE + p, { headers: { Authorization: AUTH, Accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status} GET ${p.split('?')[0]}`); return r.json(); };
  // 원본 id 대역(로컬 생성 1e12 미만)만, 버전마다가 아니라 보드마다 최신 스냅샷 기준
  const latest = new Map();
  for (const r of rows) if (Number(r.content_id) < 1e12 && (!latest.has(r.content_id) || latest.get(r.content_id).version < r.version)) latest.set(r.content_id, r);
  const users = new Map();
  const uidOf = async (accountId) => {
    if (!accountId) return null;
    if (users.has(accountId)) return users.get(accountId);
    let { rows: [u] } = await query(`SELECT id FROM users WHERE confluence_account_id = $1`, [accountId]);
    if (!u && !dry) {
      const res = await get(`/wiki/rest/api/user/bulk?accountId=${encodeURIComponent(accountId)}`).catch(() => null);
      const info = res?.results?.[0];
      ({ rows: [u] } = await query(`INSERT INTO users (email, confluence_account_id, display_name) VALUES ($1,$2,$3)
        ON CONFLICT (confluence_account_id) DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name) RETURNING id`,
        [info?.email || null, accountId, info?.displayName ?? info?.publicName ?? '(알 수 없는 사용자)']));
    }
    users.set(accountId, u?.id ?? null);
    return u?.id ?? null;
  };
  let images = 0, comments = 0;
  for (const r of latest.values()) {
    try {
      const data = normalizeWhiteboard(new Uint8Array(r.source_ybin));
      const [session] = await get(`/wiki/rest/internal/1.0/canvas/session/bulk?ids=${r.content_id}`);
      const extras = await fetchWhiteboardExtras(String(r.content_id), data, { get, media: session?.data?.media });
      for (const loss of extras.losses) console.log(`  ⚠ ${r.content_id}: ${loss}`);
      if (dry) { console.log(`  ${r.content_id}: 이미지 ${extras.images.length}, 댓글 ${extras.comments.length} (점검만)`); continue; }
      const ids = new Map();
      for (const c of extras.comments) ids.set(c.authorId, await uidOf(c.authorId));
      const n = await storeWhiteboardExtras(query, r.content_id, extras, { uid: (a) => ids.get(a) ?? null });
      images += n.images; comments += n.comments;
      if (n.images || n.comments) console.log(`  ${r.content_id}: 이미지 ${n.images}, 댓글 ${n.comments}`);
    } catch (e) { console.log(`  ${r.content_id}: ${e.message}`); }
  }
  console.log(`${dry ? '(점검만) ' : ''}이미지·댓글 보관: 보드 ${latest.size}, 이미지 ${images}, 댓글 ${comments}`);
}
