#!/usr/bin/env node
// 상태·이슈 유형 별칭(번역 전 이름) 채우기 — 사용: node scripts/jira-name-aliases.mjs
import { configureDb, query, closeDb } from '../server/src/db.mjs';
import { jiraGet } from './lib/jira-source-get.mjs';
import { syncNameAliases } from './lib/jira-name-aliases.mjs';
try { process.loadEnvFile('.env'); } catch { /* 환경변수 직접 지정 가능 */ }
if (!process.env.GIRA_DATABASE_URL || !process.env.ATLASSIAN_SITE) throw new Error('Gira DB 및 Atlassian 환경변수가 필요합니다.');
configureDb({ url: process.env.GIRA_DATABASE_URL, schemas: ['schema-core.sql', 'schema-jira.sql'] });
const AUTH = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64');
try { console.log('갱신', await syncNameAliases(jiraGet(process.env.ATLASSIAN_SITE.replace(/\/$/, ''), AUTH), query)); }
finally { await closeDb(); }
