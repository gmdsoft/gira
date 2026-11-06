// 코드 문자열만 토큰화한다. 원문과 language 속성은 저장 시 변경하지 않는다.
import CodeBlock from '@tiptap/extension-code-block';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const codeLanguages = [
  ['javascript', 'JavaScript'], ['sql', 'SQL'], ['json', 'JSON'], ['bash', 'Bash'],
  ['plaintext', '일반 텍스트'],
];
const aliases = { js: 'javascript', shell: 'bash', sh: 'bash', text: 'plaintext', plain: 'plaintext' };
const keywords = {
  javascript: /^(?:const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|throw|try|catch|typeof|this|of|in|default|switch|case|break|extends)$/,
  sql: /^(?:select|from|where|insert|into|values|update|set|delete|create|table|alter|drop|join|left|right|inner|outer|on|as|and|or|not|is|in|like|order|by|group|having|limit|asc|desc|distinct|union|with|primary|key)$/i,
  bash: /^(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|export|local|echo|printf|cd|exit|sudo)$/,
};
export function codeTokens(text, language) {
  let lang = aliases[language?.toLowerCase()] || language?.toLowerCase();
  if (!lang || lang === 'auto') {
    lang = /^\s*[{[]/.test(text) && /"[^"\n]+"\s*:/.test(text) ? 'json'
      : /\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\b[\s\S]*\bSET)\b/i.test(text) ? 'sql'
        : /^#!.*(?:bash|sh)|\$[\w{(]|^\s*(?:echo|export|sudo)\s/m.test(text) ? 'bash' : 'javascript';
  }
  if (!['javascript', 'sql', 'json', 'bash'].includes(lang)) return [];
  // 문자열과 주석을 먼저 소비하므로 내부의 키워드를 다시 강조하지 않는다.
  const pattern = lang === 'sql'
    ? /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*'|"(?:""|[^"])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g
    : lang === 'bash'
      ? /#[^\n]*|"(?:\\.|[^"\\])*"|'[^']*'|\$\{[^}]*\}|\$\w+|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g
      : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
  const tokens = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const kind = /^(?:\/\/|\/\*|--|#)/.test(value) ? 'comment'
      : /^["'`]/.test(value) ? (lang === 'json' && /^\s*:/.test(text.slice(match.index + value.length)) ? 'attr' : 'string')
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
    return ['pre', {}, ['code', node.attrs.language ? { class: `language-${node.attrs.language}` } : {}, ...parts]];
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
      const select = document.createElement('select');
      select.contentEditable = 'false';
      select.setAttribute('aria-label', '코드 블록 언어');
      select.add(new Option('자동 감지', ''));
      for (const [value, label] of codeLanguages) select.add(new Option(label, value));
      const pre = document.createElement('pre');
      const code = pre.appendChild(document.createElement('code'));
      const sync = (n) => {
        const language = n.attrs.language || '';
        if (![...select.options].some((o) => o.value === language)) select.add(new Option(language, language));
        select.value = language;
        select.disabled = !editor.isEditable;
        code.className = language ? `language-${language}` : '';
      };
      sync(node);
      select.addEventListener('change', () => {
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'language', select.value || null));
      });
      dom.append(select, pre);
      return {
        dom, contentDOM: code,
        update(n) { if (n.type !== node.type) return false; node = n; sync(n); return true; },
        stopEvent: (event) => select.contains(event.target),
        ignoreMutation: (mutation) => mutation.type !== 'selection' && !code.contains(mutation.target),
      };
    };
  },
});
