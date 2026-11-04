// Jira SPA 공용: API 클라이언트 + 표시 헬퍼
import React from 'react';

export class AuthError extends Error {}

export async function api(path, opts = {}) {
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'content-type': 'application/json' }; }
  const res = await fetch(path, opts);
  if (res.status === 401) throw new AuthError('login required');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const msg = e.error ?? `오류 (${res.status})`;
    if (!opts.quiet) alert(msg); // quiet: 호출자가 직접 표시 (JQL 문법 오류 등)
    throw Object.assign(new Error(msg), { body: e });
  }
  return res.json();
}

export const dt = (s) => s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
export const fileSize = (n) => n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

// 우선순위 아이콘 (SVG — icons.jsx)
import { PrioIcon } from './icons.jsx';
export const PRIORITY_ORDER = { Highest: 0, High: 1, Normal: 2, Medium: 2, Low: 3, Lowest: 4 };
export function Prio({ p }) { return <PrioIcon p={p} />; }

const PALETTE = ['#0052cc', '#00875a', '#ff8b00', '#de350b', '#5243aa', '#00a3bf', '#403294', '#e56910', '#216e4e', '#943d73'];
export const hashColor = (s) => PALETTE[[...String(s ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

export function Avatar({ name }) {
  if (!name) return null;
  return <span className="av" style={{ background: hashColor(name) }} title={name}>{String(name).trim()[0] ?? '?'}</span>;
}

export function EpicBar({ r }) {
  if (!r.epic_id) return null;
  return <span className="epicbar" style={{ background: hashColor(r.epic_id) }} title={`${r.epic_key} ${r.epic_summary ?? ''}`} />;
}

// 상태 카테고리별 건수 요약 칩 (회색=할일, 파랑=진행, 초록=완료)
// catOf: 행 → 'new'|'indeterminate'|'done' (기본은 상태 카테고리; 백로그는 보드 컬럼 위치 기준으로 센다 — 실제 Jira와 동일)
export function CatChips({ rows, catOf = (r) => r.status_category }) {
  const c = { new: 0, indeterminate: 0, done: 0 };
  for (const r of rows) { const k = catOf(r); c[k] = (c[k] ?? 0) + 1; }
  return (
    <span className="catchips" title={`해야 할 일 ${c.new} · 진행 중 ${c.indeterminate} · 완료 ${c.done}`}>
      <span className="cat-new">{c.new}</span>
      <span className="cat-indeterminate">{c.indeterminate}</span>
      <span className="cat-done">{c.done}</span>
    </span>
  );
}

// 상태 변경 드롭다운 (색상 롯지) — 변경 후 blur: Windows Chrome이 포커스 유지 중 옵션 하이라이트(파란 칠)를 박스에 그대로 보여주는 것 방지
export function StatusSelect({ statuses, value, category, onChange, small }) {
  return (
    <select className={`tstatus cat-${category}${small ? '' : ' lg'}`}
      value={value ?? ''} onClick={(e) => e.stopPropagation()}
      onChange={(e) => { const id = Number(e.target.value); e.currentTarget.blur(); onChange(id); }}>
      {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
