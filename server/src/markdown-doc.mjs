// Markdown → Gonfluence 본문 doc(JSON) 변환 (REST API의 markdown 입력용).
// 편집기 스키마(web/src/extensions.js: StarterKit + 표 + 작업 목록 + link 마크)에 있는 노드·마크만 만든다.
// 지원: 문단, 제목(1~6), 글머리/번호 목록, 작업 목록(- [ ] / - [x]), 인용, 코드 블록(언어), 구분선, 표(GFM),
//       굵게·기울임·취소선·인라인 코드·링크, 줄바꿈. 이미지는 링크 텍스트로, 원시 HTML은 글자 그대로 넣는다.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const MARKS = { strong: 'bold', em: 'italic', s: 'strike' };

// 인라인 토큰 → text 노드 배열
function inline(tokens) {
  const out = [];
  const marks = [];
  const push = (text, extra = []) => {
    if (!text) return;
    const m = [...marks, ...extra];
    out.push(m.length ? { type: 'text', text, marks: m.map((x) => ({ ...x })) } : { type: 'text', text });
  };
  for (const t of tokens ?? []) {
    if (t.type === 'text' || t.type === 'html_inline') push(t.content);
    else if (t.type === 'code_inline') push(t.content, [{ type: 'code' }]);
    else if (t.type === 'softbreak') push(' ');
    else if (t.type === 'hardbreak') out.push({ type: 'hardBreak' });
    else if (/_(open|close)$/.test(t.type) && MARKS[t.type.replace(/_(open|close)$/, '')]) {
      const name = MARKS[t.type.replace(/_(open|close)$/, '')];
      if (t.type.endsWith('_open')) marks.push({ type: name });
      else { const i = marks.map((x) => x.type).lastIndexOf(name); if (i >= 0) marks.splice(i, 1); }
    } else if (t.type === 'link_open') {
      marks.push({ type: 'link', attrs: { href: t.attrGet('href') } });
    } else if (t.type === 'link_close') {
      const i = marks.map((x) => x.type).lastIndexOf('link');
      if (i >= 0) marks.splice(i, 1);
    } else if (t.type === 'image') {
      push(t.content || t.attrGet('alt') || t.attrGet('src'), [{ type: 'link', attrs: { href: t.attrGet('src') } }]);
    }
  }
  return out;
}

const para = (content) => ({ type: 'paragraph', ...(content.length ? { content } : {}) });

// 블록 토큰을 순서대로 읽어 노드로 만든다 (중첩은 재귀). close 토큰 타입을 만나면 멈춘다.
function blocks(tokens, pos, until) {
  const out = [];
  let i = pos;
  while (i < tokens.length) {
    const t = tokens[i];
    if (until && t.type === until) return { nodes: out, next: i + 1 };
    switch (t.type) {
      case 'paragraph_open': {
        out.push(para(inline(tokens[i + 1].children)));
        i += 3; break; // open, inline, close
      }
      case 'heading_open': {
        const level = Math.min(6, Number(t.tag.slice(1)) || 1);
        const content = inline(tokens[i + 1].children);
        out.push({ type: 'heading', attrs: { level }, ...(content.length ? { content } : {}) });
        i += 3; break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const close = t.type.replace('_open', '_close');
        const r = blocks(tokens, i + 1, close);
        const items = r.nodes;
        // 모든 항목이 [ ] / [x]로 시작하면 작업 목록
        const isTask = t.type === 'bullet_list_open' && items.length && items.every((it) => it.__task !== undefined);
        if (isTask) {
          out.push({ type: 'taskList', content: items.map(({ __task, ...it }) => ({ ...it, type: 'taskItem', attrs: { checked: __task } })) });
        } else {
          const list = items.map(({ __task, ...it }) => it);
          const start = Number(t.attrGet('start')) || 1;
          out.push(t.type === 'ordered_list_open'
            ? { type: 'orderedList', attrs: { start }, content: list }
            : { type: 'bulletList', content: list });
        }
        i = r.next; break;
      }
      case 'list_item_open': {
        const r = blocks(tokens, i + 1, 'list_item_close');
        const content = r.nodes.length ? r.nodes : [para([])];
        const item = { type: 'listItem', content };
        const first = content[0];
        const firstText = first?.type === 'paragraph' && first.content?.[0]?.type === 'text' ? first.content[0] : null;
        const m = firstText && !firstText.marks && /^\[( |x|X)\]\s?/.exec(firstText.text);
        if (m) {
          firstText.text = firstText.text.slice(m[0].length);
          if (!firstText.text) first.content.shift();
          if (!first.content.length) delete first.content;
          item.__task = m[1].toLowerCase() === 'x';
        }
        out.push(item);
        i = r.next; break;
      }
      case 'blockquote_open': {
        const r = blocks(tokens, i + 1, 'blockquote_close');
        out.push({ type: 'blockquote', content: r.nodes.length ? r.nodes : [para([])] });
        i = r.next; break;
      }
      case 'fence':
      case 'code_block': {
        const text = t.content.replace(/\n$/, '');
        const language = (t.info || '').trim().split(/\s+/)[0] || null;
        out.push({ type: 'codeBlock', attrs: { language }, ...(text ? { content: [{ type: 'text', text }] } : {}) });
        i += 1; break;
      }
      case 'hr': out.push({ type: 'horizontalRule' }); i += 1; break;
      case 'html_block': {
        const text = t.content.trim();
        if (text) out.push(para([{ type: 'text', text }]));
        i += 1; break;
      }
      case 'table_open': {
        const rows = [];
        let j = i + 1;
        let row = null;
        for (; j < tokens.length && tokens[j].type !== 'table_close'; j++) {
          const x = tokens[j];
          if (x.type === 'tr_open') row = [];
          else if (x.type === 'tr_close') { rows.push({ type: 'tableRow', content: row }); row = null; }
          else if (x.type === 'th_open' || x.type === 'td_open') {
            const content = inline(tokens[j + 1].children);
            row.push({ type: x.type === 'th_open' ? 'tableHeader' : 'tableCell', content: [para(content)] });
            j += 2;
          }
        }
        if (rows.length) out.push({ type: 'table', content: rows });
        i = j + 1; break;
      }
      default: i += 1;
    }
  }
  return { nodes: out, next: i };
}

export function markdownToDoc(markdown) {
  const tokens = md.parse(String(markdown ?? ''), {});
  const { nodes } = blocks(tokens, 0, null);
  return { type: 'doc', content: nodes.length ? nodes : [para([])] };
}

// 요청 본문에서 doc을 꺼낸다: doc(JSON) 우선, 없으면 markdown 변환. 둘 다 없으면 null.
export function bodyDoc(body) {
  if (body?.doc != null) {
    if (typeof body.doc !== 'object' || body.doc.type !== 'doc') throw Object.assign(new Error('doc은 {type:"doc", content:[...]} 형식이어야 합니다'), { statusCode: 400 });
    return body.doc;
  }
  if (typeof body?.markdown === 'string') return markdownToDoc(body.markdown);
  return null;
}
