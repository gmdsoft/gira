import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { whiteboardSvg } from './whiteboard-svg.mjs';
// 편집기(Excalidraw)는 화이트보드를 편집하거나 편집본을 볼 때만 불러온다
const WhiteboardBoard = lazy(() => import('./WhiteboardBoard.jsx'));

// 이관 원본 형식을 그대로 그리는 정적 보기 (원본과 같은 모양)
function SvgView({ data }) {
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
  return <>
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><button onClick={() => setView({ x: 0, y: 0, scale: 1 })}>전체 맞춤</button><button aria-pressed={pan} onClick={() => setPan(!pan)}>{pan ? '텍스트 선택' : '끌어서 이동'}</button><span>{Math.round(view.scale * 100)}%</span></div>
    <div ref={viewport} style={{ height: '70vh', overflow: 'hidden', border: '1px solid #dfe1e6', background: '#fff', touchAction: pan ? 'none' : 'auto', cursor: pan ? 'grab' : 'text' }}
      onPointerDown={e => { if (!pan || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view }; }}
      onPointerMove={e => { if (drag.current) { const d = drag.current; setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }); } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div style={{ width: '100%', height: '100%', transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, userSelect: pan ? 'none' : 'text' }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  </>;
}

export default function WhiteboardView({ page }) {
  const [board, setBoard] = useState({ data: page.data, version: page.currentVersion });
  const [editing, setEditing] = useState(false);
  const edited = board.data?.format === 'excalidraw';
  return <article className="page page-full"><h1>🖊️ {page.title}</h1>
    {!editing && <p className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {page.canEdit && board.data && <button className="primary" onClick={() => setEditing(true)}>편집</button>}
      <span>{edited ? `버전 ${board.version}` : '원본에서 이관된 화이트보드입니다. 이미지 원본과 댓글 본문은 이관 대기 중입니다.'}{edited || !page.canEdit ? '' : ' 편집하면 새 버전으로 저장되고, 이관 원본은 버전 기록에 남습니다.'}</span>
    </p>}
    {!board.data ? <p>화이트보드 스냅샷이 없습니다. 다시 이관해 주세요.</p>
      : editing || edited
        ? <Suspense fallback={<p className="muted">화이트보드 편집기를 불러오는 중…</p>}>
          <WhiteboardBoard key={editing ? 'edit' : `view-${board.version}`} pageId={page.id} data={board.data} version={board.version} editing={editing}
            onSaved={(version, data) => setBoard({ version, data })} onClose={() => setEditing(false)} />
        </Suspense>
        : <SvgView data={board.data} />}
  </article>;
}
