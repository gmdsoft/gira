#!/usr/bin/env node
// 원본은 GET만 사용: node scripts/import-templates.mjs --space FB
import { parseArgs } from 'node:util';
import { query, closeDb } from '../server/src/db.mjs';
import { importTemplates } from './lib/import-templates.mjs';
try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
const { values } = parseArgs({ options: { space: { type: 'string' } } });
if (!values.space) throw new Error('사용법: node scripts/import-templates.mjs --space KEY');
const site = (process.env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
const auth = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
async function get(path, attempt = 0) {
  const url = new URL(path, site);
  if (url.origin !== new URL(site).origin) throw new Error('원본 사이트 밖의 URL 거부');
  const res = await fetch(url, { method: 'GET', headers: { Authorization: auth, Accept: 'application/json' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw Object.assign(new Error(`템플릿 GET 실패: ${res.status}`), { status: res.status });
  return res.json();
}
try { console.log(`템플릿 ${await importTemplates(values.space, { get, query })}개 이관 완료`); }
finally { await closeDb(); }
