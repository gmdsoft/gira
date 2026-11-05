// 타입·우선순위 SVG 아이콘 (자체 드로잉 — Atlassian 에셋을 복사하지 않는다)
import React from 'react';

// ---------- 이슈 타입: 색 사각형 + 흰 글리프 ----------
const TYPE_STYLES = {
  task:        { bg: '#1d7afc', glyph: <path d="M3.5 7.3l2.2 2.2 4.8-4.9" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
  subtask:     { bg: '#1d7afc', glyph: <><rect x="3" y="3" width="4.6" height="4.6" rx="0.8" fill="#fff" /><rect x="6.4" y="6.4" width="4.6" height="4.6" rx="0.8" fill="#fff" opacity="0.72" /></> },
  bug:         { bg: '#c9372c', glyph: <circle cx="7" cy="7" r="2.7" fill="#fff" /> },
  story:       { bg: '#22a06b', glyph: <path d="M4.6 3h4.8v8L7 9.2 4.6 11z" fill="#fff" /> },
  epic:        { bg: '#8270db', glyph: <path d="M7.9 2.4L4.3 7.8h2.3l-.9 3.8 3.9-5.6H7.2z" fill="#fff" /> },
  improvement: { bg: '#22a06b', glyph: <path d="M7 11V4M4.3 6.7L7 4l2.7 2.7" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
  feature:     { bg: '#2898bd', glyph: <path d="M7 4v6M4 7h6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /> },
  idea:        { bg: '#fca700', glyph: <><circle cx="7" cy="6" r="2.4" fill="#fff" /><rect x="5.9" y="8.8" width="2.2" height="1.8" rx="0.6" fill="#fff" /></> },
  test:        { bg: '#6554c0', glyph: <><rect x="4" y="3" width="6" height="8" rx="1" fill="none" stroke="#fff" strokeWidth="1.3" /><path d="M5.5 7.2l1.1 1.1 2-2.1" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" /></> },
};

function typeKind(name = '') {
  if (name.includes('에픽')) return 'epic';
  if (name.includes('하위') || name.includes('부작업')) return 'subtask';
  if (name.includes('버그')) return 'bug';
  if (name.includes('스토리')) return 'story';
  if (name.includes('개선')) return 'improvement';
  if (name.includes('새 기능')) return 'feature';
  if (name.includes('아이디어')) return 'idea';
  if (name.includes('테스트')) return 'test';
  return 'task';
}

export function TypeIcon({ name, size = 14 }) {
  if (!name) return null;
  const { bg, glyph } = TYPE_STYLES[typeKind(name)];
  return (
    <svg className="ticon" width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={name}>
      <title>{name}</title>
      <rect width="14" height="14" rx="2.5" fill={bg} />
      {glyph}
    </svg>
  );
}

// ---------- 우선순위: 셰브런/바 ----------
const chev = (y, flip) => <path d={flip ? `M3.2 ${y}L7 ${y + 3.2} 10.8 ${y}` : `M3.2 ${y}L7 ${y - 3.2} 10.8 ${y}`}
  stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" key={y} />;
const PRIO_STYLES = {
  Highest: { color: '#c9372c', glyph: <>{chev(6.2)}{chev(11)}</> },
  High:    { color: '#c9372c', glyph: chev(9) },
  Normal:  { color: '#e56910', glyph: <><rect x="3" y="4.2" width="8" height="1.9" rx="0.9" fill="currentColor" /><rect x="3" y="7.9" width="8" height="1.9" rx="0.9" fill="currentColor" /></> },
  Medium:  { color: '#e56910', glyph: <><rect x="3" y="4.2" width="8" height="1.9" rx="0.9" fill="currentColor" /><rect x="3" y="7.9" width="8" height="1.9" rx="0.9" fill="currentColor" /></> },
  Low:     { color: '#1d7afc', glyph: chev(5, true) },
  Lowest:  { color: '#1d7afc', glyph: <>{chev(3.4, true)}{chev(7.8, true)}</> },
};

export function PrioIcon({ p, size = 14 }) {
  if (!p) return null;
  const st = PRIO_STYLES[p] ?? { color: '#626f86', glyph: <circle cx="7" cy="7" r="2" fill="currentColor" /> };
  return (
    <svg className="picon" width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={p} style={{ color: st.color }}>
      <title>{p}</title>
      {st.glyph}
    </svg>
  );
}

// ---------- Jira UI 아이콘 (자체 드로잉, 16px 기준) ----------
const Svg = ({ children, size = 16, className = '', viewBox = '0 0 24 24', fill = 'none' }) => (
  <svg className={`jicon ${className}`} width={size} height={size} viewBox={viewBox} fill={fill}
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconGrid = (p) => <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Svg>;
export const IconSearch = (p) => <Svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M16 16l5 5" /></Svg>;
export const IconPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconSparkle = (p) => <Svg {...p}><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></Svg>;
export const IconBell = (p) => <Svg {...p}><path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10 19a2 2 0 004 0" /></Svg>;
export const IconHelp = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.6 2.6 0 114.3 2.1c-1 .7-1.9 1.2-1.9 2.7" /><path d="M12 17.2h.01" /></Svg>;
export const IconSettings = (p) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></Svg>;
export const IconChevronDown = (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
export const IconChevronRight = (p) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
export const IconFilter = (p) => <Svg {...p}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></Svg>;
export const IconGroup = (p) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /><path d="M8 4v6M16 11v6" /></Svg>;
export const IconRefresh = (p) => <Svg {...p}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8A7 7 0 0118 6l2 3M17.9 16A7 7 0 016 18l-2-3" /></Svg>;
export const IconMore = (p) => <Svg {...p}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Svg>;
export const IconList = (p) => <Svg {...p}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></Svg>;
export const IconTable = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 15h18M9 4v16M15 4v16" /></Svg>;
export const IconBoard = (p) => <Svg {...p}><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="10" y="4" width="5" height="11" rx="1.2" /><rect x="17" y="4" width="4" height="14" rx="1.2" /></Svg>;
export const IconBacklog = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="4" rx="1.2" /><rect x="3" y="10" width="18" height="4" rx="1.2" /><rect x="3" y="16" width="18" height="4" rx="1.2" /></Svg>;
export const IconLock = (p) => <Svg {...p}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></Svg>;
export const IconShare = (p) => <Svg {...p}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" /></Svg>;
export const IconEye = (p) => <Svg {...p}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></Svg>;
export const IconLink = (p) => <Svg {...p}><path d="M10 13a5 5 0 007.1 0l1.4-1.4a5 5 0 00-7.1-7.1L10 5.9" /><path d="M14 11a5 5 0 00-7.1 0l-1.4 1.4a5 5 0 007.1 7.1L14 18.1" /></Svg>;
export const IconPaperclip = (p) => <Svg {...p}><path d="M20 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.9-8.9a3.5 3.5 0 014.9 4.9l-8.9 8.9a2 2 0 01-2.8-2.8l7.8-7.8" /></Svg>;
export const IconCheck = (p) => <Svg {...p}><path d="M4 12.5l5 5L20 6.5" /></Svg>;
export const IconChevronLeft = (p) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>;
export const IconClock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconStar = (p) => <Svg {...p}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></Svg>;
export const IconSpace = (p) => <Svg {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></Svg>;
export const IconDashboard = (p) => <Svg {...p}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></Svg>;
export const IconExpand = (p) => <Svg {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></Svg>;
export const IconBolt = (p) => <Svg {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></Svg>;
export const IconComment = (p) => <Svg {...p}><path d="M21 12a8 8 0 01-8 8H5l-2 2V12a8 8 0 018-8h2a8 8 0 018 8z" /></Svg>;
export const IconHistory = (p) => <Svg {...p}><path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4" /><path d="M3 4v4h4M12 7v5l3 2" /></Svg>;
export const IconUser = (p) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></Svg>;
export const IconProject = (p) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9z" /></Svg>;

export const IconClose = (p) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconTag = (p) => <Svg {...p}><path d="M20 13l-7 7-9-9V4h7l9 9z" /><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" /></Svg>;
export const IconInfo = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
