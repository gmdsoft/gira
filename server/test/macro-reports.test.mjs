import test from 'node:test';
import assert from 'node:assert/strict';
import { details, mergeDetails, reportNodes, labelCounts, reportScope } from '../src/macro-reports.mjs';
import { selectAttachments } from '../../shared/macro-attachments.mjs';
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = text => ({ type: 'tableCell', content: [paragraph(text)] });
const properties = entries => ({ type: 'cfMacro', attrs: { name: 'details', params: { hidden: 'true' } }, content: [{ type: 'table', content: entries.map(([k, v]) => ({ type: 'tableRow', content: [cell(k), cell(v)] })) }] });
test('숨겨진 details도 키·값을 추출하고 문서별로 지정한 열 순서로 합친다', () => {
  const doc = { type: 'doc', content: [properties([['상태', '진행'], ['소유자', '가상 사용자']])] };
  assert.equal(details(doc)[0]['상태'][0].content[0].text, '진행');
  const result = mergeDetails([{ id: '1', doc }, { id: '2', doc: { type: 'doc', content: [properties([['상태', '완료']])] } }], '소유자,상태');
  assert.deepEqual(result.headings, ['소유자', '상태']);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[1].fields['소유자'], undefined);
});
test('미완료 작업과 담당자·기한 및 ADF 결정만 추출한다', () => {
  const doc = { type: 'doc', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [paragraph('끝')] },
    { type: 'taskItem', attrs: { checked: false }, content: [paragraph('할 일'), { type: 'mention', attrs: { text: '가상 담당', accountId: 'synthetic-account' } }, { type: 'date', attrs: { date: '2026-01-02' } }] },
    { type: 'adfNode', attrs: { adfType: 'decision-item' }, content: [paragraph('결정')] },
  ] };
  const tasks = reportNodes(doc, 'tasks');
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].assignees, ['가상 담당']);
  assert.equal(tasks[0].due, '2026-01-02');
  assert.deepEqual(reportNodes(doc, 'decisions'), [{ text: '결정' }]);
});
test('레이블은 문서당 한 번 세고 제외 목록을 적용한다', () => {
  assert.deepEqual(labelCounts([{ labels: ['a', 'a', 'b'] }, { labels: ['a', 'c'] }], 'b'), [{ name: 'a', count: 2 }, { name: 'c', count: 1 }]);
});
test('첨부는 전체 이름 정규식 OR 조건과 정렬을 적용한다', () => {
  const rows = ['z.svg', 'a.ico', 'skip.txt', 'a.svg.bak'].map(filename => ({ filename }));
  assert.deepEqual(selectAttachments(rows, { patterns: '.*ico, .*svg', sortBy: 'name' }).map(r => r.filename), ['a.ico', 'z.svg']);
  assert.throws(() => selectAttachments(rows, { patterns: '[' }));
  assert.equal(rows[0].filename, 'z.svg');
});
test('CQL과 ri:space 범위는 명시 조건을 유지하고 미지원 문법은 거절한다', () => {
  assert.deepEqual(reportScope({ cql: 'label = "test" and space = currentSpace ( )' }, 'S'), { spaces: ['S'], labels: ['test'] });
  assert.deepEqual(reportScope({ spaceKey: { 'ri:space-key': 'T' } }, 'S').spaces, ['T']);
  assert.throws(() => reportScope({ cql: 'space = "T" or label = "secret"' }, 'S'));
});
