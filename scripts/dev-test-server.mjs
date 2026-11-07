#!/usr/bin/env node
// 개발참여 이슈 검토용 테스트 서버 (이슈 worktree에서 빌드·실행, 처리 에이전트 실행이 끝나도 계속 떠 있다)
//   node scripts/dev-test-server.mjs start GIRA-12 [--apps gira,gonfluence]   # 빌드 후 실행(이미 떠 있으면 재시작), 주소 출력
//   node scripts/dev-test-server.mjs stop GIRA-12
//   node scripts/dev-test-server.mjs list
// - worktree: <작업 폴더>/<KEY> (보통 ../gira-work/GIRA-12, 브랜치 feature/gira-12)
// - 앱: --apps 또는 이슈 레이블(Gira/Gonfluence), 없으면 둘 다. 포트: Gonfluence 4100~4199, Gira 4200~4299
// - 운영과 같은 DB·데이터 폴더를 쓴다(SOURCE_SYNC=0, NOTIFY=0, DEV_FLOW=0 — 동기화·알림 발송·자동 처리 끔)
// - 상태: <작업 폴더>/.dev-test-servers.json, 로그: <작업 폴더>/.dev-test-logs/<KEY>-<앱>.log
// 주소의 호스트는 DEV_TEST_HOST, 없으면 GIRA_PUBLIC_URL의 호스트.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 환경변수 직접 지정 가능 */ }
export const WORK = process.env.DEV_WORK_DIR
  ?? (path.basename(path.dirname(ROOT)) === 'gira-work' ? path.dirname(ROOT) : path.join(ROOT, '..', 'gira-work'));
const STATE = path.join(WORK, '.dev-test-servers.json');
const LOGS = path.join(WORK, '.dev-test-logs');
// 운영 데이터 폴더: DATA_DIR, 없으면 .env가 있는 저장소의 server/data
const ENV_REAL = (() => { try { return fs.realpathSync(path.join(ROOT, '.env')); } catch { return null; } })();
const DATA_DIR = process.env.DATA_DIR ?? (ENV_REAL ? path.join(path.dirname(ENV_REAL), 'server', 'data') : path.join(ROOT, 'server', 'data'));
const APPS = {
  gonfluence: { label: 'Gonfluence', entry: 'server/src/index.mjs', portEnv: 'PORT', base: 4100, build: 'build' },
  gira: { label: 'Gira', entry: 'server/src/jira-viewer.mjs', portEnv: 'JIRA_VIEWER_PORT', base: 4200, build: 'build:jira' },
};

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const host = () => process.env.DEV_TEST_HOST || (() => { try { return new URL(process.env.GIRA_PUBLIC_URL).hostname; } catch { return 'localhost'; } })();
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패 (${cwd}):\n${(r.stderr || r.stdout || '').slice(-1500)}`);
  return r.stdout;
};
const portFree = (port) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)));
  s.listen(port, '0.0.0.0');
});

async function pickPort(app, n, taken) {
  const { base } = APPS[app];
  for (let i = 0; i < 100; i++) {
    const port = base + ((n + i) % 100);
    if (!taken.has(port) && await portFree(port)) return port;
  }
  throw new Error(`${APPS[app].label} 테스트 서버 포트(${base}~${base + 99})가 모두 사용 중입니다`);
}

// worktree 준비: .env 연결, 의존성(develop과 같으면 공유, 다르면 설치)
function prepare(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Error(`worktree가 없습니다: ${dir}`);
  if (!fs.existsSync(path.join(dir, '.env')) && ENV_REAL) fs.symlinkSync(ENV_REAL, path.join(dir, '.env'));
  const lock = (d) => { try { return fs.readFileSync(path.join(d, 'package-lock.json'), 'utf8'); } catch { return null; } };
  const nm = path.join(dir, 'node_modules');
  const shared = (() => { try { return fs.realpathSync(path.join(ROOT, 'node_modules')); } catch { return null; } })();
  const same = lock(dir) && lock(dir) === lock(ROOT);
  const isLink = (() => { try { return fs.lstatSync(nm).isSymbolicLink(); } catch { return null; } })();
  if (same && shared && isLink == null) fs.symlinkSync(shared, nm);
  else if (!same && isLink !== false) { // 의존성이 바뀐 브랜치: 공유 폴더를 건드리지 않게 따로 설치
    if (isLink) fs.unlinkSync(nm);
    sh('npm', ['install', '--no-audit', '--no-fund'], dir);
  }
}

async function waitUp(port, ms = 40_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); if (r.status < 500) return true; } catch { /* 기동 중 */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

export function stop(key) {
  const st = readState(); const cur = st[key];
  if (!cur) return [];
  const stopped = [];
  for (const [app, s] of Object.entries(cur.apps ?? {})) {
    if (alive(s.pid)) { try { process.kill(-s.pid, 'SIGTERM'); } catch { try { process.kill(s.pid, 'SIGTERM'); } catch { /* 이미 종료 */ } } }
    stopped.push(`${APPS[app]?.label ?? app}:${s.port}`);
  }
  delete st[key]; writeState(st);
  return stopped;
}

export async function start(key, apps) {
  const dir = path.join(WORK, key);
  stop(key);
  prepare(dir);
  fs.mkdirSync(LOGS, { recursive: true });
  const n = Number(key.split('-')[1]) || 0;
  const st = readState();
  const taken = new Set(Object.values(st).flatMap((e) => Object.values(e.apps ?? {}).map((a) => a.port)));
  const entry = { branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim(), commit: sh('git', ['rev-parse', '--short', 'HEAD'], dir).trim(), started: new Date().toISOString(), apps: {} };
  for (const app of apps) {
    const a = APPS[app];
    sh('npm', ['--workspace', 'web', 'run', a.build], dir);
    const port = await pickPort(app, n, taken); taken.add(port);
    const log = fs.openSync(path.join(LOGS, `${key}-${app}.log`), 'a');
    const child = spawn(process.execPath, [a.entry], {
      cwd: dir, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, DATA_DIR, [a.portEnv]: String(port), SOURCE_SYNC: '0', NOTIFY: '0', DEV_FLOW: '0' },
    });
    child.unref();
    entry.apps[app] = { pid: child.pid, port, url: `http://${host()}:${port}` };
    st[key] = entry; writeState(st);
    if (!await waitUp(port)) {
      const tail = fs.readFileSync(path.join(LOGS, `${key}-${app}.log`), 'utf8').slice(-1500);
      stop(key);
      throw new Error(`${a.label} 테스트 서버가 뜨지 않았습니다 (포트 ${port}):\n${tail}`);
    }
  }
  return entry;
}

// 이슈 레이블로 앱 고르기 (Gira / Gonfluence), 없으면 둘 다
async function appsFor(key) {
  const { configureDb, query, closeDb } = await import('../server/src/db.mjs');
  configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: [] });
  try {
    const { rows } = await query(`SELECT labels FROM jira_issues WHERE issue_key = $1`, [key]);
    const labels = rows[0]?.labels ?? [];
    const picked = Object.keys(APPS).filter((k) => labels.includes(APPS[k].label));
    return picked.length ? picked : Object.keys(APPS);
  } finally { await closeDb(); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const { values: opt, positionals: [cmd, rawKey] } = parseArgs({ allowPositionals: true, options: { apps: { type: 'string' } } });
  const key = rawKey?.toUpperCase();
  try {
    if (cmd === 'start' && key) {
      const apps = opt.apps ? opt.apps.split(',').map((s) => s.trim().toLowerCase()).filter((s) => APPS[s]) : await appsFor(key);
      const e = await start(key, apps);
      for (const [app, s] of Object.entries(e.apps)) console.log(`${APPS[app].label} ${s.url}`);
      console.log(`(브랜치 ${e.branch} @ ${e.commit})`);
    } else if (cmd === 'stop' && key) {
      const s = stop(key); console.log(s.length ? `중단: ${s.join(', ')}` : '떠 있는 테스트 서버 없음');
    } else if (cmd === 'list') {
      const st = readState();
      if (!Object.keys(st).length) console.log('테스트 서버 없음');
      for (const [k, e] of Object.entries(st)) {
        console.log(`${k} ${e.branch}@${e.commit} ${Object.entries(e.apps).map(([a, s]) => `${APPS[a]?.label ?? a} ${s.url}${alive(s.pid) ? '' : ' (꺼짐)'}`).join(' · ')}`);
      }
    } else {
      console.log('사용: dev-test-server.mjs start|stop <KEY> [--apps gira,gonfluence] | list'); process.exitCode = 2;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
