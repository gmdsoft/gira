// 글 속 주소를 링크로: Gira 댓글·설명(ADF)과 Gonfluence 댓글(ProseMirror)이 함께 쓴다 (서버·웹 공용, 의존성 없음)
//  - http(s):// 와 www. 로 시작하는 주소
//  - 끝에 붙은 문장부호(. , ; : ! ? 따옴표)와 짝이 안 맞는 닫는 괄호는 링크에서 뺀다
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

function trimTail(url) {
  let u = url;
  for (;;) {
    const last = u.at(-1);
    if (/[.,;:!?'"]/.test(last)) { u = u.slice(0, -1); continue; }
    if (last === ')' && (u.match(/\(/g) ?? []).length < (u.match(/\)/g) ?? []).length) { u = u.slice(0, -1); continue; }
    if (last === ']' && (u.match(/\[/g) ?? []).length < (u.match(/\]/g) ?? []).length) { u = u.slice(0, -1); continue; }
    break;
  }
  return u;
}

// 'a https://x.y b' → [{ text: 'a ' }, { text: 'https://x.y', href: 'https://x.y' }, { text: ' b' }]
export function linkParts(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const url = trimTail(m[0]);
    if (!url || url.length < 5) continue;
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    last = m.index + url.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length ? out : [{ text: s }];
}

// 문서(ADF 또는 ProseMirror JSON)의 text 노드 중 링크·코드 표시가 없는 것을 쪼개 링크 표시를 붙인 새 문서
// (코드 블록 안 글자는 그대로)
export function linkifyDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'codeBlock' || node.type === 'code_block') return node;
    if (!Array.isArray(node.content)) return node;
    const content = [];
    for (const child of node.content) {
      if (child?.type === 'text' && child.text && !(child.marks ?? []).some((m) => m.type === 'link' || m.type === 'code')) {
        for (const p of linkParts(child.text)) {
          content.push(p.href
            ? { ...child, text: p.text, marks: [...(child.marks ?? []), { type: 'link', attrs: { href: p.href } }] }
            : { ...child, text: p.text });
        }
      } else content.push(walk(child));
    }
    return { ...node, content };
  };
  return walk(doc);
}

// 줄 단위 글 → ADF 문서 (Gira 댓글·설명 입력용), 주소는 링크로
export function textToAdf(text) {
  return linkifyDoc({
    type: 'doc', version: 1,
    content: String(text ?? '').split('\n').map((line) => ({
      type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
    })),
  });
}
