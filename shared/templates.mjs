// 기본 템플릿은 서비스 자체 작성 본문이다.
const heading = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const builtin = (id, name, sections) => ({ id, name, description: '기본 제공 템플릿', labels: [], builtin: true,
  doc: { type: 'doc', content: sections.flatMap((s) => [heading(s), { type: 'paragraph' }]) } });
export const BUILTIN_TEMPLATES = [
  builtin('meeting-notes', '회의록', ['참석자', '안건', '논의 내용', '후속 작업']),
  builtin('decisions', '결정', ['배경', '검토한 선택지', '결정 사항']),
  builtin('troubleshooting', '문제 해결', ['문제', '원인', '해결 방법']),
  builtin('file-list', '파일 목록', ['파일', '설명']),
];
export function blueprintTemplate(params = {}) {
  const key = String(params.blueprintModuleCompleteKey || '');
  const hit = BUILTIN_TEMPLATES.find((t) => key.includes(t.id));
  if (hit) return hit;
  // contentBlueprintId는 인스턴스별 UUID이므로 표시 라벨로 알려진 기본 유형만 판별한다.
  if (!params.contentBlueprintId) return null;
  const label = String(params.createButtonLabel ?? params.buttonLabel ?? '');
  const i = [/회의록|meeting note/i, /결정|decision/i, /문제 해결|troubleshooting/i, /파일 목록|file list/i].findIndex((r) => r.test(label));
  return BUILTIN_TEMPLATES[i] ?? null;
}
export function templateId(params = {}) {
  return blueprintTemplate(params)?.id ?? String(params.templateName || params.templateId || '');
}
export function templateTitle(rule, templateName, spaceName, date = new Date()) {
  return (typeof rule === 'string' && rule.trim() ? rule : templateName)
    .replaceAll('@currentDate', date.toISOString().slice(0, 10)).replaceAll('@spaceName', spaceName);
}
