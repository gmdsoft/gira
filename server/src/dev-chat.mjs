// 개발참여 챗봇: 사용자의 자연어 요청(첨부 파일 포함)을 Claude가 해석해 답하고, 필요한 작업은 GIRA 개발
// 프로젝트에 이슈(에픽~하위 작업)로 정확하게 등록한다 — 등록까지만 한다. 이슈 처리(디스패치)는 운영자가
// 개발 세션에서 이슈를 읽고 따로 수행한다. 지침은 dev-agent/guidelines.md (시스템 프롬프트로 전달).
// 대화는 dev_chat_* 테이블에 API 응답 블록 그대로 append-only로 저장한다 (thinking 블록 보존 규칙).
// 필요한 환경변수: ANTHROPIC_API_KEY (없으면 503), 선택: DEV_CHAT_MODEL (기본 claude-opus-5-5)
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, DATA_DIR } from './db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GUIDELINES = readFileSync(path.join(here, 'dev-agent', 'guidelines.md'), 'utf8');
// 승인 판단 기준인 개발 명세서 — 지침 뒤에 붙여 함께 캐시한다 (없으면 판단이 서지 않는 것으로 보고 승인 필요)
const SPEC_PATH = process.env.DEV_SPEC_PATH ?? path.join(here, '..', '..', 'docs', 'alpha-spec.md');
function specText() {
  try { return readFileSync(SPEC_PATH, 'utf8'); }
  catch { return '(개발 명세서를 불러오지 못했다 — 새 기능·정책 변경은 모두 승인 필요로 둔다)'; }
}
// 요금 최적화 기본값: 대화형 접수 업무라 Sonnet 5.5 + effort low (품질이 부족하면 환경변수로 올린다)
const MODEL = process.env.DEV_CHAT_MODEL ?? 'claude-sonnet-5-5';
const EFFORT = process.env.DEV_CHAT_EFFORT ?? 'low';
const DAILY_LIMIT = Number(process.env.DEV_CHAT_DAILY_LIMIT ?? 40); // 1인당 하루 메시지 상한
const DEV_PROJECT_KEY = 'GIRA';
const MAX_TOOL_ROUNDS = 8;
// 첨부: 한 메시지 최대 5개, 파일당 20MB. 모델에 보여주는 범위 — 이미지 5MB, PDF 10MB, 텍스트 100KB까지
const MAX_FILES_PER_MESSAGE = 5;
const MAX_UPLOAD = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXT = /\.(txt|log|md|json|csv|tsv|xml|ya?ml|ini|conf|js|mjs|jsx|ts|tsx|css|html|sql|sh|py)$/i;

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
              priority: { type: 'string', enum: ['Highest', 'High', 'Normal', 'Low'],
                description: '중요도에 따른 우선순위 (지침의 우선순위 기준)' },
              needs_approval: { type: 'boolean' },
              spec_update: { type: 'boolean' },
              attach_files: {
                type: 'array', items: { type: 'integer' },
                description: '이 이슈에 첨부할 파일 번호 (사용자가 올린 [첨부 #번호]). 없으면 빈 배열',
              },
            },
            required: ['ref', 'type', 'summary', 'description', 'parent', 'executor', 'priority', 'needs_approval', 'spec_update',
              'attach_files'],
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

// ---------- 첨부 파일 ----------

async function ownedFiles(ids, ctx) {
  const list = [...new Set((ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!list.length) return [];
  const { rows } = await query(
    `SELECT id, filename, media_type, file_size, local_key FROM dev_chat_files
      WHERE id = ANY($1::bigint[]) AND user_id = $2 AND ($3::text IS NULL OR author = $3) ORDER BY id`,
    [list, ctx.userId, ctx.proxied ? ctx.author : null]);
  return rows;
}

const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.ceil(n / 1024) + 'KB');

// 저장된 {type:'dev_file'} 자리표시를 API용 블록으로 펼친다 (DB에는 base64를 넣지 않는다).
// 같은 파일은 항상 같은 블록으로 펼쳐지므로 대화 캐시 접두가 유지된다.
async function expandFile(fileId) {
  const { rows } = await query(
    `SELECT id, filename, media_type, file_size, local_key FROM dev_chat_files WHERE id = $1`, [fileId]);
  const f = rows[0];
  if (!f) return [{ type: 'text', text: `[첨부 #${fileId}: 삭제된 파일]` }];
  const head = { type: 'text', text: `[첨부 #${f.id}: ${f.filename} (${f.media_type ?? '알 수 없는 형식'}, ${kb(Number(f.file_size))})]` };
  const size = Number(f.file_size);
  let data;
  try { data = await readFile(path.join(DATA_DIR, f.local_key)); } catch { return [head]; }
  if (IMAGE_TYPES.has(f.media_type) && size <= 5 * 1024 * 1024) {
    return [head, { type: 'image', source: { type: 'base64', media_type: f.media_type, data: data.toString('base64') } }];
  }
  if (f.media_type === 'application/pdf' && size <= 10 * 1024 * 1024) {
    return [head, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } }];
  }
  if ((f.media_type?.startsWith('text/') || /json|xml|yaml/.test(f.media_type ?? '') || TEXT_EXT.test(f.filename))
      && size <= 100 * 1024) {
    return [head, { type: 'text', text: `<file name="${f.filename}">\n${data.toString('utf8')}\n</file>` }];
  }
  return [{ type: 'text', text: head.text.replace(/\]$/, ' — 내용은 볼 수 없는 형식이거나 너무 큼. 이슈에는 첨부 가능]') }];
}

// ---------- 도구 구현 ----------

async function devProject() {
  const { rows } = await query(
    `SELECT id, key, default_assignee_id FROM jira_projects WHERE key = $1`, [DEV_PROJECT_KEY]);
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
         labels, reporter_id, assignee_id, priority, created_at, updated_at, fields_raw)
       VALUES (nextval('jira_issue_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), '{}')
       RETURNING id, issue_key`,
      [pr.id, key, typeId[it.type] ?? typeId.task, st[0]?.id ?? null, it.summary.trim(),
       JSON.stringify(textToAdf(body)), labels, ctx.userId,
       // 에이전트가 처리할 이슈는 프로젝트 기본 담당자(GIRA 에이전트), 사람 담당은 비워 둔다
       it.executor === 'human' ? null : (pr.default_assignee_id ?? null),
       ['Highest', 'High', 'Normal', 'Low'].includes(it.priority) ? it.priority : 'Normal']);
    byRef.set(it.ref, { id: rows[0].id, key: rows[0].issue_key });
    // 사용자가 올린 파일을 이슈 첨부로 복사 (본인 파일만)
    const files = await ownedFiles(it.attach_files, ctx);
    for (const f of files) {
      const localKey = path.join('jira-att', String(rows[0].id), `${f.id}-${f.filename.replace(/[^\w.\-]+/g, '_')}`);
      await mkdir(path.join(DATA_DIR, 'jira-att', String(rows[0].id)), { recursive: true });
      await copyFile(path.join(DATA_DIR, f.local_key), path.join(DATA_DIR, localKey));
      await query(
        `INSERT INTO jira_attachments (id, issue_id, filename, media_type, file_size, local_key, author_id, created_at)
         VALUES (nextval('jira_attachment_id_seq'), $1, $2, $3, $4, $5, $6, now())`,
        [rows[0].id, f.filename, f.media_type, f.file_size, localKey, ctx.userId]);
    }
    created.push({ ref: it.ref, key: rows[0].issue_key, type: it.type, summary: it.summary.trim(),
      executor: it.executor, priority: it.priority ?? 'Normal', needsApproval: !!it.needs_approval, parent: it.parent || null,
      attachments: files.map((f) => f.filename) });
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

async function loadHistory(sessionId, { expand = false } = {}) {
  const { rows } = await query(
    `SELECT role, content FROM dev_chat_messages WHERE session_id = $1 ORDER BY id`, [sessionId]);
  const out = rows.map((r) => ({ role: r.role, content: r.content }));
  if (expand) {
    for (const m of out) {
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      const blocks = [];
      for (const b of m.content) blocks.push(...(b.type === 'dev_file' ? await expandFile(b.file_id) : [b]));
      m.content = blocks;
    }
  }
  return out;
}

const saveMessage = (sessionId, role, content, usage = null) => query(
  `INSERT INTO dev_chat_messages (session_id, role, content, usage) VALUES ($1, $2, $3, $4)`,
  [sessionId, role, JSON.stringify(content), usage ? JSON.stringify({ model: MODEL, ...usage }) : null]);

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

export function registerDevChat(app, { textToAdf }) {
  // 첨부 올리기 (multipart, 파일 1개 + 선택 필드 author — Gonfluence 프록시가 파일보다 먼저 보낸다)
  app.post('/api/dev-chat/files', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '파일이 없습니다' });
    const buf = await file.toBuffer();
    if (buf.length > MAX_UPLOAD) return reply.code(413).send({ error: '파일이 너무 큽니다 (20MB 이내)' });
    if (!buf.length) return reply.code(400).send({ error: '빈 파일입니다' });
    const author = file.fields?.author?.value || null;
    const safe = file.filename.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
    const dir = path.join('dev-chat', String(req.access.userId));
    await mkdir(path.join(DATA_DIR, dir), { recursive: true });
    const localKey = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    await writeFile(path.join(DATA_DIR, localKey), buf);
    const { rows } = await query(
      `INSERT INTO dev_chat_files (user_id, author, filename, media_type, file_size, local_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.access.userId, author, file.filename, file.mimetype ?? null, buf.length, localKey]);
    return { id: Number(rows[0].id), filename: file.filename, mediaType: file.mimetype ?? null, size: buf.length };
  });

  // 대화 진행: { sessionId?, message, author?, source? } → { sessionId, reply, created[] }
  app.post('/api/dev-chat', async (req, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({ error: '챗봇이 아직 설정되지 않았습니다 (ANTHROPIC_API_KEY 미설정 — 관리자에게 문의)' });
    }
    const message = String(req.body?.message ?? '').trim();
    const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.slice(0, MAX_FILES_PER_MESSAGE + 1) : [];
    if (!message && !fileIds.length) return reply.code(400).send({ error: '메시지를 입력하세요' });
    if (fileIds.length > MAX_FILES_PER_MESSAGE) {
      return reply.code(400).send({ error: `첨부는 한 번에 ${MAX_FILES_PER_MESSAGE}개까지입니다` });
    }
    // 비용 상한: 1인당 하루 메시지 수 (작성자 기준 — Gonfluence 프록시는 author로 구분)
    const who = req.body?.author ?? null;
    const { rows: used } = await query(
      `SELECT count(*)::int AS n FROM dev_chat_messages m JOIN dev_chat_sessions s ON s.id = m.session_id
        WHERE s.user_id = $1 AND ($2::text IS NULL OR s.author = $2) AND m.role = 'user'
          AND m.content->0->>'type' = 'text' AND m.created_at > now() - interval '1 day'`,
      [req.access.userId, who]);
    if (used[0].n >= DAILY_LIMIT) {
      return reply.code(429).send({ error: `오늘 대화 한도(${DAILY_LIMIT}회)를 넘었습니다. 내일 다시 이용해 주세요.` });
    }
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
      proxied: !!req.body?.author,
    };
    const files = await ownedFiles(fileIds, ctx);
    if (files.length !== fileIds.length) return reply.code(400).send({ error: '첨부 파일을 찾을 수 없습니다 — 다시 올려 주세요' });
    if (!sessionId) {
      const { rows } = await query(
        `INSERT INTO dev_chat_sessions (user_id, author, source) VALUES ($1, $2, $3) RETURNING id`,
        [ctx.userId, ctx.author, ctx.source]);
      sessionId = Number(rows[0].id);
    }

    const messages = await loadHistory(sessionId, { expand: true });
    const userTurn = [
      ...files.map((f) => ({ type: 'dev_file', file_id: Number(f.id), filename: f.filename })),
      { type: 'text', text: `[${ctx.author ?? '사용자'} · ${ctx.source}에서]\n${message || '(첨부 파일만 보냄)'}` },
    ];
    await saveMessage(sessionId, 'user', userTurn);
    const expanded = [];
    for (const b of userTurn) expanded.push(...(b.type === 'dev_file' ? await expandFile(b.file_id) : [b]));
    messages.push({ role: 'user', content: expanded });

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
          output_config: { effort: EFFORT },
          // 캐시: 지침(+도구)은 고정 블록으로, 대화 기록은 자동 캐시로 — 이어지는 턴은 캐시 단가로 읽힌다
          cache_control: { type: 'ephemeral' },
          system: [{ type: 'text', text: `${GUIDELINES}\n\n---\n# 개발 명세서 (승인 판단 기준)\n\n${specText()}`,
            cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
        });
        // 응답 블록은 가공하지 않고 그대로 이어 붙인다 (thinking·fallback 블록 보존)
        messages.push({ role: 'assistant', content: resp.content });
        await saveMessage(sessionId, 'assistant', resp.content, resp.usage);
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
    return { sessionId, reply: finalText || '(응답 없음)', created };
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
      .map((m) => ({
        role: m.role,
        text: textOf(m.content).replace(/^\[[^\]\n]*에서\]\n/, '').replace(/^\(첨부 파일만 보냄\)$/, ''),
        files: (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === 'dev_file').map((b) => b.filename),
      }))
      .filter((m) => m.text || m.files.length);
  });
}
