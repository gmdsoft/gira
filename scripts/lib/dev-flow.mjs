// 개발참여 이슈 자동 처리 흐름 (공용): 대상 판정 · 받는 사람 · 메일 대기열 · 이슈 기록
// 절차 문서: server/src/dev-agent/issue-flow.md
//
// 상태와 레이블로 단계를 나타낸다 (대상은 개발참여 챗봇이 등록한 이슈 = 레이블 dev-chat):
//   해야 할 일                         → process   : 분석 후 구현 (승인 필요·정보 부족이면 표시만 하고 멈춤)
//   needs-approval (+approval-requested 없음) → request-approval : 승인 담당자에게 메일 (자동, 에이전트 없이)
//   needs-approval + 승인 담당자(기본 담당자·관리자)의 '승인' 댓글 → approve : 레이블 정리 후 처리 대상으로
//   needs-info + 사람이 새 댓글         → process   : 답을 받았으니 다시 분석
//   agent-review(검토) + 사람이 새 댓글 → revise    : 추가 수정 요청 반영 / 검토 끝이면 완료 처리
//   완료 분류 + agent-review           → finalize  : 테스트 서버 중단 → develop 머지·푸시 (자동, 에이전트 없이)
// approved: 관리자가 승인한 이슈(에이전트가 다시 승인 요청하지 않는다)
// agent-running(처리 중) · agent-failed · merge-conflict · agent:human · 에픽은 건드리지 않는다.

export const AGENT_ACCOUNT = 'gira-agent';
export const L = {
  source: 'dev-chat', human: 'agent:human',
  running: 'agent-running', review: 'agent-review', failed: 'agent-failed', merged: 'agent-merged',
  approval: 'needs-approval', approvalAsked: 'approval-requested', approved: 'approved', info: 'needs-info', conflict: 'merge-conflict',
};

// 승인 댓글: '승인', '승인합니다', 'approve' … (부정·보류 표현이 섞이면 아님)
export const isApprovalText = (t) => /승인|approve/i.test(t ?? '') && !/미승인|승인\s*(안|않|불가|보류|취소)|반려|거절|보류|reject|not\s+approve/i.test(t ?? '');

// issue = { key, type, statusName, statusCategory, labels[], lastCommentByAgent: true|false|null, lastCommentApproves?: bool }
export function classify(issue) {
  const has = (l) => issue.labels.includes(l);
  if (!has(L.source) || has(L.human) || /에픽|epic/i.test(issue.type ?? '')) return null;
  if (has(L.running) || has(L.failed) || has(L.conflict)) return null;
  if (issue.statusCategory === 'done') return has(L.review) ? 'finalize' : null;
  const humanSpoke = issue.lastCommentByAgent === false;
  if (has(L.approval)) return !has(L.approvalAsked) ? 'request-approval' : issue.lastCommentApproves ? 'approve' : null;
  if (has(L.info)) return humanSpoke ? 'process' : null;
  if (has(L.review)) return humanSpoke ? 'revise' : null;
  if (issue.statusCategory === 'new' && issue.statusName === '해야 할 일') return 'process';
  return null;
}

// 처리 우선순위: 마무리·승인 요청(빠름) → 수정 요청(진행 중인 대화) → 새 이슈(우선순위·키 순)
const ACTION_RANK = { finalize: 0, approve: 1, 'request-approval': 1, revise: 2, process: 3 };
const PRIORITY_RANK = { Highest: 0, High: 1, Normal: 2, Medium: 2, Low: 3, Lowest: 4 };
export function orderActions(items) {
  const num = (k) => Number(String(k).split('-')[1]) || 0;
  return [...items].sort((a, b) => ACTION_RANK[a.action] - ACTION_RANK[b.action]
    || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || num(a.key) - num(b.key));
}

// GIRA 프로젝트의 열린(+검토 중 완료된) 개발참여 이슈와 마지막 댓글 작성자
export async function loadFlowIssues(query) {
  const { rows } = await query(
    `SELECT i.id, i.issue_key AS key, i.summary, i.priority, i.labels, i.reporter_id, i.updated_at, t.name AS type,
            (SELECT display_name FROM users WHERE id = i.assignee_id) AS assignee,
            (SELECT display_name FROM users WHERE id = i.reporter_id) AS reporter,
            s.name AS status_name, s.category AS status_category,
            (SELECT u.confluence_account_id = $1 FROM jira_comments c LEFT JOIN users u ON u.id = c.author_id
              WHERE c.issue_id = i.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS last_by_agent,
            -- 마지막 댓글이 승인 담당자(프로젝트 기본 담당자·사이트 관리자)가 쓴 것이면 그 글 (승인 판정용)
            (SELECT c.body_adf::text FROM jira_comments c JOIN users u ON u.id = c.author_id
              WHERE c.issue_id = i.id AND (u.id = p.default_assignee_id OR u.is_admin) AND u.confluence_account_id IS DISTINCT FROM $1
                AND c.id = (SELECT c2.id FROM jira_comments c2 WHERE c2.issue_id = i.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1)) AS last_approver_text
       FROM jira_issues i JOIN jira_projects p ON p.id = i.project_id AND p.key = 'GIRA'
       LEFT JOIN jira_statuses s ON s.id = i.status_id LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
      WHERE $2 = ANY(i.labels)`, [AGENT_ACCOUNT, L.source]);
  return rows.map((r) => ({
    id: r.id, key: r.key, summary: r.summary, priority: r.priority, labels: r.labels ?? [], reporterId: r.reporter_id,
    updatedAt: r.updated_at, assignee: r.assignee, reporter: r.reporter,
    type: r.type, statusName: r.status_name, statusCategory: r.status_category,
    lastCommentByAgent: r.last_by_agent == null ? null : !!r.last_by_agent,
    lastCommentApproves: isApprovalText(adfPlain(r.last_approver_text)),
  }));
}

// 댓글 ADF(JSON 글자) → 글자만
function adfPlain(json) {
  if (!json) return '';
  try { const out = []; const walk = (n) => { if (!n) return; if (n.type === 'text') out.push(n.text); (n.content ?? []).forEach(walk); }; walk(JSON.parse(json)); return out.join(' '); } catch { return ''; }
}

const realEmail = (e) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !/\.local$/i.test(e);

// 승인 담당자 = GIRA 프로젝트 기본 담당자. 없으면 할당·메일 없이 둔다(다른 사람에게 대신 보내지 않는다).
export async function defaultAssignee(query) {
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.email, u.confluence_account_id = $1 AS is_agent
       FROM jira_projects p JOIN users u ON u.id = p.default_assignee_id WHERE p.key = 'GIRA' AND u.active`, [AGENT_ACCOUNT]);
  const r = rows[0];
  return r ? { id: r.id, name: r.display_name, email: realEmail(r.email) ? r.email : null, isAgent: !!r.is_agent } : null;
}
export async function approverEmails(query) {
  const a = await defaultAssignee(query);
  return a?.email && !a.isAgent ? [a.email] : [];
}

export async function reporterEmail(query, issueKey) {
  const { rows } = await query(
    `SELECT u.email FROM jira_issues i JOIN users u ON u.id = i.reporter_id WHERE i.issue_key = $1 AND u.active`, [issueKey]);
  return realEmail(rows[0]?.email) ? rows[0].email : null;
}

export const giraBase = (env = process.env) => (env.GIRA_PUBLIC_URL || env.GIRA_URL || 'http://localhost:3002').replace(/\/$/, '');
export const issueUrl = (key, env = process.env) => `${giraBase(env)}/browse/${encodeURIComponent(key)}`;

// 메일 대기열에 넣는다 — 실제 발송은 Gira 서버(3002)의 알림 발송 작업이 한다(재시도 포함)
export async function enqueueMail(query, { to, subject, url, note = null, links = null, event = 'issue.devflow', issueId = null, projectId = null }) {
  const target = [...new Set((Array.isArray(to) ? to : [to]).filter(realEmail))].join(',');
  if (!target) return false;
  await query(
    `INSERT INTO notify_outbox (resource_type, resource_id, event, channel, target, subject, url, note, links)
     VALUES ('project', $1, $2, 'email', $3, $4, $5, $6, $7)`,
    [projectId, event, target, subject, url, note, links ? JSON.stringify(links) : null]);
  return true;
}
