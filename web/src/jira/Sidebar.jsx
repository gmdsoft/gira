// 좌측 전역 사이드바: 최근 항목 / 프로젝트(전체 목록·보드·백로그) / 저장 필터
import React, { useEffect, useState } from 'react';
import { hashColor } from './util.jsx';

export default function Sidebar({ meta, project, view, boardId, pdata, savedFilters, savedSel, recent,
  onProjView, onBoard, onBoards, onIssue, onFilter }) {
  const [open, setOpen] = useState(() => new Set([project]));
  useEffect(() => { setOpen((s) => s.has(project) ? s : new Set(s).add(project)); }, [project]);
  const toggle = (pk) => setOpen((s) => { const n = new Set(s); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });

  return (
    <nav id="sidebar">
      {recent.length > 0 && <>
        <div className="shead2">최근 항목</div>
        {recent.map((r) => (
          <div className="sitem" key={r.key} title={r.summary} onClick={() => onIssue(r.key)}>
            <span className="skey2">{r.key}</span><span className="strunc">{r.summary}</span>
          </div>))}
      </>}
      <div className="shead2">프로젝트</div>
      {meta.projects.map((p) => {
        const opened = open.has(p.key);
        const cur = p.key === project;
        return (
          <React.Fragment key={p.key}>
            {/* 프로젝트 제목 클릭 → 목록 뷰 (진한 글씨 = 현재 프로젝트), 트위스티로 접기/펼치기 */}
            <div className={`sitem phead2${cur ? ' curproj' : ''}${cur && view === 'list' && !boardId ? ' on' : ''}`}
              onClick={() => onProjView(p.key, 'list')}>
              <button className="twisty2" title={opened ? '접기' : '펼치기'}
                onClick={(e) => { e.stopPropagation(); toggle(p.key); }}>{opened ? '▾' : '▸'}</button>
              <span className="pavatar" style={{ background: hashColor(p.key) }}>{p.key[0]}</span>
              <span className="strunc" title={`${p.name} (${p.key})`}>{p.name}</span>
            </div>
            {opened && <>
              <div className={`sitem child${cur && view === 'table' && !boardId ? ' on' : ''}`}
                onClick={() => onProjView(p.key, 'table')}>전체 목록</div>
              <div className={`sitem child${cur && view === 'board' ? ' on' : ''}`}
                onClick={() => onBoards(p.key)}>보드</div>{/* 기본 보기: 칸반 보드 선택 */}
              <div className={`sitem child${cur && view === 'backlog' && !boardId ? ' on' : ''}`}
                onClick={() => onProjView(p.key, 'backlog')}>백로그</div>
            </>}
          </React.Fragment>
        );
      })}
      {savedFilters.length > 0 && <>
        <div className="shead2">필터</div>
        {savedFilters.map((f) => (
          <div className={`sitem${savedSel === String(f.id) ? ' on' : ''}`} key={f.id} onClick={() => onFilter(String(f.id))}>
            <span className="strunc" title={f.name}>{f.name}</span>
          </div>))}
      </>}
    </nav>
  );
}
