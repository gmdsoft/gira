// 화이트보드 실시간 공동 편집 (GIRA-77)
// 같은 화이트보드를 연 사람들이 하나의 '방'에 모인다. 서버는 방마다 Excalidraw 요소를 id별로 들고 있고,
// 편집자가 보낸 요소를 요소 단위 버전으로 병합(Excalidraw reconcile 규칙: version이 크면 이기고, 같으면 versionNonce가
// 작은 쪽)해서 다른 참여자에게 SSE로 바로 보낸다. 커서·선택·접속자도 같은 통로로 알린다.
// 저장은 문서 자동 저장처럼 서버가 한다 — 변경이 있으면 AUTO_SAVE_MS마다, 마지막 사람이 나갈 때 새 버전 스냅샷으로.
// 보기 권한만 있으면 읽기 전용으로 참여한다(요소 변경은 거부, 커서·접속자 표시는 됨).
// 방은 서버 메모리에만 있다 — 서버가 다시 뜨면 클라이언트가 자동 재접속하면서 자기 장면을 다시 올려 복구된다.
import { saveWhiteboard, checkLiveElement, checkLiveFile } from './whiteboard-edit.mjs';

export const AUTO_SAVE_MS = 30 * 1000;
const PING_MS = 20 * 1000;
const MAX_POST_ELEMENTS = 20000;
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5c940d', '#c2255c', '#3b5bdb'];

// 요소 단위 병합: incoming이 이기면 true
export function wins(current, incoming) {
  if (!current) return true;
  const cv = current.version ?? 0, iv = incoming.version ?? 0;
  if (iv !== cv) return iv > cv;
  return (incoming.versionNonce ?? 0) < (current.versionNonce ?? 0);
}

// 방 상태에 요소들을 병합하고 실제로 반영된 요소만 돌려준다
export function mergeInto(map, incoming) {
  const accepted = [];
  for (const el of incoming) {
    if (wins(map.get(el.id), el)) { map.set(el.id, el); accepted.push(el); }
  }
  return accepted;
}

// Excalidraw 0.18 분수 인덱스(index) 순서 — 인덱스가 없으면 들어온 순서를 지킨다
export function orderedElements(map) {
  const list = [...map.values()];
  return list.map((e, i) => [e, i]).sort(([a, i], [b, j]) => {
    if (a.index && b.index && a.index !== b.index) return a.index < b.index ? -1 : 1;
    return i - j;
  }).map(([e]) => e);
}

export function createLiveHub({ loadBoard, persist, now = () => Date.now(), autoSaveMs = AUTO_SAVE_MS, setTimer = setInterval, clearTimer = clearInterval }) {
  const rooms = new Map(); // contentId → room

  async function room(id) {
    let r = rooms.get(id);
    if (r) return r.ready.then(() => r);
    r = { id, elements: new Map(), files: {}, background: '#ffffff', version: 0, seed: false, dirty: false, lastEditor: null,
      clients: new Map(), colorNext: 0, saving: null, timer: null };
    rooms.set(id, r);
    r.ready = (async () => {
      const board = await loadBoard(id);
      r.version = board.version;
      if (board.data?.format === 'excalidraw') {
        for (const e of board.data.elements ?? []) r.elements.set(e.id, e);
        r.files = { ...(board.data.files ?? {}) };
        r.background = board.data.appState?.viewBackgroundColor ?? '#ffffff';
      } else r.seed = true; // 이관 원본 형식 — 처음 들어온 편집자가 변환한 장면을 올린다
    })();
    try { await r.ready; } catch (e) { rooms.delete(id); throw e; }
    r.timer = setTimer(() => { if (r.dirty) save(r).catch(() => {}); }, autoSaveMs);
    r.timer?.unref?.();
    return r;
  }

  const info = (c) => ({ clientId: c.clientId, userId: c.userId, name: c.name, color: c.color, canEdit: c.canEdit, pointer: c.pointer ?? null, selected: c.selected ?? null });
  function send(c, event, data) {
    try { c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 끊긴 연결은 close에서 정리 */ }
  }
  function broadcast(r, event, data, exceptId) {
    for (const c of r.clients.values()) if (c.clientId !== exceptId) send(c, event, data);
  }

  async function save(r) {
    if (r.saving) return r.saving;
    if (!r.dirty) return { version: r.version };
    r.dirty = false;
    const data = { format: 'excalidraw', elements: orderedElements(r.elements), files: { ...r.files }, appState: { viewBackgroundColor: r.background } };
    r.saving = (async () => {
      try {
        const result = await persist(r.id, { baseVersion: r.version, data, userId: r.lastEditor });
        r.version = result.version; r.seed = false;
        broadcast(r, 'saved', { version: r.version, at: now() });
        return result;
      } catch (e) {
        r.dirty = true; // 다음 주기에 다시
        broadcast(r, 'save-error', { error: e.message });
        throw e;
      } finally { r.saving = null; }
    })();
    return r.saving;
  }

  // SSE 연결 하나 = 참여자 하나. write(text)는 스트림에 쓰는 함수.
  async function join(id, { clientId, userId, name, canEdit, write }) {
    const r = await room(id);
    const old = r.clients.get(clientId);
    if (old && old.userId !== userId) throw Object.assign(new Error('client id 충돌'), { status: 409 });
    const color = old?.color ?? COLORS[r.colorNext++ % COLORS.length];
    const c = { clientId, userId, name, canEdit, write, color, pointer: null, selected: null };
    r.clients.set(clientId, c);
    send(c, 'init', {
      you: info(c), version: r.version, seed: r.seed && r.elements.size === 0, background: r.background,
      elements: orderedElements(r.elements), files: r.files,
      clients: [...r.clients.values()].filter((o) => o.clientId !== clientId).map(info),
    });
    broadcast(r, 'join', info(c), clientId);
    return c;
  }

  async function leave(id, clientId, write) {
    const r = rooms.get(id); if (!r) return;
    const c = r.clients.get(clientId);
    if (!c || (write && c.write !== write)) return; // 같은 id로 다시 붙은 연결은 그대로 둔다
    r.clients.delete(clientId);
    broadcast(r, 'leave', { clientId });
    if (r.clients.size) return;
    // 마지막 사람이 나가면 저장하고 방을 닫는다
    try { await save(r); } catch { /* 실패하면 저장 안 된 변경을 버리지 않도록 방을 남긴다 */ return; }
    if (!r.clients.size && !r.dirty) { clearTimer(r.timer); rooms.delete(id); }
  }

  // 참여자가 보낸 변경(요소·이미지·커서·저장 요청)
  async function update(id, { clientId, userId, elements, files, pointer, selected, saveNow }) {
    const r = rooms.get(id);
    const c = r?.clients.get(clientId);
    if (!c || c.userId !== userId) return { status: 409, error: '실시간 연결이 없습니다 — 다시 연결하는 중입니다' };
    if ((elements?.length || (files && Object.keys(files).length) || saveNow) && !c.canEdit) return { status: 403, error: '보기 권한으로 참여 중입니다 (읽기 전용)' };
    const out = { status: 200 };
    if (elements?.length > MAX_POST_ELEMENTS) return { status: 400, error: '요소가 너무 많습니다' };
    for (const e of elements ?? []) checkLiveElement(e);
    for (const f of Object.values(files ?? {})) checkLiveFile(f);
    // 이미지 먼저 — 요소가 참조하는 이미지가 같이 저장되게
    if (files && Object.keys(files).length) {
      const fresh = {};
      for (const [fid, f] of Object.entries(files)) {
        if (r.files[fid]) continue;
        fresh[fid] = { id: fid, mimeType: String(f.mimeType ?? ''), dataURL: f.dataURL, created: Number(f.created) || now() };
      }
      if (Object.keys(fresh).length) {
        Object.assign(r.files, fresh); r.dirty = true; r.lastEditor = userId;
        broadcast(r, 'files', { files: fresh }, clientId);
      }
    }
    if (elements?.length) {
      const accepted = mergeInto(r.elements, elements);
      if (accepted.length) {
        r.dirty = true; r.lastEditor = userId;
        broadcast(r, 'elements', { from: clientId, elements: accepted }, clientId);
        // 이관 원본을 처음 변환해 올렸으면 바로 저장 — 이후 여는 사람도 편집기 형식으로 본다
        if (r.seed) save(r).catch(() => {});
      }
      out.accepted = accepted.length;
    }
    if (pointer !== undefined || selected !== undefined) {
      if (pointer !== undefined) c.pointer = pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)
        ? { x: pointer.x, y: pointer.y, tool: pointer.tool === 'laser' ? 'laser' : 'pointer', button: pointer.button === 'down' ? 'down' : 'up' } : null;
      if (selected !== undefined) c.selected = Array.isArray(selected) ? selected.filter((s) => typeof s === 'string').slice(0, 500) : null;
      broadcast(r, 'pointer', { clientId, pointer: c.pointer, selected: c.selected }, clientId);
    }
    if (saveNow) {
      if (!r.dirty) out.version = r.version;
      else { r.lastEditor = userId; out.version = (await save(r)).version; }
    }
    return out;
  }

  const ping = () => { for (const r of rooms.values()) for (const c of r.clients.values()) { try { c.write(': ping\n\n'); } catch { /* close에서 정리 */ } } };
  // 서버 종료 전: 저장 안 된 방을 모두 저장하고 스트림을 닫는다(클라이언트는 다시 뜬 서버에 재접속)
  const flush = async () => {
    await Promise.allSettled([...rooms.values()].map((r) => save(r)));
    for (const r of rooms.values()) for (const c of r.clients.values()) { try { c.write.end?.(); } catch { /* 이미 끊김 */ } }
  };
  const status = (id) => { const r = rooms.get(id); return r ? { version: r.version, dirty: r.dirty, clients: [...r.clients.values()].map(info) } : null; };
  return { join, leave, update, save: (id) => (rooms.get(id) ? save(rooms.get(id)) : null), ping, flush, status, rooms };
}

export function registerWhiteboardLive(app, { requireAccess, query, getDb, reindex }) {
  const hub = createLiveHub({
    async loadBoard(id) {
      const { rows: [c] } = await query('SELECT type, current_version FROM content WHERE id=$1', [id]);
      if (c?.type !== 'whiteboard') throw Object.assign(new Error('whiteboard not found'), { status: 404 });
      const { rows: [s] } = await query('SELECT data FROM whiteboard_snapshots WHERE content_id=$1 AND version=$2', [id, c.current_version]);
      return { version: c.current_version, data: s?.data ?? null };
    },
    async persist(id, { baseVersion, data, userId }) {
      const client = await (await getDb()).connect();
      try {
        await client.query('BEGIN');
        let result = await saveWhiteboard(client, { id, baseVersion, data, userId });
        // 실시간 편집 중에 다른 경로(버전 복원 등)로 새 버전이 생겼으면, 지금 방 상태를 그 다음 버전으로 저장한다
        if (result.status === 409) result = await saveWhiteboard(client, { id, baseVersion: result.currentVersion, data, userId });
        if (result.status !== 200) throw new Error(result.error);
        await client.query('COMMIT');
        reindex?.(id);
        return result;
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    },
  });
  const pinger = setInterval(hub.ping, PING_MS); pinger.unref?.();

  const clientOk = (s) => typeof s === 'string' && /^[\w-]{8,64}$/.test(s);

  // 참여: SSE 스트림 (EventSource가 끊기면 브라우저가 알아서 다시 붙는다)
  app.get('/api/content/:id/whiteboard/live', async (req, reply) => {
    const acc = await requireAccess(req, reply, req.params.id);
    if (!acc) return;
    if (!clientOk(req.query.client)) return reply.code(400).send({ error: 'client required' });
    const { rows: [u] } = await query('SELECT display_name FROM users WHERE id=$1', [req.access.userId]);
    const id = String(req.params.id);
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    raw.write('retry: 2000\n\n');
    const write = (text) => raw.write(text);
    write.end = () => raw.end();
    req.raw.on('close', () => { hub.leave(id, req.query.client, write).catch(() => {}); });
    try {
      await hub.join(id, { clientId: req.query.client, userId: req.access.userId, name: u?.display_name ?? '알 수 없는 사용자', canEdit: !!acc.edit, write });
    } catch (e) {
      raw.write(`event: fatal\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      raw.end();
    }
  });

  // 변경 보내기: { client, elements?, files?, pointer?, selected?, save? }
  app.post('/api/content/:id/whiteboard/live', async (req, reply) => {
    const b = req.body ?? {};
    if (!clientOk(b.client)) return reply.code(400).send({ error: 'client required' });
    const needEdit = b.elements?.length || (b.files && Object.keys(b.files).length) || b.save;
    if (!await requireAccess(req, reply, req.params.id, needEdit ? 'edit' : 'view')) return;
    try {
      const r = await hub.update(String(req.params.id), {
        clientId: b.client, userId: req.access.userId,
        elements: Array.isArray(b.elements) ? b.elements : undefined,
        files: b.files && typeof b.files === 'object' && !Array.isArray(b.files) ? b.files : undefined,
        pointer: b.pointer, selected: b.selected, saveNow: !!b.save,
      });
      return reply.code(r.status).send(r);
    } catch (e) {
      if (e.message.startsWith('잘못된')) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  return hub;
}
