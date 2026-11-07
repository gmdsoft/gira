#!/usr/bin/env node
// 이관된 화이트보드를 보관한 원본 바이너리(source_ybin)로 다시 변환한다 — 원본 API 호출 없음.
// 변환기(scripts/lib/confluence-whiteboard.mjs)를 고친 뒤 실행: node scripts/whiteboard-renormalize.mjs [--dry]
import { query, closeDb } from '../server/src/db.mjs';
import { normalizeWhiteboard } from './lib/confluence-whiteboard.mjs';

try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
const dry = process.argv.includes('--dry');
try {
  const { rows } = await query(`SELECT content_id, version, source_ybin FROM whiteboard_snapshots WHERE source_ybin IS NOT NULL`);
  let ok = 0, failed = 0;
  for (const r of rows) {
    try {
      const data = normalizeWhiteboard(new Uint8Array(r.source_ybin));
      if (!dry) await query(`UPDATE whiteboard_snapshots SET data = $3 WHERE content_id = $1 AND version = $2`, [r.content_id, r.version, JSON.stringify(data)]);
      ok++;
    } catch (e) { failed++; console.log(`${r.content_id} v${r.version}: ${e.message}`); }
  }
  console.log(`${dry ? '(점검만) ' : ''}완료: 성공 ${ok}, 실패 ${failed}`);
} finally { await closeDb(); }
