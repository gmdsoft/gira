// 원본 동기화 스케줄러: 매일 SOURCE_SYNC_AT(한국 시각, 기본 03:00)에 scripts/source-sync.mjs 를 자식 프로세스로 실행한다.
// Gira 서버는 --app gira(Jira 프로젝트), Gonfluence 서버는 --app gonfluence(Confluence 스페이스).
// 방향은 원본(Jira/Confluence) → Gira/Gonfluence 단방향: 원본은 GET으로 읽기만 하고, 로컬 변경을 원본에 쓰지 않는다.
// SOURCE_SYNC=0 이면 자동 실행 끔(수동 실행 API는 유지).
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

// 다음 'HH:MM'(한국 시각, UTC+9 고정 — 서머타임 없음) 시점. 서버/컨테이너의 TZ와 무관하게 동작한다.
function nextKstTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const KST = 9 * 3600e3;
  const nowK = new Date(Date.now() + KST);
  let t = Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth(), nowK.getUTCDate(), h, m) - KST;
  if (t <= Date.now() + 1000) t += 86400e3;
  return new Date(t);
}

export function registerSourceSync(app, { appName }) {
  const kind = appName === 'gira' ? 'jira-project' : 'conf-space';
  const at = process.env.SOURCE_SYNC_AT ?? '03:00';
  const enabled = process.env.SOURCE_SYNC !== '0';
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

  if (enabled) {
    const schedule = () => {
      nextAt = nextKstTime(at);
      setTimeout(() => { run('정기'); schedule(); }, nextAt - Date.now()).unref();
    };
    schedule();
    console.log(`[source-sync] ${appName}: 매일 ${at}(KST) 원본 → 로컬 단방향 동기화, 다음 ${nextAt.toISOString()}`);
  }

  // 상태 조회 (관리자)
  app.get('/api/source-sync', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { rows } = await query(
      `SELECT key, last_synced_at, last_run_at, last_status, last_log
         FROM source_sync_state WHERE kind = $1 ORDER BY key`, [kind]);
    return {
      enabled, dailyAt: `${at} KST`, nextAt, running: !!running, targets: rows,
    };
  });

  // 즉시 실행 (관리자)
  app.post('/api/source-sync/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { started: run('수동'), running: true };
  });
}
