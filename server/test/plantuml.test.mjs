import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerPlantuml, plantumlPath } from '../src/plantuml.mjs';

test('렌더 서버 미설정 시 외부 요청 없이 503', async () => {
  const previous = process.env.PLANTUML_URL;
  delete process.env.PLANTUML_URL;
  const app = Fastify(); registerPlantuml(app);
  try {
    const res = await app.inject('/api/plantuml/svg?src=Alice');
    assert.equal(res.statusCode, 503);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.PLANTUML_URL; else process.env.PLANTUML_URL = previous;
  }
});
test('PlantUML 인코딩은 URL 경로 문자만 사용', () => {
  assert.match(plantumlPath('@startuml\nAlice -> Bob: 합성 예시\n@enduml'), /^[0-9A-Za-z_-]+$/);
});
