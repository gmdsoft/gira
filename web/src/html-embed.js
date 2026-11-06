import { Node } from '@tiptap/core';
import { safeEmbedUrl, embedHeight, isolatedHtml } from '../../shared/html-embed.mjs';

function frameSpec(attrs) {
  const html = attrs.html != null;
  const src = safeEmbedUrl(attrs.src);
  if (!html && !src) return ['p', {}, '허용되지 않은 HTML 블록 주소입니다.'];
  return ['iframe', {
    title: 'HTML 블록', loading: 'lazy', referrerpolicy: 'no-referrer',
    width: '100%', height: String(embedHeight(attrs.height)),
    // URL도 정적 직렬화에서는 opaque로 유지: SSR에서는 서비스 origin을 알 수 없다.
    sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox',
    style: `display:block;width:100%;height:${embedHeight(attrs.height)}px;border:0`,
    ...(html ? { srcdoc: isolatedHtml(attrs.html) } : { src }),
  }];
}

export const HtmlEmbed = Node.create({
  name: 'htmlEmbed', group: 'block', atom: true,
  addAttributes: () => Object.fromEntries(Object.entries({ source: 'html', html: null, src: null, width: null, height: 400 })
    .map(([name, value]) => [name, { default: value, rendered: false }])),
  renderHTML: ({ node }) => ['div', { class: 'html-embed' }, frameSpec(node.attrs)],
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'html-embed';
      dom.contentEditable = 'false';
      const spec = frameSpec(node.attrs);
      const frame = document.createElement(spec[0]);
      for (const [key, value] of Object.entries(spec[1])) frame.setAttribute(key, value);
      if (typeof spec[2] === 'string') frame.textContent = spec[2];
      if (node.attrs.html == null && safeEmbedUrl(node.attrs.src)) {
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation');
      }
      dom.append(frame);
      if (editor.isEditable) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '원본 HTML 보기 (읽기 전용)';
        const code = document.createElement('textarea');
        code.readOnly = true;
        code.setAttribute('aria-label', '원본 HTML');
        code.value = node.attrs.html ?? node.attrs.src ?? '';
        code.style.cssText = 'width:100%;height:200px;font-family:monospace';
        details.append(summary, code);
        dom.append(details);
      }
      return { dom, stopEvent: () => true, ignoreMutation: () => true };
    };
  },
});
