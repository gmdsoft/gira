import { mountMermaid } from './mermaid-view.js';

export const mermaidExamples = [
  ['흐름도', 'flowchart TD\n  A[시작] --> B{확인}\n  B -->|예| C[완료]\n  B -->|아니오| A'],
  ['시퀀스', 'sequenceDiagram\n  participant U as 사용자\n  participant S as 서버\n  U->>S: 요청\n  S-->>U: 응답'],
  ['간트', 'gantt\n  title 개발 일정\n  dateFormat YYYY-MM-DD\n  section 개발\n  설계 :2026-11-01, 3d\n  구현 :2026-11-04, 5d'],
  ['클래스', 'classDiagram\n  Animal <|-- Duck\n  Animal : +int age\n  Duck : +swim()'],
  ['상태', 'stateDiagram-v2\n  [*] --> 대기\n  대기 --> 진행: 시작\n  진행 --> 완료\n  완료 --> [*]'],
  ['ER', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    int id PK\n    string name\n  }\n  ORDER {\n    int id PK\n    int customerId FK\n  }'],
];

export function mermaidEditorView({ node, editor, getPos }) {
  const dom = document.createElement('div');
  dom.className = 'mermaid-editor code-block';
  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-toolbar';
  toolbar.contentEditable = 'false';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Mermaid 다이어그램');
  const examples = document.createElement('select');
  examples.setAttribute('aria-label', 'Mermaid 예시');
  examples.append(new Option('예시 ▾', ''));
  mermaidExamples.forEach(([label], i) => examples.append(new Option(label, String(i))));
  examples.addEventListener('change', () => {
    if (examples.value === '') return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const text = mermaidExamples[Number(examples.value)][1];
    editor.view.dispatch(editor.state.tr.replaceWith(pos + 1, pos + node.nodeSize - 1, editor.schema.text(text)));
    examples.value = '';
  });
  toolbar.append(examples);
  const button = (label, action) => {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label;
    el.addEventListener('click', action); toolbar.append(el); return el;
  };
  let enabled = true;
  const toggle = button('미리보기 끄기', () => {
    enabled = !enabled; preview.hidden = !enabled;
    toggle.textContent = enabled ? '미리보기 끄기' : '미리보기 켜기';
    toggle.setAttribute('aria-pressed', String(enabled));
    schedule();
  });
  toggle.setAttribute('aria-pressed', 'true');
  const copy = button('코드 복사', async () => {
    try { await navigator.clipboard.writeText(node.textContent); copy.textContent = '복사됨'; }
    catch { copy.textContent = '복사 실패: 코드를 선택해 복사하세요'; }
  });
  button('삭제', () => {
    const pos = getPos();
    if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  });
  const body = document.createElement('div'); body.className = 'code-body';
  const gutter = document.createElement('div'); gutter.className = 'code-gutter';
  gutter.contentEditable = 'false'; gutter.setAttribute('aria-hidden', 'true');
  const pre = document.createElement('pre');
  const code = document.createElement('code'); code.setAttribute('aria-label', 'Mermaid 코드');
  pre.append(code); body.append(gutter, pre);
  const preview = document.createElement('div'); preview.contentEditable = 'false';
  dom.append(toolbar, body, preview);
  let timer, cleanup;
  const schedule = () => {
    clearTimeout(timer); cleanup?.(); cleanup = undefined;
    if (!enabled) return;
    timer = setTimeout(() => {
      preview.replaceChildren();
      cleanup = mountMermaid(preview, node.textContent, node.attrs);
    }, 500);
  };
  const sync = () => {
    const count = node.textContent.split('\n').length;
    gutter.replaceChildren(...Array.from({ length: count }, (_, i) => {
      const line = document.createElement('span'); line.textContent = String(i + 1); return line;
    }));
    copy.textContent = '코드 복사'; schedule();
  };
  sync();
  return {
    dom, contentDOM: code,
    update(next) {
      if (next.type !== node.type) return false;
      const changed = !next.eq(node); node = next;
      if (changed) sync();
      return true;
    },
    stopEvent: event => toolbar.contains(event.target) || preview.contains(event.target),
    ignoreMutation: mutation => mutation.type !== 'selection' && !code.contains(mutation.target),
    destroy() { clearTimeout(timer); cleanup?.(); },
  };
}
