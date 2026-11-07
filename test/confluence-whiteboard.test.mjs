import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { normalizeWhiteboard, fetchWhiteboard, fetchWhiteboardExtras, fitConnectorRoute, canvasText, canvasRich, roundedPath, whiteboardImageName } from '../scripts/lib/confluence-whiteboard.mjs';
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
  // bp#는 중심 → 왼쪽 위 = 중심 - 크기/2
  assert.deepEqual([shape.x, shape.y, shape.w, shape.h], [30, 218, 200, 40]);
  assert.equal(shape.color, 'rgb(120,200,255)'); assert.equal(shape.text, '한글 <script>');
  const stamp = data.elements.find(e => e.id === 'stamp'); assert.deepEqual([stamp.x, stamp.y], [35, 228]);
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
test('붙은 커넥터는 요소의 붙은 지점에서 다시 잇고, 꺾임 방향은 유지한다', () => {
  // 저장된 경로(s#·e#·se#)는 옛 배치 기준이라 끝점이 요소와 어긋나 있다
  const data = normalizeWhiteboard({
    board: {
      a: { t: 'shape', sh: 1 }, b: { t: 'shape', sh: 1 },
      line: { t: 'connector', se: 'a', sa: { left: 0.5, top: 1 }, te: 'b', ta: { left: 0, top: 0.5 }, sc: 1, ec: 2, sts: 2 },
    },
    dimensions: [{ key: 'p#a', val: [100, 100] }, { key: 's#a', val: [100, 40] }, { key: 'p#b', val: [400, 300] }, { key: 's#b', val: [100, 40] }],
    paths: [{ key: 's#line', val: [0, 0] }, { key: 'e#line', val: [50, 50] }, { key: 'se#line', val: 'l,90,30 a,90,0,10,a l,0,10' }],
  });
  const c = data.connectors[0];
  assert.deepEqual(c.start, [100, 120]); assert.deepEqual(c.end, [350, 300]);
  assert.equal(c.path, 'M 100 120 L 100 290 Q 100 300 110 300 L 350 300');
  assert.equal(c.dashed, true);
});
test('맞출 수 없는 경로는 직각 꺾은선으로', () => {
  const r = fitConnectorRoute([0, 0], [100, 50], 'l,180,30', 0);
  assert.equal(r.path, 'M 0 0 L 42 0 Q 50 0 50 8 L 50 42 Q 50 50 58 50 L 100 50'); // 모서리는 둥글게 (GIRA-78)
  assert.deepEqual(r.waypoints, [[0, 0], [50, 0], [50, 50], [100, 50]]);
});
test('아이콘 도형은 위 끝(bp#.y)과 중심(p#)으로 크기를 잡고, 해결된 댓글은 숨긴다', () => {
  const data = normalizeWhiteboard({
    board: { person: { t: 'shape', sh: 37, tx: '예성' }, done: { t: 'comment', r: true, at: { parentId: 'person', offset: [0, 0] } } },
    dimensions: [{ key: 'p#person', val: [0, 0] }, { key: 's#person', val: [160, 206] }, { key: 'bp#person', val: [0, -60] }, { key: 'bs#person', val: [86, 1] }],
  });
  assert.equal(data.elements.length, 1);
  const p = data.elements[0];
  assert.equal(p.icon, 'person'); assert.equal(p.h, 120); assert.equal(p.y, -60); assert.equal(p.x + p.w / 2, 0);
  assert.match(whiteboardSvg(data), /<circle/);
});
test('경유점이 있는 커넥터는 그 좌표를 지나는 직각 꺾은선으로', () => {
  const data = normalizeWhiteboard({
    board: {
      a: { t: 'shape', sh: 1 }, b: { t: 'shape', sh: 1 },
      line: { t: 'connector', se: 'a', sa: { left: 1, top: 0.5 }, te: 'b', ta: { left: 1, top: 0.5 }, sc: 1, ec: 2 },
      w: { t: 'pathWaypoint', pi: 'line', ax: 0 },
    },
    dimensions: [{ key: 'p#a', val: [0, 0] }, { key: 's#a', val: [100, 40] }, { key: 'p#b', val: [-100, 300] }, { key: 's#b', val: [100, 40] }, { key: 'p#w', val: [200, 99] }],
    paths: [{ key: 's#line', val: [0, 0] }, { key: 'e#line', val: [0, 0] }, { key: 'se#line', val: '' }],
  });
  assert.equal(data.connectors[0].path, 'M 50 0 L 192 0 Q 200 0 200 8 L 200 292 Q 200 300 192 300 L -50 300');
});

// ---- GIRA-78: 리치 텍스트·이미지·댓글·둥근 모서리 (합성 바이트만 — 원본 데이터 아님) ----
const enc = (t) => { const b = [...new TextEncoder().encode(t)]; return [4, b.length, ...b]; };
function richBytes() {
  const link = [...new TextEncoder().encode('\x91\x81\xa4href\xb4https://example.test/a')];
  return Uint8Array.from([0, 1, 4,
    11, 1, 2, ...enc('제목'), 0,                                   // 제목 2
    1, 2, 0, ...enc('굵게'), 1, 5, ...enc(' 링크'), 1, 13, 1, link.length, ...link, // 문단: 굵게 + 링크
    2, 2, 3, 1, 1, 1, 0, ...enc('하나'), 1, 15, 3, 1, 1, 1, 0, ...enc('둘'), 1, 6, // 글머리 목록: 취소선, 기울임
    1, 4, 0, ...enc('줄'), 0, 16, ...enc('바꿈'), 0, 9, 3, ...new TextEncoder().encode(':x:'), 4, 0xf0, 0x9f, 0x92, 0xa5]); // 줄바꿈, 이모지
}
test('리치 텍스트: 문단·제목·목록·마크를 해석하고, 서식이 있을 때만 rich를 남긴다', () => {
  const b = richBytes();
  assert.equal(canvasText(b), '제목\n굵게 링크\n하나\n둘\n줄\n바꿈💥');
  const lines = canvasRich(b);
  assert.equal(lines[0].heading, 2);
  assert.deepEqual(lines[1].runs, [{ text: '굵게', b: true }, { text: ' 링크', href: 'https://example.test/a' }]);
  assert.deepEqual([lines[2].list, lines[2].n, lines[2].runs[0].s, lines[3].n, lines[3].runs[0].i], ['ul', 1, true, 2, true]);
  // 서식 없는 글자는 rich 없음, 해석 못 하는 값은 예전 방식으로 글자만
  assert.equal(canvasRich(Uint8Array.from([0, 1, 1, 1, 1, 0, ...enc('그냥'), 0])), null);
  assert.equal(canvasText(Uint8Array.from([0, 1, 4, ...enc('옛 형식').slice(1), 0])), '옛 형식');
  const data = normalizeWhiteboard({ board: { s: { t: 'shape', sh: 1, tx: Object.fromEntries([...b].map((x, i) => [i, x])) } }, dimensions: [{ key: 's#s', val: [200, 200] }] });
  const svg = whiteboardSvg(data);
  assert.match(svg, /<b>굵게<\/b>/); assert.match(svg, /<s>하나<\/s>/); assert.match(svg, /<i>둘<\/i>/); assert.match(svg, /•/);
  assert.match(svg, /href="https:\/\/example.test\/a"/); assert.match(svg, /font-weight:600/);
});
test('리치 텍스트 링크는 http(s)만, 글자는 이스케이프', () => {
  const evil = [...new TextEncoder().encode('\x91\x81\xa4href\xa5javascript:alert(1)')];
  const b = Uint8Array.from([0, 1, 1, 1, 1, 0, ...enc('<img onerror=x>'), 2, 5, 13, 1, evil.length, ...evil]);
  const data = normalizeWhiteboard({ board: { s: { t: 'shape', sh: 1, tx: b } } });
  const svg = whiteboardSvg(data);
  assert.ok(!svg.includes('javascript:')); assert.ok(!svg.includes('<img')); assert.match(svg, /<b>&lt;img/);
});
test('둥근 모서리: 짧은 구간은 반지름을 줄이고, 일직선은 그대로', () => {
  assert.equal(roundedPath([[0, 0], [100, 0]]), 'M 0 0 L 100 0');
  assert.equal(roundedPath([[0, 0], [50, 0], [100, 0]]), 'M 0 0 L 50 0 L 100 0');
  assert.equal(roundedPath([[0, 0], [6, 0], [6, 100]]), 'M 0 0 L 3 0 Q 6 0 6 3 L 6 100');
});
test('이미지는 이관한 첨부로, 댓글 표시는 눌러 볼 수 있게, 모르는 요소는 점선 상자로', () => {
  const data = normalizeWhiteboard({ board: {
    img: { t: 'image', fi: 'abc-123', mt: 'image/png' }, note: { t: 'comment', ci: 'ref-1', r: false, at: { parentId: 'img', offset: [5, 5] } },
    card: { t: 'smartCard', u: 'https://example.test/browse/X-1' },
  } });
  const img = data.elements.find((e) => e.id === 'img');
  assert.equal(img.imageName, 'whiteboard-abc-123.png'); assert.equal(whiteboardImageName('../x', ''), 'whiteboard-x');
  const svg = whiteboardSvg(data, { contentId: 42, comments: { 'ref-1': 2 } });
  assert.match(svg, /<image href="\/api\/att\/42\/whiteboard-abc-123.png"/);
  assert.match(svg, /data-wb-comment="ref-1"/); assert.match(svg, /댓글 2개/);
  assert.match(svg, /smartCard — 옮기지 못한 요소/); assert.match(svg, /stroke-dasharray="4 3"/);
  assert.ok(!whiteboardSvg(data).includes('<image')); // contentId 없으면 자리 표시만
});
test('이미지 원본·댓글 GET: media 토큰(iss = 클라이언트 id)과 contentId 모음, markerRef 연결, 실패는 손실로', async () => {
  const jwt = ['e30', Buffer.from(JSON.stringify({ iss: 'client-x' })).toString('base64url'), 'sig'].join('.');
  const data = normalizeWhiteboard({ board: { a: { t: 'image', fi: 'm1', mt: 'image/png' }, b: { t: 'image', fi: 'm2', mt: '' }, c: { t: 'comment', ci: 'ref-1' } } });
  const calls = [];
  const res = await fetchWhiteboardExtras('77', data, {
    media: { token: jwt, baseUrl: 'https://media.example.test', contentId: '77' },
    fetchImpl: async (url, opt) => { calls.push([url, opt]); return url.includes('/m1/') ? new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 }); },
    get: async (p) => p.includes('start=') ? { results: [{ id: '9', extensions: { inlineProperties: { markerRef: 'ref-2' }, resolution: { status: 'resolved' } } }] }
      : { results: [{ id: '8', body: { storage: { value: '<p>본문</p>' } }, history: { createdBy: { accountId: 'acc-1' }, createdDate: '2026-01-01T00:00:00Z' }, extensions: { inlineProperties: { markerRef: 'ref-1' }, resolution: { status: 'open' } } }], _links: { next: '/rest/api/content/77/child/comment?start=100' } },
  });
  assert.equal(calls[0][0], 'https://media.example.test/file/m1/binary?collection=contentId-77');
  assert.equal(calls[0][1].method, undefined); assert.equal(calls[0][1].headers['X-Client-Id'], 'client-x'); assert.equal(calls[0][1].headers.Authorization, `Bearer ${jwt}`);
  assert.deepEqual(res.images.map((i) => [i.filename, i.mimeType, i.buffer.length]), [['whiteboard-m1.png', 'image/png', 3]]);
  assert.deepEqual(res.losses, ['이미지 m2: 404']);
  assert.deepEqual(res.comments.map((c) => [c.id, c.markerRef, c.resolved, c.authorId]), [['8', 'ref-1', false, 'acc-1'], ['9', 'ref-2', true, null]]);
  // media 토큰이 없으면 이미지는 손실로 남기고 계속
  const none = await fetchWhiteboardExtras('77', data, { get: async () => ({ results: [] }), fetchImpl: async () => assert.fail('호출 안 함') });
  assert.deepEqual(none.losses, ['이미지 2개: media 토큰 없음']);
});
