// 좌측 전역 사이드바: 최근 항목 / 프로젝트(보드 중첩 트리) / 저장 필터
import React, { useEffect, useState } from 'react';
import { api, hashColor } from './util.jsx';

export default function Sidebar({ meta, project, view, boardId, pdata, savedFilters, savedSel, recent,
  onProjView, onBoard, onIssue, onFilter }) {
  const [open, setOpen] = useState(() => new Set([project]));
  const [boardsBy, setBoardsBy] = useState({}); // 다른 프로젝트의 보드 지연 로드 캐시
  useEffect(() => { setOpen((s) => s.has(project) ? s : new Set(s).add(project)); }, [project]);
  useEffect(() => {
    for (const pk of open) {
      if (pk === project || boardsBy[pk]) continue;
      api('/api/boards?project=' + encodeURIComponent(pk))
        .then((b) => setBoardsBy((m) => ({ ...m, [pk]: b })))
        .catch(() => {});
    }
  }, [open, project]);
  const boardsOf = (pk) => (pk === project ? pdata.boards : boardsBy[pk] ?? []);
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
            {/* 프로젝트 행은 링크가 아니라 펼침 토글 (실제 Jira와 동일) */}
            <div className={`sitem phead2${cur ? ' curproj' : ''}`} onClick={() => toggle(p.key)}>
              <button className="twisty2" title={opened ? '접기' : '펼치기'}>{opened ? '▾' : '▸'}</button>
              <span className="pavatar" style={{ background: hashColor(p.key) }}>{p.key[0]}</span>
              <span className="strunc" title={`${p.name} (${p.key})`}>{p.name}</span>
            </div>
            {opened && <>
              <div className={`sitem child${cur && view === 'board' && !boardId ? ' on' : ''}`}
                onClick={() => onBoard(p.key, '')}>기본 보드</div>
              {boardsOf(p.key).map((b) => (
                <div className={`sitem child${cur && boardId === String(b.id) ? ' on' : ''}`}
                  key={b.id} onClick={() => onBoard(p.key, String(b.id))}>
                  <span className="strunc" title={b.name}>{b.name}</span>
                </div>))}
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
