import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSecurity, securityMember } from '../lib/jira-security.mjs';

test('source holders normalize group, role, user and dynamic principals; unknown denied', () => {
  for (const [type, kind] of [['group','group'],['projectrole','role'],['user','user'],['reporter','reporter'],['assignee','assignee'],['projectlead','projectLead']]) {
    assert.deepEqual(securityMember({issueSecurityLevelId:'level',holder:{type,parameter:'synthetic'}}),{levelId:'level',kind,value:'synthetic'});
  }
  assert.equal(securityMember({holder:{type:'unknown'}}),null);
});
test('GET metadata pagination completes before old grants are cleared; all source groups map by name', async () => {
  const paths = [], writes = [];
  const get = async path => {
    paths.push(path);
    assert.equal(writes.length,0);
    if (path.includes('/project/')) return {id:'scheme'};
    if (!path.includes('/level/member')) return {name:'Synthetic scheme',levels:[{id:'level',name:'Synthetic level'}]};
    if (path.includes('startAt=0')) return {values:[{issueSecurityLevelId:'level',holder:{type:'group',parameter:'synthetic-group'}}],isLast:false,total:2};
    return {values:[{issueSecurityLevelId:'level',holder:{type:'projectrole',parameter:'10003'}}],isLast:true,total:2};
  };
  await importSecurity({ get, project:{id:1,key:'SYN'}, query: async (sql,params) => {
    writes.push({sql,params}); return {rows:sql.startsWith('SELECT 1 FROM groups') ? [{exists:1}] : []};
  }});
  assert.equal(paths.length,4);
  const grants = writes.filter(w=>w.sql.startsWith('INSERT INTO jira_security_members'));
  assert.deepEqual(grants.map(w=>w.params),[['level','group','synthetic-group'],['level','role','10003']]);
  assert.match(writes[0].sql,/DELETE FROM jira_security_members/);
});
test('metadata failure never silently opens issues or modifies existing grants', async () => {
  const writes=[];
  await assert.rejects(importSecurity({project:{key:'SYN'},query:async (...a)=>writes.push(a),get:async()=>{throw new Error('denied');}}),/denied/);
  assert.deepEqual(writes,[]);
});
