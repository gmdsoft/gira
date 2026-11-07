// 좌측 전역 사이드바: 최근 항목 / 프로젝트(전체 목록·보드·백로그) / 저장 필터
// 프로젝트 목록은 Gonfluence 사이드바(GIRA-76)와 같은 방식: 간단히 보기 = 즐겨찾기 + 최근 방문(최대 5), '모든 스페이스 보기'로 나머지
import React, { useEffect, useState } from 'react';
import { hashColor } from './util.jsx';
import { IconClock, IconChevronRight, IconChevronDown, IconTable, IconBoard, IconBacklog, IconFilter, IconStar, IconGrid, IconDashboard, IconSpace, IconProject, IconRocket, IconPlus, IconHome } from './icons.jsx';
import { SPEC_URL, REPO_URL } from '../dev-feedback-ui.jsx';

// 즐겨찾기·최근 방문 프로젝트 key (이 브라우저에 저장)
const RECENT_PROJECTS = 'gira.recentProjects';
const STARRED_PROJECTS = 'gira.starredProjects';
const RECENT_MAX = 5;
const readKeys = (name) => { try { const v = JSON.parse(localStorage.getItem(name) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveKeys = (name, v) => { try { localStorage.setItem(name, JSON.stringify(v)); } catch { /* 무시 */ } };

export default function Sidebar({ meta, project, view, boardId, pdata, savedFilters, savedSel, recent, home, onHome,
  onProjView, onBoard, onBoards, onIssue, onFilter, onDevFeedback, onCreateProject }) {
  const [open, setOpen] = useState(() => new Set([project]));
  useEffect(() => { setOpen((s) => s.has(project) ? s : new Set(s).add(project)); }, [project]);
  const toggle = (pk) => setOpen((s) => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });

  // 최근 들어간 프로젝트 기록
  const [recentProjects, setRecentProjects] = useState(() => readKeys(RECENT_PROJECTS));
  useEffect(() => {
    if (home || !project) return;
    setRecentProjects((prev) => {
      if (prev[0] === project) return prev;
      const next = [project, ...prev.filter((k) => k !== project)].slice(0, 20);
      saveKeys(RECENT_PROJECTS, next);
      return next;
    });
  }, [project, home]);
  // 즐겨찾기 프로젝트 — 간단히 보기의 첫 기준
  const [starred, setStarred] = useState(() => readKeys(STARRED_PROJECTS));
  const toggleStar = (key) => setStarred((prev) => {
    const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    saveKeys(STARRED_PROJECTS, next);
    return next;
  });
  const [allProjects, setAllProjects] = useState(false);
  // 간단히 보기 기준: ① 즐겨찾기 전부 ② 최근 방문(현재 프로젝트 포함, 최대 RECENT_MAX). 둘 다 없으면 목록 앞쪽 RECENT_MAX개.
  // 묶음 안의 순서는 전체 목록 순서라 이동해도 자리가 바뀌지 않는다.
  const projects = meta.projects;
  const known = new Set(projects.map((p) => p.key));
  const starKeys = new Set(starred.filter((k) => known.has(k)));
  const recentKeys = new Set(recentProjects.filter((k) => known.has(k) && !starKeys.has(k)).slice(0, RECENT_MAX));
  if (!home && project && known.has(project) && !starKeys.has(project)) recentKeys.add(project);
  const noBasis = starKeys.size === 0 && recentKeys.size === 0;
  if (noBasis) for (const p of projects.slice(0, RECENT_MAX)) recentKeys.add(p.key);
  const starList = projects.filter((p) => starKeys.has(p.key));
  const recentList = projects.filter((p) => recentKeys.has(p.key));
  const hiddenCount = projects.length - starList.length - recentList.length;

  return (
    <nav id="sidebar">
      <div className="snav">
        <div className={`sitem snav-top${home ? ' on' : ''}`} onClick={onHome} title="홈 — 내 할당 이슈·최근 본 항목·바로가기">
          <IconHome size={16} /><span className="strunc">홈</span><IconChevronRight size={14} className="sarrow" /></div>
        <div className="sitem snav-top"><IconStar size={16} /><span className="strunc">별표 표시됨</span><IconChevronRight size={14} className="sarrow" /></div>
        <div className="sitem snav-top"><IconGrid size={16} /><span className="strunc">앱</span><IconChevronRight size={14} className="sarrow" /></div>
        <div className="sitem snav-top"><IconDashboard size={16} /><span className="strunc">계획</span><IconChevronRight size={14} className="sarrow" /></div>
        {onCreateProject && <div className="sitem snav-top" onClick={onCreateProject}><IconRocket size={16} />
          <span className="strunc">프로젝트 만들기</span><IconPlus size={14} className="sarrow" /></div>}
      </div>
      <div className="shead2"><span>스페이스</span>{onCreateProject &&
        <button className="shead-plus" title="프로젝트 만들기" onClick={onCreateProject}>+</button>}</div>
      {(() => {
        const renderProject = (p) => {
        const opened = open.has(p.key);
        const cur = !home && p.key === project;
        return (
          <React.Fragment key={p.key}>
            <div className={`sitem phead2${cur ? ' curproj' : ''}`} onClick={() => onProjView(p.key, 'list')}>
              <button className="twisty2" title={opened ? '접기' : '펼치기'}
                onClick={(e) => { e.stopPropagation(); toggle(p.key); }}>{opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</button>
              <span className="pavatar" style={{ background: hashColor(p.key) }}>{p.key[0]}</span>
              <span className="strunc" title={`${p.name} (${p.key})`}>{p.name}</span>
              <button className={`sstar${starKeys.has(p.key) ? ' on' : ''}`} aria-pressed={starKeys.has(p.key)}
                title={starKeys.has(p.key) ? '즐겨찾기 해제' : '즐겨찾기 — 간단히 보기에서 항상 보임'}
                onClick={(e) => { e.stopPropagation(); toggleStar(p.key); }}><IconStar size={14} /></button>
            </div>
            {opened && <>
              <div className={`sitem child${cur && view === 'table' && !boardId ? ' on' : ''}`}
                onClick={() => onProjView(p.key, 'table')}><IconTable size={15} /><span className="strunc">전체 목록</span></div>
              <div className={`sitem child${cur && view === 'board' ? ' on' : ''}`}
                onClick={() => onBoards(p.key)}><IconBoard size={15} /><span className="strunc">보드</span></div>
              <div className={`sitem child${cur && view === 'backlog' && !boardId ? ' on' : ''}`}
                onClick={() => onProjView(p.key, 'backlog')}><IconBacklog size={15} /><span className="strunc">백로그</span></div>
            </>}
          </React.Fragment>
        );
      };
        if (allProjects) return projects.map(renderProject);
        return <>
          {starList.length > 0 && <div className="ssubhead">즐겨찾기</div>}
          {starList.map(renderProject)}
          {recentList.length > 0 && <div className="ssubhead" title={noBasis ? '방문 기록이 없어 목록 앞쪽을 보여 줍니다' : undefined}>{noBasis ? '스페이스' : '최근 방문'}</div>}
          {recentList.map(renderProject)}
        </>;
      })()}
      {hiddenCount > 0 && (
        <button type="button" className="sitem sallproj" aria-expanded={allProjects}
          title={allProjects ? '즐겨찾기·최근 방문 스페이스만 보기' : `나머지 스페이스 ${hiddenCount}개 더 보기`}
          onClick={() => setAllProjects((v) => !v)}>
          <IconSpace size={16} />
          <span className="strunc">{allProjects ? '간단히 보기' : '모든 스페이스 보기'}</span>
          {!allProjects && <span className="skeycount">+{hiddenCount}</span>}
          {allProjects ? <IconChevronDown size={14} className="sarrow" /> : <IconChevronRight size={14} className="sarrow" />}
        </button>
      )}
      {recent.length > 0 && <>
        <div className="shead2"><span>최근 항목</span></div>
        <div className="srecent">
          {recent.map((r) => (
            <div className="sitem srecent-item" key={r.key} title={r.summary} onClick={() => onIssue(r.key)}>
              <span className="skey2">{r.key}</span><span className="strunc">{r.summary}</span>
            </div>))}
        </div>
      </>}
      {savedFilters.length > 0 && <>
        <div className="shead2"><span>필터</span></div>
        {savedFilters.map((f) => (
          <div className={`sitem${savedSel === String(f.id) ? ' on' : ''}`} key={f.id} onClick={() => onFilter(String(f.id))}>
            <IconFilter size={15} /><span className="strunc" title={f.name}>{f.favourite ? '★ ' : ''}{f.name}</span>
          </div>))}
      </>}
      {/* 구분선 아래: 다른 앱(Gonfluence) — 같은 호스트의 3001 포트 */}
      <div className="snav snav-bottom">
        <a className="sitem" href={`//${location.hostname}:3001/`} target="_blank" rel="noreferrer" title="Gonfluence 열기">
          <IconSpace size={16} /><span className="strunc">Gonfluence</span><span className="sext">↗</span>
        </a>
      </div>
      {/* 다시 구분선 아래: 개발용 메뉴 */}
      <div className="snav snav-bottom">
        <div className="sitem snav-top" onClick={onDevFeedback} title="개발참여 챗봇 — 새 탭에서 열림 (신규 기능·수정·버그 제안)">
          <span className="sglyph">💡</span><span className="strunc">거 참 답답하네</span>
        </div>
        <a className="sitem" href={SPEC_URL} target="_blank" rel="noreferrer" title="개발 명세서 열기">
          <span className="sglyph">📘</span><span className="strunc">개발 명세서</span><span className="sext">↗</span>
        </a>
        <a className="sitem" href={REPO_URL} target="_blank" rel="noreferrer" title="소스 저장소(GitHub) 열기">
          <span className="sglyph">📦</span><span className="strunc">저장소</span><span className="sext">↗</span>
        </a>
      </div>
    </nav>
  );
}
