// 원본 동기화 스케줄러: SOURCE_SYNC_HOURS(기본 3)마다 scripts/source-sync.mjs 를 자식 프로세스로 실행한다.
// Gira 서버는 --app gira(Jira 프로젝트), Gonfluence 서버는 --app gonfluence(Confluence 스페이스).
// SOURCE_SYNC=0 이면 자동 실행 끔(수동 실행 API는 유지). 원본 호출은 임포터가 GET으로만 한다.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'source-sync.mjs');

function requireAdmin(req, reply) {
  if (req.access?.isAdmin) return true;
  reply.code(403).send({ error: '사이트 관리자만 사용할 수 있습니다' });
  return false;
}

export function registerSourceSync(app, { appName }) {
  const kind = appName === 'gira' ? 'jira-project' : 'conf-space';
  const hours = Number(process.env.SOURCE_SYNC_HOURS ?? 3);
  const delayMin = Number(process.env.SOURCE_SYNC_DELAY_MIN ?? 10);
  let running = null;   // 진행 중인 자식 프로세스
  let nextAt = null;

  function run(reason) {
    if (running) return false;
    console.log(`[source-sync] ${appName} 시작 (${reason})`);
    const child = spawn(process.execPath, [SCRIPT, '--app', appName], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    running = child;
    let tail = '';
    const keep = (d) => { tail = (tail + d).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('close', (code) => {
      running = null;
      console.log(`[source-sync] ${appName} 종료 ${code}` + (code ? `\n${tail}` : ''));
    });
    child.on('error', (e) => { running = null; console.error('[source-sync] 실행 실패', e.message); });
    return true;
  }

  if (process.env.SOURCE_SYNC !== '0' && hours > 0) {
    const schedule = (ms) => {
      nextAt = new Date(Date.now() + ms);
      setTimeout(() => { run('정기'); schedule(hours * 3600e3); }, ms).unref();
    };
    schedule(delayMin * 60e3);
  }

  // 상태 조회 (관리자)
  app.get('/api/source-sync', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { rows } = await query(
      `SELECT key, last_synced_at, last_run_at, last_status, last_log
         FROM source_sync_state WHERE kind = $1 ORDER BY key`, [kind]);
    return {
      enabled: process.env.SOURCE_SYNC !== '0' && hours > 0,
      intervalHours: hours, nextAt, running: !!running, targets: rows,
    };
  });

  // 즉시 실행 (관리자)
  app.post('/api/source-sync/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { started: run('수동'), running: true };
  });
}
