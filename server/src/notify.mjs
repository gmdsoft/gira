// 알림 (GIRA-14): 이벤트 → 규칙 매칭(프로젝트/스페이스별, 리소스 관리자 설정) → 발송 큐(재시도) + 인앱 알림.
// Gira·Gonfluence가 같은 모듈을 각자의 DB로 쓴다(테이블은 schema-core.sql).
// 채널: Teams(채널 웹훅) · 메일(Microsoft Graph sendMail, 앱 토큰) — .env 값이 없으면 그 채널은 꺼진 채로 동작한다.
// 알림에는 제목·링크만 담는다(본문 미포함 — 권한 밖 노출 방지).
//   TEAMS_WEBHOOK_URL                         기본 Teams 채널 웹훅 (규칙에 URL을 따로 넣지 않으면 이것)
//   메일(Graph 앱 토큰): TEAMS_TENANT_ID, TEAMS_APP_CLIENT_ID, TEAMS_APP_CLIENT_SECRET, TEAMS_SENDER_EMAIL
//     (MS_TENANT_ID·MS_CLIENT_ID·MS_CLIENT_SECRET·MAIL_SENDER 이름도 받는다). 앱 등록에 Mail.Send(애플리케이션) 권한이 필요하다.
//   NOTIFY=0                                   발송 작업 끄기 (인앱 알림·큐 적재는 그대로)

export const EVENT_LABELS = {
  'issue.created': '이슈 생성',
  'issue.status': '상태 변경',
  'issue.comment': '이슈 댓글',
  'page.created': '문서 생성',
  'page.updated': '문서 수정',
  'page.comment': '문서 댓글',
};
const MAX_ATTEMPTS = 5;
// SSRF 방지: Teams 웹훅은 Microsoft 웹훅 호스트만 허용
const TEAMS_HOST = /(^|\.)(webhook\.office\.com|logic\.azure\.com|powerplatform\.com|powerautomate\.com)$/i;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const ROLE_TOKENS = ['@assignee', '@reporter', '@author'];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validTeamsUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && TEAMS_HOST.test(x.hostname); } catch { return false; }
}

// 이메일 대상: "a@x.com, @assignee" → { emails, roles }
export function parseEmailTarget(target) {
  const parts = String(target ?? '').split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  const emails = []; const roles = []; const bad = [];
  for (const p of parts) {
    if (ROLE_TOKENS.includes(p.toLowerCase())) roles.push(p.toLowerCase().slice(1));
    else if (EMAIL.test(p)) emails.push(p);
    else bad.push(p);
  }
  return { emails: [...new Set(emails)], roles: [...new Set(roles)], bad };
}

// 사용자가 접속한 주소 기준 공개 URL (Teams·메일 링크용)
export function publicBase(req, envName) {
  const fixed = process.env[envName];
  if (fixed) return fixed.replace(/\/$/, '');
  const host = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host ?? 'localhost';
  const proto = req?.headers?.['x-forwarded-proto'] ?? req?.protocol ?? 'http';
  return `${proto}://${host}`;
}

export function createNotifier({ query, app, env = process.env, log = console, fetchImpl = (...a) => fetch(...a) }) {
  const mail = {
    tenant: env.TEAMS_TENANT_ID ?? env.MS_TENANT_ID,
    clientId: env.TEAMS_APP_CLIENT_ID ?? env.MS_CLIENT_ID,
    secret: env.TEAMS_APP_CLIENT_SECRET ?? env.MS_CLIENT_SECRET,
    sender: env.TEAMS_SENDER_EMAIL ?? env.MAIL_SENDER,
  };
  const mailConfigured = !!(mail.tenant && mail.clientId && mail.secret && mail.sender);
  let mailRoles = null; // 토큰에 든 애플리케이션 권한 (Mail.Send 확인용)
  const channels = () => ({
    teams: !!env.TEAMS_WEBHOOK_URL,
    email: mailConfigured,
    emailReady: mailConfigured && (mailRoles == null || mailRoles.includes('Mail.Send')),
    emailNote: !mailConfigured ? '메일 설정 없음'
      : mailRoles && !mailRoles.includes('Mail.Send') ? '앱 등록에 Mail.Send(애플리케이션) 권한이 없어 보낼 수 없습니다 — Azure에서 권한 추가·관리자 동의 필요' : '',
  });

  // ---------- 이벤트 ----------
  // ev = { event, resourceType, resourceId, title, path, baseUrl, actorId, actorName, people: { assignee, reporter, author } }
  async function emit(ev) {
    try {
      if (!ev.actorName && ev.actorId) {
        const { rows } = await query(`SELECT display_name FROM users WHERE id = $1`, [ev.actorId]);
        ev.actorName = rows[0]?.display_name ?? null;
      }
      const url = `${ev.baseUrl}${ev.path}`;
      const subject = `[${app === 'gira' ? 'Gira' : 'Gonfluence'}] ${EVENT_LABELS[ev.event] ?? ev.event}: ${ev.title}${ev.actorName ? ` — ${ev.actorName}` : ''}`;
      // 인앱: 관련된 사람(담당자·보고자·작성자) 중 행동한 사람 제외
      const people = [...new Set(Object.values(ev.people ?? {}).filter(Boolean).map(Number))]
        .filter((id) => id !== Number(ev.actorId));
      for (const uid of people) {
        await query(
          `INSERT INTO notifications (user_id, event, title, path, actor_name) VALUES ($1, $2, $3, $4, $5)`,
          [uid, ev.event, ev.title, ev.path, ev.actorName ?? null]);
      }
      // 규칙 → 큐
      const { rows: rules } = await query(
        `SELECT * FROM notify_rules WHERE resource_type = $1 AND resource_id = $2 AND enabled AND $3 = ANY(events)`,
        [ev.resourceType, ev.resourceId, ev.event]);
      for (const r of rules) {
        let target = r.target;
        if (r.channel === 'teams') target = r.target || env.TEAMS_WEBHOOK_URL || '';
        else {
          const { emails, roles } = parseEmailTarget(r.target);
          const ids = roles.map((k) => ev.people?.[k]).filter(Boolean).map(Number).filter((id) => id !== Number(ev.actorId));
          if (ids.length) {
            const { rows } = await query(`SELECT email FROM users WHERE id = ANY($1::bigint[]) AND email IS NOT NULL AND active`, [ids]);
            emails.push(...rows.map((x) => x.email));
          }
          target = [...new Set(emails)].join(',');
          if (!target) continue; // 받을 사람이 없으면(예: 담당자 = 행동한 사람) 보내지 않는다
        }
        await query(
          `INSERT INTO notify_outbox (rule_id, resource_type, resource_id, event, channel, target, subject, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [r.id, ev.resourceType, ev.resourceId, ev.event, r.channel, target, subject, url]);
      }
      if (rules.length) kick();
    } catch (e) {
      log.error?.('[notify] 이벤트 처리 실패:', e.message);
    }
  }

  // ---------- 발송 ----------
  let token = null; // { value, exp }
  async function graphToken() {
    if (token && token.exp > Date.now() + 60_000) return token.value;
    const body = new URLSearchParams({
      client_id: mail.clientId, client_secret: mail.secret,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    });
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(mail.tenant)}/oauth2/v2.0/token`,
      { method: 'POST', body, signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`토큰 발급 실패 ${res.status} ${j.error ?? ''}`.trim());
    token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    try { mailRoles = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString()).roles ?? []; } catch { mailRoles = []; }
    return token.value;
  }

  async function sendTeams(m) {
    const card = {
      type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
      body: [{ type: 'TextBlock', text: m.subject, wrap: true, weight: 'Bolder' }],
      actions: [{ type: 'Action.OpenUrl', title: '열기', url: m.url }],
    };
    const res = await fetchImpl(m.target, {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ type: 'message', text: `${m.subject}\n${m.url}`,
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Teams 응답 ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
  }

  async function sendMail(m) {
    const t = await graphToken();
    if (mailRoles && !mailRoles.includes('Mail.Send')) throw new Error('Mail.Send 권한 없음 (앱 등록에 애플리케이션 권한 추가·관리자 동의 필요)');
    const to = m.target.split(',').filter(Boolean).map((address) => ({ emailAddress: { address } }));
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mail.sender)}/sendMail`, {
      method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: m.subject,
          body: { contentType: 'HTML', content: `<p>${escapeHtml(m.subject)}</p><p><a href="${escapeHtml(m.url)}">${escapeHtml(m.url)}</a></p>` },
          toRecipients: to,
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 202 && !res.ok) throw new Error(`Graph 응답 ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
  }

  async function processDue(limit = 20) {
    const { rows } = await query(
      `UPDATE notify_outbox SET status = 'sending'
        WHERE id IN (SELECT id FROM notify_outbox WHERE status = 'pending' AND next_at <= now()
                      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING *`, [limit]);
    const ch = channels();
    for (const m of rows) {
      const ready = m.channel === 'teams' ? (m.target && validTeamsUrl(m.target)) : ch.email;
      if (!ready) {
        await query(`UPDATE notify_outbox SET status = 'skipped', last_error = $2 WHERE id = $1`,
          [m.id, m.channel === 'teams' ? 'Teams 웹훅 주소 없음/허용되지 않음' : '메일 설정 없음(TEAMS_TENANT_ID 등)']);
        continue;
      }
      try {
        if (m.channel === 'teams') await sendTeams(m); else await sendMail(m);
        await query(`UPDATE notify_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [m.id]);
      } catch (e) {
        const n = /Mail\.Send 권한 없음/.test(e.message) ? MAX_ATTEMPTS : m.attempts + 1; // 권한 문제는 재시도해도 소용없다
        await query(
          `UPDATE notify_outbox SET status = $2, attempts = $3, last_error = $4,
                  next_at = now() + ($5 || ' minutes')::interval WHERE id = $1`,
          [m.id, n >= MAX_ATTEMPTS ? 'failed' : 'pending', n, String(e.message).slice(0, 500), String(2 ** n)]);
        log.warn?.(`[notify] ${m.channel} 발송 실패(${n}/${MAX_ATTEMPTS}): ${e.message}`);
      }
    }
    return rows.length;
  }

  let timer = null; let running = false;
  async function tick() {
    if (running) return; running = true;
    try { while (await processDue() === 20) { /* 밀린 것 계속 */ } } catch (e) { log.error?.('[notify] 발송 작업 실패:', e.message); }
    finally { running = false; }
  }
  function kick() { if (env.NOTIFY !== '0') setTimeout(tick, 50); }
  function start() {
    if (env.NOTIFY === '0' || timer) return;
    // 서버가 발송 중에 멈췄으면 다시 대기열로
    query(`UPDATE notify_outbox SET status = 'pending' WHERE status = 'sending'`).catch(() => {});
    timer = setInterval(tick, 30_000);
    timer.unref?.();
    if (mailConfigured) graphToken().then(() => {
      if (!mailRoles.includes('Mail.Send')) log.warn?.('[notify] 메일: 앱 토큰에 Mail.Send 권한이 없어 메일 알림은 보내지 못합니다');
    }).catch((e) => log.warn?.('[notify] 메일 토큰 확인 실패:', e.message));
  }

  // ---------- API ----------
  // resolve(req, reply, type, key, need) → { id, label } | null (권한 없으면 응답을 보내고 null)
  function registerRoutes(fastify, { resourceType, resolve }) {
    fastify.get('/api/notify/config', async () => {
      const c = channels();
      return { teams: c.teams, email: c.email, emailReady: c.emailReady, emailNote: c.emailNote, events: Object.entries(EVENT_LABELS)
        .filter(([k]) => k.startsWith(resourceType === 'project' ? 'issue.' : 'page.')).map(([value, label]) => ({ value, label })) };
    });

    fastify.get('/api/notify/rules', async (req, reply) => {
      const r = await resolve(req, reply, req.query.key, 'admin');
      if (!r) return;
      const { rows } = await query(
        `SELECT id, events, channel, target, enabled, created_at FROM notify_rules
          WHERE resource_type = $1 AND resource_id = $2 ORDER BY id`, [resourceType, r.id]);
      const { rows: recent } = await query(
        `SELECT id, event, channel, status, attempts, last_error, subject, created_at, sent_at FROM notify_outbox
          WHERE resource_type = $1 AND resource_id = $2 ORDER BY id DESC LIMIT 15`, [resourceType, r.id]);
      return { rules: rows, recent };
    });

    const checkRule = (b) => {
      const events = (Array.isArray(b.events) ? b.events : []).filter((e) => EVENT_LABELS[e]
        && e.startsWith(resourceType === 'project' ? 'issue.' : 'page.'));
      if (!events.length) return { error: '알릴 이벤트를 하나 이상 고르세요' };
      if (!['teams', 'email'].includes(b.channel)) return { error: '채널은 teams 또는 email' };
      let target = String(b.target ?? '').trim();
      if (b.channel === 'teams') {
        if (target && !validTeamsUrl(target)) return { error: 'Teams 웹훅 주소(https://…webhook.office.com 또는 …logic.azure.com 등)만 넣을 수 있습니다' };
        if (!target && !env.TEAMS_WEBHOOK_URL) return { error: '기본 Teams 웹훅(TEAMS_WEBHOOK_URL)이 설정되지 않았습니다 — 웹훅 주소를 넣으세요' };
      } else {
        const { emails, roles, bad } = parseEmailTarget(target);
        if (bad.length) return { error: `잘못된 받는 사람: ${bad.join(', ')}` };
        if (!emails.length && !roles.length) return { error: '받는 사람(메일 주소 또는 @assignee·@reporter·@author)을 넣으세요' };
        target = [...emails, ...roles.map((x) => `@${x}`)].join(', ');
      }
      return { events, channel: b.channel, target };
    };

    fastify.post('/api/notify/rules', async (req, reply) => {
      const r = await resolve(req, reply, req.body?.key, 'admin');
      if (!r) return;
      const v = checkRule(req.body ?? {});
      if (v.error) return reply.code(400).send({ error: v.error });
      const { rows } = await query(
        `INSERT INTO notify_rules (resource_type, resource_id, events, channel, target, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [resourceType, r.id, v.events, v.channel, v.target, req.access.userId]);
      return { id: rows[0].id };
    });

    const ruleWithAccess = async (req, reply) => {
      const { rows } = await query(`SELECT * FROM notify_rules WHERE id = $1 AND resource_type = $2`, [req.params.id, resourceType]);
      if (!rows.length) { reply.code(404).send({ error: 'not found' }); return null; }
      const r = await resolve(req, reply, null, 'admin', rows[0].resource_id);
      return r ? rows[0] : null;
    };

    fastify.patch('/api/notify/rules/:id', async (req, reply) => {
      const rule = await ruleWithAccess(req, reply);
      if (!rule) return;
      await query(`UPDATE notify_rules SET enabled = $2 WHERE id = $1`, [rule.id, req.body?.enabled !== false]);
      return { ok: true };
    });

    fastify.delete('/api/notify/rules/:id', async (req, reply) => {
      const rule = await ruleWithAccess(req, reply);
      if (!rule) return;
      await query(`DELETE FROM notify_rules WHERE id = $1`, [rule.id]);
      return { ok: true };
    });

    // 시험 발송: 그 규칙의 채널로 시험 메시지 1건 (담당자 등 역할 대상은 시험에서 나에게 보낸다)
    fastify.post('/api/notify/rules/:id/test', async (req, reply) => {
      const rule = await ruleWithAccess(req, reply);
      if (!rule) return;
      let target = rule.target;
      if (rule.channel === 'teams') target = rule.target || env.TEAMS_WEBHOOK_URL || '';
      else {
        const { emails, roles } = parseEmailTarget(rule.target);
        if (roles.length) {
          const { rows } = await query(`SELECT email FROM users WHERE id = $1`, [req.access.userId]);
          if (rows[0]?.email) emails.push(rows[0].email);
        }
        target = [...new Set(emails)].join(',');
      }
      const base = publicBase(req, app === 'gira' ? 'GIRA_PUBLIC_URL' : 'GONFLUENCE_PUBLIC_URL');
      await query(
        `INSERT INTO notify_outbox (rule_id, resource_type, resource_id, event, channel, target, subject, url)
         VALUES ($1, $2, $3, 'test', $4, $5, $6, $7)`,
        [rule.id, resourceType, rule.resource_id, rule.channel, target,
         `[${app === 'gira' ? 'Gira' : 'Gonfluence'}] 알림 시험 발송`, `${base}/`]);
      kick();
      return { ok: true };
    });

    // 인앱 알림 (종)
    fastify.get('/api/notifications', async (req) => {
      const { rows } = await query(
        `SELECT id, event, title, path, actor_name, created_at, read_at FROM notifications
          WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, [req.access.userId]);
      const { rows: c } = await query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.access.userId]);
      return { unread: c[0].n, items: rows.map((r) => ({ ...r, label: EVENT_LABELS[r.event] ?? r.event })) };
    });
    fastify.post('/api/notifications/read', async (req) => {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite);
      if (ids.length) await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`, [req.access.userId, ids]);
      else await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.access.userId]);
      return { ok: true };
    });
  }

  return { emit, start, processDue, registerRoutes, channels };
}
