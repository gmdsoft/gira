import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankBetween, RANK_COLUMN, RANK_ORDER } from '../src/jira-rank.mjs';
import { parseJql } from '../src/jql.mjs';

test('합성 LexoRank 사이, 접두·인접 문자·버킷·양 끝 순위', () => {
  for (const [a, b] of [[null,null], [null,'0|000000:'], ['0|zzzzzz:',null], ['0|i00abc:','0|i00abd:'], ['0|abc','0|abc!O'], ['0|a','0|b'], ['0|a','1|a'], [null,'2|!O']]) {
    const rank = rankBetween(a,b);
    if (a) assert.ok(a < rank, `${a} < ${rank}`);
    if (b) assert.ok(rank < b, `${rank} < ${b}`);
    assert.equal(rank.slice(0,2), (a ?? b ?? '0|').slice(0,2));
  }
  let upper = '0|i00abd:';
  for (let i=0; i<1000; i++) {
    const next = rankBetween('0|i00abc:', upper);
    assert.ok('0|i00abc:' < next && next < upper);
    upper = next;
  }
  assert.throws(() => rankBetween('0|b','0|a'));
  assert.throws(() => rankBetween('0|a','0|a'));
});
test('JQL Rank와 정렬 SQL은 C 정렬, NULL 마지막, 키 보조 정렬', () => {
  assert.equal(parseJql('ORDER BY Rank ASC', {p: () => '$1'}).order, 'rank');
  assert.equal(parseJql('ORDER BY Rank DESC', {p: () => '$1'}).order, '-rank');
  assert.equal(RANK_ORDER, 'i.rank COLLATE "C" ASC NULLS LAST, i.issue_key ASC');
  const source = readFileSync(new URL('../src/jira-viewer.mjs', import.meta.url),'utf8');
  assert.ok(source.includes('rank: RANK_COLUMN'));
  assert.ok(source.includes('ORDER BY ${col} ${dir} NULLS LAST, i.issue_key ASC'));
  assert.equal(RANK_COLUMN, 'i.rank COLLATE "C"');
});
