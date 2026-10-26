// OpenSearch 색인·검색. 한국어는 nori 형태소 분석기.
// 검색 엔진이 꺼져 있어도 서비스 본체는 동작해야 하므로 모든 호출은 실패를 삼키고 로그만 남긴다.

const SEARCH_URL = (process.env.SEARCH_URL ?? 'http://localhost:9200').replace(/\/$/, '');
const INDEX = 'content';

async function os(method, path, body) {
  const res = await fetch(SEARCH_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`search ${res.status} ${method} ${path}: ${JSON.stringify(json?.error?.type ?? json).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function ensureIndex() {
  const exists = await fetch(`${SEARCH_URL}/${INDEX}`, { method: 'HEAD' });
  if (exists.ok) return;
  await os('PUT', `/${INDEX}`, {
    settings: {
      index: { number_of_shards: 1, number_of_replicas: 0 },
      analysis: {
        analyzer: {
          korean: {
            type: 'custom',
            tokenizer: 'nori_mixed',
            filter: ['lowercase', 'nori_part_of_speech'],
          },
        },
        tokenizer: {
          nori_mixed: { type: 'nori_tokenizer', decompound_mode: 'mixed' },
        },
      },
    },
    mappings: {
      properties: {
        title: { type: 'text', analyzer: 'korean' },
        text: { type: 'text', analyzer: 'korean' },
        spaceKey: { type: 'keyword' },
        type: { type: 'keyword' },
        labels: { type: 'keyword' },
        authorName: { type: 'text', analyzer: 'korean' },
        updatedAt: { type: 'date' },
      },
    },
  });
}

// ProseMirror doc → 검색용 평문
export function plainText(doc) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text' && n.text) out.push(n.text);
    const a = n.attrs ?? {};
    for (const k of ['title', 'caption', 'alt', 'text', 'filename', 'contentTitle', 'key', 'jql', 'name', 'date'])
      if (typeof a[k] === 'string' && a[k]) out.push(a[k]);
    for (const c of n.content ?? []) walk(c);
    if (['paragraph', 'heading', 'tableRow', 'listItem', 'taskItem'].includes(n.type)) out.push('\n');
  };
  walk(doc);
  return out.join(' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

export async function indexContent({ id, title, spaceKey, type, labels, authorName, updatedAt, doc }) {
  try {
    await ensureIndex();
    await os('PUT', `/${INDEX}/_doc/${id}`, {
      title, spaceKey, type, labels: labels ?? [], authorName: authorName ?? null,
      updatedAt: updatedAt ?? null, text: doc ? plainText(doc) : '',
    });
  } catch (e) {
    console.error('[search] 색인 실패:', e.message);
  }
}

export async function bulkIndex(items) {
  await ensureIndex();
  const lines = [];
  for (const it of items) {
    lines.push(JSON.stringify({ index: { _index: INDEX, _id: String(it.id) } }));
    lines.push(JSON.stringify({
      title: it.title, spaceKey: it.spaceKey, type: it.type, labels: it.labels ?? [],
      authorName: it.authorName ?? null, updatedAt: it.updatedAt ?? null,
      text: it.doc ? plainText(it.doc) : '',
    }));
  }
  const res = await fetch(`${SEARCH_URL}/_bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: lines.join('\n') + '\n',
  });
  const json = await res.json();
  if (json.errors) {
    const bad = json.items.filter((i) => i.index?.error).slice(0, 3);
    throw new Error('bulk 색인 오류: ' + JSON.stringify(bad));
  }
  return json.items.length;
}

export async function removeContent(id) {
  try { await os('DELETE', `/${INDEX}/_doc/${id}`); } catch { /* 없으면 무시 */ }
}

export async function search({ q, spaceKey, type, from = 0, size = 20 }) {
  const filter = [];
  if (spaceKey) filter.push({ term: { spaceKey } });
  if (type) filter.push({ term: { type } });
  const res = await os('POST', `/${INDEX}/_search`, {
    from, size,
    query: {
      bool: {
        must: [{ multi_match: { query: q, fields: ['title^3', 'text', 'labels^2'] } }],
        filter,
      },
    },
    highlight: {
      pre_tags: ['<mark>'], post_tags: ['</mark>'],
      fields: { text: { fragment_size: 140, number_of_fragments: 2 }, title: {} },
    },
    _source: ['title', 'spaceKey', 'type', 'updatedAt', 'authorName'],
  });
  return {
    total: res.hits.total.value,
    hits: res.hits.hits.map((h) => ({
      id: h._id,
      score: h._score,
      ...h._source,
      titleHtml: h.highlight?.title?.[0] ?? null,
      excerpts: h.highlight?.text ?? [],
    })),
  };
}
