// 화이트보드 내보내기 (원본 ••• → 내보내기: PDF·PNG·JPG, 보드 전체 / 선택 영역) — SVG도 함께
// render(format, area) → { blob, width, height } 를 받아 파일로 내려받는다. PDF는 JPG를 한 쪽짜리 PDF로 감싼다.
import React, { useState } from 'react';
import { Dialog, downloadBlob } from './MenuButton.jsx';
import { jpegToPdf } from './mini-pdf.mjs';
import { safeFileName } from './database-io.mjs';

export const MAX_EXPORT_PX = 8000; // 브라우저 캔버스 한계 안쪽

// SVG 글자 → PNG/JPG (흰 바탕). 큰 보드는 긴 변이 MAX_EXPORT_PX를 넘지 않게 줄인다
// (foreignObject가 든 SVG는 브라우저가 막는다 — 이관 원본 보드는 whiteboard-raster.mjs를 쓴다)
export async function rasterizeSvg(svgText, width, height, mime, scale = 2) {
  const k = Math.min(scale, MAX_EXPORT_PX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('이미지로 바꾸지 못했습니다')); img.src = url; });
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, mime, 0.92));
    return { blob, width: w, height: h };
  } finally { URL.revokeObjectURL(url); }
}

async function toPdf({ blob, width, height }) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([jpegToPdf(bytes, width, height)], { type: 'application/pdf' });
}

export function WhiteboardExportDialog({ title, canSelect, selectedCount = 0, render, onClose }) {
  const [format, setFormat] = useState('png');
  const [area, setArea] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      const want = format === 'pdf' ? 'jpg' : format;
      const out = await render(want, area);
      const blob = format === 'pdf' ? await toPdf(out) : out.blob;
      downloadBlob(blob, `${safeFileName(title)}${area === 'selection' ? ' (선택)' : ''}.${format}`);
      onClose();
    } catch (e) { setError(e.message || '내보내기 실패'); } finally { setBusy(false); }
  };
  return <Dialog title="화이트보드 내보내기" onClose={onClose}
    footer={<><button className="wb-btn" onClick={onClose}>취소</button><button className="wb-btn primary" disabled={busy || (area === 'selection' && !selectedCount)} onClick={run}>{busy ? '만드는 중…' : '내보내기'}</button></>}>
    <div className="mb-field"><b>파일 형식</b>
      <div className="mb-choices">
        {[['png', 'PNG'], ['jpg', 'JPG'], ['pdf', 'PDF'], ['svg', 'SVG']].map(([k, l]) => <label key={k}><input type="radio" name="wbfmt" checked={format === k} onChange={() => setFormat(k)} />{l}</label>)}
      </div>
      <p className="mb-help">{format === 'svg' ? '확대해도 깨지지 않는 벡터 그림 — 다른 도구에서 고쳐 쓸 때' : format === 'pdf' ? '한 쪽짜리 PDF (보드 전체를 한 장에)' : '흰 바탕 이미지 (선명하게 2배 크기, 아주 큰 보드는 줄여서)'}</p>
    </div>
    <div className="mb-field"><b>내보낼 영역</b>
      <div className="mb-choices">
        <label><input type="radio" name="wbarea" checked={area === 'all'} onChange={() => setArea('all')} />보드 전체</label>
        <label style={canSelect ? undefined : { opacity: .5 }}><input type="radio" name="wbarea" disabled={!canSelect} checked={area === 'selection'} onChange={() => setArea('selection')} />선택 영역{canSelect ? ` (${selectedCount}개)` : ''}</label>
      </div>
      {!canSelect && <p className="mb-help">선택 영역은 편집기에서 보드를 열었을 때 고를 수 있습니다.</p>}
      {canSelect && !selectedCount && <p className="mb-help">보드에서 내보낼 요소를 먼저 선택하세요.</p>}
    </div>
    {error && <p className="mb-help" role="alert" style={{ color: '#c9372c' }}>{error}</p>}
  </Dialog>;
}
