// GIRA-55 로드맵: source 디코드와 막대 배치
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap, layoutRoadmap, roadmapSpec } from '../src/roadmap.js';

const src = encodeURIComponent(JSON.stringify({ title: '로드맵', timeline: { startDate: '2025-02-01 00:00:00', endDate: '2025-08-01 00:00:00', displayOption: 'MONTH' },
  lanes: [{ title: '작업', color: { lane: '#3b7fc4', bar: '#3b7fc4', text: '#ffffff' }, bars: [
    { title: '알림창', startDate: '2025-02-01 00:00:00', duration: 2, rowIndex: 0, pageLink: { id: '123' } },
    { title: '밖', startDate: '2024-01-01 00:00:00', duration: 1, rowIndex: 1 },
    { title: '둘째 줄', startDate: '2025-05-01 00:00:00', duration: 1, rowIndex: 1 }] }],
  markers: [{ title: '출시', markerDate: '2025-06-15 00:00:00' }] }));

test('URL 인코딩 source를 풀고 월 눈금·막대 위치를 계산한다', () => {
  const lay = layoutRoadmap(parseRoadmap(src));
  assert.equal(lay.ticks.length, 6);
  assert.equal(lay.ticks[0].at, 0);
  assert.equal(lay.lanes[0].bars.length, 2); // 기간 밖 막대 제외
  assert.equal(lay.lanes[0].rows, 2);
  const [a] = lay.lanes[0].bars;
  assert.equal(a.left, 0);
  assert.ok(a.width > 30 && a.width < 36); // 2개월 / 6개월
  assert.equal(lay.markers.length, 1);
});

test('렌더 사양: 문서 링크 막대, 잘못된 색은 기본값, 깨진 데이터는 안내', () => {
  const json = JSON.stringify(roadmapSpec({ source: src }));
  assert.match(json, /viewpage\.action\?pageId=123/);
  assert.match(json, /알림창/);
  assert.match(JSON.stringify(roadmapSpec({ source: '%7Bbad' })), /읽을 수 없습니다/);
  const evil = encodeURIComponent(JSON.stringify({ timeline: { startDate: '2025-01-01', endDate: '2025-03-01' }, lanes: [{ title: 'x', color: { bar: 'red;background:url(x)' }, bars: [{ title: 'b', startDate: '2025-01-01', duration: 1 }] }] }));
  assert.doesNotMatch(JSON.stringify(roadmapSpec({ source: evil })), /url\(x\)/);
});
