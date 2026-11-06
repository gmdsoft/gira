// 코드 문자열만 토큰화한다. 원문과 language 속성은 저장 시 변경하지 않는다.
import CodeBlock from '@tiptap/extension-code-block';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const codeLanguages = [
  ['javascript', 'JavaScript'], ['python', 'Python'], ['rust', 'Rust'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
  ['sql', 'SQL'], ['json', 'JSON'], ['bash', 'Bash'],
  ['plaintext', '일반 텍스트'],
];
const aliases = {
  js: 'javascript', shell: 'bash', sh: 'bash', text: 'plaintext', plain: 'plaintext',
  py: 'python', python3: 'python', rs: 'rust', h: 'c', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  'c#': 'csharp', cs: 'csharp',
};
const HIGHLIGHTED = ['javascript', 'python', 'rust', 'c', 'cpp', 'csharp', 'sql', 'json', 'bash'];
const C_KEYWORDS = 'auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|bool|true|false|NULL';
const keywords = {
  javascript: /^(?:const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|throw|try|catch|typeof|this|of|in|default|switch|case|break|extends)$/,
  sql: /^(?:select|from|where|insert|into|values|update|set|delete|create|table|alter|drop|join|left|right|inner|outer|on|as|and|or|not|is|in|like|order|by|group|having|limit|asc|desc|distinct|union|with|primary|key)$/i,
  bash: /^(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|export|local|echo|printf|cd|exit|sudo)$/,
  python: /^(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|self|None|True|False)$/,
  rust: /^(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|unsafe|use|where|while|Some|None|Ok|Err)$/,
  c: new RegExp(`^(?:${C_KEYWORDS})$`),
  cpp: new RegExp(`^(?:${C_KEYWORDS}|class|namespace|template|typename|public|private|protected|virtual|override|final|new|delete|this|using|nullptr|try|catch|throw|operator|friend|constexpr|noexcept|std)$`),
  csharp: /^(?:abstract|as|async|await|base|bool|break|byte|case|catch|char|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|false|finally|float|for|foreach|get|if|in|int|interface|internal|is|lock|long|namespace|new|null|object|out|override|params|private|protected|public|readonly|record|ref|return|sealed|set|short|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|using|var|virtual|void|while|yield)$/,
};
// 제어문 키워드: Confluence는 같은 파랑에 굵게 표시한다(return·if 등). 자료형(int 등)은 보통 굵기
const CONTROL = /^(?:return|if|else|elif|for|foreach|while|do|switch|case|break|continue|goto|default|try|catch|except|finally|throw|raise|yield|await|match|loop|then|fi|done|esac)$/;
export function codeTokens(text, language) {
  let lang = aliases[language?.toLowerCase()] || language?.toLowerCase();
  if (!lang || lang === 'auto') {
    lang = /^\s*[{[]/.test(text) && /"[^"\n]+"\s*:/.test(text) ? 'json'
      : /\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\b[\s\S]*\bSET)\b/i.test(text) ? 'sql'
        : /^\s*(?:def|class)\s+\w+.*:\s*$|^\s*(?:from\s+\S+\s+)?import\s+\w+\s*$|^\s*elif\b/m.test(text) ? 'python'
          : /\bfn\s+\w+\s*[(<]|\blet\s+mut\b|\bimpl\b.*\{|println!/.test(text) ? 'rust'
            : /^\s*using\s+System\b|\bnamespace\s+[\w.]+\s*[{;]|\bpublic\s+(?:class|static|void)\b|Console\.Write/m.test(text) ? 'csharp'
              : /#include\s*<(?:iostream|vector|string|memory|map)>|\bstd::|\bclass\s+\w+\s*[:{]|\btemplate\s*</.test(text) ? 'cpp'
                : /#include\s*[<"]|\bprintf\s*\(|\bint\s+main\s*\(/.test(text) ? 'c'
                  : /^#!.*(?:bash|sh)|\$[\w{(]|^\s*(?:echo|export|sudo)\s/m.test(text) ? 'bash' : 'javascript';
  }
  if (!HIGHLIGHTED.includes(lang)) return [];
  // 문자열과 주석을 먼저 소비하므로 내부의 키워드를 다시 강조하지 않는다.
  const cLike = ['c', 'cpp'].includes(lang);
  const pattern = lang === 'python'
    ? /#[^\n]*|(?:[rbfuRBFU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g
    : cLike
      ? /(?<=^[ \t]*#[ \t]*include[ \t]*)<[^>\n]*>|^[ \t]*#[ \t]*\w+|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?[fFlLuU]*\b|\b[A-Za-z_]\w*\b/gm
    : lang === 'csharp'
      ? /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[@$]{1,2}"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?[fFdDmMlLuU]*\b|\b[A-Za-z_]\w*\b/g
    : lang === 'sql'
    ? /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*'|"(?:""|[^"])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g
    : lang === 'bash'
      ? /#[^\n]*|"(?:\\.|[^"\\])*"|'[^']*'|\$\{[^}]*\}|\$\w+|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g
      : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
  const tokens = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const kind = cLike && /^\s*#/.test(value) ? 'meta' // 전처리 지시문 (#include 등) — Confluence는 기본 글자색
      : cLike && value.startsWith('<') ? 'string' // #include <헤더>
      : /^(?:\/\/|\/\*|--|#)/.test(value) ? 'comment'
      : /^(?:[rbfuRBFU]{1,2})?["'`]|^[@$]{1,2}"/.test(value) ? (lang === 'json' && /^\s*:/.test(text.slice(match.index + value.length)) ? 'attr' : 'string')
        : /^\d/.test(value) ? 'number'
          : /^(?:true|false|null|undefined)$/i.test(value) ? 'literal'
            : lang === 'bash' && value.startsWith('$') ? 'variable'
              : keywords[lang]?.test(value) ? 'keyword' : null;
    if (!kind) continue;
    const from = match.index;
    if (kind === 'keyword' && CONTROL.test(value)) { tokens.push({ from, to: from + value.length, kind: 'control' }); continue; }
    // 문자열 안 이스케이프(\n 등)는 따로 색칠한다 (토큰은 겹치면 안 되므로 문자열을 조각낸다)
    if (kind === 'string' && value.includes('\\')) {
      let last = 0;
      for (const m of value.matchAll(/\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[0-7]{1,3}|.)/g)) {
        if (m.index > last) tokens.push({ from: from + last, to: from + m.index, kind: 'string' });
        tokens.push({ from: from + m.index, to: from + m.index + m[0].length, kind: 'escape' });
        last = m.index + m[0].length;
      }
      if (last < value.length) tokens.push({ from: from + last, to: from + value.length, kind: 'string' });
      continue;
    }
    tokens.push({ from, to: from + value.length, kind });
  }
  return tokens;
}

export const HighlightedCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      language: {
        default: null,
        rendered: false,
        parseHTML: (element) => (element.querySelector('code')?.getAttribute('class') || '')
          .split(/\s+/).find((name) => name.startsWith('language-'))?.slice(9) || null,
      },
      // 보기 화면에서 처음에 접힌 채로 보일지 (편집기에서 정한다)
      collapsed: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
      },
      // 긴 줄을 접어서 보여줄지, 줄 번호를 붙일지 (플로팅 도구 모음에서 바꾼다)
      wrap: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-wrap') === 'true',
      },
      lineNumbers: {
        default: true,
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-line-numbers') !== 'false',
      },
    };
  },
  renderHTML({ node }) {
    const text = node.textContent;
    const parts = []; let offset = 0;
    for (const token of codeTokens(text, node.attrs.language)) {
      if (token.from > offset) parts.push(text.slice(offset, token.from));
      parts.push(['span', { class: `hljs-${token.kind}` }, text.slice(token.from, token.to)]);
      offset = token.to;
    }
    if (offset < text.length) parts.push(text.slice(offset));
    const preAttrs = {};
    if (node.attrs.collapsed) preAttrs['data-collapsed'] = 'true';
    if (node.attrs.wrap) preAttrs['data-wrap'] = 'true';
    preAttrs['data-line-numbers'] = String(node.attrs.lineNumbers);
    if (node.attrs.wrap) preAttrs.class = 'code-wrap';
    return ['pre', preAttrs,
      ['code', node.attrs.language ? { class: `language-${node.attrs.language}` } : {}, ...parts]];
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), new Plugin({
      props: { decorations(state) {
        const decorations = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'codeBlock') return;
          for (const t of codeTokens(node.textContent, node.attrs.language)) {
            decorations.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: `hljs-${t.kind}` }));
          }
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      } },
    })];
  },
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'code-block';

      // 보기: 머리줄을 눌러 접기·펼치기 (저장하지 않는 화면 상태)
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'code-block-head';
      head.contentEditable = 'false';
      let open = !node.attrs.collapsed;
      const body = document.createElement('div');
      body.className = 'code-body';
      const gutter = document.createElement('div');
      gutter.className = 'code-gutter';
      gutter.contentEditable = 'false';
      gutter.hidden = true;
      const pre = document.createElement('pre');
      const code = pre.appendChild(document.createElement('code'));
      body.append(gutter, pre);
      const labelOf = (n) => {
        const lang = n.attrs.language || '';
        const name = codeLanguages.find(([v]) => v === lang)?.[1] || lang || '코드';
        const lines = n.textContent ? n.textContent.split('\n').length : 0;
        return `${name} · ${lines}줄`;
      };
      const paint = (n) => {
        // Confluence처럼 머리줄 없이 — '보기에서 접어 두기'를 켠 블록만 보기 화면에 접기/펼치기 줄을 둔다
        head.hidden = editor.isEditable || !n.attrs.collapsed;
        const shown = editor.isEditable || open;
        pre.hidden = !shown;
        gutter.hidden = !shown || !n.attrs.lineNumbers;
        body.hidden = !shown;
        dom.classList.toggle('is-collapsed', !shown);
        dom.classList.toggle('has-line-numbers', !!n.attrs.lineNumbers);
        pre.classList.toggle('code-wrap', !!n.attrs.wrap);
        head.textContent = shown ? `▾ 코드 접기` : `▸ ${labelOf(n)} — 펼치기`;
        head.setAttribute('aria-expanded', String(shown));
      };
      // 줄 번호 거터 — 코드 내용이 바뀌면 줄 수만큼 다시 만든다
      const paintGutter = (n) => {
        if (!n.attrs.lineNumbers) { gutter.replaceChildren(); return; }
        const count = Math.max(1, n.textContent ? n.textContent.split('\n').length : 1);
        if (gutter.childElementCount === count) return;
        gutter.replaceChildren(...Array.from({ length: count }, (_, i) => {
          const line = document.createElement('span');
          line.textContent = String(i + 1);
          return line;
        }));
      };
      head.addEventListener('click', () => { open = !open; paint(node); });

      const sync = (n) => {
        const language = n.attrs.language || '';
        code.className = language ? `language-${language}` : '';
        paintGutter(n);
        paint(n);
      };
      sync(node);
      dom.append(head, body);
      return {
        dom, contentDOM: code,
        update(n) {
          if (n.type !== node.type) return false;
          if (n.attrs.collapsed !== node.attrs.collapsed) open = !n.attrs.collapsed;
          node = n; sync(n); return true;
        },
        stopEvent: (event) => head.contains(event.target),
        ignoreMutation: (mutation) => mutation.type !== 'selection' && !code.contains(mutation.target),
      };
    };
  },
});
