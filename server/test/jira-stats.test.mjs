import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, decodeJql, requestedProjects } from '../src/jira-stats.mjs';
import { renderChart, chartQuery } from '../../web/src/jira-chart.js';
const issues = [
  {project:'QA', status:'Done', labels:['a','a','b'], created_at:'2026-11-01', resolved_at:'2026-11-02'},
  {project:'QA', status:'Open', labels:[], created_at:'2026-11-02'},
  {project:'FB', status:'Done', labels:['a'], created_at:'2026-10-01', resolved_at:'2026-11-03'},
];
test('encoded JQL and missing project extraction', () => {
  assert.equal(decodeJql('project%20in%20(QA%2C%20%22OLD%22)'), 'project in (QA, "OLD")');
  assert.deepEqual(requestedProjects('project in (QA, "OLD") AND project = FB'), ['QA','OLD','FB']);
  assert.equal(decodeJql('labels = "100%"'), 'labels = "100%"');
});
test('two axes, totals, top N, arrays and empty fields', () => {
  const data = aggregate(issues, {type:'two', x:'statuses', y:'project', numberToShow:1});
  assert.equal(data.total,3); assert.equal(data.rows.length,1); assert.equal(data.rows[0].value,'QA');
  assert.deepEqual(data.totals,{Done:2, Open:1});
  assert.deepEqual(data.rows[0].cells,{Done:1,Open:1});
  assert.deepEqual(aggregate(issues,{type:'pie',field:'labels'}).values, [{value:'a',count:2},{value:'b',count:1},{value:'',count:1}]);
  assert.throws(() => aggregate([], {type:'pie',field:'bad'}));
});
test('daily, weekly, monthly, cumulative and old-created resolved issues', () => {
  for (const period of ['daily','weekly','monthly']) {
    const d = aggregate(issues,{type:'createdvsresolved',days:6,period,cumulative:'true'},new Date('2026-11-06T12:00Z'));
    assert.equal(d.rows.at(-1).created,2); assert.equal(d.rows.at(-1).resolved,2);
  }
  const d = aggregate(issues,{type:'createdvsresolved',days:6,period:'daily'},new Date('2026-11-06'));
  assert.equal(d.rows[0].created,1); assert.equal(d.rows[2].resolved,1);
});
test('render all three charts, escaped warnings, links and macro options', () => {
  const params = {chartType:'twodimensional',jql:'project%20%3D%20QA',xstattype:'statuses',ystattype:'project'};
  assert.equal(chartQuery(params).get('type'),'two');
  const data = {...aggregate(issues,{type:'two',x:'statuses',y:'project'}),missingProjects:['<OLD>'],searchBase:'http://gira/projects/QA/list'};
  const html = renderChart(data,params);
  assert.match(html, /<thead>/); assert.match(html, /합계/); assert.match(html,/&lt;OLD&gt;/); assert.match(html, /status%20/);
  assert.match(renderChart({...aggregate(issues,{type:'pie',field:'project'}),searchBase:'/projects/QA/list'}, {statType:'project'}), /<svg/);
  assert.match(renderChart(aggregate(issues,{type:'createdvsresolved',days:6},new Date('2026-11-06')),{}), /<polyline/);
});
test('stats proxy forwards viewer credentials and preserves errors', async (t) => {
  const { default: Fastify } = await import('fastify');
  const { default: cookie } = await import('@fastify/cookie');
  const { registerGiraCards } = await import('../src/gira-cards.mjs');
  const app = Fastify(); await app.register(cookie); registerGiraCards(app,{giraUrl:'https://gira.test'});
  const original = globalThis.fetch; t.after(async () => {globalThis.fetch = original; await app.close();});
  globalThis.fetch = async (url,options) => {
    assert.equal(new URL(url).searchParams.get('jql'),'project = QA');
    assert.equal(options.headers.authorization,'Bearer viewer');
    assert.equal(options.headers.cookie,'gmd_sid=session');
    return Response.json({error:'bad JQL'},{status:400});
  };
  const res = await app.inject({url:'/api/gira/stats?jql=project%20%3D%20QA',headers:{authorization:'Bearer viewer',cookie:'gmd_sid=session'}});
  assert.equal(res.statusCode,400); assert.equal(res.json().error,'bad JQL'); assert.equal(res.headers['cache-control'],'private, no-store');
});
