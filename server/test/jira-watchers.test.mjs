import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncWatchers } from '../../scripts/lib/jira-watchers.mjs';
import { jiraGet } from '../../scripts/lib/jira-source-get.mjs';
import { addWatcher, watchIssuePeople } from '../src/jira-watchers.mjs';
import { createNotifier, parseEmailTarget } from '../src/notify.mjs';

test('관찰자 재동기화: 원본 교체, 로컬 보존, 중복 방지, 0명으로 변경', async () => {
  const cutoff = new Date('2026-01-01T00:00:00Z');
  const state = new Map([[1, 0], [2, 0], [3, cutoff.getTime()]]);
  let remote = [{ accountId: 'a2' }, { accountId: 'a4' }];
  const users = new Map([['a2', 2], ['a4', 4]]);
  const deps = {
    get: async path => { assert.equal(path, '/rest/api/3/issue/10/watchers'); return { watchers: remote }; },
    ensureUsers: async ids => { assert.deepEqual([...ids], remote.map(u => u.accountId)); },
    uid: u => users.get(u.accountId),
    query: async (sql, params) => {
      if (sql.startsWith('UPDATE')) return { rows: [{ watchers_imported_at: cutoff }] };
      assert.match(sql, /DELETE FROM jira_issue_watchers/);
      assert.match(sql, /created_at < \$3/);
      assert.match(sql, /ON CONFLICT \(issue_id, user_id\) DO NOTHING/);
      const [, ids, at] = params;
      for (const [id, created] of state) if (created < at.getTime() && !ids.includes(id)) state.delete(id);
      for (const id of ids) if (!state.has(id)) state.set(id, at.getTime() - 1);
      return { rows: [] };
    },
  };
  const issue = { id: 10, fields: { watches: { watchCount: 2 } } };
  await syncWatchers([issue], deps);
  assert.deepEqual([...state.keys()].sort(), [2, 3, 4]);
  remote = [{ accountId: 'a4' }];
  await syncWatchers([issue], deps);
  assert.deepEqual([...state.keys()].sort(), [3, 4]);
  remote = [];
  issue.fields.watches.watchCount = 0;
  await syncWatchers([issue], deps);
  assert.deepEqual([...state.keys()], [3]);
});

test('동시 6 제한, 403/404는 목록을 변경하지 않음, 기타 실패 전파', async () => {
  let active = 0, peak = 0, writes = 0;
  const deps = {
    query: async sql => { if (sql.startsWith('UPDATE')) return { rows: [{ watchers_imported_at: new Date() }] }; writes++; return { rows: [] }; },
    get: async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--; throw Object.assign(new Error('denied'), { status: 403 }); },
    ensureUsers: async () => {}, uid: () => null,
  };
  const issues = Array.from({ length: 20 }, (_, id) => ({ id, fields: { watches: { watchCount: 1 } } }));
  await syncWatchers(issues, deps);
  assert.equal(peak, 6); assert.equal(writes, 0);
  deps.get = async () => { throw Object.assign(new Error('missing'), { status: 404 }); };
  await syncWatchers(issues, deps);
  assert.equal(writes, 0);
  deps.get = async () => { throw new Error('failure'); };
  await assert.rejects(syncWatchers([issues[0]], deps), /failure/);
});

test('GET 재시도와 사용자 보장: 429 후 성공', async () => {
  let calls = 0;
  const get = jiraGet('https://synthetic.invalid', 'test', {
    fetchImpl: async (url, opts) => {
      assert.equal(opts.method, undefined);
      return ++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : Response.json({ watchers: [{ accountId: 'new' }] });
    }, sleep: async () => {},
  });
  let ensured = false;
  await syncWatchers([{ id: 1, fields: { watches: { watchCount: 1 } } }], {
    get, query: async sql => ({ rows: sql.startsWith('UPDATE') ? [{ watchers_imported_at: new Date() }] : [] }),
    ensureUsers: async ids => { assert.deepEqual([...ids], ['new']); ensured = true; },
    uid: () => { assert.ok(ensured); return 9; },
  });
  assert.equal(calls, 2);
});

test('자동 관찰: 보고자·담당자 중복 제거, 댓글 작성자 추가, 빈 담당자 무시', async () => {
  const calls = [];
  const query = async (sql, params) => { calls.push([sql, params]); return { rows: [{ reporter_id: 7, assignee_id: 7 }] }; };
  await watchIssuePeople(query, 10);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1], [10, 7]);
  await addWatcher(query, 10, 8);
  assert.deepEqual(calls[2][1], [10, 8]);
  assert.match(calls[2][0], /ON CONFLICT/);
  await addWatcher(query, 10, null);
  assert.equal(calls.length, 3);
});

for (const event of ['issue.status', 'issue.comment', 'issue.created']) test(`${event}: @watchers 역할, 행동자 제외·메일 중복 제거`, async () => {
  assert.deepEqual(parseEmailTarget('@WATCHERS').roles, ['watchers']);
  const queues = [];
  const notifier = createNotifier({ app: 'gira', env: { NOTIFY: '0' }, query: async (sql, params) => {
    if (sql.includes('FROM notify_rules')) return { rows: [{ id: 1, channel: 'email', target: '@watchers, @assignee' }] };
    if (sql.includes('SELECT email')) { assert.deepEqual([...new Set(params[0])], [2, 3]); return { rows: [{ email: 'two@example.invalid' }, { email: 'two@example.invalid' }] }; }
    if (sql.includes('INSERT INTO notify_outbox')) queues.push(params);
    return { rows: [] };
  } });
  await notifier.emit({ event, actorId: 1, actorName: '합성 사용자', resourceType: 'project', resourceId: 10,
    title: '합성 이슈', path: '/browse/TEST-1', baseUrl: 'https://synthetic.invalid', watchers: [1, 2, 3], people: { assignee: 2 } });
  assert.equal(queues.length, 1);
  assert.equal(queues[0][5], 'two@example.invalid');
});
