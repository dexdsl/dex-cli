import { useState } from "react";

const BUCKETS = ["A", "B", "C", "D", "E", "X"] as const;

type BucketFile = { id?: string; name?: string; size?: number; mimeType?: string };
type BucketCfg = { folderId?: string; fileCount?: number; totalBytes?: number; scannedAt?: string; files?: BucketFile[] };
type Status = "published" | "proposed";

function humanSize(bytes?: number): string {
  const n = Number(bytes) || 0;
  if (n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function fileType(name?: string): string {
  const n = String(name || "").toLowerCase();
  if (/\.(wav|aif|aiff|flac|m4a|ogg|mp3)$/.test(n)) return "audio";
  if (/\.zip$/.test(n)) return "bundle";
  if (/\.pdf$/.test(n)) return "pdf";
  if (/\.(jpe?g|png|webp|gif)$/.test(n)) return "image";
  return "file";
}

// A stateful tree of the entry's download bundle: buckets → files, with a clear
// published (live/downloadable) vs proposed (configured but not yet published)
// distinction via color + shading + a filter.
export function DownloadTree({ downloads, lookupNumber }: { downloads: any; lookupNumber?: string }) {
  const [filter, setFilter] = useState<"all" | Status>("all");

  const bucketFolders: Record<string, BucketCfg> =
    downloads?.bucketFolders && typeof downloads.bucketFolders === "object" ? downloads.bucketFolders : {};
  const selected = new Set(
    (Array.isArray(downloads?.selectedBuckets) ? downloads.selectedBuckets : []).map((b: string) => String(b).toUpperCase()),
  );

  const rows = BUCKETS.map((bucket) => {
    const cfg = bucketFolders[bucket];
    const isPublished = selected.has(bucket);
    const hasFolder = Boolean(cfg?.folderId);
    if (!isPublished && !hasFolder) return null;
    return {
      bucket,
      status: (isPublished ? "published" : "proposed") as Status,
      cfg,
      files: Array.isArray(cfg?.files) ? cfg!.files! : [],
    };
  }).filter(Boolean) as Array<{ bucket: string; status: Status; cfg?: BucketCfg; files: BucketFile[] }>;

  const pubCount = rows.filter((r) => r.status === "published").length;
  const propCount = rows.filter((r) => r.status === "proposed").length;
  const visible = rows.filter((r) => filter === "all" || r.status === filter);

  if (!rows.length) {
    return <div className="muted">No buckets configured yet — add a Drive folder to a bucket above to build the bundle.</div>;
  }

  return (
    <div className="dl-tree">
      <div className="dl-tree-legend">
        <button className={`dl-chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All</button>
        <button className={`dl-chip dl-chip-published ${filter === "published" ? "on" : ""}`} onClick={() => setFilter("published")}>
          ● Published {pubCount}
        </button>
        <button className={`dl-chip dl-chip-proposed ${filter === "proposed" ? "on" : ""}`} onClick={() => setFilter("proposed")}>
          ◌ Proposed {propCount}
        </button>
      </div>

      <div className="dl-root">
        <span className="dl-root-icon">▾</span>
        <span className="dl-root-label">{lookupNumber || "download bundle"}</span>
        <span className="muted">{rows.length} bucket{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div className="dl-tree-body">
        {visible.map((row) => (
          <div className={`dl-bucket dl-${row.status}`} key={row.bucket}>
            <div className="dl-bucket-head">
              <span className="dl-bucket-mark" aria-hidden="true" />
              <span className="dl-bucket-letter">{row.bucket}</span>
              <span className={`dl-status dl-status-${row.status}`}>{row.status}</span>
              <span className="grow" />
              <span className="muted dl-bucket-meta">
                {(row.files.length || row.cfg?.fileCount || 0)} files · {humanSize(row.cfg?.totalBytes)}
              </span>
            </div>

            {row.files.length ? (
              <ul className="dl-files">
                {row.files.map((file, index) => (
                  <li className="dl-file" key={`${file.id || index}`}>
                    <span className={`dl-type dl-type-${fileType(file.name)}`}>{fileType(file.name)}</span>
                    <span className="dl-file-name" title={file.name}>{file.name || "(unnamed)"}</span>
                    <span className="grow" />
                    <span className="dl-file-meta">{humanSize(file.size)}</span>
                    {file.id ? <span className="dl-file-id" title={`Drive id: ${file.id}`}>{file.id.slice(0, 8)}…</span> : null}
                  </li>
                ))}
              </ul>
            ) : row.cfg?.folderId ? (
              <div className="dl-files-note muted">Folder configured but not scanned — open bucket {row.bucket} and Scan to list files.</div>
            ) : (
              <div className="dl-files-note muted">Published via recording index (no scanned Drive files).</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
