// 블록별 플로팅 도구 모음 — 패널·코드 블록·레이아웃·펼치기·링크.
// 선택(커서)이 해당 블록 안에 있으면 블록 바로 아래(자리가 없으면 위)에 뜨고,
// 편집 영역 바깥을 누르면 사라진다. 링크 대화상자(Ctrl+K)와 단축키 도움말(Ctrl+/)도 여기서 맡는다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Fragment, DOMSerializer } from '@tiptap/pm/model';
import { codeLanguages } from './code-block.js';
import { internalLink } from './internal-links.js';
import './editor-blocks.css';

const BLOCK_TYPES = new Set(['panel', 'codeBlock', 'layout', 'expand']);

const PANEL_TYPES = [
  ['info', '정보'], ['note', '노트'], ['tip', '팁'], ['success', '성공'],
  ['warning', '경고'], ['error', '오류'], ['custom', '사용자 지정'],
];
const PANEL_EMOJI = ['ℹ️', '📄', '💡', '✅', '⚠️', '❌', '📌', '🚀', '⭐', '🎉', '🔔', '❓'];
// Confluence 패널 배경 팔레트와 가까운 색 (문서 모델에는 값 그대로 저장)
const PANEL_BG = [
  ['', '기본'], ['#F4F5F7', '회색'], ['#FFEBE6', '빨강'], ['#FFFAE6', '노랑'],
  ['#E3FCEF', '초록'], ['#E6FCFF', '하늘'], ['#DEEBFF', '파랑'], ['#EAE6FF', '보라'],
];

function currentBlock(editor) {
  const { state } = editor;
  const sel = state.selection;
  if (sel instanceof NodeSelection && BLOCK_TYPES.has(sel.node.type.name)) {
    return { kind: sel.node.type.name, node: sel.node, pos: sel.from };
  }
  const { $from } = sel;
  for (let d = $from.depth; d >= 1; d -= 1) {
    const node = $from.node(d);
    if (BLOCK_TYPES.has(node.type.name)) return { kind: node.type.name, node, pos: $from.before(d) };
  }
  return null;
}

// 커서가 링크 안에 있거나 링크 카드를 선택했으면 그 링크 정보를 돌려준다.
function currentLink(editor) {
  const { state } = editor;
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'linkCard') {
    return {
      href: sel.node.attrs.href ?? '', text: sel.node.attrs.title || sel.node.attrs.href || '',
      card: true, pos: sel.from, node: sel.node,
    };
  }
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  const { $from } = sel;
  const mark = $from.marks().find((m) => m.type === linkType)
    || $from.nodeAfter?.marks.find((m) => m.type === linkType);
  if (!mark) return null;
  const ranges = [];
  $from.parent.forEach((child, offset) => {
    if (!child.marks.some((m) => m.eq(mark))) return;
    const pos = $from.start() + offset;
    const last = ranges[ranges.length - 1];
    if (last && last.to === pos) last.to += child.nodeSize;
    else ranges.push({ from: pos, to: pos + child.nodeSize });
  });
  const range = ranges.find((r) => r.from <= sel.from && r.to >= sel.to);
  if (!range) return null;
  const { from: start, to: end } = range;
  return { href: mark.attrs.href, text: state.doc.textBetween(start, end), card: false, from: start, to: end };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

async function copyBlock(editor, node) {
  const text = node.textContent;
  try {
    const dom = DOMSerializer.fromSchema(editor.schema).serializeNode(node);
    const holder = document.createElement('div');
    holder.appendChild(dom);
    const html = holder.innerHTML;
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    }
  } catch { /* rich copy 실패 시 텍스트로 */ }
  return copyText(text);
}

function updateAttrs(editor, pos, attrs) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs }));
  editor.view.focus();
}

function deleteBlock(editor, block) {
  editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + block.node.nodeSize).scrollIntoView());
  editor.view.focus();
}

// 레이아웃 열 개수 바꾸기 — 기존 내용은 버리지 않는다.
// 줄일 때는 남은 마지막 열 뒤에 잘라낸 열들의 블록을 이어 붙이고, 늘릴 때는 빈 열을 추가한다.
function setLayoutColumns(editor, block, count) {
  const layout = editor.state.doc.nodeAt(block.pos);
  const section = layout?.firstChild;
  if (!section) return;
  const schema = editor.schema;
  const old = [];
  section.forEach((col) => old.push(col));
  const cols = old.slice(0, count);
  if (cols.length < count) {
    while (cols.length < count) cols.push(schema.nodes.layoutColumn.create(null, [schema.nodes.paragraph.create()]));
  }
  if (old.length > count) {
    const content = [];
    cols[count - 1].forEach((child) => content.push(child));
    old.slice(count).forEach((col) => col.forEach((child) => content.push(child)));
    cols[count - 1] = schema.nodes.layoutColumn.create(null, content.length ? content : [schema.nodes.paragraph.create()]);
  }
  const kind = count === 1 ? 'single' : `${['', 'single', 'two', 'three', 'four', 'five'][count]}_equal`;
  const next = section.type.create({ ...section.attrs, kind }, cols);
  const sectionPos = block.pos + 1;
  const tr = editor.state.tr.replaceWith(sectionPos, sectionPos + section.nodeSize, next);
  tr.setSelection(TextSelection.near(tr.doc.resolve(sectionPos + 2)));
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

function setLayoutKind(editor, block, kind) {
  const section = editor.state.doc.nodeAt(block.pos)?.firstChild;
  if (!section) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(block.pos + 1, null, { ...section.attrs, kind }));
  editor.view.focus();
}

function layoutKindFor(count, preset) {
  if (count === 1) return 'single';
  return `${['', 'single', 'two', 'three', 'four', 'five'][count]}_${preset}`;
}

function layoutPreset(kind) {
  if (kind === 'legacy') return 'equal';
  if (kind?.endsWith('_left_sidebar')) return 'left_sidebar';
  if (kind?.endsWith('_right_sidebar')) return 'right_sidebar';
  return 'equal';
}

function replaceRangeWith(editor, from, to, node) {
  const tr = editor.state.tr.replaceWith(from, to, node);
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

function paragraphWith(editor, content) {
  return editor.schema.nodes.paragraph.create(null, content);
}

// 문단 안의 인라인 링크를 블록 카드로 바꾼다. 카드는 문단 자식이 될 수 없으므로
// 링크만 있는 문단이면 문단째 카드로, 아니면 링크 글자만 지우고 문단 뒤에 카드를 넣는다.
function inlineToCard(editor, link, card) {
  const { state } = editor;
  const $pos = state.doc.resolve(link.from);
  const depth = $pos.depth;
  const para = $pos.node(depth);
  if (!para.isTextblock) {
    replaceRangeWith(editor, link.from, link.to, card);
    return;
  }
  const paraPos = $pos.before(depth);
  const paraEnd = paraPos + para.nodeSize;
  const before = state.doc.textBetween(paraPos + 1, link.from).trim();
  const after = state.doc.textBetween(link.to, paraEnd - 1).trim();
  if (!before && !after) {
    replaceRangeWith(editor, paraPos, paraEnd, card);
    return;
  }
  const tr = state.tr.delete(link.from, link.to);
  tr.insert(tr.mapping.map(paraEnd), card).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

function formatUrl(editor, link) {
  if (link.card) {
    formatInline(editor, { ...link, text: link.href });
    return;
  }
  const mark = editor.schema.marks.link.create({ href: link.href });
  replaceRangeWith(editor, link.from, link.to, editor.schema.text(link.href, [mark]));
}

function formatInline(editor, link) {
  if (!link.card) return;
  const mark = editor.schema.marks.link.create({ href: link.href });
  const para = paragraphWith(editor, editor.schema.text(link.text || link.href, [mark]));
  replaceRangeWith(editor, link.pos, link.pos + link.node.nodeSize, para);
}

function formatCard(editor, link) {
  if (link.card) return;
  const inner = internalLink(link.href, window.location.href);
  const card = editor.schema.nodes.linkCard.create({
    href: link.href, kind: inner?.kind || 'url', title: link.text || link.href, status: '',
  });
  inlineToCard(editor, link, card);
}

function unlink(editor, link) {
  if (link.card) {
    const node = link.node ?? editor.state.doc.nodeAt(link.pos);
    if (!node) return;
    const para = paragraphWith(editor, editor.schema.text(link.text || link.href));
    replaceRangeWith(editor, link.pos, link.pos + node.nodeSize, para);
    return;
  }
  const tr = editor.state.tr.removeMark(link.from, link.to, editor.schema.marks.link);
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

function applyLink(editor, draft, href, display) {
  const { state } = editor;
  const linkType = state.schema.marks.link;
  const h = href.trim();
  const t = display.trim();
  const size = state.doc.content.size;
  const safeFrom = Math.min(draft.from ?? 0, size);
  const safeTo = Math.min(draft.to ?? safeFrom, size);

  if (!h) { // 주소를 비우면 링크 해제
    if (draft.card) unlink(editor, draft);
    else if (draft.card === false) {
      const tr = state.tr.removeMark(safeFrom, safeTo, linkType);
      tr.scrollIntoView();
      editor.view.dispatch(tr);
      editor.view.focus();
    }
    return;
  }
  const mark = linkType.create({ href: h });
  if (draft.card) {
    const node = state.doc.nodeAt(draft.pos);
    if (!node) return;
    const para = paragraphWith(editor, state.schema.text(t || node.attrs.title || h, [mark]));
    replaceRangeWith(editor, draft.pos, draft.pos + node.nodeSize, para);
    return;
  }
  const current = safeTo > safeFrom ? state.doc.textBetween(safeFrom, safeTo) : '';
  if (safeTo > safeFrom && (!t || t === current)) {
    // 표시 텍스트를 바꾸지 않으면 기존 서식(굵게 등)을 유지한 채 주소만 바꾼다
    const tr = state.tr.removeMark(safeFrom, safeTo, linkType).addMark(safeFrom, safeTo, mark).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.focus();
    return;
  }
  const textNode = state.schema.text(t || current || h, [mark]);
  if (safeTo > safeFrom) replaceRangeWith(editor, safeFrom, safeTo, textNode);
  else {
    const tr = state.tr.replaceSelectionWith(textNode, false).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.focus();
  }
}

function makeLinkDraft(editor) {
  if (!editor || editor.isDestroyed) return null;
  const link = currentLink(editor);
  if (link) {
    return link.card
      ? { href: link.href, text: link.text, card: true, pos: link.pos }
      : { href: link.href, text: link.text, card: false, from: link.from, to: link.to };
  }
  const sel = editor.state.selection;
  return sel.empty
    ? { href: '', text: '', from: sel.from, to: sel.from }
    : { href: '', text: editor.state.doc.textBetween(sel.from, sel.to), from: sel.from, to: sel.to };
}

// Ctrl+Shift+↑/↓: 커서가 있는 블록을 형제 사이에서 위/아래로 옮긴다.
function moveBlock(editor, dir) {
  const { state } = editor;
  const { $from, empty } = state.selection;
  const selected = state.selection instanceof NodeSelection;
  if (!empty && !selected) return false;
  const block = currentBlock(editor);
  const depth = block ? state.doc.resolve(block.pos).depth + 1 : selected ? $from.depth + 1 : $from.depth;
  if (depth < 1) return false;
  const node = block?.node || (selected ? state.selection.node : $from.node(depth));
  if (!node.isBlock) return false;
  const $pos = state.doc.resolve(block?.pos ?? state.selection.from);
  const parent = $pos.node(depth - 1);
  const index = $pos.index(depth - 1);
  if (dir < 0 && index === 0) return false;
  if (dir > 0 && index >= parent.childCount - 1) return false;
  const pos = block?.pos ?? (selected ? state.selection.from : $from.before(depth));
  const neighbor = parent.child(index + dir);
  const start = dir < 0 ? pos - neighbor.nodeSize : pos;
  const content = Fragment.fromArray(dir < 0 ? [node, neighbor] : [neighbor, node]);
  if (!parent.canReplace(Math.min(index, index + dir), Math.max(index, index + dir) + 1, content)) return false;
  const tr = state.tr.replaceWith(start, start + node.nodeSize + neighbor.nodeSize, content);
  const movedPos = dir < 0 ? start : start + neighbor.nodeSize;
  tr.setSelection(selected ? NodeSelection.create(tr.doc, movedPos)
    : TextSelection.near(tr.doc.resolve(movedPos + 1))).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

function toolbarPlacement(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(620, vw - 16);
  const left = Math.min(Math.max(8, rect.left), vw - width - 8);
  let top = rect.bottom + 6;
  if (top + 56 > vh && rect.top > 80) top = rect.top - 50;
  return { left, top, width };
}

function TBtn({ onClick, active, danger, title, children }) {
  return (
    <button type="button" title={title}
      className={`bt-btn${active ? ' on' : ''}${danger ? ' danger' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}>{children}</button>
  );
}

function PanelTools({ editor, block }) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const attrs = block.node.attrs;
  return (
    <>
      <select className="bt-select" aria-label="패널 유형" value={attrs.panelType || 'info'}
        onChange={(e) => updateAttrs(editor, block.pos, { panelType: e.target.value })}>
        {PANEL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <span className="bt-wrap">
        <TBtn title="패널 이모지" active={!!attrs.panelIcon} onClick={() => setEmojiOpen((v) => !v)}>🙂</TBtn>
        {emojiOpen && (
          <span className="bt-pop bt-emoji">
            <button type="button" className="bt-emoji-clear" title="이모지 없음"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { updateAttrs(editor, block.pos, { panelIcon: null }); setEmojiOpen(false); }}>없음</button>
            {PANEL_EMOJI.map((emoji) => (
              <button key={emoji} type="button" className="bt-emoji-item" title={emoji}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { updateAttrs(editor, block.pos, { panelIcon: emoji }); setEmojiOpen(false); }}>{emoji}</button>
            ))}
          </span>
        )}
      </span>
      <span className="bt-wrap">
        <TBtn title="패널 배경색" active={!!attrs.bgColor} onClick={() => setBgOpen((v) => !v)}>🎨</TBtn>
        {bgOpen && (
          <span className="bt-pop bt-colors">
            {PANEL_BG.map(([color, label]) => (
              <button key={label} type="button" className={`bt-color${color ? '' : ' none'}`}
                style={color ? { background: color } : null} title={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { updateAttrs(editor, block.pos, { bgColor: color || null }); setBgOpen(false); }} />
            ))}
          </span>
        )}
      </span>
      <span className="bt-sep" />
      <TBtn title="패널 복사" onClick={() => copyBlock(editor, block.node)}>복사</TBtn>
      <TBtn title="패널 삭제" danger onClick={() => deleteBlock(editor, block)}>삭제</TBtn>
    </>
  );
}

function CodeTools({ editor, block }) {
  const attrs = block.node.attrs;
  return (
    <>
      <select className="bt-select" aria-label="코드 언어" value={attrs.language || ''}
        onChange={(e) => updateAttrs(editor, block.pos, { language: e.target.value || null })}>
        <option value="">자동 감지</option>
        {codeLanguages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <TBtn title="줄 바꿈" active={!!attrs.wrap}
        onClick={() => updateAttrs(editor, block.pos, { wrap: !attrs.wrap })}>줄 바꿈</TBtn>
      <TBtn title="줄 번호 표시" active={!!attrs.lineNumbers}
        onClick={() => updateAttrs(editor, block.pos, { lineNumbers: !attrs.lineNumbers })}>줄 번호</TBtn>
      <TBtn title="보기 화면에서 접어 두기" active={!!attrs.collapsed}
        onClick={() => updateAttrs(editor, block.pos, { collapsed: !attrs.collapsed })}>접기</TBtn>
      <span className="bt-sep" />
      <TBtn title="코드 복사" onClick={() => copyText(block.node.textContent)}>코드 복사</TBtn>
      <TBtn title="코드 블록 삭제" danger onClick={() => deleteBlock(editor, block)}>삭제</TBtn>
    </>
  );
}

function LayoutTools({ editor, block }) {
  const section = block.node.firstChild;
  const count = section?.childCount || 1;
  const kind = section?.attrs.kind || 'single';
  const preset = layoutPreset(kind);
  return (
    <>
      <span className="bt-label">열</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <TBtn key={n} title={`${n}열`} active={count === n}
          onClick={() => setLayoutColumns(editor, block, n)}>{n}</TBtn>
      ))}
      <span className="bt-sep" />
      <TBtn title="열 균등 맞춤" active={preset === 'equal'}
        onClick={() => setLayoutKind(editor, block, layoutKindFor(count, 'equal'))}>열 균등</TBtn>
      <select className="bt-select" aria-label="레이아웃 배치" value={preset} disabled={count < 2}
        onChange={(e) => setLayoutKind(editor, block, layoutKindFor(count, e.target.value))}>
        <option value="equal">균등</option>
        <option value="left_sidebar">왼쪽 사이드바</option>
        <option value="right_sidebar">오른쪽 사이드바</option>
      </select>
      <TBtn title="레이아웃 삭제" danger onClick={() => deleteBlock(editor, block)}>삭제</TBtn>
    </>
  );
}

function ExpandTools({ editor, block }) {
  return (
    <>
      <TBtn title="펼치기 복사" onClick={() => copyBlock(editor, block.node)}>복사</TBtn>
      <TBtn title="펼치기 삭제" danger onClick={() => deleteBlock(editor, block)}>삭제</TBtn>
    </>
  );
}

function LinkTools({ editor, link, onEdit }) {
  const inline = !link.card;
  return (
    <>
      <span className="bt-label">표시</span>
      <TBtn title="주소 전체를 표시" active={inline && link.text === link.href}
        onClick={() => formatUrl(editor, link)}>URL</TBtn>
      <TBtn title="링크 텍스트로 표시" active={inline && link.text !== link.href}
        onClick={() => formatInline(editor, link)}>인라인</TBtn>
      <TBtn title="문서 카드로 표시" active={link.card}
        onClick={() => formatCard(editor, link)}>카드</TBtn>
      <span className="bt-sep" />
      <TBtn title="링크 편집 (Ctrl+K)" onClick={onEdit}>편집</TBtn>
      <TBtn title="링크 해제" onClick={() => unlink(editor, link)}>링크 해제</TBtn>
      <TBtn title="링크 주소 복사" onClick={() => copyText(link.href)}>복사</TBtn>
    </>
  );
}

const SHORTCUTS = [
  ['Ctrl/Cmd + K', '링크 넣기·편집'],
  ['Ctrl/Cmd + /', '단축키 도움말'],
  ['Ctrl/Cmd + Shift + ↑/↓', '블록 위/아래로 이동'],
  ['Ctrl/Cmd + S · Ctrl + Enter', '게시(업데이트)'],
  ['Ctrl/Cmd + B · I · U', '굵게 · 기울임 · 밑줄'],
  ['Ctrl/Cmd + Shift + S', '취소선'],
  ['Ctrl/Cmd + Shift + M', '인라인 코드'],
  ['Ctrl/Cmd + Shift + 8 · 7 · 9', '글머리 · 번호 목록 · 인용'],
  ['/ (입력 중)', '블록 삽입 메뉴'],
];

function LinkDialog({ editor, draft, onClose }) {
  const [href, setHref] = useState(draft.href || '');
  const [text, setText] = useState(draft.text || '');
  const recent = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('gonf.recent') ?? '[]').slice(0, 8); } catch { return []; }
  }, []);
  const apply = (e) => {
    e.preventDefault();
    applyLink(editor, draft, href, text);
    onClose();
  };
  return (
    <div className="link-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="link-dialog" onSubmit={apply} role="dialog" aria-label="링크">
        <h3>링크</h3>
        <label className="link-field">주소
          <input autoFocus value={href} placeholder="https://… 또는 /s/스페이스/p/문서ID"
            onChange={(e) => setHref(e.target.value)} />
        </label>
        <label className="link-field">표시 텍스트
          <input value={text} placeholder="비우면 주소를 표시"
            onChange={(e) => setText(e.target.value)} />
        </label>
        {recent.length > 0 && (
          <div className="link-recent">
            <div className="link-recent-title">최근 문서</div>
            {recent.map((r) => (
              <button key={`${r.spaceKey}-${r.id}`} type="button" className="link-recent-item"
                onClick={() => { setHref(`/s/${r.spaceKey}/p/${r.id}`); setText(r.title || ''); }}>
                <span>{r.title || `문서 ${r.id}`}</span>
                <span className="muted">{r.spaceKey}</span>
              </button>
            ))}
          </div>
        )}
        <div className="link-dialog-actions">
          {draft.href && (
            <button type="button" className="btn"
              onClick={() => { applyLink(editor, draft, '', ''); onClose(); }}>링크 해제</button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn btn-primary">적용</button>
        </div>
      </form>
    </div>
  );
}

function ShortcutHelp({ onClose }) {
  return (
    <div className="shortcut-help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shortcut-help" role="dialog" aria-label="단축키 도움말">
        <div className="shortcut-help-head">
          <h3>단축키</h3>
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
        <table>
          <tbody>
            {SHORTCUTS.map(([keys, desc]) => (
              <tr key={keys}>
                <td><kbd>{keys}</kbd></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BlockTools({ editor }) {
  const [bar, setBar] = useState(null);
  const dismissed = useRef(false);
  const [linkDraft, setLinkDraft] = useState(null);
  const [help, setHelp] = useState(false);

  const update = useCallback(() => {
    if (!editor || editor.isDestroyed || dismissed.current) return;
    const link = currentLink(editor);
    if (link) {
      let rect;
      if (link.card) {
        const dom = editor.view.nodeDOM(link.pos);
        rect = dom?.getBoundingClientRect?.();
      } else {
        const c = editor.view.coordsAtPos(link.from);
        rect = { left: c.left, top: c.top, bottom: c.bottom };
      }
      if (rect) { setBar({ type: 'link', link, ...toolbarPlacement(rect) }); return; }
    }
    const block = currentBlock(editor);
    if (!block) { setBar(null); return; }
    const dom = editor.view.nodeDOM(block.pos);
    const rect = dom?.getBoundingClientRect?.();
    if (!rect) { setBar(null); return; }
    setBar({ type: 'block', block, ...toolbarPlacement(rect) });
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const onSelection = () => { dismissed.current = false; update(); };
    editor.on('selectionUpdate', onSelection);
    editor.on('update', update);
    editor.on('focus', onSelection);
    const onScroll = () => update();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const onDown = (e) => {
      if (e.target.closest?.('.block-toolbar, .link-dialog-backdrop, .shortcut-help-backdrop')) return;
      if (editor.view.dom.contains(e.target)) {
        dismissed.current = false;
        return;
      }
      dismissed.current = true;
      setBar(null);
    };
    document.addEventListener('mousedown', onDown, true);
    const onClick = (e) => {
      const anchor = e.target.closest?.('a');
      if (!anchor || !editor.view.dom.contains(anchor)) return;
      e.preventDefault();
      const pos = editor.view.posAtDOM(anchor, 0);
      const $pos = editor.state.doc.resolve(pos);
      const cardPos = editor.state.doc.nodeAt(pos)?.type.name === 'linkCard' ? pos
        : $pos.nodeAfter?.type.name === 'linkCard' ? $pos.pos : null;
      if (cardPos != null) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, cardPos)));
      dismissed.current = false;
      update();
    };
    editor.view.dom.addEventListener('click', onClick);
    update();
    return () => {
      editor.view.dom.removeEventListener('click', onClick);
      editor.off('selectionUpdate', onSelection);
      editor.off('update', update);
      editor.off('focus', onSelection);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [editor, update]);

  useEffect(() => {
    if (!editor) return undefined;
    const openLink = () => setLinkDraft(makeLinkDraft(editor));
    window.addEventListener('gonf:link-dialog', openLink);
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        const el = e.target;
        if (el?.closest?.('input, textarea, select') && !editor.view.dom.contains(el)) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setLinkDraft(makeLinkDraft(editor));
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        e.stopPropagation();
        setHelp((v) => !v);
        return;
      }
      if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!editor.view.hasFocus()) return;
        if (moveBlock(editor, e.key === 'ArrowUp' ? -1 : 1)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === 'Escape') {
        dismissed.current = true;
        setBar(null);
        setLinkDraft(null);
        setHelp(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('gonf:link-dialog', openLink);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [editor]);

  if (!editor) return null;
  return (
    <>
      {bar && (
        <div className="block-toolbar" role="toolbar" aria-label="블록 도구 모음"
          style={{ left: bar.left, top: bar.top, maxWidth: bar.width }}>
          {bar.type === 'link' ? (
            <LinkTools editor={editor} link={bar.link} onEdit={() => setLinkDraft(makeLinkDraft(editor))} />
          ) : (
            <span key={`${bar.block.kind}-${bar.block.pos}`} className="bt-group">
              {bar.block.kind === 'panel' && <PanelTools editor={editor} block={bar.block} />}
              {bar.block.kind === 'codeBlock' && <CodeTools editor={editor} block={bar.block} />}
              {bar.block.kind === 'layout' && <LayoutTools editor={editor} block={bar.block} />}
              {bar.block.kind === 'expand' && <ExpandTools editor={editor} block={bar.block} />}
            </span>
          )}
        </div>
      )}
      {linkDraft && <LinkDialog key={`${linkDraft.from ?? linkDraft.pos}-${linkDraft.href}`}
        editor={editor} draft={linkDraft} onClose={() => setLinkDraft(null)} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </>
  );
}
