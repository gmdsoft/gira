import { readFileSync } from 'node:fs';
import { normalizeDatabase } from '../scripts/lib/confluence-database.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDatabase, saveDatabase } from '../server/src/database-edit.mjs';
import { viewRows } from '../web/src/database-model.mjs';
const make = () => ({fields:[{id:'t',name:'이름',type:'t'},{id:'n',name:'수',type:'n'},{id:'d',name:'날짜',type:'d'},{id:'s',name:'선택',type:'s',options:[{id:'a',label:'A'}]},{id:'u',name:'사용자',type:'u'},{id:'h',name:'링크',type:'h'},{id:'ji',name:'이슈',type:'ji'},{id:'pl',name:'문서',type:'pl'},{id:'i',name:'파일',type:'i'},{id:'jid',name:'계산',type:'jid'}],rows:[{id:'1',cells:{t:'가',n:10,d:'2026-11-06',s:['a'],u:[{a:'synthetic',d:'테스트'}],h:[{u:'https://example.org'}],ji:[{k:'TEST-1'}],pl:[{c:'1000000000001'}],i:[{name:'합성'}],jid:'읽기 전용'}}],views:[{id:'v',name:'표',type:'table',hiddenFields:[],sort:[]}]});
test('형식별 값과 읽기 전용 값 검증', () => {
  const original = make(); assert.doesNotThrow(() => validateDatabase(make(), original));
  for (const [id,value] of [['t',1],['n','1'],['d','2026-02-30'],['s',['missing']],['u',[{a:1}]],['h',[{u:'javascript:alert(1)'}]],['ji',[{k:'wrong'}]],['pl',[{c:'abc'}]],['i',[]],['jid','변경']]) {
    const data = make(); data.rows[0].cells[id] = value; assert.throws(() => validateDatabase(data,original), id);
  }
  const omitted = make(); delete omitted.rows[0].cells.i; assert.throws(() => validateDatabase(omitted,original));
  const data = make(); data.fields[0].type = 'unknown'; assert.throws(() => validateDatabase(data,original));
});
test('잘못된 보기 참조 거부', () => {
  for (const patch of [{groupBy:'t'},{hiddenFields:['missing']},{sort:[{field:'missing',ascending:true}]},{filter:{t:'c',f:'missing',v:'a'}}]) {
    const data = make(); Object.assign(data.views[0],patch); assert.throws(() => validateDatabase(data,make()));
  }
});
test('저장 버전 충돌은 쓰지 않고 최신 데이터 반환', async () => {
  const calls = []; const client = {query:async (sql) => { calls.push(sql); return {rows:sql.includes('FOR UPDATE') ? [{type:'database',current_version:2}] : [{data:make()}]}; }};
  const result = await saveDatabase(client,{id:'1',baseVersion:1,data:make(),userId:'1'});
  assert.equal(result.status,409); assert.equal(result.currentVersion,2); assert.deepEqual(result.data,make()); assert.equal(calls.length,2); assert.match(calls[0],/FOR UPDATE/);
});
test('저장 성공은 새 스냅샷·이력·현재 버전을 기록', async () => {
  const calls = []; const client = {query:async (sql,args) => { calls.push([sql,args]); return {rows:sql.includes('FOR UPDATE') ? [{type:'database',current_version:2}] : [{data:make()}]}; }};
  const result = await saveDatabase(client,{id:'1',baseVersion:2,data:make(),userId:'synthetic'});
  assert.equal(result.version,3); assert.equal(calls.length,5); assert.match(calls[2][0],/INSERT INTO database_snapshots/); assert.match(calls[3][0],/content_versions/); assert.equal(calls[4][1][1],3);
});
test('보기 텍스트·다중선택·날짜 범위 필터와 숫자 정렬', () => {
  const d = make(); d.rows.push({id:'2',cells:{t:'나',n:2,d:'2026-10-01',s:[]}});
  assert.deepEqual(viewRows(d,{sort:[{field:'n',ascending:true}]}).map(r=>r.id),['2','1']);
  for (const filter of [{t:'c',f:'t',v:'가'},{t:'eq',f:'s',v:['a']},{t:'range',f:'d',v:['2026-11-01','2026-11-30']}]) assert.deepEqual(viewRows(d,{filter}).map(r=>r.id),['1']);
});

test('합성 이관 스냅샷의 기존 값은 보존하며 새 값은 검증', () => {
  for (const id of ['943521921','135694426','1103429634','120422433','47614020']) {
    const data = normalizeDatabase(readFileSync(new URL(`./fixtures/database-${id}.ybin`, import.meta.url)));
    assert.doesNotThrow(() => validateDatabase(structuredClone(data), data));
  }
});
