export function registerGiraCards(app, { giraUrl = process.env.GIRA_URL ?? 'http://localhost:3002' } = {}) {
  // 이슈 카드: Gira HTTP API만 사용하며, 서비스 계정 권한으로 열람을 우회하지 않는다.
  const giraBaseUrl = () => giraUrl.replace(/\/$/, '');
  const validIssueKey = (key) => /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key);

  app.get('/api/gira/issues/:key/open', async (req, reply) => {
    if (!validIssueKey(req.params.key)) return reply.code(400).send({ error: '잘못된 이슈 키' });
    return reply.redirect(`${giraBaseUrl()}/browse/${encodeURIComponent(req.params.key)}`);
  });

  app.get('/api/gira/issues/:key', async (req, reply) => {
    const { key } = req.params;
    reply.header('Cache-Control', 'private, no-store');
    if (!validIssueKey(key)) return reply.code(400).send({ error: '잘못된 이슈 키' });
    // 공용 로그인 쿠키/API 키를 Gira가 직접 검증하고 프로젝트 열람 권한을 판단한다.
    const headers = {};
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.cookies?.gmd_sid) headers.cookie = `gmd_sid=${encodeURIComponent(req.cookies.gmd_sid)}`;
    try {
      const res = await fetch(`${giraBaseUrl()}/api/issue/${encodeURIComponent(key)}`, {
        headers, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { key };
      const issue = await res.json();
      return { key, summary: issue.summary, status: issue.status_name };
    } catch {
      return { key };
    }
  });
}
