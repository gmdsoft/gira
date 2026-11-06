// 알림(GIRA-14) 통합 테스트: 실제 Gira DB에 테스트 전용 행(resource_id 음수)만 만들고 지운다.
// 외부 발송은 fetch를 가짜로 바꿔 확인한다 — Teams·Microsoft로 아무것도 보내지 않는다.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { configureDb, query, closeDb } from '../src/db.mjs';
import { createNotifier, validTeamsUrl, parseEmailTarget } from '../src/notify.mjs';

configureDb({ url: process.env.GIRA_DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const RID = -914; // 테스트 리소스 id
const HOOK = 'https://example.webhook.office.com/webhookb2/test';
const cleanup = async () => {
  await query(`DELETE FROM notify_outbox WHERE resource_id = $1`, [RID]);
  await query(`DELETE FROM notify_rules WHERE resource_id = $1`, [RID]);
  await query(`DELETE FROM notifications WHERE title LIKE 'ZZNT-%'`);
};
after(async () => { await cleanup(); await closeDb?.(); });

test('입력 검사: Teams 웹훅 호스트 제한, 메일 대상 해석', () => {
  assert.ok(validTeamsUrl(HOOK));
  assert.ok(validTeamsUrl('https://prod-01.koreacentral.logic.azure.com/workflows/x'));
  assert.ok(!validTeamsUrl('http://example.webhook.office.com/x'));          // https만
  assert.ok(!validTeamsUrl('https://evil.example.com/webhook.office.com'));  // 호스트로 판단
  assert.ok(!validTeamsUrl('https://127.0.0.1/x'));
  assert.deepEqual(parseEmailTarget('a@x.com, @Assignee b@y.co'), { emails: ['a@x.com', 'b@y.co'], roles: ['assignee'], bad: [] });
  assert.deepEqual(parseEmailTarget('nope').bad, ['nope']);
});

test('규칙 매칭 → 큐 → Teams 발송, 인앱은 행동한 사람 제외, 메일은 Mail.Send 없으면 재시도 없이 실패', async () => {
  await cleanup();
  const { rows: u } = await query(`SELECT id, email FROM users WHERE active AND email IS NOT NULL ORDER BY id LIMIT 2`);
  const [actor, assignee] = u;
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    if (String(url).includes('login.microsoftonline.com')) {
      const payload = Buffer.from(JSON.stringify({ roles: ['User.Read.All'] })).toString('base64url');
      return Response.json({ access_token: `x.${payload}.y`, expires_in: 3600 });
    }
    return new Response('1', { status: 200 });
  };
  const n = createNotifier({ query, app: 'gira', fetchImpl: fakeFetch, log: { error() {}, warn() {} },
    env: { TEAMS_TENANT_ID: 't', TEAMS_APP_CLIENT_ID: 'c', TEAMS_APP_CLIENT_SECRET: 's', TEAMS_SENDER_EMAIL: 'bot@gmdsoft.com' } });
  await query(`INSERT INTO notify_rules (resource_type, resource_id, events, channel, target) VALUES
    ('project', $1, '{issue.status}', 'teams', $2),
    ('project', $1, '{issue.comment}', 'teams', $2),
    ('project', $1, '{issue.status}', 'email', '@assignee')`, [RID, HOOK]);

  await n.emit({ event: 'issue.status', resourceType: 'project', resourceId: RID, title: 'ZZNT-1 테스트 (해야 할 일 → 진행 중)',
    path: '/browse/ZZNT-1', baseUrl: 'http://gira.local:3002', actorId: actor.id, people: { assignee: assignee.id, reporter: actor.id } });

  const { rows: q } = await query(`SELECT channel, target, subject, url, status FROM notify_outbox WHERE resource_id = $1 ORDER BY id`, [RID]);
  assert.equal(q.length, 2, 'status 이벤트 규칙 2개만 (comment 규칙은 제외)');
  assert.equal(q[0].channel, 'teams');
  assert.equal(q[0].url, 'http://gira.local:3002/browse/ZZNT-1');
  assert.match(q[0].subject, /^\[Gira\] 상태 변경: ZZNT-1 테스트/);
  assert.equal(q[1].target, assignee.email, '@assignee → 담당자 메일');

  const { rows: inapp } = await query(`SELECT user_id FROM notifications WHERE title LIKE 'ZZNT-%'`);
  assert.deepEqual(inapp.map((r) => Number(r.user_id)), [Number(assignee.id)], '보고자=행동한 사람은 인앱 제외');

  await n.processDue();
  const teams = calls.find((c) => c.url === HOOK);
  assert.ok(teams, 'Teams 웹훅 호출');
  const card = JSON.parse(teams.body);
  assert.equal(card.attachments[0].content.actions[0].url, 'http://gira.local:3002/browse/ZZNT-1');
  assert.ok(!calls.some((c) => c.url.includes('/sendMail')), 'Mail.Send 없으면 sendMail을 부르지 않는다');
  const { rows: st } = await query(`SELECT channel, status, attempts, last_error FROM notify_outbox WHERE resource_id = $1 ORDER BY id`, [RID]);
  assert.equal(st[0].status, 'sent');
  assert.equal(st[1].status, 'failed');
  assert.match(st[1].last_error, /Mail\.Send/);
  assert.equal(n.channels().emailReady, false);
});

test('웹훅 실패는 재시도 대기(백오프), 행동한 사람이 담당자면 메일 대상 없음', async () => {
  await cleanup();
  const { rows: u } = await query(`SELECT id FROM users WHERE active AND email IS NOT NULL ORDER BY id LIMIT 1`);
  let fail = true;
  const n = createNotifier({ query, app: 'gonfluence', log: { error() {}, warn() {} }, env: {},
    fetchImpl: async () => (fail ? new Response('bad', { status: 500 }) : new Response('1')) });
  await query(`INSERT INTO notify_rules (resource_type, resource_id, events, channel, target) VALUES
    ('space', $1, '{page.updated}', 'teams', $2), ('space', $1, '{page.updated}', 'email', '@author')`, [RID, HOOK]);
  await n.emit({ event: 'page.updated', resourceType: 'space', resourceId: RID, title: 'ZZNT-문서', path: '/s/X/p/1',
    baseUrl: 'http://wiki', actorId: u[0].id, people: { author: u[0].id } });
  const { rows: q } = await query(`SELECT channel FROM notify_outbox WHERE resource_id = $1`, [RID]);
  assert.deepEqual(q.map((r) => r.channel), ['teams'], '받을 사람이 없는 메일은 큐에 넣지 않는다');
  await n.processDue();
  const { rows: s1 } = await query(`SELECT status, attempts, next_at > now() AS later FROM notify_outbox WHERE resource_id = $1`, [RID]);
  assert.deepEqual({ ...s1[0] }, { status: 'pending', attempts: 1, later: true });
  fail = false;
  await query(`UPDATE notify_outbox SET next_at = now() WHERE resource_id = $1`, [RID]);
  await n.processDue();
  const { rows: s2 } = await query(`SELECT status FROM notify_outbox WHERE resource_id = $1`, [RID]);
  assert.equal(s2[0].status, 'sent');
});
