// GIRA-71 기한·시간 추적·작업 로그 (합성 데이터)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration, scheduleFields } from '../src/jira-schedule.mjs';
import { worklogRows } from '../../scripts/lib/jira-worklogs.mjs';

test('Jira 시간 표기 ↔ 초 (1d = 8h, 1w = 5d)', () => {
  assert.equal(parseDuration('1h 30m'), 5400);
  assert.equal(parseDuration('2d'), 57600);
  assert.equal(parseDuration('1w'), 144000);
  assert.equal(parseDuration('1.5h'), 5400);
  assert.equal(parseDuration('abc'), 0);
  assert.equal(parseDuration('1h x'), 0);
  assert.equal(formatDuration(5400), '1h 30m');
  assert.equal(formatDuration(144000 + 3600), '1w 1h');
});

test('원본 필드에서 시간 추적·영향 버전·환경 추출', () => {
  const f = scheduleFields({ timetracking: { originalEstimateSeconds: 7200, remainingEstimateSeconds: 3600, timeSpentSeconds: 1800 },
    versions: [{ name: '1.0' }, { name: '2.0' }], environment: { type: 'doc', content: [] } });
  assert.deepEqual(f.timetracking, { original: 7200, remaining: 3600, spent: 1800 });
  assert.deepEqual(f.affects_versions, ['1.0', '2.0']);
  assert.equal(f.environment_adf.type, 'doc');
  assert.equal(scheduleFields({}).timetracking, null);
});

test('작업 로그 행 변환 — 소요 0·id 없는 항목 제외', () => {
  const rows = worklogRows('10', [{ id: '1', author: { accountId: 'a' }, started: '2026-01-01T09:00:00.000+0900', timeSpentSeconds: 3600 }, { id: '2', timeSpentSeconds: 0 }, { timeSpentSeconds: 60 }], (u) => (u?.accountId === 'a' ? 7 : null));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].id, rows[0].issueId, rows[0].authorId, rows[0].seconds], [1, 10, 7, 3600]);
});
