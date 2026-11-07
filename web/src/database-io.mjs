// 데이터베이스 내보내기(CSV·HTML)와 CSV 가져오기 — 화면과 무관한 순수 함수 (테스트: test/database-io.test.mjs)
// 원본 Confluence 기능 대응: ••• → 내보내기(CSV/HTML/PDF, '현재 보기 적용') / 템플릿 및 가져오기(CSV: 새 필드 · 기존 필드에 추가 · 전체 교체)
import { list, plain, cellText, viewRows } from './database-model.mjs';

// UUID — http(비보안 연결)에서는 crypto.randomUUID가 없어 getRandomValues로 만든다
export function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- 내보내기 ----------

// 칸 글자: 사용자·링크·Jira 이슈 등도 사람이 읽는 글자로
export function exportText(field, value, users = {}) {
  if (!field) return '';
  const vs = list(value);
  switch (field.type) {
    case 'u': return vs.map((v) => users[v?.a ?? v?.id ?? v]?.display_name ?? v?.d ?? plain(v)).join(', ');
    case 'h': return vs.map((v) => v?.u ?? plain(v)).join(', ');
    case 'ji': return vs.map((v) => v?.k ?? plain(v)).join(', ');
    case 'pl': return vs.map((v) => v?.title ?? v?.n ?? plain(v)).join(', ');
    case 'i': return vs.map((v) => v?.name ?? v?.n ?? '첨부').join(', ');
    default: return cellText(field, value);
  }
}

// useView: 현재 보기의 필터·정렬·숨긴 열·검색 반영 / 아니면 전체 데이터를 표 형태로
export function exportTable(data, view, { useView = true, value = (r, f) => r.cells[f.id], search = '', users = {} } = {}) {
  const fields = useView ? data.fields.filter((f) => !(view?.hiddenFields ?? []).includes(f.id)) : data.fields;
  let rows = useView ? viewRows(data, view, value) : data.rows;
  if (useView && search) rows = searchRows(rows, data.fields, search, value, users);
  return { header: fields.map((f) => f.name), body: rows.map((r) => fields.map((f) => exportText(f, value(r, f), users))) };
}

export function searchRows(rows, fields, search, value = (r, f) => r.cells[f.id], users = {}) {
  const q = String(search).trim().toLocaleLowerCase();
  if (!q) return rows;
  return rows.filter((r) => fields.some((f) => exportText(f, value(r, f), users).toLocaleLowerCase().includes(q)));
}

// RFC 4180 + 엑셀이 한글을 깨뜨리지 않게 BOM
export function toCsv({ header, body }) {
  const q = (s) => { const t = String(s ?? ''); return /[",\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return '﻿' + [header, ...body].map((row) => row.map(q).join(',')).join('\r\n') + '\r\n';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toHtml(title, { header, body }, { print = false } = {}) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:24px;color:#172b4d}h1{font-size:20px}
table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #c1c7d0;padding:6px 8px;text-align:left;vertical-align:top;white-space:pre-wrap}
th{background:#f4f5f7}${print ? '@page{size:landscape;margin:12mm}body{margin:0}' : ''}</style></head>
<body><h1>${esc(title)}</h1><table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('\n')}</tbody></table>
<p style="color:#6b778c;font-size:11px">${body.length}개 항목</p></body></html>`;
}

export const safeFileName = (s) => (String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'database').slice(0, 80);

// ---------- CSV 읽기 ----------

export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// 첫 줄 = 머리글 (빈 이름은 '필드 n', 겹치면 '이름 (2)')
export function csvTable(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { headers: [], rows: [] };
  const width = Math.max(...rows.map((r) => r.length));
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, i) => {
    let name = (rows[0][i] ?? '').trim() || `필드 ${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1; seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
  return { headers, rows: rows.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim())) };
}

// 형식 자동 감지: 숫자 · 링크 · 태그(값이 많이 겹침) · 나머지 텍스트 (날짜는 감지하지 않음 — 원본과 같음)
const TAG_SPLIT = /\s*[,;]\s*/;
export function inferType(values) {
  const vs = values.filter((v) => v !== '');
  if (!vs.length) return 't';
  if (vs.every((v) => /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, '')))) return 'n';
  if (vs.every((v) => v.split(TAG_SPLIT).every((u) => /^https?:\/\/\S+$/.test(u)))) return 'h';
  // 태그: 값의 절반 이상이 다른 행과 겹치고, 종류가 너무 많거나 길지 않을 때
  const parts = vs.flatMap((v) => v.split(TAG_SPLIT)).filter(Boolean);
  const count = new Map(); for (const p of parts) count.set(p, (count.get(p) ?? 0) + 1);
  const repeated = parts.filter((p) => count.get(p) > 1).length;
  if (vs.length >= 4 && repeated >= parts.length * 0.5 && count.size <= 60 && [...count.keys()].every((u) => u.length <= 40)) return 's';
  return 't';
}

const COLORS = ['blue', 'green', 'yellow', 'purple', 'teal', 'orange', 'red', 'magenta', 'lime', 'grey'];

// 글자 → 필드 형식에 맞는 값 (선택지는 없으면 만든다 — field를 직접 바꾼다)
export function convertValue(field, raw, newId) {
  const v = String(raw ?? '').trim();
  if (!v) return undefined;
  switch (field.type) {
    case 'n': { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; }
    case 'h': return v.split(TAG_SPLIT).filter((u) => /^https?:\/\//.test(u)).map((u) => ({ u }));
    case 'ji': return v.split(TAG_SPLIT).filter((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k)).map((k) => ({ k }));
    case 'd': return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;
    case 's': {
      field.options ??= [];
      return v.split(TAG_SPLIT).filter(Boolean).map((label) => {
        let o = field.options.find((x) => x.label === label);
        if (!o) { o = { id: newId(), label, color: COLORS[field.options.length % COLORS.length] }; field.options.push(o); }
        return o.id;
      });
    }
    case 't': return v;
    default: return undefined; // 사용자·문서 링크·파일·Jira 필드는 CSV 글자로 만들 수 없다
  }
}
export const IMPORTABLE = ['t', 'n', 'd', 's', 'h', 'ji'];

// mode: 'replace'(전체 교체) | 'newFields'(새 필드로 오른쪽·아래에 추가) | 'append'(기존 필드에 맞춰 행 추가, mapping: CSV 열 → 필드 id|'')
// data를 바꾸지 않고 새 데이터를 돌려준다
export function importCsv(data, table, mode, { mapping = [], newId = uid } = {}) {
  const d = structuredClone(data ?? { fields: [], rows: [], views: [] });
  d.fields ??= []; d.rows ??= []; d.views ??= [];
  const makeFields = () => table.headers.map((name, i) => ({ id: newId(), name, type: inferType(table.rows.map((r) => r[i])), options: [] }));
  const fill = (row, fields, csvRow) => fields.forEach((f, i) => { if (!f) return; const v = convertValue(f, csvRow[i], newId); if (v !== undefined) row.cells[f.id] = v; });

  if (mode === 'replace') {
    d.fields = makeFields();
    d.rows = table.rows.map((r) => { const row = { id: newId(), cells: {} }; fill(row, d.fields, r); return row; });
    const ids = new Set(d.fields.map((f) => f.id));
    d.views = d.views.length ? d.views : [{ id: newId(), name: '모든 항목', type: 'table', hiddenFields: [], sort: [], filter: null, groupBy: null }];
    for (const v of d.views) Object.assign(v, { hiddenFields: [], sort: [], filter: null, groupBy: null, coverField: ids.has(v.coverField) ? v.coverField : null });
  } else if (mode === 'newFields') {
    const added = makeFields();
    d.fields.push(...added);
    table.rows.forEach((r, i) => {
      let row = d.rows[i];
      if (!row) { row = { id: newId(), cells: {} }; d.rows.push(row); }
      fill(row, added, r);
    });
  } else if (mode === 'append') {
    const target = table.headers.map((_, i) => d.fields.find((f) => f.id === mapping[i] && IMPORTABLE.includes(f.type)) ?? null);
    for (const r of table.rows) { const row = { id: newId(), cells: {} }; fill(row, target, r); d.rows.push(row); }
  } else throw new Error(`알 수 없는 가져오기 방식: ${mode}`);
  return d;
}

// 머리글 이름이 같은 필드로 처음 연결을 추천
export function suggestMapping(data, headers) {
  return headers.map((h) => data.fields.find((f) => IMPORTABLE.includes(f.type) && f.name.trim().toLocaleLowerCase() === h.trim().toLocaleLowerCase())?.id ?? '');
}
