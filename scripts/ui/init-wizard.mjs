import fs from 'node:fs/promises';
import path from 'node:path';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { BUCKETS, slugify } from '../lib/entry-schema.mjs';
import { buildEmptyManifestSkeleton, prepareTemplate } from '../lib/init-core.mjs';
import { writeEntryFromData } from '../lib/entry-run.mjs';
import {
  isBackspaceKey,
  isPlainEscapeKey,
  sanitizePastedInputChunk,
  shouldAppendWizardChar,
} from '../lib/input-guard.mjs';
import { assertAssetReferenceTokenKinds, isAssetReferenceToken } from '../lib/asset-ref.mjs';
import { importRecordingIndexFromSheet, parseRecordingIndexSheetUrl } from '../lib/recording-index-import.mjs';
import { buildDownloadTreeHealth } from '../lib/download-tree-health.mjs';
import { buildDownloadTreePlotModelFromHealth } from '../lib/download-tree-plot-model.mjs';
import { DownloadTreePlotter } from './components/download-tree-plotter.mjs';
import { computeWindow } from './rolodex.mjs';

const CHANNELS = ['mono', 'stereo', 'multichannel'];
const SERIES_OPTIONS = ['dex', 'inDex', 'dexFest'];
function mapSeriesToImage(series) {
  if (series === 'dex') return '/assets/series/dex.png';
  if (series === 'inDex') return '/assets/series/index.png';
  if (series === 'dexFest') return '/assets/series/dexfest.png';
  return '/assets/series/dex.png';
}
const LAST_CACHE = '.dex-last.json';

function emptyCredits() { return { artist: [], artistAlt: '', instruments: [], video: { director: [], cinematography: [], editing: [] }, audio: { recording: [], mix: [], master: [] }, year: `${new Date().getUTCFullYear()}`, season: 'S1', location: '' }; }
function normalizeCreditPersonKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function dedupeCreditLinks(links) {
  const seen = new Set();
  const out = [];
  for (const link of Array.isArray(links) ? links : []) {
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
    out.push({ label, href: parsed.toString() });
  }
  return out;
}

function collectCreditLinkPeople(creditsData, instrumentLinksEnabled) {
  const groups = [
    creditsData?.artist,
    creditsData?.video?.director,
    creditsData?.video?.cinematography,
    creditsData?.video?.editing,
    creditsData?.audio?.recording,
    creditsData?.audio?.mix,
    creditsData?.audio?.master,
  ];
  if (instrumentLinksEnabled) groups.push(creditsData?.instruments);
  const seen = new Set();
  const people = [];
  for (const group of groups) {
    for (const name of safeList(group)) {
      const key = normalizeCreditPersonKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      people.push(name);
    }
  }
  return people;
}

function normalizeCreditLinksData(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const linksByPerson = {};
  for (const [nameRaw, linksRaw] of Object.entries(source.linksByPerson || {})) {
    const key = normalizeCreditPersonKey(nameRaw);
    if (!key) continue;
    const label = String(nameRaw || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const links = dedupeCreditLinks(linksRaw);
    if (links.length) linksByPerson[label] = links;
  }
  return {
    instrumentLinksEnabled: Boolean(source.instrumentLinksEnabled),
    linksByPerson,
  };
}

function emptyCreditLinksData() {
  return {
    instrumentLinksEnabled: false,
    linksByPerson: {},
    inputValue: '',
    inputCursor: 0,
    personCursor: 0,
  };
}

function emptyDownloadData() {
  return {
    mode: 'guided',
    series: 'dex',
    audio: {},
    video: {},
    fileSpecs: {
      bitDepth: '24',
      sampleRate: '48000',
      channels: 'stereo',
      staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' },
    },
    metadata: { tagsSelected: [], tagsQuery: '', tagsCursor: 0 },
    recordingIndexPdfRef: '',
    recordingIndexBundleRef: '',
    recordingIndexSourceUrl: '',
    recordingIndexImportFallbackPath: '',
    recordingIndexPdfError: '',
    recordingIndexBundleError: '',
    recordingIndexSourceUrlError: '',
    importedSegments: [],
    importedFiles: [],
    importSummary: null,
    health: null,
    healthSummary: null,
    pasteBuffer: '',
    pasteError: '',
    pasteWarnings: [],
  };
}

function validateRecordingIndexPdfRef(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  try {
    assertAssetReferenceTokenKinds(raw, ['lookup', 'asset'], 'Recording index PDF token');
    return '';
  } catch (error) {
    return String(error?.message || error || 'Invalid recording index PDF token.');
  }
}

function validateRecordingIndexBundleRef(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  try {
    assertAssetReferenceTokenKinds(raw, ['bundle'], 'Recording index bundle token');
    return '';
  } catch (error) {
    return String(error?.message || error || 'Invalid recording index bundle token.');
  }
}

function validateRecordingIndexSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    parseRecordingIndexSheetUrl(raw);
    return '';
  } catch (error) {
    const msg = String(error?.message || '');
    if (/recording index sheet url is required/i.test(msg)) return '';
    return 'Recording index source URL must be a valid Google Sheets URL.';
  }
}

function downloadWarnings(form, formatKeys) {
  const warnings = [];
  const buckets = Array.isArray(form?.buckets) ? form.buckets : [];
  const downloadData = form?.downloadData || emptyDownloadData();
  const keysByType = formatKeys || { audio: [], video: [] };
  for (const b of buckets) {
    for (const k of keysByType.audio || []) {
      if (!String(downloadData.audio?.[b]?.[k] || '').trim()) warnings.push(`audio ${b}/${k} missing`);
    }
    for (const k of keysByType.video || []) {
      if (!String(downloadData.video?.[b]?.[k] || '').trim()) warnings.push(`video ${b}/${k} missing`);
    }
  }
  const importedSegments = Array.isArray(downloadData.importedSegments) ? downloadData.importedSegments : [];
  if (importedSegments.length === 0) {
    warnings.push('recording index import missing (Ctrl+I)');
  }
  return warnings;
}

function setManifestBundleTokensFromImport({ audio = {}, video = {} }, importedSegments, lookupNumber, formatKeys, buckets) {
  const nextAudio = { ...audio };
  const nextVideo = { ...video };
  const selectedBuckets = Array.isArray(buckets) ? buckets : [];
  const summaryByBucketType = new Set();
  const segmentSupportsType = (segment, type) => {
    const normalizedType = String(type || '').trim().toLowerCase();
    const directType = String(segment?.type || '').trim().toLowerCase();
    if (directType === normalizedType) return true;
    const available = Array.isArray(segment?.availableTypes)
      ? segment.availableTypes
      : [];
    return available.some((item) => String(item || '').trim().toLowerCase() === normalizedType);
  };
  for (const segment of importedSegments || []) {
    if (!segment || !segment.enabled) continue;
    const bucket = String(segment.bucket || '').trim().toUpperCase();
    if (!bucket || !selectedBuckets.includes(bucket)) continue;
    if (segmentSupportsType(segment, 'audio')) summaryByBucketType.add(`${bucket}:audio`);
    if (segmentSupportsType(segment, 'video')) summaryByBucketType.add(`${bucket}:video`);
  }

  for (const bucket of selectedBuckets) {
    nextAudio[bucket] = { ...(nextAudio[bucket] || {}) };
    nextVideo[bucket] = { ...(nextVideo[bucket] || {}) };
    for (const key of formatKeys.audio || []) {
      nextAudio[bucket][key] = summaryByBucketType.has(`${bucket}:audio`)
        ? `bundle:lookup:${lookupNumber}:${bucket}:audio`
        : '';
    }
    for (const key of formatKeys.video || []) {
      nextVideo[bucket][key] = summaryByBucketType.has(`${bucket}:video`)
        ? `bundle:lookup:${lookupNumber}:${bucket}:video`
        : '';
    }
  }
  return {
    audio: nextAudio,
    video: nextVideo,
  };
}

function rebuildImportedFiles(importedSegments = [], importedFiles = [], importSummary = null) {
  const pdfAssetId = String(importSummary?.pdfAssetId || '').trim().toLowerCase();
  const pdfFallback = (importedFiles || []).find((file) => {
    if (!file || typeof file !== 'object') return false;
    const fileId = String(file.fileId || '').trim().toLowerCase();
    if (pdfAssetId && fileId === pdfAssetId) return true;
    const mime = String(file.mime || '').trim().toLowerCase();
    const r2Key = String(file.r2Key || '').trim().toLowerCase();
    return mime.includes('pdf') || r2Key.endsWith('.pdf');
  }) || null;

  const segmentFiles = (importedSegments || []).map((segment, index) => ({
    bucketNumber: segment.bucketNumber,
    fileId: segment.fileId,
    bucket: segment.bucket,
    r2Key: segment.r2Key,
    driveFileId: segment.driveFileId || '',
    sizeBytes: Number(segment.sizeBytes || 0) || 0,
    mime: segment.mime || '',
    position: index + 1,
    label: segment.label || '',
    sourceLabel: segment.sourceLabel || segment.label || '',
    type: segment.type || 'unknown',
    availableTypes: Array.isArray(segment.availableTypes) ? segment.availableTypes.slice() : [],
    role: segment.role || 'media',
  }));
  if (!pdfFallback) return segmentFiles;
  return [
    ...segmentFiles,
    {
      ...pdfFallback,
      position: segmentFiles.length + 1,
    },
  ];
}

export function createDefaultWizardForm() {
  return {
    title: '',
    slug: '',
    slugTouched: false,
    lookupNumber: '',
    videoUrl: '',
    descriptionText: '',
    series: 'dex',
    buckets: ['A'],
    attributionSentence: '',
    creditsData: emptyCredits(),
    creditLinksData: emptyCreditLinksData(),
    downloadData: emptyDownloadData(),
  };
}
function withCaret(value, cursor, caretOn) { const safe = value || ''; return caretOn ? `${safe.slice(0, cursor)}▌${safe.slice(cursor)}` : safe; }
const safeList = (arr) => (Array.isArray(arr) ? arr.map((v) => String(v || '').trim()).filter(Boolean) : []);
const roleValue = (credits, roleKey) => roleKey.includes('.') ? credits[roleKey.split('.')[0]][roleKey.split('.')[1]] : credits[roleKey];
const roleSet = (credits, roleKey, value) => {
  if (roleKey.includes('.')) {
    const [g, k] = roleKey.split('.');
    return { ...credits, [g]: { ...credits[g], [k]: value } };
  }
  return { ...credits, [roleKey]: value };
};

export function applyKeyToInputState(state, input, key = {}, options = {}) {
  const value = state?.value ?? '';
  const cursor = Math.max(0, Math.min(value.length, state?.cursor ?? 0));
  const rawInput = typeof input === 'string' ? input : '';
  const keySequence = typeof key?.sequence === 'string' ? key.sequence : '';
  const controlSequence = rawInput || keySequence;
  if ((key.ctrl && (input === 'q' || input === 'Q')) || input === '\x11') return { value, cursor, quit: true };
  const isLeft = !!(key.leftArrow || input === '\x1b[D' || input === '\x1bOD');
  const isRight = !!(key.rightArrow || input === '\x1b[C' || input === '\x1bOC');
  const isHome = !!(key.home || input === '\x1b[H' || input === '\x1bOH' || input === '\x1b[1~' || input === '\x1b[7~');
  const isEnd = !!(key.end || input === '\x1b[F' || input === '\x1bOF' || input === '\x1b[4~' || input === '\x1b[8~');
  const isDeleteSequence = !!(
    /^\x1b\[3(?:;\d+)*~$/.test(controlSequence)
    || /^\x1b\[3(?:;\d+)*u$/.test(controlSequence)
  );
  const isBackspaceSequence = !!(/^\x1b\[127(?:;\d+)*u$/.test(controlSequence));
  const hasControlSequence = Boolean(rawInput || keySequence);
  const isAmbiguousDeleteKey = Boolean(
    key.delete
      && !isDeleteSequence
      && !key.backspace
      && !isBackspaceSequence
      && !hasControlSequence,
  );
  const isDelete = Boolean(key.delete || isDeleteSequence);
  if (isLeft) return { value, cursor: Math.max(0, cursor - 1) };
  if (isRight) return { value, cursor: Math.min(value.length, cursor + 1) };
  if (isHome) return { value, cursor: 0 };
  if (isEnd) return { value, cursor: value.length };
  if (isBackspaceKey(input, key) || isBackspaceSequence) {
    if (cursor === 0) return { value, cursor };
    return { value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`, cursor: cursor - 1 };
  }
  if (isAmbiguousDeleteKey && cursor === value.length && cursor > 0) {
    return { value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`, cursor: cursor - 1 };
  }
  if (isDelete) { if (cursor >= value.length) return { value, cursor }; return { value: `${value.slice(0, cursor)}${value.slice(cursor + 1)}`, cursor }; }
  const pasted = sanitizePastedInputChunk(input, { allowMultiline: Boolean(options?.allowMultiline) });
  if (pasted && (pasted.length > 1 || pasted.includes('\n') || pasted.includes('\t'))) {
    return {
      value: `${value.slice(0, cursor)}${pasted}${value.slice(cursor)}`,
      cursor: cursor + pasted.length,
    };
  }
  if (shouldAppendWizardChar(input, key)) return { value: `${value.slice(0, cursor)}${input}${value.slice(cursor)}`, cursor: cursor + 1 };
  return { value, cursor };
}

export function validateStep(stepId, form, selectedRole, formatKeys) {
  const safeForm = form || {};
  const buckets = Array.isArray(safeForm.buckets) ? safeForm.buckets : [];
  if (stepId === 'title' && !String(safeForm.title || '').trim()) return 'Title is required.';
  if (stepId === 'slug' && !String(safeForm.slug || '').trim()) return 'Slug is required.';
  if (stepId === 'lookupNumber' && !String(safeForm.lookupNumber || '').trim()) return 'Lookup number is required.';
  if (stepId === 'videoUrl' && !String(safeForm.videoUrl || '').trim()) return 'Video URL is required.';
  if (stepId === 'buckets' && buckets.length < 1) return 'Select at least one bucket.';
  if (stepId === 'attributionSentence' && !String(safeForm.attributionSentence || '').trim()) return 'Attribution sentence is required.';
  if (stepId === 'credits') {
    const creditsData = safeForm.creditsData || emptyCredits();
    const requiredRoles = [
      { key: 'artist', label: 'Artist(s)' },
      { key: 'instruments', label: 'Instruments' },
      { key: 'video.director', label: 'Video Director' },
      { key: 'video.cinematography', label: 'Video Cinematography' },
      { key: 'video.editing', label: 'Video Editing' },
      { key: 'audio.recording', label: 'Audio Recording' },
      { key: 'audio.mix', label: 'Audio Mix' },
      { key: 'audio.master', label: 'Audio Master' },
    ];
    for (const role of requiredRoles) {
      if (safeList(roleValue(creditsData, role.key)).length < 1) return `${role.label} needs at least one name.`;
    }
    if (!String(creditsData.year || '').trim()) return 'Year is required.';
    if (Number.isNaN(Number(creditsData.year))) return 'Year must be numeric.';
    if (!String(creditsData.season || '').trim()) return 'Season is required.';
    if (!String(creditsData.location || '').trim()) return 'Location is required.';
  }
  if (stepId === 'creditLinks') {
    const creditsData = safeForm.creditsData || emptyCredits();
    const creditLinksData = normalizeCreditLinksData(safeForm.creditLinksData || {});
    const allowedPeople = new Set(
      collectCreditLinkPeople(creditsData, creditLinksData.instrumentLinksEnabled).map((name) => normalizeCreditPersonKey(name)),
    );
    for (const [person, links] of Object.entries(creditLinksData.linksByPerson || {})) {
      const personKey = normalizeCreditPersonKey(person);
      if (personKey && allowedPeople.size && !allowedPeople.has(personKey)) {
        return `Credit links contain unknown person: ${person}`;
      }
      for (const link of links || []) {
        const label = String(link?.label || '').trim();
        const href = String(link?.href || '').trim();
        if (!label || !href) return 'Credit link entries must include label and URL.';
        try {
          const parsed = new URL(href);
          if (!/^https?:$/i.test(parsed.protocol)) {
            return `Credit link must use http(s): ${href}`;
          }
        } catch {
          return `Credit link URL is invalid: ${href}`;
        }
      }
    }
  }
  if (stepId === 'download') {
    const downloadData = safeForm.downloadData || emptyDownloadData();
    if (!downloadData || typeof downloadData !== 'object') return 'Download configuration is missing.';
    const bitDepth = Number(downloadData.fileSpecs?.bitDepth);
    const sampleRate = Number(downloadData.fileSpecs?.sampleRate);
    if (Number.isNaN(bitDepth) || bitDepth <= 0) return 'Bit depth must be numeric.';
    if (Number.isNaN(sampleRate) || sampleRate <= 0) return 'Sample rate must be numeric.';
    if (!CHANNELS.includes(downloadData.fileSpecs?.channels)) return 'Channels must be mono, stereo, or multichannel.';
    const recordingIndexPdfError = validateRecordingIndexPdfRef(downloadData.recordingIndexPdfRef);
    if (recordingIndexPdfError) return recordingIndexPdfError;
    const recordingIndexBundleError = validateRecordingIndexBundleRef(downloadData.recordingIndexBundleRef);
    if (recordingIndexBundleError) return recordingIndexBundleError;
    const recordingIndexSourceUrlError = validateRecordingIndexSourceUrl(downloadData.recordingIndexSourceUrl);
    if (recordingIndexSourceUrlError) return recordingIndexSourceUrlError;
    const health = buildDownloadTreeHealth({
      lookupNumber: safeForm.lookupNumber,
      buckets,
      formatKeys: formatKeys || { audio: [], video: [] },
      downloadData,
    });
    if (!health.summary.ok) {
      return `Download health has ${health.summary.criticalCount} critical issue(s); import/resolve before continuing.`;
    }
    if (!formatKeys) void selectedRole;
  }
  if (stepId === 'tags') {
    const downloadData = safeForm.downloadData || emptyDownloadData();
    if (safeList(downloadData.metadata?.tagsSelected).length < 1) return 'Select at least one tag.';
    if (!formatKeys) void selectedRole;
  }
  return null;
}

function parsePasteBlock(buffer, selectedBuckets, formatKeys) {
  const rows = String(buffer || '').split(/\r?\n/).map((line, idx) => ({ line, idx: idx + 1 })).filter((r) => r.line.trim());
  const next = { audio: {}, video: {} };
  const errors = [];
  rows.forEach(({ line, idx }) => {
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    if (parts.length < 4) return;
    const [typeRaw, bucketRaw, keyRaw, idRaw] = parts.map((p) => String(p || '').trim());
    if (idx === 1 && /type/i.test(typeRaw) && /bucket/i.test(bucketRaw)) return;
    const type = typeRaw.toLowerCase();
    if (!['audio', 'video'].includes(type)) { errors.push(`L${idx}: invalid type ${typeRaw}`); return; }
    const bucket = bucketRaw.toUpperCase();
    if (!selectedBuckets.includes(bucket)) { errors.push(`L${idx}: bucket ${bucket} not selected`); return; }
    if (!(formatKeys[type] || []).includes(keyRaw)) { errors.push(`L${idx}: invalid ${type} format ${keyRaw}`); return; }
    if (!isAssetReferenceToken(idRaw)) { errors.push(`L${idx}: invalid assetRef (use lookup:/asset:/bundle:)`); return; }
    next[type][bucket] = next[type][bucket] || {};
    next[type][bucket][keyRaw] = idRaw;
  });
  return { errors, next };
}

const STEPS = [
  { id: 'title', label: 'Title', kind: 'text' },
  { id: 'slug', label: 'Slug', kind: 'text' },
  { id: 'lookupNumber', label: 'Lookup number', kind: 'text' },
  { id: 'videoUrl', label: 'Video URL', kind: 'text' },
  { id: 'descriptionText', label: 'Description', kind: 'text' },
  { id: 'series', label: 'Series', kind: 'select', options: SERIES_OPTIONS },
  { id: 'buckets', label: 'Buckets', kind: 'multi' },
  { id: 'attributionSentence', label: 'Attribution sentence', kind: 'text' },
  { id: 'credits', label: 'Credits', kind: 'credits' },
  { id: 'creditLinks', label: 'Credit Links', kind: 'creditLinks' },
  { id: 'download', label: 'Download', kind: 'download' },
  { id: 'tags', label: 'Tags', kind: 'tags' },
  { id: 'summary', label: 'Summary', kind: 'summary' },
];

export function InitWizard({ templateArg, outDirDefault, onCancel, onDone }) {
  const { stdout } = useStdout();
  const [stepIdx, setStepIdx] = useState(0); const [caretOn, setCaretOn] = useState(true); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [doneReport, setDoneReport] = useState(null); const [multiCursor, setMultiCursor] = useState(0);
  const [creditsCursor, setCreditsCursor] = useState(0); const [creditsInputState, setCreditsInputState] = useState({ value: '', cursor: 0 }); const [reuseAsked, setReuseAsked] = useState(false); const [reuseChoice, setReuseChoice] = useState(true);
  const [creditLinksCursor, setCreditLinksCursor] = useState(0);
  const [creditLinksInputState, setCreditLinksInputState] = useState({ value: '', cursor: 0 });
  const [downloadCursor, setDownloadCursor] = useState(0); const [pasteMode, setPasteMode] = useState(false); const [downloadFocus, setDownloadFocus] = useState('rows');
  const [recordingIndexPdfCursor, setRecordingIndexPdfCursor] = useState(0);
  const [recordingIndexBundleCursor, setRecordingIndexBundleCursor] = useState(0);
  const [recordingIndexSourceCursor, setRecordingIndexSourceCursor] = useState(0);
  const [segmentCursor, setSegmentCursor] = useState(0);
  const [segmentEditMode, setSegmentEditMode] = useState(false);
  const [segmentEditField, setSegmentEditField] = useState('fileId');
  const [segmentEditCursor, setSegmentEditCursor] = useState(0);
  const [importMode, setImportMode] = useState(false);
  const [importInputFocus, setImportInputFocus] = useState('sheet');
  const [importSheetUrl, setImportSheetUrl] = useState('');
  const [importFallbackPath, setImportFallbackPath] = useState('');
  const [importSheetCursor, setImportSheetCursor] = useState(0);
  const [importFallbackCursor, setImportFallbackCursor] = useState(0);
  const [importBusy, setImportBusy] = useState(false);
  const [tagsCatalog, setTagsCatalog] = useState([]); const [tagsWarning, setTagsWarning] = useState('');
  const templateRef = useRef(null);
  const downloadImportPrimedRef = useRef(false);
  const [form, setForm] = useState(createDefaultWizardForm());
  const [cursorByStep, setCursorByStep] = useState({ title: 0, slug: 0, lookupNumber: 0, videoUrl: 0, descriptionText: 0, attributionSentence: 0 });

  const step = STEPS[stepIdx]; const totalSteps = STEPS.length;
  const creditRoles = [{ key: 'artist', label: 'Artist(s)' }, { key: 'instruments', label: 'Instruments' }, { key: 'video.director', label: 'Video Director' }, { key: 'video.cinematography', label: 'Video Cinematography' }, { key: 'video.editing', label: 'Video Editing' }, { key: 'audio.recording', label: 'Audio Recording' }, { key: 'audio.mix', label: 'Audio Mix' }, { key: 'audio.master', label: 'Audio Master' }, { key: 'year', label: 'Year' }, { key: 'season', label: 'Season' }, { key: 'location', label: 'Location' }, { key: 'artistAlt', label: 'Artist Alt' }];
  const selectedRole = creditRoles[Math.min(creditsCursor, creditRoles.length - 1)];
  const scalarCreditKeys = new Set(['year', 'season', 'location', 'artistAlt']);

  useEffect(() => { if (process.env.DEX_NO_ANIM === '1') return undefined; const id = setInterval(() => setCaretOn((p) => !p), 500); return () => clearInterval(id); }, []);
  useEffect(() => { if (!form.slugTouched) { const s = slugify(form.title || ''); setForm((p) => ({ ...p, slug: s })); setCursorByStep((p) => ({ ...p, slug: s.length })); } }, [form.title, form.slugTouched]);
  useEffect(() => {
    const roleKey = selectedRole?.key || '';
    const value = scalarCreditKeys.has(roleKey) ? String(roleValue(form.creditsData, roleKey) || '') : '';
    setCreditsInputState({ value, cursor: value.length });
  }, [creditsCursor]);

  useEffect(() => {
    const creditLinksData = normalizeCreditLinksData(form.creditLinksData || {});
    const people = collectCreditLinkPeople(form.creditsData, creditLinksData.instrumentLinksEnabled);
    if (!people.length) {
      setCreditLinksCursor(0);
      return;
    }
    setCreditLinksCursor((current) => Math.max(0, Math.min(current, people.length - 1)));
  }, [form.creditsData, form.creditLinksData]);

  useEffect(() => {
    const loadTags = async () => {
      try {
        const filePath = new URL('../data/tags.json', import.meta.url);
        const raw = await fs.readFile(filePath, 'utf8');
        const tags = JSON.parse(raw).map((line) => String(line || '').trim()).filter(Boolean);
        setTagsCatalog(tags);
      } catch {
        setTagsCatalog([]);
        setTagsWarning('Tags file unavailable: scripts/data/tags.json');
      }
    };
    void loadTags();
  }, []);

  useEffect(() => {
    if (step.kind !== 'download') return;
    const pdfValue = String(form.downloadData?.recordingIndexPdfRef || '');
    const bundleValue = String(form.downloadData?.recordingIndexBundleRef || '');
    const sourceValue = String(form.downloadData?.recordingIndexSourceUrl || '');
    setRecordingIndexPdfCursor((current) => Math.max(0, Math.min(current, pdfValue.length)));
    setRecordingIndexBundleCursor((current) => Math.max(0, Math.min(current, bundleValue.length)));
    setRecordingIndexSourceCursor((current) => Math.max(0, Math.min(current, sourceValue.length)));
    if (!importMode) {
      setImportSheetUrl((current) => (current ? current : sourceValue));
      setImportFallbackPath((current) => (current ? current : String(form.downloadData?.recordingIndexImportFallbackPath || '')));
    }
  }, [
    step.kind,
    importMode,
    form.downloadData?.recordingIndexPdfRef,
    form.downloadData?.recordingIndexBundleRef,
    form.downloadData?.recordingIndexSourceUrl,
    form.downloadData?.recordingIndexImportFallbackPath,
  ]);

  useEffect(() => {
    if (step.kind !== 'download') {
      downloadImportPrimedRef.current = false;
      return;
    }
    if (downloadImportPrimedRef.current) return;
    downloadImportPrimedRef.current = true;
    const hasImportedSegments = Array.isArray(form.downloadData?.importedSegments)
      && form.downloadData.importedSegments.length > 0;
    if (hasImportedSegments) return;
    setImportMode(true);
    setImportInputFocus('sheet');
    const source = String(form.downloadData.recordingIndexSourceUrl || importSheetUrl || '').trim();
    const fallback = String(form.downloadData.recordingIndexImportFallbackPath || importFallbackPath || '').trim();
    setImportSheetUrl(source);
    setImportFallbackPath(fallback);
    setImportSheetCursor(source.length);
    setImportFallbackCursor(fallback.length);
  }, [step.kind, form.downloadData?.importedSegments, form.downloadData?.recordingIndexSourceUrl, form.downloadData?.recordingIndexImportFallbackPath]);

  useEffect(() => {
    const segments = Array.isArray(form.downloadData?.importedSegments) ? form.downloadData.importedSegments : [];
    setSegmentCursor((current) => Math.max(0, Math.min(current, Math.max(0, segments.length - 1))));
  }, [form.downloadData?.importedSegments]);

  useEffect(() => {
    const fk = templateRef.current?.formatKeys || { audio: [], video: [] };
    const nextHealth = buildDownloadTreeHealth({
      lookupNumber: form.lookupNumber,
      buckets: form.buckets,
      formatKeys: fk,
      downloadData: form.downloadData,
    });
    const prevHealth = form.downloadData?.health || null;
    const prevSummary = form.downloadData?.healthSummary || null;
    const nextSummary = nextHealth.summary;
    const prevCritical = Array.isArray(prevHealth?.criticalIssues) ? prevHealth.criticalIssues.join('|') : '';
    const nextCritical = nextHealth.criticalIssues.join('|');
    const prevWarn = Array.isArray(prevHealth?.warnIssues) ? prevHealth.warnIssues.join('|') : '';
    const nextWarn = nextHealth.warnIssues.join('|');
    const summaryUnchanged = prevSummary
      && prevSummary.criticalCount === nextSummary.criticalCount
      && prevSummary.warnCount === nextSummary.warnCount
      && prevSummary.totalFiles === nextSummary.totalFiles
      && prevSummary.enabledFiles === nextSummary.enabledFiles
      && prevSummary.bucketCount === nextSummary.bucketCount
      && prevSummary.bundleRows === nextSummary.bundleRows
      && Boolean(prevSummary.ok) === Boolean(nextSummary.ok);
    if (summaryUnchanged && prevCritical === nextCritical && prevWarn === nextWarn) return;
    setForm((p) => ({
      ...p,
      downloadData: {
        ...p.downloadData,
        health: nextHealth,
        healthSummary: nextSummary,
      },
    }));
  }, [form.lookupNumber, form.buckets, form.downloadData]);

  const shiftStep = (d) => { setError(''); setStepIdx((p) => Math.max(0, Math.min(totalSteps - 1, p + d))); };
  const applyTextEdit = (input, key = {}, stepId = step.id) => {
    const value = (stepId in form) ? form[stepId] ?? '' : '';
    const pos = cursorByStep[stepId] ?? value.length;
    const next = applyKeyToInputState(
      { value, cursor: pos },
      input,
      key,
      { allowMultiline: stepId === 'descriptionText' },
    );
    if (next.value !== value || next.cursor !== pos) {
      setForm((p) => ({ ...p, [stepId]: next.value, ...(stepId === 'slug' ? { slugTouched: true } : {}) }));
      setCursorByStep((p) => ({ ...p, [stepId]: next.cursor }));
    }
    return next;
  };

  const loadRehydrate = async (slug) => {
    const outDir = path.resolve(outDirDefault || './entries');
    try {
      const entryPath = path.join(outDir, slug, 'entry.json');
      const entry = JSON.parse(await fs.readFile(entryPath, 'utf8'));
      const recordingIndexPdfRef = String(
        entry?.sidebarPageConfig?.downloads?.recordingIndexPdfRef
        || entry?.sidebarPageConfig?.recordingIndexPdfRef
        || '',
      ).trim();
      const recordingIndexBundleRef = String(
        entry?.sidebarPageConfig?.downloads?.recordingIndexBundleRef
        || entry?.sidebarPageConfig?.recordingIndexBundleRef
        || '',
      ).trim();
      const recordingIndexSourceUrl = String(
        entry?.sidebarPageConfig?.downloads?.recordingIndexSourceUrl
        || entry?.sidebarPageConfig?.recordingIndexSourceUrl
        || '',
      ).trim();
      setForm((p) => ({
        ...p,
        title: entry.title || p.title,
        lookupNumber: entry.sidebarPageConfig?.lookupNumber || p.lookupNumber,
        videoUrl: entry.video?.dataUrl || p.videoUrl,
        descriptionText: entry.descriptionText || p.descriptionText,
        series: entry.series || p.series,
        buckets: safeList(entry.selectedBuckets || entry.sidebarPageConfig?.buckets || p.buckets),
        attributionSentence: entry.sidebarPageConfig?.attributionSentence || p.attributionSentence,
        creditsData: {
          ...emptyCredits(),
          ...(entry.creditsData || {}),
          ...(entry.sidebarPageConfig?.credits
            ? {
              artist: safeList([entry.sidebarPageConfig.credits.artist?.name]),
              instruments: safeList((entry.sidebarPageConfig.credits.instruments || []).map((x) => x.name)),
            }
            : {}),
        },
        creditLinksData: {
          ...emptyCreditLinksData(),
          ...normalizeCreditLinksData({
            instrumentLinksEnabled: Boolean(entry.sidebarPageConfig?.credits?.instrumentLinksEnabled),
            linksByPerson: entry.sidebarPageConfig?.credits?.linksByPerson || {},
          }),
        },
        downloadData: {
          ...p.downloadData,
          series: entry.series || p.series,
          fileSpecs: { ...p.downloadData.fileSpecs, ...(entry.fileSpecs || {}) },
          metadata: {
            ...p.downloadData.metadata,
            tagsSelected: Array.isArray(entry.metadata?.tags) ? safeList(entry.metadata.tags) : p.downloadData.metadata.tagsSelected,
            tagsQuery: '',
            tagsCursor: 0,
          },
          recordingIndexPdfRef,
          recordingIndexBundleRef,
          recordingIndexSourceUrl,
          recordingIndexImportFallbackPath: '',
          recordingIndexPdfError: validateRecordingIndexPdfRef(recordingIndexPdfRef),
          recordingIndexBundleError: validateRecordingIndexBundleRef(recordingIndexBundleRef),
          recordingIndexSourceUrlError: validateRecordingIndexSourceUrl(recordingIndexSourceUrl),
          audio: entry.manifest?.audio || p.downloadData.audio,
          video: entry.manifest?.video || p.downloadData.video,
        },
      }));
      setRecordingIndexPdfCursor(recordingIndexPdfRef.length);
      setRecordingIndexBundleCursor(recordingIndexBundleRef.length);
      setRecordingIndexSourceCursor(recordingIndexSourceUrl.length);
      setImportSheetUrl(recordingIndexSourceUrl);
      setImportFallbackPath('');
      return true;
    } catch { return false; }
  };

  const runRecordingIndexImport = async () => {
    if (importBusy || busy) return;
    const lookupNumber = String(form.lookupNumber || '').trim();
    if (!lookupNumber) {
      setError('Lookup number is required before importing recording index.');
      return;
    }
    const sheetUrlInput = String(importSheetUrl || '').trim();
    if (!sheetUrlInput) {
      setError('Recording index sheet URL is required.');
      return;
    }
    let normalizedSheetUrl = sheetUrlInput;
    try {
      normalizedSheetUrl = parseRecordingIndexSheetUrl(sheetUrlInput).sheetUrl;
    } catch (error) {
      setError(String(error?.message || 'Recording index sheet URL is invalid.'));
      return;
    }
    if (!templateRef.current) templateRef.current = await prepareTemplate({ templateArg });
    const fk = templateRef.current?.formatKeys || { audio: [], video: [] };

    setImportBusy(true);
    setError('');
    try {
      const imported = await importRecordingIndexFromSheet({
        sheetUrl: normalizedSheetUrl,
        fallbackXlsxPath: String(importFallbackPath || '').trim(),
        lookupNumber,
        entrySlug: form.slug || form.title || lookupNumber,
      });
      const importedSegments = (imported.segments || []).map((segment) => ({
        bucketNumber: segment.bucketNumber,
        bucket: segment.bucket,
        segmentNumber: segment.segmentNumber,
        label: segment.label,
        sourceLabel: segment.sourceLabel || segment.label || '',
        rawUrl: segment.rawUrl,
        driveFileId: segment.driveFileId || '',
        type: segment.type,
        typeReason: segment.typeReason || '',
        availableTypes: Array.isArray(segment.availableTypes) ? segment.availableTypes.slice() : [],
        fileId: segment.fileId,
        r2Key: segment.r2Key,
        sizeBytes: Number(segment.sizeBytes || 0) || 0,
        mime: segment.mime || '',
        position: Number(segment.position || 0) || 0,
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

      setForm((p) => {
        const nextTokens = setManifestBundleTokensFromImport(
          {
            audio: p.downloadData.audio || {},
            video: p.downloadData.video || {},
          },
          importedSegments,
          lookupNumber,
          fk,
          p.buckets,
        );
        const recordingIndexPdfRef = String(imported.recordingIndex?.recordingIndexPdfRef || '').trim();
        const recordingIndexBundleRef = String(imported.recordingIndex?.recordingIndexBundleRef || '').trim();
        const recordingIndexSourceUrl = String(imported.recordingIndex?.recordingIndexSourceUrl || normalizedSheetUrl).trim();
        const nextImportSummary = {
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
        };
        const nextDownloadData = {
          ...p.downloadData,
          ...nextTokens,
          recordingIndexPdfRef,
          recordingIndexBundleRef,
          recordingIndexSourceUrl,
          recordingIndexImportFallbackPath: String(importFallbackPath || '').trim(),
          recordingIndexPdfError: validateRecordingIndexPdfRef(recordingIndexPdfRef),
          recordingIndexBundleError: validateRecordingIndexBundleRef(recordingIndexBundleRef),
          recordingIndexSourceUrlError: validateRecordingIndexSourceUrl(recordingIndexSourceUrl),
          importedSegments,
          importedFiles,
          importSummary: nextImportSummary,
        };
        const health = buildDownloadTreeHealth({
          lookupNumber,
          buckets: p.buckets,
          formatKeys: fk,
          downloadData: nextDownloadData,
        });
        return {
          ...p,
          downloadData: {
            ...nextDownloadData,
            health,
            healthSummary: health.summary,
          },
        };
      });

      const nextPdf = String(imported.recordingIndex?.recordingIndexPdfRef || '').trim();
      const nextBundle = String(imported.recordingIndex?.recordingIndexBundleRef || '').trim();
      const nextSource = String(imported.recordingIndex?.recordingIndexSourceUrl || normalizedSheetUrl).trim();
      setRecordingIndexPdfCursor(nextPdf.length);
      setRecordingIndexBundleCursor(nextBundle.length);
      setRecordingIndexSourceCursor(nextSource.length);
      setImportSheetUrl(nextSource);
      setImportSheetCursor(nextSource.length);
      setImportMode(false);
      setDownloadFocus('rows');
      setError('');
    } catch (errorImport) {
      setError(errorImport?.message || String(errorImport));
    } finally {
      setImportBusy(false);
    }
  };

  const maybeAdvance = async () => {
    if (!templateRef.current) templateRef.current = await prepareTemplate({ templateArg });
    const validation = validateStep(step.id, form, selectedRole, templateRef.current.formatKeys);
    if (validation) { setError(validation); return; }
    if (step.id === 'slug') {
      const outDir = path.resolve(outDirDefault || './entries');
      const slug = slugify(form.slug.trim());
      const rehydrated = await loadRehydrate(slug);
      if (!rehydrated) {
        const exists = new Set(); try { const dirs = await fs.readdir(outDir, { withFileTypes: true }); dirs.filter((d) => d.isDirectory()).forEach((d) => exists.add(d.name)); } catch {}
        let deduped = slug; let i = 2; while (exists.has(deduped)) { deduped = `${slug}-${i}`; i += 1; }
        setForm((p) => ({ ...p, slug: deduped, slugTouched: true }));
      }
    }
    if (step.id === 'credits' && !reuseAsked) {
      setReuseAsked(true);
      if (reuseChoice) {
        try { const cache = JSON.parse(await fs.readFile(path.join(path.resolve(outDirDefault || './entries'), LAST_CACHE), 'utf8')); if (Array.isArray(cache.lastInstruments)) setForm((p) => ({ ...p, creditsData: { ...p.creditsData, instruments: safeList(cache.lastInstruments) } })); } catch {}
      }
      return;
    }
    if (step.id === 'summary') {
      setBusy(true);
      try {
        const { formatKeys, templateHtml, templatePath } = templateRef.current;
        const manifest = buildEmptyManifestSkeleton(formatKeys);
        for (const bucket of BUCKETS) {
          manifest.audio[bucket] = { ...(manifest.audio[bucket] || {}), ...(form.downloadData.audio[bucket] || {}) };
          manifest.video[bucket] = { ...(manifest.video[bucket] || {}), ...(form.downloadData.video[bucket] || {}) };
        }
        const creditsData = {
          artist: safeList(form.creditsData.artist), artistAlt: form.creditsData.artistAlt || null, instruments: safeList(form.creditsData.instruments),
          video: { director: safeList(form.creditsData.video.director), cinematography: safeList(form.creditsData.video.cinematography), editing: safeList(form.creditsData.video.editing) },
          audio: { recording: safeList(form.creditsData.audio.recording), mix: safeList(form.creditsData.audio.mix), master: safeList(form.creditsData.audio.master) },
          year: Number(form.creditsData.year), season: form.creditsData.season, location: form.creditsData.location,
        };
        const recordingIndexPdfRef = String(form.downloadData.recordingIndexPdfRef || '').trim();
        const recordingIndexBundleRef = String(form.downloadData.recordingIndexBundleRef || '').trim();
        const recordingIndexSourceUrl = String(form.downloadData.recordingIndexSourceUrl || '').trim();
        const downloads = {};
        if (recordingIndexPdfRef) downloads.recordingIndexPdfRef = recordingIndexPdfRef;
        if (recordingIndexBundleRef) downloads.recordingIndexBundleRef = recordingIndexBundleRef;
        if (recordingIndexSourceUrl) downloads.recordingIndexSourceUrl = recordingIndexSourceUrl;
        const sidebar = {
          lookupNumber: form.lookupNumber, buckets: form.buckets, specialEventImage: mapSeriesToImage(form.series), attributionSentence: form.attributionSentence,
          credits: {
            artist: creditsData.artist,
            artistAlt: creditsData.artistAlt,
            instruments: creditsData.instruments,
            instrumentLinksEnabled: Boolean(form.creditLinksData?.instrumentLinksEnabled),
            linksByPerson: normalizeCreditLinksData(form.creditLinksData || {}).linksByPerson,
            video: { director: creditsData.video.director, cinematography: creditsData.video.cinematography, editing: creditsData.video.editing },
            audio: { recording: creditsData.audio.recording, mix: creditsData.audio.mix, master: creditsData.audio.master },
            year: creditsData.year,
            season: creditsData.season,
            location: creditsData.location,
          },
          fileSpecs: { bitDepth: Number(form.downloadData.fileSpecs.bitDepth) || 24, sampleRate: Number(form.downloadData.fileSpecs.sampleRate) || 48000, channels: form.downloadData.fileSpecs.channels, staticSizes: form.downloadData.fileSpecs.staticSizes },
          metadata: { sampleLength: 'AUTO', tags: safeList(form.downloadData.metadata.tagsSelected) },
          ...(Object.keys(downloads).length ? { downloads } : {}),
        };
        const importedFiles = Array.isArray(form.downloadData.importedFiles)
          ? form.downloadData.importedFiles
          : [];
        const protectedAssetsImport = importedFiles.length
          ? {
            lookupNumber: form.lookupNumber,
            title: form.title,
            status: 'draft',
            season: creditsData.season,
            files: importedFiles,
            entitlements: [{ type: 'membership_tier', value: 'member' }],
            recordingIndex: form.downloadData.recordingIndexSourceUrl
              ? {
                sheetUrl: String(form.downloadData.recordingIndexSourceUrl || '').trim(),
                sheetId: String(form.downloadData.importSummary?.sheetId || '').trim(),
                gid: String(form.downloadData.importSummary?.gid || '').trim() || '0',
                pdfAssetId: String(form.downloadData.importSummary?.pdfAssetId || '').trim(),
                bundleAllToken: String(form.downloadData.recordingIndexBundleRef || '').trim(),
                rootFolderUrl: String(form.downloadData.importSummary?.rootFolderUrl || '').trim(),
                bucketFolderUrls: form.downloadData.importSummary?.bucketFolderUrls || {},
              }
              : null,
          }
          : null;
        const { report } = await writeEntryFromData({
          templatePath,
          templateHtml,
          data: {
            slug: form.slug,
            title: form.title,
            video: { mode: 'url', dataUrl: form.videoUrl, dataUrlOriginal: form.videoUrl, dataHtml: '' },
            descriptionText: form.descriptionText || '',
            series: form.series,
            selectedBuckets: form.buckets,
            creditsData,
            fileSpecs: sidebar.fileSpecs,
            metadata: sidebar.metadata,
            sidebar,
            manifest,
            authEnabled: true,
            outDir: path.resolve(outDirDefault || './entries'),
            protectedAssetsImport,
          },
          opts: {
            catalogLink: {
              mode: 'create-linked',
            },
          },
        });
        await fs.mkdir(path.resolve(outDirDefault || './entries'), { recursive: true }).catch(() => {});
        await fs.writeFile(path.join(path.resolve(outDirDefault || './entries'), LAST_CACHE), `${JSON.stringify({ lastInstruments: creditsData.instruments }, null, 2)}\n`, 'utf8');
        setDoneReport(report);
      } catch (e) { setError(e.message); }
      setBusy(false);
      return;
    }
    shiftStep(1);
  };

  useInput((input, key) => {
    if (busy) return;
    if (doneReport) { if (key.return) onDone(doneReport); return; }
    if ((key.ctrl && (input === 'q' || input === 'Q')) || input === '\x11') { onCancel(); return; }
    if (isPlainEscapeKey(input, key) && !pasteMode && !importMode) { if (stepIdx === 0) onCancel(); else shiftStep(-1); return; }

    if (step.kind === 'text') { const next = applyTextEdit(input, key); if (next?.quit) { onCancel(); return; } if (key.return) void maybeAdvance(); return; }
    if (step.kind === 'select') { if (key.leftArrow || key.upArrow) setForm((p) => ({ ...p, series: SERIES_OPTIONS[(SERIES_OPTIONS.indexOf(p.series) - 1 + SERIES_OPTIONS.length) % SERIES_OPTIONS.length] })); if (key.rightArrow || key.downArrow) setForm((p) => ({ ...p, series: SERIES_OPTIONS[(SERIES_OPTIONS.indexOf(p.series) + 1) % SERIES_OPTIONS.length] })); if (key.return) void maybeAdvance(); return; }
    if (step.kind === 'multi') { if (key.upArrow) setMultiCursor((p) => (p - 1 + BUCKETS.length) % BUCKETS.length); if (key.downArrow) setMultiCursor((p) => (p + 1) % BUCKETS.length); if (input === ' ') setForm((p) => { const b = BUCKETS[multiCursor]; const s = new Set(Array.isArray(p.buckets) ? p.buckets : []); if (s.has(b)) s.delete(b); else s.add(b); return { ...p, buckets: BUCKETS.filter((x) => s.has(x)) }; }); if (key.return) void maybeAdvance(); return; }
    if (step.kind === 'credits') {
      if (key.upArrow) { setCreditsCursor((p) => Math.max(0, p - 1)); return; }
      if (key.downArrow) { setCreditsCursor((p) => Math.min(creditRoles.length - 1, p + 1)); return; }
      const isAdd = (key.ctrl && (input === 'a' || input === 'A')) || input === '\x01';
      const isRemoveLast = (key.ctrl && (input === 'd' || input === 'D')) || (key.ctrl && key.backspace);
      const isScalar = scalarCreditKeys.has(selectedRole?.key || '');
      if (isAdd && !isScalar) {
        const list = safeList(creditsInputState.value.split(','));
        if (list.length) {
          setForm((p) => ({ ...p, creditsData: roleSet(p.creditsData, selectedRole.key, [...safeList(roleValue(p.creditsData, selectedRole.key)), ...list]) }));
          setCreditsInputState({ value: '', cursor: 0 });
        }
        return;
      }
      if (isRemoveLast && !isScalar) {
        setForm((p) => ({ ...p, creditsData: roleSet(p.creditsData, selectedRole.key, safeList(roleValue(p.creditsData, selectedRole.key)).slice(0, -1)) }));
        return;
      }
      if (key.return) { void maybeAdvance(); return; }
      const next = applyKeyToInputState(creditsInputState, input, key, { allowMultiline: false });
      setCreditsInputState({ value: next.value, cursor: next.cursor });
      if (isScalar && selectedRole?.key) {
        setForm((p) => ({ ...p, creditsData: roleSet(p.creditsData, selectedRole.key, next.value) }));
      }
      return;
    }
    if (step.kind === 'creditLinks') {
      const isToggleInstrument = (key.ctrl && (input === 't' || input === 'T')) || input === '\x14';
      const isAdd = (key.ctrl && (input === 'a' || input === 'A')) || input === '\x01';
      const isRemoveLast = (key.ctrl && (input === 'd' || input === 'D')) || (key.ctrl && key.backspace);
      const normalized = normalizeCreditLinksData(form.creditLinksData || {});
      const people = collectCreditLinkPeople(form.creditsData, normalized.instrumentLinksEnabled);
      const selectedPerson = people[Math.min(creditLinksCursor, Math.max(0, people.length - 1))] || '';

      if (key.upArrow) {
        setCreditLinksCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setCreditLinksCursor((current) => Math.min(Math.max(0, people.length - 1), current + 1));
        return;
      }

      if (isToggleInstrument) {
        setForm((p) => {
          const current = normalizeCreditLinksData(p.creditLinksData || {});
          const nextEnabled = !current.instrumentLinksEnabled;
          const allowed = new Set(
            collectCreditLinkPeople(p.creditsData, nextEnabled).map((name) => normalizeCreditPersonKey(name)),
          );
          const nextMap = {};
          for (const [name, links] of Object.entries(current.linksByPerson || {})) {
            if (!allowed.has(normalizeCreditPersonKey(name))) continue;
            const deduped = dedupeCreditLinks(links);
            if (deduped.length) nextMap[name] = deduped;
          }
          return {
            ...p,
            creditLinksData: {
              ...p.creditLinksData,
              instrumentLinksEnabled: nextEnabled,
              linksByPerson: nextMap,
            },
          };
        });
        return;
      }

      if (isAdd) {
        const raw = String(creditLinksInputState.value || '').trim();
        if (!selectedPerson) {
          setError('No credited person selected for links.');
          return;
        }
        const pivot = raw.indexOf('|');
        if (pivot <= 0 || pivot >= raw.length - 1) {
          setError('Add links as "label|https://url".');
          return;
        }
        const label = raw.slice(0, pivot).trim();
        const href = raw.slice(pivot + 1).trim();
        if (!label || !href) {
          setError('Credit link requires both label and URL.');
          return;
        }
        try {
          const parsed = new URL(href);
          if (!/^https?:$/i.test(parsed.protocol)) throw new Error('protocol');
          setForm((p) => {
            const current = normalizeCreditLinksData(p.creditLinksData || {});
            const nextMap = { ...current.linksByPerson };
            const nextLinks = dedupeCreditLinks([...(nextMap[selectedPerson] || []), { label, href: parsed.toString() }]);
            if (nextLinks.length) nextMap[selectedPerson] = nextLinks;
            return {
              ...p,
              creditLinksData: {
                ...p.creditLinksData,
                instrumentLinksEnabled: current.instrumentLinksEnabled,
                linksByPerson: nextMap,
              },
            };
          });
          setCreditLinksInputState({ value: '', cursor: 0 });
          setError('');
        } catch {
          setError('Credit link URL must be valid http(s).');
        }
        return;
      }

      if (isRemoveLast) {
        if (!selectedPerson) return;
        setForm((p) => {
          const current = normalizeCreditLinksData(p.creditLinksData || {});
          const nextMap = { ...current.linksByPerson };
          const links = Array.isArray(nextMap[selectedPerson]) ? nextMap[selectedPerson].slice(0, -1) : [];
          if (links.length) nextMap[selectedPerson] = links;
          else delete nextMap[selectedPerson];
          return {
            ...p,
            creditLinksData: {
              ...p.creditLinksData,
              instrumentLinksEnabled: current.instrumentLinksEnabled,
              linksByPerson: nextMap,
            },
          };
        });
        return;
      }

      if (key.return) {
        void maybeAdvance();
        return;
      }

      const next = applyKeyToInputState(
        creditLinksInputState,
        input,
        key,
        { allowMultiline: false },
      );
      if (next.value !== creditLinksInputState.value || next.cursor !== creditLinksInputState.cursor) {
        setCreditLinksInputState(next);
      }
      return;
    }
    if (step.kind === 'download') {
      const fk = templateRef.current?.formatKeys || { audio: [], video: [] };
      const rows = [];
      form.buckets.forEach((b) => fk.audio.forEach((k) => rows.push({ type: 'audio', b, k }))); form.buckets.forEach((b) => fk.video.forEach((k) => rows.push({ type: 'video', b, k })));
      const isCtrlP = (key.ctrl && (input === 'p' || input === 'P')) || input === '\x10';
      const isCtrlG = (key.ctrl && (input === 'g' || input === 'G')) || input === '\x07';
      const isCtrlI = (key.ctrl && (input === 'i' || input === 'I')) || (!key.ctrl && !key.meta && input === 'I');
      const focusOrder = ['rows', 'pdf', 'bundle', 'source', 'segments'];

      if (importMode) {
        if (isPlainEscapeKey(input, key)) {
          setImportMode(false);
          return;
        }
        if (importBusy) return;
        if (key.tab) {
          setImportInputFocus((prev) => (prev === 'sheet' ? 'fallback' : 'sheet'));
          return;
        }
        if (key.return) {
          void runRecordingIndexImport();
          return;
        }
        if (importInputFocus === 'sheet') {
          const next = applyKeyToInputState(
            { value: importSheetUrl, cursor: importSheetCursor },
            input,
            key,
            { allowMultiline: false },
          );
          setImportSheetUrl(next.value);
          setImportSheetCursor(next.cursor);
          return;
        }
        const next = applyKeyToInputState(
          { value: importFallbackPath, cursor: importFallbackCursor },
          input,
          key,
          { allowMultiline: false },
        );
        setImportFallbackPath(next.value);
        setImportFallbackCursor(next.cursor);
        return;
      }

      if (pasteMode) {
        if (isPlainEscapeKey(input, key)) { setPasteMode(false); return; }
        if (isCtrlP) {
          const parsed = parsePasteBlock(form.downloadData.pasteBuffer, form.buckets, fk);
          if (parsed.errors.length) { setForm((p) => ({ ...p, downloadData: { ...p.downloadData, pasteError: parsed.errors.join(' | ') } })); return; }
          setForm((p) => ({ ...p, downloadData: { ...p.downloadData, audio: { ...p.downloadData.audio, ...parsed.next.audio }, video: { ...p.downloadData.video, ...parsed.next.video }, pasteError: '' } }));
          setPasteMode(false);
          return;
        }
        if (key.return) { setForm((p) => ({ ...p, downloadData: { ...p.downloadData, pasteBuffer: `${p.downloadData.pasteBuffer}\n` } })); return; }
        const n = applyKeyToInputState(
          { value: form.downloadData.pasteBuffer, cursor: form.downloadData.pasteBuffer.length },
          input,
          key,
          { allowMultiline: true },
        );
        setForm((p) => ({ ...p, downloadData: { ...p.downloadData, pasteBuffer: n.value } }));
        return;
      }

      if (isCtrlI) {
        setImportMode(true);
        setImportInputFocus('sheet');
        const source = String(form.downloadData.recordingIndexSourceUrl || importSheetUrl || '').trim();
        const fallback = String(form.downloadData.recordingIndexImportFallbackPath || importFallbackPath || '').trim();
        setImportSheetUrl(source);
        setImportFallbackPath(fallback);
        setImportSheetCursor(source.length);
        setImportFallbackCursor(fallback.length);
        return;
      }

      if (isCtrlP) { setForm((p) => ({ ...p, downloadData: { ...p.downloadData, pasteError: '' } })); setPasteMode(true); return; }
      if (isCtrlG) { setForm((p) => ({ ...p, downloadData: { ...p.downloadData, fileSpecs: { ...p.downloadData.fileSpecs, channels: CHANNELS[(CHANNELS.indexOf(p.downloadData.fileSpecs.channels) + 1) % CHANNELS.length] } } })); return; }
      if (key.tab) {
        setDownloadFocus((prev) => {
          const idx = focusOrder.indexOf(prev);
          if (idx < 0) return 'rows';
          return focusOrder[(idx + 1) % focusOrder.length];
        });
        return;
      }

      if (downloadFocus === 'pdf') {
        if (key.return) { void maybeAdvance(); return; }
        const current = String(form.downloadData.recordingIndexPdfRef || '');
        const next = applyKeyToInputState(
          { value: current, cursor: recordingIndexPdfCursor },
          input,
          key,
          { allowMultiline: false },
        );
        if (next.value !== current || next.cursor !== recordingIndexPdfCursor) {
          const nextError = validateRecordingIndexPdfRef(next.value);
          setForm((p) => ({
            ...p,
            downloadData: {
              ...p.downloadData,
              recordingIndexPdfRef: next.value,
              recordingIndexPdfError: nextError,
            },
          }));
          setRecordingIndexPdfCursor(next.cursor);
        }
        return;
      }

      if (downloadFocus === 'bundle') {
        if (key.return) { void maybeAdvance(); return; }
        const current = String(form.downloadData.recordingIndexBundleRef || '');
        const next = applyKeyToInputState(
          { value: current, cursor: recordingIndexBundleCursor },
          input,
          key,
          { allowMultiline: false },
        );
        if (next.value !== current || next.cursor !== recordingIndexBundleCursor) {
          const nextError = validateRecordingIndexBundleRef(next.value);
          setForm((p) => ({
            ...p,
            downloadData: {
              ...p.downloadData,
              recordingIndexBundleRef: next.value,
              recordingIndexBundleError: nextError,
            },
          }));
          setRecordingIndexBundleCursor(next.cursor);
        }
        return;
      }

      if (downloadFocus === 'source') {
        if (key.return) { void maybeAdvance(); return; }
        const current = String(form.downloadData.recordingIndexSourceUrl || '');
        const next = applyKeyToInputState(
          { value: current, cursor: recordingIndexSourceCursor },
          input,
          key,
          { allowMultiline: false },
        );
        if (next.value !== current || next.cursor !== recordingIndexSourceCursor) {
          const nextError = validateRecordingIndexSourceUrl(next.value);
          setForm((p) => ({
            ...p,
            downloadData: {
              ...p.downloadData,
              recordingIndexSourceUrl: next.value,
              recordingIndexSourceUrlError: nextError,
            },
          }));
          setRecordingIndexSourceCursor(next.cursor);
        }
        return;
      }

      if (downloadFocus === 'segments') {
        const segments = Array.isArray(form.downloadData.importedSegments) ? form.downloadData.importedSegments : [];
        if (!segments.length) {
          if (key.return) { void maybeAdvance(); }
          return;
        }
        if (segmentEditMode) {
          if (isPlainEscapeKey(input, key)) {
            setSegmentEditMode(false);
            return;
          }
          if (key.tab) {
            const nextField = segmentEditField === 'fileId' ? 'r2Key' : 'fileId';
            setSegmentEditField(nextField);
            const currentValue = String(segments[segmentCursor]?.[nextField] || '');
            setSegmentEditCursor(currentValue.length);
            return;
          }
          if (key.return) {
            setSegmentEditMode(false);
            return;
          }
          const current = String(segments[segmentCursor]?.[segmentEditField] || '');
          const next = applyKeyToInputState(
            { value: current, cursor: segmentEditCursor },
            input,
            key,
            { allowMultiline: false },
          );
          if (next.value !== current || next.cursor !== segmentEditCursor) {
            setForm((p) => {
              const updatedSegments = (Array.isArray(p.downloadData.importedSegments) ? p.downloadData.importedSegments : [])
                .map((segment, index) => (index === segmentCursor ? { ...segment, [segmentEditField]: next.value } : segment));
              return {
                ...p,
                downloadData: {
                  ...p.downloadData,
                  importedSegments: updatedSegments,
                  importedFiles: rebuildImportedFiles(
                    updatedSegments,
                    p.downloadData.importedFiles,
                    p.downloadData.importSummary,
                  ),
                },
              };
            });
            setSegmentEditCursor(next.cursor);
          }
          return;
        }
        const isCtrlE = (key.ctrl && (input === 'e' || input === 'E')) || input === '\x05';
        if (key.upArrow) { setSegmentCursor((prev) => Math.max(0, prev - 1)); return; }
        if (key.downArrow) { setSegmentCursor((prev) => Math.min(segments.length - 1, prev + 1)); return; }
        if (input === ' ') {
          setForm((p) => {
            const updatedSegments = (Array.isArray(p.downloadData.importedSegments) ? p.downloadData.importedSegments : [])
              .map((segment, index) => (index === segmentCursor ? { ...segment, enabled: segment.enabled === false } : segment));
            const nextTokens = setManifestBundleTokensFromImport(
              {
                audio: p.downloadData.audio || {},
                video: p.downloadData.video || {},
              },
              updatedSegments,
              p.lookupNumber,
              fk,
              p.buckets,
            );
            return {
              ...p,
              downloadData: {
                ...p.downloadData,
                ...nextTokens,
                importedSegments: updatedSegments,
                importedFiles: rebuildImportedFiles(
                  updatedSegments,
                  p.downloadData.importedFiles,
                  p.downloadData.importSummary,
                ),
              },
            };
          });
          return;
        }
        if (isCtrlE) {
          setSegmentEditMode(true);
          setSegmentEditField('fileId');
          setSegmentEditCursor(String(segments[segmentCursor]?.fileId || '').length);
          return;
        }
        if (key.return) { void maybeAdvance(); }
        return;
      }

      if (key.upArrow) { setDownloadCursor((p) => Math.max(0, p - 1)); return; }
      if (key.downArrow) { setDownloadCursor((p) => Math.min(rows.length - 1, p + 1)); return; }
      if (key.return) { void maybeAdvance(); return; }
      const cur = rows[downloadCursor];
      if (cur) {
        const current = form.downloadData[cur.type]?.[cur.b]?.[cur.k] || '';
        const n = applyKeyToInputState(
          { value: current, cursor: current.length },
          input,
          key,
          { allowMultiline: false },
        );
        setForm((p) => ({ ...p, downloadData: { ...p.downloadData, [cur.type]: { ...p.downloadData[cur.type], [cur.b]: { ...(p.downloadData[cur.type]?.[cur.b] || {}), [cur.k]: n.value } } } }));
      }
      return;
    }
    if (step.kind === 'tags') {
      const filteredTags = tagsCatalog.filter((tag) => tag.toLowerCase().includes((form.downloadData.metadata.tagsQuery || '').toLowerCase()));
      const currentCursor = Math.min(
        Math.max(0, Number(form.downloadData.metadata.tagsCursor || 0)),
        Math.max(0, filteredTags.length - 1),
      );
      if (key.upArrow) {
        setForm((p) => ({
          ...p,
          downloadData: {
            ...p.downloadData,
            metadata: {
              ...p.downloadData.metadata,
              tagsCursor: Math.max(0, Number(p.downloadData.metadata.tagsCursor || 0) - 1),
            },
          },
        }));
        return;
      }
      if (key.downArrow) {
        setForm((p) => ({
          ...p,
          downloadData: {
            ...p.downloadData,
            metadata: {
              ...p.downloadData.metadata,
              tagsCursor: Math.min(
                Math.max(0, filteredTags.length - 1),
                Number(p.downloadData.metadata.tagsCursor || 0) + 1,
              ),
            },
          },
        }));
        return;
      }
      if (input === ' ') {
        const currentTag = filteredTags[currentCursor];
        if (currentTag) {
          setForm((p) => {
            const selected = new Set(safeList(p.downloadData.metadata.tagsSelected));
            if (selected.has(currentTag)) selected.delete(currentTag);
            else selected.add(currentTag);
            return {
              ...p,
              downloadData: {
                ...p.downloadData,
                metadata: {
                  ...p.downloadData.metadata,
                  tagsSelected: Array.from(selected),
                },
              },
            };
          });
        }
        return;
      }
      if (isBackspaceKey(input, key)) {
        setForm((p) => ({
          ...p,
          downloadData: {
            ...p.downloadData,
            metadata: {
              ...p.downloadData.metadata,
              tagsQuery: String(p.downloadData.metadata.tagsQuery || '').slice(0, -1),
              tagsCursor: 0,
            },
          },
        }));
        return;
      }
      if (shouldAppendWizardChar(input, key)) {
        setForm((p) => ({
          ...p,
          downloadData: {
            ...p.downloadData,
            metadata: {
              ...p.downloadData.metadata,
              tagsQuery: `${p.downloadData.metadata.tagsQuery || ''}${input}`,
              tagsCursor: 0,
            },
          },
        }));
        return;
      }
      if (key.return) {
        void maybeAdvance();
      }
      return;
    }
    if (step.kind === 'summary' && key.return) void maybeAdvance();
  });

  const fk = templateRef.current?.formatKeys || { audio: [], video: [] };
  const downloadRows = [...form.buckets.flatMap((b) => fk.audio.map((k) => ({ type: 'audio', b, k }))), ...form.buckets.flatMap((b) => fk.video.map((k) => ({ type: 'video', b, k })))];
  const importedSegments = Array.isArray(form.downloadData.importedSegments) ? form.downloadData.importedSegments : [];
  const filteredTags = tagsCatalog.filter((tag) => tag.toLowerCase().includes((form.downloadData.metadata.tagsQuery || '').toLowerCase()));
  const safeTagCursor = Math.min(Math.max(0, form.downloadData.metadata.tagsCursor || 0), Math.max(0, filteredTags.length - 1));
  const rowsAvailable = Math.max(4, Math.min(12, (stdout?.rows || 24) - 16));
  const creditsWindow = computeWindow({ total: creditRoles.length, cursor: creditsCursor, height: rowsAvailable });
  const normalizedCreditLinks = normalizeCreditLinksData(form.creditLinksData || {});
  const creditLinkPeople = collectCreditLinkPeople(form.creditsData, normalizedCreditLinks.instrumentLinksEnabled);
  const safeCreditLinksCursor = Math.min(Math.max(0, creditLinksCursor), Math.max(0, creditLinkPeople.length - 1));
  const creditLinksWindow = computeWindow({ total: creditLinkPeople.length, cursor: safeCreditLinksCursor, height: Math.max(4, Math.floor(rowsAvailable / 2)) });
  const selectedCreditLinkPerson = creditLinkPeople[safeCreditLinksCursor] || '';
  const selectedCreditLinks = selectedCreditLinkPerson ? (normalizedCreditLinks.linksByPerson[selectedCreditLinkPerson] || []) : [];
  const creditLinksCount = Object.values(normalizedCreditLinks.linksByPerson || {}).reduce(
    (sum, links) => sum + (Array.isArray(links) ? links.length : 0),
    0,
  );
  const bucketsWindow = computeWindow({ total: BUCKETS.length, cursor: multiCursor, height: rowsAvailable });
  const downloadWindow = computeWindow({ total: downloadRows.length, cursor: downloadCursor, height: Math.max(4, Math.floor(rowsAvailable / 2)) });
  const tagsWindow = computeWindow({ total: filteredTags.length, cursor: safeTagCursor, height: Math.max(4, Math.floor(rowsAvailable / 2)) });
  const segmentWindow = computeWindow({ total: importedSegments.length, cursor: segmentCursor, height: Math.max(4, Math.floor(rowsAvailable / 2)) });
  const warnings = downloadWarnings(form, fk);
  const downloadHealth = buildDownloadTreeHealth({
    lookupNumber: form.lookupNumber,
    buckets: form.buckets,
    formatKeys: fk,
    downloadData: form.downloadData,
  });
  const downloadHealthSummary = downloadHealth.summary;
  const terminalColumns = stdout?.columns || 120;
  const downloadPaneRightWidth = Math.max(30, Math.min(52, Math.floor(terminalColumns * 0.34)));
  const downloadPaneLeftWidth = Math.max(36, terminalColumns - downloadPaneRightWidth - 12);
  const downloadPlotModel = buildDownloadTreePlotModelFromHealth(downloadHealth, { title: 'Download tree' });

  const footer = doneReport
    ? 'Enter return to menu'
    : step.kind === 'credits'
      ? 'Type to edit • Ctrl+A add (lists) • Ctrl+D remove last • Enter next • Esc back • Ctrl+Q quit'
      : step.kind === 'creditLinks'
        ? 'Type label|url • Ctrl+A add • Ctrl+D remove last • Ctrl+T toggle instruments • Enter next • Esc back • Ctrl+Q quit'
      : step.kind === 'download'
        ? (importMode
          ? 'Ctrl+I import mode • Tab switch sheet/fallback • Enter import • Esc close'
          : (pasteMode
            ? 'Ctrl+P finish & parse • Esc cancel • Enter newline'
            : 'Ctrl+I import sheet • Ctrl+P paste mode • Ctrl+G cycle channels • Tab switch rows/pdf/bundle/source/segments • Enter next • Esc back • Ctrl+Q quit'))
        : step.kind === 'tags'
          ? 'Type to filter • Space toggle tag • ↑/↓ move • Enter next • Esc back • Ctrl+Q quit'
        : 'Enter next • Esc back • Ctrl+Q quit';

  return React.createElement(Box, { flexDirection: 'column', height: '100%' },
    React.createElement(Text, { color: '#8f98a8' }, `Step ${stepIdx + 1}/${totalSteps} — ${step.label}`),
    React.createElement(Box, { marginTop: 1, borderStyle: 'round', borderColor: '#6fa8ff', paddingX: 1, flexDirection: 'column' },
      step.kind === 'text' && step.id !== 'descriptionText'
        ? React.createElement(Text, { color: '#d0d5df' }, `› ${step.label}: [ ${withCaret(form[step.id] || '', cursorByStep[step.id] ?? 0, caretOn || process.env.DEX_NO_ANIM === '1')} ]`)
        : null,
      step.kind === 'text' && step.id === 'descriptionText'
        ? React.createElement(Box, { flexDirection: 'column' },
          React.createElement(Text, { color: '#d0d5df' }, '› Description:'),
          React.createElement(Text, { color: '#d0d5df' }, withCaret(form.descriptionText || '', cursorByStep.descriptionText ?? 0, caretOn || process.env.DEX_NO_ANIM === '1')),
        )
        : null,
      step.kind === 'select' ? React.createElement(Text, { color: '#d0d5df' }, `› Series: ${form.series} (←/→)`) : null,
      step.kind === 'multi' ? React.createElement(Box, { flexDirection: 'column' },
        bucketsWindow.start > 0 ? React.createElement(Text, { color: '#8f98a8', key: 'buckets-up' }, '…') : null,
        ...BUCKETS.slice(bucketsWindow.start, bucketsWindow.end).map((b, localIdx) => {
          const i = bucketsWindow.start + localIdx;
          return React.createElement(Text, { key: b, inverse: i === multiCursor }, `${i === multiCursor ? '›' : ' '} [${form.buckets.includes(b) ? 'x' : ' '}] ${b}`);
        }),
        bucketsWindow.end < BUCKETS.length ? React.createElement(Text, { color: '#8f98a8', key: 'buckets-down' }, '…') : null,
      ) : null,
      step.kind === 'credits' ? React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: '#8f98a8' }, reuseAsked ? `Reuse instruments: ${reuseChoice ? 'yes' : 'no'}` : 'On Enter, instruments can reuse last entry cache'),
        React.createElement(Text, { color: '#d0d5df' }, `› Editing: ${selectedRole?.label || '-'}`),
        React.createElement(Text, { color: '#d0d5df' }, `Input: [ ${withCaret(creditsInputState.value, creditsInputState.cursor, caretOn || process.env.DEX_NO_ANIM === '1')} ]`),
        creditsWindow.start > 0 ? React.createElement(Text, { color: '#8f98a8', key: 'credits-up' }, '…') : null,
        ...creditRoles.slice(creditsWindow.start, creditsWindow.end).map((r, localIdx) => {
          const i = creditsWindow.start + localIdx;
          const raw = roleValue(form.creditsData, r.key);
          const display = Array.isArray(raw) ? (raw.join(', ') || '(empty)') : (String(raw || '').trim() || '(empty)');
          return React.createElement(Text, { key: r.key, inverse: i === creditsCursor }, `${i === creditsCursor ? '›' : ' '} ${r.label}: ${display}`);
        }),
        creditsWindow.end < creditRoles.length ? React.createElement(Text, { color: '#8f98a8', key: 'credits-down' }, '…') : null,
      ) : null,
      step.kind === 'creditLinks' ? React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: '#8f98a8' }, `Instrument links: ${normalizedCreditLinks.instrumentLinksEnabled ? 'on' : 'off'} (Ctrl+T)`),
        React.createElement(Text, { color: '#d0d5df' }, `Input [label|url]: ${withCaret(creditLinksInputState.value, creditLinksInputState.cursor, caretOn || process.env.DEX_NO_ANIM === '1')}`),
        React.createElement(Text, { color: '#8f98a8' }, `People: ${creditLinkPeople.length}`),
        creditLinksWindow.start > 0 ? React.createElement(Text, { color: '#8f98a8', key: 'credit-links-up' }, '…') : null,
        ...creditLinkPeople.slice(creditLinksWindow.start, creditLinksWindow.end).map((person, localIdx) => {
          const idx = creditLinksWindow.start + localIdx;
          const links = normalizedCreditLinks.linksByPerson[person] || [];
          return React.createElement(Text, { key: `credit-link-person-${person}`, inverse: idx === safeCreditLinksCursor }, `${idx === safeCreditLinksCursor ? '›' : ' '} ${person} (${links.length})`);
        }),
        creditLinksWindow.end < creditLinkPeople.length ? React.createElement(Text, { color: '#8f98a8', key: 'credit-links-down' }, '…') : null,
        selectedCreditLinkPerson
          ? React.createElement(Text, { color: '#d0d5df' }, `Selected: ${selectedCreditLinkPerson}`)
          : React.createElement(Text, { color: '#8f98a8' }, 'Selected: (none)'),
        ...selectedCreditLinks.slice(0, 6).map((link, idx) => React.createElement(
          Text,
          { key: `credit-link-${idx}-${link.href}`, color: '#8f98a8' },
          `  • ${link.label} -> ${link.href}`,
        )),
        selectedCreditLinks.length > 6
          ? React.createElement(Text, { color: '#8f98a8' }, `  • +${selectedCreditLinks.length - 6} more`)
          : null,
      ) : null,
      step.kind === 'download' ? React.createElement(Box, { flexDirection: 'row' },
        React.createElement(Box, { flexDirection: 'column', width: downloadPaneLeftWidth },
          importMode ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, { color: '#d0d5df' }, 'Import Recording Index (Ctrl+I)'),
            React.createElement(Text, { color: '#8f98a8' }, `Sheet URL: [ ${importInputFocus === 'sheet' ? withCaret(importSheetUrl, importSheetCursor, caretOn || process.env.DEX_NO_ANIM === '1') : importSheetUrl} ]`),
            React.createElement(Text, { color: '#8f98a8' }, `Fallback XLSX path: [ ${importInputFocus === 'fallback' ? withCaret(importFallbackPath, importFallbackCursor, caretOn || process.env.DEX_NO_ANIM === '1') : importFallbackPath} ]`),
            React.createElement(Text, { color: '#8f98a8' }, `Lookup: ${form.lookupNumber || '(required)'}`),
            React.createElement(Text, { color: importBusy ? '#ffcc66' : '#8f98a8' }, importBusy ? 'Importing from sheet…' : 'Enter import • Tab switch field • Esc close'),
          ) : null,
          pasteMode ? React.createElement(Text, { color: '#d0d5df' }, `Paste rows type,bucket,formatKey,assetRef\nCtrl+P finish & parse • Esc cancel\n${form.downloadData.pasteBuffer}`) : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#8f98a8' }, `channels=${form.downloadData.fileSpecs.channels} • focus=${downloadFocus} • files=${downloadHealthSummary.enabledFiles}/${downloadHealthSummary.totalFiles}`) : null,
          !pasteMode && !importMode && downloadWindow.start > 0 ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
          !pasteMode && !importMode ? downloadRows.slice(downloadWindow.start, downloadWindow.end).map((row, localIdx) => {
            const idx = downloadWindow.start + localIdx;
            return React.createElement(Text, { key: `${row.type}-${row.b}-${row.k}`, inverse: idx === downloadCursor && downloadFocus === 'rows' }, `${idx === downloadCursor ? '›' : ' '} ${row.type} ${row.b}/${row.k}: ${form.downloadData[row.type]?.[row.b]?.[row.k] || ''}`);
          }) : null,
          !pasteMode && !importMode && downloadWindow.end < downloadRows.length ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#d0d5df' }, 'sampleLength: AUTO') : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#d0d5df' }, 'Recording index PDF token [lookup:/asset:]') : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#8f98a8' }, `PDF: [ ${(downloadFocus === 'pdf') ? withCaret(form.downloadData.recordingIndexPdfRef || '', recordingIndexPdfCursor, caretOn || process.env.DEX_NO_ANIM === '1') : (form.downloadData.recordingIndexPdfRef || '')} ]`) : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#d0d5df' }, 'Recording index bundle token [bundle:]') : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#8f98a8' }, `Bundle: [ ${(downloadFocus === 'bundle') ? withCaret(form.downloadData.recordingIndexBundleRef || '', recordingIndexBundleCursor, caretOn || process.env.DEX_NO_ANIM === '1') : (form.downloadData.recordingIndexBundleRef || '')} ]`) : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#d0d5df' }, 'Recording index source URL') : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#8f98a8' }, `Source: [ ${(downloadFocus === 'source') ? withCaret(form.downloadData.recordingIndexSourceUrl || '', recordingIndexSourceCursor, caretOn || process.env.DEX_NO_ANIM === '1') : (form.downloadData.recordingIndexSourceUrl || '')} ]`) : null,
          !pasteMode && !importMode ? React.createElement(Text, { color: '#d0d5df' }, `Imported per-file segments: ${importedSegments.length}`) : null,
          !pasteMode && !importMode && segmentWindow.start > 0 ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
          !pasteMode && !importMode ? importedSegments.slice(segmentWindow.start, segmentWindow.end).map((segment, localIdx) => {
            const idx = segmentWindow.start + localIdx;
            const enabled = segment.enabled !== false;
            const marker = idx === segmentCursor && downloadFocus === 'segments' ? '›' : ' ';
            const editing = segmentEditMode && idx === segmentCursor ? ` (${segmentEditField} edit)` : '';
            const desc = `${segment.bucketNumber} ${segment.type || 'unknown'} ${segment.fileId || '-'} -> ${segment.r2Key || '-'}`;
            return React.createElement(Text, {
              key: `seg-${segment.bucketNumber}-${idx}`,
              inverse: idx === segmentCursor && downloadFocus === 'segments',
            }, `${marker} [${enabled ? 'x' : ' '}] ${desc}${editing}`);
          }) : null,
          !pasteMode && !importMode && segmentWindow.end < importedSegments.length ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
          !pasteMode && !importMode && form.downloadData.importSummary
            ? React.createElement(
              Text,
              { color: '#8f98a8' },
              `Import: ${form.downloadData.importSummary.sourceMode} • files=${form.downloadData.importSummary.totalFiles} (audio=${form.downloadData.importSummary.audioFiles} video=${form.downloadData.importSummary.videoFiles} unknown=${form.downloadData.importSummary.unknownFiles}) • sheet=${form.downloadData.importSummary.sheetId || '-'}/${form.downloadData.importSummary.gid || '-'}`,
            )
            : null,
          tagsWarning ? React.createElement(Text, { color: '#8f98a8', dimColor: true }, tagsWarning) : null,
          !pasteMode && !importMode && warnings.length ? warnings.slice(0, 4).map((msg) => React.createElement(Text, { key: `warn-${msg}`, color: '#8f98a8', dimColor: true }, `warning: ${msg}`)) : null,
          !pasteMode && !importMode && warnings.length > 4 ? React.createElement(Text, { color: '#8f98a8', dimColor: true }, `warning: +${warnings.length - 4} more`) : null,
          !pasteMode && !importMode && form.downloadData.recordingIndexPdfError ? React.createElement(Text, { color: '#ff6b6b' }, form.downloadData.recordingIndexPdfError) : null,
          !pasteMode && !importMode && form.downloadData.recordingIndexBundleError ? React.createElement(Text, { color: '#ff6b6b' }, form.downloadData.recordingIndexBundleError) : null,
          !pasteMode && !importMode && form.downloadData.recordingIndexSourceUrlError ? React.createElement(Text, { color: '#ff6b6b' }, form.downloadData.recordingIndexSourceUrlError) : null,
          form.downloadData.pasteError ? React.createElement(Text, { color: '#ff6b6b' }, form.downloadData.pasteError) : null,
        ),
        React.createElement(Box, { marginLeft: 1, width: downloadPaneRightWidth, borderStyle: 'round', borderColor: '#4e5a70', paddingX: 1, flexDirection: 'column' },
          importMode ? React.createElement(Text, { color: '#ffcc66' }, 'import mode active') : null,
          pasteMode ? React.createElement(Text, { color: '#ffcc66' }, 'paste mode active') : null,
          React.createElement(DownloadTreePlotter, {
            model: downloadPlotModel,
            width: downloadPaneRightWidth - 2,
            maxBucketRows: 7,
            maxSubtypeRows: 5,
            maxIssueRows: 3,
          }),
        ),
      ) : null,
      step.kind === 'tags' ? React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: '#d0d5df' }, `Tags (required) [${safeList(form.downloadData.metadata.tagsSelected).length} selected]`),
        React.createElement(Text, { color: '#8f98a8' }, `Filter: [ ${withCaret(form.downloadData.metadata.tagsQuery || '', (form.downloadData.metadata.tagsQuery || '').length, caretOn || process.env.DEX_NO_ANIM === '1')} ]`),
        tagsWindow.start > 0 ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
        filteredTags.slice(tagsWindow.start, tagsWindow.end).map((tag, localIdx) => {
          const idx = tagsWindow.start + localIdx;
          const selected = safeList(form.downloadData.metadata.tagsSelected).includes(tag);
          return React.createElement(Text, { key: `tag-${tag}`, inverse: idx === safeTagCursor }, `${idx === safeTagCursor ? '›' : ' '} [${selected ? 'x' : ' '}] ${tag}`);
        }),
        tagsWindow.end < filteredTags.length ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
        tagsWarning ? React.createElement(Text, { color: '#8f98a8', dimColor: true }, tagsWarning) : null,
      ) : null,
      step.kind === 'summary' ? React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: '#d0d5df' }, `› Title: ${form.title}`),
        React.createElement(Text, { color: '#d0d5df' }, `› Slug: ${form.slug}`),
        React.createElement(Text, { color: '#d0d5df' }, `› Buckets: ${form.buckets.join(', ')}`),
        React.createElement(Text, { color: String(form.downloadData.recordingIndexPdfRef || '').trim() ? '#d0d5df' : '#ffcc66' }, String(form.downloadData.recordingIndexPdfRef || '').trim() ? `› Recording index PDF: ${form.downloadData.recordingIndexPdfRef}` : '› Advisory: recording index PDF token is empty (draft allowed, active publish will fail).'),
        React.createElement(Text, { color: String(form.downloadData.recordingIndexBundleRef || '').trim() ? '#d0d5df' : '#ffcc66' }, String(form.downloadData.recordingIndexBundleRef || '').trim() ? `› Recording index bundle: ${form.downloadData.recordingIndexBundleRef}` : '› Advisory: recording index bundle token is empty (draft allowed, active publish will fail).'),
        React.createElement(Text, { color: '#d0d5df' }, `› Imported segments: ${importedSegments.length}`),
        React.createElement(Text, { color: '#d0d5df' }, `› Credit links: ${creditLinksCount} (${normalizedCreditLinks.instrumentLinksEnabled ? 'instrument links on' : 'instrument links off'})`),
        React.createElement(Text, { color: downloadHealthSummary.ok ? '#a6e3a1' : '#ff6b6b' }, `› Download tree health: ${downloadHealthSummary.ok ? 'PASS' : 'FAIL'} (critical=${downloadHealthSummary.criticalCount} warn=${downloadHealthSummary.warnCount})`),
        React.createElement(Text, { color: safeList(form.downloadData.metadata.tagsSelected).length > 0 ? '#a6e3a1' : '#ff6b6b' }, `› Tags: ${safeList(form.downloadData.metadata.tagsSelected).length > 0 ? 'PASS' : 'FAIL'} (${safeList(form.downloadData.metadata.tagsSelected).length} selected)`),
        React.createElement(Text, { color: '#d0d5df' }, '› Press Enter to Generate'),
      ) : null,
    ),
    busy ? React.createElement(Text, { color: '#ffcc66' }, 'Generating...') : null,
    error ? React.createElement(Text, { color: '#ff6b6b' }, error) : null,
    React.createElement(Box, { marginTop: 1 }, React.createElement(Text, { color: '#6e7688' }, footer)),
  );
}
