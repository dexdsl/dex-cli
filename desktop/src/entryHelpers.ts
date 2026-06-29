import type { EntryListItem } from "./domain";

export const PUBLIC_SITE_BASE = "https://dexdsl.github.io";

/** Resolve an entry image_src to a loadable URL. Many entries store an absolute
 * CDN URL (squarespace, etc.); repo-relative paths get the public base. */
export function resolveImageUrl(src?: string): string {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
  return `${PUBLIC_SITE_BASE}${s.startsWith("/") ? "" : "/"}${s}`;
}

export function isAbsoluteUrl(src?: string): boolean {
  return /^https?:\/\//i.test(String(src || "").trim());
}

/** Flatten downloads.fileTree.buckets into per-bucket file lists (the real
 * published file data; bucketFolders is the separate Drive-scan/proposal path). */
export type TreeFile = { id: string; name: string; mediaType: string; ext: string };
export function fileTreeByBucket(downloads: any): Record<string, TreeFile[]> {
  const out: Record<string, TreeFile[]> = {};
  const buckets = Array.isArray(downloads?.fileTree?.buckets) ? downloads.fileTree.buckets : [];
  for (const b of buckets) {
    const bucket = String(b?.bucket || "").toUpperCase();
    if (!bucket) continue;
    const files: TreeFile[] = [];
    for (const t of Array.isArray(b?.types) ? b.types : []) {
      const mediaType = String(t?.mediaType || "file");
      for (const f of Array.isArray(t?.files) ? t.files : []) {
        files.push({
          id: String(f?.fileId || ""),
          name: String(f?.label || f?.filename || f?.fileId || "(unnamed)"),
          mediaType,
          ext: String(f?.extension || "").toLowerCase(),
        });
      }
    }
    out[bucket] = files;
  }
  return out;
}

/* ------------------------------------------------------------ status --- */
export type EntryStatus = "published" | "draft" | "error";

export function entryStatus(item: EntryListItem): EntryStatus {
  if (item.error) return "error";
  return item.inCatalog ? "published" : "draft";
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  published: "Published",
  draft: "Draft",
  error: "Error",
};

export function relativeTime(value?: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/* -------------------------------------------------------- validation --- */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_REGEX.test(String(value || "").trim());
}

export function isValidUrl(value: string): boolean {
  const raw = String(value || "").trim();
  if (!raw) return true; // empty is allowed; required-ness is checked separately
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidYear(value: unknown): boolean {
  const n = Number(value);
  if (!value && value !== 0) return true;
  return Number.isInteger(n) && n >= 1900 && n <= new Date().getFullYear() + 1;
}

/* ------------------------------------------------------ ref parsing --- */
// The downloads refs use a tiny DSL: asset:<id>, lookup:<num>, bundle:<...>.
// Surface what each one points at so the operator isn't reading raw strings.
export function describeRef(ref: string): { kind: string; detail: string; ok: boolean } | null {
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx < 0) return { kind: "raw", detail: raw, ok: false };
  const kind = raw.slice(0, idx);
  const rest = raw.slice(idx + 1);
  switch (kind) {
    case "asset":
      return { kind: "asset", detail: `repo asset “${rest}”`, ok: !!rest };
    case "lookup":
      return { kind: "lookup", detail: `protected lookup ${rest}`, ok: !!rest };
    case "bundle": {
      const parts = rest.split(":");
      return { kind: "bundle", detail: `bundle of ${parts[0] || "?"} · ${parts.slice(1).join(":") || "all"}`, ok: parts.length >= 2 };
    }
    default:
      return { kind, detail: rest, ok: false };
  }
}

/* ------------------------------------------------------- readiness --- */
export type ReadyItem = { id: string; label: string; ok: boolean; hint?: string };

/** Local, instant completeness checks derived from the entry object — distinct
 * from server preflight (catalog/protected/build), which runs on demand. */
export function readinessChecks(entry: any, descriptionText: string, imageSrc: string): ReadyItem[] {
  const sb = entry?.sidebarPageConfig || {};
  const credits = sb.credits || {};
  const downloads = sb.downloads || {};
  const bucketFolders = downloads.bucketFolders && typeof downloads.bucketFolders === "object" ? downloads.bucketFolders : {};
  const tree = fileTreeByBucket(downloads);
  const treeBuckets = Object.values(tree).filter((files) => files.length > 0).length;
  const folderBuckets = Object.values(bucketFolders).filter((b: any) => b?.folderId).length;
  const configuredBuckets = Math.max(treeBuckets, folderBuckets);
  const artist = Array.isArray(credits.artist) ? credits.artist.filter(Boolean) : (credits.artist ? [credits.artist] : []);
  const videoUrl = String(entry?.video?.dataUrl || "");

  return [
    { id: "title", label: "Title", ok: !!String(entry?.title || "").trim() },
    { id: "lookup", label: "Lookup number", ok: !!String(sb.lookupNumber || "").trim() },
    { id: "artist", label: "Artist credit", ok: artist.length > 0 },
    { id: "description", label: "Description", ok: String(descriptionText || "").trim().length >= 10, hint: "at least a sentence" },
    { id: "artwork", label: "Catalog artwork", ok: !!String(imageSrc || "").trim() },
    { id: "buckets", label: "At least one bucket configured", ok: configuredBuckets > 0, hint: `${configuredBuckets} configured` },
    { id: "video", label: "Video URL valid", ok: !videoUrl || isValidUrl(videoUrl) },
  ];
}
