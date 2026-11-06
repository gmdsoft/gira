import { chartData } from '../../shared/media-macros.mjs';

export function storageChart(table, params) {
  if (!table || (params.type && params.type !== 'bar')) return null;
  const data = chartData([...table.rows].map(row => [...row.cells].map(cell => cell.textContent)));
  if (!data) return null;
  const stacked = String(params.stacked).toLowerCase() === 'true';
  const { series, categories } = data;
  const totals = categories.flatMap(row => stacked
    ? [row.values.reduce((s, v) => s + Math.max(0, v ?? 0), 0), row.values.reduce((s, v) => s + Math.min(0, v ?? 0), 0)]
    : row.values.filter(v => v !== null));
  const min = Math.min(0, ...totals), max = Math.max(0, ...totals);
  const range = max - min || 1;
  const y = value => 250 - (value - min) / range * 210;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 640 ${310 + series.length * 20}`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '본문 표 막대그래프');
  svg.style.cssText = 'width:100%;max-width:640px;height:auto';
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  };
  const colors = ['#468ac5', '#e56910', '#859b16', '#af59ba', '#158578'];
  add('line', { x1: 45, x2: 630, y1: y(0), y2: y(0), stroke: '#888' });
  for (const value of [min, max]) add('text', { x: 0, y: y(value), 'font-size': 12 }, String(value));
  const group = 580 / categories.length;
  categories.forEach((row, index) => {
    let positive = 0, negative = 0;
    row.values.forEach((value, i) => {
      if (value === null) return;
      const start = stacked ? (value >= 0 ? positive : negative) : 0;
      if (value >= 0) positive += value; else negative += value;
      const width = group * .75 / (stacked ? 1 : series.length);
      add('rect', { x: 45 + index * group + (stacked ? 0 : i * width), y: Math.min(y(start), y(start + value)), width, height: Math.abs(y(start + value) - y(start)), fill: colors[i % colors.length] });
    });
    add('text', { x: 45 + index * group, y: 275, 'font-size': 12 }, row.label);
  });
  series.forEach((label, i) => {
    add('rect', { x: 45, y: 295 + i * 20, width: 12, height: 12, fill: colors[i % colors.length] });
    add('text', { x: 65, y: 306 + i * 20, 'font-size': 12 }, label);
  });
  return svg;
}
