import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { issueVisibilitySql, viewableIssues, commentVisibilitySql } from '../src/perm.mjs';

// In-memory synthetic fixtures only. Exercise the actual SQL predicate, not a duplicate JS policy.
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE jira_issues (id INTEGER, project_id INTEGER, security_level_id TEXT, fields_raw TEXT, reporter_id INTEGER, assignee_id INTEGER);
    CREATE TABLE jira_projects (id INTEGER, lead_id INTEGER);
    CREATE TABLE jira_project_permissions (project_id INTEGER, principal_type TEXT, principal_id INTEGER, role TEXT);
    CREATE TABLE jira_security_members (level_id TEXT, kind TEXT, value TEXT);
    CREATE TABLE users (id INTEGER, confluence_account_id TEXT);
    CREATE TABLE groups (id INTEGER, name TEXT);
    CREATE TABLE user_groups (user_id INTEGER, group_id INTEGER);
    CREATE TABLE jira_comments (id INTEGER, issue_id INTEGER, visibility TEXT);
    INSERT INTO jira_projects VALUES (1, 7), (2, 7);
    INSERT INTO users VALUES (7, 'synthetic-account');
    INSERT INTO jira_project_permissions VALUES (1, 'anyone', NULL, 'viewer');
    INSERT INTO jira_issues VALUES (1,1,NULL,'{}',NULL,NULL), (2,1,'restricted','{}',NULL,NULL),
      (3,1,NULL,'{"security":{"id":"restricted"}}',NULL,NULL), (4,2,NULL,'{}',7,7);
    INSERT INTO jira_comments VALUES (1,1,NULL), (2,1,'{"type":"group","value":"synthetic-internal"}'),
      (3,1,'{"type":"role","identifier":"10003","value":"Administrators"}');`);
  return db;
}
const access = { userId: 7, isAdmin: false, groups: [], teams: [] };
const visible = (db, a = access) => db.prepare(`SELECT id FROM ${viewableIssues(a)} i ORDER BY id`).all().map(r => r.id);

test('missing level/member/group stays closed, including fields_raw fallback and project boundary', () => {
  const db = fixture();
  try {
    assert.deepEqual(visible(db), [1]);
    db.exec("INSERT INTO jira_security_members VALUES ('restricted','group','synthetic-internal')");
    assert.deepEqual(visible(db), [1]);
    db.exec("INSERT INTO groups VALUES (11,'synthetic-internal')");
    assert.deepEqual(visible(db), [1]);
    db.exec('INSERT INTO user_groups VALUES (7,11)');
    assert.deepEqual(visible(db), [1,2,3]);
    db.exec('DELETE FROM user_groups');
    assert.deepEqual(visible(db), [1]);
  } finally { db.close(); }
});
test('role 10003 maps to project admin; unknown roles are denied', () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO jira_security_members VALUES ('restricted','role','10003')");
    assert.deepEqual(visible(db), [1]);
    db.exec("INSERT INTO jira_project_permissions VALUES (1,'user',7,'admin')");
    assert.deepEqual(visible(db), [1,2,3]);
    db.exec("DELETE FROM jira_project_permissions WHERE role = 'admin'; UPDATE jira_security_members SET value = 'unknown'");
    assert.deepEqual(visible(db), [1]);
  } finally { db.close(); }
});
for (const kind of ['user', 'reporter', 'assignee', 'projectLead']) test(`${kind} principal matches within project only`, () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO jira_security_members VALUES (?,?,?)').run('restricted',kind,kind === 'user' ? 'synthetic-account' : '');
    if (kind === 'reporter' || kind === 'assignee') {
      assert.deepEqual(visible(db), [1]);
      db.exec(`UPDATE jira_issues SET ${kind}_id = 7 WHERE project_id = 1`);
    }
    assert.deepEqual(visible(db), [1,2,3]);
  } finally { db.close(); }
});
test('anonymous denied, site admin allowed, malformed access cannot inject SQL', () => {
  assert.equal(issueVisibilitySql(null), 'FALSE');
  assert.equal(issueVisibilitySql({isAdmin:true}), 'TRUE');
  assert.throws(() => issueVisibilitySql({...access,userId:'7 OR TRUE'}), /Invalid access id/);
  assert.throws(() => issueVisibilitySql({...access,groups:['1); DROP TABLE users']}), /Invalid access id/);
});
test('comments: public, group name and role identifier visibility', () => {
  const db = fixture();
  const comments = () => db.prepare(`SELECT c.id FROM jira_comments c JOIN jira_issues ci ON ci.id=c.issue_id
    WHERE ${commentVisibilitySql(access)} ORDER BY c.id`).all().map(r=>r.id);
  try {
    assert.deepEqual(comments(), [1]);
    db.exec("INSERT INTO groups VALUES (11,'synthetic-internal'); INSERT INTO user_groups VALUES (7,11)");
    assert.deepEqual(comments(), [1,2]);
    db.exec("INSERT INTO jira_project_permissions VALUES (1,'user',7,'admin')");
    assert.deepEqual(comments(), [1,2,3]);
  } finally { db.close(); }
});
test('counts, parent joins and link endpoints use identical SQL scope', () => {
  const db = fixture();
  try {
    assert.equal(db.prepare(`SELECT count(*) n FROM ${viewableIssues(access)} i`).get().n,1);
    assert.equal(db.prepare(`SELECT parent.id FROM ${viewableIssues(access)} i LEFT JOIN ${viewableIssues(access)} parent ON parent.id=2 WHERE i.id=1`).get().id,null);
  } finally { db.close(); }
});

test('notifications exclude denied recipients and restricted shared channels', async () => {
  const { createNotifier } = await import('../src/notify.mjs');
  const writes = [];
  const notifier = createNotifier({
    app:'gira', env:{NOTIFY:'0'},
    authorize:async ({userId, external}) => !external && userId === 7,
    query:async (sql, params) => {
      if (sql.includes('FROM notify_rules')) return {rows:[{id:1,channel:'teams',target:'https://example.invalid'}]};
      if (sql.startsWith('INSERT')) writes.push({sql,params});
      return {rows:[]};
    },
  });
  await notifier.emit({actorId:1,actorName:'Synthetic actor',event:'issue.created',path:'/browse/SYN-1',baseUrl:'https://synthetic.invalid',
    resourceType:'project',resourceId:1,title:'Synthetic restricted issue',people:{reporter:7,assignee:8}});
  assert.equal(writes.length,1);
  assert.match(writes[0].sql,/INSERT INTO notifications/);
  assert.equal(writes[0].params[0],7);
});
