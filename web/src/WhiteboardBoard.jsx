// 화이트보드 Excalidraw 보기·편집 (GIRA-74) — WhiteboardView가 필요할 때만 불러온다(지연 로드, 약 1MB)
import './excalidraw-env.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, restoreElements, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import MenuButton from './MenuButton.jsx';
import { WhiteboardExportDialog, MAX_EXPORT_PX } from './WhiteboardExport.jsx';
import '@excalidraw/excalidraw/index.css';
import { toExcalidrawScene, sceneForSave, stampScene, iconScene, ICONS } from './whiteboard-excalidraw.mjs';
import { STAMPS } from './whiteboard-stamps.mjs';
import { WbIcon } from './whiteboard-icons.jsx';

const versionSum = (elements) => elements.reduce((n, e) => n + (e.version ?? 0) + (e.isDeleted ? 1 : 0), 0);

export default function WhiteboardBoard({ pageId, title, data, version, editing, editAction, onSaved, onClose }) {
  const [exporting, setExporting] = useState(null); // null | { selected }
  const scene = useMemo(() => {
    const s = data?.format === 'excalidraw' ? data : toExcalidrawScene(data);
    // 글자 줄바꿈·크기와 화살표 연결을 편집기 기준으로 다시 맞춘다
    return { ...s, elements: restoreElements(s.elements, null, { refreshDimensions: true, repairBindings: true }) };
  }, [data]);
  const api = useRef(null);
  const baseline = useRef(null);
  const ver = useRef(version);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(null); // { text, kind: busy|saved|error }
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
    setBusy(true); setStatus({ text: '저장 중…', kind: 'busy' });
    try {
      const body = sceneForSave(ex.getSceneElementsIncludingDeleted(), ex.getFiles(), ex.getAppState());
      const r = await fetch(`/api/content/${pageId}/whiteboard`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion: ver.current, data: body }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { setStatus({ text: '다른 사람이 먼저 저장했습니다 — 내 변경을 복사해 두고 다시 불러오세요', kind: 'error' }); return; }
      if (!r.ok) { setStatus({ text: '저장 실패: ' + (j.error ?? r.status), kind: 'error' }); return; }
      ver.current = j.version; baseline.current = versionSum(ex.getSceneElementsIncludingDeleted()); setDirty(false);
      setStatus({ text: `저장됨 · 버전 ${j.version}`, kind: 'saved' });
      onSaved?.(j.version, { ...body, plainText: undefined });
    } catch (e) { setStatus({ text: '저장 실패: ' + e.message, kind: 'error' }); } finally { setBusy(false); }
  }, [pageId, busy, onSaved]);

  // Ctrl/⌘+S 저장, 저장 안 한 채 떠나면 경고
  useEffect(() => {
    if (!editing) return undefined;
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    const leave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', key, true); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('beforeunload', leave); };
  }, [editing, dirty, save]);

  // 상태 글자: 진행·오류가 우선, 그다음 변경 여부
  const shown = status?.kind === 'busy' || status?.kind === 'error' ? status
    : dirty ? { text: '저장하지 않은 변경 있음', kind: 'dirty' }
    : status ?? { text: '변경 없음', kind: '' };
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
  // 스탬프·아이콘 넣기 (GIRA-79): 스탬프는 선택한 요소 오른쪽 위 모서리에, 선택이 없으면 화면 가운데에
  const viewCenter = (st) => { const z = st.zoom?.value || 1; return [-st.scrollX + st.width / 2 / z, -st.scrollY + st.height / 2 / z]; };
  const insert = ({ elements, files }, frameId = null) => {
    const ex = api.current; if (!ex) return;
    if (Object.keys(files).length) ex.addFiles(Object.values(files));
    for (const e of elements) e.frameId = frameId;
    ex.updateScene({ elements: [...ex.getSceneElementsIncludingDeleted(), ...elements],
      appState: { selectedElementIds: Object.fromEntries(elements.filter((e) => !e.containerId).map((e) => [e.id, true])) } });
  };
  const addStamp = (key) => {
    const ex = api.current; if (!ex) return;
    const ids = selectedIds();
    const target = ex.getSceneElements().find((e) => ids.has(e.id) && !e.containerId);
    if (target) insert(stampScene(key, target.x + target.width, target.y), target.type === 'frame' ? target.id : target.frameId);
    else insert(stampScene(key, ...viewCenter(ex.getAppState())));
  };
  const addIcon = (key) => { const ex = api.current; if (ex) insert(iconScene(key, ...viewCenter(ex.getAppState()))); };
  const stampMenu = <MenuButton label="스탬프" className="wb-btn" align="left" title="스탬프 넣기 — 선택한 요소의 오른쪽 위에 붙습니다"
    items={STAMPS.map((st) => ({ label: `${st.emoji}  ${st.label}`, onClick: () => addStamp(st.key) }))}><WbIcon name="stamp" /><span className="wb-label">스탬프</span></MenuButton>;
  const iconMenu = <MenuButton label="아이콘" className="wb-btn" align="left" title="아이콘 넣기 (사람·서버·코드)"
    items={ICONS.map((ic) => ({ label: ic.label, onClick: () => addIcon(ic.key) }))}><WbIcon name="person" /><span className="wb-label">아이콘</span></MenuButton>;
  const moreMenu = <MenuButton label="더 보기" items={[{ label: '내보내기 (PNG · JPG · PDF · SVG)', icon: 'download', onClick: () => setExporting({ selected: selectedIds().size }) }]} />;
  const close = () => { if (dirty && !confirm('저장하지 않은 변경이 있습니다. 편집을 끝낼까요?')) return; onClose?.(); };
  return <div className="wb-frame">
    {editing
      ? <div className="wb-toolbar">
        <div className="wb-left">
          <span className="wb-badge is-edit"><WbIcon name="pencil" />편집 중</span>
          <span role="status" className={`wb-status ${shown.kind}`}>{shown.text}</span>
        </div>
        <div className="wb-right">
          {stampMenu}{iconMenu}
          {moreMenu}
          <button className="wb-btn" onClick={close}><WbIcon name="close" /><span className="wb-label">편집 종료</span></button>
          <button className="wb-btn primary" onClick={save} disabled={busy || !dirty} title="저장 (Ctrl+S)"><WbIcon name="check" />저장<kbd>Ctrl S</kbd></button>
        </div>
      </div>
      : <div className="wb-toolbar">
        <div className="wb-left">
          <span className="wb-badge"><WbIcon name="history" />버전 {version}</span>
          <span className="wb-note">휠로 확대/축소, 스페이스바를 누른 채 끌어서 이동</span>
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
        initialData={{ elements: scene.elements, files: scene.files, appState: { ...scene.appState, viewModeEnabled: !editing, currentItemRoughness: 0, currentItemFontFamily: 2 }, scrollToContent: true }}
        viewModeEnabled={!editing}
        gridModeEnabled
        langCode="ko-KR"
        onChange={onChange}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }}
      />
    </div>
  </div>;
}
