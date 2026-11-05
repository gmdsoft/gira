import { getDb } from './db.mjs';

export function registerProjectCreate(app, database = getDb) {
  app.post('/api/projects', async (req, reply) => {
    if (!req.access.canCreate) return reply.code(403).send({ error: '프로젝트 생성 권한이 없습니다' });
    const { name, key, description = '', rows = [] } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200 ||
        typeof key !== 'string' || !/^[A-Z][A-Z0-9]{1,19}$/.test(key) ||
        typeof description !== 'string' || description.length > 10000) {
      return reply.code(400).send({ error: '이름(1~200자), 키(영문 대문자로 시작하는 대문자·숫자 2~20자), 설명(10000자 이하)을 확인하세요' });
    }
    if (!Array.isArray(rows) || rows.length > 200 || rows.some((r) => !r ||
        !['user', 'team', 'group', 'anyone'].includes(r.principalType) ||
        !['viewer', 'editor', 'admin'].includes(r.role) ||
        (r.principalType !== 'anyone' && (!Number.isSafeInteger(r.principalId) || r.principalId <= 0)))) {
      return reply.code(400).send({ error: '잘못된 접근 범위입니다' });
    }
    const client = await (await database()).connect();
    try {
      await client.query('BEGIN');
      // 이관 데이터는 원본 ID를 그대로 쓰므로, 로컬 프로젝트는 원본과 겹치지 않는 1e12 이상 대역에서
      // 테이블 잠금 아래 빈 ID를 배정한다 (원본 동기화·추가 이관 시 충돌 방지).
      await client.query('LOCK TABLE jira_projects IN EXCLUSIVE MODE');
      const existing = await client.query('SELECT id FROM jira_projects WHERE upper(key) = $1', [key]);
      if (existing.rows.length) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: '이미 사용 중인 프로젝트 키입니다' });
      }
      for (const r of rows) {
        if (r.principalType === 'anyone') continue;
        const table = { user: 'users', team: 'teams', group: 'groups' }[r.principalType];
        const target = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [r.principalId]);
        if (!target.rows.length) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: '존재하지 않는 접근 대상입니다' });
        }
      }
      const { rows: projects } = await client.query(
        `INSERT INTO jira_projects (id, key, name, lead_id, raw)
         SELECT GREATEST(COALESCE(MAX(id), 0) + 1, 1000000000000), $1, $2, $3, $4::jsonb FROM jira_projects RETURNING id, key, name`,
        [key, name.trim(), req.access.userId, JSON.stringify({ description })]);
      const project = projects[0];
      const grants = new Map(rows.map((r) => [r.principalType + ':' + (r.principalType === 'anyone' ? 0 : r.principalId), r]));
      grants.set('user:' + req.access.userId, { principalType: 'user', principalId: req.access.userId, role: 'admin' });
      for (const r of grants.values()) {
        await client.query(`INSERT INTO jira_project_permissions (project_id, principal_type, principal_id, role)
          VALUES ($1, $2, $3, $4)`, [project.id, r.principalType, r.principalType === 'anyone' ? 0 : r.principalId, r.role]);
      }
      await client.query('COMMIT');
      return reply.code(201).send({ ...project, role: 'admin' });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return reply.code(409).send({ error: '이미 사용 중인 프로젝트 키입니다' });
      throw err;
    } finally { client.release(); }
  });
}
