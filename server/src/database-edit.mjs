const types = ['t', 'n', 'd', 's', 'u', 'h', 'ji', 'pl', 'i', 'jid'];
const calcs = ['count', 'empty', 'filled', 'sum', 'avg', 'min', 'max'];
const array = (v, check) => Array.isArray(v) && v.every(check);
const str = v => typeof v === 'string';
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function validateDatabase(data, previous) {
  const fail = () => { throw new Error('잘못된 데이터베이스 값 또는 보기 설정입니다'); };
  if (!data || !['fields', 'rows', 'views'].every(k => Array.isArray(data[k]))) fail();
  for (const k of ['fields', 'rows', 'views']) {
    if (data[k].some(x => !x || !str(x.id) || !x.id) || new Set(data[k].map(x => x.id)).size !== data[k].length) fail();
  }
  if (!data.fields.length || !data.views.length) fail();
  const fields = new Map(data.fields.map(f => [f.id, f]));
  for (const f of data.fields) {
    if (!str(f.name) || !f.name.trim() || !types.includes(f.type)) fail();
    if (f.type === 's' && (!array(f.options, o => o && str(o.id) && str(o.label) && (!o.color || str(o.color))) || new Set(f.options.map(o => o.id)).size !== f.options.length)) fail();
    const old = previous?.fields.find(x => x.id === f.id);
    if ([old?.type, f.type].some(t => ['i', 'jid'].includes(t)) && (!old || !same(old, f))) fail();
  }
  for (const r of data.rows) {
    if (!r.cells || typeof r.cells !== 'object' || Array.isArray(r.cells)) fail();
    for (const [id, v] of Object.entries(r.cells)) {
      const f = fields.get(id); if (!f) fail();
      if (['i', 'jid'].includes(f.type)) {
        if (!same(v, previous?.rows.find(x => x.id === r.id)?.cells[id])) fail();
        continue;
      }
      // Preserve imported legacy values; edits and type conversions must satisfy the new schema.
      const oldField = previous?.fields.find(x => x.id === id);
      const oldRow = previous?.rows.find(x => x.id === r.id);
      if (oldField?.type === f.type && (f.type !== 's' || same(f.options, oldField.options)) && oldRow && same(v, oldRow.cells[id])) continue;
      if (v == null) continue;
      const valid = {
        t: () => str(v), n: () => typeof v === 'number' && Number.isFinite(v),
        d: () => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
        s: () => array(v, x => f.options.some(o => o.id === x)),
        u: () => array(v, x => x && str(x.a) && str(x.d)),
        h: () => array(v, x => { try { return x && ['http:', 'https:'].includes(new URL(x.u).protocol); } catch { return false; } }),
        ji: () => array(v, x => x && str(x.k) && /^[A-Z][A-Z0-9_]*-\d+$/.test(x.k)),
        pl: () => array(v, x => x && str(x.c) && /^\d+$/.test(x.c)),
      }[f.type];
      if (!valid?.()) fail();
    }
    // Read-only values cannot be cleared by omitting the cell.
    for (const f of data.fields.filter(f => ['i', 'jid'].includes(f.type))) {
      if (!same(r.cells[f.id], previous?.rows.find(x => x.id === r.id)?.cells[f.id])) fail();
    }
  }
  const filter = f => {
    if (f == null) return;
    if (['a', 'o'].includes(f.t)) { if (!Array.isArray(f.v)) fail(); f.v.forEach(filter); return; }
    if (!fields.has(f.f) || !['c', 'eq', 'ne', 'neq', 'nc', 'e', 'nep', 'gt', 'lt', 'range'].includes(f.t)) fail();
    if (f.t === 'range' && (!Array.isArray(f.v) || f.v.length !== 2 || !f.v.every(str))) fail();
  };
  for (const v of data.views) {
    if (!str(v.name) || !v.name.trim() || !['table', 'card', 'board'].includes(v.type) || !array(v.hiddenFields, id => fields.has(id))) fail();
    if (v.sort != null && !array(v.sort, s => s && fields.has(s.field) && typeof s.ascending === 'boolean')) fail();
    if (v.coverField && !fields.has(v.coverField)) fail();
    if (v.groupBy && fields.get(v.groupBy)?.type !== 's') fail();
    // 계산 줄: 필드 id → 계산 종류 (형식에 안 맞거나 지워진 필드 항목은 화면에서 무시한다)
    if (v.calculations != null && (typeof v.calculations !== 'object' || Array.isArray(v.calculations)
      || !Object.values(v.calculations).every(c => calcs.includes(c)))) fail();
    filter(v.filter);
  }
  return data;
}

// Caller owns the transaction; row lock serializes version checks and snapshot inserts.
export async function saveDatabase(client, { id, baseVersion, data, userId }) {
  const { rows: [current] } = await client.query('SELECT type, current_version FROM content WHERE id=$1 FOR UPDATE', [id]);
  if (current?.type !== 'database') return { status: 404, error: 'database not found' };
  const { rows: [snapshot] } = await client.query('SELECT data FROM database_snapshots WHERE content_id=$1 AND version=$2', [id, current.current_version]);
  if (baseVersion !== current.current_version) return { status: 409, error: '버전 충돌: 최신 데이터를 다시 불러오세요', currentVersion: current.current_version, data: snapshot?.data };
  validateDatabase(data, snapshot?.data);
  const version = current.current_version + 1;
  await client.query('INSERT INTO database_snapshots (content_id, version, data) VALUES ($1,$2,$3)', [id, version, JSON.stringify(data)]);
  await client.query("INSERT INTO content_versions (content_id,version,doc,message,author_id,created_at) VALUES ($1,$2,NULL,'데이터베이스 편집',$3,now())", [id, version, userId]);
  await client.query('UPDATE content SET current_version=$2, updated_at=now() WHERE id=$1', [id, version]);
  return { status: 200, version };
}
