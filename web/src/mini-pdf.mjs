// 아주 작은 PDF 만들기: JPEG 이미지 한 장을 한 쪽에 꽉 채운 PDF (화이트보드 PDF 내보내기용, 외부 라이브러리 없음)
// jpeg: Uint8Array(JPEG 바이트), width/height: 이미지 픽셀 → 쪽 크기는 pt(=px×0.75), 긴 변이 maxPt를 넘으면 줄인다
export function jpegToPdf(jpeg, width, height, { maxPt = 2000 } = {}) {
  let w = width * 0.75, h = height * 0.75;
  const k = Math.min(1, maxPt / Math.max(w, h)); w = +(w * k).toFixed(2); h = +(h * k).toFixed(2);
  const enc = new TextEncoder();
  const parts = []; const offsets = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
