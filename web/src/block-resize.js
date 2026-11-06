import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export function widthAttrs(node) {
  const width = Number(node.attrs.blockWidth);
  return width >= 760 ? { 'data-block-width': String(width), style: `--block-width:${width}px` } : {};
}
export const BlockResize = Extension.create({
  name: 'blockResize',
  addGlobalAttributes() {
    return [{ types: ['codeBlock', 'expand', 'layout'], attributes: {
      blockWidth: { default: null, parseHTML: el => Number(el.getAttribute('data-block-width')) || null, renderHTML: () => ({}) },
    } }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: { decorations(state) {
        const out = [];
        state.doc.descendants((node, pos) => {
          if (node.attrs.blockWidth >= 760) out.push(Decoration.node(pos, pos + node.nodeSize, widthAttrs(node)));
        });
        return DecorationSet.create(state.doc, out);
      } },
      view(view) {
        const overlay = document.createElement('div');
        overlay.className = 'block-resize-overlay';
        document.body.append(overlay);
        let cleanupDrag = null;
        let active = null;
        const clear = () => { if (!cleanupDrag) overlay.replaceChildren(); };
        const button = (x, rect, title, down) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'block-width-handle'; b.title = title; b.setAttribute('aria-label', title);
          Object.assign(b.style, { left: `${x - 6}px`, top: `${rect.top}px`, height: `${rect.height}px` });
          b.onpointerdown = down; overlay.append(b);
        };
        const drag = (event, move, finish) => {
          event.preventDefault();
          const up = e => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); cleanupDrag = null; finish(e); clear(); };
          const cancel = () => up(null);
          document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel);
          cleanupDrag = cancel;
        };
        const hover = event => {
          if (cleanupDrag || !view.editable) return;
          let target = event.target.closest('.code-block, .expand-edit, .layout');
          if (!target || !view.dom.contains(target)) { clear(); return; }
          // Nested blocks stay within their containing column/expand.
          if (target.parentElement !== view.dom) { clear(); return; }
          const pos = view.posAtDOM(target, 0);
          const resolved = view.state.doc.resolve(pos);
          const blockPos = resolved.depth ? resolved.before(1) : pos;
          const node = view.state.doc.nodeAt(blockPos);
          if (!['codeBlock', 'expand', 'layout'].includes(node?.type.name)) return;
          active = blockPos; clear();
          const rect = target.getBoundingClientRect();
          const area = view.dom.closest('.page')?.getBoundingClientRect() || view.dom.parentElement.getBoundingClientRect();
          const center = (rect.left + rect.right) / 2;
          const max = Math.max( Math.min(760, area.width - 32), Math.floor(2 * Math.min(center - area.left - 16, area.right - center - 16)));
          for (const side of [-1, 1]) button(side < 0 ? rect.left - 8 : rect.right + 8, rect, node.type.name === 'codeBlock' ? '코드 조각 크기 조정' : node.type.name === 'expand' ? '펼치기 크기 조정' : '레이아웃 크기 조정', e => {
            let width = rect.width;
            const originalStyle = target.getAttribute('style');
            const originalWidth = target.getAttribute('data-block-width');
            const guide = document.createElement('div'); guide.className = 'block-width-guide'; overlay.append(guide);
            const label = document.createElement('span'); label.className = 'block-width-label'; overlay.append(label);
            drag(e, ev => {
              const raw = Math.min(max, Math.max(Math.min(760, max), rect.width + side * 2 * (ev.clientX - e.clientX)));
              width = Math.abs(raw - max) < 24 ? max : max >= 1050 && Math.abs(raw - 1050) < 24 ? 1050 : Math.round(raw);
              target.setAttribute('data-block-width', String(width)); target.style.setProperty('--block-width', `${width}px`);
              Object.assign(guide.style, { left: `${center - width / 2}px`, width: `${width}px`, top: `${area.top}px`, height: `${area.height}px` });
              label.textContent = width === max ? '전체 폭' : width === 1050 ? '넓게' : '';
              Object.assign(label.style, { left: `${center}px`, top: `${rect.bottom + 8}px` });
            }, ev => {
              if (originalWidth == null) target.removeAttribute('data-block-width'); else target.setAttribute('data-block-width', originalWidth);
              if (originalStyle == null) target.removeAttribute('style'); else target.setAttribute('style', originalStyle);
              if (ev && view.state.doc.nodeAt(active)?.type === node.type) view.dispatch(view.state.tr.setNodeAttribute(active, 'blockWidth', Math.max(760, width)));
              else view.updateState(view.state);
            });
          });
          if (node.type.name !== 'layout') return;
          node.forEach((section, offset) => {
            const sectionPos = blockPos + 1 + offset;
            const sectionDOM = view.nodeDOM(sectionPos);
            if (!sectionDOM) return;
            const columns = [...sectionDOM.children];
            const widths = columns.map(c => c.getBoundingClientRect().width);
            const total = widths.reduce((a, b) => a + b, 0);
            let colOffset = 0;
            section.forEach((col, i) => {
              colOffset += col.nodeSize;
              if (i === columns.length - 1) return;
              const r = columns[i].getBoundingClientRect(), next = columns[i + 1].getBoundingClientRect();
              button((r.right + next.left) / 2, r, '열 비율 조정', e => {
                const ratios = widths.map(w => w / total * 100);
                const base = ratios.slice();
                const handle = e.currentTarget;
                overlay.classList.add('dragging-column');
                drag(e, ev => {
                  const delta = (ev.clientX - e.clientX) / total * 100;
                  ratios[i] = Math.max(5, Math.min(base[i] + base[i + 1] - 5, base[i] + delta));
                  ratios[i + 1] = base[i] + base[i + 1] - ratios[i];
                  columns.forEach((c, j) => c.style.setProperty('flex', `${ratios[j]} 1 0px`, 'important'));
                  handle?.style?.setProperty('left', `${ev.clientX - 6}px`);
                }, ev => {
                  columns.forEach(c => c.style.removeProperty('flex'));
                  overlay.classList.remove('dragging-column');
                  if (!ev) return;
                  let tr = view.state.tr, off = 0;
                  section.forEach((c, j) => { tr = tr.setNodeAttribute(sectionPos + 1 + off, 'width', ratios[j]); off += c.nodeSize; });
                  view.dispatch(tr);
                });
              });
            });
          });
        };
        view.dom.addEventListener('pointermove', hover);
        window.addEventListener('scroll', clear, true); window.addEventListener('resize', clear);
        return { update() { if (!cleanupDrag) clear(); }, destroy() { cleanupDrag?.(); overlay.remove(); view.dom.removeEventListener('pointermove', hover); window.removeEventListener('scroll', clear, true); window.removeEventListener('resize', clear); } };
      },
    })];
  },
});
