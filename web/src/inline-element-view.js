export const STATUS_COLORS = ['neutral', 'blue', 'green', 'yellow', 'red', 'purple', 'teal', 'orange', 'pink', 'lime'];

// 문서에는 기존 date/status 속성만 저장하며, 팝업 DOM은 저장하지 않는다.
export function inlineElementView(kind) {
  return ({ node, editor, getPos }) => {
    let current = node;
    let popup;
    const dom = document.createElement('span');
    const draw = () => {
      dom.className = kind === 'date' ? 'date-lozenge' : `status status-${current.attrs.color}`;
      dom.textContent = kind === 'date' ? current.attrs.date : current.attrs.text;
      if (editor.isEditable) { dom.tabIndex = 0; dom.setAttribute('role', 'button'); dom.setAttribute('aria-label', kind === 'date' ? '날짜 변경' : '상태 변경'); }
    };
    const close = () => { popup?.remove(); popup = null; document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    const outside = e => { if (!popup?.contains(e.target) && !dom.contains(e.target)) close(); };
    const escape = e => { if (e.key === 'Escape') { close(); editor.commands.focus(); } };
    const apply = attrs => {
      const pos = getPos();
      if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos)?.type !== current.type) return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
    };
    const open = () => {
      if (!editor.isEditable) return;
      close();
      popup = document.createElement('div'); popup.className = 'inline-element-popup'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', kind === 'date' ? '날짜 변경' : '상태 변경');
      const input = document.createElement('input'); input.type = kind === 'date' ? 'date' : 'text'; input.setAttribute('aria-label', kind === 'date' ? '날짜' : '상태 텍스트');
      input.value = kind === 'date' ? current.attrs.date : current.attrs.text;
      input.oninput = () => { if (kind === 'status' || input.value) apply({ [kind === 'date' ? 'date' : 'text']: input.value }); };
      popup.append(input);
      if (kind === 'status') {
        const colors = document.createElement('div'); colors.className = 'status-color-grid';
        STATUS_COLORS.forEach(color => {
          const button = document.createElement('button'); button.type = 'button'; button.className = `status status-${color}`; button.textContent = '●'; button.title = color; button.setAttribute('aria-label', color);
          button.onclick = () => { apply({ color }); colors.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); };
          button.setAttribute('aria-pressed', String(current.attrs.color === color)); colors.append(button);
        });
        popup.append(colors);
      }
      const done = document.createElement('button'); done.type = 'button'; done.textContent = '완료'; done.onclick = () => { close(); editor.commands.focus(); }; popup.append(done);
      document.body.append(popup);
      const rect = dom.getBoundingClientRect(); popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`; popup.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - popup.offsetHeight - 8))}px`;
      document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); input.focus();
    };
    dom.onclick = open; dom.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    draw();
    return { dom, update(next) { if (next.type !== current.type) return false; current = next; draw(); return true; }, ignoreMutation: () => true, stopEvent: () => editor.isEditable, destroy: close };
  };
}
