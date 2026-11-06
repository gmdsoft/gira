// GIRA-71: 원본 작업 로그 이관 — GET만. 검색 결과(fields.worklog)에 전부 들어 있으면 그대로, 잘렸으면 이슈별로 다시 받는다.
export function worklogRows(issueId, worklogs, uid) {
  return (worklogs ?? []).filter((w) => w?.id && w.timeSpentSeconds > 0).map((w) => ({
    id: Number(w.id), issueId: Number(issueId), authorId: uid(w.author), started: w.started ?? w.created,
    seconds: w.timeSpentSeconds, comment: w.comment && typeof w.comment === 'object' ? w.comment : null,
    created: w.created ?? null, updated: w.updated ?? null,
  }));
}

export async function syncWorklogs(issues, { get, query, ensureUsers, uid }) {
  let count = 0;
  for (const iss of issues) {
    const wl = iss.fields?.worklog;
    if (!wl?.total) continue;
    let list = wl.worklogs ?? [];
    if ((wl.total ?? 0) > list.length) list = (await get(`/rest/api/3/issue/${iss.id}/worklog?maxResults=5000`)).worklogs ?? [];
    await ensureUsers(new Set(list.map((w) => w.author?.accountId).filter(Boolean)));
    for (const r of worklogRows(iss.id, list, uid)) {
      await query(`INSERT INTO jira_worklogs (id, issue_id, author_id, started_at, time_spent_seconds, comment_adf, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),COALESCE($8, now()))
        ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at, time_spent_seconds = EXCLUDED.time_spent_seconds,
          comment_adf = EXCLUDED.comment_adf, updated_at = EXCLUDED.updated_at
        WHERE jira_worklogs.issue_id = EXCLUDED.issue_id`,
        [r.id, r.issueId, r.authorId, r.started, r.seconds, r.comment ? JSON.stringify(r.comment) : null, r.created, r.updated]);
      count++;
    }
  }
  if (count) console.log(`  작업 로그 ${count}건`);
  return count;
}
