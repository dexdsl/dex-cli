import {
  getSeason,
  readCatalogSeasonsFile,
  writeCatalogSeasonsFile,
  ensureSeason,
} from './catalog-seasons-store.mjs';

function parseArgs(rest = []) {
  const [subcommand = '', ...rawArgs] = rest;
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    values.push(arg);
  }
  return { subcommand, flags, values };
}

function parseSeasonId(flags, values) {
  return String(flags.get('--season') || values[0] || '').trim().toUpperCase();
}

function parseTokenPool(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseCount(raw) {
  const count = Number(raw);
  if (!Number.isFinite(count)) throw new Error('teaser --count must be numeric');
  return Math.round(count);
}

function printUsage() {
  console.log('Usage: dex catalog seasons <list|get|set|teaser> [args]');
  console.log('  dex catalog seasons list');
  console.log('  dex catalog seasons get --season S2');
  console.log('  dex catalog seasons set --season S3 --label "season 3 (\'26-)" --order 3');
  console.log('  dex catalog seasons teaser enable --season S3');
  console.log('  dex catalog seasons teaser disable --season S3');
  console.log('  dex catalog seasons teaser set --season S3 --count 1 --message "this artist has not been announced yet" --tokens "???,!!!,***,@@@" --style redacted');
}

function printSeasonRow(season) {
  const teaser = season?.unannounced || {};
  const tokens = Array.isArray(teaser.tokenPool) ? teaser.tokenPool.join(',') : '';
  console.log(`${season.id}\torder=${season.order}\tteaser=${teaser.enabled ? 'on' : 'off'}\tcount=${teaser.count}\ttokens=[${tokens}]\tlabel=${season.label}`);
}

export async function runCatalogSeasonsCommand(rest = []) {
  const { subcommand, flags, values } = parseArgs(rest);
  if (!subcommand) {
    printUsage();
    return;
  }

  const filePath = flags.get('--file');

  if (subcommand === 'list') {
    const { data } = await readCatalogSeasonsFile(filePath);
    if (!data.seasons.length) {
      console.log('catalog:seasons list empty');
      return;
    }
    data.seasons.forEach((season) => printSeasonRow(season));
    return;
  }

  if (subcommand === 'get') {
    const { data } = await readCatalogSeasonsFile(filePath);
    const seasonId = parseSeasonId(flags, values);
    if (!seasonId) throw new Error('catalog seasons get requires --season <id>');
    const season = getSeason(data, seasonId);
    if (!season) throw new Error(`catalog season not found: ${seasonId}`);
    console.log(JSON.stringify(season, null, 2));
    return;
  }

  if (subcommand === 'set') {
    const seasonId = parseSeasonId(flags, values);
    if (!seasonId) throw new Error('catalog seasons set requires --season <id>');

    const { data } = await readCatalogSeasonsFile(filePath);
    const patch = {};
    if (flags.has('--label')) patch.label = String(flags.get('--label') || '').trim();
    if (flags.has('--order')) {
      const order = Number(flags.get('--order'));
      if (!Number.isFinite(order)) throw new Error('--order must be numeric');
      patch.order = Math.round(order);
    }

    const next = ensureSeason(data, seasonId, patch);
    const written = await writeCatalogSeasonsFile(next, filePath);
    const season = getSeason(written.data, seasonId);
    console.log(`catalog:seasons:set wrote ${seasonId}`);
    if (season) printSeasonRow(season);
    return;
  }

  if (subcommand === 'teaser') {
    const [actionName = '', ...tailValues] = values;
    const seasonId = parseSeasonId(flags, tailValues);
    if (!seasonId) throw new Error('catalog seasons teaser requires --season <id>');

    const { data } = await readCatalogSeasonsFile(filePath);

    if (actionName === 'enable' || actionName === 'disable') {
      const next = ensureSeason(data, seasonId, {
        unannounced: {
          enabled: actionName === 'enable',
        },
      });
      const written = await writeCatalogSeasonsFile(next, filePath);
      const season = getSeason(written.data, seasonId);
      console.log(`catalog:seasons:teaser:${actionName} wrote ${seasonId}`);
      if (season) printSeasonRow(season);
      return;
    }

    if (actionName === 'set') {
      const patch = { unannounced: {} };

      if (flags.has('--count')) patch.unannounced.count = parseCount(flags.get('--count'));
      if (flags.has('--message')) patch.unannounced.message = String(flags.get('--message') || '').trim();
      if (flags.has('--tokens')) patch.unannounced.tokenPool = parseTokenPool(flags.get('--tokens'));
      if (flags.has('--style')) patch.unannounced.style = String(flags.get('--style') || '').trim();
      if (flags.has('--enabled')) patch.unannounced.enabled = String(flags.get('--enabled')) === 'true';

      const next = ensureSeason(data, seasonId, patch);
      const written = await writeCatalogSeasonsFile(next, filePath);
      const season = getSeason(written.data, seasonId);
      console.log(`catalog:seasons:teaser:set wrote ${seasonId}`);
      if (season) printSeasonRow(season);
      return;
    }

    throw new Error(`Unknown catalog seasons teaser command: ${actionName || '(empty)'}`);
  }

  throw new Error(`Unknown catalog seasons command: ${subcommand}`);
}

export function printCatalogSeasonsUsage() {
  printUsage();
}
