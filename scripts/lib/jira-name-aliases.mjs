// 상태·이슈 유형의 번역 전 이름(untranslatedName)을 alias로 저장한다 (GIRA-67)
// 원본 API는 계정 언어로 번역한 이름(진행 중)을 주지만, 원본 빠른 필터·저장 필터 JQL은
// 번역 전 이름(In Progress)으로 저장돼 있다. JQL은 name과 alias를 모두 비교한다. 원본은 GET만.
export async function syncNameAliases(get, query) {
  const out = {};
  for (const [path, table] of [['/rest/api/3/status', 'jira_statuses'], ['/rest/api/3/issuetype', 'jira_issue_types']]) {
    const list = await get(path);
    let n = 0;
    for (const x of list ?? []) {
      const alias = x.untranslatedName && x.untranslatedName !== x.name ? x.untranslatedName : null;
      const r = await query(`UPDATE ${table} SET alias = $2 WHERE id = $1 AND alias IS DISTINCT FROM $2`, [x.id, alias]);
      n += r.rowCount ?? 0;
    }
    out[table] = n;
  }
  return out;
}
