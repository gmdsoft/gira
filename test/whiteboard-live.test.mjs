// 화이트보드 실시간 공동 편집 (GIRA-77) — 합성 데이터만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wins, mergeInto, orderedElements, createLiveHub } from '../server/src/whiteboard-live.mjs';

const el = (id, version, versionNonce = 1, extra) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version, versionNonce, ...extra });

// SSE 스트림 대신 받은 이벤트를 모아 두는 가짜 연결
function sink() {
  const events = [];
  const write = (text) => {
    const m = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(text);
    if (m) events.push([m[1], JSON.parse(m[2])]);
  };
  return { events, write, last: (name) => events.filter(([n]) => n === name).at(-1)?.[1] };
}

function hub(board = { version: 3, data: { format: 'excalidraw', elements: [el('a', 1)], files: {}, appState: { viewBackgroundColor: '#ffffff' } } }) {
  const saves = [];
  let version = board.version;
  const h = createLiveHub({
    loadBoard: async () => ({ version, data: board.data }),
    persist: async (id, arg) => { saves.push(arg); version = arg.baseVersion + 1; return { status: 200, version }; },
    setTimer: () => null, clearTimer: () => {},
  });
  return { h, saves };
}

test('병합 규칙: version이 크면 이기고, 같으면 versionNonce가 작은 쪽', () => {
  assert.equal(wins(undefined, el('a', 1)), true);
  assert.equal(wins(el('a', 2), el('a', 3)), true);
  assert.equal(wins(el('a', 3), el('a', 2)), false);
  assert.equal(wins(el('a', 3, 50), el('a', 3, 10)), true);
  assert.equal(wins(el('a', 3, 10), el('a', 3, 50)), false);
  const map = new Map([['a', el('a', 2)]]);
  const accepted = mergeInto(map, [el('a', 1), el('b', 1), el('a', 4, 1, { isDeleted: true })]);
  assert.deepEqual(accepted.map((e) => [e.id, e.version]), [['b', 1], ['a', 4]]);
  assert.equal(map.get('a').isDeleted, true); // 지움도 버전으로 전파(묘비)
  assert.deepEqual(orderedElements(new Map([['x', el('x', 1, 1, { index: 'a2' })], ['y', el('y', 1, 1, { index: 'a1' })]])).map((e) => e.id), ['y', 'x']);
});

test('참여·변경 전파·커서·읽기 전용', async () => {
  const { h } = hub();
  const A = sink(), B = sink(), V = sink();
  await h.join('1', { clientId: 'clientAAA', userId: 1, name: '가', canEdit: true, write: A.write });
  await h.join('1', { clientId: 'clientBBB', userId: 2, name: '나', canEdit: true, write: B.write });
  await h.join('1', { clientId: 'viewerVV', userId: 3, name: '다', canEdit: false, write: V.write });
  const initB = B.last('init');
  assert.deepEqual(initB.elements.map((e) => e.id), ['a']);
  assert.equal(initB.version, 3);
  assert.deepEqual(initB.clients.map((c) => c.name), ['가']);
  assert.notEqual(initB.you.color, A.last('init').you.color);
  assert.equal(A.last('join').name, '다');

  // A가 바꾼 요소는 B·V에게만 간다, 낡은 버전은 버린다
  let r = await h.update('1', { clientId: 'clientAAA', userId: 1, elements: [el('a', 2), el('n', 1)] });
  assert.equal(r.accepted, 2);
  assert.deepEqual(B.last('elements').elements.map((e) => e.id), ['a', 'n']);
  assert.equal(A.last('elements'), undefined);
  r = await h.update('1', { clientId: 'clientBBB', userId: 2, elements: [el('a', 1)] });
  assert.equal(r.accepted, 0);

  // 동시에 같은 요소 수정 → 결정적으로 한쪽(versionNonce 작은 쪽)
  await h.update('1', { clientId: 'clientAAA', userId: 1, elements: [el('a', 3, 90)] });
  await h.update('1', { clientId: 'clientBBB', userId: 2, elements: [el('a', 3, 20)] });
  assert.equal(A.last('elements').elements[0].versionNonce, 20);

  // 보기 권한: 요소 변경 거부, 커서는 전달
  r = await h.update('1', { clientId: 'viewerVV', userId: 3, elements: [el('z', 1)] });
  assert.equal(r.status, 403);
  r = await h.update('1', { clientId: 'viewerVV', userId: 3, pointer: { x: 5, y: 6, tool: 'pointer' }, selected: ['a'] });
  assert.equal(r.status, 200);
  assert.deepEqual(A.last('pointer'), { clientId: 'viewerVV', pointer: { x: 5, y: 6, tool: 'pointer', button: 'up' }, selected: ['a'] });

  // 다른 사람의 client id로는 보낼 수 없다, 위험한 링크는 거부
  assert.equal((await h.update('1', { clientId: 'clientAAA', userId: 2, elements: [el('q', 1)] })).status, 409);
  await assert.rejects(h.update('1', { clientId: 'clientAAA', userId: 1, elements: [el('q', 1, 1, { link: 'javascript:alert(1)' })] }), /링크/);
});

test('저장: 지금 저장, 마지막 사람이 나갈 때 저장하고 방을 닫음, 지운 요소는 스냅샷에서 빠짐', async () => {
  const { h, saves } = hub();
  const A = sink(), B = sink();
  const ca = await h.join('1', { clientId: 'clientAAA', userId: 1, name: '가', canEdit: true, write: A.write });
  await h.join('1', { clientId: 'clientBBB', userId: 2, name: '나', canEdit: true, write: B.write });
  let r = await h.update('1', { clientId: 'clientAAA', userId: 1, saveNow: true });
  assert.equal(r.version, 3); assert.equal(saves.length, 0); // 변경 없으면 저장 안 함
  await h.update('1', { clientId: 'clientBBB', userId: 2, elements: [el('a', 2, 1, { isDeleted: true }), el('b', 1)] });
  r = await h.update('1', { clientId: 'clientAAA', userId: 1, saveNow: true });
  assert.equal(r.version, 4);
  assert.equal(saves[0].baseVersion, 3); assert.equal(saves[0].userId, 1);
  assert.deepEqual(B.last('saved').version, 4);
  await h.leave('1', 'clientAAA', ca.write);
  assert.equal(B.last('leave').clientId, 'clientAAA');
  await h.update('1', { clientId: 'clientBBB', userId: 2, elements: [el('c', 1)] });
  await h.leave('1', 'clientBBB');
  assert.equal(saves.length, 2); assert.equal(saves[1].baseVersion, 4); assert.equal(saves[1].userId, 2);
  assert.equal(h.status('1'), null);
});

test('이관 원본 형식은 seed로 알리고, 처음 편집자가 올린 장면을 받는다', async () => {
  const { h, saves } = hub({ version: 1, data: { elements: [{ id: 'orig', type: 'shape' }] } });
  const A = sink();
  await h.join('9', { clientId: 'clientAAA', userId: 1, name: '가', canEdit: true, write: A.write });
  assert.equal(A.last('init').seed, true);
  assert.deepEqual(A.last('init').elements, []);
  await h.update('9', { clientId: 'clientAAA', userId: 1, elements: [el('orig', 1)], files: { f1: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA' } } });
  await new Promise((r) => setImmediate(r));
  assert.equal(saves.length, 1); // 변환본은 바로 저장
  await assert.rejects(h.update('9', { clientId: 'clientAAA', userId: 1, files: { f2: { dataURL: 'data:text/html;base64,AA' } } }), /이미지/);
  await h.leave('9', 'clientAAA');
  assert.equal(saves[0].data.format, 'excalidraw');
  assert.deepEqual(Object.keys(saves[0].data.files), ['f1']);
});
