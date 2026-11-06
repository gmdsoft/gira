export function attachmentMaps(attachments = []) {
  return {
    byMediaId: new Map(attachments.filter((a) => a.media_id).map((a) => [String(a.media_id).toLowerCase(), a])),
    byId: new Map(attachments.map((a) => [String(a.id), a])),
    byName: new Map(attachments.map((a) => [String(a.filename).toLowerCase(), a])),
  };
}
export function matchMedia(a, maps = {}) {
  return (a.id ? maps.byMediaId?.get(String(a.id).toLowerCase()) : null)
    ?? (a.collection === 'gira' && a.id ? maps.byId?.get(String(a.id)) : null)
    ?? (a.alt ? maps.byName?.get(String(a.alt).toLowerCase()) : null);
}
export function fileSize(bytes) {
  if (bytes == null) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
