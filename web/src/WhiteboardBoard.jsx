// 화이트보드 Excalidraw 보기·편집 (GIRA-74) — WhiteboardView가 필요할 때만 불러온다(지연 로드, 약 1MB)
import './excalidraw-env.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, restoreElements, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import MenuButton from './MenuButton.jsx';
import { WhiteboardExportDialog, MAX_EXPORT_PX } from './WhiteboardExport.jsx';
import '@excalidraw/excalidraw/index.css';
import { toExcalidrawScene, sceneForSave } from './whiteboard-excalidraw.mjs';
import { WbIcon } from './whiteboard-icons.jsx';
import { useWhiteboardLive } from './whiteboard-live.js';

// 실시간 공동 편집(GIRA-77): 보기·편집 모두 같은 방에 참여한다. 편집 내용은 바로 다른 사람에게 보이고 서버가 자동 저장한다.
export default function WhiteboardBoard({ pageId, title, data, version, editing, editAction, onSaved, onClose }) {
  const [exporting, setExporting] = useState(null); // null | { selected }
  const scene = useMemo(() => {
    const s = data?.format === 'excalidraw' ? data : toExcalidrawScene(data);
    // 글자 줄바꿈·크기와 화살표 연결을 편집기 기준으로 다시 맞춘다
    return { ...s, elements: restoreElements(s.elements, null, { refreshDimensions: true, repairBindings: true }) };
  }, [data]);
  const api = useRef(null);
  const live = useWhiteboardLive({ pageId, editing, apiRef: api });
  const readOnly = editing && live.connected && !live.canEdit;

  const onChange = useCallback((elements, appState, files) => { live.queueLocal(elements, files); }, [live.queueLocal]);

  // 저장 결과를 페이지 상태에 반영 (버전 기록·편집 종료 뒤 보기)
  const lastVersion = useRef(version);
  useEffect(() => {
    const ex = api.current;
    if (!live.version || live.version === lastVersion.current || !ex) return;
    lastVersion.current = live.version;
    onSaved?.(live.version, sceneForSave(ex.getSceneElementsIncludingDeleted(), ex.getFiles(), ex.getAppState()));
  }, [live.version, onSaved]);

  const save = useCallback(() => { if (editing && live.canEdit) live.saveNow(); }, [editing, live.canEdit, live.saveNow]);

  // Ctrl/⌘+S 지금 저장, 아직 못 보낸 변경이 있으면 떠날 때 경고
  useEffect(() => {
    if (!editing) return undefined;
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    const leave = (e) => { if (live.unsent) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', key, true); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('beforeunload', leave); };
  }, [editing, live.unsent, save]);

  // 상태 글자: 연결·오류가 우선, 그다음 저장 상태
  const time = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const shown = live.error ? { text: live.error, kind: 'error' }
    : !live.connected ? { text: '실시간 연결 중…', kind: 'busy' }
    : live.saving ? { text: '저장 중…', kind: 'busy' }
    : live.unsent ? { text: '보내는 중…', kind: 'dirty' }
    : live.savedAt ? { text: `자동 저장됨 ${time(live.savedAt)} · 버전 ${live.version}`, kind: 'saved' }
    : { text: `실시간 공동 편집 · 버전 ${live.version ?? version}`, kind: '' };
  const people = live.clients.length > 0 && <span className="wb-people" aria-label="함께 보는 사람">
    {live.clients.slice(0, 6).map((c) => <span key={c.clientId} className="wb-person" style={{ background: c.color }} title={`${c.name}님 — ${c.editing ? '편집 중' : '보는 중'}`}>{(c.name ?? '?').slice(0, 1)}</span>)}
    {live.clients.length > 6 && <span className="wb-person more" title={live.clients.slice(6).map((c) => c.name).join(', ')}>+{live.clients.length - 6}</span>}
  </span>;
  // 내보내기: 보드 전체 또는 선택한 요소(묶인 글자·프레임 안 요소 포함)
  const selectedIds = () => { const sel = api.current?.getAppState().selectedElementIds ?? {}; return new Set(Object.keys(sel).filter((k) => sel[k])); };
  const renderExport = async (format, area) => {
    const ex = api.current; if (!ex) throw new Error('편집기가 아직 준비되지 않았습니다');
    let elements = ex.getSceneElements();
    if (area === 'selection') { const ids = selectedIds(); elements = elements.filter((e) => ids.has(e.id) || ids.has(e.containerId) || ids.has(e.frameId)); }
    if (!elements.length) throw new Error('내보낼 요소가 없습니다');
    const appState = { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false };
    const files = ex.getFiles();
    if (format === 'svg') {
      const svg = await exportToSvg({ elements, appState, files, exportPadding: 24 });
      return { blob: new Blob([svg.outerHTML], { type: 'image/svg+xml' }) };
    }
    const blob = await exportToBlob({ elements, appState, files, exportPadding: 24, mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png', quality: 0.92,
      getDimensions: (w, h) => { const k = Math.min(2, MAX_EXPORT_PX / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k), scale: k }; } });
    const bmp = await createImageBitmap(blob);
    return { blob, width: bmp.width, height: bmp.height };
  };
  const moreMenu = <MenuButton label="더 보기" items={[{ label: '내보내기 (PNG · JPG · PDF · SVG)', icon: 'download', onClick: () => setExporting({ selected: selectedIds().size }) }]} />;
  const close = () => { onClose?.(); }; // 못 보낸 변경은 나갈 때 보내고, 마지막 사람이 나가면 서버가 저장한다
  return <div className="wb-frame">
    {editing
      ? <div className="wb-toolbar">
        <div className="wb-left">
          <span className="wb-badge is-edit"><WbIcon name="pencil" />{readOnly ? '보기 전용' : '편집 중'}</span>
          <span role="status" className={`wb-status ${shown.kind}`}>{shown.text}</span>
          {people}
        </div>
        <div className="wb-right">
          {moreMenu}
          <button className="wb-btn" onClick={close}><WbIcon name="close" /><span className="wb-label">편집 종료</span></button>
          <button className="wb-btn primary" onClick={save} disabled={live.saving || !live.connected || !live.canEdit} title="변경은 자동 저장됩니다. 지금 바로 새 버전으로 저장 (Ctrl+S)"><WbIcon name="check" />지금 저장<kbd>Ctrl S</kbd></button>
        </div>
      </div>
      : <div className="wb-toolbar">
        <div className="wb-left">
          <span className="wb-badge"><WbIcon name="history" />버전 {live.version ?? version}</span>
          {people ? <>{people}<span className="wb-note">{live.clients.some((c) => c.editing) ? '함께 편집 중 — 변경이 바로 보입니다' : '함께 보는 중'}</span></>
            : <span className="wb-note">휠로 확대/축소, 스페이스바를 누른 채 끌어서 이동</span>}
        </div>
        <div className="wb-right">{moreMenu}{editAction}</div>
      </div>}
    {exporting && <WhiteboardExportDialog title={title ?? '화이트보드'} canSelect selectedCount={exporting.selected} render={renderExport} onClose={() => setExporting(null)} />}
    <div className="wb-canvas wb-excalidraw" style={{ height: editing ? '78vh' : '70vh' }}>
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
        initialData={{ elements: scene.elements, files: scene.files, appState: { ...scene.appState, viewModeEnabled: !editing || readOnly, currentItemRoughness: 0, currentItemFontFamily: 2 }, scrollToContent: true }}
        viewModeEnabled={!editing || readOnly}
        isCollaborating
        onPointerUpdate={live.sendPointer}
        gridModeEnabled
        langCode="ko-KR"
        onChange={onChange}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }}
      />
    </div>
  </div>;
}
