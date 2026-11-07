export function selectAttachments(rows, params = {}) {
  const patterns = String(params.patterns ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => new RegExp(`^(?:${s})$`, 'i'));
  const selected = rows.filter(r => !patterns.length || patterns.some(p => p.test(r.filename)));
  const key = { name: 'filename', size: 'file_size', date: 'created_at' }[params.sortBy] ?? 'filename';
  return selected.sort((a, b) => typeof a[key] === 'number' ? a[key] - b[key] : String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'ko'));
}
