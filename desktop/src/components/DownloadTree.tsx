import { useState } from "react";
import { FileAudio, FileVideo, FileText, File as FileIcon, ChevronDown, ChevronRight } from "lucide-react";
import { fileTreeByBucket, type TreeFile } from "../entryHelpers";

const BUCKETS = ["A", "B", "C", "D", "E", "X"] as const;

type BucketFile = { id?: string; name?: string; size?: number };
type BucketCfg = { folderId?: string; fileCount?: number; totalBytes?: number; files?: BucketFile[] };
type Status = "published" | "proposed";

function humanSize(bytes?: number): string {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function TypeIcon({ mediaType, ext }: { mediaType?: string; ext?: string }) {
  const t = String(mediaType || "").toLowerCase();
  const e = String(ext || "").toLowerCase();
  if (t === "audio" || /wav|aif|aiff|flac|m4a|ogg|mp3/.test(e)) return <FileAudio className="icon dl-type-audio" />;
  if (t === "video" || /mov|mp4|webm|mkv/.test(e)) return <FileVideo className="icon dl-type-video" />;
  if (e === "pdf") return <FileText className="icon dl-type-pdf" />;
  return <FileIcon className="icon" />;
}

type Row = { bucket: string; status: Status; files: TreeFile[]; folderFiles: BucketFile[]; folderId?: string; totalBytes?: number };

// A tree of the entry's download bundle: buckets → files. Published files come
// from downloads.fileTree (recording-index import); proposed files come from a
// Drive-folder scan (bucketFolders) before publish.
export function DownloadTree({ downloads, lookupNumber }: { downloads: any; lookupNumber?: string }) {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const tree = fileTreeByBucket(downloads);
  const bucketFolders: Record<string, BucketCfg> =
    downloads?.bucketFolders && typeof downloads.bucketFolders === "object" ? downloads.bucketFolders : {};
  const selected = new Set(
    (Array.isArray(downloads?.selectedBuckets) ? downloads.selectedBuckets : []).map((b: string) => String(b).toUpperCase()),
  );

  const rows: Row[] = BUCKETS.map((bucket) => {
    const files = tree[bucket] || [];
    const cfg = bucketFolders[bucket];
    const folderFiles = Array.isArray(cfg?.files) ? cfg!.files! : [];
    const published = files.length > 0 || selected.has(bucket);
    const proposed = !published && (!!cfg?.folderId || folderFiles.length > 0);
    if (!published && !proposed) return null;
    return {
      bucket,
      status: published ? "published" : "proposed",
      files,
      folderFiles,
      folderId: cfg?.folderId,
      totalBytes: cfg?.totalBytes,
    };
  }).filter(Boolean) as Row[];

  const pubCount = rows.filter((r) => r.status === "published").length;
  const propCount = rows.filter((r) => r.status === "proposed").length;
  const visible = rows.filter((r) => filter === "all" || r.status === filter);

  if (!rows.length) {
    return <div className="muted">No buckets yet — publish via a recording index or scan a Drive folder into a bucket above.</div>;
  }

  return (
    <div className="dl-tree">
      <div className="dl-tree-legend">
        <button className={`dl-chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All {rows.length}</button>
        <button className={`dl-chip dl-chip-published ${filter === "published" ? "on" : ""}`} onClick={() => setFilter("published")}>● Published {pubCount}</button>
        <button className={`dl-chip dl-chip-proposed ${filter === "proposed" ? "on" : ""}`} onClick={() => setFilter("proposed")}>◌ Proposed {propCount}</button>
      </div>

      <div className="dl-root">
        <span className="dl-root-label ws-mono">{lookupNumber || "download bundle"}</span>
        <span className="muted">{rows.length} bucket{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div className="dl-tree-body">
        {visible.map((row) => {
          const count = row.files.length || row.folderFiles.length;
          const isOpen = open[row.bucket] ?? row.status === "published";
          return (
            <div className={`dl-bucket dl-${row.status}`} key={row.bucket}>
              <button className="dl-bucket-head" onClick={() => setOpen((p) => ({ ...p, [row.bucket]: !isOpen }))}>
                {count ? (isOpen ? <ChevronDown className="icon-xs" /> : <ChevronRight className="icon-xs" />) : <span className="icon-xs" />}
                <span className="dl-bucket-letter">{row.bucket}</span>
                <span className={`dl-status dl-status-${row.status}`}>{row.status}</span>
                <span className="grow" />
                <span className="muted dl-bucket-meta">
                  {count ? `${count} file${count === 1 ? "" : "s"}` : "no files"}
                  {row.totalBytes ? ` · ${humanSize(row.totalBytes)}` : ""}
                </span>
              </button>

              {isOpen && row.files.length ? (
                <ul className="dl-files">
                  {row.files.map((file, index) => (
                    <li className="dl-file" key={file.id || index}>
                      <TypeIcon mediaType={file.mediaType} ext={file.ext} />
                      <span className="dl-file-name" title={file.name}>{file.name}</span>
                      <span className="grow" />
                      <span className="dl-file-meta">{file.ext || file.mediaType}</span>
                    </li>
                  ))}
                </ul>
              ) : isOpen && row.folderFiles.length ? (
                <ul className="dl-files">
                  {row.folderFiles.map((file, index) => (
                    <li className="dl-file" key={file.id || index}>
                      <TypeIcon ext={(file.name || "").split(".").pop()} />
                      <span className="dl-file-name" title={file.name}>{file.name || "(unnamed)"}</span>
                      <span className="grow" />
                      <span className="dl-file-meta">{humanSize(file.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : isOpen ? (
                <div className="dl-files-note muted">
                  {row.folderId ? `Drive folder linked — scan bucket ${row.bucket} to list files.` : "Published via recording index."}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
