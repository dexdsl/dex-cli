import { z } from 'zod';
import { assertAssetReferenceTokenKinds } from './asset-ref.mjs';

export const BUCKETS = ['A', 'B', 'C', 'D', 'E', 'X'];
export const ALL_BUCKETS = BUCKETS;

const linkSchema = z.object({ label: z.string().min(1), href: z.string().min(1) });
const linksByPersonSchema = z.record(z.string().min(1), z.array(linkSchema).default([])).default({});
const personSchema = z.object({ name: z.string().min(1), links: z.array(linkSchema).optional() });
const personNameListSchema = z.array(z.string().min(1)).default([]);
const personArraySchema = z.array(personSchema).default([]);
const legacyPersonSchema = z.object({ name: z.string().default(''), links: z.array(linkSchema).default([]) });
const peopleFieldSchema = z.union([
  personNameListSchema,
  personArraySchema.transform((value) => value.map((item) => item.name)),
  legacyPersonSchema.transform((value) => (value?.name ? String(value.name).split(',').map((v) => v.trim()).filter(Boolean) : [])),
]);

export const creditsSchema = z.object({
  artist: peopleFieldSchema,
  artistAlt: z.string().nullable().optional(),
  instruments: personNameListSchema,
  instrumentLinksEnabled: z.boolean().default(false),
  linksByPerson: linksByPersonSchema,
  video: z.object({ director: peopleFieldSchema, cinematography: peopleFieldSchema, editing: peopleFieldSchema }),
  audio: z.object({ recording: peopleFieldSchema, mix: peopleFieldSchema, master: peopleFieldSchema }),
  year: z.number().int(),
  season: z.string().min(1),
  location: z.string().min(1),
});
export const creditsDataSchema = z.object({
  artist: personNameListSchema,
  artistAlt: z.string().nullable().optional(),
  instruments: personNameListSchema,
  video: z.object({ director: personNameListSchema, cinematography: personNameListSchema, editing: personNameListSchema }),
  audio: z.object({ recording: personNameListSchema, mix: personNameListSchema, master: personNameListSchema }),
  year: z.number().int(),
  season: z.string().min(1),
  location: z.string().min(1),
});

export const downloadDataSchema = z.object({
  selectedBuckets: z.array(z.enum(BUCKETS)).optional(),
  series: z.string().optional(),
  fileSpecs: z.object({
    bitDepth: z.number().int().optional(),
    sampleRate: z.number().int().optional(),
    channels: z.enum(['mono', 'stereo', 'multichannel']).optional(),
    staticSizes: z.object({ A: z.string().default(''), B: z.string().default(''), C: z.string().default(''), D: z.string().default(''), E: z.string().default(''), X: z.string().default('') }).optional(),
  }).optional(),
  metadata: z.object({ sampleLength: z.string().optional(), tags: z.array(z.string()).optional() }).optional(),
}).optional();

const bucketFileStatsFormatCountSchema = z.number().int().nonnegative();
const bucketFileStatsBucketSchema = z.object({
  audio: z.object({
    mp3: bucketFileStatsFormatCountSchema.optional(),
    wav: bucketFileStatsFormatCountSchema.optional(),
  }).strict().optional(),
  video: z.object({
    '1080p': bucketFileStatsFormatCountSchema.optional(),
    '4K': bucketFileStatsFormatCountSchema.optional(),
  }).strict().optional(),
}).strict();
const bucketFileStatsSchema = z.object({
  A: bucketFileStatsBucketSchema.optional(),
  B: bucketFileStatsBucketSchema.optional(),
  C: bucketFileStatsBucketSchema.optional(),
  D: bucketFileStatsBucketSchema.optional(),
  E: bucketFileStatsBucketSchema.optional(),
  X: bucketFileStatsBucketSchema.optional(),
}).strict();

const downloadTreeFileSchema = z.object({
  fileId: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  filename: z.string().trim().min(1).optional(),
  extension: z.string().trim().min(1).optional(),
  variantKey: z.string().trim().min(1).optional(),
  variantLabel: z.string().trim().min(1).optional(),
}).passthrough();
const downloadTreeVariantSchema = z.object({
  variantKey: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  files: z.array(downloadTreeFileSchema).default([]),
}).passthrough();
const downloadTreeTypeSchema = z.object({
  mediaType: z.enum(['audio', 'video']),
  files: z.array(downloadTreeFileSchema).default([]).optional(),
  variants: z.array(downloadTreeVariantSchema).default([]).optional(),
}).passthrough();
const downloadTreeBucketSchema = z.object({
  bucket: z.enum(BUCKETS),
  types: z.array(downloadTreeTypeSchema).default([]),
}).passthrough();
const downloadTreeLookupSchema = z.object({
  lookup: z.string().trim().min(1).optional(),
  buckets: z.array(downloadTreeBucketSchema).default([]),
}).passthrough();
const downloadTreeRecordSchema = z.record(z.string().trim().min(1), downloadTreeLookupSchema);
const downloadTreeSchema = z.union([downloadTreeLookupSchema, downloadTreeRecordSchema]);

export const sidebarConfigSchema = z.object({
  lookupNumber: z.string().min(1),
  buckets: z.array(z.enum(BUCKETS)).min(1),
  specialEventImage: z.string().nullable().optional(),
  attributionSentence: z.string().min(1),
  credits: creditsSchema,
  fileSpecs: z.object({
    bitDepth: z.number().int().default(24),
    sampleRate: z.number().int().default(48000),
    channels: z.enum(['mono', 'stereo', 'multichannel']).default('stereo'),
    staticSizes: z.object({ A: z.string().default(''), B: z.string().default(''), C: z.string().default(''), D: z.string().default(''), E: z.string().default(''), X: z.string().default('') }),
  }),
  metadata: z.object({ sampleLength: z.string().default(''), tags: z.array(z.string()).default([]) }),
  bucketFileStats: bucketFileStatsSchema.optional(),
  downloads: z.object({
    recordingIndexPdfRef: z.string().trim().min(1).refine((value) => {
      try {
        assertAssetReferenceTokenKinds(value, ['lookup', 'asset'], 'sidebarPageConfig.downloads.recordingIndexPdfRef');
        return true;
      } catch {
        return false;
      }
    }, {
      message: 'recordingIndexPdfRef must be lookup: or asset: token',
    }).optional(),
    recordingIndexBundleRef: z.string().trim().min(1).refine((value) => {
      try {
        assertAssetReferenceTokenKinds(value, ['bundle'], 'sidebarPageConfig.downloads.recordingIndexBundleRef');
        return true;
      } catch {
        return false;
      }
    }, {
      message: 'recordingIndexBundleRef must be bundle: token',
    }).optional(),
    recordingIndexSourceUrl: z.string().trim().min(1).refine((value) => {
      try {
        const parsed = new URL(value);
        return /^https?:$/i.test(parsed.protocol);
      } catch {
        return false;
      }
    }, {
      message: 'recordingIndexSourceUrl must be an http(s) URL',
    }).optional(),
    fileTree: downloadTreeSchema.optional(),
  }).optional(),
});

export const entrySchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  canonical: z.object({
    instrument: z.string().default(''),
    artistName: z.string().default(''),
  }).optional(),
  lifecycle: z.object({
    publishedAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).optional(),
  video: z.object({ mode: z.enum(['url', 'embed']), dataUrl: z.string().default(''), dataHtml: z.string().default('') }),
  sidebarPageConfig: sidebarConfigSchema,
  descriptionText: z.string().optional(),
  series: z.string().optional(),
  selectedBuckets: z.array(z.enum(BUCKETS)).optional(),
  creditsData: creditsDataSchema.optional(),
  fileSpecs: z.object({
    bitDepth: z.number().int().optional(),
    sampleRate: z.number().int().optional(),
    channels: z.enum(['mono', 'stereo', 'multichannel']).optional(),
    staticSizes: z.object({ A: z.string().default(''), B: z.string().default(''), C: z.string().default(''), D: z.string().default(''), E: z.string().default(''), X: z.string().default('') }).optional(),
  }).optional(),
  metadata: z.object({ sampleLength: z.string().optional(), tags: z.array(z.string()).optional() }).optional(),
});

export function manifestSchemaForFormats(audioKeys = [], videoKeys = []) {
  const recordFor = (keys) => (keys.length
    ? z.object(Object.fromEntries(keys.map((k) => [k, z.string().default('')]))).passthrough()
    : z.record(z.string(), z.string().default('')));
  return z.object({ audio: z.record(recordFor(audioKeys)).default({}), video: z.record(recordFor(videoKeys)).default({}) });
}

export function normalizeManifest(manifest, formatKeys = {}, allBuckets = ALL_BUCKETS) {
  const next = manifest && typeof manifest === 'object' ? manifest : {};
  if (!next.audio || typeof next.audio !== 'object') next.audio = {};
  if (!next.video || typeof next.video !== 'object') next.video = {};
  const audioKeys = Array.isArray(formatKeys.audio) ? formatKeys.audio : [];
  const videoKeys = Array.isArray(formatKeys.video) ? formatKeys.video : [];

  allBuckets.forEach((bucket) => {
    if (!next.audio[bucket] || typeof next.audio[bucket] !== 'object') next.audio[bucket] = {};
    if (!next.video[bucket] || typeof next.video[bucket] !== 'object') next.video[bucket] = {};
    audioKeys.forEach((key) => {
      if (typeof next.audio[bucket][key] !== 'string') next.audio[bucket][key] = '';
    });
    videoKeys.forEach((key) => {
      if (typeof next.video[bucket][key] !== 'string') next.video[bucket][key] = '';
    });
  });

  return next;
}

export function slugify(input) {
  return String(input).toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function formatZodError(error, where) {
  return `${where}: ${error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`;
}
