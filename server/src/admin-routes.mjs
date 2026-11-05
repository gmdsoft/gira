// 조직 관리 라우트 (사이트 관리자): 사용자·팀·파트·그룹·API 키.
// 관리 서비스(admin-app.mjs)가 등록한다 — 조직 테이블의 유일한 작성자이며,
// 변경은 mirrorQuery(ORG_MIRROR_DATABASE_URL, 콤마 구분)로 다른 앱 DB에도 복제된다.
import { randomBytes } from 'node:crypto';
import { query, mirrorQuery } from './db.mjs';
import { hashToken } from './auth.mjs';

function requireAdmin(req, reply) {
  if (req.access.isAdmin) return true;
  reply.code(403).send({ error: '사이트 관리자만 사용할 수 있습니다' });
  return false;
}

export function registerOrgAdmin(app) {
  // 선택 UI용 사용자·그룹·팀 검색 (관리 SPA의 그룹 멤버 추가 등)
  app.get('/api/principals', async (req) => {
    const q = (req.query.q ?? '').trim();
    const { rows: users } = await query(
      `SELECT id, display_name, email FROM users
        WHERE active AND display_name IS NOT NULL
          AND confluence_account_id IS DISTINCT FROM 'test-login'
          AND ($1 = '' OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
        ORDER BY display_name LIMIT 10`, [q]);
    const { rows: groups } = await query(
      `SELECT id, name FROM groups WHERE $1 = '' OR name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 10`, [q]);
    const { rows: teams } = await query(
      `SELECT t.id, t.name, p.name AS parent_name
         FROM teams t LEFT JOIN teams p ON p.id = t.parent_id
        WHERE $1 = '' OR t.name ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%'
        ORDER BY coalesce(p.name, t.name), t.parent_id NULLS FIRST, t.name LIMIT 15`, [q]);
    return {
      users: users.map((u) => ({ type: 'user', id: u.id, name: u.display_name, email: u.email })),
      groups: groups.map((g) => ({ type: 'group', id: g.id, name: g.name })),
      teams: teams.map((t) => ({
        type: 'team', id: t.id, part: !!t.parent_name,
        name: t.parent_name ? `${t.parent_name} / ${t.name}` : t.name,
      })),
    };
  });

  app.get('/api/admin/users', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const q = (req.query.q ?? '').trim();
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.email, u.active, u.is_admin, u.rank, u.duty, u.team_id, u.dev_login,
            CASE WHEN t.id IS NULL THEN NULL
                 WHEN tp.id IS NULL THEN t.name
                 ELSE tp.name || ' / ' || t.name END AS team_name,
            coalesce((SELECT array_agg(g.name ORDER BY g.name) FROM user_groups ug JOIN groups g ON g.id = ug.group_id
                       WHERE ug.user_id = u.id), '{}') AS groups
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
       LEFT JOIN teams tp ON tp.id = t.parent_id
      WHERE u.confluence_account_id IS DISTINCT FROM 'local-dev'
        AND ($1 = '' OR u.display_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
      ORDER BY u.active DESC, u.display_name NULLS LAST LIMIT 200`, [q]);
  return rows;
});

  app.post('/api/admin/users/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { active, isAdmin, rank, duty, teamId, devLogin } = req.body ?? {};
  if (Number(req.params.id) === req.access.userId && isAdmin === false) {
    return reply.code(400).send({ error: '자기 자신의 관리자 권한은 해제할 수 없습니다' });
  }
  if (duty != null && !['team_lead', 'part_lead', 'member'].includes(duty)) {
    return reply.code(400).send({ error: 'duty는 team_lead/part_lead/member 중 하나입니다' });
  }
  if (teamId != null && teamId !== undefined) {
    const { rows: t } = await query(`SELECT id FROM teams WHERE id = $1`, [teamId]);
    if (!t.length) return reply.code(404).send({ error: 'team not found' });
  }
  const sql = `UPDATE users SET
       active = COALESCE($2, active),
       is_admin = COALESCE($3, is_admin),
       rank = CASE WHEN $4 THEN NULLIF($5, '') ELSE rank END,
       duty = COALESCE($6, duty),
       team_id = CASE WHEN $7 THEN $8::bigint ELSE team_id END,
       dev_login = COALESCE($9, dev_login)
     WHERE id = $1 RETURNING id, display_name, active, is_admin, rank, duty, team_id, dev_login`;
  const params = [req.params.id, active ?? null, isAdmin ?? null,
    rank !== undefined, rank ?? null, duty ?? null, teamId !== undefined, teamId ?? null,
    devLogin ?? null];
  const { rows } = await query(sql, params);
  if (!rows.length) return reply.code(404).send({ error: 'user not found' });
  mirrorQuery(sql, params); // Gira DB에도 반영
  return rows[0];
});

// 팀·파트 관리 (사이트 관리자). parent_id 없으면 팀, 있으면 그 팀의 파트 — 2단까지만.
  app.get('/api/admin/teams', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { rows } = await query(
    `SELECT t.id, t.name, t.parent_id, t.position,
            (SELECT count(*)::int FROM users u WHERE u.team_id = t.id AND u.active) AS member_count
       FROM teams t ORDER BY t.parent_id NULLS FIRST, t.position NULLS LAST, t.name`);
  return rows;
});

  app.post('/api/admin/teams', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const name = req.body?.name?.trim();
  const parentId = req.body?.parentId ?? null;
  if (!name) return reply.code(400).send({ error: 'name required' });
  if (parentId != null) {
    const { rows: p } = await query(`SELECT parent_id FROM teams WHERE id = $1`, [parentId]);
    if (!p.length) return reply.code(404).send({ error: 'parent team not found' });
    if (p[0].parent_id != null) return reply.code(400).send({ error: '파트 아래에는 만들 수 없습니다 (팀 > 파트 2단까지)' });
  }
  const { rows } = await query(
    `INSERT INTO teams (name, parent_id) VALUES ($1, $2) RETURNING id, name, parent_id`, [name, parentId]);
  mirrorQuery(`INSERT INTO teams (id, name, parent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [rows[0].id, name, parentId]);
  mirrorQuery(`SELECT setval('teams_id_seq', (SELECT coalesce(max(id), 1) FROM teams))`);
  return rows[0];
});

  app.post('/api/admin/teams/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const name = req.body?.name?.trim();
  if (!name) return reply.code(400).send({ error: 'name required' });
  const { rows } = await query(
    `UPDATE teams SET name = $2 WHERE id = $1 RETURNING id, name, parent_id`, [req.params.id, name]);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  mirrorQuery(`UPDATE teams SET name = $2 WHERE id = $1`, [req.params.id, name]);
  return rows[0];
});

  app.delete('/api/admin/teams/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const id = req.params.id;
  const { rows: busy } = await query(
    `SELECT (SELECT count(*) FROM users WHERE team_id = $1 AND active) +
            (SELECT count(*) FROM teams WHERE parent_id = $1) AS n`, [id]);
  if (Number(busy[0].n) > 0) {
    return reply.code(400).send({ error: '소속원이나 하위 파트가 있는 조직은 삭제할 수 없습니다' });
  }
  await query(`DELETE FROM space_permissions WHERE principal_type = 'team' AND principal_id = $1`, [id]);
  await query(`DELETE FROM content_restrictions WHERE principal_type = 'team' AND principal_id = $1`, [id]);
  await query(`UPDATE users SET team_id = NULL WHERE team_id = $1`, [id]);
  await query(`DELETE FROM teams WHERE id = $1`, [id]);
  mirrorQuery(`DELETE FROM jira_project_permissions WHERE principal_type = 'team' AND principal_id = $1`, [id]);
  mirrorQuery(`UPDATE users SET team_id = NULL WHERE team_id = $1`, [id]);
  mirrorQuery(`DELETE FROM teams WHERE id = $1`, [id]);
  return { ok: true };
});

  app.get('/api/admin/groups', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { rows } = await query(
    `SELECT g.id, g.name, g.can_create, count(ug.user_id)::int AS member_count
       FROM groups g LEFT JOIN user_groups ug ON ug.group_id = g.id
      GROUP BY g.id ORDER BY g.name`);
  return rows;
});

  app.post('/api/admin/groups', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const name = req.body?.name?.trim();
  if (!name) return reply.code(400).send({ error: 'name required' });
  const { rows } = await query(`INSERT INTO groups (name) VALUES ($1) RETURNING id, name, can_create`, [name]);
  mirrorQuery(`INSERT INTO groups (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [rows[0].id, name]);
  mirrorQuery(`SELECT setval('groups_id_seq', (SELECT coalesce(max(id), 1) FROM groups))`);
  return rows[0];
});

// 그룹 속성 변경: 이름, 생성 권한(can_create — 멤버가 프로젝트/스페이스를 만들 수 있는 그룹)
  app.post('/api/admin/groups/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const name = req.body?.name?.trim();
  const canCreate = req.body?.canCreate;
  const sql = `UPDATE groups SET name = COALESCE($2, name), can_create = COALESCE($3, can_create)
      WHERE id = $1 RETURNING id, name, can_create`;
  const params = [req.params.id, name || null, canCreate ?? null];
  const { rows } = await query(sql, params);
  if (!rows.length) return reply.code(404).send({ error: 'not found' });
  mirrorQuery(sql, params);
  return rows[0];
});

  app.delete('/api/admin/groups/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const id = req.params.id;
  await query(`DELETE FROM user_groups WHERE group_id = $1`, [id]);
  await query(`DELETE FROM space_permissions WHERE principal_type = 'group' AND principal_id = $1`, [id]);
  await query(`DELETE FROM content_restrictions WHERE principal_type = 'group' AND principal_id = $1`, [id]);
  await query(`DELETE FROM groups WHERE id = $1`, [id]);
  mirrorQuery(`DELETE FROM user_groups WHERE group_id = $1`, [id]);
  mirrorQuery(`DELETE FROM jira_project_permissions WHERE principal_type = 'group' AND principal_id = $1`, [id]);
  mirrorQuery(`DELETE FROM groups WHERE id = $1`, [id]);
  return { ok: true };
});

  app.get('/api/admin/groups/:id/members', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.email FROM user_groups ug JOIN users u ON u.id = ug.user_id
      WHERE ug.group_id = $1 ORDER BY u.display_name`, [req.params.id]);
  return rows;
});

  app.post('/api/admin/groups/:id/members', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const userId = Number(req.body?.userId);
  if (!userId) return reply.code(400).send({ error: 'userId required' });
  await query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, req.params.id]);
  mirrorQuery(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, req.params.id]);
  return { ok: true };
});

  app.delete('/api/admin/groups/:id/members/:userId', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  await query(`DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2`,
    [req.params.id, req.params.userId]);
  mirrorQuery(`DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2`,
    [req.params.id, req.params.userId]);
  return { ok: true };
});

// API 키 발급·관리 (사이트 관리자)
  app.get('/api/admin/apikeys', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { rows } = await query(
    `SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at,
            u.display_name AS user_name
       FROM api_keys k JOIN users u ON u.id = k.user_id ORDER BY k.created_at DESC`);
  return rows;
});

  app.post('/api/admin/apikeys', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const name = req.body?.name?.trim();
  const userId = Number(req.body?.userId) || req.access.userId;
  if (!name) return reply.code(400).send({ error: 'name required' });
  const token = 'gmd_' + randomBytes(24).toString('base64url');
  const { rows } = await query(
    `INSERT INTO api_keys (user_id, name, prefix, token_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, name, token.slice(0, 12), hashToken(token)]);
  return { id: rows[0].id, token }; // 토큰 평문은 이 응답에서만 — 다시 조회할 수 없다
});

  app.delete('/api/admin/apikeys/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  await query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [req.params.id]);
  return { ok: true };
});
}
