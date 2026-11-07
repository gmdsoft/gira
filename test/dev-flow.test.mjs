// 개발참여 자동 처리 흐름 — 단계 판정·순서·승인 담당자·메일 본문·깨우기 (합성 데이터만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, orderActions, approverEmails, enqueueMail, L } from '../scripts/lib/dev-flow.mjs';
import { mailHtml } from '../server/src/notify.mjs';
import { kickDevFlow } from '../server/src/dev-flow-kick.mjs';

const it = (labels, extra = {}) => ({ key: 'GIRA-1', type: '작업', statusName: '해야 할 일', statusCategory: 'new', labels: ['dev-chat', ...labels], lastCommentByAgent: null, ...extra });

test('단계 판정: 새 이슈·승인·정보 요청·검토·마무리, 건드리지 않는 이슈', () => {
  assert.equal(classify(it([])), 'process');
  assert.equal(classify({ ...it([]), labels: [] }), null, '개발참여 이슈가 아니면 대상 아님');
  assert.equal(classify(it([L.human])), null);
  assert.equal(classify(it([], { type: '에픽' })), null);
  assert.equal(classify(it([], { statusName: '보류' })), null);
  assert.equal(classify(it([L.running])), null);
  assert.equal(classify(it([L.failed])), null);
  // 승인: 요청 전 → 메일, 요청 후 → 대기, 레이블 제거(승인) → 처리
  assert.equal(classify(it([L.approval])), 'request-approval');
  assert.equal(classify(it([L.approval, L.approvalAsked])), null);
  assert.equal(classify(it([L.approvalAsked])), 'process');
  // 정보 요청: 보고자가 답해야 다시 처리
  assert.equal(classify(it([L.info], { lastCommentByAgent: true })), null);
  assert.equal(classify(it([L.info], { lastCommentByAgent: false })), 'process');
  // 검토: 사람이 새 댓글을 달면 revise
  const review = { statusName: '검토', statusCategory: 'indeterminate' };
  assert.equal(classify(it([L.review], { ...review, lastCommentByAgent: true })), null);
  assert.equal(classify(it([L.review], { ...review, lastCommentByAgent: false })), 'revise');
  // 완료: 검토 중이던 것만 마무리(머지), 실패·충돌 표시가 있으면 멈춤
  const done = { statusName: '완료', statusCategory: 'done' };
  assert.equal(classify(it([L.review], done)), 'finalize');
  assert.equal(classify(it([], done)), null);
  assert.equal(classify(it([L.review, L.conflict], done)), null);
  assert.equal(classify(it([L.review, L.failed], done)), null);
});

test('처리 순서: 마무리·승인 요청 → 수정 요청 → 새 이슈(우선순위·키)', () => {
  const out = orderActions([
    { key: 'GIRA-9', action: 'process', priority: 'Normal' },
    { key: 'GIRA-3', action: 'process', priority: 'High' },
    { key: 'GIRA-2', action: 'process', priority: 'Normal' },
    { key: 'GIRA-7', action: 'revise', priority: 'Low' },
    { key: 'GIRA-8', action: 'finalize', priority: 'Low' },
  ]).map((x) => x.key);
  assert.deepEqual(out, ['GIRA-8', 'GIRA-7', 'GIRA-3', 'GIRA-2', 'GIRA-9']);
});

test('승인 담당자 = 프로젝트 기본 담당자만 (없거나, 에이전트 계정이거나, 메일이 없으면 아무에게도 보내지 않음)', async () => {
  const q = (rows) => async () => ({ rows });
  assert.deepEqual(await approverEmails(q([{ id: 1, display_name: '담당', email: 'lead@corp.example', is_agent: false }])), ['lead@corp.example']);
  assert.deepEqual(await approverEmails(q([])), []);
  assert.deepEqual(await approverEmails(q([{ id: 2, display_name: '에이전트', email: null, is_agent: true }])), []);
  assert.deepEqual(await approverEmails(q([{ id: 3, display_name: '테스트', email: 'test@gira.local', is_agent: false }])), []);
});

test('메일: 대기열에 넣고(받을 사람 없으면 안 넣음), 본문에 안내와 추가 링크(http만)', async () => {
  const calls = [];
  const q = async (sql, params) => { calls.push(params); return { rows: [] }; };
  assert.equal(await enqueueMail(q, { to: [null, 'x@y.local'], subject: 's', url: 'u' }), false);
  assert.equal(await enqueueMail(q, { to: ['r@corp.example'], subject: '검토 요청', url: 'http://g/browse/GIRA-1', note: '확인해 주세요', links: [{ label: '테스트', url: 'http://h:4101' }] }), true);
  assert.equal(calls.length, 1); assert.equal(calls[0][2], 'r@corp.example');
  const html = mailHtml({ subject: '검토 <요청>', url: 'http://g/browse/GIRA-1', note: '한 줄\n두 줄', links: [{ label: 'Gonfluence', url: 'http://h:4101' }, { label: '나쁨', url: 'javascript:alert(1)' }] });
  assert.match(html, /검토 &lt;요청&gt;/); assert.match(html, /한 줄<br>두 줄/); assert.match(html, /href="http:\/\/h:4101"/);
  assert.doesNotMatch(html, /javascript:/);
});

test('깨우기: DEV_FLOW=1일 때만, 몰려 온 이벤트는 한 번으로', async () => {
  let runs = 0;
  assert.equal(kickDevFlow({ env: {}, run: () => runs++ }), false);
  for (let i = 0; i < 3; i++) kickDevFlow({ env: { DEV_FLOW: '1' }, delayMs: 20, run: () => runs++ });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(runs, 1);
});

test('머지: feature → develop 머지·푸시, 충돌이면 되돌리고 알림, 커밋 안 된 변경이 있으면 거부 (임시 저장소)', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { git, developDir, mergeToDevelop } = await import('../scripts/lib/dev-flow-git.mjs');
  const base = mkdtempSync(join(tmpdir(), 'devflow-git-'));
  try {
    const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];
    const g = (cwd, ...a) => git(cwd, [...cfg, ...a]);
    git(base, ['init', '-q', '--bare', '-b', 'develop', 'remote.git']);
    git(base, ['clone', '-q', join(base, 'remote.git'), 'main']);
    const main = join(base, 'main');
    g(main, 'checkout', '-q', '-b', 'develop');
    writeFileSync(join(main, 'a.txt'), '1\n'); g(main, 'add', '.'); g(main, 'commit', '-q', '-m', 'init'); g(main, 'push', '-q', 'origin', 'develop');
    g(main, 'checkout', '-q', '-b', 'feature/gira-1'); writeFileSync(join(main, 'b.txt'), 'x\n'); g(main, 'add', '.'); g(main, 'commit', '-q', '-m', 'GIRA-1');
    g(main, 'checkout', '-q', 'develop', '-b', 'feature/gira-2'); writeFileSync(join(main, 'a.txt'), 'feature\n'); g(main, 'commit', '-qam', 'GIRA-2');
    g(main, 'checkout', '-q', '--detach');
    g(main, 'worktree', 'add', '-q', join(base, 'dev'), 'develop');
    const dev = developDir(main);
    assert.equal(dev, join(base, 'dev'));
    for (const k of ['user.name', 'user.email']) git(dev, ['config', k, k === 'user.name' ? 't' : 't@example.invalid']);
    // 1) 깨끗한 머지 + 푸시
    const ok = mergeToDevelop(dev, 'feature/gira-1', 'develop: GIRA-1 머지');
    assert.equal(ok.merged, true); assert.equal(ok.pushed, true);
    assert.match(git(join(base, 'remote.git'), ['log', '--oneline', '-1', 'develop']).stdout, /GIRA-1 머지/);
    // 2) 충돌: develop에서 같은 줄을 바꿔 두면 GIRA-2 머지는 충돌 → 되돌림
    writeFileSync(join(dev, 'a.txt'), 'develop\n'); g(dev, 'commit', '-qam', 'develop change');
    const bad = mergeToDevelop(dev, 'feature/gira-2', 'develop: GIRA-2 머지');
    assert.equal(bad.merged, false); assert.match(bad.conflict, /CONFLICT|충돌|conflict/i);
    assert.equal(git(dev, ['status', '--porcelain']).stdout.trim(), '', '충돌 후 작업 폴더가 깨끗해야 한다');
    // 3) 커밋 안 된 변경 / 없는 브랜치는 거부
    writeFileSync(join(dev, 'a.txt'), 'dirty\n');
    assert.throws(() => mergeToDevelop(dev, 'feature/gira-1', 'm'), /커밋 안 된 변경/);
    assert.throws(() => mergeToDevelop(dev, 'feature/none', 'm'), /브랜치/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
