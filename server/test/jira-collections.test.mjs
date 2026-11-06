import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadCollection, quickFilterJql, gadgetParams } from '../src/jira-collections.mjs';
import { parseJql } from '../src/jql.mjs';
import { aggregate } from '../src/jira-stats.mjs';
test('빠른 필터는 선택한 JQL만 개별 AND 조건으로 보존한다',()=>{
 const board={quickfilters:[{source_id:1,jql:'status = "Open" OR priority = 1'},{source_id:2,jql:'assignee = currentUser()'}]};
 const clauses=quickFilterJql(board,'1,2,9');
 assert.deepEqual(clauses,board.quickfilters.map(q=>q.jql));
 assert.equal(clauses.map(q=>`(${q})`).join(' AND '),'(status = "Open" OR priority = 1) AND (assignee = currentUser())');
 assert.deepEqual(quickFilterJql(board,''),[]);
 const params=[]; const p=v=>{params.push(v);return `$${params.length}`;};
 const sql=clauses.map(jql=>`(${parseJql(jql,{p,userId:7}).where})`).join(' AND ');
 assert.match(sql,/OR/); assert.match(sql,/AND/); assert.equal(params.at(-1),7);
});
test('소유자 및 이름이 일치한 그룹과 접근 가능한 프로젝트만 공유한다',()=>{
 const access={userId:7,groups:['engineers'],projects:[{id:'10',key:'DEMO'}]};
 assert.equal(canReadCollection({owner_id:'7',share:[]},access),true);
 for (const share of [[{type:'group',group:{name:'engineers'}}],[{type:'project',project:{id:'10'}}]]) assert.equal(canReadCollection({owner_id:8,share},access),true);
 for (const share of [[],[{type:'group',group:{name:'unknown'}}],[{type:'project',project:{id:11}}],[{type:'project',project:{id:10},role:{id:5}}],[{type:'global'}]]) assert.equal(canReadCollection({owner_id:8,share},access),false);
});
test('지원 가젯은 공통 집계 API 파라미터로 변환한다',()=>{
 const gadget=(uri,preferences)=>gadgetParams({uri,preferences});
 assert.deepEqual(gadget('filter-results-gadget',{filterId:'filter-123'}),{filter:'123',jql:'',type:'results'});
 assert.deepEqual(gadget('piechart-gadget',{filterId:{value:'123'},statType:'issuetype'}),{filter:'123',jql:'',type:'pie',field:'issuetype'});
 assert.deepEqual(gadget('two-dimensional-stats-gadget',{xstattype:'status',ystattype:'assignee'}),{filter:'',jql:'',type:'two',x:'status',y:'assignee'});
 assert.equal(gadget('createdvsresolved-gadget',{daysprevious:60}).days,60);
 assert.equal(gadget('sprint-health',{}),null);
});
test('필터 결과는 집계 API에서 제한된 목록만 반환한다',()=>{
 const result=aggregate(Array.from({length:120},(_,i)=>({issue_key:`DEMO-${i}`,summary:'Synthetic',fields_raw:{secret:'hidden'}})),{type:'results'});
 assert.equal(result.total,120);assert.equal(result.rows.length,100);
 assert.deepEqual(result.rows[0],{issue_key:'DEMO-0',summary:'Synthetic'});
});
