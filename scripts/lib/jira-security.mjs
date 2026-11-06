// GET-only metadata import. Load a complete snapshot before replacing membership.
export function securityMember(member) {
  const h = member.holder ?? {};
  const kind = ({ group: 'group', projectrole: 'role', user: 'user', reporter: 'reporter', assignee: 'assignee', projectlead: 'projectLead' })[h.type?.toLowerCase()];
  if (!kind) return null;
  return { levelId: String(member.issueSecurityLevelId), kind, value: String(h.parameter ?? h.value ?? '') };
}
export async function importSecurity({ get, query, project }) {
  // A failed request aborts the import; never interpret a permission error as an empty scheme.
  const scheme = await get(`/rest/api/3/project/${encodeURIComponent(project.key)}/issuesecuritylevelscheme`);
  if (!scheme?.id) {
    await query('UPDATE jira_projects SET security_scheme_id = NULL WHERE id = $1', [project.id]);
    return;
  }
  const detail = await get(`/rest/api/3/issuesecurityschemes/${encodeURIComponent(scheme.id)}`);
  const members = [];
  let startAt = 0;
  while (true) {
    const page = await get(`/rest/api/3/issuesecurityschemes/level/member?schemeId=${encodeURIComponent(scheme.id)}&startAt=${startAt}&maxResults=100`);
    members.push(...(page.values ?? []));
    startAt += (page.values ?? []).length;
    if (page.isLast || startAt >= (page.total ?? 0)) break;
    if (!page.values?.length) throw new Error('Incomplete security member pagination');
  }
  // Stale grants must not survive an interrupted refresh. No grants is fail-closed.
  await query('DELETE FROM jira_security_members WHERE level_id IN (SELECT id FROM jira_security_levels WHERE scheme_id = $1)', [String(scheme.id)]);
  for (const level of detail.levels ?? []) {
    await query(`INSERT INTO jira_security_levels (id, scheme_id, name, description) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET scheme_id=EXCLUDED.scheme_id, name=EXCLUDED.name, description=EXCLUDED.description`,
    [String(level.id), String(scheme.id), level.name, level.description ?? null]);
    await query('DELETE FROM jira_security_members WHERE level_id = $1', [String(level.id)]);
  }
  for (const member of members) {
    const m = securityMember(member);
    if (!m) { console.warn('[security] Unsupported member type; grant ignored'); continue; }
    if (m.kind === 'group' && !(await query('SELECT 1 FROM groups WHERE name = $1', [m.value])).rows.length) {
      console.warn('[security] Unmapped source group; access remains restricted to administrators');
      continue;
    }
    await query('INSERT INTO jira_security_members (level_id, kind, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [m.levelId, m.kind, m.value]);
  }
  await query('INSERT INTO jira_security_schemes (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name', [String(scheme.id), detail.name ?? scheme.name]);
  await query('UPDATE jira_projects SET security_scheme_id = $2 WHERE id = $1', [project.id, String(scheme.id)]);
}
