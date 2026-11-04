// Jira PoC SPA 셸: 인증 게이트 → 상단 바 + 좌측 사이드바 + 콘텐츠(브레드크럼·탭·필터바·뷰) + URL 라우팅
import React, { useEffect, useRef, useState } from 'react';
import { api, AuthError } from './util.jsx';
import { ListView, TableView, BoardView, BacklogView } from './views.jsx';
import { LoginGate, NewIssueModal } from './modals.jsx';
import Sidebar from './Sidebar.jsx';
import JqlInput from './JqlInput.jsx';

const VIEWS = ['list', 'table', 'board', 'backlog'];
const VIEW_NAMES = { list: '목록', table: '전체 목록', board: '보드', backlog: '백로그' };
const EMPTY_FILTERS = { status: '', type: '', assignee: '', priority: '', sprint: '', q: '', group: '', jql: '' };

function parseRoute(projects) {
  const m1 = location.pathname.match(/^\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)$/);
  if (m1) {
    const key = m1[1].toUpperCase();
    const pkey = key.split('-')[0];
    if (projects.some((p) => p.key === pkey)) return { project: pkey, view: 'list', selKey: key, boardId: '' };
  }
  const m2 = location.pathname.match(/^\/projects\/([^/]+)\/(list|table|board|backlog)$/);
  if (m2) {
    const pkey = decodeURIComponent(m2[1]);
    // 보드는 컨텍스트: 어느 뷰에서든 ?b=가 있으면 그 보드의 필터가 적용된다
    const boardId = new URLSearchParams(location.search).get('b') ?? '';
    if (projects.some((p) => p.key === pkey)) return { project: pkey, view: m2[2], selKey: null, boardId };
  }
  return null;
}

const loadRecent = () => { try { return JSON.parse(localStorage.getItem('jira.recent')) ?? []; } catch { return []; } };
const loadSideOpen = () => {
  try { const v = localStorage.getItem('jira.sidebar'); if (v != null) return v === '1'; } catch { /* 무시 */ }
  return window.innerWidth >= 1100; // 좁은 화면은 접힌 채 시작
};

export default function JiraApp() {
  const [authed, setAuthed] = useState(null);   // null=확인 중, false=로그인 필요, true=완료
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [project, setProject] = useState('');
  const [pdata, setPdata] = useState({ sprints: [], versions: [], boards: [], labels: [], components: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [savedFilters, setSavedFilters] = useState([]);
  const [savedSel, setSavedSel] = useState('');
  const [view, setView] = useState('list');
  const [selKey, setSelKey] = useState(null);
  const [boardId, setBoardId] = useState('');
  const [count, setCount] = useState(0);
  const [bump, setBump] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [sideOpen, setSideOpen] = useState(loadSideOpen);
  const [recent, setRecent] = useState(loadRecent);
  const qTimer = useRef(null);
  const [qInput, setQInput] = useState('');
  const [fmode, setFmode] = useState(() => { try { return localStorage.getItem('jira.fmode') === 'jql' ? 'jql' : 'basic'; } catch { return 'basic'; } });
  const [jqlInput, setJqlInput] = useState('');
  const [jqlErr, setJqlErr] = useState(null);

  const boot = async () => {
    try {
      const who = await api('/api/auth/me');
      setMe(who);
      const m = await api('/api/meta');
      setMeta(m);
      const route = parseRoute(m.projects);
      const proj = route?.project ?? m.projects[0]?.key ?? '';
      setProject(proj);
      if (route) { setView(route.view); setSelKey(route.selKey); setBoardId(route.boardId); }
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
    const [sprints, versions, boards, tags] = await Promise.all([
      api('/api/sprints?project=' + proj), api('/api/versions?project=' + proj),
      api('/api/boards?project=' + proj), api('/api/labels?project=' + proj)]);
    setPdata({ sprints, versions, boards, ...tags });
  };
  useEffect(() => { if (authed) reloadPdata(); }, [project, authed]);

  // URL 동기화 (Jira처럼 주소창 반영)
  const nav = (path, title) => {
    if (location.pathname + location.search !== path) history.pushState({}, '', path);
    if (title) document.title = title;
  };
  const switchProject = (pkey) => {
    if (pkey === project) return;
    setProject(pkey); setFilters((f) => ({ ...f, sprint: '' })); setSavedSel('');
  };
  const gotoView = (v) => {
    const q = boardId ? '?b=' + boardId : ''; // 보드 컨텍스트는 뷰를 바꿔도 유지
    setView(v); setSelKey(null);
    nav(`/projects/${encodeURIComponent(project)}/${v}${q}`, `${project} ${VIEW_NAMES[v]} - Jira PoC`);
  };
  const gotoProjView = (pkey, v) => {
    switchProject(pkey);
    setView(v); setSelKey(null); setBoardId(''); // 프로젝트 수준 이동은 보드 컨텍스트 해제
    nav(`/projects/${encodeURIComponent(pkey)}/${v}`, `${pkey} ${VIEW_NAMES[v]} - Jira PoC`);
  };
  const gotoBoard = (pkey, bid) => {
    switchProject(pkey);
    setView('board'); setSelKey(null); setBoardId(bid);
    nav(`/projects/${encodeURIComponent(pkey)}/board${bid ? '?b=' + bid : ''}`, `${pkey} 보드 - Jira PoC`);
  };
  const openIssue = (key) => {
    setView('list'); setSelKey(key);
    nav('/browse/' + encodeURIComponent(key)); // 제목은 상세 로드 후 설정
  };
  useEffect(() => {
    const onPop = () => {
      if (!meta) return;
      const route = parseRoute(meta.projects);
      if (route) { setProject(route.project); setView(route.view); setSelKey(route.selKey); setBoardId(route.boardId); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [meta]);

  if (authed === false) return <LoginGate onLogin={() => { setAuthed(null); boot(); }} />;
  if (!authed || !meta) return <div className="placeholder" style={{ marginTop: 60, textAlign: 'center' }}>불러오는 중…</div>;

  const refresh = () => setBump((b) => b + 1);
  const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setSavedSel(''); };
  const toggleSide = () => setSideOpen((v) => {
    try { localStorage.setItem('jira.sidebar', v ? '0' : '1'); } catch { /* 무시 */ }
    return !v;
  });
  const noteSeen = (key, summary) => setRecent((prev) => {
    const next = [{ key, summary }, ...prev.filter((r) => r.key !== key)].slice(0, 5);
    try { localStorage.setItem('jira.recent', JSON.stringify(next)); } catch { /* 무시 */ }
    return next;
  });
  // 현재 기본 필터를 동등한 JQL로 변환 (기본 → 고급 전환 시 프리필)
  const buildJql = () => {
    const parts = [];
    const nameOf = (list, id, idKey = 'id', out = 'name') => list.find((x) => String(x[idKey]) === String(id))?.[out];
    const quote = (s) => `"${String(s ?? '').replace(/"/g, '')}"`;
    if (filters.status) parts.push(`status = ${quote(nameOf(meta.statuses, filters.status))}`);
    if (filters.type) parts.push(`type = ${quote(nameOf(meta.types, filters.type))}`);
    if (filters.assignee) parts.push(`assignee = ${quote(nameOf(meta.assignees, filters.assignee, 'id', 'display_name'))}`);
    if (filters.priority) parts.push(`priority = ${filters.priority}`);
    if (filters.sprint === 'none') parts.push('sprint IS EMPTY');
    else if (filters.sprint) parts.push(`sprint = ${quote(nameOf(pdata.sprints, filters.sprint))}`);
    if (filters.q) parts.push(`text ~ ${quote(filters.q)}`);
    return parts.join(' AND ');
  };
  const applyJql = async (text) => {
    const t = text.trim();
    if (!t) { setJqlErr(null); setFilters((f) => ({ ...f, jql: '' })); setSavedSel(''); return; }
    try {
      // limit=1로 서버 파서에 문법 검증만 받고, 통과하면 필터로 적용 (기본 필터 선택값은 보존)
      await api(`/api/issues?project=${encodeURIComponent(project)}&limit=1&jql=${encodeURIComponent(t)}`, { quiet: true });
      setJqlErr(null);
      setFilters((f) => ({ ...f, jql: t }));
      setSavedSel('');
    } catch (e) {
      if (e instanceof AuthError) throw e;
      setJqlErr(e.message);
    }
  };
  // 모드 전환은 '어느 쪽이 적용되는지'만 바꾼다 — 양쪽 필터 상태는 유지
  const switchMode = (m) => {
    if (m === fmode) return;
    try { localStorage.setItem('jira.fmode', m); } catch { /* 무시 */ }
    setFmode(m); setSavedSel('');
    if (m === 'jql') {
      // 직접 쓴 JQL이 있으면 그대로 재적용, 없으면 기본 필터를 JQL로 변환해 이어받는다
      const pre = jqlInput.trim() || buildJql();
      setJqlInput(pre);
      applyJql(pre);
    } else {
      setJqlErr(null);
      setFilters((f) => ({ ...f, jql: '' })); // 기본 선택값은 그대로 되살아난다
    }
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
    // 저장된 필터가 JQL이면 고급 모드로, 아니면 기본 모드로 맞춘다
    const m = next.jql ? 'jql' : 'basic';
    if (m !== fmode) { try { localStorage.setItem('jira.fmode', m); } catch { /* 무시 */ } setFmode(m); }
    setJqlInput(next.jql); setJqlErr(null);
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

  const projName = meta.projects.find((p) => p.key === project)?.name ?? project;
  const curBoard = pdata.boards.find((b) => String(b.id) === boardId);
  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed');
  const viewProps = {
    project, meta, pdata, filters, bump,
    onOpen: openIssue, onChanged: refresh, onCount: setCount, reloadPdata,
    onTitle: (t) => { document.title = t; }, onSeen: noteSeen, onNew: () => setShowNew(true),
    boardJql: curBoard?.jql ?? null, // 보드 컨텍스트 필터 — 모든 뷰에 AND 적용
  };

  return (
    <>
      <header className="topbar">
        <button className="plain navtgl" onClick={toggleSide} title={sideOpen ? '사이드바 접기' : '사이드바 펼치기'}>☰</button>
        <h1>Jira <span className="poc">PoC</span></h1>
        <button className="primary" onClick={() => setShowNew(true)}>+ 만들기</button>
        <span id="who"><span>{me.display_name}</span><button onClick={logout}>로그아웃</button></span>
      </header>
      <div className="shell">
        {sideOpen && <Sidebar meta={meta} project={project} view={view} boardId={boardId}
          pdata={pdata} savedFilters={savedFilters} savedSel={savedSel} recent={recent}
          onProjView={gotoProjView} onBoard={gotoBoard} onIssue={openIssue} onFilter={applySaved} />}
        <div className="content">
          <div className="chead">
            <div className="crumb">프로젝트 / {projName} ({project})</div>
            <h2>{curBoard ? curBoard.name : projName}</h2>
            <nav className="tabs">
              {VIEWS.map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => gotoView(v)}>{VIEW_NAMES[v]}</button>)}
            </nav>
          </div>
          <div className="fbar">
            <span className="fmode">
              <button className={fmode === 'basic' ? 'on' : ''} onClick={() => switchMode('basic')}>기본</button>
              <button className={fmode === 'jql' ? 'on' : ''} onClick={() => switchMode('jql')}>JQL</button>
            </span>
            {fmode === 'basic' ? <>
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
            </> : <>
              <JqlInput value={jqlInput} onChange={setJqlInput} onApply={applyJql} meta={meta} pdata={pdata}
                placeholder='JQL — 예: status != "완료" AND assignee = currentUser() ORDER BY updated DESC' />
              <button className="primary" onClick={() => applyJql(jqlInput)}>적용</button>
            </>}
            <select value={filters.group} onChange={(e) => setF('group', e.target.value)} title="전체 목록(표)에서 행을 묶어 보기">
              <option value="">그룹화: 없음</option>
              <option value="status">상태</option>
              <option value="assignee">담당자</option>
              <option value="type">타입</option>
              <option value="epic">에픽</option>
              <option value="priority">우선순위</option>
            </select>
            <button onClick={() => { setFilters(EMPTY_FILTERS); setQInput(''); setJqlInput(''); setJqlErr(null); setSavedSel(''); }}>초기화</button>
            <span style={{ borderLeft: '1px solid var(--line)', height: 20 }} />
            <button onClick={saveFilter}>현재 필터 저장</button>
            {savedSel && <button onClick={deleteFilter} title="적용 중인 저장 필터 삭제">필터 삭제</button>}
            <span id="count">{count}건</span>
            {fmode === 'jql' && jqlErr && <div className="jqlerr">{jqlErr}</div>}
          </div>
          <main>
            {view === 'list' && <ListView {...viewProps} selKey={selKey} />}
            {view === 'table' && <TableView {...viewProps} />}
            {view === 'board' && <BoardView {...viewProps} boardId={boardId} onBoard={(bid) => gotoBoard(project, bid)} />}
            {view === 'backlog' && <BacklogView {...viewProps} />}
          </main>
        </div>
      </div>
      {showNew && <NewIssueModal meta={meta} pdata={pdata} project={project}
        onClose={() => setShowNew(false)}
        onCreated={(key) => { setShowNew(false); refresh(); openIssue(key); }} />}
    </>
  );
}
