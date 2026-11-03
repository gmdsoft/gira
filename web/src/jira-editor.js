// Jira PoC 설명 편집기 (바닐라 TipTap 번들, React 불필요).
// ADF ↔ TipTap JSON 변환을 포함한다. window.JiraEditor 로 노출.
// 빌드: npm --workspace web run build:jira → web/dist-jira/jira-editor.js
import { Editor, Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

// StarterKit에 없는 마크 2종 (최소 구현)
const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }, { style: 'text-decoration=underline' }],
  renderHTML: () => ['u', 0],
});
const Link = Mark.create({
  name: 'link',
  priority: 1000,
  keepOnSplit: false,
  addAttributes() { return { href: { default: null } }; },
  parseHTML() { return [{ tag: 'a[href]' }]; },
  renderHTML({ HTMLAttributes }) { return ['a', { ...HTMLAttributes, target: '_blank', rel: 'noopener' }, 0]; },
});

// ---------- ADF → TipTap ----------
// 미지원 요소는 가장 가까운 형태로 단순화한다 (패널→인용, 미디어→자리표시 문단 등).
const MARKS_IN = { strong: 'bold', em: 'italic', underline: 'underline', strike: 'strike', code: 'code' };
function marksIn(marks) {
  const out = [];
  for (const m of marks ?? []) {
    if (MARKS_IN[m.type]) out.push({ type: MARKS_IN[m.type] });
    else if (m.type === 'link' && m.attrs?.href) out.push({ type: 'link', attrs: { href: m.attrs.href } });
    // textColor, subsup 등은 버리고 텍스트만 유지
  }
  return out;
}
const textNode = (text, marks = []) => (text ? { type: 'text', text, ...(marks.length ? { marks } : {}) } : null);

function adfToTiptap(n) {
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
    case 'panel': return { type: 'blockquote', content: kids() }; // 패널 → 인용으로 단순화
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
    default: { const c = kids(); return c.length ? c : null; } // 알 수 없는 요소는 내용만 유지
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
function tiptapToAdf(n) {
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

function mount(element, adfDoc) {
  const editor = new Editor({
    element,
    extensions: [
      StarterKit, Underline, Link,
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    ],
    content: adfDoc ? adfToTiptap(adfDoc) : '',
  });
  return {
    editor,
    getADF: () => (editor.isEmpty ? null : tiptapToAdf(editor.getJSON())),
    destroy: () => editor.destroy(),
  };
}

window.JiraEditor = { mount, adfToTiptap, tiptapToAdf };
