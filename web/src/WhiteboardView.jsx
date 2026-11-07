import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { whiteboardSvg } from './whiteboard-svg.mjs';
import { WbIcon } from './whiteboard-icons.jsx';
import './whiteboard-ui.css';
// 편집기(Excalidraw)는 화이트보드를 편집하거나 편집본을 볼 때만 불러온다
const WhiteboardBoard = lazy(() => import('./WhiteboardBoard.jsx'));

// 이관 원본 형식을 그대로 그리는 정적 보기 (원본과 같은 모양)
function SvgView({ data, actions }) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [pan, setPan] = useState(false);
  const drag = useRef(null);
  const viewport = useRef(null);
  useEffect(() => {
    const node = viewport.current; if (!node) return;
    const zoom = e => {
      e.preventDefault();
      const rect = node.getBoundingClientRect(), px = e.clientX - rect.left - rect.width / 2, py = e.clientY - rect.top - rect.height / 2;
      setView(v => { const scale = Math.min(20, Math.max(.1, v.scale * Math.exp(-e.deltaY * .001))); return { scale, x: px - (px - v.x) * scale / v.scale, y: py - (py - v.y) * scale / v.scale }; });
    };
    node.addEventListener('wheel', zoom, { passive: false });
    return () => node.removeEventListener('wheel', zoom);
  }, [data]);
  const svg = useMemo(() => data ? whiteboardSvg(data) : '', [data]);
  // 바탕 격자 — 편집기(Excalidraw)와 같은 20px 칸, 5칸마다 굵은 선. 보드와 함께 이동·확대된다(중심 기준 scale)
  const cw = viewport.current?.clientWidth ?? 0, ch = viewport.current?.clientHeight ?? 0;
  const g = 20 * view.scale, G = g * 5;
  const ox = cw / 2 * (1 - view.scale) + view.x, oy = ch / 2 * (1 - view.scale) + view.y;
  const grid = {
    backgroundColor: '#fff',
    backgroundImage: ['linear-gradient(#dfe1e6 1px, transparent 1px)', 'linear-gradient(90deg, #dfe1e6 1px, transparent 1px)',
      'linear-gradient(#f1f2f4 1px, transparent 1px)', 'linear-gradient(90deg, #f1f2f4 1px, transparent 1px)'].join(','),
    backgroundSize: `${G}px ${G}px, ${G}px ${G}px, ${g}px ${g}px, ${g}px ${g}px`,
    backgroundPosition: `${ox}px ${oy}px`,
  };
  // 가운데 기준 확대/축소 (버튼)
  const zoomBy = (f) => setView(v => { const scale = Math.min(20, Math.max(.1, v.scale * f)); return { scale, x: v.x * scale / v.scale, y: v.y * scale / v.scale }; });
  return <div className="wb-frame">
    <div className="wb-toolbar">
      <div className="wb-left">
        <span className="wb-badge"><WbIcon name="board" />이관 원본</span>
        <span className="wb-note" title="이미지 원본과 댓글 본문은 이관 대기 중입니다.">이미지 원본·댓글 본문은 이관 대기 중</span>
      </div>
      <div className="wb-right">
        <div className="wb-group" role="group" aria-label="확대/축소">
          <button className="wb-btn icon" title="축소" aria-label="축소" onClick={() => zoomBy(1 / 1.25)}><WbIcon name="minus" /></button>
          <span className="wb-zoom" aria-live="polite">{Math.round(view.scale * 100)}%</span>
          <button className="wb-btn icon" title="확대" aria-label="확대" onClick={() => zoomBy(1.25)}><WbIcon name="plus" /></button>
        </div>
        <button className="wb-btn" title="보드 전체가 보이게" onClick={() => setView({ x: 0, y: 0, scale: 1 })}><WbIcon name="fit" /><span className="wb-label">전체 맞춤</span></button>
        <button className="wb-btn" aria-pressed={pan} title={pan ? '텍스트 선택으로 전환' : '끌어서 화면 이동'} onClick={() => setPan(!pan)}><WbIcon name="hand" /><span className="wb-label">끌어서 이동</span></button>
        {actions && <><span className="wb-sep" />{actions}</>}
      </div>
    </div>
    <div ref={viewport} className="wb-canvas wb-grid" style={{ height: '70vh', overflow: 'hidden', ...grid, touchAction: pan ? 'none' : 'auto', cursor: pan ? 'grab' : 'text' }}
      onPointerDown={e => { if (!pan || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view }; }}
      onPointerMove={e => { if (drag.current) { const d = drag.current; setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }); } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div style={{ width: '100%', height: '100%', transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, userSelect: pan ? 'none' : 'text' }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  </div>;
}

export default function WhiteboardView({ page }) {
  const [board, setBoard] = useState({ data: page.data, version: page.currentVersion });
  const [editing, setEditing] = useState(false);
  const edited = board.data?.format === 'excalidraw';
  const editBtn = page.canEdit && board.data
    ? <button className="wb-btn primary" title="편집하면 새 버전으로 저장되고, 이전 버전은 버전 기록에 남습니다." onClick={() => setEditing(true)}><WbIcon name="pencil" />편집</button>
    : null;
  return <article className="page page-full"><h1>🖊️ {page.title}</h1>
    {!board.data ? <p>화이트보드 스냅샷이 없습니다. 다시 이관해 주세요.</p>
      : editing || edited
        ? <Suspense fallback={<div className="wb-frame"><div className="wb-toolbar"><span className="wb-status busy">화이트보드 편집기를 불러오는 중…</span></div></div>}>
          <WhiteboardBoard key={editing ? 'edit' : `view-${board.version}`} pageId={page.id} data={board.data} version={board.version} editing={editing}
            editAction={editBtn} onSaved={(version, data) => setBoard({ version, data })} onClose={() => setEditing(false)} />
        </Suspense>
        : <SvgView data={board.data} actions={editBtn} />}
  </article>;
}
