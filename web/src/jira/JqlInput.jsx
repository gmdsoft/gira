// JQL 입력창 + 문맥 자동완성 (필드 → 연산자 → 값 → AND/OR/ORDER BY)
import React, { useMemo, useRef, useState } from 'react';

const FIELD_DEFS = [
  ['project', 'plain'], ['key', 'key'], ['summary', 'text'], ['text', 'search'], ['status', 'plain'],
  ['statusCategory', 'plain'],
  ['type', 'plain'], ['assignee', 'user'], ['reporter', 'user'], ['priority', 'plain'], ['resolution', 'plain'],
  ['sprint', 'sprint'], ['labels', 'array'], ['fixVersion', 'array'], ['component', 'array'], ['parent', 'parent'],
  ['created', 'date'], ['updated', 'date'], ['resolved', 'date'],
];
const KIND_OF = Object.fromEntries(FIELD_DEFS.map(([n, k]) => [n.toLowerCase(), k]));
const CANON = Object.fromEntries(FIELD_DEFS.map(([n]) => [n.toLowerCase(), n]));
const ORDER_FIELDS = ['updated', 'created', 'priority', 'key', 'status', 'summary', 'assignee', 'reporter', 'type', 'resolution'];
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'order', 'by', 'empty', 'null', 'asc', 'desc']);

const OPS_BY_KIND = {
  plain: ['=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  text: ['~', '=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  search: ['~'],
  user: ['=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  sprint: ['=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  array: ['=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  parent: ['=', '!=', 'IN', 'IS EMPTY', 'IS NOT EMPTY'],
  date: ['>=', '<=', '>', '<', '=', '!=', 'IS EMPTY', 'IS NOT EMPTY'],
  key: ['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT IN'],
};

// ---------- 간이 토크나이저 (서버 파서와 동일한 경계 규칙) ----------
function toks(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const pos = i;
    if ('(),'.includes(c)) { out.push({ t: c, v: c, pos, end: i + 1 }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      const closed = j < src.length;
      out.push({ t: 'str', v: src.slice(i + 1, j), pos, end: closed ? j + 1 : src.length, closed });
      i = closed ? j + 1 : src.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['!=', '>=', '<='].includes(two)) { out.push({ t: 'op', v: two, pos, end: i + 2 }); i += 2; continue; }
    if ('=~><'.includes(c)) { out.push({ t: 'op', v: c, pos, end: i + 1 }); i++; continue; }
    let j = i;
    while (j < src.length && !/[\s(),=~><!"']/.test(src[j])) j++;
    out.push({ t: 'w', v: src.slice(i, j), pos, end: j });
    i = j;
  }
  return out;
}

const needQuote = (s) => /[\s(),=~><!"']/.test(s) || s === '';
const quoted = (s) => needQuote(s) ? `"${String(s).replace(/"/g, '')}"` : s;

// 값 제안 (필드별)
function valueItems(fieldLower, meta, pdata) {
  const wrap = (arr, tag) => (arr ?? []).map((v) => ({ label: v, insert: quoted(v), tag }));
  const fn = (name) => ({ label: name, insert: name, tag: '함수' });
  const empty = { label: 'EMPTY', insert: 'EMPTY', tag: '' };
  switch (fieldLower) {
    case 'status': return wrap(meta.statuses.map((s) => s.name), '상태');
    case 'statuscategory': return wrap(['new', 'indeterminate', 'done'], '상태 분류');
    case 'type': case 'issuetype': return wrap(meta.types.map((t) => t.name), '타입');
    case 'assignee': case 'reporter':
      return [fn('currentUser()'), empty, ...wrap(meta.assignees.map((u) => u.display_name), '사용자')];
    case 'priority': return wrap(meta.priorities, '우선순위');
    case 'resolution': return [empty, ...wrap(meta.resolutions, '해결')];
    case 'sprint': return [fn('openSprints()'), empty, ...wrap(pdata.sprints.map((s) => s.name), '스프린트')];
    case 'labels': case 'label': return wrap(pdata.labels, '레이블');
    case 'fixversion': return wrap((pdata.versions ?? []).map((v) => v.name), '버전');
    case 'component': return wrap(pdata.components, '컴포넌트');
    case 'project': return wrap(meta.projects.map((p) => p.key), '프로젝트');
    case 'created': case 'updated': case 'resolved':
      return ['-1d', '-7d', '-30d', '-12w'].map((v) => ({ label: v, insert: v, tag: '상대 날짜' }));
    default: return [];
  }
}

// 커서 앞 텍스트로 제안 문맥 계산 → { items, partial, partialStart }
function suggest(text, cursor, meta, pdata) {
  const before = text.slice(0, cursor);
  const ts = toks(before);
  let partial = '', partialStart = cursor, partialIsStr = false;
  const last = ts[ts.length - 1];
  if (last && last.end >= before.length && (last.t === 'w' || (last.t === 'str' && !last.closed))) {
    partial = last.v; partialStart = last.pos; partialIsStr = last.t === 'str';
    ts.pop();
  }
  const T = (n) => ts[ts.length - n];
  const isW = (t, v) => t && t.t === 'w' && t.v.toLowerCase() === v;
  const fieldOf = (t) => (t && t.t === 'w' && KIND_OF[t.v.toLowerCase()]) ? t.v.toLowerCase() : null;
  const kw = (items, tag) => items.map((v) => ({ label: v, insert: v, tag: tag ?? '' }));
  const a = T(1), b = T(2), c = T(3);

  const fieldItems = () => [...FIELD_DEFS.map(([n]) => ({ label: n, insert: n, tag: '필드' })), { label: 'NOT', insert: 'NOT', tag: '' }];
  const done = (items) => ({ items, partial, partialStart, partialIsStr });

  // ORDER BY 꼬리
  if (isW(a, 'order')) return done(kw(['BY']));
  if (isW(b, 'order') && isW(a, 'by')) return done(ORDER_FIELDS.map((f) => ({ label: f, insert: CANON[f] ?? f, tag: '정렬' })));
  if (isW(c, 'order') && isW(b, 'by') && a?.t === 'w') return done(kw(['DESC', 'ASC']));

  // IN (...) 리스트 내부인가? (미닫힘 '(' 바로 앞이 IN)
  let depth = 0, openIdx = -1;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (ts[i].t === ')') depth++;
    else if (ts[i].t === '(') { if (depth === 0) { openIdx = i; break; } depth--; }
  }
  if (openIdx > 0 && isW(ts[openIdx - 1], 'in')) {
    const ft = isW(ts[openIdx - 2], 'not') ? ts[openIdx - 3] : ts[openIdx - 2];
    const f = fieldOf(ft);
    if (f && (a?.t === '(' || a?.t === ',')) return done(valueItems(f, meta, pdata));
    return done([]); // 값 뒤: ',' 또는 ')' 직접 입력
  }

  // 식의 시작 (처음 / AND / OR / NOT / 그룹 '(')
  if (!a || isW(a, 'and') || isW(a, 'or') || a.t === '(') return done(fieldItems());
  if (isW(a, 'not') && (!b || isW(b, 'and') || isW(b, 'or') || b.t === '(')) return done(fieldItems());

  // 필드 뒤 → 연산자
  const af = fieldOf(a);
  if (af) return done(kw(OPS_BY_KIND[KIND_OF[af]] ?? [], '연산자'));

  // IS [NOT]
  if (isW(a, 'is')) return done(kw(['EMPTY', 'NOT EMPTY']));
  if (isW(a, 'not') && isW(b, 'is')) return done(kw(['EMPTY']));

  // 연산자 뒤 → 값
  if (a.t === 'op' && fieldOf(b)) return done(valueItems(fieldOf(b), meta, pdata));
  // IN 직후 ('(' 또는 함수)
  if (isW(a, 'in')) {
    const ft = isW(b, 'not') ? c : b;
    const f = fieldOf(ft);
    const fns = f ? valueItems(f, meta, pdata).filter((x) => x.tag === '함수') : [];
    return done([{ label: '(', insert: '(', tag: '' }, ...fns]);
  }
  if (isW(a, 'not') && fieldOf(b)) return done(kw(['IN']));

  // 값/')' 뒤 → 논리 연결
  const isValue = a.t === 'str' || (a.t === 'w' && !KEYWORDS.has(a.v.toLowerCase()) && !fieldOf(a)) || a.t === ')';
  if (isValue || isW(a, 'empty') || isW(a, 'null')) return done(kw(['AND', 'OR', 'ORDER BY']));
  return done([]);
}

export default function JqlInput({ value, onChange, onApply, meta, pdata, placeholder }) {
  const inputRef = useRef(null);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const sug = useMemo(() => {
    const s = suggest(value, cursor, meta, pdata);
    const q = s.partial.toLowerCase();
    const items = s.items.filter((it) => !q
      || it.label.toLowerCase().startsWith(q)
      || (s.partialIsStr && it.label.toLowerCase().includes(q)));
    return { ...s, items: items.slice(0, 12) };
  }, [value, cursor, meta, pdata]);

  const sync = () => { const el = inputRef.current; if (el) setCursor(el.selectionStart ?? el.value.length); };
  const insert = (item) => {
    const el = inputRef.current;
    const head = value.slice(0, sug.partialStart);
    const tail = value.slice(cursor);
    const ins = item.insert + (item.insert === '(' ? '' : ' ');
    const next = head + ins + tail;
    onChange(next);
    const pos = (head + ins).length;
    setCursor(pos); setActive(0);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };

  const onKeyDown = (e) => {
    const n = sug.items.length;
    if (open && n > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % n); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + n) % n); return; }
      if (e.key === 'Tab') { e.preventDefault(); insert(sug.items[Math.min(active, n - 1)]); return; }
      if (e.key === 'Enter') { e.preventDefault(); insert(sug.items[Math.min(active, n - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
    if (e.key === 'Enter') { setOpen(false); onApply(value); }
  };

  return (
    <span className="jqlwrap">
      <input ref={inputRef} className="jqlinput" spellCheck={false} value={value} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); sync(); }}
        onKeyDown={onKeyDown}
        onKeyUp={sync} onClick={() => { sync(); setOpen(true); }} onFocus={() => { sync(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && sug.items.length > 0 && (
        <div className="jqlsug">
          {sug.items.map((it, i) => (
            <div key={it.label + i} className={`jqlsug-item${i === active ? ' on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insert(it); }}
              onMouseEnter={() => setActive(i)}>
              <span>{it.label}</span>
              {it.tag && <span className="dim">{it.tag}</span>}
            </div>))}
        </div>
      )}
    </span>
  );
}
