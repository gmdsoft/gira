// 팀장 셀프 이관: 본인 Atlassian API 토큰을 등록하고 원본 Jira 프로젝트/Confluence 스페이스를
// 선택해 가져온다. 원본 호출은 전부 읽기 전용(GET)이며, 이관은 기존 임포터 스크립트를
// 자식 프로세스로 실행한다. 완료되면 이관한 사람이 그 리소스의 관리자가 된다 (기본 비공개 정책).
//
// - 토큰은 AES-256-GCM으로 암호화해 저장(atlassian_tokens), 평문은 다시 보여주지 않는다.
// - 작업(import_jobs)은 한 사용자당 동시에 1개, 로그는 폴링으로 조회한다.
import { spawn } from 'node:child_process';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';
import { cookieSecret } from './auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SITE = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');

let keyCache = null;
async function encKey() {
  if (!keyCache) keyCache = createHash('sha256').update('atl-token:' + await cookieSecret()).digest();
  return keyCache;
}
async function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await encKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
async function decrypt(buf) {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', await encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

const KINDS = {
  jira: {
    jobKind: 'jira-project',
    checkPath: '/rest/api/3/myself',
    steps: (key) => [
      ['scripts/jira-import-project.mjs', '--project', key],
      ['scripts/jira-import-changelog.mjs', '--project', key],
      ['scripts/jira-import-boards.mjs', '--project', key],
    ],
    env: () => ({
      DATABASE_URL: process.env.GIRA_DATABASE_URL ?? process.env.DATABASE_URL,
      DB_SCHEMAS: 'schema-core.sql,schema-jira.sql',
    }),
    async listRemote(auth) {
      const out = [];
      let url = SITE + '/rest/api/3/project/search?maxResults=100&orderBy=key';
      for (let i = 0; i < 10 && url; i += 1) {
        const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
        if (!res.ok) throw Object.assign(new Error(`원본 Jira 응답 ${res.status}`), { status: 502 });
        const d = await res.json();
        out.push(...(d.values ?? []).map((p) => ({ key: p.key, name: p.name })));
        url = d.isLast ? null : (d.nextPage ?? null);
      }
      return out;
    },
    localKeys: async () => (await query(`SELECT key FROM jira_projects`)).rows.map((r) => r.key),
    grant: (key, userId) => query(
      `INSERT INTO jira_project_permissions (project_id, principal_type, principal_id, role)
       SELECT id, 'user', $2, 'admin' FROM jira_projects WHERE key = $1 ON CONFLICT DO NOTHING`, [key, userId]),
  },
  conf: {
    jobKind: 'conf-space',
    checkPath: '/wiki/rest/api/user/current',
    steps: (key) => [
      ['scripts/import-space.mjs', '--space', key],
      ['scripts/import-versions.mjs', '--space', key],
    ],
    env: () => ({
      DATABASE_URL: process.env.DATABASE_URL,
      DB_SCHEMAS: 'schema-core.sql,schema.sql',
    }),
    async listRemote(auth) {
      const out = [];
      let url = SITE + '/wiki/api/v2/spaces?limit=250&status=current';
      for (let i = 0; i < 10 && url; i += 1) {
        const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
        if (!res.ok) throw Object.assign(new Error(`원본 Confluence 응답 ${res.status}`), { status: 502 });
        const d = await res.json();
        out.push(...(d.results ?? []).map((s) => ({ key: s.key, name: s.name, type: s.type })));
        url = d._links?.next ? SITE + d._links.next : null;
      }
      // 일반 스페이스 먼저, 개인 스페이스는 뒤로
      return out.sort((a, b) =>
        (a.type === 'personal') - (b.type === 'personal') || a.key.localeCompare(b.key));
    },
    localKeys: async () => (await query(`SELECT key FROM spaces`)).rows.map((r) => r.key),
    grant: (key, userId) => query(
      `INSERT INTO space_permissions (space_id, principal_type, principal_id, role)
       SELECT id, 'user', $2, 'admin' FROM spaces WHERE key = $1 ON CONFLICT DO NOTHING`, [key, userId]),
  },
};

export function registerSelfMigrate(app, { kind }) {
  const K = KINDS[kind];
  const basic = (email, token) => 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

  async function myToken(userId) {
    const { rows } = await query(`SELECT email, token_enc FROM atlassian_tokens WHERE user_id = $1`, [userId]);
    if (!rows.length) return null;
    return { email: rows[0].email, token: await decrypt(rows[0].token_enc) };
  }

  app.get('/api/migrate/token', async (req) => {
    const { rows } = await query(`SELECT email, created_at FROM atlassian_tokens WHERE user_id = $1`, [req.access.userId]);
    return rows.length ? { hasToken: true, email: rows[0].email, createdAt: rows[0].created_at } : { hasToken: false };
  });

  app.post('/api/migrate/token', async (req, reply) => {
    const email = req.body?.email?.trim();
    const token = req.body?.token?.trim();
    if (!email || !token) return reply.code(400).send({ error: '이메일과 API 토큰을 입력하세요' });
    if (!SITE) return reply.code(500).send({ error: 'ATLASSIAN_SITE가 설정되지 않았습니다' });
    // 읽기 전용 GET으로 토큰 검증
    const res = await fetch(SITE + K.checkPath, { headers: { Authorization: basic(email, token), Accept: 'application/json' } });
    if (!res.ok) return reply.code(400).send({ error: `토큰 검증 실패 (${res.status}) — 이메일/토큰을 확인하세요` });
    await query(
      `INSERT INTO atlassian_tokens (user_id, email, token_enc) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET email = $2, token_enc = $3, created_at = now()`,
      [req.access.userId, email, await encrypt(token)]);
    return { ok: true };
  });

  app.delete('/api/migrate/token', async (req) => {
    await query(`DELETE FROM atlassian_tokens WHERE user_id = $1`, [req.access.userId]);
    return { ok: true };
  });

  // 원본 목록 (이미 이관된 것 표시)
  app.get('/api/migrate/remote', async (req, reply) => {
    if (!req.access.canCreate) return reply.code(403).send({ error: '이관 권한이 없습니다 (팀장·파트장 또는 지정 그룹만)' });
    const cred = await myToken(req.access.userId);
    if (!cred) return reply.code(400).send({ error: 'API 토큰을 먼저 등록하세요', needToken: true });
    try {
      const [remote, local] = await Promise.all([K.listRemote(basic(cred.email, cred.token)), K.localKeys()]);
      const have = new Set(local);
      return remote.map((r) => ({ ...r, exists: have.has(r.key) }));
    } catch (e) {
      if (e.status) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  // 여러 개를 한 번에 선택하면 한 작업 안에서 순서대로 이관한다
  app.post('/api/migrate/run', async (req, reply) => {
    if (!req.access.canCreate) return reply.code(403).send({ error: '이관 권한이 없습니다 (팀장·파트장 또는 지정 그룹만)' });
    const keys = [...new Set([].concat(req.body?.keys ?? req.body?.key ?? [])
      .map((k) => String(k).trim().toUpperCase()).filter(Boolean))];
    if (!keys.length) return reply.code(400).send({ error: '가져올 대상을 선택하세요' });
    const cred = await myToken(req.access.userId);
    if (!cred) return reply.code(400).send({ error: 'API 토큰을 먼저 등록하세요', needToken: true });
    const have = new Set(await K.localKeys());
    const dup = keys.filter((k) => have.has(k));
    if (dup.length) return reply.code(409).send({ error: `이미 이관되어 있습니다: ${dup.join(', ')}` });
    const { rows: running } = await query(
      `SELECT id FROM import_jobs WHERE user_id = $1 AND status = 'running'`, [req.access.userId]);
    if (running.length) return reply.code(409).send({ error: '진행 중인 이관이 끝난 뒤 다시 시도하세요' });
    const { rows } = await query(
      `INSERT INTO import_jobs (user_id, kind, target) VALUES ($1, $2, $3) RETURNING id`,
      [req.access.userId, K.jobKind, keys.join(', ')]);
    runJob(rows[0].id, keys, cred, req.access.userId); // 백그라운드 (await 하지 않음)
    return { id: rows[0].id };
  });

  app.get('/api/migrate/jobs', async (req) => {
    const { rows } = await query(
      `SELECT id, kind, target, status, right(log, 4000) AS log, created_at, finished_at
         FROM import_jobs WHERE user_id = $1 ORDER BY id DESC LIMIT 20`, [req.access.userId]);
    return rows;
  });

  async function runJob(jobId, keys, cred, userId) {
    // 로그는 1초 간격으로 모아서 기록 (UPDATE 폭주 방지)
    let buf = '';
    let closed = false;
    const flush = async () => {
      if (!buf) return;
      const chunk = buf; buf = '';
      await query(`UPDATE import_jobs SET log = left(log || $2, 200000) WHERE id = $1`, [jobId, chunk])
        .catch((e) => console.error('[migrate] log flush 실패:', e.message));
    };
    const timer = setInterval(() => { if (!closed) flush(); }, 1000);
    const append = (t) => { buf += t; };
    try {
      for (const key of keys) {
        append(`\n===== ${key} 이관 시작 =====\n`);
        for (const [script, ...args] of K.steps(key)) {
          append(`\n$ node ${script} ${args.join(' ')}\n`);
          await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(ROOT, script), ...args], {
              cwd: ROOT,
              env: {
                ...process.env,
                ATLASSIAN_EMAIL: cred.email,
                ATLASSIAN_API_TOKEN: cred.token,
                ...K.env(),
              },
            });
            child.stdout.on('data', (d) => append(d.toString()));
            child.stderr.on('data', (d) => append(d.toString()));
            child.on('error', reject);
            child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${script} 종료 코드 ${code}`))));
          });
        }
        await K.grant(key, userId); // 이관한 사람이 리소스 관리자
        append(`\n${key} 완료 — 이관한 사용자에게 관리자 권한을 부여했습니다.\n`);
      }
      await flush();
      await query(`UPDATE import_jobs SET status = 'done', finished_at = now() WHERE id = $1`, [jobId]);
    } catch (e) {
      append(`\n오류: ${e.message}\n`);
      await flush();
      await query(`UPDATE import_jobs SET status = 'error', finished_at = now() WHERE id = $1`, [jobId]);
    } finally {
      closed = true;
      clearInterval(timer);
    }
  }
}
