// Jira PoC SPA 셸: 인증 게이트 → 헤더(프로젝트·탭·만들기) + 필터바 + 뷰 + URL 라우팅
import React, { useEffect, useRef, useState } from 'react';
import { api, AuthError } from './util.jsx';
import { ListView, TableView, BoardView, BacklogView } from './views.jsx';
import { LoginGate, NewIssueModal } from './modals.jsx';

const VIEWS = ['list', 'table', 'board', 'backlog'];
const VIEW_NAMES = { list: '목록', table: '전체 목록', board: '보드', backlog: '백로그' };
const EMPTY_FILTERS = { status: '', type: '', assignee: '', priority: '', sprint: '', q: '', group: '' };

function parseRoute(projects) {
  const m1 = location.pathname.match(/^\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)$/);
  if (m1) {
    const key = m1[1].toUpperCase();
    const pkey = key.split('-')[0];
    if (projects.some((p) => p.key === pkey)) return { project: pkey, view: 'list', selKey: key };
  }
  const m2 = location.pathname.match(/^\/projects\/([^/]+)\/(list|table|board|backlog)$/);
  if (m2) {
    const pkey = decodeURIComponent(m2[1]);
    if (projects.some((p) => p.key === pkey)) return { project: pkey, view: m2[2], selKey: null };
  }
  return null;
}

export default function JiraApp() {
  const [authed, setAuthed] = useState(null);   // null=확인 중, false=로그인 필요, true=완료
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [project, setProject] = useState('');
  const [pdata, setPdata] = useState({ sprints: [], versions: [], boards: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [savedFilters, setSavedFilters] = useState([]);
  const [savedSel, setSavedSel] = useState('');
  const [view, setView] = useState('list');
  const [selKey, setSelKey] = useState(null);
  const [count, setCount] = useState(0);
  const [bump, setBump] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const qTimer = useRef(null);
  const [qInput, setQInput] = useState('');

  const boot = async () => {
    try {
      const who = await api('/api/auth/me');
      setMe(who);
      const m = await api('/api/meta');
      setMeta(m);
      const route = parseRoute(m.projects);
      const proj = route?.project ?? m.projects[0]?.key ?? '';
      setProject(proj);
      if (route) { setView(route.view); setSelKey(route.selKey); }
      setSavedFilters(await api('/api/filters'));
      setAuthed(true);
    } catch (e) {
      if (e instanceof AuthError) setAuthed(false);
      else throw e;
    }
  };
  useEffect(() => { boot(); }, []);

  const reloadPdata = async () => {
    if (!project) return;
    const proj = encodeURIComponent(project);
    const [sprints, versions, boards] = await Promise.all([
      api('/api/sprints?project=' + proj), api('/api/versions?project=' + proj), api('/api/boards?project=' + proj)]);
    setPdata({ sprints, versions, boards });
  };
  useEffect(() => { if (authed) reloadPdata(); }, [project, authed]);

  // URL 동기화 (Jira처럼 주소창 반영)
  const nav = (path, title) => {
    if (location.pathname !== path) history.pushState({}, '', path);
    if (title) document.title = title;
  };
  const gotoView = (v) => {
    setView(v); setSelKey(null);
    nav(`/projects/${encodeURIComponent(project)}/${v}`, `${project} ${VIEW_NAMES[v]} - Jira PoC`);
  };
  const openIssue = (key) => {
    setView('list'); setSelKey(key);
    nav('/browse/' + encodeURIComponent(key)); // 제목은 상세 로드 후 설정
  };
  useEffect(() => {
    const onPop = () => {
      if (!meta) return;
      const route = parseRoute(meta.projects);
      if (route) { setProject(route.project); setView(route.view); setSelKey(route.selKey); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [meta]);

  if (authed === false) return <LoginGate onLogin={() => { setAuthed(null); boot(); }} />;
  if (!authed || !meta) return <div className="placeholder" style={{ marginTop: 60, textAlign: 'center' }}>불러오는 중…</div>;

  const refresh = () => setBump((b) => b + 1);
  const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setSavedSel(''); };
  const changeProject = (p) => {
    setProject(p); setSelKey(null); setFilters((f) => ({ ...f, sprint: '' }));
    nav(`/projects/${encodeURIComponent(p)}/${view}`, `${p} ${VIEW_NAMES[view]} - Jira PoC`);
  };
  const applySaved = (id) => {
    setSavedSel(id);
    const f = savedFilters.find((x) => String(x.id) === id);
    if (!f) return;
    const next = { ...EMPTY_FILTERS };
    // 구버전(vanilla) 저장 형식(#f-*)과 신버전(key) 모두 수용
    for (const [k, v] of Object.entries(f.params ?? {})) {
      const key = k.startsWith('#f-') ? k.slice(3) : k;
      if (key in next) next[key] = v;
      if (key === 'q') setQInput(v);
    }
    setFilters(next);
  };
  const saveFilter = async () => {
    const name = prompt('필터 이름'); if (!name?.trim()) return;
    const params = {};
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
    await api('/api/filters', { method: 'POST', json: { name, params } });
    setSavedFilters(await api('/api/filters'));
  };
  const deleteFilter = async () => {
    if (!savedSel) return alert('삭제할 저장 필터를 선택하세요');
    if (!confirm('저장된 필터를 삭제할까요?')) return;
    await api('/api/filters/' + savedSel, { method: 'DELETE' });
    setSavedSel('');
    setSavedFilters(await api('/api/filters'));
  };
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/'; };

  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed');
  const viewProps = {
    project, meta, pdata, filters, bump,
    onOpen: openIssue, onChanged: refresh, onCount: setCount, reloadPdata,
    onTitle: (t) => { document.title = t; },
  };

  return (
    <>
      <header>
        <h1>Jira <span className="poc">PoC</span></h1>
        <select value={project} onChange={(e) => changeProject(e.target.value)}>
          {meta.projects.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
        <nav className="tabs">
          {VIEWS.map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => gotoView(v)}>{VIEW_NAMES[v]}</button>)}
        </nav>
        <button className="primary" onClick={() => setShowNew(true)}>+ 이슈 만들기</button>
        <span id="who"><span>{me.display_name}</span><button onClick={logout}>로그아웃</button></span>
      </header>
      <div className="fbar">
        <select value={filters.status} onChange={(e) => setF('status', e.target.value)}>
          <option value="">상태: 전체</option>
          {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setF('type', e.target.value)}>
          <option value="">타입: 전체</option>
          {meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filters.assignee} onChange={(e) => setF('assignee', e.target.value)}>
          <option value="">담당자: 전체</option>
          {meta.assignees.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setF('priority', e.target.value)}>
          <option value="">우선순위: 전체</option>
          {meta.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.sprint} onChange={(e) => setF('sprint', e.target.value)}>
          <option value="">스프린트: 전체</option>
          <option value="none">백로그(없음)</option>
          {openSprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (활성)' : ''}</option>)}
        </select>
        <input type="search" placeholder="검색 (요약·키)" value={qInput}
          onChange={(e) => {
            const v = e.target.value; setQInput(v);
            clearTimeout(qTimer.current);
            qTimer.current = setTimeout(() => setF('q', v), 250);
          }} />
        <select value={filters.group} onChange={(e) => setF('group', e.target.value)} title="전체 목록(표)에서 행을 묶어 보기">
          <option value="">그룹화: 없음</option>
          <option value="status">상태</option>
          <option value="assignee">담당자</option>
          <option value="type">타입</option>
          <option value="epic">에픽</option>
          <option value="priority">우선순위</option>
        </select>
        <button onClick={() => { setFilters(EMPTY_FILTERS); setQInput(''); setSavedSel(''); }}>초기화</button>
        <span style={{ borderLeft: '1px solid var(--line)', height: 20 }} />
        <select value={savedSel} onChange={(e) => applySaved(e.target.value)}>
          <option value="">저장된 필터…</option>
          {savedFilters.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button onClick={saveFilter}>현재 필터 저장</button>
        <button onClick={deleteFilter} title="선택한 저장 필터 삭제">삭제</button>
        <span id="count">{count}건</span>
      </div>
      <main>
        {view === 'list' && <ListView {...viewProps} selKey={selKey} />}
        {view === 'table' && <TableView {...viewProps} />}
        {view === 'board' && <BoardView {...viewProps} />}
        {view === 'backlog' && <BacklogView {...viewProps} />}
      </main>
      {showNew && <NewIssueModal meta={meta} pdata={pdata} project={project}
        onClose={() => setShowNew(false)}
        onCreated={(key) => { setShowNew(false); refresh(); openIssue(key); }} />}
    </>
  );
}
