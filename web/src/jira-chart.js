const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function chartQuery(params) {
  const q = new URLSearchParams({ type: ({ twodimensional: 'two', pie: 'pie', createdvsresolved: 'createdvsresolved' })[params.chartType] ?? 'two', jql: params.jql ?? '', x: params.xstattype ?? 'statuses', y: params.ystattype ?? 'project', field: params.statType ?? 'issuetype', days: params.daysprevious ?? '30', period: params.periodName ?? 'daily', cumulative: params.isCumulative ?? 'false', numberToShow: params.numberToShow ?? '10', sortBy: params.sortBy ?? '', sortDirection: params.sortDirection ?? '' });
  return q;
}
const fieldNames = { statuses:'status', allFixfor:'fixVersion', assignees:'assignee', components:'component' };
export function renderChart(data, params) {
  let jql = params.jql ?? '';
  if (/%(?:20|3d|28|22)/i.test(jql)) { try { jql = decodeURIComponent(jql); } catch { /* API reports invalid encoding */ } }
  jql = jql.replace(/\s+ORDER\s+BY\b[\s\S]*$/i, '');
  const link = (count, filters = []) => {
    const clauses = filters.map(([field,value]) => `${fieldNames[field] ?? field} ${value === '' ? 'IS EMPTY' : '= "' + String(value).replace(/["\\]/g, '') + '"'}`);
    const query = [jql && `(${jql})`, ...clauses].filter(Boolean).join(' AND ');
    return `<a target="_blank" rel="noreferrer" href="${escape(data.searchBase)}?scope=all&amp;jql=${escape(encodeURIComponent(query))}">${count}</a>`;
  };
  let html = (data.missingProjects ?? []).map(p => `<p>${escape(`원본 Jira 프로젝트 ${p}는 이관되지 않음`)}</p>`).join('');
  const label = v => escape(v || '미지정');
  if (data.type === 'two') {
    const totals = params.showTotals !== 'false';
    html += `<table><thead><tr><th>${escape(params.ystattype ?? 'project')} / ${escape(params.xstattype ?? 'statuses')}</th>${data.columns.map(c => `<th>${label(c)}</th>`).join('')}${totals ? '<th>합계</th>' : ''}</tr></thead><tbody>`;
    html += data.rows.map(r => `<tr><th>${label(r.value)}</th>${data.columns.map(c => `<td>${link(r.cells[c] ?? 0, [[params.xstattype ?? 'statuses', c], [params.ystattype ?? 'project', r.value]])}</td>`).join('')}${totals ? `<td>${link(r.total, [[params.ystattype ?? 'project',r.value]])}</td>` : ''}</tr>`).join('');
    if (totals) html += `<tr><th>합계</th>${data.columns.map(c => `<td>${link(data.totals[c], [[params.xstattype ?? 'statuses', c]])}</td>`).join('')}<td>${link(data.total)}</td></tr>`;
    return html + '</tbody></table>' + (data.rows.length === 0 ? '<p>사용 가능한 데이터가 없습니다.</p>' : '');
  }
  const colors = ['#2684ff','#e34935','#36a37c','#6554c0','#ffab00','#008da6'];
  if (data.type === 'pie') {
    const sum = data.values.reduce((n,v) => n+v.count,0); let angle = -Math.PI/2;
    const paths = data.values.map((v,i) => {
      const next = angle + 2*Math.PI*v.count/sum;
      const path = v.count === sum ? `<circle cx="160" cy="160" r="120" fill="${colors[i%6]}"/>` : `<path d="M160 160 L${160+120*Math.cos(angle)} ${160+120*Math.sin(angle)} A120 120 0 ${next-angle>Math.PI?1:0} 1 ${160+120*Math.cos(next)} ${160+120*Math.sin(next)} Z" fill="${colors[i%6]}"><title>${label(v.value)}: ${v.count}</title></path>`;
      angle = next; return path;
    }).join('');
    return html + `<svg role="img" aria-label="이슈 분포" viewBox="0 0 320 320" style="max-width:320px;width:100%">${paths}</svg><ul>${data.values.map((v,i) => `<li><span style="color:${colors[i%6]}">●</span> ${label(v.value)}: ${link(v.count, [[params.statType ?? 'issuetype',v.value]])} (${(100*v.count/sum).toFixed(1)}%)</li>`).join('')}</ul>${sum ? '' : '<p>사용 가능한 데이터가 없습니다.</p>'}`;
  }
  const series = [['created','생성','#2684ff'], ['resolved','해결','#e34935']];
  if (params.showUnresolvedTrend === 'true') series.push(['unresolved','미해결 추이','#36a37c']);
  const max = Math.max(1,...data.rows.flatMap(r => series.map(([key]) => Math.abs(r[key]))));
  const x = i => 50 + i*570/Math.max(1,data.rows.length-1);
  const y = v => 170-v*130/max;
  html += '<svg role="img" aria-label="생성 대 해결 이슈 차트 (UTC)" viewBox="0 0 660 360" style="width:100%;max-width:900px"><path d="M50 30 V300 H630 M50 170 H630" fill="none" stroke="#aaa"/>';
  for (const [key,name,color] of series) html += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${data.rows.map((r,i) => `${x(i)},${y(r[key])}`).join('')}"/>` + data.rows.map((r,i) => `<circle cx="${x(i)}" cy="${y(r[key])}" r="3" fill="${color}"><title>${r.date} ${name}: ${r[key]}</title></circle>`).join('');
  html += data.rows.map((r,i) => i % Math.max(1,Math.ceil(data.rows.length/6)) === 0 ? `<text x="${x(i)}" y="325" text-anchor="middle" font-size="11">${r.date}</text>` : '').join('');
  html += `<text x="10" y="40" font-size="11">${max}</text><text x="20" y="175" font-size="11">0</text></svg>`;
  return html + `<p>${series.map(([,name,color]) => `<span style="color:${color}">${name}</span>`).join(' · ')} · ${escape(data.period)} · UTC · ${link(data.total)}개 이슈</p>`;
}
