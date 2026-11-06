import React, { useEffect, useMemo, useRef, useState } from 'react';
import { whiteboardSvg } from './whiteboard-svg.mjs';
export default function WhiteboardView({ page }) {
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
  }, [page.data]);
  const svg = useMemo(() => page.data ? whiteboardSvg(page.data) : '', [page.data]);
  return <article className="page page-full"><h1>🖊️ {page.title}</h1><p className="muted">읽기 전용 — 원본에서 이관된 화이트보드입니다. 이미지 원본과 댓글 본문은 이관 대기 중입니다.</p>
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><button onClick={() => setView({ x: 0, y: 0, scale: 1 })}>전체 맞춤</button><button aria-pressed={pan} onClick={() => setPan(!pan)}>{pan ? '텍스트 선택' : '끌어서 이동'}</button><span>{Math.round(view.scale * 100)}%</span></div>
    {!page.data ? <p>화이트보드 스냅샷이 없습니다. 다시 이관해 주세요.</p> : <div ref={viewport} style={{ height: '70vh', overflow: 'hidden', border: '1px solid #dfe1e6', background: '#fff', touchAction: pan ? 'none' : 'auto', cursor: pan ? 'grab' : 'text' }}
      onPointerDown={e => { if (!pan || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view }; }}
      onPointerMove={e => { if (drag.current) { const d = drag.current; setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }); } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div style={{ width: '100%', height: '100%', transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, userSelect: pan ? 'none' : 'text' }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>}
  </article>;
}
