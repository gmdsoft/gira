// 원본 Confluence 매크로·앱 블록 중 '배지' 대신 다르게 다루는 것들 (GIRA-48).
// 변환기(scripts/convert-storage.mjs)의 통계와 편집기·보기 렌더(web/src/extensions.js)가 같은 목록을 쓴다.
// ADF 확장(Forge·Connect 앱 블록)은 변환기에서 'adf-ext:<extension-key 끝 이름>'으로 들어온다.

// 내보내기 앱(Scroll PDF/Word 등)용 표시 — 원본 보기 화면에도 아무것도 안 나온다. 문서 모델에는 보존하고 보기에서 숨긴다.
export const HIDDEN_MACROS = new Set([
  'scroll-pagebreak', 'scroll-export-button', 'scroll-title',
  'adf-ext:scroll-pagebreak', 'adf-ext:scroll-export-button', 'adf-ext:scroll-title',
]);

// 본문만 그대로 보여 주는 감싸기 매크로 (Scroll Ignore 같은 bodied 확장은 adfNode 'bodied-extension'으로 처리)
export const BODY_ONLY_MACROS = new Set(['scroll-content-block']);

// 옮길 수 없는 원본 앱 기능 — 배지 대신 작은 안내
export const NOTICE_MACROS = new Map([
  ['adf-ext:smart-button', '스마트 버튼'],
  ['adf-ext:project-linker', '프로젝트 링커'],
]);
export const noticeText = (name) => `원본 Confluence 앱 기능(${NOTICE_MACROS.get(name) ?? name}) — 이관되지 않음`;
