import { useMobile } from '../mobile.js';
// 보드 카드의 상위 칩 + 메뉴 — Jira 보드처럼 칩을 누르면 다른 상위 후보 목록(바로 변경)과 상위 항목 추가·보기·제거.
// 칩은 직접 부모를 보여준다: 에픽 바로 아래면 에픽(색 상자 포함), 하위 작업 등은 직접 부모(스토리·작업 — 색 상자 없음).
// 메뉴는 body에 띄워(portal) 칸 블록에 잘리지 않게 하고, portal 안의 클릭이 카드(상세 열기·끌기)로 번지지 않게 막는다.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, epicColor } from './util.jsx';
import { TypeIcon, IconChevronDown } from './icons.jsx';

const MENU_W = 320;
const stop = (e) => e.stopPropagation();

// 카드의 직접 부모: 에픽이 직접 부모가 아니면(하위 작업 등) 그 부모를, 아니면 에픽을
export function cardParent(r) {
  if (r.parent_key && String(r.parent_id) !== String(r.epic_id)) {
    return { mode: 'parent', key: r.parent_key, summary: r.parent_summary, type: r.parent_type };
  }
  if (r.epic_key) return { mode: 'epic', key: r.epic_key, summary: r.epic_summary, type: '에픽', color: r.epic_color };
  return null;
}

export function ParentChip({ r, project, meta, onOpen, onChanged }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const mobile = useMobile();
  const cur = cardParent(r);
  if (mobile) return cur ? <span className="chip">{cur.key} {cur.summary}</span> : null;
  if (!cur) return null;
  return <>
    <button type="button" ref={btn} className={`epic-chip${open ? ' on' : ''}`} title={`${cur.key} ${cur.summary ?? ''}`}
      aria-haspopup="true" aria-expanded={open} draggable={false}
      onMouseDown={stop} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
      {cur.mode === 'epic' && <span className="epic-sq" style={{ background: epicColor(cur.color) }} />}
      <span className="epic-key">{cur.key}</span>
      <span className="epic-sum">{cur.summary ?? ''}</span>
      <IconChevronDown size={11} />
    </button>
    {open && <ParentMenu anchor={btn.current} r={r} cur={cur} project={project} meta={meta} onOpen={onOpen} onChanged={onChanged}
      onClose={() => setOpen(false)} />}
  </>;
}

function ParentMenu({ anchor, r, cur, project, meta, onOpen, onChanged, onClose }) {
  const ref = useRef(null);
  const input = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const epicType = meta.types.find((t) => t.name === '에픽');
  const isEpic = cur.mode === 'epic';
  // 하위 작업은 부모 없이 존재할 수 없으므로 제거는 막는다 (다른 부모로 바꾸기는 가능)
  const noRemove = !!r.subtask;

  // 칩 아래(공간이 없으면 위)에 화면 안쪽으로 맞춰 띄운다
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const left = Math.max(8, Math.min(a.left, window.innerWidth - MENU_W - 8));
    const below = a.bottom + 4;
    const top = below + h > window.innerHeight - 8 && a.top - h - 4 > 8 ? a.top - h - 4 : below;
    setPos({ top, left });
  }, [anchor, rows]);

  // 바깥 클릭·Esc·스크롤·창 크기 변경 시 닫기
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  // 후보(최근 수정 순, 현재 상위·자기 자신 제외): 에픽 모드는 같은 프로젝트의 에픽,
  // 직접 부모 모드는 에픽·하위 작업이 아닌 일반 이슈(스토리·작업·버그 등)
  useEffect(() => {
    if (isEpic && !epicType) { setRows([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ project, limit: isEpic ? 8 : 30, sort: '-updated' });
      if (isEpic) qs.set('type', epicType.id);
      if (q.trim()) qs.set('q', q.trim());
      try {
        const d = await api('/api/issues?' + qs, { quiet: true });
        const ok = (x) => x.issue_key !== cur.key && x.issue_key !== r.issue_key && (isEpic || (!x.subtask && x.type_name !== '에픽'));
        if (alive) { setRows((d.rows ?? []).filter(ok).slice(0, 6)); setActive(-1); }
      } catch { if (alive) setRows([]); }
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q, project, epicType?.id, isEpic]);

  const patchParent = async (parentKey) => {
    if (busy) return;
    setBusy(true);
    try {
      await api('/api/issue/' + encodeURIComponent(r.issue_key), { method: 'PATCH', json: { parentKey } });
      onClose(); onChanged();
    } finally { setBusy(false); }
  };

  const onKeyDown = (e) => {
    if (!rows?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? rows.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); patchParent(rows[active].issue_key); }
  };

  return createPortal(
    <div className="parent-menu" ref={ref} style={{ top: pos.top, left: pos.left, width: MENU_W }} role="dialog"
      aria-label={`상위 항목: ${cur.key}`}
      onClick={stop} onMouseDown={stop} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="pm-search">
        <TypeIcon name={cur.type} />
        {isEpic && <span className="pm-sq" style={{ background: epicColor(cur.color) }} />}
        <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
          placeholder={`${cur.key} ${cur.summary ?? ''}`} aria-label="상위 항목 검색" />
      </div>
      <div className="pm-list" role="listbox">
          {rows === null && <div className="pm-note">불러오는 중…</div>}
          {rows?.length === 0 && <div className="pm-note">{q ? '일치하는 항목이 없습니다' : '다른 후보가 없습니다'}</div>}
          {rows?.map((x, i) => (
            <button type="button" key={x.issue_key} role="option" aria-selected={i === active}
              className={`pm-item${i === active ? ' on' : ''}`} disabled={busy}
              onMouseEnter={() => setActive(i)} onClick={() => patchParent(x.issue_key)}>
              <TypeIcon name={x.type_name} />
              {isEpic && <span className="pm-sq" style={{ background: epicColor(x.color) }} />}
              <span className="pm-text">{x.issue_key} {x.summary}</span>
            </button>))}
      </div>
      <div className="pm-foot">
        <button type="button" onClick={() => { input.current?.focus(); input.current?.select(); }}>상위 항목 추가</button>
        <button type="button" onClick={() => { onClose(); onOpen(cur.key); }}>상위 항목 보기</button>
        <button type="button" disabled={noRemove || busy} title={noRemove ? '하위 작업은 상위 항목이 있어야 합니다' : undefined}
          onClick={() => patchParent('')}>상위 항목 제거</button>
      </div>
    </div>,
    document.body,
  );
}
