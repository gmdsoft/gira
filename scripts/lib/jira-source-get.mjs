// 원본 Jira GET 전용. 429/서버 오류는 최대 5회 재시도.
export function jiraGet(site, auth, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  return async function get(pathOrUrl, attempt = 0) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : site + pathOrUrl;
    const res = await fetchImpl(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retry = res.headers.get('retry-after');
      const seconds = Number(retry);
      const delay = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
      await res.body?.cancel();
      await sleep(Number.isFinite(delay) ? Math.max(0, delay) : 1000 * 2 ** attempt);
      return get(pathOrUrl, attempt + 1);
    }
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText} — GET ${url}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };
}
