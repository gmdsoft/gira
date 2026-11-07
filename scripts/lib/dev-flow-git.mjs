// 개발참여 자동 처리: 보고자 검토가 끝난 feature 브랜치를 develop에 머지·푸시 (충돌이면 되돌리고 알린다)
import { spawnSync } from 'node:child_process';

export const git = (cwd, args, ok = false) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !ok) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return r;
};

// repoDir 저장소에서 develop이 체크아웃된 worktree 경로
export function developDir(repoDir) {
  const out = git(repoDir, ['worktree', 'list', '--porcelain']).stdout;
  const m = out.split('\n\n').map((b) => ({ dir: /^worktree (.+)$/m.exec(b)?.[1], br: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] })).find((w) => w.br === 'develop');
  if (!m) throw new Error('develop worktree를 찾지 못했습니다');
  return m.dir;
}

// → { merged: true, head, pushed, pushError } | { merged: false, conflict: '…' }  (그 밖의 문제는 예외)
export function mergeToDevelop(dev, branch, message, { remote = 'origin' } = {}) {
  if (git(dev, ['rev-parse', '--verify', '--quiet', branch], true).status !== 0) throw new Error(`브랜치 ${branch}가 없습니다`);
  if (git(dev, ['status', '--porcelain', '--untracked-files=no']).stdout.trim()) throw new Error('develop worktree에 커밋 안 된 변경이 있어 머지하지 않았습니다');
  const hasRemote = git(dev, ['remote'], true).stdout.split('\n').includes(remote);
  if (hasRemote) {
    git(dev, ['fetch', '-q', remote, 'develop']);
    // 원격이 앞서 있으면 먼저 따라간다 (갈라져 있으면 그대로 두고 아래 푸시에서 드러난다)
    git(dev, ['merge', '--ff-only', '-q', `${remote}/develop`], true);
  }
  const m = git(dev, ['merge', '--no-ff', '-q', branch, '-m', message], true);
  if (m.status !== 0) {
    git(dev, ['merge', '--abort'], true);
    return { merged: false, conflict: (m.stdout + m.stderr).trim().slice(0, 800) };
  }
  const head = git(dev, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  if (!hasRemote) return { merged: true, head, pushed: false, pushError: '원격 없음' };
  const p = git(dev, ['push', '-q', remote, 'develop'], true);
  return { merged: true, head, pushed: p.status === 0, pushError: p.status === 0 ? null : (p.stderr || '').trim().slice(0, 300) };
}
