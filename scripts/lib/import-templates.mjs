import { convertStorage } from '../convert-storage.mjs';

export function convertTemplate(source) {
  const sourceXhtml = source.body?.storage?.value ?? '';
  return { id: String(source.templateId ?? source.id), name: source.name,
    description: source.description ?? '', labels: (source.labels ?? []).map((l) => l.name),
    doc: convertStorage(sourceXhtml).doc, sourceXhtml };
}

// get은 읽기 전용 원본 API 함수. 주입하여 독립적으로 변환/페이지네이션을 검증한다.
export async function importTemplates(spaceKey, { get, query }) {
  const { rows } = await query('SELECT id FROM spaces WHERE key=$1', [spaceKey]);
  if (!rows.length) throw new Error('먼저 스페이스를 이관하세요');
  let next = `/wiki/rest/api/template/page?spaceKey=${encodeURIComponent(spaceKey)}&limit=50`;
  let count = 0;
  while (next) {
    const page = await get(next);
    for (const item of page.results ?? []) {
      let source;
      try { source = await get(`/wiki/rest/api/template/${encodeURIComponent(item.templateId ?? item.id)}?expand=body.storage`); }
      catch (e) { if (e.status === 404) { console.warn(`삭제된 템플릿 건너뜀: ${item.templateId ?? item.id}`); continue; } throw e; }
      const t = convertTemplate(source);
      if (!/^\d+$/.test(t.id) || BigInt(t.id) >= 1000000000000n) throw new Error('원본 템플릿 id 범위 오류');
      await query(`INSERT INTO space_templates(id,space_id,name,description,labels,doc,source_xhtml)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,
        description=EXCLUDED.description,labels=EXCLUDED.labels,doc=EXCLUDED.doc,source_xhtml=EXCLUDED.source_xhtml,updated_at=now()
        WHERE space_templates.space_id=EXCLUDED.space_id`,
      [t.id, rows[0].id, t.name, t.description, t.labels, JSON.stringify(t.doc), t.sourceXhtml]);
      count++;
    }
    next = page._links?.next ?? null;
    if (next?.startsWith('/rest/')) next = '/wiki' + next;
  }
  return count;
}
