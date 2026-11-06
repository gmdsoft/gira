// 원본 Confluence '로드맵 계획(roadmap)' 매크로를 정적 타임라인으로 (GIRA-55)
// 원본 파라미터 source = URL 인코딩 JSON:
//   { title, timeline: { startDate, endDate, displayOption: MONTH|WEEK },
//     lanes: [{ title, color: { lane, bar, text }, bars: [{ title, description, startDate, duration, rowIndex, pageLink: { id, title } }] }],
//     markers: [{ title, markerDate }] }
// duration 단위는 displayOption(월 또는 주). 편집(막대 끌기)은 범위 밖.

const DAY = 86400000;
const parseDate = (s) => { const d = new Date(String(s ?? '').replace(' ', 'T')); return Number.isNaN(d.getTime()) ? null : d; };

export function parseRoadmap(source) {
  if (!source) return null;
  if (typeof source === 'object') return source;
  let text = String(source);
  for (let i = 0; i < 2 && /%7B|%22/i.test(text); i++) { try { text = decodeURIComponent(text); } catch { break; } }
  try { return JSON.parse(text); } catch { return null; }
}

// 월(또는 주) 눈금과 막대 위치(%)를 계산한다 — 렌더와 테스트가 같이 쓴다
export function layoutRoadmap(data) {
  const start = parseDate(data?.timeline?.startDate);
  const end = parseDate(data?.timeline?.endDate);
  if (!start || !end || end <= start) return null;
  const weekly = data.timeline.displayOption === 'WEEK';
  const span = end - start;
  const pct = (d) => ((d - start) / span) * 100;
  const ticks = [];
  if (weekly) {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 7 * DAY)) ticks.push({ at: pct(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
  } else {
    // 시작 달은 중간에서 시작해도 0 위치에 그 달 이름을 둔다 (원본과 같게)
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      ticks.push({ at: Math.max(0, pct(d)), label: d.getMonth() === 0 && ticks.length ? `${d.getFullYear()}년 1월` : `${d.getMonth() + 1}월` });
    }
  }
  const lanes = (data.lanes ?? []).map((lane) => {
    const bars = (lane.bars ?? []).map((b) => {
      const s = parseDate(b.startDate);
      if (!s) return null;
      const dur = Number(b.duration) || 0;
      const e = weekly ? new Date(s.getTime() + dur * 7 * DAY) : new Date(s.getTime() + dur * 30.4375 * DAY);
      const left = Math.max(0, pct(s));
      const right = Math.min(100, pct(e));
      if (right <= 0 || left >= 100) return null; // 기간 밖
      return { title: b.title ?? '', description: b.description ?? '', row: Number(b.rowIndex) || 0, left, width: Math.max(0.8, right - left), pageId: b.pageLink?.id ?? null };
    }).filter(Boolean);
    const rows = Math.max(1, ...bars.map((b) => b.row + 1));
    return { title: lane.title ?? '', color: lane.color ?? {}, bars, rows };
  });
  const markers = (data.markers ?? []).map((m) => ({ title: m.title ?? '', at: pct(parseDate(m.markerDate) ?? start) })).filter((m) => m.at >= 0 && m.at <= 100);
  return { title: data.title ?? '', year: start.getFullYear(), ticks, lanes, markers };
}

const safeColor = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(c ?? '')) ? c : fallback);

// ProseMirror DOMOutputSpec (보기·편집·서버 직렬화 공통). 숨은 콘텐츠 홀은 호출하는 쪽이 붙인다.
export function roadmapSpec(params) {
  const lay = layoutRoadmap(parseRoadmap(params?.source));
  if (!lay) return ['div', { class: 'roadmap roadmap-empty' }, '로드맵 데이터를 읽을 수 없습니다'];
  const ROW = 34;
  const head = ['div', { class: 'roadmap-head' }, ['div', { class: 'roadmap-lane-title roadmap-year' }, `${lay.year}년`],
    ['div', { class: 'roadmap-scale' }, ...lay.ticks.map((t) => ['span', { class: 'roadmap-tick', style: `left:${t.at.toFixed(3)}%` }, t.label])]];
  const lanes = lay.lanes.map((lane) => ['div', { class: 'roadmap-lane', style: `height:${lane.rows * ROW + 8}px` },
    ['div', { class: 'roadmap-lane-title', style: `background:${safeColor(lane.color.lane, '#3b7fc4')};color:${safeColor(lane.color.text, '#ffffff')}` }, lane.title],
    ['div', { class: 'roadmap-track' },
      ...lay.ticks.map((t) => ['span', { class: 'roadmap-grid', style: `left:${t.at.toFixed(3)}%` }]),
      ...lane.bars.map((b) => {
        const style = `left:${b.left.toFixed(3)}%;width:${b.width.toFixed(3)}%;top:${b.row * ROW + 4}px;background:${safeColor(lane.color.bar, '#3b7fc4')};color:${safeColor(lane.color.text, '#ffffff')}`;
        const attrs = { class: 'roadmap-bar', style, title: [b.title, b.description].filter(Boolean).join('\n') };
        return b.pageId
          ? ['a', { ...attrs, href: `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(b.pageId)}` }, b.title]
          : ['div', attrs, b.title];
      }),
      ...lay.markers.map((m) => ['span', { class: 'roadmap-marker', style: `left:${m.at.toFixed(3)}%`, title: m.title }]),
    ]]);
  const markerLabels = lay.markers.length
    ? [['div', { class: 'roadmap-head' }, ['div', { class: 'roadmap-lane-title' }], ['div', { class: 'roadmap-scale' },
        ...lay.markers.map((m) => ['span', { class: 'roadmap-marker-label', style: `left:${m.at.toFixed(3)}%` }, m.title])]]]
    : [];
  return ['div', { class: 'roadmap', role: 'img', 'aria-label': lay.title || '로드맵' }, ['div', { class: 'roadmap-inner' }, head, ...lanes, ...markerLabels]];
}
