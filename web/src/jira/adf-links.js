export { sourceLink } from '../../../server/src/adf-source-links.mjs';
export function safeUrl(raw) {
  try { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export function embedUrl(raw) {
  const safe = safeUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  return u.protocol === 'https:' && u.hostname === 'www.figma.com' && u.pathname === '/embed' ? safe : null;
}
export function alignment(n) {
  const align = n.marks?.find(m => m.type === 'alignment')?.attrs?.align;
  return ['start', 'center', 'end', 'left', 'right', 'justify'].includes(align) ? align : undefined;
}
export function mediaBorder(n) {
  const a = n.marks?.find(m => m.type === 'border')?.attrs;
  return a ? { borderStyle: 'solid', borderWidth: Math.max(0, Math.min(Number(a.size) || 0, 20)), borderColor: a.color, boxSizing: 'border-box' } : {};
}
