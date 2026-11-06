// 보고서용 순수 추출기. 원본 데이터나 네트워크에 의존하지 않는다.
export const words = (value) => String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
export function walk(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}
export function textOf(node) {
  if (node?.type === 'mention') return node.attrs?.text || node.attrs?.label || node.attrs?.displayName || node.attrs?.accountId || node.attrs?.id || '';
  if (['date', 'status', 'emoji'].includes(node?.type)) return node.attrs?.date ?? node.attrs?.text ?? '';
  return node?.text ?? (node?.content ?? []).map(textOf).join(' ');
}
export function details(doc) {
  const result = [];
  walk(doc, node => {
    if (node.type !== 'cfMacro' || node.attrs?.name !== 'details') return;
    const fields = {};
    walk(node, table => {
      if (table.type !== 'table') return;
      for (const row of table.content ?? []) {
        const [key, value] = row.content ?? [];
        if (key && value) fields[textOf(key).trim()] = value.content ?? [];
      }
    });
    result.push(fields);
  });
  return result;
}
export function reportNodes(doc, kind) {
  const items = [];
  walk(doc, n => {
    if (kind === 'tasks' && n.type === 'taskItem' && !n.attrs?.checked) {
      const assignees = [], dates = [];
      walk(n, c => { if (c.type === 'mention') assignees.push(textOf(c)); if (c.type === 'date') dates.push(c.attrs?.timestamp ?? c.attrs?.date); });
      items.push({ text: textOf(n), assignees, due: dates.filter(Boolean).join(', ') });
    }
    if (kind === 'decisions' && (n.type === 'decisionItem' || n.attrs?.adfType === 'decision-item')) items.push({ text: textOf(n) });
  });
  return items;
}
export function mergeDetails(rows, headings) {
  const records = rows.flatMap(row => details(row.doc).map(fields => ({ id: row.id, fields })));
  return { headings: words(headings).length ? words(headings) : [...new Set(records.flatMap(r => Object.keys(r.fields)))], records };
}
export function labelCounts(rows, excluded = '') {
  const skip = new Set(words(excluded)), counts = new Map();
  for (const row of rows) for (const name of new Set(row.labels ?? [])) if (!skip.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}
export function reportScope(params, currentSpace) {
  const cql = String(params.cql ?? '');
  // 지원하는 CQL은 AND로 묶은 space/label 동등 조건뿐이다. 미지원 구문은 넓은 조회로 바꾸지 않는다.
  const clauses = cql ? cql.split(/\s+and\s+/i) : [];
  const spaceValue = params.spaces ?? params.spaceKey ?? currentSpace;
  let spaces = words(typeof spaceValue === 'object' ? spaceValue?.['ri:space-key'] : spaceValue);
  if (!spaces.length) spaces = words(currentSpace);
  let labels = words(params.labels ?? params.label ?? params.analyticsKey);
  for (const clause of clauses) {
    const match = /^\s*(space|label)\s*=\s*(?:"([^"]+)"|'([^']+)'|(currentSpace\s*\(\s*\)))\s*$/i.exec(clause);
    if (!match) throw new Error('지원하지 않는 보고서 CQL');
    const value = match[2] ?? match[3] ?? currentSpace;
    if (match[1].toLowerCase() === 'space') spaces = [value]; else labels.push(value);
  }
  return { spaces, labels: [...new Set(labels)] };
}
