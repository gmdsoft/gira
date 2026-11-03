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
