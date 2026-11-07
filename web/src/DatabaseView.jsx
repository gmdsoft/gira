import { CellEditor, DatabaseTools, newId } from './DatabaseEditor.jsx';
import MenuButton from './MenuButton.jsx';
import { ExportDialog, ImportDialog } from './DatabaseIO.jsx';
import { searchRows } from './database-io.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { hydrateIssueCard } from './issue-card.js';
import { list, plain, cellText, viewRows, databaseValue, CALCS, calcOptions, calculate } from './database-model.mjs';
import './database.css';
import './whiteboard-ui.css';
import { WbIcon } from './whiteboard-icons.jsx';

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
    return <span key={i} className="database-tag" style={{ '--tag': colors[o?.color?.replace(/Light|Dark/, '')] ?? colors.grey }}>{o?.label ?? plain(id)}</span>;
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
  const [data, setData] = useState(page.data);
  const [editing, setEditing] = useState(false);
  const [activeCell, setActiveCell] = useState(null);
  const [status, setStatus] = useState('저장됨');
  const [statusNote, setStatusNote] = useState('');
  useEffect(() => { if (!statusNote) return undefined; const t = setTimeout(() => setStatusNote(''), 2500); return () => clearTimeout(t); }, [statusNote]);
  const [history, setHistory] = useState(null); // null = 닫힘, 'loading' | 'error' | 버전 배열
  const version = useRef(page.currentVersion ?? page.version?.version);
  const saved = useRef(page.data);
  const latest = useRef(data);
  const saving = useRef(false);
  const blocked = useRef(false);
  const timer = useRef();
  const change = fn => setData(old => { const next = structuredClone(old); fn(next); return next; });
  const flush = async () => {
    if (saving.current || blocked.current || latest.current === saved.current) return;
    saving.current = true;
    const snapshot = latest.current;
    setStatus('저장 중…');
    try {
      const r = await fetch(`/api/content/${page.id}/database`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({baseVersion:version.current,data:snapshot}) });
      const result = await r.json();
      if (r.status === 409) { blocked.current = true; setStatus('버전 충돌: 변경 사항을 확인한 뒤 다시 불러오세요'); return; }
      if (!r.ok) throw new Error(result.error ?? '저장 실패');
      version.current = result.version; saved.current = snapshot;
      setStatus('저장됨');
    } catch (e) { blocked.current = true; setStatus(e.message); }
    finally { saving.current = false; if (!blocked.current && latest.current !== saved.current) timer.current = setTimeout(flush, 800); }
  };
  useEffect(() => {
    latest.current = data;
    if (data !== saved.current) { if (!blocked.current) setStatus('저장 대기…'); clearTimeout(timer.current); timer.current = setTimeout(flush, 800); }
    return () => clearTimeout(timer.current);
  }, [data]);
  useEffect(() => {
    const warn = e => { if (latest.current !== saved.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const rowTools = r => editing && <div className="database-row-tools">{[-1,1].map(step => <button key={step} aria-label={step < 0 ? '행 위로' : '행 아래로'} onClick={() => change(d => { const i = d.rows.findIndex(x => x.id === r.id), j = i + step; if (j >= 0 && j < d.rows.length) [d.rows[i],d.rows[j]] = [d.rows[j],d.rows[i]]; })}>{step < 0 ? '↑' : '↓'}</button>)}<button onClick={() => { if (confirm('행을 삭제할까요?')) change(d => { d.rows = d.rows.filter(x => x.id !== r.id); }); }}>행 삭제</button></div>;
  // 보기 링크(?view=…)로 들어오면 그 보기부터
  const [tab, setTab] = useState(() => (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('view')));
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null); // 'export' | 'import'
  // 설정: 항목 번호 표시 (이 브라우저에 문서별로 저장)
  const numKey = `gonf.db.numbers.${page.id}`;
  const [showNumbers, setShowNumbers] = useState(() => { try { return localStorage.getItem(numKey) === '1'; } catch { return false; } });
  const toggleNumbers = () => setShowNumbers((v) => { try { localStorage.setItem(numKey, v ? '0' : '1'); } catch { /* 무시 */ } return !v; });
  // 계산 줄 선택: 편집 권한이 있으면 보기 설정(view.calculations)에, 없으면 이 브라우저에 문서·보기별로 저장
  const [, setCalcTick] = useState(0);
  const calcKey = viewId => `gonf.db.calc.${page.id}.${viewId}`;
  const [issues, setIssues] = useState({});
  const [users, setUsers] = useState({});
  const issueKeys = new Set(), accountKeys = new Set();
  for (const r of data?.rows ?? []) for (const f of data.fields) {
    if (f.type === 'ji') for (const v of list(r.cells[f.id])) issueKeys.add(v.k ?? plain(v));
    if (f.type === 'u') for (const v of list(r.cells[f.id])) accountKeys.add(v.a ?? v.id ?? v);
  }
  const lookupKey = JSON.stringify([[...issueKeys], [...accountKeys]]);
  useEffect(() => {
    const controller = new AbortController();
    const [keys, accounts] = JSON.parse(lookupKey);
    const get = async (path) => { const r = await fetch(path, { signal: controller.signal, cache: 'no-store' }); if (!r.ok) throw new Error(); return r.json(); };
    for (const k of keys) get(`/api/gira/issues/${encodeURIComponent(k)}`).then(v => setIssues(old => ({ ...old, [k]: v }))).catch(() => {});
    for (const k of accounts) get(`/api/users/${encodeURIComponent(k)}`).then(v => setUsers(old => ({ ...old, [k]: v }))).catch(() => {});
    return () => controller.abort();
  }, [lookupKey]);
  if (!data) return <article className="page"><h1>{page.title}</h1><p>데이터베이스 스냅샷이 없습니다. 다시 이관해 주세요.</p></article>;
  const view = data.views.find(v => v.id === tab) ?? data.views[0] ?? { type: 'table', hiddenFields: [] };
  const fields = data.fields.filter(f => !view.hiddenFields.includes(f.id));
  const value = (row, f) => databaseValue(row, f, issues);
  const rows = searchRows(viewRows(data, view, value), fields, search, value, users);
  const cell = (r, f) => {
    if (!f) return null;
    const key = `${r.id}:${f.id}`;
    if (editing && activeCell === key && !['i','jid'].includes(f.type)) return <CellEditor key={key} field={f} value={r.cells[f.id]} onChange={v => change(d => { d.rows.find(x => x.id === r.id).cells[f.id] = v; })} />;
    return <div tabIndex={editing ? 0 : undefined} role={editing ? 'button' : undefined} onClick={() => editing && setActiveCell(key)} onKeyDown={e => e.key === 'Enter' && setActiveCell(key)}><Cell field={f} value={value(r, f)} users={users} spaceKey={page.spaceKey} />{editing && !value(r,f) && <small>셀 편집</small>}</div>;
  };
  const card = r => <article className="database-card" key={r.id}>{rowTools(r)}{view.coverField && <div className="database-cover">{cell(r, data.fields.find(f => f.id === view.coverField))}</div>}{fields.map(f => <div key={f.id}><small>{f.name}</small><div>{cell(r, f)}</div></div>)}</article>;
  const group = data.fields.find(f => f.id === view.groupBy);
  const groups = group ? [...group.options.map(o => ({ id: o.id, label: o.label })), { id: null, label: '그룹 없음' }] : [{ id: null, label: '모든 항목' }];
  // 보기 메뉴 (원본 보기 탭 메뉴: 이름 바꾸기 · 형식 바꾸기 · 링크 복사 · 복제 · 이동 · 삭제)
  const edit = !!page.canEdit;
  const updateView = (patch) => change(d => Object.assign(d.views.find(v => v.id === view.id), patch));
  const moveView = (step) => change(d => { const i = d.views.findIndex(v => v.id === view.id), j = i + step; if (j >= 0 && j < d.views.length) [d.views[i], d.views[j]] = [d.views[j], d.views[i]]; });
  const viewIndex = data.views.findIndex(v => v.id === view.id);
  const viewItems = [
    { label: '이름 바꾸기', icon: 'pencil', disabled: !edit, onClick: () => { const n = prompt('보기 이름', view.name); if (n?.trim()) updateView({ name: n.trim() }); } },
    { heading: '형식' },
    ...[['table', '표'], ['card', '카드'], ['board', '보드']].map(([t, l]) => ({ label: `${view.type === t ? '✓ ' : '\u2003'}${l}`, disabled: !edit || view.type === t, onClick: () => updateView({ type: t }) })),
    '-',
    { label: '보기 링크 복사', icon: 'link', onClick: () => { const u = new URL(location.href); u.searchParams.set('view', view.id); navigator.clipboard?.writeText(u.toString()).then(() => setStatusNote('보기 링크를 복사했습니다'), () => prompt('보기 링크', u.toString())); } },
    { label: '보기 복제', disabled: !edit, onClick: () => { const id = newId(); change(d => { const src = d.views.find(v => v.id === view.id); d.views.splice(d.views.indexOf(src) + 1, 0, { ...structuredClone(src), id, name: `${src.name} 복사본` }); }); setTab(id); } },
    { label: '왼쪽으로 이동', disabled: !edit || viewIndex <= 0, onClick: () => moveView(-1) },
    { label: '오른쪽으로 이동', disabled: !edit || viewIndex >= data.views.length - 1, onClick: () => moveView(1) },
    '-',
    { label: '보기 삭제', danger: true, disabled: !edit || data.views.length <= 1, onClick: () => { if (confirm(`'${view.name}' 보기를 삭제할까요? (데이터는 지워지지 않습니다)`)) { change(d => { d.views = d.views.filter(v => v.id !== view.id); }); setTab(null); } } },
  ];
  const localCalcs = () => { try { return JSON.parse(localStorage.getItem(calcKey(view.id))) ?? {}; } catch { return {}; } };
  const calcs = edit ? (view.calculations ?? {}) : { ...(view.calculations ?? {}), ...localCalcs() };
  const setCalc = (fieldId, kind) => {
    const next = { ...calcs }; if (kind) next[fieldId] = kind; else delete next[fieldId];
    if (edit) { updateView({ calculations: next }); return; }
    try { localStorage.setItem(calcKey(view.id), JSON.stringify(next)); } catch { /* 무시 */ }
    setCalcTick(t => t + 1);
  };
  const calcCell = f => {
    const kind = calcOptions(f).includes(calcs[f.id]) ? calcs[f.id] : '';
    const result = kind ? calculate(kind, f, rows, value) : null;
    return <td key={f.id} className="database-calc"><label><select aria-label={`${f.name} 계산`} value={kind} onChange={e => setCalc(f.id, e.target.value)}><option value="">{kind ? '계산 없음' : '계산'}</option>{calcOptions(f).map(k => <option key={k} value={k}>{CALCS[k]}</option>)}</select>{result != null && <b>{result}</b>}</label></td>;
  };
  const addView = () => { const name = prompt('보기 이름'); if (!name?.trim()) return; const id = newId(); change(d => d.views.push({ id, name: name.trim(), type: 'table', hiddenFields: [], sort: [], filter: null, groupBy: null })); setTab(id); };
  const kind = status === '저장됨' ? 'saved' : status === '저장 중…' ? 'busy' : status === '저장 대기…' ? 'dirty' : 'error';
  const reload = async () => {
    if (!confirm('저장하지 않은 변경을 버리고 다시 불러올까요?')) return;
    const r = await fetch(`/api/content/${page.id}`); if (!r.ok) { setStatus('다시 불러오기 실패'); return; }
    const p = await r.json(); version.current = p.currentVersion; saved.current = p.data; blocked.current = false; setData(p.data); setActiveCell(null); setStatus('저장됨');
  };
  const toggleHistory = async () => {
    if (history) { setHistory(null); return; }
    setHistory('loading');
    try { const r = await fetch(`/api/content/${page.id}/versions`); setHistory(r.ok ? await r.json() : 'error'); } catch { setHistory('error'); }
  };
  return <article className="page page-full database-view"><h1>🗄️ {page.title}</h1>
    <div className="wb-frame database-frame">
    <div className="wb-toolbar">
      <div className="wb-left">
        {editing ? <span className="wb-badge is-edit"><WbIcon name="pencil" />편집 중</span>
          : <span className="wb-badge"><WbIcon name="board" />{page.canEdit ? '데이터베이스' : '읽기 전용 — 원본에서 이관됨'}</span>}
        {page.canEdit && <span role="status" className={`wb-status ${kind}`}>{status}</span>}
        <span className="wb-note">{statusNote || `${rows.length}개 항목${search ? ' (검색)' : ''} · ${fields.length}개 열`}</span>
      </div>
      <div className="wb-right">
        {blocked.current && <>
          <button className="wb-btn" onClick={() => { blocked.current = false; flush(); }}>저장 재시도</button>
          <button className="wb-btn" onClick={reload}>다시 불러오기</button>
        </>}
        <button className="wb-btn" aria-pressed={!!history} onClick={toggleHistory}><WbIcon name="history" /><span className="wb-label">변경 이력</span></button>
        <MenuButton label="더 보기" items={[
          { label: '내보내기 (CSV · HTML · PDF)', icon: 'download', onClick: () => setDialog('export') },
          { label: 'CSV 가져오기', icon: 'upload', disabled: !edit, hint: edit ? undefined : '편집 권한이 필요합니다', onClick: () => setDialog('import') },
          '-',
          { heading: '설정' },
          { label: `${showNumbers ? '✓ ' : '\u2003'}항목 번호 표시`, icon: 'settings', onClick: toggleNumbers },
        ]} />
        {page.canEdit && (editing
          ? <button className="wb-btn primary" onClick={() => { setEditing(false); setActiveCell(null); }}><WbIcon name="check" />편집 종료</button>
          : <button className="wb-btn primary" onClick={() => setEditing(true)}><WbIcon name="pencil" />편집</button>)}
      </div>
    </div>
    {history && <div className="database-history">
      {history === 'loading' ? <span className="muted">불러오는 중…</span>
        : history === 'error' ? <span className="muted">변경 이력을 불러오지 못했습니다.</span>
        : history.length ? history.map(v => <div key={v.version}><b>v{v.version}</b><span>{v.author_name ?? '알 수 없음'}</span><span className="muted">{new Date(v.created_at).toLocaleString()}</span><span>{v.message}</span></div>)
        : <span className="muted">이 화면에서 편집한 기록이 없습니다.</span>}
    </div>}
    {editing && <DatabaseTools data={data} view={view} change={change} setTab={setTab} />}
    <div className="database-tabs" role="tablist">
      {data.views.map(v => <span key={v.id} className={`database-tab${v.id === view.id ? ' on' : ''}`}>
        <button role="tab" aria-selected={v.id === view.id} onClick={() => setTab(v.id)}>{({ table: '▦', card: '▤', board: '▥' })[v.type]} {v.name}</button>
        {v.id === view.id && <MenuButton label="보기 메뉴" icon="chevron" className="database-tab-menu" align="left" items={viewItems} />}
      </span>)}
      {edit && <button className="database-tab-add" title="보기 추가" aria-label="보기 추가" onClick={addView}><WbIcon name="plus" /></button>}
      <span className="database-search"><WbIcon name="search" /><input type="search" placeholder="데이터베이스 검색" aria-label="데이터베이스 검색" value={search} onChange={e => setSearch(e.target.value)} /></span>
    </div>
    <div className="database-scroll">{view.type === 'table' ? <table><thead><tr>{showNumbers && <th className="database-num">#</th>}{editing && <th>행 관리</th>}{fields.map(f => <th key={f.id} style={{ minWidth: f.width ?? 160 }}>{f.name}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id}>{showNumbers && <td className="database-num">{i + 1}</td>}{editing && <td>{rowTools(r)}</td>}{fields.map(f => <td key={f.id}>{cell(r, f)}</td>)}</tr>)}</tbody><tfoot><tr>{showNumbers && <td className="database-num" />}{editing && <td />}{fields.map(calcCell)}</tr></tfoot></table>
      : view.type === 'board' ? <div className="database-board">{groups.map(g => <section key={g.id ?? 'empty'}><h3>{g.label}</h3>{rows.filter(r => !group || (g.id === null ? !list(value(r, group)).length : list(value(r, group)).includes(g.id))).map(card)}</section>)}</div>
      : <div className="database-gallery">{rows.map(card)}</div>}
      {!rows.length && <p className="muted database-empty">{search ? `'${search}'에 맞는 항목이 없습니다.` : '항목이 없습니다.'}</p>}</div>
    </div>
    {dialog === 'export' && <ExportDialog title={page.title} data={data} view={view} value={value} users={users} search={search} onClose={() => setDialog(null)} />}
    {dialog === 'import' && <ImportDialog data={data} onApply={(next) => { setData(next); setActiveCell(null); if (!next.views.some(v => v.id === tab)) setTab(null); }} onClose={() => setDialog(null)} />}
  </article>;
}
