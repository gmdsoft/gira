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
      ? /^[ \t]*#[ \t]*\w+|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?[fFlLuU]*\b|\b[A-Za-z_]\w*\b/gm
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
    const kind = cLike && /^\s*#/.test(value) ? 'keyword' // 전처리 지시문 (#include 등)
      : /^(?:\/\/|\/\*|--|#)/.test(value) ? 'comment'
      : /^(?:[rbfuRBFU]{1,2})?["'`]|^[@$]{1,2}"/.test(value) ? (lang === 'json' && /^\s*:/.test(text.slice(match.index + value.length)) ? 'attr' : 'string')
        : /^\d/.test(value) ? 'number'
          : /^(?:true|false|null|undefined)$/i.test(value) ? 'literal'
            : lang === 'bash' && value.startsWith('$') ? 'variable'
              : keywords[lang]?.test(value) ? 'keyword' : null;
    if (kind) tokens.push({ from: match.index, to: match.index + value.length, kind });
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
    return ['pre', node.attrs.collapsed ? { 'data-collapsed': 'true' } : {},
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
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'code-block';
      const setAttr = (name, value) => {
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, name, value));
      };

      // 편집: 언어 선택 + '보기에서 접어 두기'
      const bar = document.createElement('div');
      bar.className = 'code-block-bar';
      bar.contentEditable = 'false';
      const select = document.createElement('select');
      select.setAttribute('aria-label', '코드 블록 언어');
      select.add(new Option('자동 감지', ''));
      for (const [value, label] of codeLanguages) select.add(new Option(label, value));
      select.addEventListener('change', () => setAttr('language', select.value || null));
      const foldLabel = document.createElement('label');
      foldLabel.className = 'code-block-fold-opt';
      const fold = document.createElement('input');
      fold.type = 'checkbox';
      fold.addEventListener('change', () => setAttr('collapsed', fold.checked));
      foldLabel.append(fold, ' 보기에서 접어 두기');
      bar.append(select, foldLabel);

      // 보기: 머리줄을 눌러 접기·펼치기 (저장하지 않는 화면 상태)
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'code-block-head';
      head.contentEditable = 'false';
      let open = !node.attrs.collapsed;
      const pre = document.createElement('pre');
      const code = pre.appendChild(document.createElement('code'));
      const labelOf = (n) => {
        const lang = n.attrs.language || '';
        const name = codeLanguages.find(([v]) => v === lang)?.[1] || lang || '코드';
        const lines = n.textContent ? n.textContent.split('\n').length : 0;
        return `${name} · ${lines}줄`;
      };
      const paint = (n) => {
        const editing = editor.isEditable;
        bar.hidden = !editing;
        head.hidden = editing;
        const shown = editing || open;
        pre.hidden = !shown;
        dom.classList.toggle('is-collapsed', !shown);
        head.textContent = `${shown ? '▾' : '▸'} ${labelOf(n)}`;
        head.setAttribute('aria-expanded', String(shown));
      };
      head.addEventListener('click', () => { open = !open; paint(node); });

      const sync = (n) => {
        const language = n.attrs.language || '';
        if (![...select.options].some((o) => o.value === language)) select.add(new Option(language, language));
        select.value = language;
        fold.checked = !!n.attrs.collapsed;
        code.className = language ? `language-${language}` : '';
        paint(n);
      };
      sync(node);
      dom.append(bar, head, pre);
      return {
        dom, contentDOM: code,
        update(n) {
          if (n.type !== node.type) return false;
          if (n.attrs.collapsed !== node.attrs.collapsed) open = !n.attrs.collapsed;
          node = n; sync(n); return true;
        },
        stopEvent: (event) => bar.contains(event.target) || head.contains(event.target),
        ignoreMutation: (mutation) => mutation.type !== 'selection' && !code.contains(mutation.target),
      };
    };
  },
});
