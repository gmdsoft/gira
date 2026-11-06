// AI 도움말(GIRA-15)·AI 검색(GIRA-17). 개발참여 챗봇과 같은 키·모델·설정(ANTHROPIC_API_KEY, DEV_CHAT_MODEL, DEV_CHAT_EFFORT)을 쓴다.
//  - 도움말: 사용법 질문 + 지금 보는 화면(앱·주소·화면 이름) → 짧은 안내. 문서·이슈 내용은 보내지 않는다.
//    지침은 ai-help/guide.md, 사이트 관리자가 화면에서 고친 판(DATA_DIR/ai-help-guide.md)이 있으면 그것.
//  - AI 검색(Gira만): 자연어 질문 → JQL. 모델에는 질문·오늘 날짜·필드와 실제 값 목록만 보내고, 이슈 데이터는 보내지 않는다.
//    만든 JQL은 서버 JQL 파서로 검사하고(틀리면 한 번 고쳐 받음), 실제 검색은 기존 목록 API가 사용자 권한 안에서 한다.
//  - 사용량: ai_usage 테이블, 사용자별 하루 상한 AI_DAILY_LIMIT(기능별, 기본 30)
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_GUIDE = readFileSync(path.join(here, 'ai-help', 'guide.md'), 'utf8');
const MODEL = process.env.DEV_CHAT_MODEL ?? 'claude-sonnet-5-5';
const EFFORT = process.env.DEV_CHAT_EFFORT ?? 'low';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 30);
let client = null;
const getClient = () => (client ??= new Anthropic());

// 응답 형식: JSON 스키마 출력(output_config.format) — 이 모델은 도구 강제 호출(tool_choice)을 받지 않는다
const JQL_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      jql: { type: 'string', description: 'JQL (현재 프로젝트 안에서 실행된다 — project 조건은 넣지 않는다). 질문이 정렬을 원하면 ORDER BY 포함' },
      explanation: { type: 'string', description: '이 JQL이 무엇을 찾는지 한국어 한 문장' },
      assumptions: { type: 'array', items: { type: 'string' }, description: '모호한 말을 어떻게 해석했는지 (예: "닫음 → 해결 상태 \'작업 안함\'으로 봄"). 없으면 빈 배열' },
      answerable: { type: 'boolean', description: 'JQL로 찾을 수 있는 질문이면 true. 사용법 질문 등 이슈 검색이 아니면 false' },
    },
    required: ['jql', 'explanation', 'assumptions', 'answerable'],
    additionalProperties: false,
  },
};

const JQL_GUIDE = `너는 Gira(Jira와 비슷한 이슈 관리 도구)의 JQL 작성기다. 사용자의 자연어 질문을 Gira JQL 한 줄로 바꾼다.
정해진 JSON 형식(jql, explanation, assumptions, answerable)으로만 답한다.

## Gira JQL 문법 (이것만 지원한다)
- 연산자: = != ~ > >= < <=, IN (...), NOT IN (...), IS EMPTY, IS NOT EMPTY, AND, OR, NOT, 괄호
- ORDER BY <필드> [ASC|DESC] (필드: key, created, updated, resolved, priority, status, summary)
- 필드: key, summary, text(요약+설명 검색, ~만), status, statusCategory(new|indeterminate|done), type, assignee, reporter,
  priority, resolution, sprint, labels, fixVersion, component, parent, created, updated, resolved
- 함수: currentUser() (나), openSprints(), activeSprints(), unreleasedVersions(), releasedVersions()
- 날짜 값: "2026-01-01", "2026-01-01 09:00", 상대값 -7d -4w -12h -30m. 범위는 >= 와 < 를 같이 쓴다.
  예: 2026년 → resolved >= "2026-01-01" AND resolved < "2027-01-01"
- 값 비교는 대소문자를 가리지 않는다. 띄어쓰기가 있는 값은 큰따옴표로 감싼다.
- 담당자·보고자는 표시 이름으로 비교한다 (예: assignee = "김성곤"). '나'는 currentUser().
- '완료한/처리한' 이슈는 statusCategory = done 과 resolved 날짜를 쓴다. '열린/남은' 이슈는 statusCategory != done.

## 규칙
- 아래 '사용할 수 있는 값'에 있는 값만 쓴다. 질문의 말이 여러 값에 걸치면 IN으로 묶고 assumptions에 적는다.
- 질문이 '개수'를 물어도 JQL만 만든다(개수는 화면이 세어 보여 준다).
- 프로젝트 조건은 넣지 않는다(현재 프로젝트 안에서 실행됨).
- JQL로 표현할 수 없는 조건은 빼고 assumptions에 "…은 반영하지 못함"이라고 적는다.`;

export function registerAiAssist(app, { query, appName, dataDir, jql }) {
  const guideFile = path.join(dataDir, 'ai-help-guide.md');
  const guideText = async () => {
    try { return await readFile(guideFile, 'utf8'); } catch { return BASE_GUIDE; }
  };

  async function quota(req, reply, feature) {
    if (!process.env.ANTHROPIC_API_KEY) { reply.code(503).send({ error: 'AI 기능이 설정되지 않았습니다 (ANTHROPIC_API_KEY)' }); return false; }
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM ai_usage WHERE user_id = $1 AND feature = $2 AND created_at > now() - interval '1 day'`,
      [req.access.userId, feature]);
    if (rows[0].n >= DAILY_LIMIT) { reply.code(429).send({ error: `오늘 사용 한도(${DAILY_LIMIT}회)를 넘었습니다. 내일 다시 써 주세요.` }); return false; }
    return true;
  }
  const record = (req, feature, usage, ok = true) => query(
    `INSERT INTO ai_usage (user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ok)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [req.access.userId, feature, MODEL, usage?.input_tokens ?? null, usage?.output_tokens ?? null,
     usage?.cache_read_input_tokens ?? null, usage?.cache_creation_input_tokens ?? null, ok]).catch(() => {});
  const apiError = (reply, e) => {
    if (e instanceof Anthropic.RateLimitError) return reply.code(429).send({ error: 'AI 요청이 많습니다. 잠시 뒤 다시 시도하세요.' });
    if (e instanceof Anthropic.AuthenticationError) return reply.code(503).send({ error: 'AI 키 설정을 확인하세요' });
    return reply.code(502).send({ error: `AI 응답 실패: ${e.message ?? e}` });
  };

  // ---------- 도움말 ----------
  app.post('/api/ai/help', async (req, reply) => {
    const question = String(req.body?.question ?? '').trim().slice(0, 1000);
    if (!question) return reply.code(400).send({ error: '질문을 입력하세요' });
    if (!await quota(req, reply, 'help')) return;
    const s = req.body?.screen ?? {};
    const clean = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
    const screen = `[지금 화면] 앱: ${appName} · 주소: ${clean(s.path, 200)} · 화면: ${clean(s.title, 120)}${s.view ? ` · 보기: ${clean(s.view, 40)}` : ''}`;
    // 이전 대화(이 패널에서 주고받은 문답)는 최근 4번만
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-4)
      .flatMap((h) => [{ role: 'user', content: clean(h.q, 1000) }, { role: 'assistant', content: clean(h.a, 2000) }])
      .filter((m) => m.content);
    try {
      const resp = await getClient().messages.create({
        model: MODEL, max_tokens: 2000,
        output_config: { effort: EFFORT },
        system: [{ type: 'text', text: await guideText(), cache_control: { type: 'ephemeral' } }],
        messages: [...history, { role: 'user', content: `${screen}\n\n${question}` }],
      });
      await record(req, 'help', resp.usage);
      const answer = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (resp.stop_reason === 'refusal' || !answer) return { answer: '이 질문에는 답할 수 없습니다. 표현을 바꿔 다시 물어봐 주세요.' };
      return { answer };
    } catch (e) { await record(req, 'help', null, false); return apiError(reply, e); }
  });

  // 지침 보기·고치기 (사이트 관리자)
  app.get('/api/ai/help/guide', async (req, reply) => {
    if (!req.access.isAdmin) return reply.code(403).send({ error: '사이트 관리자만 볼 수 있습니다' });
    return { text: await guideText(), custom: existsSync(guideFile), base: BASE_GUIDE };
  });
  app.put('/api/ai/help/guide', async (req, reply) => {
    if (!req.access.isAdmin) return reply.code(403).send({ error: '사이트 관리자만 고칠 수 있습니다' });
    const text = String(req.body?.text ?? '');
    if (text.length > 60000) return reply.code(400).send({ error: '너무 깁니다 (6만 자 이하)' });
    await mkdir(dataDir, { recursive: true });
    if (!text.trim() || text === BASE_GUIDE) { await writeFile(guideFile, BASE_GUIDE); return { ok: true, custom: false }; }
    await writeFile(guideFile, text);
    return { ok: true, custom: true };
  });

  // ---------- AI 검색 (Gira) ----------
  if (!jql) return;
  app.post('/api/ai/jql', async (req, reply) => {
    const question = String(req.body?.question ?? '').trim().slice(0, 500);
    if (!question) return reply.code(400).send({ error: '찾을 조건을 말해 주세요' });
    const project = await jql.resolveProject(req, reply, String(req.body?.project ?? ''));
    if (!project) return;
    if (!await quota(req, reply, 'jql')) return;
    const values = await jql.values(project.id);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const context = [
      `[오늘] ${today} (KST)`, `[현재 프로젝트] ${project.key}`,
      ...Object.entries(values).map(([k, v]) => `[${k}] ${v.length ? v.map((x) => JSON.stringify(x)).join(', ') : '(없음)'}`),
    ].join('\n');
    const messages = [{ role: 'user', content: `${context}\n\n[질문] ${question}` }];
    let usage = null;
    try {
      for (let round = 0; round < 2; round += 1) {
        const resp = await getClient().messages.create({
          model: MODEL, max_tokens: 2000, output_config: { effort: EFFORT, format: JQL_FORMAT },
          system: [{ type: 'text', text: JQL_GUIDE, cache_control: { type: 'ephemeral' } }],
          messages,
        });
        usage = resp.usage;
        await record(req, 'jql', usage);
        const text = resp.content.find((b) => b.type === 'text')?.text;
        let out;
        try { out = JSON.parse(text ?? ''); } catch { return reply.code(502).send({ error: 'AI가 JQL을 만들지 못했습니다' }); }
        if (!out.answerable) return { answerable: false, explanation: out.explanation, assumptions: out.assumptions ?? [] };
        const err = jql.check(out.jql);
        if (!err) return { answerable: true, jql: out.jql.trim(), explanation: out.explanation, assumptions: out.assumptions ?? [] };
        // 문법 오류면 한 번만 고쳐 받는다
        messages.push({ role: 'assistant', content: resp.content },
          { role: 'user', content: `방금 JQL에 오류가 있다: ${err}. 지원 문법 안에서 다시 만들어 줘.` });
      }
      return reply.code(422).send({ error: 'AI가 만든 JQL이 올바르지 않습니다. 질문을 바꿔 보세요.' });
    } catch (e) { await record(req, 'jql', usage, false); return apiError(reply, e); }
  });
}
