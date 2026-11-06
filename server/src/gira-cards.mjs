export function registerGiraCards(app, { giraUrl = process.env.GIRA_URL ?? 'http://localhost:3002' } = {}) {
  // 이슈 카드: Gira HTTP API만 사용하며, 서비스 계정 권한으로 열람을 우회하지 않는다.
  const giraBaseUrl = () => giraUrl.replace(/\/$/, '');
  const validIssueKey = (key) => /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key);
  // 공용 로그인 쿠키/API 키를 Gira가 직접 검증하고 프로젝트 열람 권한을 판단한다.
  const authHeaders = (req) => {
    const headers = {};
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.cookies?.gmd_sid) headers.cookie = `gmd_sid=${encodeURIComponent(req.cookies.gmd_sid)}`;
    return headers;
  };

  // 브라우저가 이동할 Gira 주소: 서버 내부 주소(GIRA_URL)가 아니라 사용자가 접속한 호스트의 Gira 포트
  const giraPublicUrl = (req) => (process.env.GIRA_PUBLIC_URL
    ?? `${req.protocol}://${String(req.hostname ?? 'localhost').replace(/:\d+$/, '')}:${process.env.GIRA_PUBLIC_PORT ?? '3002'}`).replace(/\/$/, '');
  // 이관되지 않은 프로젝트의 이슈는 Gira에 없으므로 원본 Jira로 보낸다 (예전 링크 동작 유지)
  const JIRA_ORIGIN = (process.env.JIRA_BASE_URL ?? 'https://gmdsoft.atlassian.net').replace(/\/$/, '');

  app.get('/api/gira/issues/:key/open', async (req, reply) => {
    const { key } = req.params;
    if (!validIssueKey(key)) return reply.code(400).send({ error: '잘못된 이슈 키' });
    let inGira = false;
    try {
      const res = await fetch(`${giraBaseUrl()}/api/issue/${encodeURIComponent(key)}`, {
        headers: authHeaders(req), redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      // 404만 '이관 안 됨'으로 본다 — 권한 없음(403)은 Gira로 보내 접근 요청 화면을 보여 준다
      inGira = res.status !== 404;
    } catch { inGira = true; }
    return reply.redirect(inGira
      ? `${giraPublicUrl(req)}/browse/${encodeURIComponent(key)}`
      : `${JIRA_ORIGIN}/browse/${encodeURIComponent(key)}`);
  });

  app.get('/api/gira/issues/:key', async (req, reply) => {
    const { key } = req.params;
    reply.header('Cache-Control', 'private, no-store');
    if (!validIssueKey(key)) return reply.code(400).send({ error: '잘못된 이슈 키' });
    try {
      const res = await fetch(`${giraBaseUrl()}/api/issue/${encodeURIComponent(key)}`, {
        headers: authHeaders(req), redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { key };
      const issue = await res.json();
      return { key, summary: issue.summary, status: issue.status_name, statusCategory: issue.status_category, type: issue.type_name };
    } catch {
      return { key };
    }
  });
}
