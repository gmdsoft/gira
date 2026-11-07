// 화이트보드 편집 저장·변환 (GIRA-74) — 합성 데이터만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWhiteboard, saveWhiteboard, emptyWhiteboard } from '../server/src/whiteboard-edit.mjs';
import { toExcalidrawScene, sceneForSave } from '../web/src/whiteboard-excalidraw.mjs';

const el = (id, extra) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 1, ...extra });

test('검증: 형식·위험 링크·이미지 형식 거부, 지운 요소·안 쓰는 이미지 제거, 검색 글자 추출', () => {
  assert.throws(() => validateWhiteboard({ format: 'x', elements: [] }), /잘못된/);
  assert.throws(() => validateWhiteboard({ format: 'excalidraw', elements: [el('a', { link: ' javascript:alert(1)' })] }), /링크/);
  assert.throws(() => validateWhiteboard({ format: 'excalidraw', elements: [el('a')], files: { f: { dataURL: 'data:text/html;base64,AAAA' } } }), /이미지/);
  const clean = validateWhiteboard({
    format: 'excalidraw',
    elements: [el('a'), el('gone', { isDeleted: true }), { id: 't', type: 'text', text: '회의 메모' }, { id: 'f', type: 'frame', name: '섹션 A' }, el('img', { type: 'image', fileId: 'used' })],
    files: { used: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA' }, unused: { mimeType: 'image/png', dataURL: 'data:image/png;base64,BBBB' } },
  });
  assert.deepEqual(clean.elements.map((e) => e.id), ['a', 't', 'f', 'img']);
  assert.deepEqual(Object.keys(clean.files), ['used']);
  assert.equal(clean.plainText, '회의 메모\n섹션 A');
});

test('저장: 버전 충돌은 409, 성공하면 새 버전 스냅샷·버전 기록·현재 버전 갱신', async () => {
  const calls = [];
  const client = (currentVersion) => ({ query: async (sql, params) => { calls.push([sql.split(/\s+/).slice(0, 3).join(' '), params]);
    if (sql.startsWith('SELECT type')) return { rows: [{ type: 'whiteboard', current_version: currentVersion }] };
    if (sql.startsWith('SELECT data')) return { rows: [{ data: emptyWhiteboard() }] };
    return { rows: [] }; } });
  const stale = await saveWhiteboard(client(5), { id: 1, baseVersion: 4, data: emptyWhiteboard(), userId: 9 });
  assert.equal(stale.status, 409); assert.equal(stale.currentVersion, 5);
  calls.length = 0;
  const ok = await saveWhiteboard(client(5), { id: 1, baseVersion: 5, data: { ...emptyWhiteboard(), elements: [el('a')] }, userId: 9 });
  assert.deepEqual(ok, { status: 200, version: 6 });
  assert.ok(calls.some(([s, p]) => s.startsWith('INSERT INTO whiteboard_snapshots') && p[1] === 6));
  assert.ok(calls.some(([s]) => s.startsWith('UPDATE content')));
});

test('이관 원본 → Excalidraw 장면: 섹션은 프레임+배경, 아이콘은 SVG 이미지, 커넥터는 묶인 화살표', () => {
  const scene = toExcalidrawScene({
    elements: [
      { id: 'sec', type: 'section', x: 0, y: 0, w: 400, h: 300, color: 'rgb(200,230,250)', sectionTitle: 'API 구현' },
      { id: 'a', type: 'shape', shape: 1, x: 20, y: 20, w: 100, h: 40, color: 'rgb(255,255,255)', strokeColor: 'rgb(0,0,0)', text: '상자 A' },
      { id: 'p', type: 'shape', icon: 'person', x: 500, y: 0, w: 80, h: 120, color: 'rgb(150,200,100)', strokeColor: 'rgb(50,100,0)', text: '재봉' },
    ],
    connectors: [{ id: 'c', from: 'p', to: 'a', start: [580, 40], end: [120, 40], waypoints: [[580, 40], [600, 40], [600, 100], [120, 100]], color: 'rgb(66,82,110)', endArrow: true, dashed: true }],
  });
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  assert.equal(byId.get('sec').type, 'frame'); assert.equal(byId.get('sec').name, 'API 구현');
  assert.equal(byId.get('sec-bg').backgroundColor, '#c8e6fa');
  assert.equal(byId.get('a').frameId, 'sec');
  assert.equal(byId.get('p').type, 'image'); assert.match(scene.files['icon-p'].dataURL, /^data:image\/svg\+xml;base64,/);
  const arrow = byId.get('c');
  assert.deepEqual(arrow.points, [[0, 0], [20, 0], [20, 60], [-460, 60]]);
  assert.equal(arrow.strokeStyle, 'dashed'); assert.equal(arrow.endBinding.elementId, 'a');
  assert.ok(byId.get('a').boundElements.some((b) => b.id === 'c'));
  assert.equal(scene.elements[0].type, 'frame');
  // 저장용: 지운 요소와 안 쓰는 이미지 제거 → 서버 검증 통과
  const saved = sceneForSave([...scene.elements, el('x', { isDeleted: true })], { ...scene.files, junk: { dataURL: 'data:image/png;base64,AA' } }, {});
  assert.ok(!saved.elements.some((e) => e.id === 'x')); assert.ok(!saved.files.junk);
  assert.doesNotThrow(() => validateWhiteboard(saved));
});
