// 보기 전용 렌더러. Mermaid 자체는 첫 다이어그램을 만났을 때만 내려받는다.
export const MAX_MERMAID_LENGTH = 20_000;
export const MERMAID_TIMEOUT = 8_000;
let sequence = 0;
let queue = Promise.resolve();

export function validateMermaid(source) {
  if (source.length > MAX_MERMAID_LENGTH) throw new Error('원문은 20,000자까지 표시할 수 있습니다');
  // 문서가 초기화 설정을 덮어쓰거나 콜백·링크를 등록하지 못하게 한다.
  if (/%%\s*\{|^\s*---\s*$|^\s*(?:click|link)\s/im.test(source)) {
    throw new Error('설정 지시문과 클릭 동작은 사용할 수 없습니다');
  }
  return source;
}

export function mountMermaid(host, source, { image, caption, size } = {}) {
  host.className = 'mermaid-view';
  if (size) host.dataset.size = size;
  const output = document.createElement('div');
  output.className = 'mermaid-output';
  const status = document.createElement('div');
  status.className = 'mermaid-status';
  status.setAttribute('role', 'status');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '원문 보기';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  details.append(summary, pre);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '코드 복사';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(source); copy.textContent = '복사됨'; }
    catch { copy.textContent = '복사 실패: 원문을 선택해 복사하세요'; details.open = true; }
  });
  host.append(output, status);
  if (source) host.append(details, copy);
  if (caption) {
    const label = document.createElement('div');
    label.className = 'mermaid-caption'; label.textContent = caption; host.append(label);
  }
  let generation = 0;
  let disposed = false;
  const fallback = () => {
    output.replaceChildren();
    // 모델의 PNG 대체 이미지만 허용한다.
    if (/^data:image\/png;base64,[a-z\d+/=\s]+$/i.test(image || '')) {
      const img = document.createElement('img'); img.src = image; img.alt = caption || 'Mermaid 다이어그램'; output.append(img);
    }
  };
  const render = () => {
    const current = ++generation;
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
    if (!source.trim()) { fallback(); return; }
    status.textContent = '다이어그램을 그리는 중…';
    let timer;
    const work = queue.then(async () => {
      if (disposed || current !== generation) return;
      validateMermaid(source);
      const { default: mermaid } = await import('mermaid');
      if (disposed || current !== generation) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme,
        htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: MAX_MERMAID_LENGTH, maxEdges: 500,
        suppressErrorRendering: true });
      const scratch = document.createElement('div');
      scratch.className = 'mermaid-scratch';
      document.body.append(scratch);
      try {
        const { svg } = await mermaid.render(`gonf-mermaid-${++sequence}`, source, scratch);
        if (!disposed && current === generation) {
          output.innerHTML = svg;
          // bindFunctions는 호출하지 않는다. 링크도 비활성화한다.
          output.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.removeAttribute('xlink:href'); });
          status.textContent = '';
        }
      } finally { scratch.remove(); }
    });
    queue = work.catch(() => {});
    Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('렌더링 시간 제한을 초과했습니다')), MERMAID_TIMEOUT);
    })]).catch(error => {
      if (disposed || current !== generation) return;
      generation++; // 시간 초과 후 도착하는 결과는 버린다.
      fallback(); details.open = true;
      const message = String(error?.message || error).split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 240);
      status.textContent = `다이어그램을 그릴 수 없습니다: ${message}`;
    }).finally(() => clearTimeout(timer));
  };
  const observer = new MutationObserver(() => {
    if (!host.isConnected) { observer.disconnect(); return; }
    render();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // 접힌 펼치기 안의 다이어그램도 펼쳐진 너비로 다시 계산한다.
  const expansions = [];
  for (let parent = host.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') { parent.addEventListener('toggle', render); expansions.push(parent); }
  }
  render();
  return () => { disposed = true; generation++; observer.disconnect(); expansions.forEach(el => el.removeEventListener('toggle', render)); };
}

// 프레젠테이션과 포함 문서처럼 HTML로 표시하는 보기에도 적용한다.
export function hydrateMermaid(root) {
  const cleanups = [];
  for (const pre of root?.querySelectorAll('pre.mermaid-src') || []) {
    const host = document.createElement('div');
    const attrs = { image: pre.dataset.mermaidImage, caption: pre.dataset.mermaidCaption, size: pre.dataset.size };
    pre.replaceWith(host);
    cleanups.push(mountMermaid(host, pre.textContent, attrs));
  }
  return () => cleanups.forEach(cleanup => cleanup());
}
