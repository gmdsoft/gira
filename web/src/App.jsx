import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Tree from './Tree.jsx';
import PageView from './PageView.jsx';
import MoveDialog from './MoveDialog.jsx';
import Editor from './Editor.jsx';
import SearchView from './SearchView.jsx';
import VersionHistory from './VersionHistory.jsx';

function parsePath(pathname) {
  if (pathname.startsWith('/search')) return { view: 'search' };
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
  const [movePage, setMovePage] = useState(null); // 트리 ⋯ 메뉴에서 이동할 문서

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
    if (!route.spaceKey) { setSpace(null); return; }
    if (space?.key === route.spaceKey) return;
    api(`/api/spaces/${route.spaceKey}`).then(setSpace).catch(console.error);
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

  if (route.view === 'home') return <Home navigate={navigate} />;
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
        </>}
      </aside>
      <main className="main" onClick={onContentClick}>
        {route.view === 'page' && <PageView pageId={route.pageId} navigate={navigate} reloadSpace={reloadSpace} />}
        {route.view === 'archive' && <ArchiveView spaceKey={route.spaceKey} navigate={navigate} reloadSpace={reloadSpace} />}
      </main>
      {movePage && <MoveDialog page={movePage} navigate={navigate} reloadSpace={reloadSpace}
        onClose={() => setMovePage(null)} />}
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

function Home({ navigate }) {
  const [spaces, setSpaces] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api('/api/spaces').then(setSpaces).catch(console.error); }, []);
  return (
    <div className="home">
      <h1>GMD Docs <span className="poc-badge">PoC</span></h1>
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="문서 검색 (한국어 형태소 분석)" />
        <button className="btn btn-primary" type="submit">검색</button>
      </form>
      <p className="muted">임포트된 스페이스</p>
      {!spaces ? '불러오는 중…' : (
        <ul className="space-list">
          {spaces.map((s) => (
            <li key={s.id}>
              <a href={`/s/${s.key}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${s.key}`); }}>
                <strong>{s.name}</strong> <span className="muted">{s.key} · {s.type}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
