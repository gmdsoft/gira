// 좌측 전역 사이드바: 최근 항목 / 프로젝트(전체 목록·보드·백로그) / 저장 필터
import React, { useEffect, useState } from 'react';
import { hashColor } from './util.jsx';
import { IconClock, IconChevronRight, IconChevronDown, IconTable, IconBoard, IconBacklog, IconFilter, IconStar, IconGrid, IconDashboard, IconSpace, IconProject, IconRocket, IconPlus } from './icons.jsx';
import { SPEC_URL, REPO_URL } from '../dev-feedback-ui.jsx';

export default function Sidebar({ meta, project, view, boardId, pdata, savedFilters, savedSel, recent, home, onHome,
  onProjView, onBoard, onBoards, onIssue, onFilter, onDevFeedback, onCreateProject }) {
  const [open, setOpen] = useState(() => new Set([project]));
  useEffect(() => { setOpen((s) => s.has(project) ? s : new Set(s).add(project)); }, [project]);
  const toggle = (pk) => setOpen((s) => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });

  return (
    <nav id="sidebar">
      <div className="snav">
        <div className={`sitem snav-top${home ? ' on' : ''}`} onClick={onHome} title="홈 — 내 할당 이슈·최근 본 항목·바로가기">
          <IconStar size={16} /><span className="strunc">추천</span><IconChevronRight size={14} className="sarrow" /></div>
        <div className="sitem snav-top"><IconStar size={16} /><span className="strunc">별표 표시됨</span><IconChevronRight size={14} className="sarrow" /></div>
        <div className="sitem snav-top"><IconGrid size={16} /><span className="strunc">앱</span><IconChevronRight size={14} className="sarrow" /></div>
        <div className="sitem snav-top"><IconDashboard size={16} /><span className="strunc">계획</span><IconChevronRight size={14} className="sarrow" /></div>
        {onCreateProject && <div className="sitem snav-top" onClick={onCreateProject}><IconRocket size={16} />
          <span className="strunc">프로젝트 만들기</span><IconPlus size={14} className="sarrow" /></div>}
      </div>
      <div className="shead2"><span>스페이스</span>{onCreateProject &&
        <button className="shead-plus" title="프로젝트 만들기" onClick={onCreateProject}>+</button>}</div>
      {meta.projects.map((p) => {
        const opened = open.has(p.key);
        const cur = !home && p.key === project;
        return (
          <React.Fragment key={p.key}>
            <div className={`sitem phead2${cur ? ' curproj' : ''}`} onClick={() => onProjView(p.key, 'list')}>
              <button className="twisty2" title={opened ? '접기' : '펼치기'}
                onClick={(e) => { e.stopPropagation(); toggle(p.key); }}>{opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</button>
              <span className="pavatar" style={{ background: hashColor(p.key) }}>{p.key[0]}</span>
              <span className="strunc" title={`${p.name} (${p.key})`}>{p.name}</span>
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
      })}
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
            <IconFilter size={15} /><span className="strunc" title={f.name}>{f.name}</span>
          </div>))}
      </>}
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
        <a className="sitem" href="http://172.21.1.1:3001" target="_blank" rel="noreferrer" title="Gonfluence 열기">
          <IconSpace size={16} /><span className="strunc">Gonfluence</span><span className="sext">↗</span>
        </a>
      </div>
    </nav>
  );
}
