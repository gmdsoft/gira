import { HtmlEmbed } from './html-embed.js';
import { mermaidEditorView } from './mermaid-editor.js';
import { mountMermaid } from './mermaid-view.js';
import { TaskItem } from './task-item.js';
import { datePresentation } from './date-presentation.js';
// 변환기(scripts/convert-storage.mjs)가 생성하는 ProseMirror 문서의 전체 어휘.
// StarterKit(문단, 제목, 목록, 인용, 코드, 수평선 등) + 아래 커스텀 노드/마크.
// JSX 없이 작성한다 — node 스크립트(render-check)에서도 그대로 import한다.
import { MediaCaption } from './image-caption.js';
import { inlineElementView } from './inline-element-view.js';
import { decisionBlock } from './slash-menu.js';
import { openBlockMenu, closeBlockMenu, copyBlockLink } from './block-handle-menu.js';
import { hydrateIssueCard } from './issue-card.js';
import { hydrateLinkCard } from './link-card.js';
import { Extension, Node, Mark, mergeAttributes, wrappingInputRule, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { BlockResize, widthAttrs } from './block-resize.js';
import { HighlightedCodeBlock } from './code-block.js';
import { createToc } from './toc.js';
import { HIDDEN_MACROS, BODY_ONLY_MACROS, NOTICE_MACROS, noticeText } from '../../server/src/macro-kinds.mjs';
import TableExt from '@tiptap/extension-table';
import TableRowExt from '@tiptap/extension-table-row';
import TableCellExt from '@tiptap/extension-table-cell';
import TableHeaderExt from '@tiptap/extension-table-header';
import { updateColumnsOnResize, TableMap } from 'prosemirror-tables';

// ---------- 마크 ----------

const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }],
  renderHTML: () => ['u', 0],
});

const Subscript = Mark.create({ name: 'subscript', excludes: 'superscript', parseHTML: () => [{ tag: 'sub' }], renderHTML: () => ['sub', 0] });
const Superscript = Mark.create({ name: 'superscript', excludes: 'subscript', parseHTML: () => [{ tag: 'sup' }], renderHTML: () => ['sup', 0] });

const LinkMark = Mark.create({
  name: 'link',
  parseHTML: () => [{ tag: 'a[href]', priority: 40, getAttrs: el => ({ href: el.getAttribute('href') }) }],
  addAttributes: () => ({ href: { default: null } }),
  renderHTML: ({ HTMLAttributes }) => {
    const external = /^https?:/i.test(HTMLAttributes.href ?? '');
    return ['a', mergeAttributes(HTMLAttributes, external ? { target: '_blank', rel: 'noreferrer' } : {}), 0];
  },
});

const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: null } }),
  parseHTML: () => [{ style: 'color', getAttrs: color => ({ color }) }],
  renderHTML: ({ HTMLAttributes }) => ['span', { style: `color: ${HTMLAttributes.color}` }, 0],
});

const SmallText = Mark.create({
  name: 'smallText',
  parseHTML: () => [{ tag: 'small' }],
  renderHTML: () => ['small', 0],
});
const Highlight = Mark.create({
  name: 'highlight',
  addAttributes: () => ({ color: { default: null, parseHTML: el => el.style.backgroundColor || null } }),
  parseHTML: () => [{ tag: 'mark' }, { style: 'background-color', getAttrs: color => ({ color }) }],
  renderHTML: ({ HTMLAttributes }) => ['mark', { style: `background-color: ${HTMLAttributes.color}; color: inherit` }, 0],
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

// 첫 행 셀들의 colwidth(px)를 열 순서대로 편 배열. 하나도 없으면 null.
// (열 리사이즈가 쓰는 표준 prosemirror-tables 모델 — 보기/저장의 1차 소스)
function cellColwidthsPx(node) {
  const row = node.firstChild;
  if (!row) return null;
  const out = [];
  let any = false;
  for (let i = 0; i < row.childCount; i += 1) {
    const cell = row.child(i);
    const cw = cell.attrs?.colwidth;
    const span = cell.attrs?.colspan || 1;
    for (let j = 0; j < span; j += 1) {
      const w = cw && cw[j] ? Number(cw[j]) : null;
      if (w) any = true;
      out.push(w);
    }
  }
  return any ? out : null;
}

// 표의 렌더링 폭(px). 셀 colwidth(px)가 있으면 그 합, 없으면 레거시 표 수준 colwidths/tableWidth.
function tableRenderWidth(node) {
  const cellPx = cellColwidthsPx(node);
  if (cellPx) {
    const sum = cellPx.reduce((a, w) => a + (w || 0), 0);
    return sum || null;
  }
  const cols = node.attrs.colwidths;
  let sum = 0;
  if (cols?.length && cols.some((w) => w) && !cols.some((w) => w?.endsWith?.('%'))) {
    sum = cols.reduce((a, w) => a + (w ? parseFloat(w) : 0), 0);
  }
  const width = Math.max(node.attrs.tableWidth ?? 0, sum);
  return width || null;
}

// 번호가 매겨진 행: 표 왼쪽 바깥에 붙는 번호 칸 폭(px). 문서 모델에는 칸이 없고 표시만 한다(Confluence 'numberingColumn')
const NUMBER_COL = 42;
const firstRowIsHeader = (node) => {
  const row = node.firstChild;
  if (!row || !row.childCount) return false;
  for (let i = 0; i < row.childCount; i += 1) if (row.child(i).type.name !== 'tableHeader') return false;
  return true;
};
// 표 요소 클래스(보기 renderHTML과 편집 TableView 공통): 번호 행·헤더 행·정렬·고정 열 너비
function tableClassList(node) {
  const c = [];
  if (node.attrs.numberedRows) c.push('numbered');
  if (firstRowIsHeader(node)) c.push('header-row');
  if (node.attrs.layout === 'center') c.push('t-center');
  if (node.attrs.displayMode === 'fixed') c.push('t-fixed');
  return c;
}
function applyTableClasses(node, table, wrap) {
  const want = tableClassList(node);
  for (const k of ['numbered', 'header-row', 't-center', 't-fixed']) table.classList.toggle(k, want.includes(k));
  wrap.classList.toggle('has-numbers', !!node.attrs.numberedRows);
  if (node.attrs.layout) table.setAttribute('data-layout', node.attrs.layout); else table.removeAttribute('data-layout');
}

// 돌출(.table-wrap breakout)을 유지하면서 열 리사이즈를 지원하는 커스텀 TableView.
// prosemirror-tables columnResizing이 (node, defaultCellMinWidth, view)로 생성한다.
class CfTableView {
  constructor(node, cellMinWidth) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.dom = document.createElement('div');
    this.dom.className = 'table-wrap';
    this.table = this.dom.appendChild(document.createElement('table'));
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    updateColumnsOnResize(node, this.colgroup, this.table, cellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
    this.applyBreakout();
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    updateColumnsOnResize(node, this.colgroup, this.table, this.cellMinWidth);
    this.applyBreakout();
    return true;
  }
  applyBreakout() {
    applyTableClasses(this.node, this.table, this.dom);
    const w = (tableRenderWidth(this.node) ?? 0) + (this.node.attrs.numberedRows ? NUMBER_COL : 0);
    if (w > COLUMN_WIDTH) {
      this.dom.classList.add('breakout');
      this.dom.style.setProperty('--bw', `${Math.round(w)}px`);
    } else {
      this.dom.classList.remove('breakout');
      this.dom.style.removeProperty('--bw');
    }
  }
  ignoreMutation(m) {
    return m.type === 'attributes' && (m.target === this.table || this.colgroup.contains(m.target));
  }
}

// 공식 표 확장 + Confluence 폭 속성(표 전체 폭 px, 레이아웃, colgroup 열 너비) 보존·렌더링
const Table = TableExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableWidth: { default: null, renderHTML: () => ({}) },
      layout: { default: null, renderHTML: (attrs) => (attrs.layout ? { 'data-layout': attrs.layout } : {}) },
      colwidths: { default: null, renderHTML: () => ({}) },
      // 번호가 매겨진 행(표 옵션), 고정된 열 너비(창이 좁아져도 열 px 유지 → 가로 스크롤)
      numberedRows: { default: false, renderHTML: () => ({}) },
      displayMode: { default: null, renderHTML: (a) => (a.displayMode ? { 'data-display-mode': a.displayMode } : {}) },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const fixed = node.attrs.displayMode === 'fixed';
    // Confluence와 동일한 동작: 공간이 있으면 지정 폭으로, 좁으면 스크롤 없이
    // 열 비율을 유지한 채 축소. px 열 너비는 합계 대비 %로 환산해야 축소가 된다
    // (table-layout: fixed에서 px 열의 합계는 표 폭의 하한이 되기 때문).
    // 셀 colwidth(리사이즈 결과)가 있으면 그것이 1차 소스, 없으면 레거시 표 수준 colwidths.
    const cellPx = cellColwidthsPx(node);
    const colwidths = cellPx ? cellPx.map((w) => (w ? `${w}px` : null)) : node.attrs.colwidths;
    const tableWidth = cellPx ? cellPx.reduce((a, w) => a + (w || 0), 0) : node.attrs.tableWidth;
    let cols = colwidths?.some((w) => w) ? colwidths : null;
    let width = tableWidth;
    if (cols && !fixed && !cols.some((w) => w?.endsWith?.('%'))) {
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
    if (fixed && cols && !cols.some((w) => w?.endsWith?.('%'))) {
      const total = cols.reduce((a, w) => a + (w ? parseFloat(w) : 0), 0);
      if (!width || total > width) width = Math.round(total);
    }
    const style = [
      width ? `width: ${width}px;${fixed ? '' : ' max-width: 100%;'}` : '',
      cols ? 'table-layout: fixed;' : '',
    ].join(' ').trim();
    const cls = tableClassList(node);
    const table = ['table', mergeAttributes(HTMLAttributes, style ? { style } : {}, cls.length ? { class: cls.join(' ') } : {})];
    if (cols) {
      table.push(['colgroup', ...cols.map((w) => (w ? ['col', { style: `width: ${w};` }] : ['col', {}]))]);
    }
    table.push(['tbody', 0]);
    // 셀 안 이미지 등으로 최소 폭이 더 클 때만 가로 스크롤이 생긴다
    const wrap = { class: `table-wrap${node.attrs.numberedRows ? ' has-numbers' : ''}` };
    const bw = (width || 0) + (node.attrs.numberedRows ? NUMBER_COL : 0);
    if (bw > COLUMN_WIDTH) { wrap.class += ' breakout'; wrap.style = `--bw: ${Math.round(bw)}px`; }
    return ['div', wrap, table];
  },
// 열 너비 조절은 아래 TableColumnResize(편집기 전용)가 맡는다 — 기본 columnResizing은 끈다
}).configure({ resizable: false, View: CfTableView, cellMinWidth: 48, lastColumnResizable: true });
// 행 높이(세로) 조절용 속성. <tr> height는 실질적으로 최소 높이로 동작한다.
const TableRow = TableRowExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: {
        default: null,
        parseHTML: (el) => parseInt(el.style?.height || el.getAttribute('data-row-height') || '', 10) || null,
        renderHTML: (attrs) => (attrs.rowHeight
          ? { style: `height: ${attrs.rowHeight}px`, 'data-row-height': attrs.rowHeight }
          : {}),
      },
    };
  },
});
// 셀 배경색(Confluence data-highlight-colour)·세로 정렬. 흰색(#ffffff)은 기본과 같으므로 칠하지 않는다(다크 테마에서 흰 칸 방지)
const cellAttrs = {
  background: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-highlight-colour') || null,
    renderHTML: (a) => {
      const bg = a.background && a.background.toLowerCase() !== '#ffffff' ? a.background : null;
      return bg ? { 'data-highlight-colour': bg, style: `background-color: ${bg}` } : {};
    },
  },
  valign: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-valign') || null,
    renderHTML: (a) => (a.valign && a.valign !== 'top' ? { 'data-valign': a.valign, style: `vertical-align: ${a.valign}` } : {}),
  },
};
const TableHeader = TableHeaderExt.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
const TableCell = TableCellExt.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });

// ---------- 작업 항목 ----------

const TaskList = Node.create({
  name: 'taskList',
  group: 'block list',
  content: 'taskItem+',
  parseHTML: () => [{ tag: 'ul.task-list', priority: 1100 }],
  renderHTML: () => ['ul', { class: 'task-list' }, 0],
});
// ---------- 블록 ----------

const Panel = Node.create({
  name: 'panel',
  group: 'block',
  content: 'block+',
  addAttributes: () => ({ panelType: { default: 'info' }, title: { default: null }, bgColor: { default: null }, panelIcon: { default: null } }),
  // 복사/붙여넣기 round-trip용 (본문 변환은 convert-storage.mjs가 담당)
  parseHTML: () => [{
    tag: 'div.panel',
    getAttrs: (el) => ({
      panelType: /panel-([\w-]+)/.exec(el.className)?.[1] || 'info',
      title: el.querySelector(':scope > .panel-title')?.textContent || null,
      bgColor: el.style?.background || null,
      panelIcon: el.querySelector(':scope > .panel-icon')?.textContent || null,
    }),
    contentElement: (el) => el.querySelector(':scope > .panel-body') || el,
  }],
  renderHTML: ({ node }) => {
    const attrs = { class: `panel panel-${node.attrs.panelType}${node.attrs.panelIcon ? ' panel-has-icon' : ''}` };
    const PANEL_BG = { '#F4F5F7': '#F0F1F2', '#FFEBE6': '#FFECEB' };
    const bg = PANEL_BG[node.attrs.bgColor] ?? node.attrs.bgColor;
    if (bg) attrs.style = `background: ${bg}`;
    const PANEL_ICONS = { note: '📄', info: 'ℹ️', tip: '💡', success: '✅', warning: '⚠️', error: '❌' };
    const iconText = node.attrs.panelIcon || (node.attrs.panelType !== 'custom' ? PANEL_ICONS[node.attrs.panelType] : null);
    if (iconText) attrs.class += ' panel-has-icon';
    const icon = iconText ? ['span', { class: 'panel-icon' }, iconText] : null;
    const body = ['div', { class: 'panel-body' }, 0];
    return node.attrs.title
      ? ['div', attrs, icon, ['div', { class: 'panel-title' }, node.attrs.title], body].filter(Boolean)
      : ['div', attrs, icon, body].filter(Boolean);
  },
});

// 내부에 컬럼보다 넓은 표가 있으면 펼치기 박스째 돌출시킨다 (Confluence 동일)
function expandViewAttrs(node) {
  let bw = 0;
  node.descendants((n) => { if (n.type.name === 'table') bw = Math.max(bw, tableRenderWidth(n) ?? 0); });
  const attrs = { class: 'expand' };
  if (bw > COLUMN_WIDTH) { attrs.class += ' breakout'; attrs.style = `--bw: ${Math.round(bw) + 26}px`; }
  const width = widthAttrs(node);
  if (width.style) Object.assign(attrs, width);
  return attrs;
}

const Expand = Node.create({
  name: 'expand',
  group: 'block',
  content: 'block+',
  addAttributes: () => ({ title: { default: '' } }),
  parseHTML: () => [{
    tag: 'details',
    getAttrs: (el) => ({
      title: el.getAttribute('data-title') ?? el.querySelector(':scope > summary')?.textContent ?? '',
    }),
    contentElement: (el) => el.querySelector(':scope > .expand-body') || el,
  }],
  renderHTML: ({ node }) => {
    const attrs = expandViewAttrs(node);
    attrs['data-title'] = node.attrs.title || '';
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
        if (attrs['data-block-width']) details.setAttribute('data-block-width', attrs['data-block-width']);
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
        if (a['data-block-width']) dom.setAttribute('data-block-width', a['data-block-width']); else dom.removeAttribute('data-block-width');
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
  parseHTML: () => [{ tag: 'div.layout' }],
  renderHTML: ({ node }) => ['div', { class: 'layout', ...widthAttrs(node) }, 0],
});
const LayoutSection = Node.create({
  name: 'layoutSection', content: 'layoutColumn+',
  addAttributes: () => ({ kind: { default: 'single' } }),
  parseHTML: () => [{
    tag: 'div.layout-section',
    getAttrs: (el) => ({
      kind: (el.getAttribute('class') || '').split(/\s+/).find((c) => c.startsWith('layout-') && c !== 'layout-section')?.slice(7) || 'single',
    }),
  }],
  renderHTML: ({ node }) => ['div', { class: `layout-section layout-${node.attrs.kind}` }, 0],
});
const LayoutColumn = Node.create({
  name: 'layoutColumn', content: 'block*',
  addAttributes: () => ({ width: { default: null, parseHTML: el => Number(el.getAttribute('data-column-width')) || null, renderHTML: () => ({}) } }),
  parseHTML: () => [{ tag: 'div.layout-column' }],
  renderHTML: ({ node }) => ['div', { class: 'layout-column', ...(node.attrs.width > 0 ? { 'data-column-width': node.attrs.width, style: `--column-width:${node.attrs.width}` } : {}) }, 0],
});

// Mermaid 다이어그램 블록 (GIRA-18): 내용 = Mermaid 코드. 그림으로 그리는 것은 보기 렌더러(GIRA-44)가 한다.
//  image: 원본 Confluence가 미리 그린 PNG(data URI) — 코드가 없으면 이 그림을 그대로 보여 준다
const Mermaid = Node.create({
  name: 'mermaid', group: 'block', content: 'text*', marks: '', code: true,
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.isActive('mermaid') && this.editor.commands.command(({ tr }) => { tr.insertText('\n'); return true; }),
      'Mod-Enter': () => {
        if (!this.editor.isActive('mermaid')) return false;
        const { $from } = this.editor.state.selection;
        const pos = $from.after();
        return this.editor.chain().insertContentAt(pos, { type: 'paragraph' }).setTextSelection(pos + 1).run();
      },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      if (editor.isEditable) return mermaidEditorView({ node, editor, getPos });
      const dom = document.createElement('div');
      // 부모가 DOM에 붙은 뒤 펼치기 조상을 찾는다.
      let cleanup;
      const timer = setTimeout(() => { cleanup = mountMermaid(dom, node.textContent, node.attrs); }, 0);
      return { dom, stopEvent: () => true, ignoreMutation: () => true,
        destroy() { clearTimeout(timer); cleanup?.(); } };
    };
  },
  addAttributes: () => ({
    image: { default: null, rendered: false },
    size: { default: null, rendered: false },
    caption: { default: null, rendered: false },
  }),
  renderHTML: ({ node }) => {
    const attrs = { class: 'mermaid-src', ...(node.attrs.image ? { 'data-mermaid-image': node.attrs.image } : {}), ...(node.attrs.caption ? { 'data-mermaid-caption': node.attrs.caption } : {}), ...(node.attrs.size ? { 'data-size': node.attrs.size } : {}) };
    // 코드 없이 그림만 있는 원본(B형): 그림을 보여 준다 (원문 base64를 글자로 보여 주지 않는다)
    if (!node.textContent && node.attrs.image) {
      return ['figure', { class: 'mermaid-image' }, ['img', { src: node.attrs.image, alt: node.attrs.caption || 'Mermaid 다이어그램' }],
        ...(node.attrs.caption ? [['figcaption', {}, node.attrs.caption]] : [])];
    }
    return ['pre', attrs, ['code', 0]];
  },
});

const JiraTable = Node.create({
  name: 'jiraTable', group: 'block', atom: true,
  addAttributes: () => ({ jql: { default: '' }, columns: { default: null }, maximumIssues: { default: null } }),
  renderHTML: ({ node }) => ['div', { class: 'jira-table' },
    ['span', { class: 'macro-badge' }, 'Jira 검색'], ['code', {}, node.attrs.jql ?? '']],
});

// 보기 화면에서 web/src/macros.js가 실데이터로 채우는 매크로들
export const HYDRATED_MACROS = new Set([
  'create-from-template',
  'toc', 'children', 'pagetree', 'view-file', 'viewdoc', 'viewpdf', 'viewppt', 'viewxls',
  'widget', 'profile', 'contributors', 'recently-updated', 'contentbylabel',
  'include', 'excerpt-include', 'drawio', 'pagetreesearch', 'livesearch', 'jirachart',
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
  addNodeView() {
    return ({ node, editor }) => {
      if (node.attrs.name !== 'toc' || !editor.isEditable) return null;
      const dom = document.createElement('div');
      dom.contentEditable = 'false';
      const render = () => {
        const headings = [];
        editor.state.doc.descendants((heading, pos) => {
          if (heading.type.name !== 'heading') return;
          headings.push({ level: heading.attrs.level, text: heading.textContent,
            href: `#heading-${pos}`,
            scroll: () => editor.view.nodeDOM(pos)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
        });
        dom.replaceChildren(createToc(headings));
      };
      render();
      editor.on('update', render);
      return {
        dom,
        update: (next) => next.type === node.type && next.attrs.name === 'toc',
        ignoreMutation: () => true,
        stopEvent: (event) => event.target.closest('a') !== null,
        destroy: () => editor.off('update', render),
      };
    };
  },
  renderHTML: ({ node }) => {
    const { name, params, dynamic } = node.attrs;
    // 본문을 가진 매크로는 내용을 직접 렌더링
    if (name === 'excerpt') return ['div', { class: 'macro-excerpt' }, 0];
    // 내보내기 앱 표시(쪽 나눔 등): 보기에서 숨김, 편집기에서는 얇은 표시만 (styles.css)
    if (HIDDEN_MACROS.has(name)) return ['div', { class: 'cf-macro-hidden', 'data-macro': name }, ['div', { style: 'display: none' }, 0]];
    if (BODY_ONLY_MACROS.has(name)) return ['div', { class: 'macro-body-only', 'data-macro': name }, 0];
    if (NOTICE_MACROS.has(name)) return ['div', { class: 'cf-macro-notice', 'data-macro': name }, noticeText(name), ['div', { style: 'display: none' }, 0]];
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
  parseHTML: () => ['decision-list', 'decision-item'].map(adfType => ({ tag: `div.${adfType}`, getAttrs: () => ({ adfType }) })),
  addAttributes: () => ({ adfType: { default: '' }, attrs: { default: {} } }),
  renderHTML: ({ node }) => {
    const t = node.attrs.adfType;
    if (t === 'decision-list') return ['div', { class: 'decision-list' }, 0];
    if (t === 'decision-item') return ['div', { class: 'decision-item' }, 0];
    if (t === 'bodied-extension') return ['div', { class: 'macro-body-only', 'data-adf': t }, 0]; // 앱이 감싼 본문(Scroll Ignore 등)
    return ['div', { class: 'cf-macro' },
      ['span', { class: 'macro-badge' }, `adf: ${t}`],
      ['div', { class: 'cf-macro-body' }, 0]];
  },
});

// ---------- 인라인 ----------

const inlineAtom = { group: 'inline', inline: true, atom: true };

const Media = Node.create({
  addProseMirrorPlugins() { return [new Plugin({ props: { handleClickOn(view, pos, node, nodePos, event) {
    if (node.type.name !== 'media' || !event.target.closest('img')) return false;
    event.preventDefault(); view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos))); return true;
  } } })]; },
  name: 'media', group: 'inline', inline: true, selectable: true, content: 'mediaCaption?',
  parseHTML: () => [{ tag: '[data-media]', contentElement: el => el.querySelector('.media-caption-content') || el.ownerDocument.createElement('span'), getAttrs: el => { try { return JSON.parse(el.getAttribute('data-media')); } catch { return false; } } }],
  addAttributes: () => ({
    kind: { default: 'attachment' }, filename: { default: null }, src: { default: null },
    width: { default: null }, align: { default: null }, layout: { default: null },
    border: { default: null }, borderColor: { default: null }, borderWidth: { default: null }, alt: { default: null }, caption: { default: null }, href: { default: null },
  }),
  renderHTML: ({ node }) => {
    const { src, filename, width, align, layout, border, borderColor, borderWidth, alt, caption, href } = node.attrs;
    if (!src) return ['span', { class: 'media-missing' }, `🖼 ${filename ?? '(이미지)'}`];
    const img = ['img', {
      src, alt: alt ?? filename ?? '',
      ...(width ? { width } : {}),
      ...(border ? { class: 'media-border', style: `border: ${[1, 2, 4].includes(Number(borderWidth)) ? Number(borderWidth) : 1}px solid ${['#DCDFE4', '#8590A2', '#44546F'].includes(borderColor) ? borderColor : '#DCDFE4'}` } : {}),
    }];
    const breakout = width && width > 760;
    const cls = `media ${align ? `media-${align}` : ''} ${layout ? `media-layout-${layout}` : ''}${breakout ? ' media-breakout' : ''}`.trim();
    const style = breakout ? `--media-w: ${width}px` : null;
    if (href && /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)) {
      const image = [...img]; img.splice(0, img.length, 'a', { href, target: '_blank', rel: 'noopener noreferrer' }, image);
    }
    // Keep a content hole even before a caption is added: ProseMirror reuses
    // this DOM when child content changes without changing image attributes.
    const children = [img];
    if (caption && !node.childCount) children.push(['span', { class: 'media-legacy-caption' }, caption]);
    children.push(['span', { class: 'media-caption-content' }, 0]);
    return ['span', { class: cls, 'data-media': JSON.stringify(node.attrs), ...(style ? { style } : {}) }, ...children];
  },
});

const Mention = Node.create({
  name: 'mention', ...inlineAtom,
  addAttributes: () => ({ accountId: { default: null }, text: { default: '' } }),
  parseHTML: () => [{ tag: 'span.mention', getAttrs: (el) => ({ text: (el.textContent || '').replace(/^@/, '') }) }],
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
  parseHTML: () => [{ tag: 'span.emoji', getAttrs: (el) => ({ text: el.textContent || '' }) }],
  renderHTML: ({ node }) => ['span', { class: 'emoji' },
    node.attrs.text || LEGACY_EMOTICONS[node.attrs.shortName?.replaceAll(':', '')] || node.attrs.shortName || '❓'],
});

const DateNode = Node.create({
  name: 'date', ...inlineAtom,
  addNodeView: () => inlineElementView('date'),
  addAttributes: () => ({ date: { default: '' } }),
  parseHTML: () => [{ tag: 'span.date-lozenge', getAttrs: (el) => ({ date: el.dataset.date || el.textContent || '' }) }],
  renderHTML: ({ node }) => ['span', datePresentation(node.attrs.date), node.attrs.date],
});

const Status = Node.create({
  name: 'status', ...inlineAtom,
  addNodeView: () => inlineElementView('status'),
  addAttributes: () => ({ text: { default: '' }, color: { default: 'neutral' } }),
  parseHTML: () => [{
    tag: 'span.status',
    getAttrs: (el) => ({ text: el.textContent || '', color: /status-([\w-]+)/.exec(el.className)?.[1] || 'neutral' }),
  }],
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
  parseHTML: () => [{ tag: 'a.jira-issue[data-issue-key]', getAttrs: (el) => ({ key: el.dataset.issueKey }) }],
  renderHTML: ({ node }) => ['a', {
    class: 'jira-issue', target: '_blank', rel: 'noreferrer',
    'data-issue-key': node.attrs.key,
    href: `/api/gira/issues/${encodeURIComponent(node.attrs.key)}/open`,
  }, node.attrs.key],
  addNodeView() {
    return ({ node }) => {
      // 편집기: 칩(a)과 상태 표시를 한 덩어리(span)로 둔다
      const dom = document.createElement('span');
      dom.className = 'jira-issue-wrap';
      const a = dom.appendChild(document.createElement('a'));
      a.className = 'jira-issue';
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.dataset.issueKey = node.attrs.key;
      a.textContent = node.attrs.key;
      a.href = `/api/gira/issues/${encodeURIComponent(node.attrs.key)}/open`;
      const cancel = hydrateIssueCard(a);
      return { dom, destroy: cancel };
    };
  },
});

const PageLink = Node.create({
  name: 'pageLink', group: 'inline', inline: true, content: 'text*',
  addAttributes: () => ({ contentTitle: { default: '' }, spaceKey: { default: null } }),
  renderHTML: ({ node }) => ['a', {
    class: 'page-link', href: '#',
    'data-title': node.attrs.contentTitle, 'data-space': node.attrs.spaceKey ?? '',
  }, node.childCount ? 0 : node.attrs.contentTitle],
});

const SpaceLink = Node.create({
  name: 'spaceLink', group: 'inline', inline: true, content: 'text*',
  addAttributes: () => ({ spaceKey: { default: '' } }),
  renderHTML: ({ node }) => ['a', {
    class: 'space-link', href: '#', 'data-space': node.attrs.spaceKey ?? '',
  }, node.childCount ? 0 : node.attrs.spaceKey],
});

const LinkCard = Node.create({
  name: 'linkCard', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({
    href: { default: '' }, title: { default: '' },
    kind: { default: 'page' }, status: { default: '' },
  }),
  parseHTML: () => [{ tag: 'a[data-link-card]', getAttrs: (el) => ({
    href: el.getAttribute('href'), title: el.querySelector('strong')?.textContent ?? '',
    kind: el.dataset.kind, status: el.querySelector('.link-card-status')?.textContent ?? '',
  }) }],
  renderHTML: ({ node }) => {
    const { href, title, kind, status } = node.attrs;
    const safe = /^(https?:\/\/|\/(?!\/))/i.test(href);
    return ['a', { class: 'link-card', 'data-link-card': '', 'data-kind': kind,
      href: safe ? href : '#', target: '_blank', rel: 'noopener noreferrer' },
      ['span', { class: 'link-card-kind' }, kind === 'issue' ? 'Gira' : kind === 'url' ? '웹' : 'Gonfluence'],
      ['strong', {}, title || href],
      ...(status ? [['span', { class: 'link-card-status' }, status]] : []),
    ];
  },
  // 편집기·보기 화면: 저장된 제목·상태로 그린 뒤 최신 값으로 바꾼다
  addNodeView() {
    return ({ node }) => {
      const { href, title, kind, status } = node.attrs;
      const a = document.createElement('a');
      a.className = 'link-card';
      a.dataset.linkCard = '';
      a.dataset.kind = kind;
      a.href = /^(https?:\/\/|\/(?!\/))/i.test(href) ? href : '#';
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      const k = a.appendChild(document.createElement('span'));
      k.className = 'link-card-kind'; k.textContent = kind === 'issue' ? 'Gira' : kind === 'url' ? '웹' : 'Gonfluence';
      a.appendChild(document.createElement('strong')).textContent = title || href;
      if (status) { const s = a.appendChild(document.createElement('span')); s.className = 'link-card-status'; s.textContent = status; }
      return { dom: a, destroy: hydrateLinkCard(a) };
    };
  },
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
    if (HIDDEN_MACROS.has(name)) return ['span', { class: 'cf-macro-hidden', 'data-macro': name }];
    if (NOTICE_MACROS.has(name)) return ['span', { class: 'cf-macro-notice', 'data-macro': name }, noticeText(name)];
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

// Confluence 편집기 단축키 (editor-spec.md의 Ctrl+/ 도움말 캡처 기준 — TipTap 기본에 없는 것만)
export const ConfluenceShortcuts = Extension.create({
  name: 'confluenceShortcuts',
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    return {
      'Mod-Shift-m': () => ed().commands.toggleCode(),
      'Mod-\\': () => ed().chain().focus().unsetAllMarks().clearNodes().run(),
      Tab: () => ed().commands.sinkListItem(ed().isActive('taskItem') ? 'taskItem' : 'listItem'),
      'Shift-Tab': () => ed().commands.liftListItem(ed().isActive('taskItem') ? 'taskItem' : 'listItem'),
      'Mod-Alt-0': () => ed().chain().unsetMark('smallText').setParagraph().run(),
      'Mod-Shift-9': () => ed().commands.toggleBlockquote(),
      'Mod-Shift-6': () => ed().chain().focus().toggleList('taskList', 'taskItem').run(), // 작업 목록 (Confluence)
      'Mod-Shift-,': () => ed().commands.toggleMark('subscript'),
      'Mod-Shift-.': () => ed().commands.toggleMark('superscript'),
      'Mod-Shift--': () => ed().commands.setHorizontalRule(),
      'Mod-Shift-l': () => ed().commands.setTextAlign(null),
      'Mod-Alt-e': () => ed().commands.setTextAlign('center'),
      'Mod-Alt-t': () => ed().commands.setTextAlign('right'),
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

// 문서 끝 블록(표·패널·펼치기·레이아웃·코드블록·제목 등) 아래에 항상 빈 문단을 둬서
// 마지막 블록 밑으로 커서를 내릴 수 있게 한다 (Confluence도 본문 끝에 빈 줄 유지).
function needsTrailing(doc) {
  const last = doc.lastChild;
  return !!last && last.type.name !== 'paragraph';
}
export const TrailingNode = Extension.create({
  name: 'trailingNode',
  addProseMirrorPlugins() {
    const key = new PluginKey('trailingNode');
    return [new Plugin({
      key,
      appendTransaction: (_tr, _old, state) => {
        if (!key.getState(state)) return null;
        return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
      },
      state: {
        init: (_, state) => needsTrailing(state.doc),
        apply: (tr, value) => (tr.docChanged ? needsTrailing(tr.doc) : value),
      },
    })];
  },
});

// 블록 핸들로 통째 선택하거나, 그 아래에서 Backspace로 삭제할 수 있는 "블록" 종류.
const SELECTABLE_BLOCKS = new Set([
  'panel', 'expand', 'table', 'blockquote', 'codeBlock',
  'linkCard', 'layout', 'jiraTable', 'cfMacro', 'adfNode', 'horizontalRule', 'mermaid',
]);

// 블록 바로 아래 문단의 맨 앞에서 Backspace:
//  - 빈 문단이면 앞 블록을 바로 삭제
//  - 내용이 있으면 앞 블록을 선택(한 번 더 누르면 삭제) — 문단을 블록 안으로 합치지 않는다
// (기본 동작은 문단을 패널 등 안으로 끌어들여 "안으로 들어간" 것처럼 보였다)
export const BlockBackspace = Extension.create({
  name: 'blockBackspace',
  priority: 1000,
  addKeyboardShortcuts() {
    // 선택된 블록(NodeSelection) 삭제 시, 그게 컨테이너의 유일한 자식이면 컨테이너를
    // 지우지 말고 빈 문단으로 교체한다 (펼치기 안 유일 패널을 지우면 펼치기까지 사라지던 문제).
    const deleteSelectedBlock = () => {
      const { state, view } = this.editor;
      const sel = state.selection;
      if (!(sel instanceof NodeSelection)) return false;
      if (sel.$from.parent.childCount !== 1) return false; // 형제가 있으면 기본 삭제로 충분
      const tr = state.tr.replaceRangeWith(sel.from, sel.to, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, sel.from + 1)).scrollIntoView();
      view.dispatch(tr);
      return true;
    };
    const backspaceAtBlockStart = () => {
      const { state, view } = this.editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const { $from } = selection;
      if ($from.parentOffset !== 0 || !$from.parent.isTextblock) return false;
      const d = $from.depth;
      const index = $from.index(d - 1);
      if (index === 0) return false;
      const before = $from.node(d - 1).child(index - 1);
      if (!SELECTABLE_BLOCKS.has(before.type.name)) return false;
      const beforePos = $from.before(d) - before.nodeSize;
      if ($from.parent.content.size === 0) {
        view.dispatch(state.tr.delete(beforePos, beforePos + before.nodeSize).scrollIntoView());
      } else {
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, beforePos)).scrollIntoView());
      }
      return true;
    };
    return {
      Backspace: () => deleteSelectedBlock() || backspaceAtBlockStart(),
      Delete: () => deleteSelectedBlock(),
    };
  },
});

// 블록 위에 마우스를 올리면 왼쪽에 핸들(⣿)이 뜨고, 누르면 그 블록을 통째로
// 선택(NodeSelection)한다 → Delete로 삭제, Ctrl+C/V로 복사·붙여넣기.
// 중첩된 경우(펼치기 안 패널 등)엔 포인터 아래의 가장 안쪽 "블록"을 겨냥한다.
export const BlockHandle = Extension.create({
  name: 'blockHandle',
  // 선택 항목 링크 복사 (Confluence Ctrl+Alt+A): 커서가 있는 최상위 블록
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-a': () => {
        const { $from } = this.editor.state.selection;
        const node = this.editor.state.selection.node ?? ($from.depth >= 1 ? $from.node(1) : null);
        if (!node) return false;
        copyBlockLink(node);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const key = new PluginKey('blockHandle');
    const editor = this.editor;
    let handle = null;
    let hoverPos = null;
    let hoverRect = null; // 지금 핸들이 붙은 블록의 화면 위치
    const hide = () => { if (handle) handle.style.display = 'none'; hoverPos = null; hoverRect = null; };
    // 블록 왼쪽 끝과 핸들 사이 '통로'(핸들 높이만큼)에 포인터가 있으면 대상을 바꾸지 않는다.
    // 표 셀 안 펼치기·패널처럼 안쪽 블록의 핸들이 바깥 블록(표) 영역에 뜰 때, 핸들로 가는 도중
    // 바깥 블록으로 대상이 바뀌어 핸들이 달아나는 문제 방지
    const inCorridor = (e) => {
      if (hoverPos == null || !hoverRect || !handle || handle.style.display === 'none') return false;
      const h = handle.getBoundingClientRect();
      return e.clientX >= h.left - 4 && e.clientX <= hoverRect.left + 6
        && e.clientY >= h.top - 8 && e.clientY <= h.bottom + 8;
    };
    return [new Plugin({
      key,
      view(editorView) {
        // 블록 왼쪽: '+'(바로 아래에 요소 넣기 — '/' 메뉴) + '⠿'(누르면 블록 메뉴, 끌면 이동) — GIRA-41
        handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.setAttribute('contenteditable', 'false');
        handle.style.display = 'none';
        const plus = document.createElement('button');
        plus.type = 'button'; plus.className = 'bh-plus'; plus.textContent = '+';
        plus.title = '삽입 (아래에 요소 넣기)'; plus.setAttribute('aria-label', '삽입');
        const grip = document.createElement('button');
        grip.type = 'button'; grip.className = 'bh-grip'; grip.textContent = '⠿'; grip.draggable = true;
        grip.title = '드래그하여 이동합니다 / 메뉴를 열려면 클릭하세요'; grip.setAttribute('aria-label', '블록 메뉴');
        handle.append(plus, grip);
        document.body.appendChild(handle);
        plus.addEventListener('mousedown', (e) => e.preventDefault());
        plus.addEventListener('click', () => {
          if (hoverPos == null) return;
          const node = editorView.state.doc.nodeAt(hoverPos);
          if (!node) return;
          const end = hoverPos + node.nodeSize;
          const tr = editorView.state.tr.insert(end, editorView.state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, end + 1));
          editorView.dispatch(tr.scrollIntoView());
          editorView.focus();
          editor.commands.insertContent('/'); // 슬래시 메뉴가 열린다
          hide();
        });
        grip.addEventListener('click', (e) => {
          if (hoverPos == null) return;
          const pos = hoverPos;
          const sel = NodeSelection.create(editorView.state.doc, pos);
          editorView.dispatch(editorView.state.tr.setSelection(sel));
          editorView.focus();
          openBlockMenu(editor, pos, grip.getBoundingClientRect());
          e.stopPropagation();
        });
        // 끌어서 이동: ProseMirror 기본 드래그(move)로 넘긴다 — 놓는 자리에 표시선(dropcursor)
        grip.addEventListener('dragstart', (e) => {
          if (hoverPos == null) { e.preventDefault(); return; }
          closeBlockMenu();
          const sel = NodeSelection.create(editorView.state.doc, hoverPos);
          editorView.dispatch(editorView.state.tr.setSelection(sel));
          const slice = sel.content();
          editorView.dragging = { slice, move: true };
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData('text/html', '');
          const dom = editorView.nodeDOM(hoverPos);
          if (dom?.nodeType === 1) e.dataTransfer.setDragImage(dom, 0, 0);
        });
        grip.addEventListener('dragend', () => hide());
        // 핸들로 마우스를 옮기는 도중 사라지지 않도록: 에디터 위이거나 핸들 근처면 유지.
        const onDocMove = (e) => {
          if (!handle || handle.style.display === 'none') return;
          if (handle.contains(e.target) || editorView.dom.contains(e.target)) return;
          const r = handle.getBoundingClientRect();
          const near = e.clientX >= r.left - 48 && e.clientX <= r.right + 16
            && e.clientY >= r.top - 20 && e.clientY <= r.bottom + 20;
          if (!near) hide();
        };
        document.addEventListener('mousemove', onDocMove);
        return { destroy() { document.removeEventListener('mousemove', onDocMove); handle?.remove(); handle = null; } };
      },
      props: {
        handleDOMEvents: {
          mousemove(view, event) {
            if (inCorridor(event)) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!at) return false;
            const $pos = view.state.doc.resolve(at.pos);
            if ($pos.depth < 1) { hide(); return false; }
            // 포인터 아래 가장 안쪽의 선택 가능한 블록, 없으면 최상위 블록
            let targetDepth = 1;
            for (let depth = $pos.depth; depth >= 1; depth--) {
              if (SELECTABLE_BLOCKS.has($pos.node(depth).type.name)) { targetDepth = depth; break; }
            }
            const blockPos = $pos.before(targetDepth);
            const dom = view.nodeDOM(blockPos);
            if (!dom || dom.nodeType !== 1) return false;
            const rect = dom.getBoundingClientRect();
            hoverPos = blockPos;
            hoverRect = rect;
            handle.style.display = 'flex';
            handle.style.top = `${rect.top + 2}px`;
            handle.style.left = `${rect.left - 46}px`;
            return false;
          },
        },
      },
    })];
  },
});

// 표 행 높이(세로) 조절: 행의 아래 경계에 마우스를 대면 가로 핸들이 뜨고, 드래그로 rowHeight를 바꾼다.
// prosemirror-tables에 행 리사이즈는 없어 직접 구현한다 (열은 columnResizing이 담당).
// ---------- 표 열 너비 조절 (GIRA-33, 편집기 전용) ----------
// Confluence처럼: 열 경계를 끌면 맞닿은 두 열만 너비를 주고받고 표 전체 폭은 그대로, 마지막 경계는 마지막 열 너비.
// 표 전체 폭은 표 오른쪽 가장자리 핸들(table-ui.jsx)로. 이 플러그인이 표 node view(CfTableView, 돌출 표시)도 제공한다.
const COL_MIN = 48;
function tableColWidthsFromDom(view, tablePos, tableNode) {
  const map = TableMap.get(tableNode);
  const start = tablePos + 1;
  const out = [];
  for (let c = 0; c < map.width; c += 1) {
    let w = null;
    for (let r = 0; r < map.height && w == null; r += 1) {
      const pos = map.map[r * map.width + c];
      const cr = map.findCell(pos);
      if (cr.right - cr.left !== 1) continue;
      const dom = view.nodeDOM(start + pos);
      if (dom && dom.getBoundingClientRect) w = dom.getBoundingClientRect().width;
    }
    out.push(w);
  }
  const known = out.filter((x) => x);
  const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : COLUMN_WIDTH / map.width;
  return out.map((x) => Math.max(COL_MIN, Math.round(x ?? fill)));
}
export function commitColWidths(view, tablePos, widths) {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return;
  const map = TableMap.get(table);
  const start = tablePos + 1;
  const tr = view.state.tr;
  const seen = new Set();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const cell = table.nodeAt(pos);
    const cr = map.findCell(pos);
    tr.setNodeMarkup(start + pos, null, { ...cell.attrs, colwidth: widths.slice(cr.left, cr.right).map((w) => Math.round(w)) });
  }
  view.dispatch(tr);
}
// 끄는 동안의 미리보기: colgroup과 표 폭만 바꾼다(문서는 놓을 때 한 번 바꾼다)
export function previewColWidths(tableEl, widths) {
  const cols = tableEl.querySelectorAll(':scope > colgroup > col');
  widths.forEach((w, i) => { if (cols[i]) cols[i].style.width = `${Math.round(w)}px`; });
  tableEl.style.width = `${Math.round(widths.reduce((a, b) => a + b, 0))}px`;
  tableEl.style.minWidth = '';
}
export const TableColumnResize = Extension.create({
  name: 'tableColumnResize',
  addProseMirrorPlugins() {
    let handle = null;
    let hover = null; // { tablePos, boundary }
    let drag = null;
    const EDGE = 5;
    const hide = () => { if (handle && !drag) { handle.style.display = 'none'; hover = null; } };
    return [new Plugin({
      key: new PluginKey('tableColumnResize'),
      // 새로 들어온 표(삽입·붙여넣기)에 열 너비가 하나도 없으면 Confluence처럼 본문 폭을 열 수로 똑같이 나눠 둔다
      // (너비가 없으면 내용에 따라 열이 들쭉날쭉해진다). 이관된 기존 표는 그 표 전체가 바뀐 범위 안에 있을 때만 해당.
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta('tableColumnResize'))) return null;
        const ranges = [];
        trs.forEach((t, ti) => t.steps.forEach((step, si) => {
          step.getMap().forEach((_a, _b, from, to) => {
            let f = from; let e = to;
            for (let j = si + 1; j < t.steps.length; j += 1) { f = t.steps[j].getMap().map(f, -1); e = t.steps[j].getMap().map(e, 1); }
            for (let k = ti + 1; k < trs.length; k += 1) { f = trs[k].mapping.map(f, -1); e = trs[k].mapping.map(e, 1); }
            if (e > f) ranges.push([f, e]);
          });
        }));
        if (!ranges.length) return null;
        let tr = null;
        for (const [from, to] of ranges) {
          state.doc.nodesBetween(from, Math.min(to, state.doc.content.size), (node, pos) => {
            if (node.type.name !== 'table') return true;
            if (pos < from || pos + node.nodeSize > to) return true; // 표 일부만 바뀜(기존 표 안 입력 등)
            let any = false;
            node.forEach((row) => row.forEach((c) => { if (c.attrs.colwidth?.some((w) => w)) any = true; }));
            if (any) return false;
            const cols = TableMap.get(node).width || 1;
            const w = Math.floor(COLUMN_WIDTH / cols);
            tr = tr ?? state.tr.setMeta('tableColumnResize', true).setMeta('addToHistory', false);
            node.forEach((row, rowOff) => row.forEach((cell, cellOff) => {
              tr.setNodeMarkup(pos + 1 + rowOff + 1 + cellOff, null, { ...cell.attrs, colwidth: Array(cell.attrs.colspan || 1).fill(w) });
            }));
            return false;
          });
        }
        return tr;
      },
      props: {
        nodeViews: { table: (node) => new CfTableView(node, COL_MIN) },
        handleDOMEvents: {
          mousemove(view, e) {
            if (drag || !view.editable) return false;
            const cell = e.target.closest?.('td, th');
            if (!cell || !view.dom.contains(cell)) { hide(); return false; }
            const rect = cell.getBoundingClientRect();
            const nearRight = Math.abs(e.clientX - rect.right) <= EDGE;
            const nearLeft = e.clientX - rect.left <= EDGE;
            if (!nearRight && !nearLeft) { hide(); return false; }
            let pos;
            try { pos = view.posAtDOM(cell, 0); } catch { hide(); return false; }
            const $p = view.state.doc.resolve(pos);
            let tableDepth = -1;
            for (let d = $p.depth; d > 0; d -= 1) if ($p.node(d).type.name === 'table') { tableDepth = d; break; }
            if (tableDepth < 0) { hide(); return false; }
            const table = $p.node(tableDepth);
            const tablePos = $p.before(tableDepth);
            const cellPos = $p.before(tableDepth + 2);
            const map = TableMap.get(table);
            const cr = map.findCell(cellPos - tablePos - 1);
            const boundary = nearRight ? cr.right : cr.left;
            if (boundary === 0) { hide(); return false; }
            const tableEl = cell.closest('table');
            const tr = tableEl.getBoundingClientRect();
            const x = nearRight ? rect.right : rect.left;
            hover = { tablePos, boundary, width: map.width };
            handle.style.display = 'block';
            handle.style.left = `${x - 3}px`;
            handle.style.top = `${tr.top}px`;
            handle.style.height = `${tr.height}px`;
            return false;
          },
          // 핸들 위로 포인터가 올라가도(편집기 밖으로 나간 것) 숨기지 않는다
          mouseleave(_v, e) { if (e.relatedTarget !== handle) hide(); return false; },
        },
      },
      view(view) {
        handle = document.createElement('div');
        handle.className = 'col-resize-handle';
        handle.style.display = 'none';
        handle.title = '열 너비 조절';
        document.body.appendChild(handle);
        const onDown = (e) => {
          if (!hover || e.button !== 0) return;
          e.preventDefault();
          const table = view.state.doc.nodeAt(hover.tablePos);
          const wrap = view.nodeDOM(hover.tablePos);
          const tableEl = wrap?.querySelector?.('table');
          if (!table || !tableEl) return;
          const start = tableColWidthsFromDom(view, hover.tablePos, table);
          drag = { ...hover, x: e.clientX, start, widths: start.slice(), tableEl };
          handle.classList.add('dragging');
          document.body.classList.add('col-resizing');
          const move = (ev) => {
            const d = ev.clientX - drag.x;
            const w = drag.start.slice();
            const b = drag.boundary;
            if (b < drag.width) {
              // 맞닿은 두 열만 주고받는다 (표 전체 폭 유지)
              const pair = w[b - 1] + w[b];
              const left = Math.min(Math.max(COL_MIN, w[b - 1] + d), pair - COL_MIN);
              w[b - 1] = left; w[b] = pair - left;
            } else {
              w[b - 1] = Math.max(COL_MIN, w[b - 1] + d); // 마지막 경계: 마지막 열만
            }
            drag.widths = w;
            previewColWidths(drag.tableEl, w);
            const tr = drag.tableEl.getBoundingClientRect();
            let x = tr.left; for (let i = 0; i < b; i += 1) x += w[i];
            handle.style.left = `${x - 3}px`;
          };
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            handle.classList.remove('dragging');
            document.body.classList.remove('col-resizing');
            const done = drag; drag = null; hide();
            if (done.widths.some((w, i) => Math.round(w) !== Math.round(done.start[i]))) commitColWidths(view, done.tablePos, done.widths);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        };
        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('mouseleave', (e) => { if (!drag && !view.dom.contains(e.relatedTarget)) hide(); });
        return { destroy() { handle.removeEventListener('mousedown', onDown); handle.remove(); } };
      },
    })];
  },
});

// 표 단축키 (Confluence): Ctrl+Alt+화살표 행·열 추가, Ctrl+Alt+Shift+[ ] - = 행·열 이동, Ctrl+⌫ 선택한 행·열 삭제,
// Shift+F10 셀 옵션 메뉴 (메뉴·이동은 table-ui.jsx가 이벤트로 받음)
export const TableShortcuts = Extension.create({
  name: 'tableShortcuts',
  addKeyboardShortcuts() {
    const inTable = () => this.editor.isActive('table');
    // 행·열 이동·삽입(열 폭 유지)은 table-ui.jsx가 처리한다 — 여기서는 신호만
    const cmd = (name) => {
      if (!inTable()) return false;
      window.dispatchEvent(new CustomEvent('gonf-table-cmd', { detail: name }));
      return true;
    };
    return {
      'Mod-Alt-ArrowRight': () => cmd('colAfter'),
      'Mod-Alt-ArrowLeft': () => cmd('colBefore'),
      'Mod-Alt-ArrowDown': () => inTable() && this.editor.commands.addRowAfter(),
      'Mod-Alt-ArrowUp': () => inTable() && this.editor.commands.addRowBefore(),
      // 행·열 이동 (Confluence: Ctrl+Alt+Shift+[ ] 행, - = 열)
      'Mod-Alt-Shift-[': () => cmd('rowUp'),
      'Mod-Alt-Shift-]': () => cmd('rowDown'),
      'Mod-Alt-Shift--': () => cmd('colLeft'),
      'Mod-Alt-Shift-=': () => cmd('colRight'),
      // 행/열 전체를 고른 상태에서 Ctrl+Backspace = 그 행/열 삭제
      'Mod-Backspace': () => {
        const sel = this.editor.state.selection;
        if (!inTable() || !sel.isRowSelection) return false;
        if (sel.isRowSelection()) return this.editor.commands.deleteRow();
        if (sel.isColSelection()) return this.editor.commands.deleteColumn();
        return false;
      },
      'Shift-F10': () => {
        if (!inTable()) return false;
        window.dispatchEvent(new CustomEvent('gonf-cell-menu'));
        return true;
      },
    };
  },
});

export const RowResize = Extension.create({
  name: 'rowResize',
  addProseMirrorPlugins() {
    const key = new PluginKey('rowResize');
    const MIN = 24;
    let handle = null;
    let hoverTr = null;
    let drag = null;
    const hide = () => { if (handle && !drag) { handle.style.display = 'none'; hoverTr = null; } };
    const rowPosFromDom = (view, trEl) => {
      const pos = view.posAtDOM(trEl, 0);
      const $p = view.state.doc.resolve(pos);
      for (let d = $p.depth; d > 0; d -= 1) if ($p.node(d).type.name === 'tableRow') return $p.before(d);
      return null;
    };
    return [new Plugin({
      key,
      view(view) {
        handle = document.createElement('div');
        handle.className = 'row-resize-handle';
        handle.style.display = 'none';
        document.body.appendChild(handle);

        const commit = (h, addHist) => {
          const node = view.state.doc.nodeAt(drag.rowPos);
          if (!node) return;
          let t = view.state.tr.setNodeMarkup(drag.rowPos, null, { ...node.attrs, rowHeight: Math.round(h) });
          if (!addHist) t = t.setMeta('addToHistory', false);
          view.dispatch(t);
        };
        const onMove = (e) => {
          if (!drag) return;
          const h = Math.max(MIN, drag.startH + (e.clientY - drag.startY));
          const rect = drag.trEl.getBoundingClientRect();
          handle.style.top = `${rect.bottom - 2}px`;
          if (drag.raf) cancelAnimationFrame(drag.raf);
          drag.raf = requestAnimationFrame(() => commit(h, false));
        };
        const onUp = (e) => {
          const h = Math.max(MIN, drag.startH + (e.clientY - drag.startY));
          if (drag.raf) cancelAnimationFrame(drag.raf);
          commit(drag.startH, false); // 일단 시작값으로 되돌린 뒤
          commit(h, true);            // 한 번의 undo 스텝으로 최종값 적용
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('mouseup', onUp, true);
          document.body.classList.remove('row-resizing');
          drag = null;
          hide();
        };
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (!hoverTr) return;
          const rowPos = rowPosFromDom(view, hoverTr);
          if (rowPos == null) return;
          drag = { rowPos, startY: e.clientY, startH: hoverTr.getBoundingClientRect().height, trEl: hoverTr, raf: 0 };
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('mouseup', onUp, true);
          document.body.classList.add('row-resizing');
        });
        return { destroy() { handle?.remove(); handle = null; } };
      },
      props: {
        handleDOMEvents: {
          mousemove(view, event) {
            if (drag) return false;
            const el = event.target?.closest?.('tr');
            if (!el || !view.dom.contains(el)) { hide(); return false; }
            const rect = el.getBoundingClientRect();
            const inX = event.clientX >= rect.left && event.clientX <= rect.right;
            // 경계는 두 행이 공유 — 아래 경계면 이 행, 윗 경계면 바로 위 행을 대상으로.
            let target = null;
            let edgeY = 0;
            if (inX && Math.abs(event.clientY - rect.bottom) <= 6) { target = el; edgeY = rect.bottom; }
            else if (inX && Math.abs(event.clientY - rect.top) <= 6) {
              const prev = el.previousElementSibling;
              if (prev && prev.tagName === 'TR') { target = prev; edgeY = rect.top; }
            }
            if (target) {
              hoverTr = target;
              const tr = target.getBoundingClientRect();
              handle.style.display = 'block';
              handle.style.top = `${edgeY - 2}px`;
              handle.style.left = `${tr.left}px`;
              handle.style.width = `${tr.width}px`;
            } else {
              hide();
            }
            return false;
          },
        },
      },
    })];
  },
});

export const ElementInputRules = Extension.create({
  name: 'elementInputRules',
  addInputRules() {
    return [
      ...[[/->$/, '→'], [/:\)$/, '🙂']].map(([find, text]) => new InputRule({ find,
        handler: ({ state, range }) => { state.tr.insertText(text, range.from, range.to); },
      })),
      new InputRule({ find: /^<>\s?$/,
        handler: ({ state, range }) => {
          const block = state.schema.nodeFromJSON(decisionBlock());
          const start = state.doc.resolve(range.from).before();
          state.tr.replaceWith(start, start + state.doc.resolve(range.from).parent.nodeSize, block);
          state.tr.setSelection(TextSelection.create(state.tr.doc, start + 3));
        },
      }),
    ];
  },
});

const custom = [
  Underline, Subscript, Superscript, LinkMark, TextColor, SmallText, Highlight, CommentMark, TextAlign,
  Table, TableRow, TableHeader, TableCell,
  TaskList, TaskItem,
  BlockResize, Panel, Expand, Layout, LayoutSection, LayoutColumn,
  Mermaid, HtmlEmbed, JiraTable, CfMacro, AdfNode,
  Media, MediaCaption, Mention, Emoji, DateNode, Status, Anchor, JiraIssue,
  PageLink, SpaceLink, FileLink, LinkCard, CfMacroInline,
];

// 읽기 전용 렌더링·render-check 용 (undo 히스토리 불필요)
export const extensions = [StarterKit.configure({ history: false, codeBlock: false }), HighlightedCodeBlock, ...custom];

// 편집기 용 (undo/redo 포함)
export const editExtensions = [
  StarterKit.configure({ codeBlock: false }), HighlightedCodeBlock, ...custom,
  ElementInputRules, ConfluenceShortcuts, BlockBackspace, TrailingNode, BlockHandle, RowResize, TableShortcuts, TableColumnResize,
];
