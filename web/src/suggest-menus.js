// '@' 멘션, ':' 이모지 서제스천 (editor-spec.md의 트리거 문자).
// slash-menu와 같은 @tiptap/suggestion 기반, 의존성 없는 순수 DOM 팝업.
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { EMOJIS, createEmojiPicker } from './emoji-picker.js';

// 공용 팝업 렌더러: items = [{ label, desc?, run }]
function popupRender() {
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
      if (item.desc) {
        const d = document.createElement('span');
        d.className = 'slash-desc';
        d.textContent = item.desc;
        row.appendChild(d);
      }
      row.addEventListener('mousedown', (ev) => { ev.preventDefault(); command(item); });
      el.appendChild(row);
    });
  };
  const place = (rect) => {
    if (!el || !rect) return;
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.bottom + 4}px`;
  };

  return {
    onStart: (props) => {
      el = document.createElement('div');
      el.className = 'slash-menu';
      document.body.appendChild(el);
      current = props.items; command = props.command; selected = 0;
      draw(); place(props.clientRect?.());
    },
    onUpdate: (props) => {
      current = props.items; command = props.command;
      selected = Math.min(selected, Math.max(current.length - 1, 0));
      draw(); place(props.clientRect?.());
    },
    onKeyDown: ({ event }) => {
      if (!current.length) return false;
      if (event.key === 'ArrowDown') { selected = (selected + 1) % current.length; draw(); return true; }
      if (event.key === 'ArrowUp') { selected = (selected - 1 + current.length) % current.length; draw(); return true; }
      if (event.key === 'Enter') { command(current[selected]); return true; }
      if (event.key === 'Escape') { el?.remove(); el = null; return true; }
      return false;
    },
    onExit: () => { el?.remove(); el = null; },
  };
}

// '@' 멘션: /api/principals 사용자 검색 → mention 노드
export function mentionMenu() {
  return Extension.create({
    name: 'mentionMenu',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('mentionMenu'),
        allowSpaces: false,
        command: ({ editor, range, props }) => props.run(editor, range),
        items: async ({ query }) => {
          try {
            const res = await fetch(`/api/principals?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];
            const { users } = await res.json();
            return users.map((u) => ({
              label: u.name, desc: u.email ?? '',
              run: (e, r) => e.chain().focus().deleteRange(r).insertContent([
                { type: 'mention', attrs: { accountId: u.accountId ?? null, text: u.name } },
                { type: 'text', text: ' ' },
              ]).run(),
            }));
          } catch { return []; }
        },
        render: popupRender,
      })];
    },
  });
}

// ':' 이모지: 상용 유니코드 목록 (Atlassian 커스텀 이모지는 범위 밖 — editor-spec.md)

export function emojiMenu() {
  return Extension.create({
    name: 'emojiMenu',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        char: ':',
        pluginKey: new PluginKey('emojiMenu'),
        allowSpaces: false,
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => {
          const q = query.toLowerCase();
          return EMOJIS.filter(([, kw]) => kw.includes(q)).map(([ch, kw]) => ({
            label: `${ch}  :${kw.split(' ')[0]}:`,
            run: (e, r) => e.chain().focus().deleteRange(r).insertContent([
              { type: 'emoji', attrs: { shortName: `:${kw.split(' ')[0]}:`, text: ch } },
              { type: 'text', text: ' ' },
            ]).run(),
          }));
        },
        render: () => {
          let el, latest, selected = 0;
          return {
            onStart(props) {
              latest = props;
              el = createEmojiPicker(item => latest.command({ run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'emoji', attrs: { text: item[0], shortName: `:${item[1].split(' ')[0]}:` } }).run() }), props.query);
              el.classList.add('emoji-suggestion'); document.body.append(el);
              const rect = props.clientRect?.(); if (rect) { el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`; el.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 300))}px`; }
            },
            onUpdate(props) { latest = props; selected = 0; el?.setQuery(props.query); },
            onKeyDown({ event }) {
              const buttons = [...(el?.querySelectorAll('button') || [])];
              if (event.key === 'Escape') { el?.remove(); return true; }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[selected]?.focus(); return true; }
              if (event.key === 'Enter' && buttons.length) { buttons[selected]?.click(); return true; }
              return false;
            },
            onExit() { el?.remove(); },
          };
        },
      })];
    },
  });
}
