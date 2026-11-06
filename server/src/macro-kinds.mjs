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
  // GIRA-57: 데이터가 외부 앱에 있어 옮길 수 없는 매크로
  ['TEST_RESULTS_ADVANCED', '테스트 관리 — 테스트 결과 보고서'],
  ['ISSUES_REPORTED_LIST', '테스트 관리 — 보고된 이슈 목록'],
  ['calendar', '팀 캘린더'],
  ['gadget', 'Jira 가젯'],
  ['vote', '투표'],
  ['survey', '설문'],
  ['vbcp-macro', 'BPMN 다이어그램'],
  ['vdcp-macro', 'DMN 결정표'],
]);
export const noticeText = (name) => `원본 Confluence 앱 기능(${NOTICE_MACROS.get(name) ?? name}) — 이관되지 않음`;

// 안내와 함께 읽기 전용으로 보여 줄 내용: 투표·설문은 질문과 선택지 (결과는 원본 앱에 있어 옮기지 못함)
export function noticeDetail(name, params = {}) {
  const lines = (s) => String(s ?? '').split(/\r?\n|,(?=\s*\d+\.)/).map((x) => x.trim()).filter(Boolean);
  if (name === 'vote') return { title: params.title || null, items: lines(params.__body), note: '투표 결과는 이관되지 않음' };
  if (name === 'survey') return { title: params.title || null, items: [...lines(params.__body), ...(params.choices ? [`선택지: ${params.choices}`] : [])], note: '설문 응답은 이관되지 않음' };
  return null;
}
