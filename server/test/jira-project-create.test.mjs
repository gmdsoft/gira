import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerProjectCreate } from '../src/jira-project-create.mjs';

async function run({ access = { canCreate: true, userId: 7 }, body = { name: '새 프로젝트', key: 'NEW' }, duplicate = false, failGrant = false } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id FROM jira_projects')) return { rows: duplicate ? [{ id: 1 }] : [] };
      if (sql.includes('INSERT INTO jira_projects')) return { rows: [{ id: 42, key: 'NEW', name: '새 프로젝트' }] };
      if (sql.includes('INSERT INTO jira_project_permissions') && failGrant) throw new Error('grant failure');
      return { rows: [{ id: 7 }] };
    },
    release() { released = true; },
  };
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.access = access; });
  registerProjectCreate(app, async () => ({ connect: async () => client }));
  const response = await app.inject({ method: 'POST', url: '/api/projects', payload: body });
  await app.close();
  return { response, calls, released };
}

test('권한 없는 사용자 차단: DB 호출 없음', async () => {
  const { response, calls } = await run({ access: { canCreate: false } });
  assert.equal(response.statusCode, 403); assert.equal(calls.length, 0);
});
test('잘못된 키와 접근 등급 거부', async () => {
  for (const body of [{ name: 'x', key: 'bad-key' }, { name: 'x', key: 'OK', rows: [{ principalType: 'anyone', role: 'owner' }] }]) {
    const { response, calls } = await run({ body });
    assert.equal(response.statusCode, 400); assert.equal(calls.length, 0);
  }
});
test('중복 키: 오류 메시지와 롤백', async () => {
  const { response, calls, released } = await run({ duplicate: true });
  assert.equal(response.statusCode, 409); assert.match(response.json().error, /이미 사용/);
  assert.equal(calls.at(-1).sql, 'ROLLBACK'); assert.ok(released);
});
test('생성자 권한을 관리자로 보강하고 모든 접근 대상을 저장', async () => {
  const rows = ['anyone', 'team', 'group', 'user'].map((principalType) => ({ principalType, principalId: 7, role: 'viewer' }));
  const { response, calls, released } = await run({ body: { name: '새 프로젝트', key: 'NEW', description: '설명', rows } });
  assert.equal(response.statusCode, 201); assert.equal(response.json().role, 'admin');
  const grants = calls.filter((c) => c.sql.includes('INSERT INTO jira_project_permissions'));
  assert.equal(grants.length, 4);
  assert.deepEqual(grants.find((c) => c.params[1] === 'user').params, [42, 'user', 7, 'admin']);
  assert.deepEqual(grants.find((c) => c.params[1] === 'anyone').params, [42, 'anyone', 0, 'viewer']);
  assert.equal(calls.at(-1).sql, 'COMMIT'); assert.ok(released);
});
test('권한 저장 실패 시 프로젝트도 롤백', async () => {
  const { response, calls, released } = await run({ failGrant: true });
  assert.equal(response.statusCode, 500); assert.equal(calls.at(-1).sql, 'ROLLBACK'); assert.ok(released);
});
