import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.js';
import Tree from './Tree.jsx';
import PageView from './PageView.jsx';
import MoveDialog from './MoveDialog.jsx';
import Editor from './Editor.jsx';
import SearchView from './SearchView.jsx';
import VersionHistory from './VersionHistory.jsx';
import AdminPage from './Admin.jsx';
import { SpacePermissionsModal, RequestAccessView, CreateSpaceDialog, GonfSettingsHub } from './access.jsx';
import { IconSettings } from './jira/icons.jsx';
import { DevChatPage, openDevChat, SPEC_URL, REPO_URL } from './dev-feedback-ui.jsx';

function parsePath(pathname) {
  if (pathname.startsWith('/search')) return { view: 'search' };
  if (pathname.startsWith('/admin')) return { view: 'admin' };
  if (pathname.startsWith('/dev-chat')) return { view: 'devchat' }; // 개발참여 챗봇 (새 탭)
  let m = /^\/s\/([^/]+)\/p\/(\d+)\/edit$/.exec(pathname);
  if (m) return { view: 'edit', spaceKey: m[1], pageId: m[2] };
  m = /^\/s\/([^/]+)\/p\/(\d+)\/history$/.exec(pathname);
  if (m) return { view: 'history', spaceKey: m[1], pageId: m[2] };
  m = /^\/s\/([^/]+)\/archive$/.exec(pathname);
  if (m) return { view: 'archive', spaceKey: m[1] };
  m = /^\/s\/([^/]+)\/p\/(\d+)/.exec(pathname);
  if (m) return { view: 'page', spaceKey: m[1], pageId: m[2] };
  m = /^\/s\/([^/]+)/.exec(pathname);
  if (m) return { view: 'space', spaceKey: m[1] };
  return { view: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(() => parsePath(location.pathname));
  const [space, setSpace] = useState(null);
  const [spaceErr, setSpaceErr] = useState(null); // 403(접근 요청 가능) 등
  const [permOpen, setPermOpen] = useState(false); // 스페이스 권한 편집
  const [movePage, setMovePage] = useState(null); // 트리 ⋯ 메뉴에서 이동할 문서
  const [me, setMe] = useState(undefined); // undefined=확인 중, null=로그인 필요
  const dragStart = useRef(null);
  // 테마: light | dark | system (Gira와 동일한 방식, localStorage gonf.theme)
  const [theme, setTheme] = useState(() => {
    try { const t = localStorage.getItem('gonf.theme'); return ['light', 'dark', 'system'].includes(t) ? t : 'system'; }
    catch { return 'system'; }
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    try { localStorage.setItem('gonf.theme', theme); } catch { /* 무시 */ }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // 마우스 드래그(텍스트 선택) 후 click이 링크 탐색으로 이어지지 않게 한다.
  // Confluence와 동일하게, 드래그가 4px 이상 움직이면 click을 취소한다.
  useEffect(() => {
    const onDown = (e) => { if (e.button === 0) dragStart.current = { x: e.clientX, y: e.clientY }; };
    const onClickCapture = (e) => {
      const d = dragStart.current;
      // e.detail === 0 은 키보드로 발생한 click — 드래그 판정에서 제외한다.
      if (!d || e.detail === 0) return;
      if (Math.abs(e.clientX - d.x) > 4 || Math.abs(e.clientY - d.y) > 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  useEffect(() => {
    api('/api/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
  }, []);

  const navigate = useCallback((path) => {
    history.pushState(null, '', path);
    setRoute(parsePath(path));
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parsePath(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 스페이스 트리 로드
  useEffect(() => {
    if (!route.spaceKey) { setSpace(null); setSpaceErr(null); return; }
    if (space?.key === route.spaceKey) return;
    setSpaceErr(null);
    api(`/api/spaces/${route.spaceKey}`).then((s) => { setSpace(s); setSpaceErr(null); })
      .catch((e) => { setSpace(null); setSpaceErr(e); });
  }, [route.spaceKey]);

  const reloadSpace = useCallback(() => {
    if (route.spaceKey) api(`/api/spaces/${route.spaceKey}`).then(setSpace).catch(console.error);
  }, [route.spaceKey]);

  // Confluence처럼 제목 없이 바로 만들고 편집기에서 제목을 입력한다
  const createPage = useCallback(async () => {
    const res = await fetch('/api/content', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceKey: route.spaceKey, parentId: route.pageId ?? space?.homepage_id ?? null }),
    });
    if (!res.ok) { alert('생성 실패'); return; }
    const { id } = await res.json();
    reloadSpace();
    navigate(`/s/${route.spaceKey}/p/${id}/edit`);
  }, [route, space, navigate, reloadSpace]);

  // Confluence 단축키 (보기 화면): e=편집, c=새 페이지, /=검색, m=댓글
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.presentation, .modal-backdrop, .sel-comment-form')) return;
      if (route.view === 'page' && e.key === 'e') {
        e.preventDefault();
        navigate(`/s/${route.spaceKey}/p/${route.pageId}/edit`);
      } else if (route.view === 'page' && e.key === 'm') {
        const ta = document.querySelector('.comment-form textarea');
        if (ta) { e.preventDefault(); ta.scrollIntoView({ block: 'center' }); ta.focus(); }
      } else if ((route.view === 'page' || route.view === 'archive') && e.key === 'c') {
        e.preventDefault();
        createPage();
      } else if (e.key === '/') {
        const inp = document.querySelector('.sidebar-search input, .search-input');
        if (inp) { e.preventDefault(); inp.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, navigate, createPage]);

  // 스페이스 홈 → 홈페이지로
  useEffect(() => {
    if (route.view === 'space' && space?.key === route.spaceKey && space.homepage_id) {
      navigate(`/s/${space.key}/p/${space.homepage_id}`);
    }
  }, [route, space]);

  // 본문 내 페이지 링크(제목 기반) 클릭 처리
  const onContentClick = useCallback(async (e) => {
    const sl = e.target.closest('a.space-link');
    if (sl) {
      e.preventDefault();
      if (sl.dataset.space) navigate(`/s/${sl.dataset.space}`);
      return;
    }
    const a = e.target.closest('a.page-link');
    if (!a) return;
    e.preventDefault();
    const title = a.dataset.title;
    const spaceKey = a.dataset.space || route.spaceKey || '';
    try {
      const r = await api(`/api/resolve?title=${encodeURIComponent(title)}&spaceKey=${encodeURIComponent(spaceKey)}`);
      navigate(`/s/${r.spaceKey}/p/${r.id}`);
    } catch {
      alert(`페이지를 찾을 수 없습니다: ${title}\n(이 스페이스만 임포트된 PoC 환경입니다)`);
    }
  }, [route.spaceKey, navigate]);

  if (me === undefined) return <div className="page-loading">불러오는 중…</div>;
  if (me === null) return <Login onLogin={setMe} />;

  if (route.view === 'devchat') {
    return <DevChatPage api={api} appName="Gonfluence" giraOrigin={`//${location.hostname}:3002`} />;
  }

  if (route.view === 'home') {
    return <Home navigate={navigate} me={me} logout={logout} theme={theme} setTheme={setTheme} />;
  }
  // 조직 관리(사용자·팀·그룹)는 관리 서비스(3003)로 분리 — 여기서는 접근 요청 승인함만
  if (route.view === 'admin') return <AdminPage me={me} navigate={navigate} tabs={['requests']} />;
  // 권한 없는 스페이스: 접근 요청 화면
  if (route.spaceKey && spaceErr?.status === 403 && spaceErr.body?.canRequest) {
    return (
      <div className="app">
        <aside className="sidebar">
          <a className="sidebar-home" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>← 스페이스 목록</a>
          <div className="sidebar-user">
            <span title={me.email}>👤 {me.display_name}</span>
            <button className="btn btn-xs" onClick={logout}>로그아웃</button>
          </div>
        </aside>
        <main className="main"><RequestAccessView spaceKey={route.spaceKey} /></main>
      </div>
    );
  }
  if (route.view === 'edit') return <Editor key={route.pageId} pageId={route.pageId} navigate={navigate} reloadSpace={reloadSpace} />;
  if (route.view === 'search') return <SearchView navigate={navigate} />;
  if (route.view === 'history') return <VersionHistory key={route.pageId} pageId={route.pageId} spaceKey={route.spaceKey} navigate={navigate} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="sidebar-home" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>← 스페이스 목록</a>
        <SearchBox navigate={navigate} spaceKey={route.spaceKey} />
        {space && <>
          <div className="space-name">{space.name}</div>
          <button className="btn new-page" onClick={createPage}>+ 새 페이지</button>
          <Tree tree={space.tree} spaceKey={space.key} currentId={route.pageId} navigate={navigate}
            onMove={(node) => setMovePage({ id: node.id, title: node.title, spaceKey: space.key })} />
          <a className="archive-link" href={`/s/${space.key}/archive`}
             onClick={(e) => { e.preventDefault(); navigate(`/s/${space.key}/archive`); }}>🗂 보관함 · 휴지통</a>
          {space.role === 'admin' && (
            <a className="archive-link" href="#" onClick={(e) => { e.preventDefault(); setPermOpen(true); }}>🔑 스페이스 권한</a>
          )}
        </>}
        <a className="archive-link" href="#" title="신규 기능·수정·버그 제안 (개발참여 챗봇)"
           onClick={(e) => { e.preventDefault(); openDevChat(); }}>💡 거 참 답답하네</a>
        <a className="archive-link" href={SPEC_URL} target="_blank" rel="noreferrer">📘 개발 명세서 ↗</a>
        <a className="archive-link" href={REPO_URL} target="_blank" rel="noreferrer">📦 저장소 ↗</a>
        <a className="archive-link" href={`//${location.hostname}:3002/`} target="_blank" rel="noreferrer">🗂 Gira ↗</a>
        <div className="sidebar-user">
          <span title={me.email}>👤 {me.display_name}</span>
          <SettingsMenu me={me} navigate={navigate} theme={theme} setTheme={setTheme} up
            spaceKey={space?.key} spaceRole={space?.role} />
          <button className="btn btn-xs" onClick={logout}>로그아웃</button>
        </div>
      </aside>
      <main className="main" onClick={onContentClick}>
        {route.view === 'page' && <PageView pageId={route.pageId} navigate={navigate} reloadSpace={reloadSpace} />}
        {route.view === 'archive' && <ArchiveView spaceKey={route.spaceKey} navigate={navigate} reloadSpace={reloadSpace} />}
      </main>
      {movePage && <MoveDialog page={movePage} navigate={navigate} reloadSpace={reloadSpace}
        onClose={() => setMovePage(null)} />}
      {permOpen && space && <SpacePermissionsModal spaceKey={space.key} onClose={() => setPermOpen(false)} />}
    </div>
  );
}

// 개발용 로그인 (Entra ID OIDC 도입 전): 관리자가 허용한 계정만, 계정명 입력으로
function Login({ onLogin }) {
  const [allowed, setAllowed] = useState([]); // 허용 계정 (자동완성용)
  const [name, setName] = useState('');
  useEffect(() => { api('/api/auth/users').then(setAllowed).catch(() => {}); }, []);

  const login = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '로그인 실패'); return; }
    onLogin(await api('/api/auth/me'));
  };

  return (
    <div className="home login">
      <h1>Gonfluence <span className="poc-badge">PoC</span></h1>
      <p className="muted">계정명(이름 또는 이메일)을 입력하세요. 관리자가 허용한 계정만 로그인할 수 있습니다.
        (개발용 — Entra ID 연동 시 회사 계정 로그인으로 교체됩니다)</p>
      <form className="search-form" onSubmit={login}>
        <input className="search-input" autoFocus list="login-allowed" value={name}
          onChange={(e) => setName(e.target.value)} placeholder="계정명 (예: 홍길동)" />
        <button className="btn btn-primary" type="submit">로그인</button>
      </form>
      <datalist id="login-allowed">
        {allowed.map((u) => <option key={u.id} value={u.display_name} />)}
      </datalist>
    </div>
  );
}

// 보관함·휴지통: 상태가 current가 아닌 페이지 목록 + 복원
function ArchiveView({ spaceKey, navigate, reloadSpace }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    api(`/api/spaces/${spaceKey}/archived`).then(setRows).catch(() => setRows([]));
  }, [spaceKey]);
  useEffect(load, [load]);

  const restore = async (row) => {
    const res = await fetch(`/api/content/${row.id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'current' }),
    });
    if (!res.ok) { alert('복원 실패'); return; }
    load();
    reloadSpace();
  };

  if (!rows) return <div className="page-loading">불러오는 중…</div>;
  return (
    <article className="page archive-view">
      <h1>보관함 · 휴지통</h1>
      {rows.length === 0 && <p className="muted">보관되거나 휴지통에 있는 페이지가 없습니다.</p>}
      {rows.map((r) => (
        <div key={r.id} className="archive-row">
          <span className={r.status === 'trashed' ? 'status status-red' : 'status status-yellow'}>
            {r.status === 'trashed' ? '휴지통' : '보관됨'}
          </span>
          <a href={`/s/${spaceKey}/p/${r.id}`}
             onClick={(e) => { e.preventDefault(); navigate(`/s/${spaceKey}/p/${r.id}`); }}>{r.title}</a>
          <span className="muted">{r.updated_at ? new Date(r.updated_at).toLocaleString('ko-KR') : ''}</span>
          <button className="btn" onClick={() => restore(r)}>복원</button>
        </div>
      ))}
    </article>
  );
}

function SearchBox({ navigate, spaceKey }) {
  const [q, setQ] = useState('');
  return (
    <form className="sidebar-search" onSubmit={(e) => {
      e.preventDefault();
      if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}${spaceKey ? `&space=${spaceKey}` : ''}`);
    }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색 ( / )" />
    </form>
  );
}

// 홈 — Confluence 홈 구성을 따른다: 다시 시작하기(최근 방문 카드) · 최근 업데이트 피드 · 스페이스 타일
const SPACE_COLORS = ['#0052cc', '#00875a', '#ff8b00', '#de350b', '#5243aa', '#00a3bf', '#403294', '#e56910'];
const spaceColor = (s) => SPACE_COLORS[[...String(s ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % SPACE_COLORS.length];
const ago = (t) => {
  const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  if (m < 43200) return `${Math.floor(m / 1440)}일 전`;
  return new Date(t).toLocaleDateString('ko-KR');
};

// 설정(톱니) 메뉴: 테마 선택 + '설정…'(허브 팝업) — Gira와 동일 구성
function SettingsMenu({ me, navigate, theme, setTheme, up, spaceKey, spaceRole }) {
  const [open, setOpen] = useState(false);
  const [showHub, setShowHub] = useState(false);
  return (
    <span className="setwrap">
      <button className="set-btn" title="설정" onClick={() => setOpen((v) => !v)}><IconSettings size={20} /></button>
      {open && <>
        <div className="menu-overlay" onClick={() => setOpen(false)} />
        <div className={'setmenu' + (up ? ' setmenu-up' : '')}>
          <div className="setmenu-title">테마</div>
          {[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([v, name]) => (
            <button key={v} onClick={() => { setTheme(v); setOpen(false); }}>
              <span>{name}</span>{theme === v && <span className="chk">✓</span>}
            </button>
          ))}
          <div className="setmenu-sep" />
          <button onClick={() => { setShowHub(true); setOpen(false); }}><span>설정…</span></button>
        </div>
      </>}
      {showHub && <GonfSettingsHub me={me} spaceKey={spaceKey} spaceRole={spaceRole}
        navigate={navigate} onClose={() => setShowHub(false)} />}
    </span>
  );
}

function Home({ navigate, me, logout, theme, setTheme }) {
  const [spaces, setSpaces] = useState(null);
  const [feed, setFeed] = useState(null);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const recent = (() => { try { return JSON.parse(localStorage.getItem('gonf.recent') ?? '[]'); } catch { return []; } })();
  useEffect(() => {
    api('/api/spaces').then(setSpaces).catch(console.error);
    api('/api/home/recent').then(setFeed).catch(() => setFeed([]));
  }, []);
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };
  return (
    <div className="home home-wide">
      <div className="home-user muted">
        <a href="#" title="신규 기능·수정·버그 제안 (개발참여 챗봇)"
           onClick={(e) => { e.preventDefault(); openDevChat(); }}>💡 거 참 답답하네</a>
        <a href={SPEC_URL} target="_blank" rel="noreferrer">📘 개발 명세서</a>
        <a href={REPO_URL} target="_blank" rel="noreferrer">📦 저장소 ↗</a>
        <a href={`//${location.hostname}:3002/`} target="_blank" rel="noreferrer">🗂 Gira ↗</a>
        <SettingsMenu me={me} navigate={navigate} theme={theme} setTheme={setTheme} />
        👤 {me.display_name} <button className="btn btn-xs" onClick={logout}>로그아웃</button>
      </div>
      <h1>Gonfluence <span className="poc-badge">PoC</span></h1>
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="문서 검색 (한국어 형태소 분석)" />
        <button className="btn btn-primary" type="submit">검색</button>
      </form>

      {recent.length > 0 && <>
        <h2 className="home-sec">다시 시작하기</h2>
        <div className="resume-row">
          {recent.slice(0, 4).map((r) => (
            <a className="resume-card" key={r.id} href={`/s/${r.spaceKey}/p/${r.id}`} onClick={go(`/s/${r.spaceKey}/p/${r.id}`)}>
              <span className="resume-icon">📄</span>
              <span className="resume-title">{r.title}</span>
              <span className="muted">{r.spaceName ?? r.spaceKey}</span>
            </a>))}
        </div>
      </>}

      <div className="home-cols">
        <div className="home-main">
          <h2 className="home-sec">최근 업데이트</h2>
          {!feed ? <p className="muted">불러오는 중…</p> : !feed.length ? <p className="muted">업데이트가 없습니다</p> : (
            <ul className="feed">
              {feed.map((r) => (
                <li key={r.id}>
                  <span className="feed-av" style={{ background: spaceColor(r.editor ?? '?') }}>{(r.editor ?? '?').trim()[0]}</span>
                  <span className="feed-body">
                    <span><strong>{r.editor ?? '알 수 없음'}</strong>님이 <a href={`/s/${r.space_key}/p/${r.id}`} onClick={go(`/s/${r.space_key}/p/${r.id}`)}>{r.title}</a> 페이지를 업데이트함</span>
                    <span className="muted">{r.space_name} · {ago(r.updated_at)}</span>
                  </span>
                </li>))}
            </ul>
          )}
        </div>
        <div className="home-side">
          <h2 className="home-sec">스페이스
            <button className="btn btn-xs space-new" onClick={() => setCreateOpen(true)}>+ 만들기</button>
          </h2>
          {!spaces ? <p className="muted">불러오는 중…</p> : (
            <ul className="space-tiles">
              {spaces.map((s) => (
                <li key={s.id}>
                  <a href={`/s/${s.key}`} onClick={go(`/s/${s.key}`)}>
                    <span className="space-ic" style={{ background: spaceColor(s.key) }}>{s.name.trim()[0]}</span>
                    <span className="space-nm"><strong>{s.name}</strong><span className="muted">{s.key} · {s.type}</span></span>
                  </a>
                </li>))}
            </ul>
          )}
        </div>
      </div>
      {createOpen && <CreateSpaceDialog me={me} onClose={() => setCreateOpen(false)}
        onCreated={(sp) => { setCreateOpen(false); navigate(`/s/${sp.key}`); }} />}
    </div>
  );
}
