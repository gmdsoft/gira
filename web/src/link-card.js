// 링크 카드(문서·이슈): 제목·상태를 볼 때마다 새로 가져온다. 문서에 저장된 제목·상태는 조회 실패 시의 대체 표시다.
// 이슈는 /api/gira/issues/:key(이슈 카드와 같은 조회 — Gira가 사용자 권한을 확인), 문서는 /api/content/:id.
const issueKeyOf = (href) => /\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?(?:[?#]|$)/.exec(href || '')?.[1] ?? null;
const pageIdOf = (href) => (/\/s\/[^/]+\/p\/(\d+)/.exec(href || '') || /\/pages\/(\d+)/.exec(href || ''))?.[1] ?? null;

export function hydrateLinkCard(el) {
  el.dataset.hydrated = '1';
  const controller = new AbortController();
  const href = el.getAttribute('href') || '';
  const kind = el.dataset.kind;
  const key = kind === 'issue' ? issueKeyOf(href) : null;
  const id = kind !== 'issue' ? pageIdOf(href) : null;
  const url = key ? `/api/gira/issues/${encodeURIComponent(key)}` : id ? `/api/content/${encodeURIComponent(id)}` : null;
  if (!url) return () => {};
  fetch(url, { cache: 'no-store', signal: controller.signal }).then(async (res) => {
    if (!res.ok) return;
    const data = await res.json();
    if (controller.signal.aborted) return;
    const title = key ? (data.summary ? `${key} · ${data.summary}` : null) : data.title;
    if (!title) return;
    const strong = el.querySelector('strong');
    if (strong) strong.textContent = title;
    let status = el.querySelector('.link-card-status');
    const text = key ? data.status : '';
    if (!text) { status?.remove(); return; }
    if (!status) { status = document.createElement('span'); el.append(status); }
    status.className = `link-card-status jira-issue-status cat-${data.statusCategory || 'new'}`;
    status.textContent = text;
  }).catch(() => { /* 권한 없음·연결 실패: 저장된 제목·상태 그대로 */ });
  return () => controller.abort();
}
