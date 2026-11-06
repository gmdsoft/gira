import React, { useEffect, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';
import './image-tools.css';

export default function ImageTools({ editor }) {
  const [selected, setSelected] = useState(null);
  const [menu, setMenu] = useState('');
  const [drag, setDrag] = useState(null);
  const [preview, setPreview] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [bytes, setBytes] = useState(null);
  useEffect(() => {
    const sync = () => {
      const s = editor.state.selection;
      if (!(s instanceof NodeSelection) || s.node.type.name !== 'media') { setSelected(null); return; }
      const dom = editor.view.nodeDOM(s.from);
      const img = dom?.querySelector('img');
      if (img) setSelected({ pos: s.from, node: s.node, img, rect: img.getBoundingClientRect() });
    };
    editor.on('selectionUpdate', sync); editor.on('transaction', sync);
    window.addEventListener('resize', sync); window.addEventListener('scroll', sync, true);
    const observer = new ResizeObserver(sync); observer.observe(editor.view.dom);
    sync();
    return () => { editor.off('selectionUpdate', sync); editor.off('transaction', sync); window.removeEventListener('resize', sync); window.removeEventListener('scroll', sync, true); observer.disconnect(); };
  }, [editor]);
  useEffect(() => { setMenu(''); setPreview(false); setBytes(null); }, [selected?.pos]);
  useEffect(() => {
    if (!preview) return;
    const controller = new AbortController();
    fetch(selected.img.src, { method: 'HEAD', signal: controller.signal }).then(r => setBytes(r.headers.get('content-length'))).catch(() => {});
    const key = e => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', key);
    return () => { controller.abort(); window.removeEventListener('keydown', key); };
  }, [preview]);
  useEffect(() => {
    if (!drag) return;
    const move = e => {
      const width = Math.round(Math.max(24, Math.min(drag.max, drag.width + (e.clientX - drag.x) * drag.direction * drag.factor)));
      update({ width });
    };
    const end = () => setDrag(null);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, [drag]);
  if (!selected) return null;
  const { node, rect, img, pos } = selected;
  const a = node.attrs;
  function update(attrs) {
    const current = editor.state.doc.nodeAt(selected.pos);
    if (current?.type.name === 'media') editor.view.dispatch(editor.state.tr.setNodeMarkup(selected.pos, undefined, { ...current.attrs, ...attrs }));
  }
  const ratio = img.naturalWidth / img.naturalHeight || rect.width / rect.height || 1;
  const width = Math.round(a.width || rect.width), height = Math.round(width / ratio);
  const wrap = a.layout === 'wrap-left' || a.layout === 'wrap-right';
  const aligned = a.align === 'left' || a.align === 'right' || a.layout === 'align-start' || a.layout === 'align-end';
  const begin = (e, direction) => {
    e.preventDefault();
    const area = editor.view.dom.closest('.editor') || editor.view.dom.parentElement;
    setDrag({ x: e.clientX, width: rect.width, direction, factor: wrap || aligned ? 1 : 2, max: Math.min(1800, area.clientWidth) });
  };
  const toggle = name => setMenu(menu === name ? '' : name);
  const sizeInput = (label, value, divisor) => <label>{label} <input key={`${label}-${width}`} type="number" min="24" max="1800" defaultValue={value} onBlur={e => { if (e.target.value && Number.isFinite(e.target.valueAsNumber)) update({ width: Math.round(Math.max(24, Math.min(1800, 1800 * ratio, e.target.valueAsNumber * divisor))) }); }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /></label>;
  return <>
    {(!wrap || a.layout === 'wrap-right') && <button aria-label="이미지 왼쪽 크기 조절" className="image-resize-handle" style={{ left: rect.left - 10, top: rect.top + rect.height / 2 - 32 }} onPointerDown={e => begin(e, -1)} />}
    {(!wrap || a.layout === 'wrap-left') && <button aria-label="이미지 오른쪽 크기 조절" className="image-resize-handle" style={{ left: rect.right + 6, top: rect.top + rect.height / 2 - 32 }} onPointerDown={e => begin(e, 1)} />}
    {drag && <div className="image-guides" style={{ left: rect.left, width: rect.width }} />}
    <div className="image-tools" role="toolbar" aria-label="이미지 도구" style={{ left: Math.max(8, Math.min(rect.left + rect.width / 2 - 210, window.innerWidth - 440)), top: Math.max(150, Math.min(rect.bottom + 12, window.innerHeight - 65)) }} onMouseDown={e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}>
      {drag ? <span>너비 {width} 높이 {height}</span> : <>
        <button aria-pressed={!!a.border} onClick={() => update({ border: !a.border })}>테두리</button>
        <button aria-label="테두리 옵션" onClick={() => toggle('border')}>⌄</button>
        <button onClick={() => toggle('align')}>정렬 ⌄</button>
        <button onClick={() => toggle('size')}>크기 ⌄</button>
        <button onClick={() => { setPreview(true); setZoom(100); }}>펼치기</button>
        <button aria-label="이미지 더 보기" onClick={() => toggle('more')}>⋯</button>
        {menu && <div className="image-menu">
          {menu === 'border' && <><span>색</span>{[['#DCDFE4','연한 회색'],['#8590A2','회색'],['#44546F','진한 회색']].map(([color,label]) => <button key={color} onClick={() => update({ border: true, borderColor: color })}>{label}</button>)}<span>굵기</span>{[[1,'가늘게'],[2,'보통'],[4,'굵게']].map(([n,label]) => <button key={n} onClick={() => update({ border: true, borderWidth: n })}>{label}</button>)}</>}
          {menu === 'align' && [['left','왼쪽'],['center','가운데'],['right','오른쪽'],['wrap-left','왼쪽에서 줄 바꿈'],['wrap-right','오른쪽에서 줄 바꿈']].map(([value,label]) => <button key={value} onClick={() => { update({ align: value.startsWith('wrap') ? null : value, layout: value.startsWith('wrap') ? value : null }); setMenu(''); }}>{label}</button>)}
          {menu === 'size' && <button onClick={() => { update({ width: null }); setMenu(''); }}>원래 크기</button>}
          {menu === 'resize' && <>{sizeInput('너비', width, 1)}{sizeInput('높이', height, ratio)}<button onClick={() => setMenu('')}>닫기</button></>}
          {menu === 'more' && <><button onClick={() => setMenu('resize')}>크기 조정</button><button onClick={() => { const dom = DOMSerializer.fromSchema(editor.schema).serializeNode(node);
            const copy = e => { e.preventDefault(); e.clipboardData.setData('text/html', dom.outerHTML); e.clipboardData.setData('text/plain', a.src || ''); };
            document.addEventListener('copy', copy);
            try { document.execCommand('copy'); } finally { document.removeEventListener('copy', copy); }
            setMenu(''); }}>복사</button><button onClick={() => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()}>삭제</button></>}
        </div>}
      </>}
    </div>
    {preview && <div className="image-preview" role="dialog" aria-modal="true" aria-label="이미지 전체 화면 보기"><header><span>{a.filename || '이미지'}<small>{bytes ? `${Number(bytes).toLocaleString()} 바이트` : '크기 정보 없음'}</small></span><a href={img.src} download={a.filename}>다운로드</a><button autoFocus onClick={() => setPreview(false)}>닫기</button></header><div className="image-preview-stage"><img src={img.src} alt={a.alt || a.filename || ''} style={{ width: `${(img.naturalWidth || width) * zoom / 100}px` }} /></div><footer><button onClick={() => setZoom(z => Math.max(10, z - 10))}>축소 −</button><button onClick={() => setZoom(z => Math.min(400, z + 10))}>확대 +</button> {zoom}%</footer></div>}
  </>;
}
