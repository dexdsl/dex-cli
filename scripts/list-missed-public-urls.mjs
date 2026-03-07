#!/usr/bin/env node
/**
 * Enumerate public-but-unlinked pages on dexdsl.github.io, focusing on:
 *  - /entry/* (via RSS + legacysite JSON)
 *  - known static pages under /entry/
 *  - /polls
 *
 * Usage:
 *   node scripts/list-missed-public-urls.mjs > tmp/missed_public_urls.txt
 *
 * Env:
 *   ORIGIN=https://dexdsl.github.io   (default)
 *   ENTRY_PATH=/entry          (default)
 *   MAX_PAGES=200              (pagination cap for ?format=json)
 */

const ORIGIN = (process.env.ORIGIN ?? "https://dexdsl.github.io").replace(/\/+$/, "");
const ENTRY_PATH = (process.env.ENTRY_PATH ?? "/entry").replace(/\/+$/, "");
const MAX_PAGES = Math.max(1, Number(process.env.MAX_PAGES ?? 200));

function normalize(u) {
  try {
    const url = new URL(u, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    url.hash = "";
    // strip tracking-ish query but keep functional ones (rare for canonical pages)
    if (url.searchParams.has("format")) url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "dex-missed-public-enumerator/1.0 (+local)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) return null;
  return await res.text();
}

function extractLinksFromRss(xml) {
  // RSS/Atom: capture <link>...</link> and <link href="..."/>
  const out = [];

  // <link>https://.../entry/foo</link>
  for (const m of xml.matchAll(/<link>\s*([^<\s]+)\s*<\/link>/gi)) out.push(m[1]);

  // <link ... href="https://..."/>
  for (const m of xml.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/gi)) out.push(m[1]);

  return out;
}

function pickItemUrl(item) {
  // legacysite JSON shapes vary; try common keys.
  const candidates = [
    item.fullUrl,
    item.url,
    item.itemUrl,
    item.assetUrl,
    item.sourceUrl,
    item.publicUrl,
  ].filter(Boolean);

  for (const c of candidates) {
    const n = normalize(c);
    if (n) return n;
  }

  // Fallback: if it looks like a slug, synthesize
  const slug = item.urlId || item.slug;
  if (typeof slug === "string" && slug.trim()) {
    return normalize(`${ORIGIN}${ENTRY_PATH}/${slug.trim()}`);
  }

  return null;
}

async function listEntryViaRss() {
  const urls = new Set();

  // try RSS then Atom
  const feedUrls = [
    `${ORIGIN}${ENTRY_PATH}?format=rss`,
    `${ORIGIN}${ENTRY_PATH}?format=atom`,
  ];

  for (const feed of feedUrls) {
    const xml = await fetchText(feed);
    if (!xml) continue;

    for (const raw of extractLinksFromRss(xml)) {
      const n = normalize(raw);
      if (!n) continue;
      const p = new URL(n).pathname;
      if (p === ENTRY_PATH || p === `${ENTRY_PATH}/`) continue;
      if (!p.startsWith(`${ENTRY_PATH}/`)) continue;
      urls.add(n);
    }

    // if RSS produced anything, we’re good
    if (urls.size) break;
  }

  return urls;
}

async function listEntryVialegacysiteJson() {
  const urls = new Set();

  // Typical legacysite pattern: /entry?format=json&page=1 (or page=2 ...)
  // We’ll page until items are empty OR we hit MAX_PAGES OR results stop changing.
  let lastCount = -1;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const jsonUrl = `${ORIGIN}${ENTRY_PATH}?format=json&page=${page}`;
    const txt = await fetchText(jsonUrl);
    if (!txt) break;

    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      // Sometimes legacysite returns HTML for gated/blocked formats; stop.
      break;
    }

    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.collection?.items) ? data.collection.items : [];
    if (!items.length) break;

    for (const item of items) {
      const u = pickItemUrl(item);
      if (!u) continue;
      const p = new URL(u).pathname;
      if (!p.startsWith(`${ENTRY_PATH}/`)) continue;
      urls.add(u);
    }

    if (urls.size === lastCount) {
      // no growth → likely end of useful pagination
      break;
    }
    lastCount = urls.size;
  }

  return urls;
}

async function main() {
  const out = new Set();

  // Your known unlinked public pages:
  const known = [
    `${ORIGIN}/favorites`,
  ];
  for (const k of known) {
    const n = normalize(k);
    if (n) out.add(n);
  }

  // Enumerate /entry/* via RSS + JSON
  const rss = await listEntryViaRss();
  for (const u of rss) out.add(u);

  const js = await listEntryVialegacysiteJson();
  for (const u of js) out.add(u);

  // Print stable order
  const sorted = [...out].sort((a, b) => a.localeCompare(b));
  for (const u of sorted) console.log(u);
}

await main();
