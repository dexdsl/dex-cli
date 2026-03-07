import fs from 'node:fs/promises';
import path from 'node:path';
import { verifySanitizedHtml } from './lib/sanitize-generated-html.mjs';
import { isAssetReferenceToken, parseAssetReferenceTokenWithKinds } from './lib/asset-ref.mjs';

const ENTRIES_DIR = path.resolve('entries');

async function walkEntryHtml(dir, out = []) {
  const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      await walkEntryHtml(fullPath, out);
      continue;
    }
    if (dirent.isFile() && dirent.name === 'index.html') out.push(fullPath);
  }
  return out;
}

function toText(value) {
  return String(value || '').trim();
}

function decodeAttrEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractJsonScriptById(html, id) {
  const rx = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const match = String(html || '').match(rx);
  if (!match) return { found: false, json: null, error: '' };
  try {
    return { found: true, json: JSON.parse(match[1]), error: '' };
  } catch (error) {
    return { found: true, json: null, error: String(error?.message || error || 'invalid json') };
  }
}

async function readRuntimeExemptions() {
  const filePath = path.resolve('data', 'entry-runtime-audit.exemptions.json');
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      skipSlugs: Array.isArray(raw.skipSlugs) ? raw.skipSlugs.map((value) => toText(value)).filter(Boolean) : [],
      skipPrefixes: Array.isArray(raw.skipPrefixes) ? raw.skipPrefixes.map((value) => toText(value)).filter(Boolean) : [],
    };
  } catch {
    return { skipSlugs: [], skipPrefixes: [] };
  }
}

function isExemptFile(filePath, exemptions) {
  const normalized = path.resolve(filePath);
  const marker = `${path.sep}entries${path.sep}`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return false;
  const afterEntries = normalized.slice(markerIndex + marker.length);
  const slug = toText(afterEntries.split(path.sep)[0]);
  if (!slug) return false;
  if ((exemptions.skipSlugs || []).includes(slug)) return true;
  return (exemptions.skipPrefixes || []).some((prefix) => prefix && slug.startsWith(prefix));
}

async function main() {
  const files = (await walkEntryHtml(ENTRIES_DIR)).sort();
  if (!files.length) {
    console.log('No entries/**/index.html files found.');
    return;
  }

  const exemptions = await readRuntimeExemptions();
  let failures = 0;
  let audited = 0;
  let skipped = 0;
  for (const file of files) {
    const short = path.relative(process.cwd(), file) || file;
    if (isExemptFile(file, exemptions)) {
      skipped += 1;
      console.log(`SKIP ${short} (runtime exemption)`);
      continue;
    }
    audited += 1;
    const html = await fs.readFile(file, 'utf8');
    const result = verifySanitizedHtml(html);
    const runtimeIssues = [];
    const headerSlotMatches = Array.from(
      String(html).matchAll(/<script[^>]*\bsrc=["'](?:https?:\/\/[^"']+)?\/assets\/js\/header-slot\.js(?:[?#][^"']*)?["'][^>]*>/gi),
    );
    if (headerSlotMatches.length === 0) runtimeIssues.push('missing /assets/js/header-slot.js runtime include');
    if (headerSlotMatches.length > 1) runtimeIssues.push('duplicate /assets/js/header-slot.js runtime include');
    const entryLayoutMatch = String(html).match(/<div[^>]*class=["'][^"']*\bdex-entry-layout\b[^"']*["'][^>]*>/i);
    if (entryLayoutMatch) {
      const entryLayoutTag = entryLayoutMatch[0];
      if (!/data-dx-entry-fetch-target=["']layout["']/i.test(entryLayoutTag)) {
        runtimeIssues.push('dex-entry-layout missing data-dx-entry-fetch-target="layout"');
      }
      if (!/data-dx-fetch-state=["']loading["']/i.test(entryLayoutTag)) {
        runtimeIssues.push('dex-entry-layout missing data-dx-fetch-state="loading"');
      }
      if (!/aria-busy=["']true["']/i.test(entryLayoutTag)) {
        runtimeIssues.push('dex-entry-layout missing aria-busy="true"');
      }
    }
    const targetContracts = [
      { className: 'dex-entry-header', key: 'header' },
      { className: 'dex-video-shell', key: 'media' },
      { className: 'dex-entry-desc-scroll', key: 'description' },
      { className: 'dex-overview', key: 'overview' },
      { className: 'dex-collections', key: 'collections' },
      { className: 'dex-license', key: 'license' },
    ];
    for (const contract of targetContracts) {
      const rx = new RegExp(`<[^>]*class=["'][^"']*\\b${contract.className}\\b[^"']*["'][^>]*>`, 'i');
      const match = String(html).match(rx);
      if (!match) continue;
      const tag = match[0];
      if (!new RegExp(`data-dx-entry-fetch-target=["']${contract.key}["']`, 'i').test(tag)) {
        runtimeIssues.push(`${contract.className} missing data-dx-entry-fetch-target="${contract.key}"`);
      }
    }
    if (/https?:\/\/drive\.google\.com\//i.test(html)) runtimeIssues.push('raw drive.google.com URL');
    const manifestMatch = html.match(/<script[^>]*id=["']dex-manifest["'][^>]*>([\s\S]*?)<\/script>/i);
    if (manifestMatch) {
      try {
        const manifest = JSON.parse(manifestMatch[1]);
        const queue = [manifest];
        let foundInvalidToken = '';
        while (queue.length) {
          const value = queue.shift();
          if (Array.isArray(value)) {
            queue.push(...value);
            continue;
          }
          if (value && typeof value === 'object') {
            queue.push(...Object.values(value));
            continue;
          }
          if (typeof value !== 'string') continue;
          const raw = value.trim();
          if (!raw) continue;
          if (isAssetReferenceToken(raw)) continue;
          foundInvalidToken = raw;
          break;
        }
        if (foundInvalidToken) runtimeIssues.push(`unsupported dex-manifest token "${foundInvalidToken}"`);
      } catch {
        runtimeIssues.push('invalid dex-manifest JSON');
      }
    }
    const sidebarConfigNode = extractJsonScriptById(html, 'dex-sidebar-config');
    if (sidebarConfigNode.found && sidebarConfigNode.error) {
      runtimeIssues.push(`invalid dex-sidebar-config JSON (${sidebarConfigNode.error})`);
    } else if (sidebarConfigNode.json) {
      const driveBase = toText(sidebarConfigNode.json?.downloads?.driveBase);
      if (driveBase) {
        runtimeIssues.push('dex-sidebar-config must not include downloads.driveBase');
      }
    }

    const sidebarPageNode = extractJsonScriptById(html, 'dex-sidebar-page-config');
    if (sidebarPageNode.found && sidebarPageNode.error) {
      runtimeIssues.push(`invalid dex-sidebar-page-config JSON (${sidebarPageNode.error})`);
    } else if (sidebarPageNode.json) {
      const recordingPdfToken = toText(
        sidebarPageNode.json?.downloads?.recordingIndexPdfRef
        || sidebarPageNode.json?.recordingIndexPdfRef
        || '',
      );
      if (recordingPdfToken) {
        try {
          parseAssetReferenceTokenWithKinds(recordingPdfToken, {
            allowedKinds: ['lookup', 'asset'],
            context: 'sidebarPageConfig.downloads.recordingIndexPdfRef',
          });
        } catch (error) {
          runtimeIssues.push(String(error?.message || error || 'invalid recording index pdf token'));
        }
      }
      const recordingBundleToken = toText(
        sidebarPageNode.json?.downloads?.recordingIndexBundleRef
        || sidebarPageNode.json?.recordingIndexBundleRef
        || '',
      );
      if (recordingBundleToken) {
        try {
          parseAssetReferenceTokenWithKinds(recordingBundleToken, {
            allowedKinds: ['bundle'],
            context: 'sidebarPageConfig.downloads.recordingIndexBundleRef',
          });
        } catch (error) {
          runtimeIssues.push(String(error?.message || error || 'invalid recording index bundle token'));
        }
      }
      const recordingSourceUrl = toText(
        sidebarPageNode.json?.downloads?.recordingIndexSourceUrl
        || sidebarPageNode.json?.recordingIndexSourceUrl
        || '',
      );
      if (recordingSourceUrl) {
        let parsedSource;
        try {
          parsedSource = new URL(recordingSourceUrl);
        } catch {
          parsedSource = null;
        }
        if (!parsedSource || !/^https?:$/i.test(parsedSource.protocol)) {
          runtimeIssues.push('sidebarPageConfig.downloads.recordingIndexSourceUrl must be an http(s) URL');
        }
      }
    }

    const interactivePersonPins = Array.from(
      String(html).matchAll(/<span[^>]*data-person-linkable=["']true["'][^>]*data-links=(['"])([\s\S]*?)\1/gi),
    );
    for (const match of interactivePersonPins) {
      const encoded = String(match?.[2] || '');
      if (!encoded) continue;
      let parsedLinks = [];
      try {
        const decoded = decodeAttrEntities(encoded);
        const value = JSON.parse(decoded);
        parsedLinks = Array.isArray(value) ? value : [];
      } catch {
        runtimeIssues.push('interactive person pin has invalid data-links JSON');
        continue;
      }
      if (!parsedLinks.length) {
        runtimeIssues.push('interactive person pin must not contain empty links');
        break;
      }
    }

    if (result.ok) {
      if (runtimeIssues.length === 0) {
        console.log(`PASS ${short}`);
      } else {
        failures += 1;
        console.log(`FAIL ${short}`);
        for (const issue of runtimeIssues) console.log(`  - runtime: ${issue}`);
      }
      continue;
    }

    failures += 1;
    console.log(`FAIL ${short}`);
    for (const issue of result.issues) {
      console.log(`  - ${issue.type}: ${issue.token}`);
    }
    for (const issue of runtimeIssues) {
      console.log(`  - runtime: ${issue}`);
    }
  }

  if (!audited) {
    console.error('\nVerification failed: no non-exempt entries were audited.');
    process.exit(1);
  }

  if (failures) {
    console.error(`\nVerification failed for ${failures}/${audited} audited file(s) (skipped=${skipped}).`);
    process.exit(1);
  }

  console.log(`\nVerification passed for ${audited} audited file(s) (skipped=${skipped}).`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
