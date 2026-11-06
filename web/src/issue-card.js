// Gira 이슈 카드: [타입 아이콘] KEY: 제목 (테두리 칩) + 상태 표시. 제목·상태·타입은 문서에 저장하지 않고 볼 때마다 조회한다.
// 권한이 없거나 조회에 실패하면 키만 보인다.
import { TYPE_STYLES, typeKind } from './jira/type-icons.js';

const SVG = 'http://www.w3.org/2000/svg';
function typeIcon(name) {
  const st = TYPE_STYLES[typeKind(name)];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'jira-issue-icon');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-label', name);
  svg.style.color = st.color;
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', st.d); path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd'); path.setAttribute('clip-rule', 'evenodd');
  svg.append(path);
  return svg;
}

export function hydrateIssueCard(el) {
  el.dataset.hydrated = '1';
  const controller = new AbortController();
  fetch(`/api/gira/issues/${encodeURIComponent(el.dataset.issueKey)}`, {
    cache: 'no-store', signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) return;
    const issue = await res.json();
    if (controller.signal.aborted || !issue.summary) return;
    el.classList.add('jira-issue-card');
    el.textContent = '';
    el.append(typeIcon(issue.type || ''));
    const key = document.createElement('span');
    key.className = 'jira-issue-key';
    key.textContent = `${el.dataset.issueKey}: `;
    const title = document.createElement('span');
    title.className = 'jira-issue-title';
    title.textContent = issue.summary;
    el.append(key, title);
    el.title = `${el.dataset.issueKey}: ${issue.summary}${issue.status ? ` (${issue.status})` : ''}`;
    if (issue.status) {
      el.parentNode?.querySelector(`:scope > .jira-issue-status[data-for="${CSS.escape(el.dataset.issueKey)}"]`)?.remove();
      const status = document.createElement('span');
      status.className = `jira-issue-status cat-${issue.statusCategory || 'new'}`;
      status.dataset.for = el.dataset.issueKey;
      status.textContent = issue.status;
      el.after(status);
    }
  }).catch(() => { /* 권한 없음·연결 실패 시 키만 표시 */ });
  return () => controller.abort();
}
