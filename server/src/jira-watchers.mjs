export async function addWatcher(query, issueId, userId) {
  if (!userId) return;
  await query(`INSERT INTO jira_issue_watchers (issue_id, user_id) VALUES ($1, $2)
    ON CONFLICT (issue_id, user_id) DO UPDATE SET created_at = clock_timestamp()`, [issueId, userId]);
}
export async function watchIssuePeople(query, issueId) {
  const { rows } = await query('SELECT reporter_id, assignee_id FROM jira_issues WHERE id = $1', [issueId]);
  for (const id of new Set([rows[0]?.reporter_id, rows[0]?.assignee_id])) await addWatcher(query, issueId, id);
}
