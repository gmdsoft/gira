import { query as dbQuery, getDb as dbGetDb } from './db.mjs';
import { spaceRole as checkSpaceRole, contentAccess as checkContentAccess } from './perm.mjs';
import { BUILTIN_TEMPLATES, templateTitle } from '../../shared/templates.mjs';

export function registerTemplates(app, { query = dbQuery, getDb = dbGetDb, spaceRole = checkSpaceRole, contentAccess = checkContentAccess } = {}) {
  async function scope(req, reply, need = 'view') {
    const { rows } = await query('SELECT id, name FROM spaces WHERE key = $1', [req.params.key]);
    if (!rows.length) { reply.code(404).send({ error: 'space not found' }); return null; }
    const role = await spaceRole(req.access, rows[0].id);
    if (!role || (need === 'admin' && role !== 'admin') || (need === 'edit' && role === 'viewer')) {
      reply.code(403).send({ error: '권한이 없습니다' }); return null;
    }
    return rows[0];
  }
  const valid = (b) => typeof b?.name === 'string' && b.name.trim() && b.doc?.type === 'doc' && Array.isArray(b.doc.content)
    && (b.labels === undefined || Array.isArray(b.labels) && b.labels.every((x) => typeof x === 'string'));
  app.get('/api/spaces/:key/templates', async (req, reply) => {
    const sp = await scope(req, reply); if (!sp) return;
    const { rows } = await query('SELECT * FROM space_templates WHERE space_id = $1 ORDER BY name', [sp.id]);
    return [...rows, ...BUILTIN_TEMPLATES];
  });
  app.post('/api/spaces/:key/templates', async (req, reply) => {
    const sp = await scope(req, reply, 'admin'); if (!sp) return;
    const b = req.body;
    if (!valid(b)) return reply.code(400).send({ error: '이름과 문서 본문이 필요합니다' });
    const { rows } = await query(`INSERT INTO space_templates(id, space_id, name, description, labels, doc)
      VALUES(nextval('space_template_id_seq'), $1, $2, $3, $4, $5) RETURNING *`,
    [sp.id, b.name.trim(), b.description ?? '', b.labels ?? [], JSON.stringify(b.doc)]);
    return rows[0];
  });
  app.patch('/api/spaces/:key/templates/:id', async (req, reply) => {
    const sp = await scope(req, reply, 'admin'); if (!sp) return;
    if (!/^\d+$/.test(req.params.id)) return reply.code(400).send({ error: '기본 템플릿은 변경할 수 없습니다' });
    const { rows: old } = await query('SELECT * FROM space_templates WHERE id=$1 AND space_id=$2', [req.params.id, sp.id]);
    if (!old.length) return reply.code(404).send({ error: 'template not found' });
    const b = { ...old[0], ...req.body };
    if (!valid(b)) return reply.code(400).send({ error: '이름과 문서 본문을 확인하세요' });
    const { rows } = await query(`UPDATE space_templates SET name=$3, description=$4, labels=$5, doc=$6, updated_at=now()
      WHERE id=$1 AND space_id=$2 RETURNING *`, [req.params.id, sp.id, b.name.trim(), b.description, b.labels, JSON.stringify(b.doc)]);
    return rows[0];
  });
  app.delete('/api/spaces/:key/templates/:id', async (req, reply) => {
    const sp = await scope(req, reply, 'admin'); if (!sp) return;
    if (!/^\d+$/.test(req.params.id)) return reply.code(400).send({ error: '기본 템플릿은 삭제할 수 없습니다' });
    const { rows } = await query('DELETE FROM space_templates WHERE id=$1 AND space_id=$2 RETURNING id', [req.params.id, sp.id]);
    return rows.length ? { ok: true } : reply.code(404).send({ error: 'template not found' });
  });
  app.post('/api/spaces/:key/templates/:id/create', async (req, reply) => {
    const sp = await scope(req, reply, 'edit'); if (!sp) return;
    let t = BUILTIN_TEMPLATES.find((t) => t.id === req.params.id);
    if (!t && /^\d+$/.test(req.params.id)) t = (await query('SELECT * FROM space_templates WHERE id=$1 AND space_id=$2', [req.params.id, sp.id])).rows[0];
    if (!t) return reply.code(404).send({ error: '원본 템플릿이 이관되지 않음' });
    const { parentId = null, title } = req.body ?? {};
    if (title !== undefined && typeof title !== 'string') return reply.code(400).send({ error: 'title must be a string' });
    if (parentId !== null) {
      if (!/^\d+$/.test(String(parentId))) return reply.code(400).send({ error: 'invalid parentId' });
      const a = await contentAccess(req.access, parentId);
      if (!a.view) return reply.code(403).send({ error: '부모 문서에 접근할 수 없습니다' });
    }
    const name = templateTitle(title, t.name, sp.name);
    const db = await (await getDb()).connect();
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(`INSERT INTO content(id, space_id, parent_id, type, title, status, author_id, owner_id, current_version, created_at, updated_at)
        VALUES(nextval('content_id_seq'), $1, $2, 'page', $3, 'current', $4, $4, 0, now(), now()) RETURNING id`, [sp.id, parentId, name, req.access.userId]);
      const id = rows[0].id;
      await db.query(`INSERT INTO drafts(content_id, doc, title, base_version, updated_by, updated_at) VALUES($1,$2,$3,0,$4,now())`, [id, JSON.stringify(t.doc), name, req.access.userId]);
      for (const label of t.labels ?? []) {
        await db.query(`WITH l AS (INSERT INTO labels(name) VALUES($2) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id)
          INSERT INTO content_labels(content_id,label_id) SELECT $1,id FROM l ON CONFLICT DO NOTHING`, [id, label]);
      }
      await db.query('COMMIT');
      return { id, spaceKey: req.params.key };
    } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  });
}
