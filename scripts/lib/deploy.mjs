import process from 'node:process';
import { spawnSync } from 'node:child_process';

function runGit(args, { cwd } = {}) {
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

export function runDeployShortcut({ cwd = process.cwd(), remote = 'origin', setUpstream = true } = {}) {
  const repo = runGit(['rev-parse', '--is-inside-work-tree'], { cwd });
  if (!repo.ok || repo.stdout.trim() !== 'true') {
    return {
      ok: false,
      error: 'Not inside a git repository.',
      stdout: repo.stdout,
      stderr: repo.stderr,
    };
  }

  const branchResult = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (!branchResult.ok) {
    return {
      ok: false,
      error: 'Unable to resolve current git branch.',
      stdout: branchResult.stdout,
      stderr: branchResult.stderr,
    };
  }
  const branch = branchResult.stdout.trim();
  if (!branch || branch === 'HEAD') {
    return {
      ok: false,
      error: 'Detached HEAD is not deployable. Check out a branch first.',
    };
  }

  const upstreamResult = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd });
  const hasUpstream = upstreamResult.ok;

  const pushArgs = hasUpstream
    ? ['push']
    : setUpstream
      ? ['push', '--set-upstream', remote, branch]
      : ['push', remote, branch];
  const pushResult = runGit(pushArgs, { cwd });

  if (!pushResult.ok) {
    return {
      ok: false,
      branch,
      remote,
      hasUpstream,
      usedSetUpstream: !hasUpstream && setUpstream,
      command: `git ${pushArgs.join(' ')}`,
      error: 'Git push failed.',
      output: pushResult.stdout.trim(),
      stderr: pushResult.stderr.trim(),
    };
  }

  return {
    ok: true,
    branch,
    remote,
    hasUpstream,
    usedSetUpstream: !hasUpstream && setUpstream,
    command: `git ${pushArgs.join(' ')}`,
    output: pushResult.stdout.trim(),
    stderr: pushResult.stderr.trim(),
  };
}
