// 원본 Confluence 화면 보기 전용 탐색 (디버그 브라우저 CDP 9222, 로그인된 기본 컨텍스트) — 아무것도 누르지 않는다.
// 새 창으로 열어 iframe 앱(데이터베이스·화이트보드)까지 자동 연결해 스크린샷 + 프레임 텍스트 + UI가 부른 API 목록 + 관심 API 응답 일부를 저장.
// 사용: node scripts/research/confluence-view-probe.mjs <원본 URL> <출력 접두어> [대기ms=15000] [아래로 스크롤 횟수=0]
import { writeFileSync, mkdirSync } from 'node:fs';
const [,, url, out, waitMs = '15000', scrollSteps = '0'] = process.argv;
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const reqs = []; const sessions = new Map(); const bodies = [];
const INTEREST = /\/(whiteboards|databases|embeds?)\/.*api|\/gateway\/api\/(?!emoji|elements|gasv3|telemetry|post-office|session|me$|impersonation|assist|blocks)|\/wiki\/rest\/api|\/wiki\/api\/v2|graphql/;
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Target.attachedToTarget') {
    const sid = m.params.sessionId; sessions.set(sid, m.params.targetInfo);
    send('Network.enable', {}, sid); send('Runtime.runIfWaitingForDebugger', {}, sid);
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
  }
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request; const u = r.url;
    if (/atlassian\.net|atlassian\.com|atl-paas/.test(u) && !/\.(js|css|png|svg|woff2?|ico|gif|br|wasm|ttf)(\?|$)/.test(u) && !/emoji|rgstr|telemetry|categories_v2/.test(u)) {
      let op = '';
      if (r.postData && /graphql/.test(u)) { try { const b = JSON.parse(r.postData); op = (Array.isArray(b) ? b : [b]).map((x) => x.operationName).join(','); } catch {} }
      reqs.push({ rid: m.params.requestId, sid: m.sessionId, line: `${r.method} ${u.replace(/^https:\/\/[^/]+/, '').slice(0, 200)} ${op}`, u, op });
    }
  }
  if (m.method === 'Network.loadingFinished') {
    const q = reqs.find((x) => x.rid === m.params.requestId && x.sid === m.sessionId);
    if (q && INTEREST.test(q.u) && !/MainLayout|Forge|Shortcut|Onboarding|Paywall|Notification|QuickFind|searchCombined|Knowledge|Mentions|WebItem|WebPanel|Classification|Presence|CopyContentLink|ShareAndRestrict|AccessLink|Loom|AdminKey|CompanyHub|preloadCreateSpace|LocalStorage|RoleMode|SuperBatch|Archived|Watch|ContentViewed|Paywall/.test(q.line)) {
      const b = await send('Network.getResponseBody', { requestId: q.rid }, q.sid);
      const body = b.result?.body;
      if (body && /collab|\/steps\//.test(q.u)) { mkdirSync(out + '.bin', { recursive: true }); writeFileSync(`${out}.bin/${bodies.length}-${q.u.includes('/steps/') ? 'steps' : 'collab'}`, b.result.base64Encoded ? Buffer.from(body, 'base64') : body); }
      if (body) bodies.push(`### ${q.line}\n${(b.result.base64Encoded ? '(base64 ' + body.length + ')' : body).slice(0, 6000)}\n`);
    }
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
try {
  const { result: { sessionId: S } } = await send('Target.attachToTarget', { targetId, flatten: true });
  sessions.set(S, { type: 'page' });
  await send('Network.enable', {}, S);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, S);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, S);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, S);
  await send('Page.navigate', { url }, S); await sleep(Number(waitMs));
  const ev = async (expression, sid = S) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sid); return r.result?.result?.value; };
  const s = await send('Page.captureScreenshot', { format: 'png' }, S);
  writeFileSync(out + '.png', Buffer.from(s.result.data, 'base64'));
  let text = `URL ${await ev('location.href')}\n--- FRAMES\n`;
  const ft = await send('Page.getFrameTree', {}, S);
  const walk = (n, d = 0) => { text += '  '.repeat(d) + (n.frame.url || '').slice(0, 160) + '\n'; for (const c of n.childFrames ?? []) walk(c, d + 1); };
  walk(ft.result.frameTree);
  for (const [sid, info] of sessions) {
    if (info.type !== 'iframe') continue;
    text += `--- IFRAME ${info.url?.slice(0, 120)}\n${(await ev('document.body?.innerText?.slice(0,4000)', sid)) ?? ''}\n`;
  }
  text += `--- MAIN TEXT\n${(await ev(`(document.querySelector('main, [data-testid=grid-main-container]')||document.body).innerText.slice(0,4000)`)) ?? ''}\n`;
  for (let i = 1; i <= Number(scrollSteps); i++) {
    await ev(`(document.querySelector('[data-testid=grid-main-container]')||document.scrollingElement).scrollBy(0,900)`); await sleep(2500);
    const s2 = await send('Page.captureScreenshot', { format: 'png' }, S); writeFileSync(`${out}-s${i}.png`, Buffer.from(s2.result.data, 'base64'));
  }
  text += `--- REQUESTS\n${[...new Set(reqs.map((r) => r.line))].join('\n')}\n`;
  writeFileSync(out + '.txt', text);
  writeFileSync(out + '.bodies.txt', bodies.join('\n'));
  console.log('ok', out, 'iframes', [...sessions.values()].filter((x) => x.type === 'iframe').length, 'bodies', bodies.length);
} finally { await send('Target.closeTarget', { targetId }); ws.close(); }
