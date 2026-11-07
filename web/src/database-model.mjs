export const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
export const plain = v => v == null ? '' : typeof v === 'object' ? v.label ?? v.name ?? v.displayName ?? v.k ?? v.u ?? v.f ?? JSON.stringify(v) : String(v);
export function cellText(field, value) {
  return list(value).map(v => field?.type === 's' ? field.options.find(o => o.id === v)?.label ?? plain(v) : plain(v)).join(', ');
}
export function viewRows(data, view, value = (row, field) => row.cells[field.id]) {
  const text = (r, id) => { const f = data.fields.find(f => f.id === id); return cellText(f, f ? value(r, f) : null); };
  const matches = (r, f) => {
    if (!f) return true;
    if (f.t === 'a' || f.t === 'o') return f.t === 'a' ? f.v.every(c => matches(r, c)) : f.v.some(c => matches(r, c));
    const actual = text(r, f.f), expected = cellText(data.fields.find(x => x.id === f.f), f.v?.v ?? f.v);
    switch (f.t) {
      case 'c': return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
      case 'eq': return data.fields.find(x => x.id === f.f)?.type === 's' ? list(f.v?.v ?? f.v).every(id => list(r.cells[f.f]).includes(id)) : actual === expected;
      case 'range': return !!actual && (!f.v[0] || actual >= f.v[0]) && (!f.v[1] || actual <= f.v[1]);
      case 'ne': case 'neq': return actual !== expected;
      case 'nc': return !actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
      case 'e': return !actual;
      case 'nep': return !!actual;
      case 'gt': return Number(actual) > Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      default: return true;
    }
  };
  return data.rows.filter(r => matches(r, view.filter)).sort((a, b) => {
    for (const s of view.sort ?? []) {
      const field = data.fields.find(f => f.id === s.field);
      const av = field && value(a, field), bv = field && value(b, field);
      const n = field?.type === 'n' && typeof av === 'number' && typeof bv === 'number' ? av - bv : text(a, s.field).localeCompare(text(b, s.field), undefined, { numeric: true });
      if (n) return s.ascending === false ? -n : n;
    }
    return 0;
  });
}

export function databaseValue(row, field, issues) {
  if (field.type !== 'jid') return row.cells[field.id];
  const key = field.jiraField === 'issuetype' ? 'type' : field.jiraField;
  return list(row.cells[field.issueField]).flatMap(v => list(issues[v.k]?.[key]));
}

// 표 아래 계산 줄: 모든 열은 개수·빈칸·채운 칸, 숫자 열은 합계·평균·최소·최대
export const CALCS = { count: '항목 개수', empty: '빈칸', filled: '채운 칸', sum: '합계', avg: '평균', min: '최솟값', max: '최댓값' };
const NUMERIC_CALCS = ['sum', 'avg', 'min', 'max'];
export const calcOptions = field => Object.keys(CALCS).filter(k => field?.type === 'n' || !NUMERIC_CALCS.includes(k));
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
const toNumber = v => typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const fmt = n => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
// 결과는 표시용 문자열 (값이 없으면 '—'), 열 형식에 맞지 않는 계산은 null
export function calculate(kind, field, rows, value = (row, f) => row.cells[f.id]) {
  if (!field || !calcOptions(field).includes(kind)) return null;
  const values = rows.map(r => value(r, field));
  if (kind === 'count') return fmt(rows.length);
  if (kind === 'empty') return fmt(values.filter(isEmpty).length);
  if (kind === 'filled') return fmt(values.filter(v => !isEmpty(v)).length);
  const nums = values.flatMap(v => list(v).map(toNumber)).filter(n => n !== null);
  if (!nums.length) return '—';
  const sum = nums.reduce((a, b) => a + b, 0);
  return fmt({ sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) }[kind]);
}
