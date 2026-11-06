import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { normalizeWhiteboard, fetchWhiteboard } from '../scripts/lib/confluence-whiteboard.mjs';
import { whiteboardSvg, whiteboardBounds } from '../web/src/whiteboard-svg.mjs';
function fixture() {
  const doc = new Y.Doc(), board = doc.getMap('board');
  const color = new Uint8Array(12), view = new DataView(color.buffer); [120, 200, 255].forEach((c, i) => view.setFloat32(i * 4, c));
  const str = new TextEncoder().encode('한글 <script>');
  board.set('section', { t: 'section', ti: '영역', c: color });
  board.set('shape', { t: 'shape', sh: 3, c: color, tx: Uint8Array.from([0, 1, 4, str.length, ...str, 0]) });
  board.set('sticky', { t: 'sticky', tx: '메모' });
  board.set('line', { t: 'connector', se: 'shape', te: 'sticky', sc: 1, ec: 2 });
  board.set('stamp', { t: 'stamp', si: 'success', at: { parentId: 'shape', offset: [5, 10] } });
  doc.getArray('dimensions').push(Object.entries({ 'p#section': [100, 200], 's#section': [500, 300], 'p#shape': [130, 240], 's#shape': [160, 160], 'bp#shape': [130, 238], 'bs#shape': [200, 40], 'p#sticky': [400, 300], 's#sticky': [80, 80] }).map(([key, val]) => ({ key, val })));
  doc.getArray('paths').push([{ key: 's#line', val: [330, 258] }, { key: 'e#line', val: [400, 328] }, { key: 'se#line', val: 'l,0,60 a,0,90,10,c l,90,60' }]);
  doc.getArray('zindex').push(['section', 'line', 'shape', 'sticky', 'stamp']);
  return Y.encodeStateAsUpdate(doc);
}
test('합성 Yjs: 계산된 경계·전역 좌표·색·UTF-8·첨부 위치·꺾임 경로 보존', () => {
  const data = normalizeWhiteboard(fixture()), shape = data.elements.find(e => e.id === 'shape');
  assert.deepEqual([shape.x, shape.y, shape.w, shape.h], [130, 238, 200, 40]);
  assert.equal(shape.color, 'rgb(120,200,255)'); assert.equal(shape.text, '한글 <script>');
  const stamp = data.elements.find(e => e.id === 'stamp'); assert.deepEqual([stamp.x, stamp.y], [135, 248]);
  assert.equal(data.connectors[0].path, 'M 330 258 L 390 258 Q 400 258 400 268 L 400 328');
  assert.equal(data.connectors[0].startArrow, false); assert.equal(data.connectors[0].endArrow, true);
  assert.match(data.plainText, /메모/);
  const svg = whiteboardSvg(data); assert.match(svg, /한글 &lt;script&gt;/); assert.ok(!svg.includes('<script>'));
  assert.ok(svg.indexOf('<rect') < svg.indexOf('M 330 258')); assert.match(svg, /foreignObject/);
  assert.ok(whiteboardBounds(data).every(Number.isFinite));
});
test('빈 보드 및 악성 속성도 유효하고 안전한 SVG', () => {
  assert.deepEqual(whiteboardBounds(normalizeWhiteboard({})), [0, 0, 1000, 600]);
  const data = normalizeWhiteboard({ board: { x: { t: 'image', name: '"><script>alert(1)</script>' } } });
  assert.ok(!whiteboardSvg(data).includes('<script>')); assert.ok(!whiteboardSvg(data).includes('NaN'));
});
test('화이트보드 referenceId 그대로 GET 수집, 원본 보관, 세션 토큰 제외', async () => {
  const binary = fixture();
  const result = await fetchWhiteboard('123', { site: 'https://example.test',
    get: async path => path.includes('tenant_info') ? { cloudId: 'cloud' } : path.includes('session/bulk') ? [{ data: { access: { token: 'synthetic-secret' } } }] : { referenceId: 'ari:cloud:canvas:cloud:whiteboard/ref' },
    fetchImpl: async (url, options) => { assert.ok(url.includes(encodeURIComponent('ari:cloud:canvas:cloud:whiteboard/ref'))); assert.equal(options.method, undefined); assert.equal(options.headers['x-access-token'], 'synthetic-secret'); return new Response(binary); },
  });
  assert.deepEqual(new Uint8Array(result.binary), binary); assert.ok(!JSON.stringify(result.data).includes('synthetic-secret'));
});
test('자유 그리기·회전 경계·커넥터 라벨과 빈 텍스트', () => {
  const data = normalizeWhiteboard({ board: {
    draw: { t: 'drawing', pt: [[-20, -10], [40, 50]] },
    line: { t: 'path', ec: 1 }, label: { t: 'pathLabel', pi: 'line', tx: '경로' },
    empty: { t: 'text', tx: { 0: 0, 1: 1, 2: 1, 3: 0 } },
  }, paths: [{ key: 's#line', val: [100, 100] }, { key: 'e#line', val: [200, 200] }] });
  assert.deepEqual(data.elements[0].points, [[-20, -10], [40, 50]]);
  assert.deepEqual([data.elements[0].x, data.elements[0].y, data.elements[0].w, data.elements[0].h], [-20, -10, 60, 60]);
  assert.equal(data.elements.find(e => e.id === 'empty').text, '');
  const label = data.elements.find(e => e.id === 'label'); assert.equal(label.x + label.w / 2, 150);
  const svg = whiteboardSvg(data); assert.match(svg, /polyline/); assert.match(svg, /경로/);
  assert.ok(!svg.includes('NaN'));
});
test('스냅샷 GET 실패를 빈 보드로 저장하지 않는다', async () => {
  await assert.rejects(fetchWhiteboard('bad', { site: 'https://example.test', get: async p => p.includes('tenant_info') ? { cloudId: 'x' } : p.includes('session') ? [{ data: { access: { token: 'test' } } }] : { referenceId: 'test' }, fetchImpl: async () => new Response('', { status: 403 }) }), /collab 403/);
});
