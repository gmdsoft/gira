// 원본 Jira에는 GET만 사용하며 리디렉트 대상·응답 본문은 내려받지 않는다.
export function parseMediaLocation(location) {
  try {
    const u = new URL(location);
    if (u.protocol !== 'https:' || u.hostname !== 'api.media.atlassian.com') return null;
    return u.pathname.match(/^\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/binary(?:\/|$)/i)?.[1].toLowerCase() ?? null;
  } catch { return null; }
}

export async function fetchMediaId(id, { site, auth, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${site.replace(/\/$/, '')}/rest/api/3/attachment/content/${encodeURIComponent(id)}`, {
      method: 'GET', redirect: 'manual', headers: { Authorization: auth },
    });
    const location = res.headers.get('location');
    const retry = res.headers.get('retry-after');
    await res.body?.cancel();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const seconds = Number(retry);
      const delay = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
      await sleep(Number.isFinite(delay) && delay >= 0 ? delay : 1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 404 || res.status === 410) return null;
    if (res.status !== 303) throw new Error(`첨부 ${id}: HTTP ${res.status}`);
    const mediaId = parseMediaLocation(location);
    if (!mediaId) throw new Error(`첨부 ${id}: 미디어 Location 형식 불일치`);
    return mediaId;
  }
}

export async function fillMediaIds(rows, { query, ...options }, progress = () => {}) {
  let next = 0, done = 0, filled = 0, missing = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(6, rows.length) }, async () => {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        const id = await fetchMediaId(row.id, options);
        if (id) {
          await query(`UPDATE jira_attachments SET media_id = $2 WHERE id = $1 AND (media_id IS NULL OR media_id = '')`, [row.id, id]);
          filled++;
        } else missing++;
      } catch (e) { failed++; console.error(e.message); }
      progress({ done: ++done, total: rows.length, filled, missing, failed });
    }
  }));
  return { done, filled, missing, failed };
}
