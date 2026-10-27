import React, { useEffect, useMemo, useRef, useState } from 'react';
import { generateHTML } from '@tiptap/html';
import { extensions } from './extensions.js';
import { hydrateDoc } from './api.js';

// 프레젠테이션 모드: 제목 슬라이드 + 제목1·2 단위로 본문을 쪼개 전체 화면으로 넘겨 본다.
export default function Presentation({ page, onClose }) {
  const slides = useMemo(() => buildSlides(page), [page]);
  const [i, setI] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e) => {
      if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) {
        e.preventDefault(); setI((v) => Math.min(v + 1, slides.length - 1));
      } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault(); setI((v) => Math.max(v - 1, 0));
      } else if (e.key === 'Escape') onClose();
    };
    const onFs = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [slides.length, onClose]);

  const s = slides[i];
  return (
    <div className="presentation" ref={ref}
         onClick={(e) => {
           // 펼치기·링크 등 본문 안의 인터랙션은 슬라이드 넘김으로 취급하지 않는다
           if (e.target.closest('summary, details, a, button')) return;
           setI((v) => Math.min(v + 1, slides.length - 1));
         }}>
      {s.titleSlide ? (
        <div className="pres-title-slide">
          <h1>{page.title}</h1>
          <p className="muted">
            {page.version?.author_name ?? ''}
            {page.version?.created_at && ` · ${new Date(page.version.created_at).toLocaleDateString('ko-KR')}`}
            {` · ${page.spaceName ?? page.spaceKey}`}
          </p>
        </div>
      ) : (
        <div className="pres-slide">
          <div className="doc" dangerouslySetInnerHTML={{ __html: s.html }} />
        </div>
      )}
      <button className="pres-close" title="닫기 (Esc)"
        onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
      {i > 0 && (
        <button className="pres-nav pres-prev" title="이전 (←)"
          onClick={(e) => { e.stopPropagation(); setI((v) => Math.max(v - 1, 0)); }}>‹</button>
      )}
      {i < slides.length - 1 && (
        <button className="pres-nav pres-next" title="다음 (→)"
          onClick={(e) => { e.stopPropagation(); setI((v) => Math.min(v + 1, slides.length - 1)); }}>›</button>
      )}
      <div className="pres-counter">{i + 1} / {slides.length}</div>
    </div>
  );
}

function buildSlides(page) {
  const slides = [{ titleSlide: true }];
  const doc = page.version?.doc;
  if (!doc?.content?.length) return slides;
  const hydrated = hydrateDoc(structuredClone(doc), page.id);
  let buf = [];
  const flush = () => {
    if (buf.some((n) => n.type !== 'paragraph' || n.content?.length)) slides.push(toSlide(buf));
    buf = [];
  };
  for (const node of hydrated.content) {
    if (node.type === 'heading' && (node.attrs?.level ?? 1) <= 2) { flush(); }
    buf.push(node);
  }
  flush();
  return slides;
}

function toSlide(nodes) {
  try { return { html: generateHTML({ type: 'doc', content: nodes }, extensions) }; }
  catch { return { html: '<em>(렌더링 불가)</em>' }; }
}
