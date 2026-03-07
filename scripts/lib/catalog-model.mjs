import { load } from 'cheerio';

const PROTECTED_CHAR_RE = /[\u00A0\u200B\u200C\u200D]/g;

export function cleanText(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function normalizeSearch(value) {
  return cleanText(value)
    .replace(/[\u200B\u200C\u200D]/g, '')
    .toLowerCase();
}

function slugify(value) {
  const slug = normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'catalog-item';
}

function seasonFromLookup(lookupValue) {
  const match = String(lookupValue || '').match(/\bS(\d+)\b/i);
  if (!match) return '';
  return `S${match[1]}`;
}

function classifySymbolGroup(keyRaw, descriptionRaw) {
  const key = normalizeSearch(keyRaw);
  const description = normalizeSearch(descriptionRaw);

  if (key.startsWith('[')) {
    if (/\b(4k|1080|720|mono|stereo|quad|5\.1|surround|wav|mp3|mov|aiff|flac|48k|96k)\b/.test(`${key} ${description}`)) {
      return 'quality';
    }
    return 'qualifier';
  }

  if (/^(av|a)$/i.test(keyRaw)) return 'collection';
  if (/^[a-ex]$/i.test(keyRaw) && /recording|chunk|splice|extras|bucket|collection/.test(description)) {
    return 'collection';
  }

  if (/^[a-z]$/i.test(keyRaw)) {
    return 'instrument';
  }

  if (/\b(meter|perc|poly|mono|stac|sus|nois|tonal|atonal|clean|loud|soft)\b/.test(description)) {
    return 'qualifier';
  }

  return 'qualifier';
}

export function canonicalizeInternalHref(hrefValue) {
  const raw = cleanText(hrefValue);
  if (!raw) return '';

  if (raw.startsWith('#')) return raw;

  const rewriteCatalogLookup = (value) => {
    if (value === '/catalog/lookup' || value === '/catalog/lookup/' || value === 'catalog/lookup' || value === 'catalog/lookup/') {
      return '/catalog/how/#dex-how';
    }
    return value;
  };

  const canonicalizeEntryPath = (value) => {
    const normalized = value.replace(/\/+/g, '/');
    if (/^\/entry\//.test(normalized)) {
      return normalized.endsWith('/') ? normalized : `${normalized}/`;
    }
    return normalized;
  };

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.hostname === 'dexdsl.com' || url.hostname === 'dexdsl.org' || url.hostname === 'dexdsl.squarespace.com') {
        const rewrittenPath = rewriteCatalogLookup(url.pathname);
        if (/^\/entry\//.test(rewrittenPath)) {
          return canonicalizeEntryPath(rewrittenPath);
        }
        if (rewrittenPath.startsWith('/catalog')) {
          return `${rewrittenPath}${url.hash || ''}`;
        }
        return rewrittenPath || '/';
      }
      return raw;
    } catch {
      return raw;
    }
  }

  const rewritten = rewriteCatalogLookup(raw);
  if (rewritten.startsWith('entry/')) {
    return canonicalizeEntryPath(`/${rewritten}`);
  }
  if (rewritten.startsWith('/entry/')) {
    return canonicalizeEntryPath(rewritten);
  }
  return rewritten;
}

function entryIdFromHref(hrefValue, fallbackIndex) {
  const href = canonicalizeInternalHref(hrefValue);
  const match = href.match(/^\/entry\/([^/?#]+)\/?/i);
  if (match) return match[1];
  if (href && href !== '#') return slugify(href);
  return `entry-${fallbackIndex + 1}`;
}

function getImageSrc($element) {
  if (!$element || !$element.length) return '';
  const src = $element.attr('data-image') || $element.attr('data-src') || $element.attr('src') || '';
  return normalizeImageSrc(src);
}

function countProtectedInValue(value) {
  if (typeof value !== 'string') return 0;
  const matches = value.match(PROTECTED_CHAR_RE);
  return matches ? matches.length : 0;
}

function sumProtectedChars(value) {
  if (typeof value === 'string') return countProtectedInValue(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumProtectedChars(item), 0);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((sum, item) => sum + sumProtectedChars(item), 0);
  }
  return 0;
}

function normalizeImageSrc(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  const stripQueryHash = (input) => String(input || '').split('#')[0].split('?')[0];

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const pathname = stripQueryHash(parsed.pathname);
      const fileName = pathname.split('/').filter(Boolean).pop() || '';
      if (/\.(?:jpe?g|png|webp|gif|avif)$/i.test(fileName)) {
        return `${parsed.origin}${pathname}`;
      }
      if (parsed.hostname.endsWith('dexdsl.com') || parsed.hostname.endsWith('dexdsl.org')) {
        return pathname || raw;
      }
      return `${parsed.origin}${pathname}`;
    } catch {
      return stripQueryHash(raw);
    }
  }

  return stripQueryHash(raw);
}

function ensureEntry(entriesByHref, hrefValue, fallbackIndex = 0) {
  const canonicalHref = canonicalizeInternalHref(hrefValue);
  if (!canonicalHref) return null;
  if (!entriesByHref.has(canonicalHref)) {
    entriesByHref.set(canonicalHref, {
      id: entryIdFromHref(canonicalHref, fallbackIndex),
      title_raw: '',
      performer_raw: '',
      instrument_family: [],
      instrument_labels: [],
      lookup_raw: '',
      season: '',
      entry_href: canonicalHref,
      image_src: '',
      image_alt_raw: '',
      featured: false,
      sort_key: '',
      title_norm: '',
      performer_norm: '',
      lookup_norm: '',
      instrument_norm: '',
    });
  }
  return entriesByHref.get(canonicalHref);
}

function maybePushUnique(list, value) {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

function parseAccordionAnchor($anchor) {
  const strongText = cleanText($anchor.find('strong').first().text());
  const allText = cleanText($anchor.text());
  let performerText = '';
  if (strongText && allText.startsWith(strongText)) {
    performerText = cleanText(allText.slice(strongText.length));
  } else if (strongText) {
    performerText = cleanText(allText.replace(strongText, ''));
  }
  return {
    title_raw: strongText || allText,
    performer_raw: performerText,
  };
}

function buildLookupMap($) {
  const lookupMap = new Map();
  $('a[href]').each((_, anchor) => {
    const $anchor = $(anchor);
    const href = canonicalizeInternalHref($anchor.attr('href') || '');
    if (!href) return;
    const textRaw = cleanText($anchor.text());
    if (!textRaw) return;
    if (!/^[A-Z]\.[A-Za-z0-9]/.test(textRaw)) return;
    if (!/\bS\d\b/i.test(textRaw)) return;
    lookupMap.set(href, {
      lookup_raw: textRaw,
      season: seasonFromLookup(textRaw),
    });
  });
  return lookupMap;
}

function buildSpotlight($, entries) {
  const marker = $('h1, h2, p').filter((_, el) => {
    const text = normalizeSearch($(el).text());
    return text.includes('artist spootlight') || text.includes('artist spotlight');
  }).first();

  if (!marker.length) {
    const fallback = entries[0] || null;
    if (!fallback) {
      return {
        entry_id: '',
        headline_raw: 'ARTIST SPOTLIGHT',
        subhead_raw: '',
        body_raw: '',
        cta_label_raw: 'VIEW COLLECTION',
        cta_href: '/catalog/#dex-performer',
        image_src: '',
      };
    }
    return {
      entry_id: fallback.id,
      headline_raw: 'ARTIST SPOTLIGHT',
      subhead_raw: fallback.title_raw,
      body_raw: fallback.performer_raw,
      cta_label_raw: 'VIEW COLLECTION',
      cta_href: fallback.entry_href,
      image_src: fallback.image_src,
    };
  }

  const section = marker.closest('section');
  const headingPieces = section.find('h1').toArray().map((node) => cleanText($(node).text())).filter(Boolean);
  const headlineRaw = headingPieces.slice(0, 1).join(' ') || 'ARTIST SPOTLIGHT';
  const subheadRaw = headingPieces.slice(1, 2).join(' ');
  const bylineRaw = headingPieces.slice(2).join(' ');
  const bodyRaw = cleanText(section.find('p').filter((_, p) => cleanText($(p).text()).length > 40).first().text());

  const ctaAnchor = section.find('a.dx-block-button-element, a.dx-button-element--primary, a[href*="/entry/"]').first();
  const ctaHref = canonicalizeInternalHref(ctaAnchor.attr('href') || '');
  const ctaLabelRaw = cleanText(ctaAnchor.text()) || 'VIEW COLLECTION';

  const linkedImage = ctaHref
    ? section
      .find('a[href]')
      .filter((_, anchor) => canonicalizeInternalHref($(anchor).attr('href') || '') === ctaHref)
      .find('img[data-image], img[data-src], img[src]')
      .filter((_, image) => !/nbf-background/i.test(String($(image).attr('elementtiming') || '')))
      .first()
    : null;

  const fallbackImage = section
    .find('.dx-block-image img, .image-block img, .image-block-wrapper img, img[data-image], img[data-src], img[src]')
    .filter((_, image) => !/nbf-background/i.test(String($(image).attr('elementtiming') || '')))
    .first();

  const imageSrc = getImageSrc(linkedImage && linkedImage.length ? linkedImage : fallbackImage);

  return {
    entry_id: entryIdFromHref(ctaHref, 0),
    headline_raw: headlineRaw,
    subhead_raw: subheadRaw || bylineRaw,
    body_raw: bodyRaw || bylineRaw,
    cta_label_raw: ctaLabelRaw,
    cta_href: ctaHref || '/catalog/#dex-performer',
    image_src: imageSrc,
  };
}

function normalizeSpotlight(spotlightRaw, entries) {
  const spotlight = {
    entry_id: cleanText(spotlightRaw?.entry_id || ''),
    headline_raw: cleanText(spotlightRaw?.headline_raw || 'ARTIST SPOTLIGHT'),
    subhead_raw: cleanText(spotlightRaw?.subhead_raw || ''),
    body_raw: cleanText(spotlightRaw?.body_raw || ''),
    cta_label_raw: cleanText(spotlightRaw?.cta_label_raw || 'VIEW COLLECTION'),
    cta_href: canonicalizeInternalHref(spotlightRaw?.cta_href || '/catalog/#dex-performer'),
    image_src: normalizeImageSrc(spotlightRaw?.image_src || ''),
  };

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byHref = new Map(entries.map((entry) => [canonicalizeInternalHref(entry.entry_href), entry]));

  let entry = null;
  if (spotlight.cta_href) entry = byHref.get(canonicalizeInternalHref(spotlight.cta_href)) || null;
  if (!entry && spotlight.entry_id) entry = byId.get(spotlight.entry_id) || null;
  if (!entry && spotlight.subhead_raw) {
    entry = entries.find((candidate) => normalizeSearch(candidate.title_raw) === normalizeSearch(spotlight.subhead_raw)) || null;
  }

  if (entry) {
    spotlight.entry_id = entry.id;
    spotlight.cta_href = entry.entry_href;
    spotlight.subhead_raw = entry.title_raw || spotlight.subhead_raw;
    if (!spotlight.body_raw) spotlight.body_raw = entry.performer_raw;
    const entryImage = normalizeImageSrc(entry.image_src);
    if (!spotlight.image_src && entryImage) {
      spotlight.image_src = entryImage;
    }
  }

  return spotlight;
}

function buildGuide($) {
  const guideSection = $('#dex-how').first().closest('section');
  const paragraphs = guideSection.find('.dx-html-content p').toArray().map((node) => cleanText($(node).text())).filter(Boolean);

  const introRaw = paragraphs.find((line) => line.includes('Our lookup numbers')) || '';

  const parts = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const line = paragraphs[i];
    if (!/^Part\s*\d+:/i.test(line)) continue;
    parts.push({
      heading_raw: line,
      body_raw: paragraphs[i + 1] || '',
    });
  }

  const examples = paragraphs.filter((line) => /\b[A-Z]\.[A-Za-z0-9].*S\d\b/.test(line) || /^Example:/i.test(line));

  return {
    intro_raw: introRaw,
    parts,
    examples,
    anchors: ['part1', 'part2', 'part3', 'part4'].filter((id) => $(`#${id}`).length > 0),
  };
}

function buildSymbols($) {
  const symbolsSection = $('#list-of-identifiers').last().closest('section');
  const headingRaw = cleanText(symbolsSection.find('h2').first().text()) || 'List of Symbols';
  const lines = symbolsSection.find('.dx-html-content p').toArray().map((node) => cleanText($(node).text())).filter(Boolean);

  const groups = {
    instrument: [],
    collection: [],
    quality: [],
    qualifier: [],
  };

  for (const line of lines) {
    const match = line.match(/^(\[[^\]]+\]|[A-Za-z0-9.]+)\s*-\s*(.+)$/);
    if (!match) continue;
    const keyRaw = cleanText(match[1]);
    const descriptionRaw = cleanText(match[2]);
    const group = classifySymbolGroup(keyRaw, descriptionRaw);
    groups[group].push({
      key_raw: keyRaw,
      description_raw: descriptionRaw,
      key_norm: normalizeSearch(keyRaw),
      description_norm: normalizeSearch(descriptionRaw),
    });
  }

  return {
    heading_raw: headingRaw,
    instrument: groups.instrument,
    collection: groups.collection,
    quality: groups.quality,
    qualifier: groups.qualifier,
  };
}

function finalizeEntries(entriesByHref, lookupMap) {
  const entries = Array.from(entriesByHref.values());

  for (const entry of entries) {
    const lookup = lookupMap.get(entry.entry_href);
    if (lookup) {
      entry.lookup_raw = entry.lookup_raw || lookup.lookup_raw;
      entry.season = entry.season || lookup.season;
    }

    if (!entry.season && entry.lookup_raw) {
      entry.season = seasonFromLookup(entry.lookup_raw);
    }

    entry.title_norm = normalizeSearch(entry.title_raw);
    entry.performer_norm = normalizeSearch(entry.performer_raw);
    entry.lookup_norm = normalizeSearch(entry.lookup_raw);
    entry.instrument_norm = normalizeSearch(entry.instrument_labels.join(' ') || entry.instrument_family.join(' '));
    entry.sort_key = [entry.season || 'S0', entry.lookup_raw || entry.title_raw || entry.id].join('::');
    entry.image_src = normalizeImageSrc(entry.image_src);
  }

  entries.sort((a, b) => {
    if (a.season !== b.season) return String(b.season).localeCompare(String(a.season));
    if (a.performer_raw !== b.performer_raw) return a.performer_raw.localeCompare(b.performer_raw);
    return a.title_raw.localeCompare(b.title_raw);
  });

  if (entries.length > 0) entries[0].featured = true;

  return entries;
}

export function buildCatalogModelFromHtml(html, sourceLabel = 'local') {
  const $ = load(html, { decodeEntities: false });
  const entriesByHref = new Map();

  const lookupMap = buildLookupMap($);

  $('li.user-items-list-carousel__slide.list-item').each((index, slide) => {
    const $slide = $(slide);
    const href = $slide.find('a.list-item-content__button').first().attr('href') || '';
    const entry = ensureEntry(entriesByHref, href, index);
    if (!entry) return;

    const performerRaw = cleanText($slide.find('.list-item-content__title').first().text());
    const titleRaw = cleanText($slide.find('.list-item-content__description').first().text());
    const image = $slide
      .find('.list-item-media img, .list-item-content__media img, .image-block img, img[data-image], img[data-src], img[src]')
      .first();

    entry.performer_raw = entry.performer_raw || performerRaw;
    entry.title_raw = entry.title_raw || titleRaw;
    entry.image_src = entry.image_src || getImageSrc(image);
    entry.image_alt_raw = entry.image_alt_raw || cleanText(image.attr('alt') || '');
  });

  $('ul.accordion-items-container > li.accordion-item').each((_, item) => {
    const $item = $(item);
    const familyRaw = cleanText($item.find('.accordion-item__title').first().text());

    $item.find('.accordion-item__description a[href]').each((index, anchor) => {
      const $anchor = $(anchor);
      const href = $anchor.attr('href') || '';
      const entry = ensureEntry(entriesByHref, href, index);
      if (!entry) return;

      const parsed = parseAccordionAnchor($anchor);
      if (!entry.title_raw && parsed.title_raw) entry.title_raw = parsed.title_raw;
      if (!entry.performer_raw && parsed.performer_raw) entry.performer_raw = parsed.performer_raw;
      maybePushUnique(entry.instrument_family, familyRaw);
      if (parsed.title_raw) maybePushUnique(entry.instrument_labels, parsed.title_raw);
    });
  });

  for (const [href, lookup] of lookupMap.entries()) {
    const entry = ensureEntry(entriesByHref, href);
    if (!entry) continue;
    entry.lookup_raw = entry.lookup_raw || lookup.lookup_raw;
    entry.season = entry.season || lookup.season;
  }

  const entries = finalizeEntries(entriesByHref, lookupMap);

  const seasons = Array.from(new Set(entries.map((entry) => entry.season).filter(Boolean))).sort((a, b) => b.localeCompare(a));
  const instruments = Array.from(
    new Set(entries.flatMap((entry) => entry.instrument_family.map((family) => cleanText(family)).filter(Boolean))),
  ).sort((a, b) => a.localeCompare(b));

  const spotlight = normalizeSpotlight(buildSpotlight($, entries), entries);

  const spotlightEntry = entries.find((entry) => entry.id === spotlight.entry_id || canonicalizeInternalHref(entry.entry_href) === canonicalizeInternalHref(spotlight.cta_href));
  if (spotlightEntry && !spotlightEntry.image_src && spotlight.image_src) {
    spotlightEntry.image_src = spotlight.image_src;
  }

  const model = {
    source: sourceLabel,
    generated_at: new Date().toISOString(),
    anchors: {
      performer: '#dex-performer',
      instrument: '#dex-instrument',
      lookup: '#dex-lookup',
      how: '#dex-how',
      symbols: '#list-of-identifiers',
    },
    stats: {
      entries_count: entries.length,
      lookup_count: Array.from(lookupMap.values()).length,
      seasons,
      instruments,
      protected_char_count: 0,
    },
    entries,
    spotlight,
    guide: buildGuide($),
    symbols: buildSymbols($),
  };

  model.stats.protected_char_count = sumProtectedChars(model);

  return model;
}

export function buildSearchIndex(model) {
  const entries = Array.isArray(model.entries) ? model.entries : [];
  return {
    generated_at: new Date().toISOString(),
    total: entries.length,
    entries: entries.map((entry) => ({
      id: entry.id,
      entry_href: entry.entry_href,
      season: entry.season,
      title_raw: entry.title_raw,
      performer_raw: entry.performer_raw,
      lookup_raw: entry.lookup_raw,
      instrument_family: entry.instrument_family,
      title_norm: normalizeSearch(entry.title_raw),
      performer_norm: normalizeSearch(entry.performer_raw),
      lookup_norm: normalizeSearch(entry.lookup_raw),
      instrument_norm: normalizeSearch((entry.instrument_family || []).join(' ')),
      search_blob: normalizeSearch([
        entry.title_raw,
        entry.performer_raw,
        entry.lookup_raw,
        (entry.instrument_family || []).join(' '),
        (entry.instrument_labels || []).join(' '),
      ].join(' ')),
    })),
  };
}

export function buildCatalogDiff(localModel, referenceModel) {
  const localEntries = Array.isArray(localModel?.entries) ? localModel.entries : [];
  const referenceEntries = Array.isArray(referenceModel?.entries) ? referenceModel.entries : [];

  const byHref = (entries) => new Map(entries.map((entry) => [entry.entry_href, entry]));
  const localByHref = byHref(localEntries);
  const referenceByHref = byHref(referenceEntries);

  const missingInLocal = [];
  const missingInReference = [];

  for (const href of referenceByHref.keys()) {
    if (!localByHref.has(href)) missingInLocal.push(href);
  }

  for (const href of localByHref.keys()) {
    if (!referenceByHref.has(href)) missingInReference.push(href);
  }

  const mismatchedLookup = [];
  for (const [href, refEntry] of referenceByHref.entries()) {
    const localEntry = localByHref.get(href);
    if (!localEntry) continue;
    if (cleanText(localEntry.lookup_raw) !== cleanText(refEntry.lookup_raw)) {
      mismatchedLookup.push({
        href,
        local_lookup: localEntry.lookup_raw,
        reference_lookup: refEntry.lookup_raw,
      });
    }
  }

  const localRemoteLinks = localEntries
    .map((entry) => String(entry.entry_href || ''))
    .filter((href) => /^https?:\/\/(?:www\.)?dexdsl\.(?:com|org)/i.test(href));

  return {
    generated_at: new Date().toISOString(),
    counts: {
      local_entries: localEntries.length,
      reference_entries: referenceEntries.length,
      missing_in_local: missingInLocal.length,
      missing_in_reference: missingInReference.length,
      mismatched_lookup: mismatchedLookup.length,
    },
    missing_in_local: missingInLocal,
    missing_in_reference: missingInReference,
    mismatched_lookup: mismatchedLookup,
    local_remote_links: localRemoteLinks,
  };
}
