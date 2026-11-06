import { useMobile } from './mobile.js';
// Gonfluence 공통 틀: 상단 바 + 왼쪽 사이드바 (Gira와 같은 구성 — Confluence의 새 내비게이션에 대응)
// 사이드바: 홈·별표·앱·스페이스 만들기 / 스페이스(펼치면 문서 트리, + 로 문서·폴더 만들기) / 최근 항목 /
//           구분선 · Gira / 구분선 · 개발용 메뉴. 트리의 문서는 다른 문서·폴더·스페이스 위로 끌어 옮길 수 있다.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Tree from './Tree.jsx';
import { GonfSettingsHub, CreateSpaceDialog } from './access.jsx';
import { openDevChat, SPEC_PAGE_ID, REPO_URL } from './dev-feedback-ui.jsx';
import { NotifyBell } from './notify-ui.jsx';
import { AiHelpPanel } from './ai-ui.jsx';
import {
  IconGrid, IconSearch, IconPlus, IconSettings, IconHome, IconStar, IconRocket,
  IconChevronDown, IconChevronRight, IconSpace, IconBell, IconHelp,
} from './jira/icons.jsx';

const SPACE_COLORS = ['#0052cc', '#00875a', '#ff8b00', '#de350b', '#5243aa', '#00a3bf', '#403294', '#e56910'];
export const spaceColor = (s) => SPACE_COLORS[[...String(s ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % SPACE_COLORS.length];

const readRecent = () => { try { return JSON.parse(localStorage.getItem('gonf.recent') ?? '[]'); } catch { return []; } };

// 설정(톱니) 메뉴: 테마 선택 + '설정…'(허브 팝업) — Gira와 동일 구성
export function SettingsMenu({ me, navigate, theme, setTheme, up, spaceKey, spaceRole }) {
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

// 폴더 이름 입력
function FolderDialog({ spaceName, onClose, onSubmit }) {
  const [name, setName] = useState('');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-compact" onClick={(e) => e.stopPropagation()}>
        <h2>폴더 만들기</h2>
        <p className="muted">{spaceName} 스페이스 최상위에 폴더를 만듭니다. 문서를 끌어다 넣을 수 있습니다.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
          <input className="gs-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="폴더 이름" />
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>취소</button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>만들기</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GonfShell({ me, route, space, navigate, reloadSpace, logout, theme, setTheme,
  onCreatePage, onPerm, onMove, onContentClick, children }) {
  const mobile = useMobile();
  const [sideOpen, setSideOpen] = useState(() => { if (window.matchMedia('(max-width: 600px)').matches) return false; try { return localStorage.getItem('gonf.side') !== '0'; } catch { return true; } });
  useEffect(() => { if (mobile) setSideOpen(false); }, [mobile, route]);
  const [spaces, setSpaces] = useState([]);
  const [open, setOpen] = useState(() => new Set(route.spaceKey ? [route.spaceKey] : []));
  const [trees, setTrees] = useState({}); // 현재 스페이스가 아닌, 펼친 스페이스의 트리
  const [plusMenu, setPlusMenu] = useState(null); // 스페이스 key — + 메뉴(문서/폴더)
  const [folderFor, setFolderFor] = useState(null); // 폴더 만들 스페이스
  const [createSpace, setCreateSpace] = useState(false);
  const [dropSpace, setDropSpace] = useState(null);
  const [q, setQ] = useState('');
  const [showHelp, setShowHelp] = useState(false); // AI 도움말 (GIRA-15)
  const recent = readRecent().slice(0, 5);

  useEffect(() => { try { localStorage.setItem('gonf.side', sideOpen ? '1' : '0'); } catch { /* 무시 */ } }, [sideOpen]);
  const loadSpaces = useCallback(() => api('/api/spaces').then(setSpaces).catch(() => {}), []);
  useEffect(() => { loadSpaces(); }, [loadSpaces]);
  // 현재 스페이스로 들어가면 펼친다
  useEffect(() => { if (route.spaceKey) setOpen((s) => (s.has(route.spaceKey) ? s : new Set(s).add(route.spaceKey))); }, [route.spaceKey]);

  const loadTree = useCallback((key) => {
    api(`/api/spaces/${key}`).then((s) => setTrees((t) => ({ ...t, [key]: s.tree }))).catch(() => {});
  }, []);
  const treeOf = (key) => (space?.key === key ? space.tree : trees[key]);
  const toggle = (key) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else { n.add(key); if (space?.key !== key && !trees[key]) loadTree(key); }
    return n;
  });
  // 이동 뒤: 현재 스페이스와 펼친 다른 스페이스 트리를 다시 읽는다
  const reloadTrees = () => {
    reloadSpace?.();
    for (const key of open) if (space?.key !== key) loadTree(key);
  };

  // 끌어 옮기기: 문서를 다른 문서·폴더 아래로, 또는 스페이스 이름 위에 놓으면 그 스페이스 최상위로
  const moveTo = async (drag, target) => {
    const label = target.node ? `'${target.node.title}' 아래` : `'${target.spaceName}' 스페이스 최상위`;
    if (!confirm(`'${drag.title}'을(를) ${label}로 옮길까요?`)) return;
    const res = await fetch(`/api/content/${drag.id}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target.node ? { parentId: target.node.id } : { spaceKey: target.spaceKey }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '이동 실패'); return; }
    const { spaceKey: destKey } = await res.json();
    reloadTrees();
    if (destKey !== drag.spaceKey) {
      setTrees((t) => { const n = { ...t }; delete n[destKey]; delete n[drag.spaceKey]; return n; });
      if (String(route.pageId) === String(drag.id)) navigate(`/s/${destKey}/p/${drag.id}`);
    }
  };

  const createIn = async (sp, type, title) => {
    const res = await fetch('/api/content', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceKey: sp.key, parentId: null, type, ...(title ? { title } : {}) }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '만들기 실패'); return; }
    const { id } = await res.json();
    setOpen((s) => new Set(s).add(sp.key));
    if (type === 'page') navigate(`/s/${sp.key}/p/${id}/edit`);
    else if (space?.key === sp.key) reloadSpace?.();
    else loadTree(sp.key);
  };

  const go = (path) => (e) => { e.preventDefault(); navigate(path); };
  const isHome = route.view === 'home';

  return (
    <div className="gshell">
      <header className="gtb">
        <div className="gtb-left">
          <button className="gs-iconbtn" onClick={() => setSideOpen((v) => !v)} title={sideOpen ? '사이드바 접기' : '사이드바 펼치기'}><IconGrid size={18} /></button>
          <a className="gtb-brand" href="/" title="홈" onClick={go('/')}>
            <span className="gtb-mark">G</span><span className="gtb-word">Gonfluence</span><span className="poc-badge">Alpha</span>
          </a>
        </div>
        <div className="gtb-center">
          <form className="gtb-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}${route.spaceKey ? `&space=${route.spaceKey}` : ''}`); }}>
            <IconSearch size={17} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" aria-label="검색" />
            <kbd>/</kbd>
          </form>
          <button className="btn btn-primary gtb-create" disabled={!onCreatePage}
            title={onCreatePage ? '이 스페이스에 새 문서 (c)' : '스페이스를 연 뒤 만들 수 있습니다 — 사이드바 스페이스의 + 로도 만들 수 있습니다'}
            onClick={() => onCreatePage?.()}><IconPlus size={16} /> 만들기</button>
        </div>
        <div className="gtb-right">
          <NotifyBell Icon={IconBell} onOpen={(p) => navigate(p)} />
          <button type="button" className={`gs-iconbtn${showHelp ? ' on' : ''}`} title="도움말 (AI)" onClick={() => setShowHelp((v) => !v)}><IconHelp size={18} /></button>
          <SettingsMenu me={me} navigate={navigate} theme={theme} setTheme={setTheme}
            spaceKey={space?.key} spaceRole={space?.role} />
          <span className="gtb-sep" />
          <span className="gtb-av" title={`${me.display_name}${me.email ? ` <${me.email}>` : ''}`}
            style={{ background: spaceColor(me.display_name) }}>{(me.display_name ?? '?').trim()[0]}</span>
          <button className="gtb-logout" onClick={logout}>로그아웃</button>
        </div>
      </header>
      <div className="mobile-notice">모바일은 보기 전용입니다. 편집은 데스크톱에서 이용하세요.</div>
      <div className="gbody">
        {mobile && sideOpen && <button className="mobile-shade" aria-label="메뉴 닫기" onClick={() => setSideOpen(false)} />}
        {sideOpen && (
          <nav className="gs-side">
            <div className="gs-nav">
              <a className={`gs-item${isHome ? ' on' : ''}`} href="/" onClick={go('/')}><IconHome size={16} /><span className="gs-trunc">홈</span></a>
              <div className="gs-item gs-muted" title="아직 지원하지 않음"><IconStar size={16} /><span className="gs-trunc">별표 표시됨</span><IconChevronRight size={14} className="gs-arrow" /></div>
              <div className="gs-item gs-muted" title="아직 지원하지 않음"><IconGrid size={16} /><span className="gs-trunc">앱</span><IconChevronRight size={14} className="gs-arrow" /></div>
              {!mobile && <div className="gs-item" onClick={() => setCreateSpace(true)}><IconRocket size={16} /><span className="gs-trunc">스페이스 만들기</span><IconPlus size={14} className="gs-arrow" /></div>}
            </div>

            <div className="gs-head">스페이스</div>
            {spaces.map((sp) => {
              const opened = open.has(sp.key);
              const cur = sp.key === route.spaceKey;
              const canWrite = !mobile && sp.role && sp.role !== 'viewer';
              const tree = treeOf(sp.key);
              return (
                <div key={sp.key} className="gs-space">
                  <div className={`gs-item gs-sprow${cur ? ' cur' : ''}${dropSpace === sp.key ? ' drop-on' : ''}${plusMenu === sp.key ? ' menu-open' : ''}`}
                    onClick={() => navigate(`/s/${sp.key}`)}
                    onDragOver={(e) => { if (canWrite && Tree.dragging()) { e.preventDefault(); setDropSpace(sp.key); } }}
                    onDragLeave={() => setDropSpace((k) => (k === sp.key ? null : k))}
                    onDrop={(e) => { e.preventDefault(); setDropSpace(null); const d = Tree.dragging(); if (d && !(d.spaceKey === sp.key && d.parentId == null)) moveTo(d, { spaceKey: sp.key, spaceName: sp.name }); }}>
                    <button className="gs-twisty" title={opened ? '접기' : '펼치기'}
                      onClick={(e) => { e.stopPropagation(); toggle(sp.key); }}>{opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</button>
                    <span className="gs-sav" style={{ background: spaceColor(sp.key) }}>{sp.name.trim()[0]}</span>
                    <span className="gs-trunc" title={`${sp.name} (${sp.key})`}>{sp.name}</span>
                    {canWrite && (
                      <span className="gs-plus-wrap" onClick={(e) => e.stopPropagation()}>
                        <button className="gs-plus" title="이 스페이스에 만들기 (문서·폴더)" onClick={() => setPlusMenu((k) => (k === sp.key ? null : sp.key))}><IconPlus size={14} /></button>
                        {plusMenu === sp.key && <>
                          <div className="menu-overlay" onClick={() => setPlusMenu(null)} />
                          <div className="page-menu gs-plus-menu">
                            <button onClick={() => { setPlusMenu(null); createIn(sp, 'page'); }}>📄 문서</button>
                            <button onClick={() => { setPlusMenu(null); setFolderFor(sp); }}>📁 폴더</button>
                          </div>
                        </>}
                      </span>
                    )}
                  </div>
                  {opened && (
                    <div className="gs-tree">
                      {!tree ? <div className="gs-dim gs-pad">불러오는 중…</div>
                        : tree.length === 0 ? <div className="gs-dim gs-pad">문서가 없습니다</div>
                        : <Tree tree={tree} spaceKey={sp.key} currentId={cur ? route.pageId : null} navigate={navigate}
                            draggable={canWrite} onDropMove={moveTo}
                            onMove={!mobile && onMove && ((node) => onMove({ id: node.id, title: node.title, spaceKey: sp.key }))} />}
                      <a className={`gs-item gs-child${cur && route.view === 'archive' ? ' on' : ''}`} href={`/s/${sp.key}/archive`} onClick={go(`/s/${sp.key}/archive`)}>
                        <span className="gs-glyph">🗂</span><span className="gs-trunc">보관함 · 휴지통</span></a>
                      {!mobile && cur && sp.role === 'admin' && onPerm && (
                        <div className="gs-item gs-child" onClick={onPerm}><span className="gs-glyph">🔑</span><span className="gs-trunc">스페이스 권한</span></div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {recent.length > 0 && <>
              <div className="gs-head">최근 항목</div>
              {recent.map((r) => (
                <a className="gs-item gs-recent" key={r.id} href={`/s/${r.spaceKey}/p/${r.id}`} onClick={go(`/s/${r.spaceKey}/p/${r.id}`)} title={r.title}>
                  <span className="gs-glyph">📄</span><span className="gs-trunc">{r.title}</span><span className="gs-key">{r.spaceKey}</span>
                </a>))}
            </>}

            {/* 구분선 아래: 다른 앱 */}
            <div className="gs-nav gs-bottom">
              <a className="gs-item" href={`//${location.hostname}:3002/`} target="_blank" rel="noreferrer" title="Gira 열기">
                <IconSpace size={16} /><span className="gs-trunc">Gira</span><span className="gs-ext">↗</span></a>
            </div>
            {/* 다시 구분선 아래: 개발용 메뉴 */}
            <div className="gs-nav gs-bottom">
              <div className="gs-item" onClick={openDevChat} title="개발참여 챗봇 — 새 탭에서 열림 (신규 기능·수정·버그 제안)">
                <span className="gs-glyph">💡</span><span className="gs-trunc">거 참 답답하네</span></div>
              <a className={`gs-item${String(route.pageId) === SPEC_PAGE_ID ? ' on' : ''}`} href={`/s/GIRA/p/${SPEC_PAGE_ID}`}
                onClick={go(`/s/GIRA/p/${SPEC_PAGE_ID}`)} title="개발 명세서 (GIRA › 개발문서)">
                <span className="gs-glyph">📘</span><span className="gs-trunc">개발 명세서</span></a>
              <a className="gs-item" href={REPO_URL} target="_blank" rel="noreferrer" title="소스 저장소(GitHub) 열기">
                <span className="gs-glyph">📦</span><span className="gs-trunc">저장소</span><span className="gs-ext">↗</span></a>
            </div>
          </nav>
        )}
        <main className="gmain" onClick={onContentClick}>{children}</main>
      </div>
      {folderFor && <FolderDialog spaceName={folderFor.name} onClose={() => setFolderFor(null)}
        onSubmit={(name) => { const sp = folderFor; setFolderFor(null); createIn(sp, 'folder', name); }} />}
      {showHelp && <AiHelpPanel appName="Gonfluence" view={route.view} onClose={() => setShowHelp(false)} />}
      {createSpace && <CreateSpaceDialog me={me} onClose={() => setCreateSpace(false)}
        onCreated={(sp) => { setCreateSpace(false); loadSpaces(); navigate(`/s/${sp.key}`); }} />}
    </div>
  );
}
