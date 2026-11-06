// 원본 Jira 저장 필터·빠른 필터 JQL 호환 (GIRA-67)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJql, JqlError } from '../src/jql.mjs';

const run = (jql, opts = {}) => {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  return { ...parseJql(jql, { p, userId: 7, ...opts }), params };
};

test('상태·유형은 번역 전 이름(alias)으로도 찾는다', () => {
  const r = run('status = "In Progress" AND type = Task');
  assert.match(r.where, /lower\(s\.alias\)/);
  assert.match(r.where, /lower\(t\.alias\)/);
});

test('ORDER BY 여러 필드: 정렬 가능한 첫 필드를 쓰고 나머지는 무시', () => {
  assert.equal(run('project = A ORDER BY created DESC, issuetype DESC').order, '-created');
  assert.equal(run('project = A ORDER BY fixVersion ASC, resolved DESC').order, '-resolved');
  assert.equal(run('project = A ORDER BY "cf[10015]" DESC').order, null);
});

test('membersOf·standardIssueTypes·resolutiondate·Epic Link·이름[유형]', () => {
  const m = run('assignee IN membersOf("[팀] 개발 2팀")');
  assert.match(m.where, /user_groups/);
  assert.ok(m.params.includes('개발2팀'));
  assert.match(run('issuetype in standardIssueTypes()').where, /NOT COALESCE\(t\.subtask/);
  assert.match(run('issuetype in subTaskIssueTypes()').where, /^\(COALESCE\(t\.subtask/);
  assert.match(run('resolutiondate >= -4w').where, /i\.resolved_at >=/);
  assert.match(run('"Epic Link" = APP-1').where, /p1\.issue_key/);
  const cf = [{ id: 'customfield_1', name: 'os', schema_type: 'option' }];
  assert.ok(run('"os[Dropdown]" = Android', { customFields: cf }).params.includes('customfield_1'));
  assert.ok(run('os = Android', { customFields: cf }).params.includes('customfield_1')); // 따옴표 없는 이름
});

test('날짜 함수', () => {
  const r = run('created >= startOfMonth(-1) AND updated <= now()');
  assert.equal(r.params.length, 2);
  assert.equal(new Date(r.params[0]).getDate(), 1);
});

test('filter = 이름|id 는 저장 필터 JQL로 펼치고, 없으면 오류', () => {
  const filters = { ASD: 'project = APP AND labels = asd', 10: 'filter = ASD AND status = Done', loop: 'filter = loop' };
  const filterJql = (ref) => filters[ref] ?? null;
  const r = run('filter = 10 AND assignee is EMPTY', { filterJql });
  assert.match(r.where, /pr\.key/);
  assert.ok(r.params.includes('asd'));
  assert.throws(() => run('filter = 없음', { filterJql }), JqlError);
  assert.throws(() => run('filter = loop', { filterJql }), /깊습니다/);
});
