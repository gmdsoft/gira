// 우리 쪽에서 편집한 화이트보드·데이터베이스 찾기 (GIRA-74)
// 로컬 편집 저장은 원본 바이너리(source_ybin) 없이 스냅샷을 쌓는다 → 그런 스냅샷이 하나라도 있으면 로컬 편집본.
// 이관·동기화는 이 항목을 건너뛰어, 같은 버전 번호를 원본으로 덮어쓰거나 현재 버전을 되돌리지 않는다.
export async function locallyEditedCanvases(query, canvases) {
  const edited = new Set();
  for (const [table, isType] of [['whiteboard_snapshots', (d) => d.type === 'whiteboard'], ['database_snapshots', (d) => d.type !== 'whiteboard']]) {
    const ids = canvases.filter(isType).map((d) => String(d.id));
    if (!ids.length) continue;
    const { rows } = await query(`SELECT DISTINCT content_id::text AS id FROM ${table} WHERE source_ybin IS NULL AND content_id = ANY($1::bigint[])`, [ids]);
    for (const r of rows) edited.add(r.id);
  }
  return edited;
}
