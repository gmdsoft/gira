export function remoteLinkRow(issueId, link) {
  if (link.id == null || !link.object?.url) throw new Error('원격 링크 id 또는 URL 누락');
  return [issueId, link.object.url, link.object.title ?? null, String(link.id),
    link.application?.type ?? null, link.application?.name ?? null,
    link.relationship ?? null, link.object.icon?.url16x16 ?? null];
}

export async function upsertRemoteLink(query, issueId, link) {
  await query(`INSERT INTO jira_web_links
    (issue_id, url, title, source_id, app_type, app_name, relationship, icon_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (source_id) DO UPDATE SET url = EXCLUDED.url, title = EXCLUDED.title,
      app_type = EXCLUDED.app_type, app_name = EXCLUDED.app_name,
      relationship = EXCLUDED.relationship, icon_url = EXCLUDED.icon_url
    WHERE jira_web_links.issue_id = EXCLUDED.issue_id`, remoteLinkRow(issueId, link));
}

// 동일 이슈 범위를 전체/증분/소급 실행에서 공유. 원본 요청 동시 수는 최대 6.
export async function syncRemoteLinks(issues, { get, query }) {
  let next = 0, count = 0;
  await Promise.all(Array.from({ length: Math.min(6, issues.length) }, async () => {
    while (next < issues.length) {
      const issue = issues[next++];
      const links = await get(`/rest/api/3/issue/${encodeURIComponent(issue.id)}/remotelink`);
      if (!Array.isArray(links)) throw new Error('원격 링크 응답이 배열이 아닙니다');
      for (const link of links) await upsertRemoteLink(query, issue.id, link);
      // 성공한 조회에 한해서 원본에서 제거된 링크를 반영하고 로컬 링크는 보존한다.
      await query(`DELETE FROM jira_web_links WHERE issue_id = $1 AND source_id IS NOT NULL
        AND NOT (source_id = ANY($2::text[]))`, [issue.id, links.map(l => String(l.id))]);
      count += links.length;
    }
  }));
  return count;
}
