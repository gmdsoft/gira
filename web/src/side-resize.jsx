// 사이드바 폭 조절 (GIRA-80) — Gira·Gonfluence 공용.
// 사이드바 오른쪽 경계의 손잡이를 끌어 폭을 바꾸고, 정한 폭은 브라우저(localStorage)에 기억한다.
// 두 번 누르면 기본 폭으로, 손잡이에 초점을 두고 ←/→ 키로도 바꿀 수 있다. 모바일 보기에서는 쓰지 않는다(호출하는 쪽이 감춤).
import React, { useCallback, useRef, useState } from 'react';
import './side-resize.css';

export const SIDE_MIN = 200;
export const SIDE_MAX = 600;
const KEY_STEP = 16;

// 창이 좁을 때 본문이 남도록 창 폭의 60%를 넘지 않게 한다.
export const clampSideWidth = (w, viewport = window.innerWidth) =>
  Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, viewport * 0.6, w)));

const readWidth = (storageKey) => {
  try {
    const v = Number(localStorage.getItem(storageKey));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
};

// 저장된 폭(없으면 null = CSS 기본 폭)과 바꾸기·저장 함수를 돌려준다.
export function useSideWidth(storageKey) {
  const [width, setWidthState] = useState(() => { const w = readWidth(storageKey); return w == null ? null : clampSideWidth(w); });
  const setWidth = useCallback((w, save = true) => {
    setWidthState(w);
    if (!save) return;
    try {
      if (w == null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(w));
    } catch { /* 저장 못 해도 이번 화면에서는 적용 */ }
  }, [storageKey]);
  return [width, setWidth];
}

// 사이드바 바로 뒤(같은 flex 줄)에 두는 손잡이. sideRef는 현재 폭을 재는 사이드바 요소.
export function SideResizer({ sideRef, width, setWidth, className = '' }) {
  const drag = useRef(null);
  const current = () => width ?? sideRef.current?.getBoundingClientRect().width ?? SIDE_MIN;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: current(), last: null };
    document.body.classList.add('side-resizing');
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const w = clampSideWidth(drag.current.w + e.clientX - drag.current.x);
    drag.current.last = w;
    setWidth(w, false);
  };
  const end = () => {
    if (!drag.current) return;
    const { last } = drag.current;
    drag.current = null;
    document.body.classList.remove('side-resizing');
    if (last != null) setWidth(last);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setWidth(clampSideWidth(current() + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP)));
  };

  return (
    <div className={`side-resizer ${className}`.trim()} role="separator" aria-orientation="vertical"
      aria-label="사이드바 폭 조절" aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX}
      aria-valuenow={Math.round(current())} tabIndex={0}
      title="끌어서 사이드바 폭 조절 · 두 번 누르면 기본 폭"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      onLostPointerCapture={end} onDoubleClick={() => setWidth(null)} onKeyDown={onKeyDown} />
  );
}
