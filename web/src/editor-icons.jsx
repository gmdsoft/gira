// 편집기 툴바 아이콘 (직접 그린 단색 선 아이콘, 18px, currentColor) — 이모지(🖼 ☑ 등)는 글꼴·OS에 따라 깨져 보여 대체
import React from 'react';

const Svg = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>{children}</svg>
);

export const IconTask = () => (
  <Svg><rect x="2.5" y="2.5" width="13" height="13" rx="2.5" /><path d="M5.8 9.2l2.2 2.2 4.3-4.6" /></Svg>
);
export const IconImage = () => (
  <Svg><rect x="2" y="3" width="14" height="12" rx="2" /><circle cx="6.3" cy="7" r="1.4" /><path d="M2.5 13.2l4-4 3 3 2.3-2.3 3.7 3.7" /></Svg>
);
export const IconCode = () => (
  <Svg><path d="M6.5 4.5L2.5 9l4 4.5M11.5 4.5l4 4.5-4 4.5" /></Svg>
);
export const IconLayout = () => (
  <Svg><rect x="2" y="3" width="14" height="12" rx="1.8" /><path d="M9 3v12" /></Svg>
);
export const IconTable = () => (
  <Svg><rect x="2" y="3" width="14" height="12" rx="1.8" /><path d="M2 7.2h14M2 11h14M7 7.2V15M11.5 7.2V15" /></Svg>
);
export const IconPanel = () => (
  <Svg><circle cx="9" cy="9" r="6.8" /><path d="M9 8.2v4.3" /><circle cx="9" cy="5.6" r=".5" fill="currentColor" /></Svg>
);
export const IconExpand = () => (
  <Svg><rect x="2" y="3" width="14" height="12" rx="1.8" /><path d="M5.3 7.2L7.6 9.5 5.3 11.8M9.8 9.5h3.2" /></Svg>
);
export const IconDivider = () => (
  <Svg><path d="M2.5 9h13" /><path d="M5 5h8M5 13h8" strokeOpacity=".35" /></Svg>
);
export const IconLink = () => (
  <Svg><path d="M7.6 10.4a3 3 0 004.2 0l2.4-2.4a3 3 0 00-4.2-4.2l-1 1" /><path d="M10.4 7.6a3 3 0 00-4.2 0L3.8 10a3 3 0 004.2 4.2l1-1" /></Svg>
);
export const IconUndo = () => (
  <Svg><path d="M6.5 4.5L3.5 7.5l3 3" /><path d="M3.8 7.5h6.7a4 4 0 010 8H8" /></Svg>
);
export const IconRedo = () => (
  <Svg><path d="M11.5 4.5l3 3-3 3" /><path d="M14.2 7.5H7.5a4 4 0 000 8H10" /></Svg>
);
export const IconMention = () => (
  <Svg><circle cx="9" cy="9" r="2.8" /><path d="M11.8 9v1.2a2 2 0 004 0V9A6.8 6.8 0 109 15.8h2.5" /></Svg>
);
