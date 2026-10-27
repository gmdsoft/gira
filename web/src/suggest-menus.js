// '@' 멘션, ':' 이모지 서제스천 (editor-spec.md의 트리거 문자).
// slash-menu와 같은 @tiptap/suggestion 기반, 의존성 없는 순수 DOM 팝업.
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

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
const EMOJIS = [
  ['🙂', 'smile 웃음'], ['😄', 'laugh 큰웃음'], ['😉', 'wink 윙크'], ['😛', 'cheeky 메롱'], ['🙁', 'sad 슬픔'],
  ['👍', 'thumbs-up +1 좋아요'], ['👎', 'thumbs-down -1 싫어요'], ['👏', 'clap 박수'], ['🙏', 'pray 부탁 감사'],
  ['✅', 'check tick 완료 확인'], ['❌', 'cross x 아니오 실패'], ['⚠️', 'warning 경고 주의'], ['❓', 'question 질문'],
  ['ℹ️', 'information info 정보'], ['💡', 'bulb idea 아이디어'], ['🔥', 'fire 불'], ['🎉', 'party tada 축하'],
  ['⭐', 'star 별'], ['❤️', 'heart 하트'], ['🚀', 'rocket 로켓 출시'], ['📌', 'pin 고정'], ['📅', 'calendar 달력 일정'],
  ['📝', 'memo note 메모'], ['📊', 'chart 차트 그래프'], ['📁', 'folder 폴더'], ['🔗', 'link 링크'],
  ['🔴', 'red circle 빨강'], ['🟡', 'yellow circle 노랑'], ['🟢', 'green circle 초록'], ['🔵', 'blue circle 파랑'],
  ['⏰', 'alarm clock 시계 마감'], ['🐛', 'bug 버그'], ['🔒', 'lock 잠금 보안'], ['💬', 'comment 댓글 말풍선'],
];

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
          if (query.length < 2) return []; // "오후 3:00" 같은 일반 콜론 입력에 뜨지 않게
          const q = query.toLowerCase();
          return EMOJIS.filter(([, kw]) => kw.includes(q)).slice(0, 8).map(([ch, kw]) => ({
            label: `${ch}  :${kw.split(' ')[0]}:`,
            run: (e, r) => e.chain().focus().deleteRange(r).insertContent([
              { type: 'emoji', attrs: { shortName: `:${kw.split(' ')[0]}:`, text: ch } },
              { type: 'text', text: ' ' },
            ]).run(),
          }));
        },
        render: popupRender,
      })];
    },
  });
}
