// 변환기(scripts/convert-storage.mjs)가 생성하는 ProseMirror 문서의 전체 어휘.
// StarterKit(문단, 제목, 목록, 인용, 코드, 수평선 등) + 아래 커스텀 노드/마크.
// JSX 없이 작성한다 — node 스크립트(render-check)에서도 그대로 import한다.
import { Extension, Node, Mark, mergeAttributes, wrappingInputRule } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { HighlightedCodeBlock } from './code-block.js';
import TableExt from '@tiptap/extension-table';
import TableRowExt from '@tiptap/extension-table-row';
import TableCellExt from '@tiptap/extension-table-cell';
import TableHeaderExt from '@tiptap/extension-table-header';
import { updateColumnsOnResize } from 'prosemirror-tables';

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
    const w = tableRenderWidth(this.node) ?? 0;
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
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    // Confluence와 동일한 동작: 공간이 있으면 지정 폭으로, 좁으면 스크롤 없이
    // 열 비율을 유지한 채 축소. px 열 너비는 합계 대비 %로 환산해야 축소가 된다
    // (table-layout: fixed에서 px 열의 합계는 표 폭의 하한이 되기 때문).
    // 셀 colwidth(리사이즈 결과)가 있으면 그것이 1차 소스, 없으면 레거시 표 수준 colwidths.
    const cellPx = cellColwidthsPx(node);
    const colwidths = cellPx ? cellPx.map((w) => (w ? `${w}px` : null)) : node.attrs.colwidths;
    const tableWidth = cellPx ? cellPx.reduce((a, w) => a + (w || 0), 0) : node.attrs.tableWidth;
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
}).configure({ resizable: true, View: CfTableView, cellMinWidth: 48, lastColumnResizable: true });
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
  parseHTML: () => [{ tag: 'div.layout' }],
  renderHTML: () => ['div', { class: 'layout' }, 0],
});
const LayoutSection = Node.create({
  name: 'layoutSection', content: 'layoutColumn+',
  addAttributes: () => ({ kind: { default: 'single' } }),
  parseHTML: () => [{
    tag: 'div.layout-section',
    getAttrs: (el) => ({
      kind: [...el.classList].find((c) => c.startsWith('layout-') && c !== 'layout-section')?.slice(7) || 'single',
    }),
  }],
  renderHTML: ({ node }) => ['div', { class: `layout-section layout-${node.attrs.kind}` }, 0],
});
const LayoutColumn = Node.create({
  name: 'layoutColumn', content: 'block*',
  parseHTML: () => [{ tag: 'div.layout-column' }],
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
    const breakout = width && width > 760;
    const cls = `media ${align ? `media-${align}` : ''} ${layout ? `media-layout-${layout}` : ''}${breakout ? ' media-breakout' : ''}`.trim();
    const style = breakout ? `--media-w: ${width}px` : null;
    return caption
      ? ['figure', { class: cls, ...(style ? { style } : {}) }, img, ['figcaption', {}, caption]]
      : ['span', { class: cls, ...(style ? { style } : {}) }, img];
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
  addAttributes: () => ({ date: { default: '' } }),
  parseHTML: () => [{ tag: 'span.date-lozenge', getAttrs: (el) => ({ date: el.textContent || '' }) }],
  renderHTML: ({ node }) => ['span', { class: 'date-lozenge' }, node.attrs.date],
});

const Status = Node.create({
  name: 'status', ...inlineAtom,
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

const SpaceLink = Node.create({
  name: 'spaceLink', group: 'inline', inline: true, content: 'text*',
  addAttributes: () => ({ spaceKey: { default: '' } }),
  renderHTML: ({ node }) => ['a', {
    class: 'space-link', href: '#', 'data-space': node.attrs.spaceKey ?? '',
  }, node.childCount ? 0 : node.attrs.spaceKey],
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

// Confluence 편집기 단축키 (editor-spec.md의 Ctrl+/ 도움말 캡처 기준 — TipTap 기본에 없는 것만)
export const ConfluenceShortcuts = Extension.create({
  name: 'confluenceShortcuts',
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    return {
      'Mod-Shift-m': () => ed().commands.toggleCode(),
      'Mod-\\': () => ed().chain().focus().unsetAllMarks().run(),
      'Mod-Alt-0': () => ed().commands.setParagraph(),
      'Mod-Shift-9': () => ed().commands.toggleBlockquote(),
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
  'layout', 'jiraTable', 'cfMacro', 'adfNode', 'horizontalRule', 'mermaid',
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
  addProseMirrorPlugins() {
    const key = new PluginKey('blockHandle');
    let handle = null;
    let hoverPos = null;
    const hide = () => { if (handle) handle.style.display = 'none'; hoverPos = null; };
    return [new Plugin({
      key,
      view(editorView) {
        handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.setAttribute('contenteditable', 'false');
        handle.title = '블록 선택 (삭제: Delete, 복사: Ctrl+C)';
        handle.textContent = '⣿';
        handle.style.display = 'none';
        document.body.appendChild(handle);
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (hoverPos == null) return;
          const sel = NodeSelection.create(editorView.state.doc, hoverPos);
          editorView.dispatch(editorView.state.tr.setSelection(sel).scrollIntoView());
          editorView.focus();
        });
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
            handle.style.display = 'flex';
            handle.style.top = `${rect.top + 2}px`;
            handle.style.left = `${rect.left - 22}px`;
            return false;
          },
        },
      },
    })];
  },
});

// 표 행 높이(세로) 조절: 행의 아래 경계에 마우스를 대면 가로 핸들이 뜨고, 드래그로 rowHeight를 바꾼다.
// prosemirror-tables에 행 리사이즈는 없어 직접 구현한다 (열은 columnResizing이 담당).
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

const custom = [
  Underline, Subscript, Superscript, LinkMark, TextColor, CommentMark, TextAlign,
  Table, TableRow, TableHeader, TableCell,
  TaskList, TaskItem,
  Panel, Expand, Layout, LayoutSection, LayoutColumn,
  Mermaid, JiraTable, CfMacro, AdfNode,
  Media, Mention, Emoji, DateNode, Status, Anchor, JiraIssue,
  PageLink, SpaceLink, FileLink, CfMacroInline,
];

// 읽기 전용 렌더링·render-check 용 (undo 히스토리 불필요)
export const extensions = [StarterKit.configure({ history: false, codeBlock: false }), HighlightedCodeBlock, ...custom];

// 편집기 용 (undo/redo 포함)
export const editExtensions = [
  StarterKit.configure({ codeBlock: false }), HighlightedCodeBlock, ...custom,
  ConfluenceShortcuts, BlockBackspace, TrailingNode, BlockHandle, RowResize,
];
