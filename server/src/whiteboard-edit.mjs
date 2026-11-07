// 화이트보드 편집 저장 (GIRA-74): Excalidraw 장면을 새 버전 스냅샷으로 저장한다.
// 원본에서 이관한 버전(source_ybin 보관)은 그대로 두고, 편집본은 { format: 'excalidraw', elements, files, plainText } 로 쌓는다.
const MAX_ELEMENTS = 20000;
const MAX_BYTES = 20 * 1024 * 1024; // 붙여 넣은 이미지(dataURL) 포함
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

export function whiteboardPlainText(elements) {
  return elements.filter((e) => !e.isDeleted && e.type === 'text' && e.text).map((e) => String(e.text))
    .concat(elements.filter((e) => !e.isDeleted && e.type === 'frame' && e.name).map((e) => String(e.name)))
    .join('\n');
}

export function validateWhiteboard(data) {
  if (!data || typeof data !== 'object' || data.format !== 'excalidraw' || !Array.isArray(data.elements)) throw new Error('잘못된 화이트보드 데이터');
  if (data.elements.length > MAX_ELEMENTS) throw new Error(`잘못된 화이트보드 데이터: 요소는 ${MAX_ELEMENTS}개까지`);
  for (const e of data.elements) {
    if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') throw new Error('잘못된 화이트보드 데이터: 요소 id·type 필요');
    if (e.link != null && (typeof e.link !== 'string' || /^\s*(javascript|data|vbscript):/i.test(e.link))) throw new Error('잘못된 화이트보드 데이터: 허용되지 않는 링크');
  }
  const files = data.files ?? {};
  if (typeof files !== 'object' || Array.isArray(files)) throw new Error('잘못된 화이트보드 데이터: files');
  for (const f of Object.values(files)) {
    if (!f || typeof f.dataURL !== 'string' || !SAFE_IMAGE.test(f.dataURL)) throw new Error('잘못된 화이트보드 데이터: 이미지는 png·jpeg·gif·webp·svg만');
  }
  const elements = data.elements.filter((e) => !e.isDeleted);
  const used = new Set(elements.map((e) => e.fileId).filter(Boolean));
  const clean = {
    format: 'excalidraw',
    elements,
    files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))
      .map(([id, f]) => [id, { id, mimeType: String(f.mimeType ?? ''), dataURL: f.dataURL, created: Number(f.created) || Date.now() }])),
    appState: { viewBackgroundColor: typeof data.appState?.viewBackgroundColor === 'string' ? data.appState.viewBackgroundColor : '#ffffff' },
    plainText: whiteboardPlainText(elements),
  };
  if (Buffer.byteLength(JSON.stringify(clean)) > MAX_BYTES) throw new Error('잘못된 화이트보드 데이터: 20MB 초과');
  return clean;
}

export const emptyWhiteboard = () => ({ format: 'excalidraw', elements: [], files: {}, appState: { viewBackgroundColor: '#ffffff' }, plainText: '' });

// 호출자가 트랜잭션을 연다. content 행 잠금으로 버전 검사와 스냅샷 추가를 직렬화한다.
export async function saveWhiteboard(client, { id, baseVersion, data, userId }) {
  const { rows: [current] } = await client.query('SELECT type, current_version FROM content WHERE id=$1 FOR UPDATE', [id]);
  if (current?.type !== 'whiteboard') return { status: 404, error: 'whiteboard not found' };
  if (baseVersion !== current.current_version) {
    const { rows: [snapshot] } = await client.query('SELECT data FROM whiteboard_snapshots WHERE content_id=$1 AND version=$2', [id, current.current_version]);
    return { status: 409, error: '버전 충돌: 다른 사람이 먼저 저장했습니다. 최신 내용을 다시 불러오세요', currentVersion: current.current_version, data: snapshot?.data };
  }
  const clean = validateWhiteboard(data);
  const version = current.current_version + 1;
  await client.query('INSERT INTO whiteboard_snapshots (content_id, version, data) VALUES ($1,$2,$3)', [id, version, JSON.stringify(clean)]);
  await client.query("INSERT INTO content_versions (content_id,version,doc,message,author_id,created_at) VALUES ($1,$2,NULL,'화이트보드 편집',$3,now())", [id, version, userId]);
  await client.query('UPDATE content SET current_version=$2, updated_at=now() WHERE id=$1', [id, version]);
  return { status: 200, version };
}
