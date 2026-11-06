#!/usr/bin/env node
// 사용법: node scripts/jira-import-filters.mjs (전체 저장 필터·대시보드)
// 원본 API는 GET만. 이관된 사용자에 매칭되지 않는 소유자의 공유 행도 보존한다.
import { query, closeDb, configureDb } from '../server/src/db.mjs';
try { process.loadEnvFile('.env'); } catch {}
configureDb({ url: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const site = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const auth = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
async function get(path) {
  const r = await fetch(site + path, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return r.json();
}
async function pages(path) {
  const rows = [];
  for (let startAt = 0;;) {
    const p = await get(`${path}${path.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=50`);
    const values = p.values ?? []; rows.push(...values); startAt += values.length;
    if (!values.length || p.isLast || (p.total != null && startAt >= p.total)) return rows;
  }
}
async function owner(accountId) {
  if (!accountId) return null;
  return (await query('SELECT id FROM users WHERE confluence_account_id=$1', [accountId])).rows[0]?.id ?? null;
}
try {
  for (const f of await pages('/rest/api/3/filter/search?expand=jql,owner,sharePermissions,favouritedCount')) {
    const userId = await owner(f.owner?.accountId);
    // 조직 데이터는 관리 서비스만 작성하므로 미매칭 소유자를 임의 생성하지 않는다.
    const { rows: [row] } = await query(`INSERT INTO jira_filters(source_id,name,jql,owner_id,share,favourite_count,params)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_id) DO UPDATE SET
      name=EXCLUDED.name,jql=EXCLUDED.jql,owner_id=EXCLUDED.owner_id,share=EXCLUDED.share,favourite_count=EXCLUDED.favourite_count,params=EXCLUDED.params RETURNING id`,
      [f.id,f.name,f.jql,userId,JSON.stringify(f.sharePermissions ?? []),f.favouritedCount ?? 0,JSON.stringify({jql:f.jql,scope:'all'})]);
    if (userId && f.favouritedCount > 0) await query('INSERT INTO jira_filter_favourites(filter_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.id,userId]);
  }
  for (const d of await pages('/rest/api/3/dashboard/search?expand=owner,sharePermissions')) {
    const gadgets = (await get(`/rest/api/3/dashboard/${d.id}/gadget`)).gadgets ?? [];
    for (const g of gadgets) {
      const base = `/rest/api/3/dashboard/${d.id}/items/${g.id}/properties`;
      g.properties = {};
      try {
        const properties = await get(base);
        for (const k of properties.keys ?? []) g.properties[k.key] = (await get(`${base}/${encodeURIComponent(k.key)}`)).value;
        g.preferences = Object.assign({}, ...Object.values(g.properties).filter(v => v && typeof v === 'object'), g.userPrefs ?? {});
      } catch (e) {
        // 설정을 추측하여 전체 이슈를 표시하지 않는다. 다른 가젯 이관은 계속한다.
        g.configurationError = `가젯 설정 조회 실패 (${g.id})`;
        console.warn(g.configurationError);
      }
    }
    await query(`INSERT INTO jira_dashboards(source_id,name,owner_id,share,gadgets) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name,owner_id=EXCLUDED.owner_id,share=EXCLUDED.share,gadgets=EXCLUDED.gadgets`,
      [d.id,d.name,await owner(d.owner?.accountId),JSON.stringify(d.sharePermissions ?? []),JSON.stringify(gadgets)]);
  }
} finally { await closeDb(); }
