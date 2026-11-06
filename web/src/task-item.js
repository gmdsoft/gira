import { Node, wrappingInputRule } from '@tiptap/core';

export const TaskItem = Node.create({
  name: 'taskItem',
  content: 'block*',
  addAttributes: () => ({ checked: { default: false } }),
  parseHTML: () => [{ tag: 'li.task-item', priority: 1100, getAttrs: el => ({ checked: el.dataset.checked === 'true' }), contentElement: '.task-body' }],
  renderHTML: ({ node }) => ['li', { class: 'task-item', 'data-checked': String(node.attrs.checked) },
    ['input', { type: 'checkbox', class: 'task-check', 'aria-label': '작업을 완료로 표시', disabled: '', ...(node.attrs.checked ? { checked: '' } : {}) }],
    ['div', { class: 'task-body' }, 0]],
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('li'); dom.className = 'task-item';
      const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'task-check';
      check.contentEditable = 'false'; check.setAttribute('aria-label', '작업을 완료로 표시');
      const contentDOM = document.createElement('div'); contentDOM.className = 'task-body';
      dom.append(check, contentDOM);
      const draw = () => { dom.dataset.checked = String(current.attrs.checked); check.checked = current.attrs.checked; check.disabled = !editor.isEditable; };
      check.onchange = () => {
        const pos = getPos();
        if (editor.isEditable && typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: check.checked }));
      };
      draw();
      return { dom, contentDOM, update(next) { if (next.type !== current.type) return false; current = next; draw(); return true; }, stopEvent: event => event.target === check, ignoreMutation: mutation => mutation.type === 'attributes' && (mutation.target === dom || mutation.target === check) };
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!this.editor.isActive('taskItem')) return false;
        if (empty && $from.parent.isTextblock && $from.parent.content.size === 0) return this.editor.commands.liftListItem('taskItem');
        return this.editor.commands.splitListItem('taskItem', { checked: false });
      },
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || !this.editor.isActive('taskItem')) return false;
        const itemDepth = Array.from({ length: $from.depth }, (_, i) => i + 1).reverse().find(d => $from.node(d).type.name === 'taskItem');
        if (!itemDepth || $from.index(itemDepth) !== 0) return false;
        // 내용 있는 첫 문단도 앞 항목과 합치지 않고 목록 밖 문단으로 꺼낸다.
        while (this.editor.isActive('taskItem')) {
          if (!this.editor.commands.liftListItem('taskItem')) return false;
        }
        return true;
      },
    };
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*\[([ xX]?)\]\s$/, type: this.type, getAttributes: m => ({ checked: /x/i.test(m[1] ?? '') }) })];
  },
});
