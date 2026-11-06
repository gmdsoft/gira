// 제목·상태는 문서에 저장하지 않고, 카드를 볼 때마다 조회한다.
export function hydrateIssueCard(el) {
  el.dataset.hydrated = '1';
  const controller = new AbortController();
  fetch(`/api/gira/issues/${encodeURIComponent(el.dataset.issueKey)}`, {
    cache: 'no-store', signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) return;
    const issue = await res.json();
    if (controller.signal.aborted) return;
    if (issue.summary) {
      const title = document.createElement('span');
      title.className = 'jira-issue-title';
      title.textContent = issue.summary;
      el.append(' ', title);
    }
    if (issue.status) {
      const status = document.createElement('span');
      status.className = 'status status-neutral';
      status.textContent = issue.status;
      el.append(' ', status);
    }
  }).catch(() => { /* 권한 없음·연결 실패 시 키만 표시 */ });
  return () => controller.abort();
}
