// ADF ↔ TipTap JSON 변환 + 보조 마크 (StarterKit에 없는 underline/link 최소 구현).
// 이관 이슈 50건 왕복 검증 통과본 (구 web/src/jira-editor.js에서 추출).
import { Mark } from '@tiptap/core';

export const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }, { style: 'text-decoration=underline' }],
  renderHTML: () => ['u', 0],
});
export const LinkMark = Mark.create({
  name: 'link',
  priority: 1000,
  keepOnSplit: false,
  addAttributes() { return { href: { default: null } }; },
  parseHTML() { return [{ tag: 'a[href]' }]; },
  renderHTML({ HTMLAttributes }) { return ['a', { ...HTMLAttributes, target: '_blank', rel: 'noopener' }, 0]; },
});

// ---------- ADF → TipTap (미지원 요소는 가장 가까운 형태로 단순화) ----------
const MARKS_IN = { strong: 'bold', em: 'italic', underline: 'underline', strike: 'strike', code: 'code' };
function marksIn(marks) {
  const out = [];
  for (const m of marks ?? []) {
    if (MARKS_IN[m.type]) out.push({ type: MARKS_IN[m.type] });
    else if (m.type === 'link' && m.attrs?.href) out.push({ type: 'link', attrs: { href: m.attrs.href } });
  }
  return out;
}
const textNode = (text, marks = []) => (text ? { type: 'text', text, ...(marks.length ? { marks } : {}) } : null);

export function adfToTiptap(n) {
  if (!n) return null;
  const kids = () => (n.content ?? []).map(adfToTiptap).filter(Boolean).flat();
  const cellAttrs = () => ({
    colspan: n.attrs?.colspan ?? 1, rowspan: n.attrs?.rowspan ?? 1, colwidth: n.attrs?.colwidth ?? null,
  });
  switch (n.type) {
    case 'doc': { const c = kids(); return { type: 'doc', content: c.length ? c : [{ type: 'paragraph' }] }; }
    case 'paragraph': return { type: 'paragraph', content: kids() };
    case 'text': return textNode(n.text, marksIn(n.marks));
    case 'heading': return { type: 'heading', attrs: { level: Math.min(6, n.attrs?.level ?? 1) }, content: kids() };
    case 'bulletList': case 'taskList': return { type: 'bulletList', content: kids() };
    case 'orderedList': return { type: 'orderedList', content: kids() };
    case 'listItem': case 'taskItem': return { type: 'listItem', content: kids() };
    case 'codeBlock': return {
      type: 'codeBlock', attrs: { language: n.attrs?.language ?? null },
      content: (n.content ?? []).map((t) => textNode(t.text)).filter(Boolean),
    };
    case 'blockquote': return { type: 'blockquote', content: kids() };
    case 'panel': return { type: 'blockquote', content: kids() };
    case 'expand': case 'nestedExpand': {
      const title = n.attrs?.title ? [{ type: 'paragraph', content: [textNode(n.attrs.title, [{ type: 'bold' }])] }] : [];
      return { type: 'blockquote', content: [...title, ...kids()] };
    }
    case 'rule': return { type: 'horizontalRule' };
    case 'hardBreak': return { type: 'hardBreak' };
    case 'table': return { type: 'table', content: kids() };
    case 'tableRow': return { type: 'tableRow', content: kids() };
    case 'tableHeader': return { type: 'tableHeader', attrs: cellAttrs(), content: kids() };
    case 'tableCell': return { type: 'tableCell', attrs: cellAttrs(), content: kids() };
    case 'mediaSingle': case 'mediaGroup':
      return { type: 'paragraph', content: [textNode('📎 (이미지/첨부 — 편집기 미지원, 저장 시 이 문구로 대체됩니다)')] };
    case 'mention': return textNode('@' + (n.attrs?.text?.replace(/^@/, '') ?? ''));
    case 'emoji': return textNode(n.attrs?.text ?? n.attrs?.shortName ?? '');
    case 'status': return textNode(`[${n.attrs?.text ?? ''}]`);
    case 'date': return textNode(n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toLocaleDateString('ko-KR') : '');
    case 'inlineCard': return textNode(n.attrs?.url ?? '', n.attrs?.url ? [{ type: 'link', attrs: { href: n.attrs.url } }] : []);
    default: { const c = kids(); return c.length ? c : null; }
  }
}

// ---------- TipTap → ADF ----------
const MARKS_OUT = { bold: 'strong', italic: 'em', underline: 'underline', strike: 'strike', code: 'code' };
function marksOut(marks) {
  const out = [];
  for (const m of marks ?? []) {
    if (MARKS_OUT[m.type]) out.push({ type: MARKS_OUT[m.type] });
    else if (m.type === 'link' && m.attrs?.href) out.push({ type: 'link', attrs: { href: m.attrs.href } });
  }
  return out;
}
export function tiptapToAdf(n) {
  if (!n) return null;
  const kids = () => (n.content ?? []).map(tiptapToAdf).filter(Boolean);
  const cellAttrs = () => {
    const a = {};
    if ((n.attrs?.colspan ?? 1) !== 1) a.colspan = n.attrs.colspan;
    if ((n.attrs?.rowspan ?? 1) !== 1) a.rowspan = n.attrs.rowspan;
    if (n.attrs?.colwidth) a.colwidth = n.attrs.colwidth;
    return Object.keys(a).length ? { attrs: a } : {};
  };
  switch (n.type) {
    case 'doc': return { type: 'doc', version: 1, content: kids() };
    case 'text': {
      const marks = marksOut(n.marks);
      return { type: 'text', text: n.text, ...(marks.length ? { marks } : {}) };
    }
    case 'paragraph': return { type: 'paragraph', content: kids() };
    case 'heading': return { type: 'heading', attrs: { level: n.attrs?.level ?? 1 }, content: kids() };
    case 'bulletList': return { type: 'bulletList', content: kids() };
    case 'orderedList': return { type: 'orderedList', content: kids() };
    case 'listItem': return { type: 'listItem', content: kids() };
    case 'codeBlock': return {
      type: 'codeBlock', ...(n.attrs?.language ? { attrs: { language: n.attrs.language } } : {}),
      content: (n.content ?? []).map((t) => ({ type: 'text', text: t.text })),
    };
    case 'blockquote': return { type: 'blockquote', content: kids() };
    case 'horizontalRule': return { type: 'rule' };
    case 'hardBreak': return { type: 'hardBreak' };
    case 'table': return { type: 'table', content: kids() };
    case 'tableRow': return { type: 'tableRow', content: kids() };
    case 'tableHeader': return { type: 'tableHeader', ...cellAttrs(), content: kids() };
    case 'tableCell': return { type: 'tableCell', ...cellAttrs(), content: kids() };
    default: return null;
  }
}

// ADF → 플레인 텍스트 (댓글 편집 프리필용. 서식은 보존되지 않는다)
export function adfPlain(node, depth = 0) {
  if (!node) return '';
  const kids = (d = depth) => (node.content ?? []).map((c) => adfPlain(c, d)).join('');
  switch (node.type) {
    case 'text': return node.text ?? '';
    case 'hardBreak': return '\n';
    case 'mention': return '@' + (node.attrs?.text?.replace(/^@/, '') ?? '');
    case 'emoji': return node.attrs?.text ?? node.attrs?.shortName ?? '';
    case 'paragraph': case 'heading': return kids() + '\n';
    case 'listItem': return '  '.repeat(depth) + '- ' + kids(depth + 1).replace(/\n+$/, '') + '\n';
    case 'codeBlock': return kids() + '\n';
    case 'rule': return '---\n';
    default: return kids();
  }
}

// 서식 있는 요소 포함 여부 (편집 시 단순화 경고용)
export function hasRichContent(node) {
  if (!node) return false;
  if (['table', 'media', 'panel', 'expand', 'codeBlock', 'status', 'date'].includes(node.type)) return true;
  if ((node.marks ?? []).length) return true;
  return (node.content ?? []).some(hasRichContent);
}
