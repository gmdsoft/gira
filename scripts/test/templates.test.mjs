import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, blueprintTemplate, templateId, templateTitle } from '../../shared/templates.mjs';
import { convertTemplate, importTemplates } from '../lib/import-templates.mjs';

test('FB 제목 규칙과 EDUCATION 고정 접두사를 보존한다', () => {
  const date = new Date('2026-11-06T12:00:00Z');
  assert.equal(templateTitle('1. 영업_@currentDate', '영업', 'FB', date), '1. 영업_2026-11-06');
  assert.equal(templateTitle('@spaceName @currentDate @currentDate', '영업', '사업부', date), '사업부 2026-11-06 2026-11-06');
  assert.equal(templateTitle('Survey_', '교육', 'EDUCATION', date), 'Survey_');
  assert.equal(templateTitle(' ', '교육 만족도', 'EDUCATION', date), '교육 만족도');
});
test('네 블루프린트 모듈과 UUID+표시 라벨을 기본 템플릿에 매핑한다', () => {
  for (const t of BUILTIN_TEMPLATES) {
    assert.equal(blueprintTemplate({ blueprintModuleCompleteKey: `plugin:${t.id}-blueprint` }).id, t.id);
    assert.equal(blueprintTemplate({ contentBlueprintId: 'instance-uuid', createButtonLabel: `${t.name} 만들기` }).id, t.id);
    assert.equal(t.doc.type, 'doc');
  }
  assert.equal(blueprintTemplate({ contentBlueprintId: 'unknown' }), null);
  assert.equal(templateId({ templateName: '57737223' }), '57737223');
  assert.equal(templateId({ templateId: '27600072' }), '27600072');
});
test('템플릿 storage를 표/본문/중첩 매크로를 포함한 문서로 변환한다', () => {
  const source = { templateId: '27600072', name: '영업', labels: [{ name: 'weekly' }],
    body: { storage: { value: '<h2>영업 보고</h2><table><tbody><tr><td><p>실적</p></td></tr></tbody></table><ac:structured-macro ac:name="create-from-template"><ac:parameter ac:name="spaceKey"><ri:space ri:space-key="FB"/></ac:parameter><ac:parameter ac:name="templateName">27600072</ac:parameter></ac:structured-macro>' } } };
  const t = convertTemplate(source);
  assert.deepEqual(t.labels, ['weekly']);
  assert.equal(t.sourceXhtml, source.body.storage.value);
  assert.equal(t.doc.content[0].type, 'heading');
  assert.ok(t.doc.content.some((n) => n.type === 'table'));
  assert.match(JSON.stringify(t.doc), /ri:space-key/);
});
test('이관은 목록 페이지네이션/상세 GET/404 건너뛰기와 원본 id 보존을 처리한다', async () => {
  const paths = [], writes = [];
  const count = await importTemplates('FB', {
    get: async (path) => {
      paths.push(path);
      if (path.includes('spaceKey=FB')) return { results: [{ templateId: '27600072' }], _links: { next: '/rest/api/template/page?start=1' } };
      if (path.includes('start=1')) return { results: [{ templateId: '57737223' }] };
      if (path.includes('57737223')) throw Object.assign(new Error('404'), { status: 404 });
      return { templateId: '27600072', name: '영업', body: { storage: { value: '<p>보고 내용</p>' } } };
    },
    query: async (sql, params) => { if (sql.startsWith('SELECT')) return { rows: [{ id: '123' }] }; writes.push(params); return { rows: [] }; },
  });
  assert.equal(count, 1);
  assert.equal(writes[0][0], '27600072');
  assert.match(writes[0][5], /보고 내용/);
  assert.ok(paths.includes('/wiki/rest/api/template/page?start=1'));
});

test('생성 API는 권한 검사 후 FB 제목/본문/부모를 초안으로 원자적으로 저장한다', async () => {
  const { default: Fastify } = await import('fastify');
  const { registerTemplates } = await import('../../server/src/templates.mjs');
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.access = { userId: 7 }; });
  const calls = [];
  let role = 'editor', view = true;
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '영업 보고 본문' }] }] };
  const client = { query: async (sql, params) => {
    calls.push({ sql, params }); return { rows: sql.includes('RETURNING id') ? [{ id: '1000000000001' }] : [] };
  }, release() {} };
  registerTemplates(app, {
    query: async (sql) => ({ rows: sql.includes('FROM spaces') ? [{ id: '123', name: 'FB' }] : [{ id: '27600072', name: '영업', doc, labels: [] }] }),
    getDb: async () => ({ connect: async () => client }),
    spaceRole: async () => role,
    contentAccess: async () => ({ view, spaceId: '123' }),
  });
  const request = () => app.inject({ method: 'POST', url: '/api/spaces/FB/templates/27600072/create', payload: { parentId: '27525802', title: '1. 영업_@currentDate' } });
  try {
    assert.equal((await request()).statusCode, 200);
    const content = calls.find((c) => c.sql.includes('INSERT INTO content('));
    assert.equal(content.params[1], '27525802');
    assert.match(content.params[2], /^1\. 영업_\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(JSON.parse(calls.find((c) => c.sql.includes('INSERT INTO drafts')).params[1]), doc);
    assert.equal(calls.at(-1).sql, 'COMMIT');
    calls.length = 0; role = 'viewer';
    assert.equal((await request()).statusCode, 403);
    assert.equal(calls.length, 0);
    role = 'editor'; view = false;
    assert.equal((await request()).statusCode, 403);
    assert.equal(calls.length, 0);
    assert.equal((await app.inject({ method: 'POST', url: '/api/spaces/FB/templates/not-found/create', payload: {} })).statusCode, 404);
  } finally { await app.close(); }
});

test('템플릿 변경은 스페이스 관리자만 가능하고 기본 템플릿은 보호한다', async () => {
  const { default: Fastify } = await import('fastify');
  const { registerTemplates } = await import('../../server/src/templates.mjs');
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.access = { userId: 7 }; });
  let role = 'editor';
  const writes = [];
  registerTemplates(app, {
    query: async (sql) => { if (!sql.startsWith('SELECT')) writes.push(sql); return { rows: [{ id: '123', name: 'FB' }] }; },
    spaceRole: async () => role,
  });
  try {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const url = '/api/spaces/FB/templates' + (method === 'POST' ? '' : '/27600072');
      assert.equal((await app.inject({ method, url, payload: {} })).statusCode, 403);
    }
    assert.equal(writes.length, 0);
    role = 'admin';
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/spaces/FB/templates/meeting-notes' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/spaces/FB/templates', payload: {} })).statusCode, 400);
    assert.equal(writes.length, 0);
  } finally { await app.close(); }
});

test('templateName이 없는 id면 templateId로 찾는다 (FB 주간 보고 버튼)', async () => {
  const { templateId } = await import('../../shared/templates.mjs');
  const params = { title: '@currentDate_영업', templateId: '27600076', buttonLabel: '영업 보고', templateName: '57737223' };
  assert.equal(templateId(params, new Set(['27600076', 'meeting-notes'])), '27600076');
  assert.equal(templateId(params, new Set(['meeting-notes'])), null);
});
