#!/usr/bin/env node
// Confluence storage(XHTML) 본문 → ProseMirror(TipTap) 문서 JSON 변환기.
// 데이터 모델(docs/data-model.md)의 커스텀 노드 목록을 따른다.
//
// 모듈: import { convertStorage } from './convert-storage.mjs'
// CLI : node scripts/convert-storage.mjs <storage.xhtml 파일>

import { parseDocument } from 'htmlparser2';
import { decodeHTML } from 'entities';
import { readFileSync } from 'node:fs';

// 새 서비스가 데이터로 렌더링할 동적 매크로. 그 외 미분류 매크로는 unsupported로 센다.
const DYNAMIC_MACROS = new Set([
  'toc', 'children', 'pagetree', 'pagetreesearch', 'include', 'excerpt-include', 'contentbylabel',
  'recently-updated', 'contributors', 'livesearch', 'blog-posts', 'popular-labels', 'listlabels',
  'content-report-table', 'attachments', 'change-history', 'roadmap', 'details', 'detailssummary',
  'profile', 'profile-picture', 'create-from-template', 'jirachart', 'widget', 'viewpdf', 'view-file',
  'viewdoc', 'viewxls', 'viewppt', 'multimedia', 'drawio', 'gliffy', 'plantuml', 'chart', 'vote', 'survey',
  'excerpt', 'scroll-pagebreak', 'iframe', 'html',
]);
const PANEL_TYPES = { info: 'info', note: 'note', tip: 'success', success: 'success', warning: 'warning', error: 'error', panel: 'custom' };

const dec = (s) => decodeHTML(s ?? '');
const isEl = (n) => n.type === 'tag';
const childEl = (n, name) => (n.children ?? []).find((c) => isEl(c) && c.name === name);
const childEls = (n, name) => (n.children ?? []).filter((c) => isEl(c) && c.name === name);

function textOf(node) {
  if (node.type === 'text') return dec(node.data);
  if (node.type === 'cdata') return (node.children ?? []).map((c) => c.data ?? '').join('');
  return (node.children ?? []).map(textOf).join('');
}

// <ac:parameter> 들을 {이름: 값}으로 모은다. ri:* 참조가 들어 있으면 속성 객체로 보존한다.
function macroParams(node) {
  const params = {};
  for (const p of childEls(node, 'ac:parameter')) {
    const name = dec(p.attribs['ac:name'] ?? '');
    // ri:* 참조는 직접 자식이거나 <ac:link> 안에 감싸여 올 수 있다 (include/excerpt-include 등)
    let ref = (p.children ?? []).find((c) => isEl(c) && c.name.startsWith('ri:'));
    if (!ref) {
      const link = (p.children ?? []).find((c) => isEl(c) && c.name === 'ac:link');
      if (link) ref = (link.children ?? []).find((c) => isEl(c) && c.name.startsWith('ri:'));
    }
    params[name] = ref ? { ref: ref.name, ...mapValues(ref.attribs, dec) } : textOf(p).trim();
  }
  return params;
}
const mapValues = (o, f) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, f(v)]));
const plainBody = (node) => {
  const b = childEl(node, 'ac:plain-text-body');
  return b == null ? null : textOf(b);
};

const text = (t, marks) => ({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
const para = (content) => ({ type: 'paragraph', ...(content.length ? { content } : {}) });

export function convertStorage(xhtml) {
  const stats = { tags: {}, unknownTags: {}, macros: {}, dynamicMacros: {}, unsupportedMacros: {} };
  const inc = (m, k) => (m[k] = (m[k] ?? 0) + 1);

  function inline(nodes, marks) {
    const out = [];
    for (const n of nodes ?? []) {
      if (n.type === 'text' || n.type === 'cdata') {
        const t = n.type === 'cdata' ? textOf(n) : dec(n.data);
        if (t) out.push(text(t, marks));
        continue;
      }
      if (!isEl(n)) continue;
      inc(stats.tags, n.name);
      const withMark = (mark) => out.push(...inline(n.children, [...marks, mark]));
      switch (n.name) {
        case 'strong': case 'b': withMark({ type: 'bold' }); break;
        case 'em': case 'i': withMark({ type: 'italic' }); break;
        case 'u': withMark({ type: 'underline' }); break;
        case 's': case 'del': case 'strike': withMark({ type: 'strike' }); break;
        case 'code': withMark({ type: 'code' }); break;
        case 'sub': withMark({ type: 'subscript' }); break;
        case 'sup': withMark({ type: 'superscript' }); break;
        case 'a': withMark({ type: 'link', attrs: { href: dec(n.attribs.href ?? '') } }); break;
        case 'br': out.push({ type: 'hardBreak' }); break;
        case 'small': withMark({ type: 'smallText' }); break;
        case 'mark':
        case 'span': {
          const style = n.attribs.style ?? '';
          const next = [...marks];
          const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1];
          const background = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1];
          if (color) next.push({ type: 'textColor', attrs: { color: color.trim() } });
          if (background || n.name === 'mark') next.push({ type: 'highlight', attrs: { color: background?.trim() || '#fff0b3' } });
          out.push(...inline(n.children, next));
          break;
        }
        case 'time':
          out.push({ type: 'date', attrs: { date: dec(n.attribs.datetime ?? '') } });
          break;
        case 'ac:emoticon':
          out.push({ type: 'emoji', attrs: {
            shortName: dec(n.attribs['ac:emoji-shortname'] ?? n.attribs['ac:name'] ?? ''),
            text: dec(n.attribs['ac:emoji-fallback'] ?? ''),
          } });
          break;
        case 'ac:inline-comment-marker':
          out.push(...inline(n.children, [...marks, { type: 'commentMark', attrs: { ref: dec(n.attribs['ac:ref'] ?? '') } }]));
          break;
        case 'ac:link': case 'ac:link-body': {
          const page = childEl(n, 'ri:page');
          const space = childEl(n, 'ri:space');
          const user = childEl(n, 'ri:user');
          const att = childEl(n, 'ri:attachment');
          const bodyNode = childEl(n, 'ac:plain-text-link-body') ?? childEl(n, 'ac:link-body');
          const label = bodyNode ? textOf(bodyNode) : '';
          if (user) out.push({ type: 'mention', attrs: { accountId: dec(user.attribs['ri:account-id'] ?? ''), text: label } });
          else if (space) out.push({ type: 'spaceLink', attrs: {
            spaceKey: dec(space.attribs['ri:space-key'] ?? ''),
          }, ...(label ? { content: [text(label, [])] } : {}) });
          else if (page) out.push({ type: 'pageLink', attrs: {
            contentTitle: dec(page.attribs['ri:content-title'] ?? ''),
            spaceKey: dec(page.attribs['ri:space-key'] ?? '') || null,
          }, ...(label ? { content: [text(label, [])] } : {}) });
          else if (att) out.push({ type: 'fileLink', attrs: { filename: dec(att.attribs['ri:filename'] ?? '') }, ...(label ? { content: [text(label, [])] } : {}) });
          else if (label) out.push(text(label, marks));
          break;
        }
        case 'ac:structured-macro': case 'ac:macro': {
          const node = macroNode(n, true);
          if (node) out.push(node);
          break;
        }
        case 'ac:image': out.push(imageNode(n)); break; // 인라인 위치의 이미지도 수용
        case 'ac:placeholder': break;
        default:
          inc(stats.unknownTags, n.name);
          out.push(...inline(n.children, marks)); // 내용은 잃지 않는다
      }
    }
    return out;
  }

  function imageNode(n) {
    const att = childEl(n, 'ri:attachment');
    const url = childEl(n, 'ri:url');
    const caption = childEl(n, 'ac:caption');
    return {
      type: 'media',
      attrs: {
        kind: att ? 'attachment' : 'external',
        filename: att ? dec(att.attribs['ri:filename'] ?? '') : null,
        src: url ? dec(url.attribs['ri:value'] ?? '') : null,
        width: Number(n.attribs['ac:width'] ?? n.attribs['ac:custom-width'] ?? n.attribs['ac:original-width']) || null,
        align: dec(n.attribs['ac:align'] ?? '') || null,
        layout: dec(n.attribs['ac:layout'] ?? '') || null, // center/align-start/wide/full-width 등
        border: n.attribs['ac:border'] === 'true' || null,
        // 원본은 테두리 유무만 제공한다. 편집기의 색·굵기는 기본값으로 렌더한다.
        borderColor: null, borderWidth: null,
        alt: dec(n.attribs['ac:alt'] ?? '') || null,
        caption: null,
      },
      ...(caption ? { content: [{
        type: 'mediaCaption',
        content: inline(caption.children, [])
          .filter(n => ['text', 'mention', 'emoji', 'pageLink', 'spaceLink', 'fileLink'].includes(n.type))
          .map(n => ({ ...n, ...(n.marks ? {
            marks: n.marks.filter(m => ['bold', 'italic', 'underline', 'textColor', 'link'].includes(m.type)),
          } : {}) })),
      }] } : {}),
    };
  }

  function macroNode(n, inlineCtx) {
    const name = dec(n.attribs['ac:name'] ?? '');
    inc(stats.macros, name);
    const params = macroParams(n);
    const rich = childEl(n, 'ac:rich-text-body');
    switch (name) {
      case 'code': case 'noformat': {
        // ProseMirror는 빈 텍스트 노드를 허용하지 않는다 — 빈 코드 블록은 content 생략
        const code = (plainBody(n) ?? '').replace(/\r\n/g, '\n');
        const truthy = (v) => v === true || v === 'true';
        return { type: 'codeBlock', attrs: {
          language: params.language ?? null,
          blockWidth: Number(n.attribs['ac:width']) >= 760 ? Number(n.attribs['ac:width']) : null,
          wrap: truthy(params.wrap),
          lineNumbers: params.linenumbers == null ? true : truthy(params.linenumbers),
          collapsed: truthy(params.collapse),
        }, ...(code ? { content: [{ type: 'text', text: code }] } : {}) };
      }
      case 'info': case 'note': case 'tip': case 'success': case 'warning': case 'error': case 'panel':
        return { type: 'panel', attrs: {
          panelType: PANEL_TYPES[name], title: params.title ?? null, bgColor: params.bgColor ?? null,
          panelIcon: params.panelIconText ?? params.panelIcon ?? null,
        }, content: ensureBlocks(rich ? blocks(rich.children) : []) };
      case 'expand':
        return { type: 'expand', attrs: { title: params.title ?? '', blockWidth: Number(n.attribs['ac:width']) >= 760 ? Number(n.attribs['ac:width']) : null },
          content: ensureBlocks(rich ? blocks(rich.children) : []) };
      case 'status':
        return { type: 'status', attrs: { text: params.title ?? '', color: (params.colour ?? params.color ?? 'neutral').toLowerCase() } };
      case 'anchor':
        return { type: 'anchor', attrs: { name: params[''] ?? params.anchorName ?? Object.values(params)[0] ?? '' } };
      case 'jira':
        if (params.jqlQuery) return { type: 'jiraTable', attrs: { jql: params.jqlQuery, columns: params.columns ?? null, maximumIssues: params.maximumIssues ?? null } };
        return { type: 'jiraIssue', attrs: { key: typeof params.key === 'string' ? params.key : '' } };
      case 'mermaid': case 'mermaid-cloud': {
        const code = plainBody(n) ?? params.code ?? null;
        if (code) return { type: 'mermaid', attrs: {}, content: [{ type: 'text', text: code }] };
        return cfMacro(name, params, rich, inlineCtx); // 첨부 기반 mermaid 매크로
      }
      case 'section': { // 구식 레이아웃: section > column
        const cols = rich ? childEls(rich, 'ac:structured-macro').filter((c) => dec(c.attribs['ac:name'] ?? '') === 'column') : [];
        for (const c of cols) inc(stats.macros, 'column');
        return { type: 'layout', content: [{ type: 'layoutSection', attrs: { kind: 'legacy' },
          content: (cols.length ? cols : [null]).map((c) => {
            const rb = c ? childEl(c, 'ac:rich-text-body') : rich;
            return { type: 'layoutColumn', content: ensureBlocks(rb ? blocks(rb.children) : []) };
          }) }] };
      }
      case 'column': // section 없이 단독으로 쓰인 column
        return { type: 'layout', content: [{ type: 'layoutSection', attrs: { kind: 'legacy' },
          content: [{ type: 'layoutColumn', content: ensureBlocks(rich ? blocks(rich.children) : []) }] }] };
      default: {
        inc(DYNAMIC_MACROS.has(name) ? stats.dynamicMacros : stats.unsupportedMacros, name);
        return cfMacro(name, params, rich, inlineCtx);
      }
    }
  }

  function cfMacro(name, params, rich, inlineCtx) {
    return {
      type: inlineCtx ? 'cfMacroInline' : 'cfMacro',
      attrs: { name, params, dynamic: DYNAMIC_MACROS.has(name) },
      ...(rich && !inlineCtx ? { content: ensureBlocks(blocks(rich.children)) } : {}),
    };
  }

  // ac:adf-attribute / ac:adf-parameter 트리를 중첩 객체로 보존한다
  function adfParams(n) {
    const out = {};
    for (const c of n.children ?? []) {
      if (!isEl(c)) continue;
      if (c.name === 'ac:adf-parameter' || c.name === 'ac:adf-attribute') {
        const key = dec(c.attribs.key ?? '');
        const nested = (c.children ?? []).some((x) => isEl(x));
        out[key] = nested ? adfParams(c) : textOf(c).trim();
      } else if (c.name === 'ac:adf-parameter-value') {
        (out.values ??= []).push(textOf(c).trim());
      }
    }
    return out;
  }

  function adfNode(n) {
    const type = dec(n.attribs.type ?? '');
    inc(stats.macros, 'adf:' + type);
    const attrs = {};
    const kids = [];
    for (const c of n.children ?? []) {
      if (!isEl(c)) continue;
      if (c.name === 'ac:adf-attribute') {
        const key = dec(c.attribs.key ?? '');
        attrs[key] = (c.children ?? []).some((x) => isEl(x)) ? adfParams(c) : textOf(c).trim();
      } else if (c.name === 'ac:adf-node') kids.push(adfNode(c));
      else if (c.name === 'ac:adf-content') kids.push(...blocks(c.children));
    }
    if (type === 'extension') {
      const key = String(attrs['extension-key'] ?? '');
      const shortName = key.split('/').pop() || 'extension';
      inc(stats.unsupportedMacros, 'adf-ext:' + shortName);
      return { type: 'cfMacro', attrs: { name: 'adf-ext:' + shortName, params: attrs, dynamic: false } };
    }
    if (type === 'panel')
      return { type: 'panel', attrs: { panelType: attrs['panel-type'] || 'info', title: null, bgColor: null }, content: ensureBlocks(kids) };
    if (type !== 'decision-list' && type !== 'decision-item') inc(stats.unsupportedMacros, 'adf:' + type);
    return { type: 'adfNode', attrs: { adfType: type, attrs }, ...(kids.length ? { content: kids } : {}) };
  }

  const ensureBlocks = (arr) => (arr.length ? arr : [para([])]);
  // 셀, 리스트 아이템 등 블록 컨테이너에서 벗어난 인라인을 문단으로 감싼다
  function wrapLoose(items) {
    const out = [];
    let buf = [];
    const flush = () => { if (buf.length) { out.push(para(buf)); buf = []; } };
    for (const it of items) {
      if (it.__inline) { const t = it.node; if (!(t.type === 'text' && !t.text.trim())) buf.push(t); }
      else { flush(); out.push(it.node); }
    }
    flush();
    return out;
  }

  function blocks(nodes) {
    const items = [];
    const pushInline = (n) => { for (const t of inline([n], [])) items.push({ __inline: true, node: t }); };
    for (const n of nodes ?? []) {
      if (n.type === 'text' || n.type === 'cdata') { pushInline(n); continue; }
      if (!isEl(n)) continue;
      inc(stats.tags, n.name);
      const h = /^h([1-6])$/.exec(n.name);
      if (h) { items.push({ node: { type: 'heading', attrs: { level: Number(h[1]) }, content: inline(n.children, []) } }); continue; }
      switch (n.name) {
        case 'p':
          items.push({ node: para(inline(n.children, [])) });
          break;
        case 'ul': case 'ol':
          items.push({ node: { type: n.name === 'ul' ? 'bulletList' : 'orderedList',
            content: childEls(n, 'li').map((li) => ({ type: 'listItem', content: ensureBlocks(blocks(li.children)) })) } });
          break;
        case 'ac:task-list':
          items.push({ node: { type: 'taskList', content: childEls(n, 'ac:task').map((t) => ({
            type: 'taskItem',
            attrs: { checked: textOf(childEl(t, 'ac:task-status') ?? {}).trim() === 'complete' },
            content: ensureBlocks(blocks(childEl(t, 'ac:task-body')?.children)),
          })) } });
          break;
        case 'table': {
          const rows = [];
          const collect = (el) => { for (const c of el.children ?? []) if (isEl(c)) (c.name === 'tr' ? rows.push(c) : collect(c)); };
          collect(n);
          // 폭 속성: 표 전체 폭(px)·레이아웃·colgroup 열 너비 ("469.0px" / "18.68%" 혼재)
          const colwidths = [];
          const collectCols = (el) => { for (const c of el.children ?? []) if (isEl(c)) (c.name === 'col' ? colwidths.push(/width:\s*([\d.]+(?:px|%))/.exec(c.attribs.style ?? '')?.[1]?.replace(/^([\d.]+)px$/, (_, v) => `${Math.round(Number(v))}px`) ?? null) : c.name === 'colgroup' || c.name === 'table' ? collectCols(c) : null); };
          collectCols(n);
          const tableWidth = n.attribs['data-table-width'] ? Math.round(Number(n.attribs['data-table-width'])) || null : null;
          const layout = dec(n.attribs['data-layout'] ?? '') || null;
          const displayMode = n.attribs['data-table-display-mode'] === 'fixed' ? 'fixed' : null;
          const cellsOf = (tr) => (tr.children ?? []).filter((c) => isEl(c) && (c.name === 'td' || c.name === 'th'));
          // 번호가 매겨진 행: Confluence는 맨 앞에 class="numberingColumn" 칸을 실제로 둔다 → 표 속성으로 바꾸고 칸은 뺀다
          const isNum = (c) => /(^|\s)numberingColumn(\s|$)/.test(c?.attribs?.class ?? '');
          const numberedRows = rows.length > 0 && rows.every((tr) => isNum(cellsOf(tr)[0]));
          if (numberedRows && colwidths.length) colwidths.shift();
          const cellAttrs = (cell) => {
            const a = { colspan: Number(cell.attribs.colspan ?? 1), rowspan: Number(cell.attribs.rowspan ?? 1) };
            const bg = (cell.attribs['data-highlight-colour'] ?? '').trim().toLowerCase();
            if (/^#[0-9a-f]{3,8}$/.test(bg) && bg !== '#ffffff' && bg !== '#fff') a.background = bg;
            const va = /vertical-align:\s*(middle|bottom)/.exec(cell.attribs.style ?? '')?.[1] ?? (/^(middle|bottom)$/.test(cell.attribs.valign ?? '') ? cell.attribs.valign : null);
            if (va) a.valign = va;
            return a;
          };
          items.push({ node: { type: 'table',
            attrs: { tableWidth, layout, colwidths: colwidths.some((w) => w) ? colwidths : null,
              ...(numberedRows ? { numberedRows: true } : {}), ...(displayMode ? { displayMode } : {}) },
            content: rows.map((tr) => ({ type: 'tableRow',
            content: cellsOf(tr).slice(numberedRows ? 1 : 0).map((cell) => ({
              type: cell.name === 'th' ? 'tableHeader' : 'tableCell',
              attrs: cellAttrs(cell),
              content: ensureBlocks(blocks(cell.children)),
            })) })) } });
          break;
        }
        case 'blockquote':
          items.push({ node: { type: 'blockquote', content: ensureBlocks(blocks(n.children)) } });
          break;
        case 'pre': {
          const pre = textOf(n);
          items.push({ node: { type: 'codeBlock', attrs: { language: null }, ...(pre ? { content: [{ type: 'text', text: pre }] } : {}) } });
          break;
        }
        case 'hr':
          items.push({ node: { type: 'horizontalRule' } });
          break;
        case 'ac:image':
          items.push({ node: imageNode(n) });
          break;
        case 'ac:layout':
          items.push({ node: { type: 'layout', attrs: { blockWidth: Number(n.attribs['ac:width']) >= 760 ? Number(n.attribs['ac:width']) : null }, content: childEls(n, 'ac:layout-section').map((sec) => ({
            type: 'layoutSection', attrs: { kind: dec(sec.attribs['ac:type'] ?? 'single') },
            content: childEls(sec, 'ac:layout-cell').map((cell) => ({ type: 'layoutColumn', attrs: { width: Number(cell.attribs['ac:width']) || null }, content: ensureBlocks(blocks(cell.children)) })),
          })) } });
          break;
        case 'ac:structured-macro': case 'ac:macro': {
          const node = macroNode(n, false);
          if (node) items.push(['status', 'jiraIssue', 'anchor', 'cfMacroInline'].includes(node.type) ? { __inline: true, node } : { node });
          break;
        }
        case 'div': case 'section': case 'article': case 'center': case 'colgroup': case 'ac:rich-text-body':
          items.push(...blocks(n.children).map((node) => ({ node })));
          break;
        case 'ac:adf-node':
          items.push({ node: adfNode(n) });
          break;
        case 'ac:adf-extension': {
          // 신 편집기 ADF 노드. 대부분 서드파티 Forge 앱 임베드(extension)이고,
          // 내용 손실을 막기 위해 속성 전체와 폴백 본문을 보존한다.
          const adfNodes = childEls(n, 'ac:adf-node').map(adfNode);
          const fallback = childEl(n, 'ac:adf-fallback');
          if (adfNodes.length) items.push(...adfNodes.map((node) => ({ node })));
          else if (fallback) items.push(...blocks(fallback.children).map((node) => ({ node })));
          break;
        }
        default:
          pushInline(n); // 인라인 요소로 처리하고, 모르는 태그는 inline()이 센다
      }
    }
    return wrapLoose(items);
  }

  const dom = parseDocument(xhtml, { xmlMode: true, decodeEntities: false });
  const content = blocks(dom.children);
  return { doc: { type: 'doc', content: content.length ? content : [para([])] }, stats };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node scripts/convert-storage.mjs <storage.xhtml 파일>'); process.exit(1); }
  const { doc, stats } = convertStorage(readFileSync(file, 'utf8'));
  console.log(JSON.stringify({ doc, stats }, null, 2));
}
