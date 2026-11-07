// 화이트보드 상단 바 아이콘 (16px, 선 아이콘)
import React from 'react';

const P = {
  pencil: <><path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" /><path d="M10 4l2 2" /></>,
  hand: <><path d="M5.5 8V3.5a1 1 0 0 1 2 0V7" /><path d="M7.5 6.5V2.8a1 1 0 0 1 2 0V7" /><path d="M9.5 7V3.8a1 1 0 0 1 2 0V9" /><path d="M5.5 8.5l-.9-1.2a1 1 0 0 0-1.6 1.2l2.2 3.4A4 4 0 0 0 8.6 14H9a3.5 3.5 0 0 0 3.5-3.5V5.8a1 1 0 0 0-1-1" /></>,
  fit: <><path d="M2.5 6V2.5H6" /><path d="M10 2.5h3.5V6" /><path d="M13.5 10v3.5H10" /><path d="M6 13.5H2.5V10" /></>,
  minus: <path d="M3.5 8h9" />,
  plus: <><path d="M3.5 8h9" /><path d="M8 3.5v9" /></>,
  check: <path d="M3 8.5l3.2 3L13 4.5" />,
  close: <><path d="M4 4l8 8" /><path d="M12 4l-8 8" /></>,
  board: <><rect x="2" y="2.5" width="12" height="9" rx="1.5" /><path d="M5.5 14l2.5-2.5 2.5 2.5" /></>,
  history: <><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v2.5H5" /><path d="M8 5v3l2 1.5" /></>,
};

export function WbIcon({ name }) {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>;
}
