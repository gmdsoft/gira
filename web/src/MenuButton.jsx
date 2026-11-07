// 작은 드롭다운 메뉴 (••• 메뉴·보기 탭 메뉴 공용) — 바깥 클릭·Esc로 닫힘
// items: [{ label, icon?, onClick, disabled?, danger?, hint? } | '-' (구분선) | { heading }]
import React, { useEffect, useRef, useState } from 'react';
import { WbIcon } from './whiteboard-icons.jsx';

export default function MenuButton({ label, icon = 'more', items, className = 'wb-btn icon', title, align = 'right', children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const box = useRef(null);
  const btn = useRef(null);
  // 화면 기준으로 띄운다 — 감싼 카드(overflow: hidden)에 잘리지 않게
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btn.current.getBoundingClientRect();
    setPos(align === 'left' ? { top: r.bottom + 4, left: r.left } : { top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const shut = () => setOpen(false);
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    window.addEventListener('resize', shut); window.addEventListener('scroll', shut, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true); };
  }, [open]);
  return <span className="mb-wrap" ref={box}>
    <button ref={btn} type="button" className={className} title={title ?? label} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={toggle}>{children ?? <WbIcon name={icon} />}</button>
    {open && <div className="mb-menu" role="menu" style={{ position: 'fixed', ...pos }}>
      {items.filter(Boolean).map((it, i) => it === '-' ? <div key={i} className="mb-sep" role="separator" />
        : it.heading ? <div key={i} className="mb-head">{it.heading}</div>
        : <button key={i} type="button" role="menuitem" className={`mb-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} title={it.hint}
          onClick={() => { setOpen(false); it.onClick?.(); }}>{it.icon && <WbIcon name={it.icon} />}<span>{it.label}</span></button>)}
    </div>}
  </span>;
}

// 파일 내려받기
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 작은 대화 상자 (내보내기·가져오기 옵션)
export function Dialog({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return <div className="mb-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`mb-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="mb-dialog-head"><h3>{title}</h3><button type="button" className="wb-btn icon" aria-label="닫기" onClick={onClose}><WbIcon name="close" /></button></div>
      <div className="mb-dialog-body">{children}</div>
      {footer && <div className="mb-dialog-foot">{footer}</div>}
    </div>
  </div>;
}
