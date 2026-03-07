import fs from 'node:fs/promises';
import path from 'node:path';
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { BUCKETS } from '../lib/entry-schema.mjs';
import { prepareTemplate } from '../lib/init-core.mjs';
import { resolveLifecycleForWrite } from '../lib/entry-lifecycle.mjs';
import { loadTagsCatalog } from '../lib/tags.mjs';
import {
  readEntryFolder,
  writeEntryFolder,
  normalizeManifestWithFormats,
  generateIndexHtml,
} from '../lib/entry-store.mjs';
import { isBackspaceKey, isPlainEscapeKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import { assertAssetReferenceTokenKinds } from '../lib/asset-ref.mjs';
import { importRecordingIndexFromSheet, parseRecordingIndexSheetUrl } from '../lib/recording-index-import.mjs';
import { upsertProtectedAssetsLookupMapping } from '../lib/protected-assets-publisher.mjs';
import { applyKeyToInputState } from './init-wizard.mjs';
import { computeWindow } from './rolodex.mjs';

const CHECKS = [
  'Title',
  'Description',
  'Lookup #',
  'Video URL',
  'Series',
  'Buckets',
  'License sentence',
  'Instruments',
  'Credits / People',
  'Credit Links',
  'Downloads',
  'File Specs',
  'Metadata',
  'Recording Index PDF',
  'Recording Index Bundle',
  'Recording Index Source URL',
  'Recording Index XLSX Fallback',
];
const SERIES_OPTIONS = ['dex', 'inDex', 'dexFest'];
const CHANNEL_OPTIONS = ['mono', 'stereo', 'multichannel'];

function mapSeriesToImage(series) {
  if (series === 'dex') return '/assets/series/dex.png';
  if (series === 'inDex') return '/assets/series/index.png';
  if (series === 'dexFest') return '/assets/series/dexfest.png';
  return '/assets/series/dex.png';
}

function safeList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function splitNameList(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNameList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'name' in item) return String(item.name || '').trim();
        return String(item || '').trim();
      })
      .filter(Boolean);
  }
  if (value && typeof value === 'object' && 'name' in value) {
    return splitNameList(value.name);
  }
  return splitNameList(value);
}

function normalizeCreditsData(raw, fallback = {}) {
  const nowYear = new Date().getUTCFullYear();
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};

  const yearRaw = Number(source.year ?? fallbackSource.year ?? nowYear);
  const year = Number.isFinite(yearRaw) ? Math.round(yearRaw) : nowYear;
  const season = String(source.season ?? fallbackSource.season ?? 'S1').trim() || 'S1';
  const location = String(source.location ?? fallbackSource.location ?? '').trim() || 'Unknown';
  const artistAltRaw = source.artistAlt ?? fallbackSource.artistAlt ?? null;
  const artistAlt = artistAltRaw == null ? null : String(artistAltRaw).trim() || null;

  return {
    artist: toNameList(source.artist ?? fallbackSource.artist),
    artistAlt,
    instruments: toNameList(source.instruments ?? fallbackSource.instruments),
    video: {
      director: toNameList(source.video?.director ?? fallbackSource.video?.director),
      cinematography: toNameList(source.video?.cinematography ?? fallbackSource.video?.cinematography),
      editing: toNameList(source.video?.editing ?? fallbackSource.video?.editing),
    },
    audio: {
      recording: toNameList(source.audio?.recording ?? fallbackSource.audio?.recording),
      mix: toNameList(source.audio?.mix ?? fallbackSource.audio?.mix),
      master: toNameList(source.audio?.master ?? fallbackSource.audio?.master),
    },
    year,
    season,
    location,
  };
}

function normalizeCreditLinks(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const linksByPersonRaw = source.linksByPerson && typeof source.linksByPerson === 'object'
    ? source.linksByPerson
    : (fallbackSource.linksByPerson && typeof fallbackSource.linksByPerson === 'object' ? fallbackSource.linksByPerson : {});
  const linksByPerson = {};
  for (const [nameRaw, linksRaw] of Object.entries(linksByPersonRaw)) {
    const name = String(nameRaw || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const list = [];
    const seen = new Set();
    for (const link of Array.isArray(linksRaw) ? linksRaw : []) {
      const label = String(link?.label || '').trim();
      const href = String(link?.href || '').trim();
      if (!label || !href) continue;
      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }
      if (!/^https?:$/i.test(parsed.protocol)) continue;
      const dedupeKey = `${label.toLowerCase()}|${parsed.toString()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      list.push({ label, href: parsed.toString() });
    }
    if (list.length) linksByPerson[name] = list;
  }
  return {
    instrumentLinksEnabled: Boolean(source.instrumentLinksEnabled ?? fallbackSource.instrumentLinksEnabled),
    linksByPerson,
  };
}

function normalizeFileSpecs(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const bitDepth = Number(source.bitDepth ?? fallbackSource.bitDepth ?? 24);
  const sampleRate = Number(source.sampleRate ?? fallbackSource.sampleRate ?? 48000);
  const channels = String(source.channels ?? fallbackSource.channels ?? 'stereo').trim();
  if (!Number.isFinite(bitDepth) || bitDepth <= 0) throw new Error('File Specs: bitDepth must be numeric.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('File Specs: sampleRate must be numeric.');
  if (!CHANNEL_OPTIONS.includes(channels)) throw new Error('File Specs: channels must be mono, stereo, or multichannel.');

  const staticSource = source.staticSizes && typeof source.staticSizes === 'object'
    ? source.staticSizes
    : (fallbackSource.staticSizes && typeof fallbackSource.staticSizes === 'object' ? fallbackSource.staticSizes : {});
  const staticSizes = {};
  for (const bucket of BUCKETS) {
    staticSizes[bucket] = String(staticSource[bucket] ?? '').trim();
  }

  return {
    bitDepth: Math.round(bitDepth),
    sampleRate: Math.round(sampleRate),
    channels,
    staticSizes,
  };
}

function parseBucketList(value) {
  const parsed = splitNameList(value)
    .map((item) => item.toUpperCase())
    .filter((item) => BUCKETS.includes(item));
  const unique = [];
  const seen = new Set();
  for (const item of parsed) {
    if (seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  if (!unique.length) throw new Error('Buckets: choose at least one valid bucket (A,B,C,D,E,X).');
  return unique;
}

function parseTags(value) {
  const out = [];
  const seen = new Set();
  for (const tag of splitNameList(value)) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function deriveFormatKeysFromManifest(manifest) {
  const audioSet = new Set();
  const videoSet = new Set();
  const source = manifest && typeof manifest === 'object' ? manifest : {};
  const audio = source.audio && typeof source.audio === 'object' ? source.audio : {};
  const video = source.video && typeof source.video === 'object' ? source.video : {};

  Object.values(audio).forEach((bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    Object.keys(bucket).forEach((key) => audioSet.add(String(key)));
  });
  Object.values(video).forEach((bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    Object.keys(bucket).forEach((key) => videoSet.add(String(key)));
  });

  return {
    audio: Array.from(audioSet),
    video: Array.from(videoSet),
  };
}

function serializeDownloads(manifest, buckets, formatKeys) {
  const selectedBuckets = Array.isArray(buckets) && buckets.length ? buckets : BUCKETS;
  const lines = ['type,bucket,formatKey,driveId'];
  for (const bucket of selectedBuckets) {
    for (const key of formatKeys.audio || []) {
      const value = String(manifest?.audio?.[bucket]?.[key] || '').trim();
      lines.push(`audio,${bucket},${key},${value}`);
    }
    for (const key of formatKeys.video || []) {
      const value = String(manifest?.video?.[bucket]?.[key] || '').trim();
      lines.push(`video,${bucket},${key},${value}`);
    }
  }
  return lines.join('\n');
}

function parseDownloads(value, formatKeys, existingManifest) {
  const manifest = normalizeManifestWithFormats(
    JSON.parse(JSON.stringify(existingManifest || { audio: {}, video: {} })),
    formatKeys,
  );
  const lines = String(value || '').split(/\r?\n/);
  const errors = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    const parts = raw.includes('\t') ? raw.split('\t') : raw.split(',');
    if (index === 0 && /type/i.test(parts[0] || '') && /bucket/i.test(parts[1] || '')) continue;
    if (parts.length < 4) {
      errors.push(`L${index + 1}: expected type,bucket,formatKey,driveId`);
      continue;
    }
    const type = String(parts[0] || '').trim().toLowerCase();
    const bucket = String(parts[1] || '').trim().toUpperCase();
    const key = String(parts[2] || '').trim();
    const driveId = String(parts.slice(3).join(',') || '').trim();

    if (!['audio', 'video'].includes(type)) {
      errors.push(`L${index + 1}: invalid type ${parts[0]}`);
      continue;
    }
    if (!BUCKETS.includes(bucket)) {
      errors.push(`L${index + 1}: invalid bucket ${parts[1]}`);
      continue;
    }
    if (!(formatKeys[type] || []).includes(key)) {
      errors.push(`L${index + 1}: invalid ${type} format ${key}`);
      continue;
    }

    manifest[type][bucket][key] = driveId;
  }

  if (errors.length) {
    throw new Error(`Downloads:\n${errors.join('\n')}`);
  }
  return manifest;
}

function setManifestBundleTokensFromSegments(existingManifest, formatKeys, buckets, segments, lookupNumber) {
  const manifest = normalizeManifestWithFormats(existingManifest, formatKeys);
  const selectedBuckets = Array.isArray(buckets) ? buckets : BUCKETS;
  const summary = new Set();
  const segmentSupportsType = (segment, type) => {
    const normalizedType = String(type || '').trim().toLowerCase();
    const directType = String(segment?.type || '').trim().toLowerCase();
    if (directType === normalizedType) return true;
    const available = Array.isArray(segment?.availableTypes)
      ? segment.availableTypes
      : [];
    return available.some((item) => String(item || '').trim().toLowerCase() === normalizedType);
  };
  for (const segment of segments || []) {
    if (!segment || segment.enabled === false) continue;
    const bucket = String(segment.bucket || '').trim().toUpperCase();
    if (!bucket || !selectedBuckets.includes(bucket)) continue;
    if (segmentSupportsType(segment, 'audio')) summary.add(`${bucket}:audio`);
    if (segmentSupportsType(segment, 'video')) summary.add(`${bucket}:video`);
  }
  for (const bucket of selectedBuckets) {
    manifest.audio[bucket] = { ...(manifest.audio[bucket] || {}) };
    manifest.video[bucket] = { ...(manifest.video[bucket] || {}) };
    for (const key of formatKeys.audio || []) {
      manifest.audio[bucket][key] = summary.has(`${bucket}:audio`)
        ? `bundle:lookup:${lookupNumber}:${bucket}:audio`
        : '';
    }
    for (const key of formatKeys.video || []) {
      manifest.video[bucket][key] = summary.has(`${bucket}:video`)
        ? `bundle:lookup:${lookupNumber}:${bucket}:video`
        : '';
    }
  }
  return manifest;
}

function sectionAllowsMultiline(section) {
  return section === 'Description'
    || section === 'Credits / People'
    || section === 'Credit Links'
    || section === 'Downloads'
    || section === 'File Specs';
}

function sectionDisplayValue(section, form) {
  if (!form) return '';
  switch (section) {
    case 'Title': return form.title;
    case 'Description': return form.descriptionText;
    case 'Lookup #': return form.lookupNumber;
    case 'Video URL': return form.videoUrl;
    case 'Series': return form.series;
    case 'Buckets': return form.buckets.join(', ');
    case 'License sentence': return form.attributionSentence;
    case 'Instruments': return form.instruments.join(', ');
    case 'Credits / People': return JSON.stringify(form.creditsData, null, 2);
    case 'Credit Links':
      return JSON.stringify({
        instrumentLinksEnabled: Boolean(form.creditLinks?.instrumentLinksEnabled),
        linksByPerson: form.creditLinks?.linksByPerson || {},
      }, null, 2);
    case 'Downloads': return serializeDownloads(form.manifest, form.buckets, form.formatKeys);
    case 'File Specs': return JSON.stringify(form.fileSpecs, null, 2);
    case 'Metadata': return form.metadataTags.join(', ');
    case 'Recording Index PDF': return form.recordingIndexPdfRef;
    case 'Recording Index Bundle': return form.recordingIndexBundleRef;
    case 'Recording Index Source URL': return form.recordingIndexSourceUrl;
    case 'Recording Index XLSX Fallback': return form.recordingIndexFallbackPath;
    default: return '';
  }
}

function truncateLine(value, max = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '(empty)';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureSidebarStructures(entry) {
  if (!entry.sidebarPageConfig || typeof entry.sidebarPageConfig !== 'object') entry.sidebarPageConfig = {};
  if (!entry.sidebarPageConfig.credits || typeof entry.sidebarPageConfig.credits !== 'object') entry.sidebarPageConfig.credits = {};
  if (typeof entry.sidebarPageConfig.credits.instrumentLinksEnabled !== 'boolean') {
    entry.sidebarPageConfig.credits.instrumentLinksEnabled = false;
  }
  if (!entry.sidebarPageConfig.credits.linksByPerson || typeof entry.sidebarPageConfig.credits.linksByPerson !== 'object') {
    entry.sidebarPageConfig.credits.linksByPerson = {};
  }
  if (!entry.sidebarPageConfig.metadata || typeof entry.sidebarPageConfig.metadata !== 'object') entry.sidebarPageConfig.metadata = {};
  if (!entry.sidebarPageConfig.fileSpecs || typeof entry.sidebarPageConfig.fileSpecs !== 'object') entry.sidebarPageConfig.fileSpecs = {};
  if (!entry.sidebarPageConfig.downloads || typeof entry.sidebarPageConfig.downloads !== 'object') entry.sidebarPageConfig.downloads = {};
  const legacyRecordingIndexPdfRef = String(entry.sidebarPageConfig.recordingIndexPdfRef || '').trim();
  if (legacyRecordingIndexPdfRef && !String(entry.sidebarPageConfig.downloads.recordingIndexPdfRef || '').trim()) {
    entry.sidebarPageConfig.downloads.recordingIndexPdfRef = legacyRecordingIndexPdfRef;
  }
  const legacyRecordingIndexBundleRef = String(entry.sidebarPageConfig.recordingIndexBundleRef || '').trim();
  if (legacyRecordingIndexBundleRef && !String(entry.sidebarPageConfig.downloads.recordingIndexBundleRef || '').trim()) {
    entry.sidebarPageConfig.downloads.recordingIndexBundleRef = legacyRecordingIndexBundleRef;
  }
  const legacyRecordingIndexSourceUrl = String(entry.sidebarPageConfig.recordingIndexSourceUrl || '').trim();
  if (legacyRecordingIndexSourceUrl && !String(entry.sidebarPageConfig.downloads.recordingIndexSourceUrl || '').trim()) {
    entry.sidebarPageConfig.downloads.recordingIndexSourceUrl = legacyRecordingIndexSourceUrl;
  }
  if ('recordingIndexPdfRef' in entry.sidebarPageConfig) delete entry.sidebarPageConfig.recordingIndexPdfRef;
  if ('recordingIndexBundleRef' in entry.sidebarPageConfig) delete entry.sidebarPageConfig.recordingIndexBundleRef;
  if ('recordingIndexSourceUrl' in entry.sidebarPageConfig) delete entry.sidebarPageConfig.recordingIndexSourceUrl;
}

export function applySelectedSectionsToDraft({
  entry,
  manifest,
  selectedSections = [],
  editorValues = {},
  formatKeys = { audio: [], video: [] },
} = {}) {
  const nextEntry = clone(entry || {});
  let nextManifest = normalizeManifestWithFormats(manifest, formatKeys);
  let descriptionText = String(nextEntry.descriptionText || '');

  ensureSidebarStructures(nextEntry);

  let creditsData = normalizeCreditsData(nextEntry.creditsData, nextEntry.sidebarPageConfig.credits);
  let creditLinks = normalizeCreditLinks(nextEntry.sidebarPageConfig.credits, {});
  let fileSpecs = normalizeFileSpecs(nextEntry.fileSpecs, nextEntry.sidebarPageConfig.fileSpecs);

  for (const section of CHECKS) {
    if (!selectedSections.includes(section)) continue;
    const raw = String(editorValues[section] ?? '').trimEnd();

    if (section === 'Title') {
      const value = raw.trim();
      if (!value) throw new Error('Title cannot be empty.');
      nextEntry.title = value;
    } else if (section === 'Description') {
      descriptionText = raw;
      nextEntry.descriptionText = raw;
    } else if (section === 'Lookup #') {
      const value = raw.trim();
      if (!value) throw new Error('Lookup # cannot be empty.');
      nextEntry.sidebarPageConfig.lookupNumber = value;
    } else if (section === 'Video URL') {
      const value = raw.trim();
      if (!value) throw new Error('Video URL cannot be empty.');
      nextEntry.video = {
        mode: 'url',
        dataUrl: value,
        dataUrlOriginal: value,
        dataHtml: '',
      };
    } else if (section === 'Series') {
      const value = raw.trim();
      if (!SERIES_OPTIONS.includes(value)) {
        throw new Error(`Series must be one of: ${SERIES_OPTIONS.join(', ')}`);
      }
      nextEntry.series = value;
      nextEntry.sidebarPageConfig.specialEventImage = mapSeriesToImage(value);
    } else if (section === 'Buckets') {
      const buckets = parseBucketList(raw);
      nextEntry.selectedBuckets = buckets;
      nextEntry.sidebarPageConfig.buckets = buckets;
    } else if (section === 'License sentence') {
      const value = raw.trim();
      if (!value) throw new Error('License sentence cannot be empty.');
      nextEntry.sidebarPageConfig.attributionSentence = value;
    } else if (section === 'Instruments') {
      const instruments = splitNameList(raw);
      creditsData = { ...creditsData, instruments };
    } else if (section === 'Credits / People') {
      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        throw new Error('Credits / People must be valid JSON.');
      }
      creditsData = normalizeCreditsData(parsed, creditsData);
    } else if (section === 'Credit Links') {
      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        throw new Error('Credit Links must be valid JSON.');
      }
      creditLinks = normalizeCreditLinks(parsed, creditLinks);
    } else if (section === 'Downloads') {
      nextManifest = parseDownloads(raw, formatKeys, nextManifest);
    } else if (section === 'File Specs') {
      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        throw new Error('File Specs must be valid JSON.');
      }
      fileSpecs = normalizeFileSpecs(parsed, fileSpecs);
    } else if (section === 'Metadata') {
      const tags = parseTags(raw);
      nextEntry.metadata = { ...(nextEntry.metadata || {}), tags };
      nextEntry.sidebarPageConfig.metadata = { ...(nextEntry.sidebarPageConfig.metadata || {}), tags };
    } else if (section === 'Recording Index PDF') {
      const value = raw.trim();
      if (value) {
        assertAssetReferenceTokenKinds(value, ['lookup', 'asset'], 'Recording Index PDF');
      }
      nextEntry.sidebarPageConfig.downloads = {
        ...(nextEntry.sidebarPageConfig.downloads || {}),
      };
      if (value) nextEntry.sidebarPageConfig.downloads.recordingIndexPdfRef = value;
      else delete nextEntry.sidebarPageConfig.downloads.recordingIndexPdfRef;
    } else if (section === 'Recording Index Bundle') {
      const value = raw.trim();
      if (value) {
        assertAssetReferenceTokenKinds(value, ['bundle'], 'Recording Index Bundle');
      }
      nextEntry.sidebarPageConfig.downloads = {
        ...(nextEntry.sidebarPageConfig.downloads || {}),
      };
      if (value) nextEntry.sidebarPageConfig.downloads.recordingIndexBundleRef = value;
      else delete nextEntry.sidebarPageConfig.downloads.recordingIndexBundleRef;
    } else if (section === 'Recording Index Source URL') {
      let value = raw.trim();
      if (value) {
        try {
          value = parseRecordingIndexSheetUrl(value).sheetUrl;
        } catch {
          throw new Error('Recording Index Source URL must be a valid Google Sheets URL.');
        }
      }
      nextEntry.sidebarPageConfig.downloads = {
        ...(nextEntry.sidebarPageConfig.downloads || {}),
      };
      if (value) nextEntry.sidebarPageConfig.downloads.recordingIndexSourceUrl = value;
      else delete nextEntry.sidebarPageConfig.downloads.recordingIndexSourceUrl;
    }
  }

  nextEntry.creditsData = creditsData;
  nextEntry.fileSpecs = fileSpecs;
  nextEntry.sidebarPageConfig.credits = {
    artist: creditsData.artist,
    artistAlt: creditsData.artistAlt,
    instruments: creditsData.instruments,
    instrumentLinksEnabled: Boolean(creditLinks.instrumentLinksEnabled),
    linksByPerson: creditLinks.linksByPerson || {},
    video: {
      director: creditsData.video.director,
      cinematography: creditsData.video.cinematography,
      editing: creditsData.video.editing,
    },
    audio: {
      recording: creditsData.audio.recording,
      mix: creditsData.audio.mix,
      master: creditsData.audio.master,
    },
    year: creditsData.year,
    season: creditsData.season,
    location: creditsData.location,
  };
  nextEntry.sidebarPageConfig.fileSpecs = fileSpecs;

  return {
    entry: nextEntry,
    manifest: nextManifest,
    descriptionText,
  };
}

export function UpdateWizard({ initialSlug = '', onDone, onCancel }) {
  const [entries, setEntries] = useState([]);
  const [slug, setSlug] = useState(initialSlug);
  const [stage, setStage] = useState(initialSlug ? 'checklist' : 'select');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [checks, setChecks] = useState(CHECKS.map((label) => ({ label, selected: false })));
  const [form, setForm] = useState(null);
  const [fieldCursor, setFieldCursor] = useState(0);
  const [editorValues, setEditorValues] = useState({});
  const [editorCursors, setEditorCursors] = useState({});
  const [msg, setMsg] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [tagsCatalog, setTagsCatalog] = useState([]);

  useEffect(() => {
    void fs.readdir(path.resolve('./entries'), { withFileTypes: true })
      .then((dirs) => setEntries(dirs.filter((d) => d.isDirectory()).map((d) => d.name).sort()))
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    void loadTagsCatalog().then(setTagsCatalog);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return entries;
    return entries.filter((value) => value.toLowerCase().includes(query.toLowerCase()));
  }, [entries, query]);

  const selectedSections = useMemo(
    () => checks.filter((item) => item.selected).map((item) => item.label),
    [checks],
  );

  async function loadForm(targetSlug) {
    const payload = await readEntryFolder(targetSlug, { entriesDir: './entries' });
    let formatKeys = deriveFormatKeysFromManifest(payload.manifest);
    try {
      const prepared = await prepareTemplate({});
      formatKeys = prepared.formatKeys;
    } catch {}

    const creditsData = normalizeCreditsData(payload.entry.creditsData, payload.entry.sidebarPageConfig?.credits || {});
    const creditLinks = normalizeCreditLinks(payload.entry.sidebarPageConfig?.credits || {}, {});
    const fileSpecs = normalizeFileSpecs(payload.entry.fileSpecs, payload.entry.sidebarPageConfig?.fileSpecs || {});
    const metadataTags = safeList(payload.entry.metadata?.tags || payload.entry.sidebarPageConfig?.metadata?.tags || []);
    const loaded = {
      payload,
      title: String(payload.entry.title || ''),
      descriptionText: String(payload.descriptionText || payload.entry.descriptionText || ''),
      lookupNumber: String(payload.entry.sidebarPageConfig?.lookupNumber || ''),
      videoUrl: String(payload.entry.video?.dataUrl || ''),
      series: String(payload.entry.series || 'dex'),
      buckets: safeList(payload.entry.selectedBuckets || payload.entry.sidebarPageConfig?.buckets || ['A']),
      attributionSentence: String(payload.entry.sidebarPageConfig?.attributionSentence || ''),
      instruments: safeList(creditsData.instruments),
      creditsData,
      creditLinks,
      metadataTags,
      recordingIndexPdfRef: String(
        payload.entry.sidebarPageConfig?.downloads?.recordingIndexPdfRef
        || payload.entry.sidebarPageConfig?.recordingIndexPdfRef
        || '',
      ).trim(),
      recordingIndexBundleRef: String(
        payload.entry.sidebarPageConfig?.downloads?.recordingIndexBundleRef
        || payload.entry.sidebarPageConfig?.recordingIndexBundleRef
        || '',
      ).trim(),
      recordingIndexSourceUrl: String(
        payload.entry.sidebarPageConfig?.downloads?.recordingIndexSourceUrl
        || payload.entry.sidebarPageConfig?.recordingIndexSourceUrl
        || '',
      ).trim(),
      recordingIndexFallbackPath: '',
      importedSegments: [],
      importedFiles: [],
      importSummary: null,
      fileSpecs,
      manifest: normalizeManifestWithFormats(payload.manifest, formatKeys),
      formatKeys,
    };

    const nextEditorValues = {};
    const nextEditorCursors = {};
    for (const section of CHECKS) {
      const value = sectionDisplayValue(section, loaded);
      nextEditorValues[section] = value;
      nextEditorCursors[section] = String(value || '').length;
    }

    setForm(loaded);
    setEditorValues(nextEditorValues);
    setEditorCursors(nextEditorCursors);
    setMsg(`Loaded ${targetSlug}. Select sections to edit.`);
  }

  async function runRecordingIndexImport() {
    if (!form || importBusy) return;
    const sourceUrlInput = String(
      editorValues['Recording Index Source URL']
      || form.recordingIndexSourceUrl
      || '',
    ).trim();
    const fallbackPath = String(
      editorValues['Recording Index XLSX Fallback']
      || form.recordingIndexFallbackPath
      || process.env.DEX_RECORDING_INDEX_XLSX_FALLBACK
      || '',
    ).trim();
    if (!sourceUrlInput) {
      setMsg('Set "Recording Index Source URL" first, then press Ctrl+I.');
      return;
    }
    let sourceUrl = sourceUrlInput;
    try {
      sourceUrl = parseRecordingIndexSheetUrl(sourceUrlInput).sheetUrl;
    } catch (error) {
      setMsg(`Recording-index import failed: ${safeMessage(error)}`);
      return;
    }
    const lookupNumber = String(form.lookupNumber || '').trim();
    if (!lookupNumber) {
      setMsg('Lookup # is required before recording-index import.');
      return;
    }

    setImportBusy(true);
    try {
      const imported = await importRecordingIndexFromSheet({
        sheetUrl: sourceUrl,
        lookupNumber,
        entrySlug: slug,
        fallbackXlsxPath: fallbackPath,
      });
      const importedSegments = (imported.segments || []).map((segment) => ({
        bucketNumber: segment.bucketNumber,
        fileId: segment.fileId,
        bucket: segment.bucket,
        r2Key: segment.r2Key,
        driveFileId: segment.driveFileId || '',
        sizeBytes: Number(segment.sizeBytes || 0) || 0,
        mime: segment.mime || '',
        position: Number(segment.position || 0) || 0,
        label: segment.label || '',
        sourceLabel: segment.sourceLabel || segment.label || '',
        type: segment.type || 'unknown',
        typeReason: segment.typeReason || '',
        availableTypes: Array.isArray(segment.availableTypes) ? segment.availableTypes.slice() : [],
        enabled: segment.enabled !== false,
        role: segment.role || 'media',
      }));
      const importedFiles = (imported.files || []).map((file) => ({
        bucketNumber: file.bucketNumber,
        fileId: file.fileId,
        bucket: file.bucket,
        r2Key: file.r2Key,
        driveFileId: file.driveFileId || '',
        sizeBytes: Number(file.sizeBytes || 0) || 0,
        mime: file.mime || '',
        position: Number(file.position || 0) || 0,
        label: file.label || '',
        sourceLabel: file.sourceLabel || file.label || '',
        type: file.type || 'unknown',
        availableTypes: Array.isArray(file.availableTypes) ? file.availableTypes.slice() : [],
        role: file.role || 'media',
      }));
      const nextManifest = setManifestBundleTokensFromSegments(
        form.manifest,
        form.formatKeys,
        form.buckets,
        importedSegments,
        lookupNumber,
      );
      const recordingIndexPdfRef = String(imported.recordingIndex?.recordingIndexPdfRef || '').trim();
      const recordingIndexBundleRef = String(imported.recordingIndex?.recordingIndexBundleRef || '').trim();
      const recordingIndexSourceUrl = String(imported.recordingIndex?.recordingIndexSourceUrl || sourceUrl).trim();

      setForm((prev) => ({
        ...prev,
        manifest: nextManifest,
        recordingIndexPdfRef,
        recordingIndexBundleRef,
        recordingIndexSourceUrl,
        recordingIndexFallbackPath: fallbackPath,
        importedSegments,
        importedFiles,
        importSummary: {
          sourceMode: imported.source?.mode || 'live',
          sourceValue: imported.source?.value || '',
          sheetId: imported.sheet?.sheetId || '',
          gid: imported.sheet?.gid || '',
          rootFolderUrl: imported.sheet?.rootFolderUrl || '',
          bucketFolderUrls: imported.sheet?.bucketFolderUrls || {},
          totalFiles: imported.counts?.totalFiles || importedSegments.length,
          audioFiles: imported.counts?.audioFiles || 0,
          videoFiles: imported.counts?.videoFiles || 0,
          unknownFiles: imported.counts?.unknownFiles || 0,
          buckets: Array.isArray(imported.counts?.buckets) ? imported.counts.buckets : [],
          pdfAssetId: imported.recordingIndex?.pdfAssetId || '',
          bundleAllToken: imported.recordingIndex?.bundleAllToken || '',
        },
      }));

      const mergedEditor = {
        ...editorValues,
        Downloads: serializeDownloads(nextManifest, form.buckets, form.formatKeys),
        'Recording Index PDF': recordingIndexPdfRef,
        'Recording Index Bundle': recordingIndexBundleRef,
        'Recording Index Source URL': recordingIndexSourceUrl,
        'Recording Index XLSX Fallback': fallbackPath,
      };
      setEditorValues(mergedEditor);
      setEditorCursors((prev) => ({
        ...prev,
        Downloads: mergedEditor.Downloads.length,
        'Recording Index PDF': recordingIndexPdfRef.length,
        'Recording Index Bundle': recordingIndexBundleRef.length,
        'Recording Index Source URL': recordingIndexSourceUrl.length,
        'Recording Index XLSX Fallback': fallbackPath.length,
      }));
      setChecks((items) => items.map((item) => (
        item.label === 'Downloads'
          || item.label === 'Recording Index PDF'
          || item.label === 'Recording Index Bundle'
          || item.label === 'Recording Index Source URL'
          || item.label === 'Recording Index XLSX Fallback'
          ? { ...item, selected: true }
          : item
      )));
      setMsg(`Imported recording index (${imported.counts?.totalFiles || importedSegments.length} files, ${imported.source?.mode || 'live'} source).`);
    } catch (error) {
      setMsg(`Recording-index import failed: ${safeMessage(error)}`);
    } finally {
      setImportBusy(false);
    }
  }

  async function saveAll() {
    if (!form) return;
    const prepared = await prepareTemplate({});
    const patched = applySelectedSectionsToDraft({
      entry: form.payload.entry,
      manifest: form.manifest,
      selectedSections,
      editorValues,
      formatKeys: prepared.formatKeys,
    });

    const lifecycle = await resolveLifecycleForWrite({
      existingLifecycle: patched.entry.lifecycle,
      entryFolder: form.payload.folder,
      now: Date.now(),
    });
    patched.entry.lifecycle = lifecycle;

    const indexHtml = generateIndexHtml({
      templateHtml: prepared.templateHtml,
      entry: patched.entry,
      descriptionText: patched.descriptionText || patched.entry.descriptionText || '',
      manifest: patched.manifest,
      lifecycle,
    });

    if (Array.isArray(form.importedFiles) && form.importedFiles.length > 0) {
      const lookupNumber = String(patched.entry?.sidebarPageConfig?.lookupNumber || form.lookupNumber || '').trim();
      if (lookupNumber) {
        await upsertProtectedAssetsLookupMapping({
          lookupNumber,
          title: String(patched.entry?.title || form.title || '').trim(),
          status: 'draft',
          season: String(patched.entry?.creditsData?.season || form.creditsData?.season || '').trim(),
          files: form.importedFiles,
          entitlements: [{ type: 'membership_tier', value: 'member' }],
          recordingIndex: form.importSummary
            ? {
              sheetUrl: String(form.recordingIndexSourceUrl || '').trim(),
              sheetId: String(form.importSummary.sheetId || '').trim(),
              gid: String(form.importSummary.gid || '').trim() || '0',
              pdfAssetId: String(form.importSummary.pdfAssetId || '').trim(),
              bundleAllToken: String(form.recordingIndexBundleRef || '').trim(),
              rootFolderUrl: String(form.importSummary.rootFolderUrl || '').trim(),
              bucketFolderUrls: form.importSummary.bucketFolderUrls || {},
            }
            : null,
        });
      }
    }

    const result = await writeEntryFolder(
      slug,
      {
        entry: patched.entry,
        descriptionText: patched.descriptionText || patched.entry.descriptionText || '',
        manifest: patched.manifest,
        indexHtml,
      },
      { entriesDir: './entries' },
    );

    setMsg(`Updated ${slug}: ${result.wroteFiles.length} files`);
    if (onDone) onDone({ slug, wroteFiles: result.wroteFiles });
  }

  useInput((input, key) => {
    if (isPlainEscapeKey(input, key)) {
      if (stage === 'review') {
        setStage('edit');
        return;
      }
      if (stage === 'edit') {
        setStage('checklist');
        return;
      }
      if (stage === 'checklist') {
        setStage('select');
        setCursor(0);
        return;
      }
      if (onCancel) onCancel();
      return;
    }

    if (stage === 'select') {
      if (key.upArrow) setCursor((value) => Math.max(0, value - 1));
      else if (key.downArrow) setCursor((value) => Math.min(filtered.length - 1, value + 1));
      else if (key.return) {
        const chosen = filtered[cursor];
        if (!chosen) return;
        setSlug(chosen);
        void loadForm(chosen).then(() => {
          setStage('checklist');
          setCursor(0);
        }).catch((error) => setMsg(error?.message || String(error)));
      } else if (isBackspaceKey(input, key)) setQuery((value) => value.slice(0, -1));
      else if (shouldAppendWizardChar(input, key)) setQuery((value) => value + input);
      return;
    }

    if (stage === 'checklist') {
      if (key.upArrow) setCursor((value) => Math.max(0, value - 1));
      else if (key.downArrow) setCursor((value) => Math.min(checks.length - 1, value + 1));
      else if (input === ' ') {
        setChecks((items) => items.map((item, index) => (index === cursor ? { ...item, selected: !item.selected } : item)));
      } else if (key.return) {
        if (!selectedSections.length) {
          setMsg('Select at least one section.');
          return;
        }
        setStage('edit');
        setFieldCursor(0);
      }
      return;
    }

    if (stage === 'edit') {
      const fields = selectedSections;
      if (!fields.length) {
        setStage('checklist');
        return;
      }

      const section = fields[Math.min(fieldCursor, fields.length - 1)];
      if (!section) return;
      const isCtrlI = (key.ctrl && (input === 'i' || input === 'I')) || (!key.ctrl && !key.meta && input === 'I');
      if (isCtrlI) {
        void runRecordingIndexImport();
        return;
      }

      if (key.upArrow) {
        setFieldCursor((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow) {
        setFieldCursor((value) => Math.min(fields.length - 1, value + 1));
        return;
      }
      if (key.return) {
        if (fieldCursor >= fields.length - 1) {
          setStage('review');
        } else {
          setFieldCursor((value) => Math.min(fields.length - 1, value + 1));
        }
        return;
      }

      const value = editorValues[section] ?? '';
      const cursorPos = Number(editorCursors[section] ?? String(value).length);
      const next = applyKeyToInputState(
        { value, cursor: cursorPos },
        input,
        key,
        { allowMultiline: sectionAllowsMultiline(section) },
      );
      if (next?.quit) {
        if (onCancel) onCancel();
        return;
      }
      if (next.value !== value || next.cursor !== cursorPos) {
        setEditorValues((prev) => ({ ...prev, [section]: next.value }));
        setEditorCursors((prev) => ({ ...prev, [section]: next.cursor }));
      }
      return;
    }

    if (stage === 'review' && key.ctrl && (input === 's' || input === 'S')) {
      void saveAll().catch((error) => setMsg(error?.message || String(error)));
      return;
    }
  });

  if (stage === 'select') {
    const windowed = computeWindow({ total: filtered.length, cursor, height: 10 });
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, {}, `Select entry: ${query}`),
      ...filtered.slice(windowed.start, windowed.end).map((value, index) => {
        const absolute = windowed.start + index;
        return React.createElement(Text, cursor === absolute ? { key: value, inverse: true } : { key: value }, value);
      }),
      !filtered.length ? React.createElement(Text, { color: '#8f98a8' }, 'No entries found.') : null,
      msg ? React.createElement(Text, { color: '#ffcc66' }, msg) : null,
    );
  }

  if (stage === 'checklist') {
    const windowed = computeWindow({ total: checks.length, cursor, height: 12 });
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, {}, `Update checklist for ${slug}`),
      ...checks.slice(windowed.start, windowed.end).map((item, index) => {
        const absolute = windowed.start + index;
        const line = `[${item.selected ? 'x' : ' '}] ${item.label}`;
        return React.createElement(Text, cursor === absolute ? { key: item.label, inverse: true } : { key: item.label }, line);
      }),
      React.createElement(Text, { color: '#6e7688' }, 'Space toggle   Enter continue   Esc back'),
      msg ? React.createElement(Text, { color: '#ffcc66' }, msg) : null,
    );
  }

  if (stage === 'edit') {
    const fields = selectedSections;
    const section = fields[Math.min(fieldCursor, Math.max(0, fields.length - 1))] || '';
    const value = String(editorValues[section] || '');
    const previewLines = value.split(/\r?\n/).slice(0, 10);
    const summary = section === 'Metadata'
      ? String(editorValues[section] || '')
        .split(/\r?\n|,/)
        .map((tag) => tag.trim())
        .filter((tag) => tag && tagsCatalog.includes(tag))
        .length
      : null;

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, {}, `Editing ${slug}`),
      ...fields.map((item, index) => {
        const preview = truncateLine(editorValues[item]);
        return React.createElement(
          Text,
          fieldCursor === index ? { key: item, inverse: true } : { key: item },
          `${item}: ${preview}`,
        );
      }),
      React.createElement(Text, { color: '#8f98a8' }, `Active field: ${section || '-'}`),
      ...previewLines.map((line, index) => React.createElement(Text, { key: `${section}-line-${index}`, color: '#d0d5df' }, line || ' ')),
      value.split(/\r?\n/).length > previewLines.length
        ? React.createElement(Text, { color: '#8f98a8' }, `… ${value.split(/\r?\n/).length - previewLines.length} more lines`)
        : null,
      summary != null ? React.createElement(Text, { color: '#8f98a8' }, `Known tags in metadata: ${summary}`) : null,
      form.importSummary
        ? React.createElement(
          Text,
          { color: '#8f98a8' },
          `Import: ${form.importSummary.sourceMode} files=${form.importSummary.totalFiles} sheet=${form.importSummary.sheetId || '-'}:${form.importSummary.gid || '-'}`,
        )
        : null,
      React.createElement(Text, { color: '#6e7688' }, 'Type/paste to edit • ↑/↓ switch fields • Ctrl+I import recording index • Enter next • Esc back'),
      importBusy ? React.createElement(Text, { color: '#ffcc66' }, 'Importing recording index…') : null,
      msg ? React.createElement(Text, { color: '#ffcc66' }, msg) : null,
    );
  }

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, {}, `Review ${slug}`),
    React.createElement(Text, {}, `Sections: ${selectedSections.join(', ') || '(none)'}`),
    React.createElement(Text, {}, 'Ctrl+S save and regenerate index.html   Esc back'),
    msg ? React.createElement(Text, { color: '#a6e3a1' }, msg) : null,
  );
}
