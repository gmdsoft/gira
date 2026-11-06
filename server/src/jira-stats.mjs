// Pure aggregation shared by the authenticated stats route and fixture tests.
export const fields = { statuses: 'status', status: 'status', resolution: 'resolution', issuetype: 'issuetype', reporter: 'reporter', assignees: 'assignee', assignee: 'assignee', project: 'project', allFixfor: 'fix_versions', labels: 'labels', components: 'components' };
export function decodeJql(value = '') {
  // Decode only an encoded expression; literal percent signs in ordinary JQL survive.
  if (!/%(?:20|3d|28|22)/i.test(value)) return value;
  try { return decodeURIComponent(value); } catch { throw new Error('잘못된 JQL URL 인코딩'); }
}
export function requestedProjects(jql) {
  return [...jql.matchAll(/\bproject\s*(?:=\s*("[^"]+"|'[^']+'|[\w-]+)|in\s*\(([^)]+)\))/gi)]
    .flatMap(m => (m[1] ?? m[2]).split(',').map(v => v.trim().replace(/^["']|["']$/g, '')));
}
function values(issue, field) {
  if (!fields[field] && !/^customfield_\d+$/.test(field ?? '')) throw new Error(`지원하지 않는 집계 필드: ${field}`);
  let v = fields[field] ? issue[fields[field]] : issue.fields_raw?.[field];
  const scalar = v => v && typeof v === 'object' ? (v.value ?? v.name ?? v.id ?? '') : v;
  v = Array.isArray(v) ? v.map(scalar) : scalar(v);
  return [...new Set((Array.isArray(v) ? v : [v]).filter(v => v != null && v !== '').map(String))].length
    ? [...new Set((Array.isArray(v) ? v : [v]).filter(v => v != null && v !== '').map(String))] : [''];
}
export function aggregate(issues, options, now = new Date()) {
  const type = options.type ?? 'two';
  if (type === 'createdvsresolved') {
    const days = Math.min(3660, Math.max(1, Number(options.days) || 30));
    const period = options.period ?? 'daily';
    if (!['daily', 'weekly', 'monthly'].includes(period)) throw new Error('지원하지 않는 기간');
    const end = new Date(now); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
    const key = d => { const v = new Date(d); if (period === 'monthly') v.setUTCDate(1); if (period === 'weekly') v.setUTCDate(v.getUTCDate() - (v.getUTCDay() + 6) % 7); return v.toISOString().slice(0, 10); };
    const buckets = new Map();
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) buckets.set(key(d), { date: key(d), created: 0, resolved: 0 });
    for (const i of issues) for (const [field, metric] of [['created_at', 'created'], ['resolved_at', 'resolved']]) {
      const date = i[field] && new Date(i[field]);
      if (date && date >= start && date < end) buckets.get(key(date))[metric]++;
    }
    const rows = [...buckets.values()]; let created = 0, resolved = 0;
    for (const row of rows) { created += row.created; resolved += row.resolved; if (String(options.cumulative) === 'true') { row.created = created; row.resolved = resolved; } row.unresolved = created - resolved; }
    return { type, total: issues.length, rows, period };
  }
  if (type === 'pie') {
    const counts = new Map();
    // Validate even when no issues match.
    values({}, options.field);
    for (const i of issues) for (const v of values(i, options.field)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return { type, total: issues.length, values: [...counts].map(([value, count]) => ({ value, count })).sort((a,b) => b.count-a.count) };
  }
  if (type !== 'two') throw new Error('지원하지 않는 차트 형식');
  values({}, options.x); values({}, options.y);
  const columns = new Set(), rows = new Map();
  for (const issue of issues) for (const y of values(issue, options.y)) {
    if (!rows.has(y)) rows.set(y, { value: y, total: 0, cells: {} });
    const row = rows.get(y); row.total++;
    for (const x of values(issue, options.x)) { columns.add(x); Object.defineProperty(row.cells, x, { value: (Object.hasOwn(row.cells, x) ? row.cells[x] : 0) + 1, enumerable: true, writable: true, configurable: true }); }
  }
  const sorted = [...rows.values()].sort((a,b) => options.sortBy === 'natural' ? a.value.localeCompare(b.value) : b.total-a.total || a.value.localeCompare(b.value));
  if ((options.sortBy === 'natural' && options.sortDirection === 'desc') || (options.sortBy !== 'natural' && options.sortDirection === 'asc')) sorted.reverse();
  const totals = Object.fromEntries([...columns].map(c => [c, [...rows.values()].reduce((n,r) => n + (Object.hasOwn(r.cells, c) ? r.cells[c] : 0),0)]));
  return { type, total: issues.length, columns: [...columns].sort(), totals, rows: sorted.slice(0, Math.min(1000, Math.max(1, Number(options.numberToShow) || 10))), rowCount: rows.size };
}
