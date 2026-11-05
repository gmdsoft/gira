// 보드 카드의 상위(에픽) 칩 + 메뉴 — Jira 보드처럼 칩을 누르면 같은 프로젝트의 다른 에픽 목록(바로 변경)과
// 상위 항목 추가·보기·제거가 뜬다. 메뉴는 body에 띄워(portal) 칸 블록에 잘리지 않게 하고,
// portal 안의 클릭이 React 트리를 따라 카드(상세 열기·끌기)로 번지지 않도록 막는다.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, hashColor } from './util.jsx';
import { TypeIcon, IconChevronDown } from './icons.jsx';

const MENU_W = 320;
const stop = (e) => e.stopPropagation();

export function ParentChip({ r, project, meta, onOpen, onChanged }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  return <>
    <button type="button" ref={btn} className={`epic-chip${open ? ' on' : ''}`} title={`${r.epic_key} ${r.epic_summary ?? ''}`}
      aria-haspopup="true" aria-expanded={open} draggable={false}
      onMouseDown={stop} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
      <span className="epic-key">{r.epic_key}</span>
      <span className="epic-sum">{r.epic_summary ?? ''}</span>
      <IconChevronDown size={11} />
    </button>
    {open && <ParentMenu anchor={btn.current} r={r} project={project} meta={meta} onOpen={onOpen} onChanged={onChanged}
      onClose={() => setOpen(false)} />}
  </>;
}

function ParentMenu({ anchor, r, project, meta, onOpen, onChanged, onClose }) {
  const ref = useRef(null);
  const input = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const epicType = meta.types.find((t) => t.name === '에픽');
  // 하위 작업 등 에픽이 직접 부모가 아닌 이슈는 부모(스토리)를 따라가므로 여기서 바꾸지 않는다
  const locked = !!r.subtask || (r.parent_id != null && String(r.parent_id) !== String(r.epic_id));

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

  // 후보: 같은 프로젝트의 에픽, 최근 수정 순 (현재 상위 제외)
  useEffect(() => {
    if (locked || !epicType) { setRows([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ project, type: epicType.id, limit: 8, sort: '-updated' });
      if (q.trim()) qs.set('q', q.trim());
      try {
        const d = await api('/api/issues?' + qs, { quiet: true });
        if (alive) { setRows((d.rows ?? []).filter((x) => x.issue_key !== r.epic_key).slice(0, 6)); setActive(-1); }
      } catch { if (alive) setRows([]); }
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q, project, epicType?.id, locked]);

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
      aria-label={`상위 항목: ${r.epic_key}`}
      onClick={stop} onMouseDown={stop} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="pm-search">
        <TypeIcon name="에픽" />
        <span className="pm-sq" style={{ background: hashColor(r.epic_id) }} />
        <input ref={input} autoFocus={!locked} disabled={locked} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
          placeholder={`${r.epic_key} ${r.epic_summary ?? ''}`} aria-label="상위 항목 검색" />
      </div>
      {locked
        ? <div className="pm-note">하위 작업은 상위 이슈를 따라가므로 여기서 바꿀 수 없습니다.</div>
        : <div className="pm-list" role="listbox">
          {rows === null && <div className="pm-note">불러오는 중…</div>}
          {rows?.length === 0 && <div className="pm-note">{q ? '일치하는 에픽이 없습니다' : '다른 에픽이 없습니다'}</div>}
          {rows?.map((x, i) => (
            <button type="button" key={x.issue_key} role="option" aria-selected={i === active}
              className={`pm-item${i === active ? ' on' : ''}`} disabled={busy}
              onMouseEnter={() => setActive(i)} onClick={() => patchParent(x.issue_key)}>
              <TypeIcon name="에픽" />
              <span className="pm-sq" style={{ background: hashColor(x.id) }} />
              <span className="pm-text">{x.issue_key} {x.summary}</span>
            </button>))}
        </div>}
      <div className="pm-foot">
        <button type="button" disabled={locked} onClick={() => { input.current?.focus(); input.current?.select(); }}>상위 항목 추가</button>
        <button type="button" onClick={() => { onClose(); onOpen(r.epic_key); }}>상위 항목 보기</button>
        <button type="button" disabled={locked || busy} onClick={() => patchParent('')}>상위 항목 제거</button>
      </div>
    </div>,
    document.body,
  );
}
