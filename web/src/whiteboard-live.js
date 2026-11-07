// 화이트보드 실시간 공동 편집 클라이언트 (GIRA-77) — 서버: server/src/whiteboard-live.mjs
// SSE로 방에 참여하고, 내 변경(요소 버전이 바뀐 것만)·커서를 짧게 모아 POST로 보낸다.
// 받은 요소는 Excalidraw reconcileElements(요소 단위 version/versionNonce)로 내 장면과 합친다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { reconcileElements, CaptureUpdateAction } from '@excalidraw/excalidraw';

const SEND_MS = 80;
const POINTER_MS = 60;
const newClientId = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^\w-]/g, '');

export function useWhiteboardLive({ pageId, editing, apiRef }) {
  const clientId = useRef(newClientId());
  const sent = useRef(new Map()); // id → 마지막으로 보내거나 받은 version
  const sentFiles = useRef(new Set());
  const pending = useRef(null); // { elements: Map, files: {} }
  const timer = useRef(null);
  const pointerTimer = useRef(null);
  const pointerNext = useRef(null);
  const inited = useRef(false);
  const ready = useRef(false); // 서버 init을 받아 내 장면에 반영함
  const others = useRef(new Map()); // clientId → info
  const [state, setState] = useState({ connected: false, canEdit: false, version: null, error: null, saving: false, savedAt: null, clients: [], me: null, unsent: false });

  const post = useCallback(async (body) => {
    const r = await fetch(`/api/content/${pageId}/whiteboard/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: clientId.current, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error ?? String(r.status)), { status: r.status });
    return j;
  }, [pageId]);

  const pushCollaborators = useCallback(() => {
    const api = apiRef.current; if (!api) return;
    const map = new Map();
    for (const c of others.current.values()) {
      map.set(c.clientId, { id: String(c.userId), socketId: c.clientId, username: c.name, color: { background: c.color, stroke: c.color },
        pointer: c.pointer ? { x: c.pointer.x, y: c.pointer.y, tool: c.pointer.tool } : undefined, button: c.pointer?.button,
        selectedElementIds: Object.fromEntries((c.selected ?? []).map((id) => [id, true])) });
    }
    api.updateScene({ collaborators: map });
    setState((s) => ({ ...s, clients: [...others.current.values()].map(({ clientId: id, name, color, canEdit }) => ({ clientId: id, name, color, canEdit })) }));
  }, [apiRef]);

  const flush = useCallback(async () => {
    timer.current = null;
    const p = pending.current; if (!p) return;
    pending.current = null;
    const elements = [...p.elements.values()];
    try {
      await post({ elements, files: p.files });
      setState((s) => ({ ...s, unsent: !!pending.current, error: null }));
    } catch (e) {
      // 못 보낸 것은 다시 모아 두고, 재접속(init) 때 전체를 다시 올린다
      for (const el of elements) sent.current.delete(el.id);
      for (const id of Object.keys(p.files ?? {})) sentFiles.current.delete(id);
      setState((s) => ({ ...s, unsent: true, error: e.status === 409 ? '연결이 끊겨 다시 연결하는 중…' : '보내기 실패: ' + e.message }));
    }
  }, [post]);

  // 내 장면에서 바뀐 요소·새 이미지를 모아 보낸다 (onChange마다 호출)
  const queueLocal = useCallback((elements, files) => {
    if (!editing || !ready.current) return;
    let p = pending.current;
    for (const el of elements) {
      if (sent.current.get(el.id) === el.version) continue;
      sent.current.set(el.id, el.version);
      (p ??= { elements: new Map(), files: {} }).elements.set(el.id, el);
    }
    for (const [id, f] of Object.entries(files ?? {})) {
      if (sentFiles.current.has(id) || !f?.dataURL) continue;
      sentFiles.current.add(id);
      (p ??= { elements: new Map(), files: {} }).files[id] = { mimeType: f.mimeType, dataURL: f.dataURL, created: f.created };
    }
    if (!p) return;
    pending.current = p;
    setState((s) => (s.unsent ? s : { ...s, unsent: true }));
    if (!timer.current) timer.current = setTimeout(flush, SEND_MS);
  }, [editing, flush]);

  const sendPointer = useCallback(({ pointer, button }) => {
    if (!ready.current) return;
    const sel = apiRef.current?.getAppState().selectedElementIds ?? {};
    pointerNext.current = { pointer: { ...pointer, button }, selected: Object.keys(sel).filter((k) => sel[k]) };
    if (pointerTimer.current) return;
    pointerTimer.current = setTimeout(() => {
      pointerTimer.current = null;
      const p = pointerNext.current; pointerNext.current = null;
      if (p) post(p).catch(() => {});
    }, POINTER_MS);
  }, [apiRef, post]);

  const applyRemote = useCallback((elements) => {
    const api = apiRef.current; if (!api || !elements.length) return;
    const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), elements, api.getAppState());
    for (const el of merged) sent.current.set(el.id, el.version); // 받은 것을 되돌려 보내지 않게
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
  }, [apiRef]);

  useEffect(() => {
    if (!pageId) return undefined;
    let closed = false;
    const es = new EventSource(`/api/content/${pageId}/whiteboard/live?client=${clientId.current}`);
    const on = (name, fn) => es.addEventListener(name, (ev) => { try { fn(JSON.parse(ev.data)); } catch (e) { console.warn('whiteboard live', name, e); } });
    on('init', async (d) => {
      // 편집기가 준비될 때까지 기다린다
      for (let i = 0; i < 100 && !apiRef.current; i++) await new Promise((r) => setTimeout(r, 50));
      const api = apiRef.current; if (!api || closed) return;
      others.current = new Map(d.clients.map((c) => [c.clientId, c]));
      const files = Object.values(d.files ?? {});
      if (files.length) api.addFiles(files);
      for (const f of files) sentFiles.current.add(f.id);
      const reconnect = inited.current;
      inited.current = true;
      if (d.seed) {
        // 이관 원본 형식이고 아직 아무도 올리지 않음 — 내가 연 변환 장면이 기준(편집자만 올린다)
      } else if (!reconnect) {
        // 처음 참여: 방(=최신) 장면으로 바꾼다 — 페이지를 연 뒤 다른 사람이 지운 요소가 되살아나지 않게
        api.updateScene({ elements: d.elements, appState: { viewBackgroundColor: d.background }, captureUpdate: CaptureUpdateAction.NEVER });
        api.history?.clear?.();
      } else applyRemote(d.elements); // 다시 연결: 끊긴 동안의 내 변경과 합친다
      sent.current = new Map(d.elements.map((e) => [e.id, e.version]));
      ready.current = true;
      setState((s) => ({ ...s, connected: true, canEdit: d.you.canEdit, me: d.you, version: d.version, error: null }));
      pushCollaborators();
      // 편집자: 방에 없는(또는 더 새로운) 내 요소·이미지를 올린다 — 이관 원본 첫 변환, 재접속 복구
      if (editing && d.you.canEdit) {
        queueLocal(api.getSceneElementsIncludingDeleted(), api.getFiles());
      }
    });
    on('elements', (d) => { if (ready.current) applyRemote(d.elements); });
    on('files', (d) => {
      const files = Object.values(d.files ?? {});
      for (const f of files) sentFiles.current.add(f.id);
      apiRef.current?.addFiles(files);
    });
    on('join', (c) => { others.current.set(c.clientId, c); pushCollaborators(); });
    on('leave', (d) => { others.current.delete(d.clientId); pushCollaborators(); });
    on('pointer', (d) => {
      const c = others.current.get(d.clientId); if (!c) return;
      others.current.set(d.clientId, { ...c, pointer: d.pointer, selected: d.selected });
      pushCollaborators();
    });
    on('saved', (d) => setState((s) => ({ ...s, version: d.version, savedAt: d.at, saving: false, error: null })));
    on('save-error', (d) => setState((s) => ({ ...s, saving: false, error: '자동 저장 실패: ' + d.error })));
    on('fatal', (d) => { closed = true; es.close(); setState((s) => ({ ...s, connected: false, error: d.error })); });
    es.onerror = () => { if (!closed) { ready.current = false; setState((s) => ({ ...s, connected: false })); } };
    return () => {
      closed = true; es.close();
      clearTimeout(pointerTimer.current); pointerTimer.current = null;
      // 나가기 전에 못 보낸 변경을 보낸다
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      const p = pending.current; pending.current = null;
      if (p) fetch(`/api/content/${pageId}/whiteboard/live`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: clientId.current, elements: [...p.elements.values()], files: p.files }) }).catch(() => {});
      inited.current = false; ready.current = false; sent.current = new Map(); sentFiles.current = new Set(); others.current = new Map();
    };
    // editing이 바뀌면 다시 참여 (보기 ↔ 편집)
  }, [pageId, editing, apiRef, applyRemote, pushCollaborators, queueLocal]);

  // 지금 저장 (Ctrl+S) — 대기 중인 변경을 먼저 보낸다
  const saveNow = useCallback(async () => {
    setState((s) => ({ ...s, saving: true }));
    try {
      if (timer.current) { clearTimeout(timer.current); await flush(); }
      const j = await post({ save: true });
      setState((s) => ({ ...s, saving: false, version: j.version ?? s.version, savedAt: Date.now(), error: null }));
      return j.version;
    } catch (e) { setState((s) => ({ ...s, saving: false, error: '저장 실패: ' + e.message })); return null; }
  }, [flush, post]);

  return { ...state, clientId: clientId.current, queueLocal, sendPointer, saveNow };
}
