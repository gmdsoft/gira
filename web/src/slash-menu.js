// '/' 명령 메뉴. @tiptap/suggestion 기반, 의존성 없는 순수 DOM 팝업.
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

const del = (editor, range) => editor.chain().focus().deleteRange(range);

export function makeSlashItems({ openImageDialog }) {
  return [
    { label: '제목 1', kw: 'h1 heading', run: (e, r) => del(e, r).setHeading({ level: 1 }).run() },
    { label: '제목 2', kw: 'h2 heading', run: (e, r) => del(e, r).setHeading({ level: 2 }).run() },
    { label: '제목 3', kw: 'h3 heading', run: (e, r) => del(e, r).setHeading({ level: 3 }).run() },
    { label: '글머리 목록', kw: 'ul bullet list', run: (e, r) => del(e, r).toggleBulletList().run() },
    { label: '번호 목록', kw: 'ol ordered list', run: (e, r) => del(e, r).toggleOrderedList().run() },
    { label: '작업 항목', kw: 'task todo checkbox', run: (e, r) => del(e, r).insertContent({
      type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }],
    }).run() },
    { label: '표', kw: 'table', run: (e, r) => del(e, r).insertContent({
      type: 'table',
      content: Array.from({ length: 3 }, (_, i) => ({
        type: 'tableRow',
        content: Array.from({ length: 3 }, () => ({
          type: i === 0 ? 'tableHeader' : 'tableCell',
          attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph' }],
        })),
      })),
    }).run() },
    { label: '정보 패널', kw: 'info panel', run: (e, r) => del(e, r).insertContent({
      type: 'panel', attrs: { panelType: 'info', title: null, bgColor: null }, content: [{ type: 'paragraph' }] }).run() },
    { label: '주의 패널', kw: 'warning panel', run: (e, r) => del(e, r).insertContent({
      type: 'panel', attrs: { panelType: 'warning', title: null, bgColor: null }, content: [{ type: 'paragraph' }] }).run() },
    { label: '펼치기', kw: 'expand toggle', run: (e, r) => del(e, r).insertContent({
      type: 'expand', attrs: { title: '제목' }, content: [{ type: 'paragraph' }] }).run() },
    { label: '코드 블록', kw: 'code block', run: (e, r) => del(e, r).toggleCodeBlock().run() },
    { label: '인용', kw: 'quote blockquote', run: (e, r) => del(e, r).toggleBlockquote().run() },
    { label: '구분선', kw: 'hr divider', run: (e, r) => del(e, r).setHorizontalRule().run() },
    { label: '이미지·파일', kw: 'image file upload', run: (e, r) => { del(e, r).run(); openImageDialog(); } },
    { label: '날짜 (오늘)', kw: 'date today', run: (e, r) => del(e, r).insertContent({
      type: 'date', attrs: { date: new Date().toISOString().slice(0, 10) } }).run() },
    { label: '상태', kw: 'status lozenge', run: (e, r) => del(e, r).insertContent({
      type: 'status', attrs: { text: '진행 중', color: 'blue' } }).run() },
  ];
}

export function slashMenu(items) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          command: ({ editor, range, props }) => props.run(editor, range),
          items: ({ query }) =>
            items.filter((i) => (i.label + ' ' + i.kw).toLowerCase().includes(query.toLowerCase())).slice(0, 12),
          render: () => {
            let el = null;
            let selected = 0;
            let current = [];
            let command = null;

            const draw = () => {
              if (!el) return;
              el.innerHTML = '';
              current.forEach((item, i) => {
                const row = document.createElement('div');
                row.className = 'slash-item' + (i === selected ? ' slash-selected' : '');
                row.textContent = item.label;
                row.addEventListener('mousedown', (ev) => { ev.preventDefault(); command(item); });
                el.appendChild(row);
              });
              if (!current.length) {
                const row = document.createElement('div');
                row.className = 'slash-item slash-empty';
                row.textContent = '일치하는 항목 없음';
                el.appendChild(row);
              }
            };
            const place = (clientRect) => {
              const rect = clientRect?.();
              if (!rect || !el) return;
              el.style.left = `${rect.left}px`;
              const below = rect.bottom + 4;
              el.style.top = `${Math.min(below, window.innerHeight - el.offsetHeight - 8)}px`;
            };

            return {
              onStart: (props) => {
                el = document.createElement('div');
                el.className = 'slash-menu';
                document.body.appendChild(el);
                current = props.items; command = props.command; selected = 0;
                draw(); place(props.clientRect);
              },
              onUpdate: (props) => {
                current = props.items; command = props.command;
                if (selected >= current.length) selected = 0;
                draw(); place(props.clientRect);
              },
              onKeyDown: ({ event }) => {
                if (!current.length) return event.key === 'Escape' ? (el?.remove(), el = null, true) : false;
                if (event.key === 'ArrowDown') { selected = (selected + 1) % current.length; draw(); return true; }
                if (event.key === 'ArrowUp') { selected = (selected - 1 + current.length) % current.length; draw(); return true; }
                if (event.key === 'Enter') { command(current[selected]); return true; }
                if (event.key === 'Escape') { el?.remove(); el = null; return true; }
                return false;
              },
              onExit: () => { el?.remove(); el = null; },
            };
          },
        }),
      ];
    },
  });
}
