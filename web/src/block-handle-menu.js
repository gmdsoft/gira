// 블록 핸들 메뉴 (GIRA-41): 블록 왼쪽 '⠿'를 누르면 뜨는 메뉴 — Confluence처럼
//   형식 변경 › / 선택 항목 링크 복사(Ctrl+Alt+A) / 위로 이동 / 아래로 이동 / 삭제
// '+'는 블록 바로 아래에 빈 문단을 만들고 '/' 메뉴를 연다 (extensions.js BlockHandle에서 호출)
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { decisionBlock } from './slash-menu.js';

const TEXTUAL = new Set(['paragraph', 'heading']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const UNWRAPPABLE = new Set(['panel', 'expand', 'blockquote', 'layout']);

// 블록을 다른 블록으로 감싸거나 풀거나 바꾸는 선택지 (지금 블록 종류에 맞는 것만)
function turnIntoOptions(node) {
  const t = node.type.name;
  const opts = [];
  if (t !== 'panel') opts.push(['panel', '패널']);
  if (t !== 'expand') opts.push(['expand', '펼치기']);
  if (t !== 'layout') opts.push(['layout', '레이아웃']);
  if (TEXTUAL.has(t)) opts.push(['decision', '결정']);
  if (TEXTUAL.has(t) || LISTS.has(t)) {
    if (t !== 'bulletList') opts.push(['bulletList', '글머리 기호 목록']);
    if (t !== 'orderedList') opts.push(['orderedList', '번호 목록']);
  }
  if (TEXTUAL.has(t) || UNWRAPPABLE.has(t) || LISTS.has(t)) opts.push(['paragraph', UNWRAPPABLE.has(t) ? '일반 텍스트(풀기)' : '일반 텍스트']);
  if (TEXTUAL.has(t)) opts.push(['small', '작은 텍스트']);
  return opts;
}

function turnInto(editor, pos, kind) {
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const { schema } = state;
  const end = pos + node.nodeSize;
  const para = () => schema.nodes.paragraph.create();
  const replace = (n) => {
    const tr = state.tr.replaceWith(pos, end, n);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr.scrollIntoView());
  };
  if (kind === 'panel') return replace(schema.nodes.panel.create({ panelType: 'info' }, [node]));
  if (kind === 'expand') return replace(schema.nodes.expand.create({ title: '' }, [node]));
  if (kind === 'layout') {
    const kids = node.type.name === 'layout' ? null : [node];
    return replace(schema.nodes.layout.create(null, [schema.nodes.layoutSection.create({ kind: 'two_equal' }, [
      schema.nodes.layoutColumn.create(null, kids), schema.nodes.layoutColumn.create(null, [para()]),
    ])]));
  }
  if (kind === 'decision') {
    const inline = node.content.toJSON() ?? [];
    return replace(schema.nodeFromJSON(decisionBlock([{ type: 'paragraph', ...(inline.length ? { content: inline } : {}) }])));
  }
  const t = node.type.name;
  if (kind === 'paragraph' && UNWRAPPABLE.has(t)) {
    // 감싼 블록 풀기: 안쪽 블록들을 그 자리에 (레이아웃은 모든 열의 내용을 차례로)
    const blocks = [];
    if (t === 'layout') node.descendants((n) => { if (n.type.name === 'layoutColumn') { n.forEach((b) => blocks.push(b)); return false; } return true; });
    else node.forEach((b) => blocks.push(b));
    const tr = state.tr.replaceWith(pos, end, blocks.length ? blocks : [para()]);
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
    return view.dispatch(tr.scrollIntoView());
  }
  // 글 블록 변환은 편집기 명령으로 (커서를 블록 안에 둔 뒤)
  const inside = editor.chain().focus().setTextSelection({ from: pos + 1, to: Math.max(pos + 1, end - 1) });
  if (kind === 'bulletList') return LISTS.has(t) && t !== 'bulletList' ? inside.toggleBulletList().run() : inside.toggleBulletList().run();
  if (kind === 'orderedList') return inside.toggleOrderedList().run();
  if (kind === 'paragraph') return LISTS.has(t) ? inside.liftListItem(t === 'taskList' ? 'taskItem' : 'listItem').run() : inside.setParagraph().unsetMark('smallText').run();
  if (kind === 'small') return inside.setParagraph().setMark('smallText').run();
}

export function moveBlock(editor, pos, dir) {
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const target = index + dir;
  if (target < 0 || target >= parent.childCount) return false;
  const other = parent.child(target);
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const insertAt = dir < 0 ? pos - other.nodeSize : pos + other.nodeSize;
  tr.insert(insertAt, node);
  tr.setSelection(NodeSelection.create(tr.doc, insertAt));
  view.dispatch(tr.scrollIntoView());
  return true;
}

// 블록 링크: 문서 보기 주소 + 텍스트 조각(#:~:text=) — 열면 그 블록으로 스크롤·강조된다(Chrome·Edge)
export function blockLink(node) {
  const base = `${location.origin}${location.pathname.replace(/\/edit$/, '')}`;
  const text = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
  return text ? `${base}#:~:text=${encodeURIComponent(text).replace(/-/g, '%2D')}` : base;
}
export async function copyBlockLink(node) {
  const url = blockLink(node);
  try { await navigator.clipboard.writeText(url); return true; } catch { /* 권한 없음 */ }
  const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
}

let openMenu = null;
export function closeBlockMenu() { openMenu?.close(); }

export function openBlockMenu(editor, pos, anchor) {
  closeBlockMenu();
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const $pos = editor.state.doc.resolve(pos);
  const index = $pos.index();
  const menu = document.createElement('div');
  menu.className = 'bh-menu';
  menu.setAttribute('role', 'menu');
  menu.style.left = `${Math.round(anchor.left)}px`;
  menu.style.top = `${Math.round(Math.min(anchor.bottom + 4, window.innerHeight - 300))}px`;
  const item = (label, kbd, onPick, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `bh-mi${opts.danger ? ' danger' : ''}`;
    b.setAttribute('role', 'menuitem');
    b.disabled = !!opts.disabled;
    b.innerHTML = '';
    const l = document.createElement('span'); l.className = 'bh-label'; l.textContent = label; b.append(l);
    if (kbd) { const k = document.createElement('kbd'); k.textContent = kbd; b.append(k); }
    if (opts.sub) { const s = document.createElement('span'); s.className = 'bh-sub'; s.textContent = '›'; b.append(s); }
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(b); });
    menu.append(b);
    return b;
  };
  const sep = () => { const d = document.createElement('div'); d.className = 'bh-sep'; menu.append(d); };
  let sub = null;
  const opts = turnIntoOptions(node);
  item('형식 변경', null, (b) => {
    if (sub) { sub.remove(); sub = null; return; }
    sub = document.createElement('div');
    sub.className = 'bh-menu bh-submenu';
    const r = b.getBoundingClientRect();
    sub.style.left = `${Math.round(r.right + 4)}px`;
    sub.style.top = `${Math.round(r.top - 4)}px`;
    for (const [kind, label] of opts) {
      const s = document.createElement('button');
      s.type = 'button'; s.className = 'bh-mi'; s.textContent = label;
      s.addEventListener('mousedown', (e) => e.preventDefault());
      s.addEventListener('click', () => { close(); turnInto(editor, pos, kind); });
      sub.append(s);
    }
    document.body.append(sub);
  }, { sub: true, disabled: !opts.length });
  item('선택 항목 링크 복사', 'Ctrl+Alt+A', async (b) => {
    const ok = await copyBlockLink(node);
    b.querySelector('.bh-label').textContent = ok ? '링크를 복사했습니다' : '복사할 수 없습니다';
    setTimeout(close, 700);
  });
  sep();
  item('위로 이동', null, () => { close(); moveBlock(editor, pos, -1); }, { disabled: index === 0 });
  item('아래로 이동', null, () => { close(); moveBlock(editor, pos, 1); }, { disabled: index >= $pos.parent.childCount - 1 });
  sep();
  item('삭제', null, () => {
    close();
    const { state, view } = editor;
    const n = state.doc.nodeAt(pos);
    if (n) view.dispatch(state.tr.delete(pos, pos + n.nodeSize).scrollIntoView());
    editor.commands.focus();
  }, { danger: true });
  document.body.append(menu);
  const onDown = (e) => { if (!menu.contains(e.target) && !sub?.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); editor.commands.focus(); } };
  function close() {
    menu.remove(); sub?.remove(); sub = null;
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenu?.menu === menu) openMenu = null;
  }
  setTimeout(() => { document.addEventListener('mousedown', onDown, true); document.addEventListener('keydown', onKey, true); }, 0);
  openMenu = { menu, close };
}
