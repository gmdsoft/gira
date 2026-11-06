import { decodeCanvas } from '../research/canvas-decode.mjs';

const ordered = (order, map = {}) => [...new Set([...(order ?? []), ...Object.keys(map)])].filter(id => map[id] != null);
export function normalizeDatabase(source) {
  const j = source instanceof Uint8Array ? decodeCanvas(source) : source;
  return {
    fields: ordered(j.f, j.fbi).map(id => {
      const f = j.fbi[id];
      return { id, name: f.n, type: f.t, width: f.w, options: (f.sso ?? []).map(o => ({ id: o.i, label: o.l, color: o.c })),
        ...(f.t === 'jid' ? { jiraField: f.sjf, issueField: f.sfi } : {}) };
    }),
    rows: ordered(j.e, j.ebi).map(id => ({ id, cells: Object.fromEntries(Object.entries(j.ebi[id]).map(([k, c]) => [k, c?.v ?? null])) })),
    views: ordered(j.v, j.vbi).map(id => {
      const v = j.vbi[id];
      return { id, name: v.n, type: ({ t: 'table', g: 'card', b: 'board' })[v.t] ?? 'table',
        hiddenFields: ordered(j.f, j.fbi).filter(f => v.fie?.[f] === false || (v.fie?.default === false && v.fie?.[f] !== true)),
        sort: (v.vs ?? (v.so ? [{ fi: v.so.f, a: v.so.a }] : [])).map(s => ({ field: s.fi, ascending: s.a })),
        filter: v.fil ?? null, groupBy: v.gfi ?? null, coverField: v.cf?.t === 'i' ? v.cf.i : null };
    }),
  };
}

// Fetch credentials stay in memory; only the Yjs update and normalized values are persisted.
export async function fetchDatabase(id, { get, site, fetchImpl = fetch }) {
  const c = await get(`/wiki/rest/api/content/${encodeURIComponent(id)}?expand=version,ancestors,space`);
  const { cloudId } = await get('/_edge/tenant_info');
  const [session] = await get(`/wiki/rest/internal/1.0/canvas/session/bulk?ids=${encodeURIComponent(id)}`);
  const ari = `ari:cloud:canvas:${cloudId}:database/${c.referenceId}`;
  const res = await fetchImpl(`${site}/gateway/api/canvas-tenant-context/site/${cloudId}/api/_internal/collab/${encodeURIComponent(ari)}?skipSteps=true&v=2`,
    { headers: { 'x-access-token': session.data.access.token } });
  if (!res.ok) throw new Error(`database ${id}: collab ${res.status}`);
  const binary = Buffer.from(await res.arrayBuffer());
  return { binary, data: normalizeDatabase(binary), content: c };
}
