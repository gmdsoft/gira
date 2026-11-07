// 이관 원본 형식 보드 → PNG/JPG (편집기와 같은 Excalidraw 변환으로 그린다)
// 원본 보기 SVG는 줄바꿈 글자에 foreignObject를 써서 브라우저가 캔버스 복사를 막는다(tainted canvas) — 그래서 이미지는 이 경로로 만든다.
// 내보낼 때만 불러온다 (편집기 묶음 약 1MB)
import './excalidraw-env.mjs';
import { exportToBlob, restoreElements } from '@excalidraw/excalidraw';
import { toExcalidrawScene } from './whiteboard-excalidraw.mjs';
import { MAX_EXPORT_PX } from './WhiteboardExport.jsx';

export async function rasterBoard(data, mime) {
  const scene = data?.format === 'excalidraw' ? data : toExcalidrawScene(data);
  const elements = restoreElements(scene.elements, null, { refreshDimensions: true, repairBindings: true });
  const blob = await exportToBlob({ elements, files: scene.files ?? {}, exportPadding: 24, mimeType: mime, quality: 0.92,
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
    getDimensions: (w, h) => { const k = Math.min(2, MAX_EXPORT_PX / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k), scale: k }; } });
  const bmp = await createImageBitmap(blob);
  return { blob, width: bmp.width, height: bmp.height };
}
