import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomFields, validateCustomPatch, searchValues, fieldOptions } from '../src/jira-custom-fields.mjs';
import { parseJql, JqlError } from '../src/jql.mjs';
const def = (type, extra = {}) => ({ id: 'customfield_10123', name: '표본', custom: true, schema_custom: `jira:${type}`, ...extra });
const context = { isGlobalContext: false, projectIds: ['10'], isAnyIssueType: false, issueTypeIds: ['20'], options: [{ id: '1', value: 'Android' }, { id: '2', value: 'iOS', disabled: true }] };

test('형식별 표시값과 검색값: 숫자 0과 false 보존, 빈 값 제외', () => {
  const cases = [
    ['select', { id: '1', value: 'Android' }, 'Android'], ['radiobuttons', {value: 'A'}, 'A'],
    ['multicheckboxes', [{value:'A'}, {value:'B'}], 'A, B'], ['multiselect', [{value:'A'}], 'A'],
    ['labels', ['고객사', '담당자'], '고객사, 담당자'], ['textfield', '본문', '본문'], ['url', 'https://example.org', 'https://example.org'],
    ['textarea', {type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'첫 줄'}]}, {type:'paragraph', content:[{type:'text', text:'다음 줄'}]}]}, '첫 줄\n다음 줄'],
    ['float', 0, '0'], ['datepicker', '2026-11-06', '2026-11-06'], ['userpicker', {accountId:'u1',displayName:'사용자'}, '사용자'],
    ['people', [{accountId:'u1',displayName:'사용자'}], '사용자'], ['interval', {start:'2026-01-01',end:'2026-02-01'}, '2026-01-01, 2026-02-01'],
    ['atlassian-team', {name:'개발팀'}, '개발팀'], ['rating', 3, '3'], ['slider', 4, '4'], ['boolean', false, 'false'],
  ];
  for (const [type, value, display] of cases) {
    const [f] = normalizeCustomFields([def(type)], {customfield_10123: value}, 10, 20);
    assert.equal(f.display, display, type); assert.deepEqual(f.value, value);
  }
  for (const value of [null, '', [], {}]) assert.deepEqual(normalizeCustomFields([def('textfield')], {customfield_10123:value}), []);
  assert.deepEqual(searchValues({accountId:'u1',displayName:'사용자', self:'internal', id:'hidden'}), ['사용자', 'u1']);
});
test('내부 필드와 SLA·스프린트 제외, 스토리 포인트 인식 및 숫자 편집', () => {
  for (const f of [def('float', {id:'customfield_10019'}), def('sd-sla-field'), def('gh-sprint')]) {
    assert.deepEqual(normalizeCustomFields([f], {[f.id]: 1}), []);
    assert.throws(() => validateCustomPatch({[f.id]:null}, [f]));
  }
  const f = def('jsw-story-points', {name:'Story Points'});
  const [normalized] = normalizeCustomFields([f], {[f.id]:0});
  assert.equal(normalized.storyPoints, true); assert.equal(normalized.editable, true);
  assert.deepEqual(validateCustomPatch({[f.id]:5}, [f]), {[f.id]:5});
});
test('선택지 프로젝트·유형 범위와 비활성 옵션 검증', () => {
  const f = def('select', {options:[context]});
  assert.equal(fieldOptions(f, 10, 20).length, 1);
  assert.equal(fieldOptions(f, 11, 20).length, 0);
  assert.equal(fieldOptions(f, 10, 21).length, 0);
  assert.deepEqual(validateCustomPatch({[f.id]:'1'}, [f], 10, 20), {[f.id]:{id:'1',value:'Android'}});
  for (const value of ['2', 'unknown']) assert.throws(() => validateCustomPatch({[f.id]:value}, [f], 10, 20));
  assert.throws(() => validateCustomPatch({[f.id]:'1'}, [f], 11, 20));
  const multi = {...f, schema_custom:'jira:multicheckboxes'};
  assert.equal(validateCustomPatch({[f.id]:['1']}, [multi], 10, 20)[f.id][0].value, 'Android');
  assert.throws(() => validateCustomPatch({[f.id]:'1'}, [multi], 10, 20));
});
test('PATCH 잘못된 구조·숫자·날짜·URL·레이블 및 읽기 전용 거부', () => {
  for (const value of [[], null, 'bad']) assert.throws(() => validateCustomPatch(value, []));
  assert.throws(() => validateCustomPatch({unknown:1}, []));
  for (const [type, value] of [['float','3'], ['float',Infinity], ['datepicker','2026-02-30'], ['datepicker','oops'], ['url','javascript:alert(1)'], ['labels',['a',3]], ['textfield',{}], ['textarea',null], ['people',[]]]) {
    assert.throws(() => validateCustomPatch({customfield_10123:value}, [def(type)]), type);
  }
  for (const [type, value] of [['float',0], ['datepicker','2024-02-29'], ['labels',['a']], ['textfield','본문'], ['url','https://example.org']]) {
    assert.deepEqual(validateCustomPatch({customfield_10123:value}, [def(type)]), {customfield_10123:value});
    assert.equal(validateCustomPatch({customfield_10123:null}, [def(type)]).customfield_10123, null);
  }
});
function parse(src) { const params = []; const sql = parseJql(src, {p:v => {params.push(v); return `$${params.length}`;}, userId:7}); return {...sql, params}; }
test('JQL 이름·id·다중값·부정·EMPTY·텍스트 검색과 기존 조건 조합', () => {
  for (const src of ['cf[10073] = Android', 'customfield_10073 in (Android, iOS)', '"OS" != Android', '"OS" not in (Android, iOS)', '"OS" is empty', '"OS" is not empty', '"테스트 방법" ~ "검색어"', 'project = NEXT AND ("OS" = Android OR cf[10073] = iOS) ORDER BY updated DESC']) {
    const r = parse(src); assert.match(r.where, /jira_custom_search/); assert.match(r.where, /jira_fields cf/);
    assert.ok(r.params.some(p => Array.isArray(p) && p.includes('customfield_10019')));
  }
  assert.ok(parse('cf[10073] = Android').params.includes('customfield_10073'));
  assert.ok(parse('"OS" = Android').params.includes('OS'));
  assert.match(parse('"OS" != Android').where, /cardinality/);
  assert.throws(() => parse('cf[10019] = 1'), JqlError);
  assert.match(parse('"Training Days" = 3.0').where, /x::numeric/);
  assert.throws(() => parse('"OS" > 5'), JqlError);
  assert.throws(() => parse('"OS" ~ EMPTY'), JqlError);
  const attack = parse('"OS" = "x\'); DROP TABLE jira_issues; --"');
  assert.ok(!attack.where.includes('DROP TABLE')); assert.ok(attack.params.includes("x'); DROP TABLE jira_issues; --"));
});
