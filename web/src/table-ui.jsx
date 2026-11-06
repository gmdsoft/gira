// 표 편집 UI (GIRA-31): Confluence처럼
//  - 셀에 커서가 있으면 표 아래 가운데에 '표 도구 모음' (표 옵션 · 정렬 · 열 균등 맞춤 · 콘텐츠에 맞춤 · ⋯)
//  - 커서가 있는 셀 오른쪽 위 '∨' 셀 옵션 (Shift+F10): 배경색 › · 정렬 › · 셀 병합/나누기 · 행/열 추가 · 셀 지우기 · 행/열 삭제
//  - (GIRA-32) 행 왼쪽·열 위쪽 핸들 → 행/열 전체 선택 + 메뉴(추가·이동·정렬·배경색·삭제), 경계의 '+' 삽입 점
// 문서 모델: 셀 background·valign, 표 numberedRows·displayMode·layout (extensions.js)
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CellSelection, TableMap, isInTable, selectedRect, selectionCell, moveTableRow, moveTableColumn } from 'prosemirror-tables';
import { Fragment } from '@tiptap/pm/model';
import { commitColWidths, previewColWidths } from './extensions.js';

// 셀·패널 배경 팔레트 30색 (연한 / 기본 / 진한 × 10색 계열). 첫 칸 흰색 = 기본(칠하지 않음)
export const CELL_COLORS = [
  ['흰색(기본)', null], ['연한 파란색', '#deebff'], ['연한 청록색', '#e6fcff'], ['연한 녹색', '#e3fcef'], ['연한 라임색', '#efffd6'],
  ['연한 노란색', '#fffae6'], ['연한 주황색', '#fff4e5'], ['연한 빨간색', '#ffebe6'], ['연한 자홍색', '#ffecf8'], ['연한 보라색', '#eae6ff'],
  ['회색', '#f4f5f7'], ['파란색', '#b3d4ff'], ['청록색', '#b3f5ff'], ['녹색', '#abf5d1'], ['라임색', '#d3f1a7'],
  ['노란색', '#fff0b3'], ['주황색', '#fedec8'], ['빨간색', '#ffbdad'], ['자홍색', '#fdd0ec'], ['보라색', '#c0b6f2'],
  ['진한 회색', '#c1c7d0'], ['진한 파란색', '#4c9aff'], ['진한 청록색', '#79e2f2'], ['진한 녹색', '#57d9a3'], ['진한 라임색', '#94c748'],
  ['진한 노란색', '#ffe380'], ['진한 주황색', '#fea362'], ['진한 빨간색', '#ff8f73'], ['진한 자홍색', '#e774bb'], ['진한 보라색', '#998dd9'],
];
const MIN_COL = 48;
const COLUMN_WIDTH = 760;

// 지금 선택이 들어 있는 표 정보 (없으면 null)
function tableInfo(editor) {
  const { state, view } = editor;
  if (!isInTable(state)) return null;
  let rect;
  try { rect = selectedRect(state); } catch { return null; }
  const tablePos = rect.tableStart - 1;
  const wrap = view.nodeDOM(tablePos);
  const $cell = state.selection instanceof CellSelection ? state.selection.$headCell : selectionCell(state);
  const cellDom = $cell ? view.nodeDOM($cell.pos) : null;
  if (!(wrap instanceof HTMLElement)) return null;
  return { rect, tablePos, table: rect.table, wrap, cellDom: cellDom instanceof HTMLElement ? cellDom : null };
}

// 지금 화면의 열 너비(px) — 열마다 그 열 하나만 차지하는 셀의 실제 폭
function currentColWidths(view, rect) {
  const { map, tableStart } = rect;
  const out = [];
  for (let c = 0; c < map.width; c += 1) {
    let w = null;
    for (let r = 0; r < map.height && w == null; r += 1) {
      const pos = map.map[r * map.width + c];
      const cr = map.findCell(pos);
      if (cr.right - cr.left !== 1) continue;
      const dom = view.nodeDOM(tableStart + pos);
      if (dom instanceof HTMLElement) w = dom.getBoundingClientRect().width;
    }
    out.push(w);
  }
  const known = out.filter((w) => w);
  const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : COLUMN_WIDTH / map.width;
  return out.map((w) => Math.max(MIN_COL, Math.round(w ?? fill)));
}

// 열 너비(px 배열)를 셀 colwidth에 기록
function setColWidths(tr, rect, widths) {
  const { map, table, tableStart } = rect;
  const seen = new Set();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const node = table.nodeAt(pos);
    const cr = map.findCell(pos);
    tr.setNodeMarkup(tableStart + pos, null, { ...node.attrs, colwidth: widths.slice(cr.left, cr.right).map((w) => Math.round(w)) });
  }
  return tr;
}

// 내용에 맞는 열 너비: 표를 복제해 자동 배치(table-layout:auto, 최대 본문 폭)로 재 본다
function contentWidths(view, rect, wrap) {
  const tableEl = wrap.querySelector('table');
  if (!tableEl) return null;
  const host = document.createElement('div');
  host.className = 'doc';
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${COLUMN_WIDTH}px;visibility:hidden;`;
  const clone = tableEl.cloneNode(true);
  clone.querySelector('colgroup')?.remove();
  clone.style.cssText = `width:auto;table-layout:auto;max-width:${COLUMN_WIDTH}px;`;
  clone.querySelectorAll('td,th').forEach((c) => { c.style.width = ''; c.style.minWidth = ''; });
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const { map } = rect;
    const widths = new Array(map.width).fill(MIN_COL);
    for (let r = 0; r < map.height; r += 1) {
      const domRow = clone.rows[r];
      if (!domRow) continue;
      // 이 행에서 시작하는 셀들(문서 순서 = DOM 순서)
      const starts = [];
      const seen = new Set();
      for (let c = 0; c < map.width; c += 1) {
        const pos = map.map[r * map.width + c];
        if (seen.has(pos)) continue;
        seen.add(pos);
        const cr = map.findCell(pos);
        if (cr.top === r) starts.push(cr);
      }
      starts.forEach((cr, i) => {
        const cell = domRow.cells[i];
        if (cell && cr.right - cr.left === 1) widths[cr.left] = Math.max(widths[cr.left], Math.ceil(cell.getBoundingClientRect().width));
      });
    }
    return widths;
  } finally { host.remove(); }
}

const firstRowHeader = (table) => {
  const row = table.firstChild;
  if (!row) return false;
  let all = true;
  row.forEach((c) => { if (c.type.name !== 'tableHeader') all = false; });
  return all;
};
const firstColHeader = (table) => {
  let all = true;
  table.forEach((row) => { if (row.firstChild?.type.name !== 'tableHeader') all = false; });
  return all;
};

// ---- GIRA-32: 행·열 조작 도우미 (단축키에서도 쓰므로 editor만 받는다) ----
// 표의 셀들(행 → 셀 두 단계만 본다. descendants에서 false를 돌려주면 셀까지 내려가지 않으므로 직접 돈다)
const eachCell = (table, fn) => table.forEach((row) => row.forEach((cell) => fn(cell)));
const hasColwidths = (table) => {
  let any = false;
  eachCell(table, (c) => { if (c.attrs?.colwidth?.some((w) => w)) any = true; });
  return any;
};
// 열 index 앞에 새 열을 넣는다(0 = 맨 왼쪽, width = 맨 오른쪽). 열 너비가 기록된 표는 전체 폭을 유지하고 다시 나눈다
export function insertColumnAt(editor, index) {
  const { state, view } = editor;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const { map, tableStart, table } = rect;
  const keep = hasColwidths(table) ? currentColWidths(view, rect) : null;
  const col = Math.min(Math.max(index, 0), map.width);
  const ref = col === 0 ? 0 : col - 1;
  const $cell = state.doc.resolve(tableStart + map.map[ref]);
  let ok = editor.chain().focus().setTextSelection($cell.pos + 2)[col === 0 ? 'addColumnBefore' : 'addColumnAfter']().run();
  if (ok && keep) {
    const total = keep.reduce((a, b) => a + b, 0);
    const n = keep.length + 1;
    const scaled = keep.map((w) => Math.max(MIN_COL, (w * (n - 1)) / n));
    scaled.splice(col, 0, Math.max(MIN_COL, total / n));
    const r2 = selectedRect(editor.state);
    editor.view.dispatch(setColWidths(editor.state.tr, r2, scaled));
  }
  return ok;
}
export function insertRowAt(editor, index) {
  const { state } = editor;
  if (!isInTable(state)) return false;
  const { map, tableStart } = selectedRect(state);
  const row = Math.min(Math.max(index, 0), map.height);
  const ref = row === 0 ? 0 : row - 1;
  const $cell = state.doc.resolve(tableStart + map.map[ref * map.width]);
  return editor.chain().focus().setTextSelection($cell.pos + 2)[row === 0 ? 'addRowBefore' : 'addRowAfter']().run();
}
// 지금 선택 기준 행/열 번호
function currentIndex(state) {
  const r = selectedRect(state);
  return { row: r.top, col: r.left, rect: r };
}
export function moveRow(editor, delta) {
  const { state, view } = editor;
  if (!isInTable(state)) return false;
  const { row, rect } = currentIndex(state);
  const to = row + delta;
  if (to < 0 || to >= rect.map.height) return false;
  return moveTableRow({ from: row, to, select: true })(state, view.dispatch);
}
export function moveColumn(editor, delta) {
  const { state, view } = editor;
  if (!isInTable(state)) return false;
  const { col, rect } = currentIndex(state);
  const to = col + delta;
  if (to < 0 || to >= rect.map.width) return false;
  return moveTableColumn({ from: col, to, select: true })(state, view.dispatch);
}
// 열 정렬: 헤더 행은 그대로 두고 본문 행을 그 열의 글자 기준으로(숫자는 숫자 순). 병합된 셀이 있으면 하지 않는다
function sortByColumn(editor, col, dir) {
  const { state, view } = editor;
  const rect = selectedRect(state);
  const { table, tableStart } = rect;
  let merged = false;
  eachCell(table, (n) => { if ((n.attrs?.colspan ?? 1) > 1 || (n.attrs?.rowspan ?? 1) > 1) merged = true; });
  if (merged) { alert('병합된 셀이 있는 표는 정렬할 수 없습니다.'); return false; }
  const rows = [];
  table.forEach((r) => rows.push(r));
  const isHeaderRow = (r) => { let all = true; r.forEach((c) => { if (c.type.name !== 'tableHeader') all = false; }); return all; };
  const head = rows.length && isHeaderRow(rows[0]) ? [rows[0]] : [];
  const body = rows.slice(head.length);
  const coll = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const key = (r) => (r.childCount > col ? r.child(col).textContent.trim() : '');
  body.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    if (!ka && kb) return 1; if (ka && !kb) return -1; // 빈 칸은 항상 아래로
    return dir * coll.compare(ka, kb);
  });
  const next = table.copy(Fragment.from([...head, ...body]));
  const tr = state.tr.replaceWith(tableStart - 1, tableStart - 1 + table.nodeSize, next);
  // 표를 통째로 바꾸면 선택이 표 밖으로 나가므로, 정렬한 열을 다시 선택해 둔다
  const m = TableMap.get(next);
  const $a = tr.doc.resolve(tableStart + m.map[col]);
  const $b = tr.doc.resolve(tableStart + m.map[(m.height - 1) * m.width + col]);
  tr.setSelection(CellSelection.colSelection($a, $b));
  view.dispatch(tr);
  return true;
}

function MenuItem({ children, kbd, onPick, check, disabled, sub, danger }) {
  return (
    <button type="button" role="menuitem" className={`tbl-mi${danger ? ' danger' : ''}`} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
      {check !== undefined && <span className={`tbl-check${check ? ' on' : ''}`} aria-hidden>{check ? '✓' : ''}</span>}
      <span className="tbl-mi-label">{children}</span>
      {kbd && <kbd>{kbd}</kbd>}
      {sub && <span className="tbl-sub" aria-hidden>›</span>}
    </button>
  );
}

function Palette({ current, onPick }) {
  return (
    <div className="tbl-palette" role="menu" aria-label="배경색">
      {CELL_COLORS.map(([name, c]) => (
        <button type="button" key={name} title={name} aria-label={name}
          className={`tbl-swatch${(current ?? null) === c ? ' on' : ''}${c ? '' : ' none'}`}
          style={c ? { background: c } : undefined}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

export function TableMenus({ editor }) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(null); // 'opts' | 'align' | 'more' | 'cell'
  const [sub, setSub] = useState(null); // 셀 메뉴 하위: 'bg' | 'valign'
  const [lineIdx, setLineIdx] = useState(null); // 행/열 메뉴 대상 번호
  const rootRef = useRef(null);
  const raf = useRef(0);
  const rerender = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setTick((t) => t + 1));
  }, []);

  useEffect(() => {
    if (!editor) return undefined;
    const onTx = () => rerender();
    editor.on('transaction', onTx);
    editor.on('selectionUpdate', onTx);
    editor.on('blur', onTx);
    window.addEventListener('scroll', rerender, true);
    window.addEventListener('resize', rerender);
    const onCellMenu = () => { setOpen('cell'); setSub(null); };
    window.addEventListener('gonf-cell-menu', onCellMenu);
    // 단축키(extensions.js TableShortcuts)가 보내는 행·열 이동
    const onCmd = (e) => {
      const d = e.detail;
      if (d === 'rowUp') moveRow(editor, -1); else if (d === 'rowDown') moveRow(editor, 1);
      else if (d === 'colLeft') moveColumn(editor, -1); else if (d === 'colRight') moveColumn(editor, 1);
      else if (d === 'colBefore') { const { col } = currentIndex(editor.state); insertColumnAt(editor, col); }
      else if (d === 'colAfter') { const r = selectedRect(editor.state); insertColumnAt(editor, r.right); }
    };
    window.addEventListener('gonf-table-cmd', onCmd);
    return () => {
      editor.off('transaction', onTx); editor.off('selectionUpdate', onTx); editor.off('blur', onTx);
      window.removeEventListener('scroll', rerender, true);
      window.removeEventListener('resize', rerender);
      window.removeEventListener('gonf-cell-menu', onCellMenu);
      window.removeEventListener('gonf-table-cmd', onCmd);
      cancelAnimationFrame(raf.current);
    };
  }, [editor, rerender]);

  // 바깥 클릭·Esc로 메뉴 닫기
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!rootRef.current?.contains(e.target)) { setOpen(null); setSub(null); } };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(null); setSub(null); editor?.commands.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open, editor]);

  const info = editor && !editor.isDestroyed && editor.isEditable ? tableInfo(editor) : null;
  // 표 밖으로 나가면 메뉴도 닫는다
  useLayoutEffect(() => { if (!info && open) { setOpen(null); setSub(null); } });
  if (!info) return null;

  const { rect, tablePos, table, wrap, cellDom } = info;
  const view = editor.view;
  const sel = editor.state.selection;
  const multi = sel instanceof CellSelection && (sel.$anchorCell.pos !== sel.$headCell.pos);
  const close = () => { setOpen(null); setSub(null); };
  const chainRun = (fn) => { fn(editor.chain().focus()).run(); close(); };
  const setTableAttrs = (patch) => {
    const tr = editor.state.tr.setNodeMarkup(tablePos, null, { ...table.attrs, ...patch });
    view.dispatch(tr); editor.commands.focus(); close();
  };
  const toggle = (k) => setOpen((o) => (o === k ? null : k));

  // 열 균등 맞춤: 전체 또는 선택한 열들의 합을 같은 폭으로 나눈다
  const equalize = (onlySelected) => {
    const r = selectedRect(editor.state);
    const widths = currentColWidths(view, r);
    const [from, to] = onlySelected ? [r.left, r.right] : [0, r.map.width];
    const total = widths.slice(from, to).reduce((a, b) => a + b, 0);
    const each = Math.max(MIN_COL, Math.floor(total / (to - from)));
    for (let c = from; c < to; c += 1) widths[c] = each;
    view.dispatch(setColWidths(editor.state.tr, r, widths));
    editor.commands.focus(); close();
  };
  const fitContent = () => {
    const r = selectedRect(editor.state);
    const widths = contentWidths(view, r, wrap);
    if (widths) view.dispatch(setColWidths(editor.state.tr, r, widths));
    editor.commands.focus(); close();
  };
  const toggleFixed = () => {
    const fixed = table.attrs.displayMode === 'fixed';
    let tr = editor.state.tr;
    // 고정하려는데 열 너비가 기록돼 있지 않으면 지금 보이는 폭을 기록해 둔다
    if (!fixed) {
      const r = selectedRect(editor.state);
      if (!hasColwidths(r.table)) tr = setColWidths(tr, r, currentColWidths(view, r));
    }
    tr.setNodeMarkup(tablePos, null, { ...table.attrs, displayMode: fixed ? null : 'fixed' });
    view.dispatch(tr); editor.commands.focus(); close();
  };
  const copyTable = () => {
    const back = editor.state.selection;
    editor.commands.setNodeSelection(tablePos);
    try { document.execCommand('copy'); } catch { /* 클립보드 권한 없음 */ }
    view.dispatch(editor.state.tr.setSelection(back.map(editor.state.doc, editor.state.tr.mapping)));
    editor.commands.focus(); close();
  };
  // 셀 지우기: 선택한 셀(들)의 내용만 비운다
  const clearCells = () => {
    const { state } = editor;
    const cells = [];
    if (state.selection instanceof CellSelection) state.selection.forEachCell((node, pos) => cells.push([node, pos]));
    else { const $c = selectionCell(state); if ($c?.nodeAfter) cells.push([$c.nodeAfter, $c.pos]); }
    const tr = state.tr;
    const para = state.schema.nodes.paragraph;
    cells.sort((a, b) => b[1] - a[1]).forEach(([node, pos]) => tr.replaceWith(pos + 1, pos + node.nodeSize - 1, para.create()));
    view.dispatch(tr); editor.commands.focus(); close();
  };

  // ---- 위치 계산 ----
  const wr = wrap.getBoundingClientRect();
  const tableEl = wrap.querySelector('table');
  const tr = tableEl ? tableEl.getBoundingClientRect() : wr;
  const visLeft = Math.max(wr.left, 8);
  const visRight = Math.min(wr.right, window.innerWidth - 8);
  const barLeft = (Math.max(tr.left, visLeft) + Math.min(tr.right, visRight)) / 2;
  const barTop = Math.min(wr.bottom + 6, window.innerHeight - 46);
  const showBar = wr.bottom > 110 && wr.top < window.innerHeight - 40;
  const up = barTop > window.innerHeight - 240; // 도구 모음이 창 아래쪽이면 메뉴를 위로 연다
  const cr = cellDom?.getBoundingClientRect();
  const showCellBtn = cr && cr.bottom > 100 && cr.top < window.innerHeight;
  const cellUp = cr && cr.top > window.innerHeight - 380;
  const headerRow = firstRowHeader(table);
  const headerCol = firstColHeader(table);
  const align = table.attrs.layout === 'align-start' ? 'left' : table.attrs.layout === 'center' ? 'center' : null;
  const headCell = sel instanceof CellSelection ? sel.$headCell.nodeAfter : selectionCell(editor.state)?.nodeAfter;
  const canMerge = editor.can().mergeCells();
  const canSplit = editor.can().splitCell();

  // ---- GIRA-32: 행·열 핸들과 삽입 점 위치 ----
  const { map, tableStart } = rect;
  const domRows = tableEl ? [...tableEl.rows] : [];
  const rowBox = domRows.map((r) => r.getBoundingClientRect());
  const xs = [];
  for (let c = 0; c < map.width; c += 1) {
    let x = null;
    for (let r = 0; r < map.height && x == null; r += 1) {
      const pos = map.map[r * map.width + c];
      if (map.findCell(pos).left !== c) continue;
      const dom = view.nodeDOM(tableStart + pos);
      if (dom instanceof HTMLElement) x = dom.getBoundingClientRect().left;
    }
    xs.push(x ?? (xs.length ? xs[xs.length - 1] : tr.left));
  }
  xs.push(tr.right);
  const gutterL = tr.left - (table.attrs.numberedRows ? 42 : 0);
  const showHandles = wr.bottom > 120 && wr.top < window.innerHeight - 20 && !!tableEl;
  const selRow = (r) => {
    const $a = editor.state.doc.resolve(tableStart + map.map[r * map.width]);
    const $b = editor.state.doc.resolve(tableStart + map.map[r * map.width + map.width - 1]);
    view.dispatch(editor.state.tr.setSelection(CellSelection.rowSelection($a, $b)));
  };
  const selCol = (c) => {
    const $a = editor.state.doc.resolve(tableStart + map.map[c]);
    const $b = editor.state.doc.resolve(tableStart + map.map[(map.height - 1) * map.width + c]);
    view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection($a, $b)));
  };
  const openLine = (kind, i) => {
    if (kind === 'row') selRow(i); else selCol(i);
    setLineIdx(i); setOpen(kind); setSub(null);
  };
  const lineRun = (fn) => { fn(); editor.commands.focus(); close(); };
  // (GIRA-33) 표 오른쪽 가장자리 핸들: 끌어서 표 전체 폭 조절 — 열 비율 유지, 가운데 표는 양쪽으로 넓어진다
  const startWidthDrag = (e) => {
    e.preventDefault();
    if (!tableEl) return;
    const base = currentColWidths(view, selectedRect(editor.state));
    const total = base.reduce((a, b) => a + b, 0);
    const centered = table.attrs.layout !== 'align-start';
    const host = wrap.closest('.gmain') ?? document.body;
    const maxW = Math.max(COLUMN_WIDTH, host.clientWidth - 64 - (table.attrs.numberedRows ? 42 : 0));
    const minW = MIN_COL * base.length;
    const x0 = e.clientX;
    let widths = base;
    document.body.classList.add('col-resizing');
    const move = (ev) => {
      const d = ev.clientX - x0;
      const next = Math.min(maxW, Math.max(minW, total + (centered ? 2 * d : d)));
      widths = base.map((w) => Math.max(MIN_COL, (w / total) * next));
      previewColWidths(tableEl, widths);
      const bw = widths.reduce((a, b) => a + b, 0) + (table.attrs.numberedRows ? 42 : 0);
      wrap.classList.toggle('breakout', bw > COLUMN_WIDTH);
      wrap.style.setProperty('--bw', `${Math.round(bw)}px`);
      rerender();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('col-resizing');
      if (widths !== base) commitColWidths(view, tablePos, widths);
      editor.commands.focus();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const curTable = () => selectedRect(editor.state);

  return (
    <div ref={rootRef} className="tbl-ui" onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}>
      {showCellBtn && open !== 'row' && open !== 'col' && (
        <span className="tbl-cellbtn-wrap" style={{ left: cr.right - 24, top: cr.top + 4 }}>
          <button type="button" className={`tbl-cellbtn${open === 'cell' ? ' on' : ''}`} title="셀 옵션 (Shift+F10)" aria-haspopup="menu"
            aria-expanded={open === 'cell'} onMouseDown={(e) => e.preventDefault()} onClick={() => { toggle('cell'); setSub(null); }}>▾</button>
          {open === 'cell' && (
            <div className={`tbl-menu tbl-cellmenu${cellUp ? ' tbl-menu-up' : ''}`} role="menu" aria-label="셀 옵션">
              <div className="tbl-mi-wrap">
                <MenuItem sub onPick={() => setSub((s) => (s === 'bg' ? null : 'bg'))}>
                  배경색 <span className="tbl-bg-dot" style={headCell?.attrs.background ? { background: headCell.attrs.background } : undefined} />
                </MenuItem>
                {sub === 'bg' && <div className="tbl-submenu"><Palette current={headCell?.attrs.background ?? null}
                  onPick={(c) => chainRun((ch) => ch.setCellAttribute('background', c))} /></div>}
              </div>
              <div className="tbl-mi-wrap">
                <MenuItem sub onPick={() => setSub((s) => (s === 'valign' ? null : 'valign'))}>정렬</MenuItem>
                {sub === 'valign' && (
                  <div className="tbl-submenu tbl-menu" role="menu" aria-label="세로 정렬">
                    {[['top', '상단'], ['middle', '중간'], ['bottom', '하단']].map(([v, label]) => (
                      <MenuItem key={v} check={(headCell?.attrs.valign ?? 'top') === v}
                        onPick={() => chainRun((ch) => ch.setCellAttribute('valign', v === 'top' ? null : v))}>{label}</MenuItem>))}
                  </div>)}
              </div>
              <div className="tbl-sep" />
              {canMerge && <MenuItem onPick={() => chainRun((ch) => ch.mergeCells())}>셀 병합</MenuItem>}
              {canSplit && !multi && <MenuItem onPick={() => chainRun((ch) => ch.splitCell())}>셀 나누기</MenuItem>}
              <MenuItem kbd="Ctrl+Alt+→" onPick={() => lineRun(() => insertColumnAt(editor, rect.right))}>오른쪽에 열 추가</MenuItem>
              <MenuItem kbd="Ctrl+Alt+↓" onPick={() => chainRun((ch) => ch.addRowAfter())}>아래에 행 추가</MenuItem>
              {multi && rect.right - rect.left > 1 && <MenuItem onPick={() => equalize(true)}>열 균등 맞춤</MenuItem>}
              <div className="tbl-sep" />
              <MenuItem onPick={clearCells}>셀 지우기</MenuItem>
              <MenuItem danger onPick={() => chainRun((ch) => ch.deleteColumn())}>열 삭제</MenuItem>
              <MenuItem danger onPick={() => chainRun((ch) => ch.deleteRow())}>행 삭제</MenuItem>
            </div>)}
        </span>
      )}

      {showHandles && <>
        {/* 행 핸들 + 행 사이 삽입 점 */}
        {rowBox.map((b, r) => (
          <button type="button" key={`rh${r}`} className={`tbl-rowh${open === 'row' && lineIdx === r ? ' on' : ''}`} title="행 옵션"
            style={{ left: gutterL - 14, top: b.top + 1, height: b.height - 2 }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => openLine('row', r)} />))}
        {rowBox.length > 0 && [...rowBox.map((b) => b.top), rowBox[rowBox.length - 1].bottom].map((y, i) => (
          <button type="button" key={`ri${i}`} className="tbl-ins tbl-ins-row" title="행 삽입 (Ctrl+Alt+↓)"
            style={{ left: gutterL - 30, top: y - 8, '--len': `${tr.right - gutterL + 30}px` }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { insertRowAt(editor, i); close(); }}>+</button>))}
        <button type="button" className="tbl-width-h" title="표 크기 조정 (끌기)" aria-label="표 크기 조정"
          style={{ left: tr.right + 8, top: tr.top + Math.max(0, tr.height / 2 - 20), height: Math.min(40, tr.height) }}
          onMouseDown={startWidthDrag} />
        {/* 열 핸들 + 열 사이 삽입 점 */}
        {xs.slice(0, -1).map((x, c) => (
          <button type="button" key={`ch${c}`} className={`tbl-colh${open === 'col' && lineIdx === c ? ' on' : ''}`} title="열 옵션"
            style={{ left: x + 1, top: tr.top - 14, width: xs[c + 1] - x - 2 }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => openLine('col', c)} />))}
        {xs.map((x, i) => (
          <button type="button" key={`ci${i}`} className="tbl-ins tbl-ins-col" title="열 삽입 (Ctrl+Alt+→)"
            style={{ left: x - 8, top: tr.top - 32, '--len': `${tr.bottom - tr.top + 32}px` }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { insertColumnAt(editor, i); close(); }}>+</button>))}
        {open === 'row' && lineIdx != null && rowBox[lineIdx] && (
          <div className="tbl-menu tbl-linemenu" role="menu" aria-label="행 옵션"
            style={{ left: gutterL - 14, top: Math.min(rowBox[lineIdx].top, window.innerHeight - 360) }}>
            <MenuItem check={!!table.attrs.numberedRows} onPick={() => setTableAttrs({ numberedRows: !table.attrs.numberedRows })}>번호가 매겨진 행</MenuItem>
            <div className="tbl-mi-wrap">
              <MenuItem sub onPick={() => setSub((x) => (x === 'bg' ? null : 'bg'))}>배경색</MenuItem>
              {sub === 'bg' && <div className="tbl-submenu"><Palette current={null} onPick={(c) => chainRun((ch) => ch.setCellAttribute('background', c))} /></div>}
            </div>
            <div className="tbl-sep" />
            <MenuItem kbd="Ctrl+Alt+↑" onPick={() => lineRun(() => insertRowAt(editor, lineIdx))}>위에 행 추가</MenuItem>
            <MenuItem kbd="Ctrl+Alt+↓" onPick={() => lineRun(() => insertRowAt(editor, lineIdx + 1))}>아래에 행 추가</MenuItem>
            <MenuItem kbd="Ctrl+Alt+Shift+[" disabled={lineIdx === 0} onPick={() => lineRun(() => moveRow(editor, -1))}>행을 위로 이동</MenuItem>
            <MenuItem kbd="Ctrl+Alt+Shift+]" disabled={lineIdx >= map.height - 1} onPick={() => lineRun(() => moveRow(editor, 1))}>행을 아래로 이동</MenuItem>
            <div className="tbl-sep" />
            <MenuItem onPick={clearCells}>셀 지우기</MenuItem>
            <MenuItem danger kbd="Ctrl+⌫" onPick={() => chainRun((ch) => ch.deleteRow())}>행 삭제</MenuItem>
          </div>)}
        {open === 'col' && lineIdx != null && xs[lineIdx] != null && (
          <div className="tbl-menu tbl-linemenu" role="menu" aria-label="열 옵션"
            style={{ left: Math.min(xs[lineIdx], window.innerWidth - 300), top: tr.top - 2 }}>
            <div className="tbl-mi-wrap">
              <MenuItem sub onPick={() => setSub((x) => (x === 'bg' ? null : 'bg'))}>배경색</MenuItem>
              {sub === 'bg' && <div className="tbl-submenu"><Palette current={null} onPick={(c) => chainRun((ch) => ch.setCellAttribute('background', c))} /></div>}
            </div>
            <MenuItem onPick={() => lineRun(() => sortByColumn(editor, lineIdx, 1))}>오름차순으로 정렬</MenuItem>
            <MenuItem onPick={() => lineRun(() => sortByColumn(editor, lineIdx, -1))}>내림차순으로 정렬</MenuItem>
            <div className="tbl-sep" />
            <MenuItem kbd="Ctrl+Alt+←" onPick={() => lineRun(() => insertColumnAt(editor, lineIdx))}>왼쪽에 열 추가</MenuItem>
            <MenuItem kbd="Ctrl+Alt+→" onPick={() => lineRun(() => insertColumnAt(editor, lineIdx + 1))}>오른쪽에 열 추가</MenuItem>
            <MenuItem kbd="Ctrl+Alt+Shift+-" disabled={lineIdx === 0} onPick={() => lineRun(() => moveColumn(editor, -1))}>열을 왼쪽으로 이동</MenuItem>
            <MenuItem kbd="Ctrl+Alt+Shift+=" disabled={lineIdx >= map.width - 1} onPick={() => lineRun(() => moveColumn(editor, 1))}>열을 오른쪽으로 이동</MenuItem>
            <div className="tbl-sep" />
            <MenuItem onPick={clearCells}>셀 지우기</MenuItem>
            <MenuItem danger kbd="Ctrl+⌫" onPick={() => chainRun((ch) => ch.deleteColumn())}>열 삭제</MenuItem>
          </div>)}
      </>}

      {showBar && (
        <div className="tbl-bar" role="toolbar" aria-label="표 도구 모음" style={{ left: barLeft, top: barTop }}
          onMouseDown={(e) => e.preventDefault()}>
          <span className="tbl-bar-item">
            <button type="button" className={open === 'opts' ? 'on' : ''} onClick={() => toggle('opts')} aria-haspopup="menu" title="표 옵션">
              표 옵션 <span aria-hidden>▾</span></button>
            {open === 'opts' && (
              <div className={`tbl-menu${up ? ' tbl-menu-up' : ''}`} role="menu" aria-label="표 옵션">
                <MenuItem check={headerRow} onPick={() => chainRun((ch) => ch.toggleHeaderRow())}>헤더 행</MenuItem>
                <MenuItem check={headerCol} onPick={() => chainRun((ch) => ch.toggleHeaderColumn())}>헤더 열</MenuItem>
                <MenuItem check={!!table.attrs.numberedRows} onPick={() => setTableAttrs({ numberedRows: !table.attrs.numberedRows })}>번호가 매겨진 행</MenuItem>
                <MenuItem check={table.attrs.displayMode === 'fixed'} onPick={toggleFixed}>고정된 열 너비</MenuItem>
              </div>)}
          </span>
          <span className="tbl-bar-item">
            <button type="button" className={open === 'align' ? 'on' : ''} onClick={() => toggle('align')} aria-haspopup="menu" title="표 정렬">
              정렬 <span aria-hidden>▾</span></button>
            {open === 'align' && (
              <div className={`tbl-menu${up ? ' tbl-menu-up' : ''}`} role="menu" aria-label="표 정렬">
                <MenuItem check={align === 'left'} onPick={() => setTableAttrs({ layout: 'align-start' })}>왼쪽 정렬</MenuItem>
                <MenuItem check={align === 'center'} onPick={() => setTableAttrs({ layout: 'center' })}>가운데 정렬</MenuItem>
              </div>)}
          </span>
          <span className="tbl-bar-sep" />
          <button type="button" onClick={() => equalize(false)} title="모든 열을 같은 너비로">열 균등 맞춤</button>
          <button type="button" onClick={fitContent} title="내용에 맞게 열 너비를 줄임">콘텐츠에 맞춤</button>
          <span className="tbl-bar-sep" />
          <span className="tbl-bar-item">
            <button type="button" className={open === 'more' ? 'on' : ''} onClick={() => toggle('more')} aria-haspopup="menu" title="더 보기">⋯</button>
            {open === 'more' && (
              <div className={`tbl-menu tbl-menu-right${up ? ' tbl-menu-up' : ''}`} role="menu" aria-label="표 더 보기">
                <MenuItem onPick={copyTable}>복사</MenuItem>
                <MenuItem danger onPick={() => chainRun((ch) => ch.deleteTable())}>표 삭제</MenuItem>
              </div>)}
          </span>
        </div>
      )}
    </div>
  );
}
