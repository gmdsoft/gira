// GET 재시도는 jiraGet에 위임. 최초 이관 시각 이후의 로컬 관찰은 재실행에도 보존한다.
export async function syncWatchers(issues, { get, query, ensureUsers, uid }) {
  let next = 0, count = 0;
  await Promise.all(Array.from({ length: Math.min(6, issues.length) }, async () => {
    while (next < issues.length) {
      const issue = issues[next++];
      if (!issue.fields?.watches) continue;
      const { rows } = await query(`UPDATE jira_issues SET watchers_imported_at = COALESCE(watchers_imported_at, clock_timestamp())
        WHERE id = $1 RETURNING watchers_imported_at`, [issue.id]);
      const cutoff = rows[0].watchers_imported_at;
      let watchers = [];
      if (issue.fields.watches.watchCount > 0) {
        try { const data = await get(`/rest/api/3/issue/${encodeURIComponent(issue.id)}/watchers`);
          if (!Array.isArray(data.watchers)) throw new Error('관찰자 목록 누락');
          watchers = data.watchers;
        } catch (e) { if ([403, 404].includes(e.status)) continue; throw e; }
      }
      await ensureUsers(new Set(watchers.map(u => u.accountId).filter(Boolean)));
      const ids = [...new Set(watchers.map(uid).filter(Boolean))];
      // 한 문장으로 원본 교체. 로컬 행과 충돌하면 로컬 created_at을 유지한다.
      await query(`WITH removed AS (
        DELETE FROM jira_issue_watchers WHERE issue_id = $1 AND created_at < $3
          AND NOT (user_id = ANY($2::bigint[]))
      ) INSERT INTO jira_issue_watchers (issue_id, user_id, created_at)
        SELECT $1, unnest($2::bigint[]), $3::timestamptz - interval '1 millisecond'
        ON CONFLICT (issue_id, user_id) DO NOTHING`, [issue.id, ids, cutoff]);
      count += ids.length;
    }
  }));
  return count;
}
