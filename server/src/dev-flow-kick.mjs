// 개발참여 자동 처리 깨우기: GIRA 이슈에 등록·댓글·상태 변경이 생기면 감시기(scripts/dev-watch.sh)를 바로 실행한다.
// DEV_FLOW=1인 서버(운영 Gira)에서만 동작한다 — 테스트 서버는 DEV_FLOW=0으로 띄운다.
// 짧게 몰려 오는 이벤트(등록 + 첨부 + 담당 지정)는 몇 초 모아 한 번만 실행하고, 겹침은 dev-watch.sh의 잠금이 막는다.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'dev-watch.sh');
let timer = null;

export function kickDevFlow({ env = process.env, delayMs = 5000, run = defaultRun } = {}) {
  if (env.DEV_FLOW !== '1') return false;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; run(); }, delayMs);
  timer.unref?.();
  return true;
}

function defaultRun() {
  try {
    const child = spawn('bash', [SCRIPT], { detached: true, stdio: 'ignore', cwd: path.dirname(path.dirname(SCRIPT)) });
    child.on('error', (e) => console.error('[dev-flow] 감시기 실행 실패:', e.message));
    child.unref();
  } catch (e) { console.error('[dev-flow] 감시기 실행 실패:', e.message); }
}
