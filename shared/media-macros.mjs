// 파일 확장자는 대소문자 구분 없이 판단한다. 브라우저의 실제 코덱 지원은 파일에 따라 다르다.
export function mediaTag(filename) {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'img';
  return null;
}

export function chartData(rows) {
  const [header, ...body] = rows;
  if (!header || header.length < 2) return null;
  const series = header.slice(1);
  const categories = body.filter(row => row.length > 1).map(row => ({
    label: row[0],
    values: series.map((_, i) => {
      const value = String(row[i + 1] ?? '').trim();
      return value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    }),
  }));
  return categories.some(row => row.values.some(v => v !== null)) ? { series, categories } : null;
}
