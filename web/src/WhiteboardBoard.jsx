// 화이트보드 Excalidraw 보기·편집 (GIRA-74) — WhiteboardView가 필요할 때만 불러온다(지연 로드, 약 1MB)
import './excalidraw-env.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { toExcalidrawScene, sceneForSave } from './whiteboard-excalidraw.mjs';

const versionSum = (elements) => elements.reduce((n, e) => n + (e.version ?? 0) + (e.isDeleted ? 1 : 0), 0);

export default function WhiteboardBoard({ pageId, data, version, editing, onSaved, onClose }) {
  const scene = useMemo(() => {
    const s = data?.format === 'excalidraw' ? data : toExcalidrawScene(data);
    // 글자 줄바꿈·크기와 화살표 연결을 편집기 기준으로 다시 맞춘다
    return { ...s, elements: restoreElements(s.elements, null, { refreshDimensions: true, repairBindings: true }) };
  }, [data]);
  const api = useRef(null);
  const baseline = useRef(null);
  const ver = useRef(version);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { ver.current = version; }, [version]);

  const onChange = useCallback((elements) => {
    if (!editing) return;
    const sum = versionSum(elements);
    if (baseline.current == null) { baseline.current = sum; return; }
    setDirty(sum !== baseline.current);
  }, [editing]);

  const save = useCallback(async () => {
    const ex = api.current; if (!ex || busy) return;
    setBusy(true); setStatus('저장 중…');
    try {
      const body = sceneForSave(ex.getSceneElementsIncludingDeleted(), ex.getFiles(), ex.getAppState());
      const r = await fetch(`/api/content/${pageId}/whiteboard`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion: ver.current, data: body }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { setStatus('다른 사람이 먼저 저장했습니다 — 내 변경을 복사해 두고 다시 불러오세요'); return; }
      if (!r.ok) { setStatus('저장 실패: ' + (j.error ?? r.status)); return; }
      ver.current = j.version; baseline.current = versionSum(ex.getSceneElementsIncludingDeleted()); setDirty(false);
      setStatus(`저장됨 (버전 ${j.version})`);
      onSaved?.(j.version, { ...body, plainText: undefined });
    } catch (e) { setStatus('저장 실패: ' + e.message); } finally { setBusy(false); }
  }, [pageId, busy, onSaved]);

  // Ctrl/⌘+S 저장, 저장 안 한 채 떠나면 경고
  useEffect(() => {
    if (!editing) return undefined;
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    const leave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', key, true); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('beforeunload', leave); };
  }, [editing, dirty, save]);

  return <>
    {editing && <div className="wb-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <button className="primary" onClick={save} disabled={busy || !dirty}>저장</button>
      <button onClick={() => { if (dirty && !confirm('저장하지 않은 변경이 있습니다. 편집을 끝낼까요?')) return; onClose?.(); }}>편집 종료</button>
      <span role="status" className="muted">{status || (dirty ? '저장하지 않은 변경 있음' : '')}</span>
    </div>}
    <div className="wb-excalidraw" style={{ height: editing ? '78vh' : '70vh', border: '1px solid #dfe1e6' }}>
      <Excalidraw
        excalidrawAPI={(a) => {
          if (api.current === a) return;
          api.current = a;
          // 처음 열 때 보드 전체가 보이게
          setTimeout(() => {
            const els = a.getSceneElements(); if (!els.length) return;
            // 작은 보드는 100%보다 크게 키우지 않는다
            a.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.95, maxZoom: 1, animate: false });
          }, 0);
        }}
        initialData={{ elements: scene.elements, files: scene.files, appState: { ...scene.appState, viewModeEnabled: !editing, currentItemRoughness: 0, currentItemFontFamily: 2 }, scrollToContent: true }}
        viewModeEnabled={!editing}
        gridModeEnabled
        langCode="ko-KR"
        onChange={onChange}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }}
      />
    </div>
  </>;
}
