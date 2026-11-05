// 타입·우선순위 SVG 아이콘 (자체 드로잉 — Atlassian 에셋을 복사하지 않는다)
import React from 'react';

// ---------- 이슈 타입: Jira 업무 유형 아이콘(16px, 채움) ----------
// Jira 업무 유형 아이콘과 같은 형태·색으로 맞춘 자체 드로잉
const TYPE_STYLES = {
  // 작업: 파란 사각형 + 체크
  task:        { color: '#4688EC', d: 'M1 3C1 1.89543 1.89543 1 3 1H13C14.1046 1 15 1.89543 15 3V13C15 14.1046 14.1046 15 13 15H3C1.89543 15 1 14.1046 1 13V3ZM3 2.5C2.72386 2.5 2.5 2.72386 2.5 3V13C2.5 13.2761 2.72386 13.5 3 13.5H13C13.2761 13.5 13.5 13.2761 13.5 13V3C13.5 2.72386 13.2761 2.5 13 2.5H3ZM12.3262 5.48014L7.32617 11.4801C7.18367 11.6511 6.97258 11.75 6.75 11.75C6.52742 11.75 6.31633 11.6511 6.17383 11.4801L3.67383 8.48014L4.82617 7.51986L6.75 9.82846L11.1738 4.51986L12.3262 5.48014Z' },
  // 하위 작업: 파란 사각형 두 개
  subtask:     { color: '#357DE8', d: 'M13.5 9.25a.5.5 0 0 0-.5-.5H8.75V13a.5.5 0 0 0 .5.5H13a.5.5 0 0 0 .5-.5zM7.25 3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v3.75a.5.5 0 0 0 .5.5h4.25zm1.5 4.25H13a2 2 0 0 1 2 2V13a2 2 0 0 1-2 2H9.25a2 2 0 0 1-2-2V8.75H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h3.75a2 2 0 0 1 2 2z' },
  // 버그: 빨간 무당벌레
  bug:         { color: '#F15B50', d: 'M8 2.5C7.17157 2.5 6.5 3.17157 6.5 4H9.5C9.5 3.17157 8.82843 2.5 8 2.5ZM11 4.02074V4C11 2.34315 9.65685 1 8 1C6.34315 1 5 2.34315 5 4V4.02074C4.70952 4.06947 4.44734 4.2017 4.239 4.39189L3.35231 3.75855L2.43536 1.6954L1.06464 2.3046L2.00928 4.43004C2.0999 4.63393 2.24344 4.80985 2.425 4.93953L3.75 5.88596V7H0.5V8.5H3.75V9.64872L2.60021 10.6069C2.46773 10.7173 2.35953 10.8539 2.28241 11.0081L1.07918 13.4146L2.42082 14.0854L3.60066 11.7257L4.06124 11.3419C4.69682 12.9183 6.23827 14 8.00146 14H8.25C9.96908 14 11.4349 12.9156 12.0006 11.3934L12.3993 11.7257L13.5791 14.0854L14.9208 13.4146L13.7176 11.0081C13.6405 10.8539 13.5323 10.7173 13.3998 10.6069L12.25 9.64872V8.5H15.5V7H12.25V5.88596L13.575 4.93953C13.7566 4.80985 13.9001 4.63393 13.9907 4.43004L14.9353 2.3046L13.5646 1.6954L12.6477 3.75855L11.761 4.39189C11.5527 4.2017 11.2905 4.06947 11 4.02074ZM10.75 10V5.5H5.25V9.94265L5.28488 10.1694C5.49117 11.5102 6.64486 12.5 8.00146 12.5H8.25C9.63071 12.5 11 11.3807 11 10Z' },
  // 스토리: 초록 북마크
  story:       { color: '#6A9A23', d: 'M3.5 1h9a1.5 1.5 0 0 1 1.5 1.5V15l-6-3.4L2 15V2.5A1.5 1.5 0 0 1 3.5 1z' },
  // 에픽: 보라 번개
  epic:        { color: '#BF63F3', d: 'M10.271.050656c.2887.111871.479.38969.479.699344v4.63515l3.1471.62941c.2652.05303.4812.24469.5655.50161s.0238.53933-.1584.73914l-7.74997 8.49999c-.20863.2288-.53644.3059-.82517.194-.28874-.1118-.47905-.3896-.47905-.6993v-4.6351l-3.14708-.62947c-.26515-.05303-.48123-.24468-.56553-.5016-.08431-.25692-.02379-.53933.1584-.73915l7.75-8.499996c.20863-.2288201.53643-.305899.8252-.194028zm-6.57276 8.724134 3.05177.61036v3.92915l5.55179-6.08909-3.05179-.61036v-3.9291z' },
  // 개선: 초록 위 화살표
  improvement: { color: '#6A9A23', d: 'M8.75 15V3.56l3.72 3.72 1.06-1.06-5-5a.75.75 0 0 0-1.06 0l-5 5 1.06 1.06 3.72-3.72V15z' },
  // 새 기능: 초록 사각형 + 플러스
  feature:     { color: '#6A9A23', d: 'M1 3C1 1.89543 1.89543 1 3 1H13C14.1046 1 15 1.89543 15 3V13C15 14.1046 14.1046 15 13 15H3C1.89543 15 1 14.1046 1 13V3ZM3 2.5C2.72386 2.5 2.5 2.72386 2.5 3V13C2.5 13.2761 2.72386 13.5 3 13.5H13C13.2761 13.5 13.5 13.2761 13.5 13V3C13.5 2.72386 13.2761 2.5 13 2.5H3ZM7.25 8.75V12H8.75V8.75H12V7.25H8.75V4H7.25V7.25H4V8.75H7.25Z' },
  // 아이디어: 노란 전구
  idea:        { color: '#E2A03F', d: 'M8 1a5 5 0 0 1 3.1 8.92c-.4.33-.6.79-.6 1.28V12H5.5v-.8c0-.49-.2-.95-.6-1.28A5 5 0 0 1 8 1zM5.5 13h5v.6a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 5.5 13.6z' },
  // 테스트: 보라 문서 + 체크
  test:        { color: '#8270DB', d: 'M3 1.5A1.5 1.5 0 0 1 4.5 0h4.8L14 4.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 14.5zM9.5 1.5V5H13zM6 9.2l1.6 1.6 3-3.1 1.1 1.1-4.1 4.2L4.9 10.3z' },
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

export function TypeIcon({ name, size = 16 }) {
  if (!name) return null;
  const st = TYPE_STYLES[typeKind(name)];
  return (
    <svg className="ticon" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={name}
      fill="none" style={{ color: st.color }}>
      <title>{name}</title>
      <path d={st.d} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
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
