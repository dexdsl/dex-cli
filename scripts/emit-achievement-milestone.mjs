#!/usr/bin/env node
import { emitAchievementMilestoneHook, resolveEventsEnv } from './lib/worker-hooks.mjs';

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [name, inlineValue] = token.split('=', 2);
    if (inlineValue !== undefined) {
      flags[name.slice(2)] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[name.slice(2)] = next;
      index += 1;
      continue;
    }
    flags[name.slice(2)] = 'true';
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const auth0Sub = String(flags.sub || flags.auth0Sub || '').trim();
  if (!auth0Sub) {
    throw new Error('Missing --sub (auth0 subject).');
  }

  const env = resolveEventsEnv(flags.env || process.env.DEX_EVENTS_ENV || 'prod');
  const result = await emitAchievementMilestoneHook({
    env,
    auth0Sub,
    badgeId: flags.badgeId || '',
    badgeTitle: flags.badge || flags.badgeTitle || 'Achievement milestone reached',
    level: flags.level || 'base',
    href: flags.href || '/entry/achievements/',
    metadata: {
      source: flags.source || 'manual-achievement-hook',
      runId: flags.runId || '',
    },
  });

  if (result.ok) {
    console.log(`achievements:event sent (${env})`);
    return;
  }
  if (result.skipped) {
    throw new Error(`achievements:event skipped: ${result.reason || 'not configured'}`);
  }
  throw new Error(`achievements:event failed: ${result.error || result.status || 'unknown error'}`);
}

main().catch((error) => {
  console.error(`emit-achievement-milestone failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

