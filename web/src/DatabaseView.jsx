import React, { useEffect, useRef, useState } from 'react';
import { hydrateIssueCard } from './issue-card.js';
import { list, plain, cellText, viewRows, databaseValue } from './database-model.mjs';
import './database.css';

const colors = { red: '#ffd5d2', blue: '#d4e4ff', green: '#c5f4dc', teal: '#c6eff5', purple: '#eddaff', magenta: '#f7d5ef', yellow: '#fff2a1', orange: '#ffe1b5', lime: '#ddf5ae', grey: '#eceef0' };
const safeUrl = url => /^(https?:\/\/|\/[^/])/.test(url ?? '') ? url : undefined;
function Issue({ issueKey }) {
  const ref = useRef();
  useEffect(() => hydrateIssueCard(ref.current), [issueKey]);
  return <span><a ref={ref} data-issue-key={issueKey} href={`/api/gira/issues/${encodeURIComponent(issueKey)}/open`}>{issueKey}</a></span>;
}
function Cell({ field, value, users, spaceKey }) {
  if (!field) return null;
  if (field.type === 's') return list(value).map((id, i) => {
    const o = field.options.find(o => o.id === id);
    return <span key={i} className="database-tag" style={{ background: colors[o?.color?.replace(/Light|Dark/, '')] ?? colors.grey }}>{o?.label ?? plain(id)}</span>;
  });
  if (field.type === 'ji') return list(value).map((v, i) => <Issue key={i} issueKey={v.k ?? plain(v)} />);
  if (field.type === 'h') return list(value).map((v, i) => <a key={i} href={safeUrl(v.u ?? v)} target="_blank" rel="noreferrer">{v.u ?? plain(v)}</a>);
  if (field.type === 'pl') return list(value).map((v, i) => <a key={i} href={`/s/${encodeURIComponent(spaceKey)}/p/${encodeURIComponent(v.c ?? v.p ?? v.id ?? v.i ?? v)}`}>{v.title ?? v.n ?? plain(v)}</a>);
  if (field.type === 'u') return list(value).map((v, i) => { const name = users[v.a ?? v.id ?? v]?.display_name ?? v.d ?? plain(v); return <span key={i}><span className="database-avatar">{name.slice(0, 1)}</span>{name} </span>; });
  // 파일 칸: 1차는 파일을 내려받지 않는다 — 내부 파일 id 대신 안내만 (이름이 있으면 이름)
  if (field.type === 'i') return list(value).map((v, i) => <span className="database-file" key={i} title="원본 파일 — 다운로드 이관 대기">📎 {v.name ?? v.n ?? '원본 첨부 (이관 대기)'}</span>);
  // Jira 필드: 연결 이슈가 Gira에 없으면(이관 안 된 프로젝트) 빈칸 대신 표시
  if (field.type === 'jid' && !list(value).length) return <span className="muted" title="연결된 Jira 이슈가 Gira에 없음(이관되지 않은 프로젝트) 또는 불러오는 중">—</span>;
  return cellText(field, value);
}
export default function DatabaseView({ page }) {
  const data = page.data;
  const [tab, setTab] = useState(null);
  const [issues, setIssues] = useState({});
  const [users, setUsers] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    const keys = new Set(), accounts = new Set();
    for (const r of data?.rows ?? []) for (const f of data.fields) {
      if (f.type === 'ji') for (const v of list(r.cells[f.id])) keys.add(v.k ?? plain(v));
      if (f.type === 'u') for (const v of list(r.cells[f.id])) accounts.add(v.a ?? v.id ?? v);
    }
    const get = async (path) => { const r = await fetch(path, { signal: controller.signal, cache: 'no-store' }); if (!r.ok) throw new Error(); return r.json(); };
    for (const k of keys) get(`/api/gira/issues/${encodeURIComponent(k)}`).then(v => setIssues(old => ({ ...old, [k]: v }))).catch(() => {});
    for (const k of accounts) get(`/api/users/${encodeURIComponent(k)}`).then(v => setUsers(old => ({ ...old, [k]: v }))).catch(() => {});
    return () => controller.abort();
  }, [data]);
  if (!data) return <article className="page"><h1>{page.title}</h1><p>데이터베이스 스냅샷이 없습니다. 다시 이관해 주세요.</p></article>;
  const view = data.views.find(v => v.id === tab) ?? data.views[0] ?? { type: 'table', hiddenFields: [] };
  const fields = data.fields.filter(f => !view.hiddenFields.includes(f.id));
  const value = (row, f) => databaseValue(row, f, issues);
  const rows = viewRows(data, view, value);
  const cell = (r, f) => <Cell field={f} value={value(r, f)} users={users} spaceKey={page.spaceKey} />;
  const card = r => <article className="database-card" key={r.id}>{view.coverField && <div className="database-cover">{cell(r, data.fields.find(f => f.id === view.coverField))}</div>}{fields.map(f => <div key={f.id}><small>{f.name}</small><div>{cell(r, f)}</div></div>)}</article>;
  const group = data.fields.find(f => f.id === view.groupBy);
  const groups = group ? [...group.options.map(o => ({ id: o.id, label: o.label })), { id: null, label: '그룹 없음' }] : [{ id: null, label: '모든 항목' }];
  return <article className="page page-full database-view"><h1>🗄️ {page.title}</h1><p className="muted">읽기 전용 — 원본에서 이관됨 · 편집은 원본에서 진행해 주세요.</p>
    <div className="database-tabs" role="tablist">{data.views.map(v => <button role="tab" aria-selected={v.id === view.id} key={v.id} onClick={() => setTab(v.id)}>{({ table: '▦', card: '▤', board: '▥' })[v.type]} {v.name}</button>)}</div>
    <div className="database-scroll">{view.type === 'table' ? <table><thead><tr>{fields.map(f => <th key={f.id} style={{ minWidth: f.width ?? 160 }}>{f.name}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id}>{fields.map(f => <td key={f.id}>{cell(r, f)}</td>)}</tr>)}</tbody></table>
      : view.type === 'board' ? <div className="database-board">{groups.map(g => <section key={g.id ?? 'empty'}><h3>{g.label}</h3>{rows.filter(r => !group || (g.id === null ? !list(value(r, group)).length : list(value(r, group)).includes(g.id))).map(card)}</section>)}</div>
      : <div className="database-gallery">{rows.map(card)}</div>}</div><p className="muted">{rows.length}개 항목 · {fields.length}개 열</p>
  </article>;
}
