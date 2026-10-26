#!/usr/bin/env node
// rea capture-browser-scenario 결과(JSON)에서 화면별 API 호출을 경로 패턴으로 묶어 요약한다.
// 사용법: node scripts/summarize-capture.mjs <capture.out.json>

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('사용법: node scripts/summarize-capture.mjs <capture.out.json>');
  process.exit(1);
}
const result = JSON.parse(readFileSync(file, 'utf8')).normalized_result;
const items = result.events.items;
const requests = items.filter((e) => e.kind === 'request');
const responses = new Map(items.filter((e) => e.kind === 'response').map((e) => [e.transaction_id, e]));

const SITE_HOST = 'gmdsoft.atlassian.net';
const normalizePath = (path) =>
  path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\/\d{3,}(?=\/|$)/g, '/{id}');

const byType = {};
const apis = {};
for (const r of requests) {
  byType[r.resource_type] = (byType[r.resource_type] ?? 0) + 1;
  if (!['fetch', 'xhr'].includes(r.resource_type)) continue;
  const url = new URL(r.url.url);
  // Confluence 의 GraphQL 은 operation 이름을 q 쿼리 파라미터로 붙인다
  const op = url.searchParams.get('q') ?? url.searchParams.get('operationName');
  const host = url.host === SITE_HOST ? '' : url.host;
  const key = `${r.method} ${host}${normalizePath(url.pathname)}${op ? ` q=${op}` : ''}`;
  const entry = (apis[key] ??= { count: 0, steps: new Set(), statuses: new Set() });
  entry.count++;
  entry.steps.add(r.step_index);
  const status = responses.get(r.transaction_id)?.status;
  if (status != null) entry.statuses.add(status);
}

console.log('# 리소스 유형별 요청 수');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
console.log('\n# API 호출 (fetch/xhr) — 횟수, 단계, 상태코드, 패턴');
for (const [k, v] of Object.entries(apis).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${v.count}\tsteps=${[...v.steps].join(',')}\t${[...v.statuses].join(',')}\t${k}`);
}
console.log(`\n# 이벤트 보존 ${result.events.retained}, 누락 ${result.events.dropped}`);
const ws = items.filter((e) => e.kind?.startsWith('websocket'));
if (ws.length) console.log(`# WebSocket 이벤트 ${ws.length}: ${[...new Set(ws.map((e) => e.url?.url))].join(', ')}`);
