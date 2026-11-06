// Pure compatibility rules; unknown share targets fail closed.
export function canReadCollection(row, { userId, groups = [], projects = [] }) {
  if (String(row.owner_id) === String(userId)) return true;
  return (row.share ?? []).some(s =>
    s.type === 'group' && groups.includes(s.group?.name) ||
    s.type === 'project' && !s.role && projects.some(p =>
      String(p.id) === String(s.project?.id) || p.key === s.project?.key));
}
export function quickFilterJql(board, selected = '') {
  const ids = String(selected).split(',');
  return (board?.quickfilters ?? []).filter(q => ids.includes(String(q.source_id))).map(q => q.jql);
}
export function gadgetParams(gadget) {
  const uri = gadget.uri ?? gadget.moduleKey ?? '';
  const raw = gadget.preferences ?? {};
  const p = Object.fromEntries(Object.entries(raw).map(([k,v])=>[k, v && typeof v === 'object' ? v.value : v]));
  const filter = String(p.filterId ?? p.filter ?? '').replace(/^filter-/, '');
  const common = { filter, jql: p.jql ?? '' };
  if (/filter-results/.test(uri)) return { ...common, type: 'results' };
  if (/pie-chart|piechart/.test(uri)) return { ...common, type: 'pie', field: p.statType ?? 'status' };
  if (/two-dimensional/.test(uri)) return { ...common, type: 'two', x: p.xstattype ?? 'status', y: p.ystattype ?? 'assignee' };
  if (/created-vs-resolved|createdvsresolved/.test(uri)) return { ...common, type: 'createdvsresolved', days: p.daysprevious ?? 30, period: p.periodName ?? 'daily', cumulative: p.isCumulative ?? 'false' };
  return null;
}
