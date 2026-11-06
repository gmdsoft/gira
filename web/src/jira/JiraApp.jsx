import { useMobile } from '../mobile.js';
// Jira PoC SPA 셸: 인증 게이트 → 상단 바 + 좌측 사이드바 + 콘텐츠(브레드크럼·탭·필터바·뷰) + URL 라우팅
import React, { useEffect, useRef, useState } from 'react';
import { api, AuthError, Avatar, hashColor } from './util.jsx';
import { ListView, TableView, BoardView, BacklogView } from './views.jsx';
import { LoginGate, NewIssueModal } from './modals.jsx';
import { DevChatPage, openDevChat } from '../dev-feedback-ui.jsx';
import { AccessGate, SettingsHub, NewProjectModal } from './perm.jsx';
import Sidebar from './Sidebar.jsx';
import HomeView from './Home.jsx';
import JqlInput from './JqlInput.jsx';
import { IconGrid, IconSearch, IconPlus, IconBell, IconHelp, IconSettings, IconList, IconTable, IconBoard, IconBacklog, IconShare, IconExpand, IconRefresh } from './icons.jsx';

const VIEWS = ['list', 'table', 'board', 'backlog'];
const VIEW_NAMES = { list: '목록', table: '전체 목록', board: '보드', backlog: '백로그' };
// xjql: 기본 모드에서 콤보로 표현할 수 없어 그대로 유지하는 잔여 JQL (기본 필터와 AND 결합)
// who: 아바타 빠른 필터(담당자) — 기본/JQL 모드와 무관하게 AND 적용
const EMPTY_FILTERS = { status: '', type: '', assignee: '', priority: '', sprint: '', q: '', group: '', jql: '', xjql: '', who: '' };

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

// 주소에 남기는 보기 상태 (Jira의 ?groupBy=epic 처럼): 새로고침·링크 공유에도 유지
const urlView = () => {
  const u = new URLSearchParams(location.search);
  return { group: u.get('groupBy') ?? '', who: u.get('who') ?? '' };
};

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
  const [pdata, setPdata] = useState({ sprints: [], versions: [], boards: [], labels: [], components: [], people: [] });
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, ...urlView() }));
  const [savedFilters, setSavedFilters] = useState([]);
  const [savedSel, setSavedSel] = useState('');
  const [view, setView] = useState('list');
  const [selKey, setSelKey] = useState(null);
  const [boardId, setBoardId] = useState('');
  const [home, setHome] = useState(false); // 홈(추천) 화면 — /, /for-you
  const [count, setCount] = useState(0);
  const [bump, setBump] = useState(0);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const mobile = useMobile();
  const [sideOpen, setSideOpen] = useState(() => !window.matchMedia('(max-width: 600px)').matches && loadSideOpen());
  useEffect(() => { if (mobile) setSideOpen(false); }, [mobile, project, view, selKey, boardId, home]);
  const [recent, setRecent] = useState(loadRecent);
  const qTimer = useRef(null);
  const [qInput, setQInput] = useState('');
  const [fmode, setFmode] = useState(() => { try { return localStorage.getItem('jira.fmode') === 'jql' ? 'jql' : 'basic'; } catch { return 'basic'; } });
  // JQL 입력은 새로고침·모드 전환에도 유지 (localStorage)
  const [jqlInput, setJqlInputRaw] = useState(() => { try { return localStorage.getItem('jira.jql') ?? ''; } catch { return ''; } });
  const setJqlInput = (v) => { setJqlInputRaw(v); try { localStorage.setItem('jira.jql', v); } catch { /* 무시 */ } };
  const [jqlErr, setJqlErr] = useState(null);
  const [globalQ, setGlobalQ] = useState('');
  // 테마: light | dark | system (system은 OS 설정을 따라가고 변경도 실시간 반영)
  const [theme, setTheme] = useState(() => {
    try { const t = localStorage.getItem('jira.theme'); return ['light', 'dark', 'system'].includes(t) ? t : 'system'; }
    catch { return 'system'; }
  });
  const [showSet, setShowSet] = useState(false);
  const [showHub, setShowHub] = useState(false); // 설정 허브 (API 키·패키지·이관·권한·승인함)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    try { localStorage.setItem('jira.theme', theme); } catch { /* 무시 */ }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

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
      setHome(!route && location.pathname !== '/dev-chat'); // 주소가 프로젝트·이슈가 아니면 홈
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
    const [sprints, versions, boards, tags, people] = await Promise.all([
      api('/api/sprints?project=' + proj), api('/api/versions?project=' + proj),
      api('/api/boards?project=' + proj), api('/api/labels?project=' + proj),
      api('/api/people?project=' + proj)]);
    setPdata({ sprints, versions, boards, people, ...tags });
  };
  useEffect(() => { if (authed) reloadPdata(); }, [project, authed]);

  // 새로고침 후에도 JQL 모드면 보존된 쿼리를 한 번 재적용
  const bootJql = useRef(false);
  useEffect(() => {
    if (!authed || !project || bootJql.current) return;
    bootJql.current = true;
    if (fmode === 'jql' && jqlInput.trim()) applyJql(jqlInput);
  }, [authed, project]);

  // URL 동기화 (Jira처럼 주소창 반영)
  const nav = (path, title) => {
    if (location.pathname + location.search !== path) history.pushState({}, '', path);
    if (title) document.title = title;
  };
  const switchProject = (pkey) => {
    if (pkey === project) return;
    setProject(pkey); setFilters((f) => ({ ...f, sprint: '', who: '' })); setSavedSel(''); // 사람 목록이 프로젝트마다 다름
  };
  const gotoView = (v) => {
    const q = boardId ? '?b=' + boardId : ''; // 보드 컨텍스트는 뷰를 바꿔도 유지
    setView(v); setSelKey(null); setHome(false);
    nav(`/projects/${encodeURIComponent(project)}/${v}${q}`, `${project} ${VIEW_NAMES[v]} - Gira`);
  };
  const gotoProjView = (pkey, v) => {
    switchProject(pkey);
    setView(v); setSelKey(null); setBoardId(''); setHome(false); // 프로젝트 수준 이동은 보드 컨텍스트 해제
    nav(`/projects/${encodeURIComponent(pkey)}/${v}`, `${pkey} ${VIEW_NAMES[v]} - Gira`);
  };
  const gotoBoard = (pkey, bid) => {
    switchProject(pkey);
    setView('board'); setSelKey(null); setBoardId(bid); setHome(false);
    nav(`/projects/${encodeURIComponent(pkey)}/board${bid ? '?b=' + bid : ''}`, `${pkey} 보드 - Gira`);
  };
  // 사이드바 '보드' 클릭: 칸반 보드를 기본 선택 (이름 '칸반' > kanban 유형 > 첫 보드 > 기본)
  const gotoBoardsDefault = async (pkey) => {
    const boards = pkey === project ? pdata.boards : await api('/api/boards?project=' + encodeURIComponent(pkey));
    const pick = boards.find((b) => b.name.includes('칸반'))
      ?? boards.find((b) => b.type === 'kanban')
      ?? boards[0] ?? null;
    gotoBoard(pkey, pick ? String(pick.id) : '');
  };
  const openIssue = (key) => {
    setView('list'); setSelKey(key); setHome(false);
    nav('/browse/' + encodeURIComponent(key)); // 제목은 상세 로드 후 설정
  };
  const gotoHome = () => { setHome(true); setSelKey(null); nav('/for-you', '홈 - Gira'); };
  useEffect(() => {
    const onPop = () => {
      if (!meta) return;
      const route = parseRoute(meta.projects);
      setHome(!route);
      if (route) { setProject(route.project); setView(route.view); setSelKey(route.selKey); setBoardId(route.boardId); }
      const uv = urlView();
      setFilters((f) => (f.group === uv.group && f.who === uv.who ? f : { ...f, ...uv }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [meta]);

  // 그룹화·담당자 빠른 필터를 주소(?groupBy=, ?who=)에 반영 — 뷰·보드 이동(pushState) 뒤에도 다시 붙인다
  useEffect(() => {
    if (!location.pathname.startsWith('/projects/')) return;
    const u = new URLSearchParams(location.search);
    const before = u.toString();
    for (const [k, v] of [['groupBy', filters.group], ['who', filters.who]]) { if (v) u.set(k, v); else u.delete(k); }
    const after = u.toString();
    if (after !== before) history.replaceState(history.state, '', location.pathname + (after ? '?' + after : ''));
  }, [filters.group, filters.who, view, boardId, project, selKey]);

  if (authed === false) return <LoginGate onLogin={() => { setAuthed(null); boot(); }} />;
  if (!authed || !meta) return <div className="placeholder" style={{ marginTop: 60, textAlign: 'center' }}>불러오는 중…</div>;
  // 개발참여 챗봇 전용 탭 (프로젝트 접근 권한과 무관하게 누구나)
  if (location.pathname === '/dev-chat') {
    return <DevChatPage api={api} appName="Gira" btn="plain" btnPrimary="primary" />;
  }
  const projectCreated = async (created) => {
    setShowProjectCreate(false);
    nav(`/projects/${encodeURIComponent(created.key)}/list`);
    await boot();
  };
  const projectCreateModal = !mobile && showProjectCreate && me?.can_create && <NewProjectModal
    onClose={() => setShowProjectCreate(false)} onCreated={projectCreated} />;
  // 접근 가능한 프로젝트가 없으면 요청 게이트
  if (!meta.projects.length) {
    return <>{projectCreateModal}<AccessGate me={me} onCreate={me?.can_create ? () => setShowProjectCreate(true) : undefined} onLogout={async () => {
      await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/';
    }} /></>;
  }

  const refresh = () => setBump((b) => b + 1);
  const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setSavedSel(''); };
  const toggleSide = () => setSideOpen((v) => {
    try { localStorage.setItem('jira.sidebar', v ? '0' : '1'); } catch { /* 무시 */ }
    return !v;
  });
  const noteSeen = (key, summary) => setRecent((prev) => {
    const next = [{ key, summary }, ...prev.filter((r) => r.key !== key)].slice(0, 10); // 사이드바 5개, 홈 10개
    try { localStorage.setItem('jira.recent', JSON.stringify(next)); } catch { /* 무시 */ }
    return next;
  });
  // 현재 기본 필터를 동등한 JQL로 변환 (기본 → 고급 전환 시 프리필) — 잔여 JQL(xjql)도 이어붙인다
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
    const x = (filters.xjql ?? '').trim();
    if (!x) return parts.join(' AND ');
    if (/^order\s+by/i.test(x)) return [parts.join(' AND '), x].filter(Boolean).join(' ');
    return [...parts, x].join(' AND ');
  };
  // 적용 중인 JQL을 기본 필터로 번역: 콤보로 표현 가능한 조건은 선택값(picks)으로,
  // 나머지(날짜 비교, OR 묶음, ORDER BY 등)는 잔여 JQL(residual)로 돌려준다 — 결과 집합 보존이 목적
  const splitJqlToBasic = (text) => {
    const src = String(text ?? '').trim();
    const picks = {}; const rest = [];
    // 최상위(따옴표·괄호 밖) ORDER BY 분리
    let order = '', wherePart = src;
    {
      let depth = 0, q = null;
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && (i === 0 || /\s/.test(src[i - 1])) && /^order\s+by\s/i.test(src.slice(i))) {
          wherePart = src.slice(0, i).trim(); order = src.slice(i).trim(); break;
        }
      }
    }
    // 최상위 AND 분해 — OR가 최상위에 있으면 통째로 잔여 처리
    const terms = [];
    {
      let depth = 0, q = null, start = 0, bail = false;
      for (let i = 0; i < wherePart.length && !bail; i++) {
        const c = wherePart[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && (i === 0 || /\s/.test(wherePart[i - 1]))) {
          const m = wherePart.slice(i).match(/^(and|or)(?=\s)/i);
          if (!m) continue;
          if (m[1].toLowerCase() === 'or') { bail = true; break; }
          terms.push(wherePart.slice(start, i)); start = i + m[0].length; i += m[0].length - 1;
        }
      }
      if (bail) terms.splice(0, terms.length, wherePart);
      else terms.push(wherePart.slice(start));
    }
    const unq = (v) => v.replace(/^"([^"]*)"$/, '$1').replace(/^'([^']*)'$/, '$1');
    const byName = (list, name, key = 'name') => list.find((x) => String(x[key]).toLowerCase() === name.toLowerCase());
    for (const raw of terms.map((t) => t.trim()).filter(Boolean)) {
      let m;
      if ((m = raw.match(/^sprint\s+is\s+empty$/i)) && !picks.sprint) { picks.sprint = 'none'; continue; }
      if ((m = raw.match(/^(\w+)\s*(=|~)\s*("[^"]*"|'[^']*'|[^\s()]+)$/))) {
        const field = m[1].toLowerCase(), op = m[2], val = unq(m[3]);
        if (field === 'project' && op === '=' && val.toUpperCase() === project.toUpperCase()) continue; // 현재 프로젝트 — 암묵 조건
        if (field === 'status' && op === '=' && !picks.status && byName(meta.statuses, val)) { picks.status = byName(meta.statuses, val).id; continue; }
        if (field === 'type' && op === '=' && !picks.type && byName(meta.types, val)) { picks.type = byName(meta.types, val).id; continue; }
        if (field === 'assignee' && op === '=' && !picks.assignee && byName(meta.assignees, val, 'display_name')) { picks.assignee = byName(meta.assignees, val, 'display_name').id; continue; }
        if (field === 'priority' && op === '=' && !picks.priority && meta.priorities.find((p) => p.toLowerCase() === val.toLowerCase())) { picks.priority = meta.priorities.find((p) => p.toLowerCase() === val.toLowerCase()); continue; }
        if (field === 'sprint' && op === '=' && !picks.sprint && byName(pdata.sprints, val)) { picks.sprint = String(byName(pdata.sprints, val).id); continue; }
        if (field === 'text' && op === '~' && !picks.q) { picks.q = val; continue; }
      }
      rest.push(raw);
    }
    const residual = [rest.join(' AND '), order].filter(Boolean).join(' ').trim();
    return { picks, residual };
  };
  const applyJql = async (text) => {
    const t = text.trim();
    if (!t) { setJqlErr(null); setFilters((f) => ({ ...f, jql: '', xjql: '' })); setSavedSel(''); return; }
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
  // 모드 전환으로 결과 집합이 바뀌지 않게 한다 — 적용 중인 쿼리를 반대쪽 표현으로 번역해 이어받는다
  const switchMode = (m) => {
    if (m === fmode) return;
    try { localStorage.setItem('jira.fmode', m); } catch { /* 무시 */ }
    setFmode(m); setSavedSel('');
    if (m === 'jql') {
      // 직접 쓴 JQL이 있으면 그대로 재적용, 없으면 기본 필터(+잔여 JQL)를 JQL로 변환해 이어받는다
      const pre = jqlInput.trim() || buildJql();
      setJqlInput(pre);
      applyJql(pre);
    } else {
      setJqlErr(null);
      const applied = (filters.jql ?? '').trim();
      if (!applied) { setFilters((f) => ({ ...f, jql: '' })); return; } // 적용된 JQL이 없으면 기본 선택값 그대로
      // 적용 중인 JQL을 기본 선택값으로 번역하고, 못 옮긴 조건·정렬은 잔여 JQL로 유지
      const { picks, residual } = splitJqlToBasic(applied);
      setQInput(picks.q ?? '');
      setFilters((f) => ({ ...EMPTY_FILTERS, group: f.group, who: f.who, ...picks, xjql: residual }));
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
    if (next.jql) setJqlInput(next.jql); // 기본형 저장 필터가 작성 중인 JQL을 지우지 않도록
    setJqlErr(null);
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
  const submitGlobal = (e) => {
    e?.preventDefault();
    const q = globalQ.trim();
    if (!q) return;
    setView('list'); setSelKey(null); setHome(false); setF('q', q); setQInput(q);
    nav(`/projects/${encodeURIComponent(project)}/list`, `${project} 목록 - Gira`);
  };

  const projName = meta.projects.find((p) => p.key === project)?.name ?? project;
  const curBoard = pdata.boards.find((b) => String(b.id) === boardId);
  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed');
  const viewProps = {
    project, meta, pdata, me, filters, bump,
    onOpen: openIssue, onChanged: refresh, onCount: setCount, reloadPdata,
    onTitle: (t) => { document.title = t; }, onSeen: noteSeen, onNew: () => setShowNew(true), onHome: gotoHome,
    boardJql: curBoard?.jql ?? null, // 보드 컨텍스트 필터 — 모든 뷰에 AND 적용
    board: curBoard ?? null,         // 백로그 요약 칩이 보드 컬럼 기준으로 세도록
  };

  return (
    <>
      <header className="topbar">
        <div className="tb-left">
          <button className="iconbtn navtgl" onClick={toggleSide} title={sideOpen ? '사이드바 접기' : '사이드바 펼치기'}><IconGrid size={18} /></button>
          <span className="brand" role="link" title="홈" onClick={gotoHome}><span className="brand-mark">G</span><span className="brand-word">Gira</span><span className="poc-badge">Alpha</span></span>
        </div>
        <div className="tb-center">
          <form className="tb-search" onSubmit={submitGlobal}>
            <IconSearch size={17} />
            <input value={globalQ} onChange={(e) => setGlobalQ(e.target.value)} placeholder="검색" aria-label="검색" />
            <kbd>/</kbd>
          </form>
          <button className="primary createbtn" onClick={() => setShowNew(true)}><IconPlus size={16} /> 만들기</button>
        </div>
        <div className="tb-right">
          <button className="iconbtn bell" title="알림 (아직 지원하지 않음)"><IconBell size={18} /><span className="bell-dot" /></button>
          <button className="iconbtn" title="도움말 (아직 지원하지 않음)"><IconHelp size={18} /></button>
          <span className="settings-wrap">
            <button className="iconbtn" title="설정" onClick={() => setShowSet((v) => !v)}><IconSettings size={20} /></button>
            {showSet && <>
              <div className="menu-backdrop" onClick={() => setShowSet(false)} />
              <div className="setmenu">
                <div className="setmenu-title">테마</div>
                {[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([v, name]) => (
                  <button key={v} onClick={() => { setTheme(v); setShowSet(false); }}>
                    <span>{name}</span>{theme === v && <span className="chk">✓</span>}
                  </button>))}
                <div className="setmenu-sep" />
                <button onClick={() => { setShowHub(true); setShowSet(false); }}><span>설정…</span></button>
              </div>
            </>}
          </span>
          <span className="tb-sep" />
          <span className="tb-user" title={me.display_name}><Avatar name={me.display_name} /></span>
          <button className="plain logout" onClick={logout}>로그아웃</button>
        </div>
      </header>
      <div className="mobile-notice">모바일은 보기 전용입니다. 편집은 데스크톱에서 이용하세요.</div>
      <div className="shell">
        {mobile && sideOpen && <button className="mobile-shade" aria-label="메뉴 닫기" onClick={() => setSideOpen(false)} />}
        {sideOpen && <Sidebar meta={meta} project={project} view={view} boardId={boardId}
          pdata={pdata} savedFilters={savedFilters} savedSel={savedSel} recent={recent.slice(0, 5)} home={home} onHome={gotoHome}
          onProjView={gotoProjView} onBoard={gotoBoard} onBoards={gotoBoardsDefault} onIssue={openIssue} onFilter={applySaved}
          onDevFeedback={openDevChat} onCreateProject={!mobile && me?.can_create ? () => setShowProjectCreate(true) : undefined} />}
        <div className="content">
          {home ? <HomeView me={me} meta={meta} recent={recent} onIssue={openIssue}
            onProjView={gotoProjView} onBoard={gotoBoard}
            onMine={(pkey) => { gotoProjView(pkey, 'list'); setFilters((f) => ({ ...f, who: String(me.id) })); }} /> : <>
          <div className="chead">
            <div className="chead-top">
              <div className="crumb"><a className="crumb-home" href="/for-you" title="홈" onClick={(e) => { e.preventDefault(); gotoHome(); }}>스페이스</a><span className="crumb-sep">/</span><span className="crumb-cur">{projName}</span></div>
              <div className="chead-actions">
                <button className="iconbtn" title="공유 (아직 지원하지 않음)"><IconShare size={17} /></button>
                <button className="iconbtn" title="전체 화면 (아직 지원하지 않음)"><IconExpand size={17} /></button>
              </div>
            </div>
            <div className="chead-title">
              <span className="proj-mark" style={{ background: hashColor(project) }}>{project[0]}</span>
              <h2>{curBoard ? curBoard.name : projName}</h2>
              <span className="chead-key">{project}</span>
            </div>
            <nav className="tabs">
              {(mobile ? ['list', 'board'] : VIEWS).map((v) => {
                const Icon = v === 'list' ? IconList : v === 'table' ? IconTable : v === 'board' ? IconBoard : IconBacklog;
                return <button key={v} className={view === v ? 'on' : ''} onClick={() => gotoView(v)}><Icon size={16} /> {VIEW_NAMES[v]}</button>;
              })}
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
                {(pdata.people ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
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
              <input type="search" placeholder="업무 검색" value={qInput}
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
            <span className="avstack" title="이 프로젝트의 최근 활동자 — 클릭하면 담당 이슈로 필터">
              {(pdata.people ?? []).slice(0, 6).map((u) => (
                <button key={u.id} className={`avbtn${String(filters.who) === String(u.id) ? ' on' : ''}`}
                  onClick={() => setF('who', String(filters.who) === String(u.id) ? '' : String(u.id))}
                  title={`${u.display_name} — 이 프로젝트에서 담당한 이슈만 보기 (다시 누르면 해제)`}>
                  <Avatar name={u.display_name} />
                </button>))}
              {(pdata.people ?? []).length > 6 && (
                <span className="avmore" title={`관련 인물 ${pdata.people.length}명+`}>+{pdata.people.length - 6}</span>
              )}
            </span>
            <select className={`filter-select${filters.group ? ' active' : ''}`} value={filters.group} onChange={(e) => setF('group', e.target.value)} title="행을 묶어 보기">
              <option value="">그룹화: 없음</option>
              <option value="status">상태</option>
              <option value="assignee">담당자</option>
              <option value="type">타입</option>
              <option value="epic">에픽</option>
              <option value="priority">우선순위</option>
            </select>
            <button onClick={() => { setFilters(EMPTY_FILTERS); setQInput(''); setJqlInput(''); setJqlErr(null); setSavedSel(''); }}>초기화</button>
            <span style={{ borderLeft: '1px solid var(--line)', height: 20 }} />
            <button className="desktop-write" onClick={saveFilter}>현재 필터 저장</button>
            {savedSel && <button className="desktop-write" onClick={deleteFilter} title="적용 중인 저장 필터 삭제">필터 삭제</button>}
            <span className="fbar-spacer" />
            <span id="count">{count.toLocaleString()}건</span>
            <button className="iconbtn" title="새로고침" onClick={refresh}><IconRefresh size={17} /></button>
            {fmode === 'jql' && jqlErr && <div className="jqlerr">{jqlErr}</div>}
          </div>
          <main>
            {(view === 'list' || (mobile && ['table', 'backlog'].includes(view))) && <ListView {...viewProps} selKey={selKey} />}
            {!mobile && view === 'table' && <TableView {...viewProps} />}
            {view === 'board' && <BoardView {...viewProps} boardId={boardId} onBoard={(bid) => gotoBoard(project, bid)} />}
            {!mobile && view === 'backlog' && <BacklogView {...viewProps} />}
          </main>
          </>}
        </div>
      </div>
      {projectCreateModal}
      {!mobile && showNew && <NewIssueModal meta={meta} pdata={pdata} project={project} me={me}
        onClose={() => setShowNew(false)} onRefresh={refresh}
        onCreated={(key) => { setShowNew(false); refresh(); openIssue(key); }} />}
      {!mobile && showHub && <SettingsHub me={me} meta={meta} project={project}
        onClose={() => setShowHub(false)} onChanged={() => boot()} />}
    </>
  );
}
