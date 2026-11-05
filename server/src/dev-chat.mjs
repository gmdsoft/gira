// 개발참여 챗봇: 사용자의 자연어 요청을 Claude가 해석해 답하고, 필요한 작업은 GIRA 개발 프로젝트에
// 이슈(에픽~하위 작업)로 생성한다. 지침은 dev-agent/guidelines.md (시스템 프롬프트로 전달).
// 대화는 dev_chat_* 테이블에 API 응답 블록 그대로 append-only로 저장한다 (thinking 블록 보존 규칙).
// 필요한 환경변수: ANTHROPIC_API_KEY (없으면 503), 선택: DEV_CHAT_MODEL (기본 claude-opus-5-5)
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GUIDELINES = readFileSync(path.join(here, 'dev-agent', 'guidelines.md'), 'utf8');
const MODEL = process.env.DEV_CHAT_MODEL ?? 'claude-opus-5-5';
const DEV_PROJECT_KEY = 'GIRA';
const MAX_TOOL_ROUNDS = 8;

// 계층 → Gira 이슈 타입 이름 (프로젝트 공용 타입 사전에서 이름으로 찾는다)
const TYPE_NAMES = { epic: '에픽', story: '스토리', task: '작업', subtask: '하위 작업', bug: '버그' };

const TOOLS = [
  {
    name: 'search_issues',
    description: 'GIRA 개발 프로젝트에서 제목·설명에 검색어가 들어간 기존 이슈를 찾는다 (최대 10건). '
      + '새 이슈를 만들기 전에 중복 확인용으로 쓴다.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '찾을 단어나 짧은 구절' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_issues',
    description: 'GIRA 개발 프로젝트에 이슈를 한 번에 생성한다. 에픽과 그 하위 이슈를 함께 만들 수 있다 — '
      + '각 항목에 임시 ref를 주고, 하위 항목의 parent에 상위 항목의 ref(또는 기존 이슈 키 GIRA-n)를 적는다. '
      + '상위가 없으면 parent는 빈 문자열. 결과로 생성된 이슈 키 목록을 돌려준다.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: '이 호출 안에서만 쓰는 임시 식별자 (예: e1, t1)' },
              type: { type: 'string', enum: ['epic', 'story', 'task', 'subtask', 'bug'] },
              summary: { type: 'string', description: '한 줄 제목' },
              description: { type: 'string', description: '배경, 할 일, 완료 조건(확인 방법)' },
              parent: { type: 'string', description: '상위 항목의 ref 또는 기존 이슈 키, 없으면 빈 문자열' },
              executor: { type: 'string', enum: ['codex', 'opencode', 'human'] },
              needs_approval: { type: 'boolean' },
              spec_update: { type: 'boolean' },
            },
            required: ['ref', 'type', 'summary', 'description', 'parent', 'executor', 'needs_approval', 'spec_update'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
];

let client = null;
const getClient = () => (client ??= new Anthropic()); // ANTHROPIC_API_KEY 환경변수에서 읽는다

// ---------- 자동 처리: 디스패처를 백그라운드로 실행 ----------
// 즉시 처리 가능한 이슈(agent:codex|opencode, 승인 불필요)가 생기거나 승인되면 호출한다.
// 동시에 하나만 돌리고, 실행 중 요청이 또 오면 끝난 뒤 한 번 더 돈다. DEV_AUTO_DISPATCH=0 이면 끈다.
const ROOT = path.join(here, '..', '..');
let dispatching = false;
let dispatchAgain = false;
export function triggerDispatch() {
  if (process.env.DEV_AUTO_DISPATCH === '0') return;
  if (dispatching) { dispatchAgain = true; return; }
  dispatching = true;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-dispatcher.mjs'), '--run', '--all'], {
    cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const done = () => {
    dispatching = false;
    if (dispatchAgain) { dispatchAgain = false; triggerDispatch(); }
  };
  child.on('close', done);
  child.on('error', (e) => { console.error('[dispatch] 실행 실패:', e.message); done(); });
}

// ---------- 도구 구현 ----------

async function devProject() {
  const { rows } = await query(`SELECT id, key FROM jira_projects WHERE key = $1`, [DEV_PROJECT_KEY]);
  if (!rows.length) throw new Error('GIRA 개발 프로젝트가 없습니다');
  return rows[0];
}

async function toolSearch({ query: q }) {
  const pr = await devProject();
  const { rows } = await query(
    `SELECT i.issue_key, i.summary, s.name AS status, t.name AS type
       FROM jira_issues i
       LEFT JOIN jira_statuses s ON s.id = i.status_id
       LEFT JOIN jira_issue_types t ON t.id = i.issue_type_id
      WHERE i.project_id = $1
        AND (i.summary ILIKE '%' || $2 || '%' OR i.description_adf::text ILIKE '%' || $2 || '%')
      ORDER BY i.updated_at DESC NULLS LAST LIMIT 10`, [pr.id, String(q ?? '').trim()]);
  return rows.length ? rows : '일치하는 이슈가 없습니다';
}

async function toolCreate({ items }, ctx, textToAdf) {
  if (!Array.isArray(items) || !items.length) throw new Error('items가 비어 있습니다');
  const pr = await devProject();
  const { rows: st } = await query(`SELECT id FROM jira_statuses WHERE category = 'new' ORDER BY id LIMIT 1`);
  const typeId = {};
  for (const [k, name] of Object.entries(TYPE_NAMES)) {
    const { rows } = await query(`SELECT id FROM jira_issue_types WHERE name = $1 ORDER BY id LIMIT 1`, [name]);
    typeId[k] = rows[0]?.id ?? null;
  }
  const byRef = new Map(); // ref -> {id, key}
  const created = [];
  // 1차: 생성 (parent 없이) — 순서 무관하게 ref를 참조할 수 있도록
  for (const it of items) {
    const { rows: mx } = await query(
      `SELECT COALESCE(MAX(split_part(issue_key, '-', 2)::int), 0) + 1 AS n FROM jira_issues WHERE project_id = $1`,
      [pr.id]);
    const key = `${pr.key}-${mx[0].n}`;
    const labels = ['dev-chat', `agent:${it.executor}`];
    if (it.needs_approval) labels.push('needs-approval');
    if (it.spec_update) labels.push('spec-update');
    const body = [it.description?.trim() || it.summary,
      `— 요청: ${ctx.author ?? '알 수 없음'} (${ctx.source}, 개발참여 챗봇)`].join('\n\n');
    const { rows } = await query(
      `INSERT INTO jira_issues (id, project_id, issue_key, issue_type_id, status_id, summary, description_adf,
         labels, reporter_id, created_at, updated_at, fields_raw)
       VALUES (nextval('jira_issue_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, now(), now(), '{}')
       RETURNING id, issue_key`,
      [pr.id, key, typeId[it.type] ?? typeId.task, st[0]?.id ?? null, it.summary.trim(),
       JSON.stringify(textToAdf(body)), labels, ctx.userId]);
    byRef.set(it.ref, { id: rows[0].id, key: rows[0].issue_key });
    created.push({ ref: it.ref, key: rows[0].issue_key, type: it.type, summary: it.summary.trim(),
      executor: it.executor, needsApproval: !!it.needs_approval, parent: it.parent || null });
  }
  // 2차: 상위 연결 (같은 호출의 ref 또는 기존 이슈 키)
  for (const c of created) {
    if (!c.parent) continue;
    let pid = byRef.get(c.parent)?.id;
    if (!pid) {
      const { rows } = await query(
        `SELECT id FROM jira_issues WHERE issue_key = $1 AND project_id = $2`, [c.parent.toUpperCase(), pr.id]);
      pid = rows[0]?.id;
    }
    if (pid) {
      await query(`UPDATE jira_issues SET parent_id = $2 WHERE id = $1`, [byRef.get(c.ref).id, pid]);
      c.parent = byRef.get(c.parent)?.key ?? c.parent.toUpperCase();
    } else {
      c.parent = null;
    }
  }
  return created;
}

// ---------- 대화 ----------

async function loadHistory(sessionId) {
  const { rows } = await query(
    `SELECT role, content FROM dev_chat_messages WHERE session_id = $1 ORDER BY id`, [sessionId]);
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

const saveMessage = (sessionId, role, content) => query(
  `INSERT INTO dev_chat_messages (session_id, role, content) VALUES ($1, $2, $3)`,
  [sessionId, role, JSON.stringify(content)]);

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

export function registerDevChat(app, { textToAdf }) {
  // 대화 진행: { sessionId?, message, author?, source? } → { sessionId, reply, created[] }
  app.post('/api/dev-chat', async (req, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({ error: '챗봇이 아직 설정되지 않았습니다 (ANTHROPIC_API_KEY 미설정 — 관리자에게 문의)' });
    }
    const message = String(req.body?.message ?? '').trim();
    if (!message) return reply.code(400).send({ error: '메시지를 입력하세요' });
    if (message.length > 8000) return reply.code(400).send({ error: '메시지가 너무 깁니다 (8,000자 이내)' });

    // 세션: 본인 것만 이어 쓴다. 없으면 새로 만든다.
    // Gonfluence 프록시는 서비스 키 하나로 들어오므로 작성자(author)까지 일치해야 같은 세션으로 본다
    let sessionId = Number(req.body?.sessionId) || null;
    if (sessionId) {
      const { rows } = await query(`SELECT user_id, author FROM dev_chat_sessions WHERE id = $1`, [sessionId]);
      if (!rows.length || Number(rows[0].user_id) !== req.access.userId
          || (req.body?.author && rows[0].author !== req.body.author)) sessionId = null;
    }
    const { rows: me } = await query(`SELECT display_name FROM users WHERE id = $1`, [req.access.userId]);
    const ctx = {
      userId: req.access.userId,
      author: req.body?.author || me[0]?.display_name || null,
      source: req.body?.source === 'Gonfluence' ? 'Gonfluence' : 'Gira',
    };
    if (!sessionId) {
      const { rows } = await query(
        `INSERT INTO dev_chat_sessions (user_id, author, source) VALUES ($1, $2, $3) RETURNING id`,
        [ctx.userId, ctx.author, ctx.source]);
      sessionId = Number(rows[0].id);
    }

    const messages = await loadHistory(sessionId);
    const userTurn = [{ type: 'text', text: `[${ctx.author ?? '사용자'} · ${ctx.source}에서]\n${message}` }];
    messages.push({ role: 'user', content: userTurn });
    await saveMessage(sessionId, 'user', userTurn);

    const created = [];
    let finalText = '';
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const resp = await getClient().beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          // 정책 거절 시 서버 측에서 다른 모델로 이어 처리 (refusal 대비)
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          system: [{ type: 'text', text: GUIDELINES, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
        });
        // 응답 블록은 가공하지 않고 그대로 이어 붙인다 (thinking·fallback 블록 보존)
        messages.push({ role: 'assistant', content: resp.content });
        await saveMessage(sessionId, 'assistant', resp.content);
        finalText = textOf(resp.content) || finalText;

        if (resp.stop_reason === 'refusal') {
          finalText = '이 요청은 처리할 수 없습니다. 표현을 바꿔 다시 요청해 주세요.';
          break;
        }
        if (resp.stop_reason !== 'tool_use') {
          if (resp.stop_reason === 'max_tokens') finalText += '\n\n(응답이 길어 중간에 끊겼습니다)';
          break;
        }
        if (round === MAX_TOOL_ROUNDS) { finalText ||= '처리 단계가 너무 많아 중단했습니다.'; break; }

        // 도구 실행 — 같은 응답의 tool_use는 결과를 한 user 메시지에 모아 돌려준다
        const results = [];
        for (const b of resp.content) {
          if (b.type !== 'tool_use') continue;
          try {
            let out;
            if (b.name === 'search_issues') out = await toolSearch(b.input);
            else if (b.name === 'create_issues') {
              out = await toolCreate(b.input, ctx, textToAdf);
              created.push(...out);
            } else throw new Error(`알 수 없는 도구: ${b.name}`);
            results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: String(e.message ?? e), is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
        await saveMessage(sessionId, 'user', results);
      }
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        return reply.code(503).send({ error: '챗봇 API 키가 올바르지 않습니다 (관리자에게 문의)', sessionId });
      }
      if (e instanceof Anthropic.RateLimitError) {
        return reply.code(429).send({ error: '요청이 많아 잠시 후 다시 시도해 주세요', sessionId });
      }
      if (e instanceof Anthropic.APIError) {
        req.log.error(e);
        return reply.code(502).send({ error: `챗봇 응답 오류 (${e.status ?? '연결'})`, sessionId });
      }
      throw e;
    }
    // 바로 처리 가능한 이슈가 생겼으면 하위 에이전트 처리를 시작한다
    const autoRun = created.filter((c) => c.executor !== 'human' && !c.needsApproval && c.type !== 'epic');
    if (autoRun.length) triggerDispatch();
    return {
      sessionId, reply: finalText || '(응답 없음)',
      created: created.map((c) => ({ ...c, autoStarted: autoRun.includes(c) && process.env.DEV_AUTO_DISPATCH !== '0' })),
    };
  });

  // 대화 다시 불러오기 (화면 표시용: 사용자·어시스턴트의 텍스트만)
  app.get('/api/dev-chat/:id', async (req, reply) => {
    const { rows: s } = await query(`SELECT user_id, author FROM dev_chat_sessions WHERE id = $1`, [req.params.id]);
    const mine = s.length && Number(s[0].user_id) === req.access.userId
      && (!req.query.author || s[0].author === req.query.author);
    if (!s.length || (!mine && !req.access.isAdmin)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const rows = await loadHistory(req.params.id);
    return rows
      .map((m) => ({ role: m.role, text: textOf(m.content).replace(/^\[[^\]\n]*에서\]\n/, '') }))
      .filter((m) => m.text);
  });
}
