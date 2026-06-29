// Domain types for the ops dashboard. Kept intentionally loose — the bridge
// returns whatever the site-repo modules produce; these describe the fields the
// UI actually reads.

export type Env = "test" | "prod";

export type HeroLinkCta = {
  kind: "link";
  label: string;
  href: string;
};

export type HeroAuthCta = {
  kind: "auth-switch";
  guestLabel: string;
  authenticatedLabel: string;
  authenticatedHref: string;
};

type HeroModuleBase = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export type HeroCampaignModule = HeroModuleBase & {
  type: "campaign";
  headlineLines: string[];
  rotatingWords: string[];
  body: string;
  primaryCta: HeroLinkCta;
  secondaryCta: HeroLinkCta | HeroAuthCta;
};

export type HeroFeaturedModule = HeroModuleBase & {
  type: "featured";
  title: string;
  source: "home-featured";
};

export type HeroPromoModule = HeroModuleBase & {
  type: "promo";
  eyebrow: string;
  headline: string;
  body: string;
  values: Array<{ title: string; text: string }>;
  stats: Array<{ value: string; label: string }>;
  sponsor: { label: string; name: string; image: string } | null;
  ctas: HeroLinkCta[];
};

export type HeroModule = HeroCampaignModule | HeroFeaturedModule | HeroPromoModule;

export type HeroComposition = {
  id: string;
  name: string;
  layout: "single" | "split";
  slots: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export type HeroLibrary = {
  version: "home-hero-library-v1";
  activeCompositionId: string;
  updatedAt: string;
  modules: HeroModule[];
  compositions: HeroComposition[];
};

export type HeroWorkspace = {
  filePath: string;
  library: HeroLibrary;
  snapshot: {
    sourceHash?: string;
    activeCompositionId?: string;
  } | null;
  sourceHash: string;
  prepared: boolean;
  status: "prepared" | "needs-preparation";
};

export const BUCKETS = ["A", "B", "C", "D", "E", "X"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type EntryListItem = {
  kind?: "catalog" | "uav";
  slug: string;
  title: string;
  lookupNumber: string;
  buckets: string[];
  updatedAt: string;
  artist?: string;
  season?: string;
  imageSrc?: string;
  inCatalog?: boolean;
  publishedAt?: string;
  site?: string;
  subject?: string;
  tour?: string;
  year?: number;
  status?: string;
  error?: boolean;
};

export type EntryFolder = {
  slug: string;
  folder: string;
  entry: any;
  descriptionText: string;
  manifest: any;
  indexHtml: string;
};

export type UavAuthorityRef = {
  source: "lcnaf" | "lcsh" | "geonames" | "local";
  uri: string;
  label: string;
};

export type UavAuthorities = {
  version: "uav-authorities-v1";
  updatedAt: string;
  subjects: Array<{
    id: string;
    code: string;
    label: string;
    authority: UavAuthorityRef;
    additionalAuthorities: UavAuthorityRef[];
  }>;
  sites: Array<{
    id: string;
    name: string;
    cutter: string;
    admin: string;
    authority: UavAuthorityRef;
    coordinateVisibility: "exact" | "rounded" | "hidden";
    publicCoordinates?: { lat: number; lon: number; precision: number };
  }>;
};

export type UavFile = {
  driveFileId: string;
  bucketNumber: string;
  lookupRaw: string;
  originalName: string;
  relativePath: string;
  mime: string;
  sizeBytes: number;
  modifiedAt?: string;
  capturedAt?: string;
  missing: boolean;
  role: "media" | "raw" | "recording_index_pdf" | "support";
  outputSpectrum?: "FS" | "RGB" | "IR" | "TH";
  qualifiers: string[];
  sourceXItems: string[];
  technical: Record<string, unknown>;
};

export type UavCollectionFolder = {
  slug: string;
  folder: string;
  paths: Record<string, string>;
  collection: any;
  manifest: any;
  descriptionText: string;
  authorities: UavAuthorities;
};

export type OpsKind = "submission" | "press" | "board" | "support";

export type OpsTicket = {
  ticket_id?: string;
  ticketId?: string;
  kind?: string;
  title?: string;
  status?: string;
  email?: string;
  contact_name?: string;
  contactName?: string;
  priority?: string;
  assignee?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type PollDef = {
  id?: string;
  pollId?: string;
  slug?: string;
  question?: string;
  status?: string;
  visibility?: string;
  options?: Array<{ label?: string } | string>;
  close_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ProfileClaim = {
  claim_id?: string;
  claimId?: string;
  auth0_sub?: string;
  entry_lookup?: string;
  entry_slug?: string;
  entry_href?: string;
  entry_title?: string;
  role?: string;
  status?: string;
  created_at?: string | number;
  updated_at?: string | number;
  // Claimant metadata (joined from user_profiles by the admin API).
  name?: string;
  credit_name?: string;
  social_name?: string;
  avatar_url?: string;
  handle?: string;
  profile_url?: string;
  dex_id?: string;
  profile_public?: boolean;
  pronouns?: string;
  location?: string;
  [key: string]: unknown;
};

export type AssetKind = "image" | "svg" | "font" | "media" | "js" | "css" | "pdf" | "data" | "other";

export type AssetRow = {
  webPath: string;
  relPath: string;
  ext: string;
  kind: AssetKind;
  sizeBytes: number;
  mtime: string;
  mirrors: string[];
  refCount: number;
  refSample: string;
};

export type AssetInventory = {
  assets: AssetRow[];
  scannedAt: string;
  totalFiles: number;
};

export type Entitlement = { type: string; value: string };

export type ProtectedLookup = {
  lookupNumber: string;
  title: string;
  status: string;
  season: string;
  fileCount: number;
  totalBytes: number;
  entitlements: Entitlement[];
  hasRecordingIndex: boolean;
};

export type ProtectedFile = {
  bucketNumber?: string;
  fileId?: string;
  bucket?: string;
  r2Key?: string;
  driveFileId?: string;
  sizeBytes?: number;
  mime?: string;
  label?: string;
  type?: string;
  role?: string;
  [key: string]: unknown;
};

export function humanBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function ticketId(t: OpsTicket): string {
  return String(t.ticket_id || t.ticketId || "");
}

export function pollId(p: PollDef): string {
  return String(p.id || p.pollId || p.slug || "");
}

export function claimId(c: ProfileClaim): string {
  return String(c.claim_id || c.claimId || "");
}
