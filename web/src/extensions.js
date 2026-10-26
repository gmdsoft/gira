// 변환기(scripts/convert-storage.mjs)가 생성하는 ProseMirror 문서의 전체 어휘.
// StarterKit(문단, 제목, 목록, 인용, 코드, 수평선 등) + 아래 커스텀 노드/마크.
// JSX 없이 작성한다 — node 스크립트(render-check)에서도 그대로 import한다.
import { Extension, Node, Mark, mergeAttributes, wrappingInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TableExt from '@tiptap/extension-table';
import TableRowExt from '@tiptap/extension-table-row';
import TableCellExt from '@tiptap/extension-table-cell';
import TableHeaderExt from '@tiptap/extension-table-header';

// ---------- 마크 ----------

const Underline = Mark.create({
  name: 'underline',
  renderHTML: () => ['u', 0],
});

const Subscript = Mark.create({ name: 'subscript', renderHTML: () => ['sub', 0] });
const Superscript = Mark.create({ name: 'superscript', renderHTML: () => ['sup', 0] });

const LinkMark = Mark.create({
  name: 'link',
  addAttributes: () => ({ href: { default: null } }),
  renderHTML: ({ HTMLAttributes }) => {
    const external = /^https?:/i.test(HTMLAttributes.href ?? '');
    return ['a', mergeAttributes(HTMLAttributes, external ? { target: '_blank', rel: 'noreferrer' } : {}), 0];
  },
});

const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: null } }),
  renderHTML: ({ node, HTMLAttributes }) => ['span', { style: `color: ${HTMLAttributes.color}` }, 0],
});

const CommentMark = Mark.create({
  name: 'commentMark',
  addAttributes: () => ({ ref: { default: null } }),
  renderHTML: ({ HTMLAttributes }) => ['span', { class: 'comment-mark', 'data-ref': HTMLAttributes.ref }, 0],
});

// ---------- 표 ----------
// 공식 확장 사용: 행/열 추가·삭제, 셀 선택, 헤더 토글 커맨드 제공.
// 노드 이름(table/tableRow/tableHeader/tableCell)과 colspan/rowspan 속성이 변환기 출력과 일치한다.

// Confluence 고정 폭 컬럼(760px)보다 넓은 블록은 컬럼 밖으로 "돌출(breakout)"시켜 중앙 정렬한다
const COLUMN_WIDTH = 760;

// 표의 렌더링 폭(px). Confluence는 px 열 너비 합이 tableWidth보다 크면 열 합을 따른다
// (tableWidth=760은 기본값 표식으로 남는 경우가 있어 열 합이 실제 폭).
function tableRenderWidth(attrs) {
  const cols = attrs.colwidths;
  let sum = 0;
  if (cols?.length && cols.some((w) => w) && !cols.some((w) => w?.endsWith?.('%'))) {
    sum = cols.reduce((a, w) => a + (w ? parseFloat(w) : 0), 0);
  }
  const width = Math.max(attrs.tableWidth ?? 0, sum);
  return width || null;
}

// 공식 표 확장 + Confluence 폭 속성(표 전체 폭 px, 레이아웃, colgroup 열 너비) 보존·렌더링
const Table = TableExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableWidth: { default: null, renderHTML: () => ({}) },
      layout: { default: null, renderHTML: (attrs) => (attrs.layout ? { 'data-layout': attrs.layout } : {}) },
      colwidths: { default: null, renderHTML: () => ({}) },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    // Confluence와 동일한 동작: 공간이 있으면 지정 폭으로, 좁으면 스크롤 없이
    // 열 비율을 유지한 채 축소. px 열 너비는 합계 대비 %로 환산해야 축소가 된다
    // (table-layout: fixed에서 px 열의 합계는 표 폭의 하한이 되기 때문).
    const { tableWidth, colwidths } = node.attrs;
    let cols = colwidths?.some((w) => w) ? colwidths : null;
    let width = tableWidth;
    if (cols && !cols.some((w) => w?.endsWith?.('%'))) {
      const px = cols.map((w) => (w ? parseFloat(w) : null));
      const sum = px.reduce((a, v) => a + (v ?? 0), 0);
      const nulls = px.filter((v) => v == null).length;
      const nullShare = nulls
        ? (width && width > sum ? (width - sum) / nulls : sum / Math.max(px.length - nulls, 1))
        : 0;
      const total = sum + nulls * nullShare;
      if (total > 0) {
        cols = px.map((v) => `${(((v ?? nullShare) / total) * 100).toFixed(3)}%`);
        // 열 합이 지정 폭보다 크면 열 합이 실제 폭 (tableWidth=760은 기본값 표식인 경우가 있다)
        if (!width || total > width) width = Math.round(total);
      }
    }
    const style = [
      width ? `width: ${width}px; max-width: 100%;` : '',
      cols ? 'table-layout: fixed;' : '',
    ].join(' ').trim();
    const table = ['table', mergeAttributes(HTMLAttributes, style ? { style } : {})];
    if (cols) {
      table.push(['colgroup', ...cols.map((w) => (w ? ['col', { style: `width: ${w};` }] : ['col', {}]))]);
    }
    table.push(['tbody', 0]);
    // 셀 안 이미지 등으로 최소 폭이 더 클 때만 가로 스크롤이 생긴다
    const wrap = { class: 'table-wrap' };
    if (width > COLUMN_WIDTH) { wrap.class += ' breakout'; wrap.style = `--bw: ${Math.round(width)}px`; }
    return ['div', wrap, table];
  },
}).configure({ resizable: false });
const TableRow = TableRowExt;
const TableHeader = TableHeaderExt;
const TableCell = TableCellExt;

// ---------- 작업 항목 ----------

const TaskList = Node.create({
  name: 'taskList',
  group: 'block',
  content: 'taskItem+',
  renderHTML: () => ['ul', { class: 'task-list' }, 0],
});
const TaskItem = Node.create({
  name: 'taskItem',
  content: 'block*',
  addAttributes: () => ({ checked: { default: false } }),
  renderHTML: ({ node }) => ['li', { class: 'task-item', 'data-checked': String(node.attrs.checked) },
    ['span', { class: 'task-check' }, node.attrs.checked ? '☑' : '☐'],
    ['div', { class: 'task-body' }, 0]],
  // Confluence처럼 "[]"+공백 입력 → 작업 항목 (editor-spec.md)
  addInputRules() {
    return [wrappingInputRule({
      find: /^\s*\[([ xX]?)\]\s$/,
      type: this.type,
      getAttributes: (m) => ({ checked: /x/i.test(m[1] ?? '') }),
    })];
  },
});

// ---------- 블록 ----------

const Panel = Node.create({
  name: 'panel',
  group: 'block',
  content: 'block+',
  addAttributes: () => ({ panelType: { default: 'info' }, title: { default: null }, bgColor: { default: null } }),
  renderHTML: ({ node }) => {
    const attrs = { class: `panel panel-${node.attrs.panelType}` };
    if (node.attrs.bgColor) attrs.style = `background: ${node.attrs.bgColor}`;
    return node.attrs.title
      ? ['div', attrs, ['div', { class: 'panel-title' }, node.attrs.title], ['div', { class: 'panel-body' }, 0]]
      : ['div', attrs, ['div', { class: 'panel-body' }, 0]];
  },
});

// 내부에 컬럼보다 넓은 표가 있으면 펼치기 박스째 돌출시킨다 (Confluence 동일)
function expandViewAttrs(node) {
  let bw = 0;
  node.descendants((n) => { if (n.type.name === 'table') bw = Math.max(bw, tableRenderWidth(n.attrs) ?? 0); });
  const attrs = { class: 'expand' };
  if (bw > COLUMN_WIDTH) { attrs.class += ' breakout'; attrs.style = `--bw: ${Math.round(bw) + 26}px`; }
  return attrs;
}

const Expand = Node.create({
  name: 'expand',
  group: 'block',
  content: 'block+',
  addAttributes: () => ({ title: { default: '' } }),
  renderHTML: ({ node }) => {
    const attrs = expandViewAttrs(node);
    return ['details', attrs,
      ['summary', {}, node.attrs.title || '여기를 클릭하여 펼치기...'],
      ['div', { class: 'expand-body' }, 0]];
  },
  // 편집기: 제목 입력란 + 본문을 직접 편집할 수 있는 NodeView
  // (details/summary 그대로는 summary가 속성 텍스트라 편집이 안 되고 네이티브 토글이 클릭을 삼킨다)
  addNodeView() {
    return ({ node, editor, getPos }) => {
      // 읽기 전용(본문 보기 화면)은 renderHTML과 같은 details/summary로
      if (!editor.isEditable) {
        const details = document.createElement('details');
        const attrs = expandViewAttrs(node);
        details.className = attrs.class;
        if (attrs.style) details.setAttribute('style', attrs.style);
        const summary = document.createElement('summary');
        summary.textContent = node.attrs.title || '여기를 클릭하여 펼치기...';
        const body = document.createElement('div');
        body.className = 'expand-body';
        details.append(summary, body);
        return { dom: details, contentDOM: body, update: (n) => n.type.name === 'expand' };
      }
      const dom = document.createElement('div');
      // 넓은 표를 품은 펼치기는 편집기에서도 박스째 돌출 (expandViewAttrs가 breakout 판단)
      const applyAttrs = (n) => {
        const a = expandViewAttrs(n);
        dom.className = `${a.class} expand-edit`;
        if (a.style) dom.setAttribute('style', a.style);
        else dom.removeAttribute('style');
      };
      applyAttrs(node);
      const head = document.createElement('div');
      head.className = 'expand-edit-head';
      head.contentEditable = 'false';
      const caret = document.createElement('button');
      caret.type = 'button';
      caret.className = 'expand-caret';
      caret.textContent = '▾';
      const input = document.createElement('input');
      input.className = 'expand-title-input';
      input.placeholder = '제목 입력...';
      input.value = node.attrs.title ?? '';
      input.addEventListener('input', () => {
        const pos = getPos();
        if (pos == null) return;
        const { state, dispatch } = editor.view;
        dispatch(state.tr.setNodeAttribute(pos, 'title', input.value));
      });
      const body = document.createElement('div');
      body.className = 'expand-body';
      let open = true;
      caret.addEventListener('click', () => {
        open = !open;
        body.style.display = open ? '' : 'none';
        caret.textContent = open ? '▾' : '▸';
      });
      head.append(caret, input);
      dom.append(head, body);
      return {
        dom,
        contentDOM: body,
        stopEvent: (e) => head.contains(e.target),
        ignoreMutation: (m) => !body.contains(m.target),
        update: (n) => {
          if (n.type.name !== 'expand') return false;
          applyAttrs(n);
          if (document.activeElement !== input && (n.attrs.title ?? '') !== input.value) input.value = n.attrs.title ?? '';
          return true;
        },
      };
    };
  },
});

const Layout = Node.create({
  name: 'layout', group: 'block', content: 'layoutSection+',
  renderHTML: () => ['div', { class: 'layout' }, 0],
});
const LayoutSection = Node.create({
  name: 'layoutSection', content: 'layoutColumn+',
  addAttributes: () => ({ kind: { default: 'single' } }),
  renderHTML: ({ node }) => ['div', { class: `layout-section layout-${node.attrs.kind}` }, 0],
});
const LayoutColumn = Node.create({
  name: 'layoutColumn', content: 'block*',
  renderHTML: () => ['div', { class: 'layout-column' }, 0],
});

const Mermaid = Node.create({
  name: 'mermaid', group: 'block', content: 'text*', marks: '', code: true,
  renderHTML: () => ['pre', { class: 'mermaid-src' }, ['code', 0]],
});

const JiraTable = Node.create({
  name: 'jiraTable', group: 'block', atom: true,
  addAttributes: () => ({ jql: { default: '' }, columns: { default: null }, maximumIssues: { default: null } }),
  renderHTML: ({ node }) => ['div', { class: 'jira-table' },
    ['span', { class: 'macro-badge' }, 'Jira 검색'], ['code', {}, node.attrs.jql ?? '']],
});

// 보기 화면에서 web/src/macros.js가 실데이터로 채우는 매크로들
export const HYDRATED_MACROS = new Set([
  'toc', 'children', 'pagetree', 'view-file', 'viewdoc', 'viewpdf', 'viewppt', 'viewxls',
  'widget', 'profile', 'contributors', 'recently-updated', 'contentbylabel',
  'include', 'excerpt-include', 'drawio',
]);

function macroSlot(tag, name, params) {
  return [tag, {
    class: 'cf-macro-slot', 'data-macro': name,
    'data-params': JSON.stringify(params ?? {}),
  }, ['span', { class: 'macro-badge' }, `매크로: ${name}`]];
}

const CfMacro = Node.create({
  name: 'cfMacro', group: 'block', content: 'block*',
  addAttributes: () => ({ name: { default: '' }, params: { default: {} }, dynamic: { default: false } }),
  renderHTML: ({ node }) => {
    const { name, params, dynamic } = node.attrs;
    // 본문을 가진 매크로는 내용을 직접 렌더링
    if (name === 'excerpt') return ['div', { class: 'macro-excerpt' }, 0];
    if (name === 'details') {
      return params?.hidden === 'true'
        ? ['div', { style: 'display: none' }, 0]
        : ['div', { class: 'macro-details' }, 0];
    }
    if (HYDRATED_MACROS.has(name)) {
      const slot = macroSlot('div', name, params);
      slot.push(['div', { style: 'display: none' }, 0]); // 숨은 콘텐츠 홀 (스키마 요구)
      return slot;
    }
    return ['div', { class: `cf-macro ${dynamic ? 'cf-macro-dynamic' : ''}` },
      ['span', { class: 'macro-badge' }, `매크로: ${name}`],
      ['div', { class: 'cf-macro-body' }, 0]];
  },
});

const AdfNode = Node.create({
  name: 'adfNode', group: 'block', content: 'block*',
  addAttributes: () => ({ adfType: { default: '' }, attrs: { default: {} } }),
  renderHTML: ({ node }) => {
    const t = node.attrs.adfType;
    if (t === 'decision-list') return ['div', { class: 'decision-list' }, 0];
    if (t === 'decision-item') return ['div', { class: 'decision-item' }, 0];
    return ['div', { class: 'cf-macro' },
      ['span', { class: 'macro-badge' }, `adf: ${t}`],
      ['div', { class: 'cf-macro-body' }, 0]];
  },
});

// ---------- 인라인 ----------

const inlineAtom = { group: 'inline', inline: true, atom: true };

const Media = Node.create({
  name: 'media', ...inlineAtom,
  addAttributes: () => ({
    kind: { default: 'attachment' }, filename: { default: null }, src: { default: null },
    width: { default: null }, align: { default: null }, layout: { default: null },
    border: { default: null }, alt: { default: null }, caption: { default: null },
  }),
  renderHTML: ({ node }) => {
    const { src, filename, width, align, layout, border, alt, caption } = node.attrs;
    if (!src) return ['span', { class: 'media-missing' }, `🖼 ${filename ?? '(이미지)'}`];
    const img = ['img', {
      src, alt: alt ?? filename ?? '',
      ...(width ? { width } : {}),
      ...(border ? { class: 'media-border' } : {}),
    }];
    const cls = `media ${align ? `media-${align}` : ''} ${layout ? `media-layout-${layout}` : ''}`.trim();
    return caption
      ? ['figure', { class: cls }, img, ['figcaption', {}, caption]]
      : ['span', { class: cls }, img];
  },
});

const Mention = Node.create({
  name: 'mention', ...inlineAtom,
  addAttributes: () => ({ accountId: { default: null }, text: { default: '' } }),
  renderHTML: ({ node }) => ['span', { class: 'mention' }, `@${node.attrs.text || '사용자'}`],
});

// 레거시 Confluence 이모티콘(유니코드 fallback 없음) → 유니코드 매핑
const LEGACY_EMOTICONS = {
  smile: '🙂', sad: '🙁', cheeky: '😛', laugh: '😄', wink: '😉',
  'thumbs-up': '👍', 'thumbs-down': '👎', information: 'ℹ️', tick: '✅', cross: '❌',
  warning: '⚠️', plus: '➕', minus: '➖', question: '❓', 'light-on': '💡', 'light-off': '🔅',
  'yellow-star': '⭐', 'red-star': '🔴', 'green-star': '🟢', 'blue-star': '🔵',
  heart: '❤️', 'broken-heart': '💔',
};

const Emoji = Node.create({
  name: 'emoji', ...inlineAtom,
  addAttributes: () => ({ shortName: { default: '' }, text: { default: '' } }),
  renderHTML: ({ node }) => ['span', { class: 'emoji' },
    node.attrs.text || LEGACY_EMOTICONS[node.attrs.shortName?.replaceAll(':', '')] || node.attrs.shortName || '❓'],
});

const DateNode = Node.create({
  name: 'date', ...inlineAtom,
  addAttributes: () => ({ date: { default: '' } }),
  renderHTML: ({ node }) => ['span', { class: 'date-lozenge' }, node.attrs.date],
});

const Status = Node.create({
  name: 'status', ...inlineAtom,
  addAttributes: () => ({ text: { default: '' }, color: { default: 'neutral' } }),
  renderHTML: ({ node }) => ['span', { class: `status status-${node.attrs.color}` }, node.attrs.text],
});

const Anchor = Node.create({
  name: 'anchor', ...inlineAtom,
  addAttributes: () => ({ name: { default: '' } }),
  renderHTML: ({ node }) => ['span', { id: `anchor-${node.attrs.name}`, class: 'anchor' }],
});

const JiraIssue = Node.create({
  name: 'jiraIssue', ...inlineAtom,
  addAttributes: () => ({ key: { default: '' } }),
  renderHTML: ({ node }) => ['a', {
    class: 'jira-issue', target: '_blank', rel: 'noreferrer',
    href: `https://gmdsoft.atlassian.net/browse/${node.attrs.key}`,
  }, node.attrs.key],
});

const PageLink = Node.create({
  name: 'pageLink', group: 'inline', inline: true, content: 'text*',
  addAttributes: () => ({ contentTitle: { default: '' }, spaceKey: { default: null } }),
  renderHTML: ({ node }) => ['a', {
    class: 'page-link', href: '#',
    'data-title': node.attrs.contentTitle, 'data-space': node.attrs.spaceKey ?? '',
  }, node.childCount ? 0 : node.attrs.contentTitle],
});

const FileLink = Node.create({
  name: 'fileLink', group: 'inline', inline: true, content: 'text*',
  addAttributes: () => ({ filename: { default: '' }, href: { default: null } }),
  renderHTML: ({ node }) => ['a', {
    class: 'file-link', href: node.attrs.href ?? '#', target: '_blank', rel: 'noreferrer',
  }, node.childCount ? 0 : `📎 ${node.attrs.filename}`],
});

const CfMacroInline = Node.create({
  name: 'cfMacroInline', ...inlineAtom,
  addAttributes: () => ({ name: { default: '' }, params: { default: {} }, dynamic: { default: false } }),
  renderHTML: ({ node }) => {
    const { name, params } = node.attrs;
    if (HYDRATED_MACROS.has(name)) return macroSlot('span', name, params);
    return ['span', { class: 'macro-badge' }, `매크로: ${name}`];
  },
});

// 문단·제목 텍스트 정렬 (Confluence 툴바의 "텍스트 정렬" — editor-spec.md)
const TextAlign = Extension.create({
  name: 'textAlign',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        textAlign: {
          default: null,
          renderHTML: (attrs) => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
          parseHTML: (el) => el.style?.textAlign || null,
        },
      },
    }];
  },
  addCommands() {
    return {
      setTextAlign: (align) => ({ commands }) => {
        const results = ['paragraph', 'heading'].map((t) => commands.updateAttributes(t, { textAlign: align }));
        return results.some(Boolean);
      },
    };
  },
});

// Confluence 편집기 단축키 (editor-spec.md의 단축키 표 — TipTap 기본에 없는 것만)
export const ConfluenceShortcuts = Extension.create({
  name: 'confluenceShortcuts',
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    return {
      'Mod-Shift-m': () => ed().commands.toggleCode(),
      'Mod-\\': () => ed().chain().focus().unsetAllMarks().run(),
      'Mod-Alt-0': () => ed().commands.setParagraph(),
      'Mod-Shift-9': () => ed().commands.toggleBlockquote(),
      'Mod-k': () => {
        const prev = ed().getAttributes('link').href ?? '';
        const url = window.prompt('링크 URL', prev);
        if (url === null) return true;
        if (!url) return ed().chain().focus().extendMarkRange('link').unsetMark('link').run();
        return ed().chain().focus().extendMarkRange('link').setMark('link', { href: url }).run();
      },
    };
  },
});

const custom = [
  Underline, Subscript, Superscript, LinkMark, TextColor, CommentMark, TextAlign,
  Table, TableRow, TableHeader, TableCell,
  TaskList, TaskItem,
  Panel, Expand, Layout, LayoutSection, LayoutColumn,
  Mermaid, JiraTable, CfMacro, AdfNode,
  Media, Mention, Emoji, DateNode, Status, Anchor, JiraIssue,
  PageLink, FileLink, CfMacroInline,
];

// 읽기 전용 렌더링·render-check 용 (undo 히스토리 불필요)
export const extensions = [StarterKit.configure({ history: false }), ...custom];

// 편집기 용 (undo/redo 포함)
export const editExtensions = [StarterKit, ...custom, ConfluenceShortcuts];
