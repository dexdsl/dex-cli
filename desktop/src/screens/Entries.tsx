import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, ImageOff, Plane, Plus, ShieldCheck, X } from "lucide-react";
import { rpc, payloadOf, pickImageFile } from "../api";
import { useStore } from "../store";
import { useGuardSource } from "../guard";
import { DexLoader } from "../components/DexLoader";
import { DownloadTree } from "../components/DownloadTree";
import { SidebarPreview } from "../components/SidebarPreview";
import { TokenInput } from "../components/TokenInput";
import { ChipSelect } from "../components/ChipSelect";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";
import { LinkedCreditInput, type CreditLinksByPerson } from "../components/LinkedCreditInput";
import { NewUavForm, UavEditor } from "./UavEntry";

// Predefined series; the entry's current value is merged in if it's not here.
const SERIES_OPTIONS = ["dex", "inDex", "dexDRONES", "dexFest 2024"];
// Series → badge asset (the "special event image"). Picking a series sets it.
const SERIES_BADGES: Record<string, string> = {
  dex: "/assets/series/dex.png",
  inDex: "/assets/series/index.png",
  dexDRONES: "/assets/series/dexdrones.png",
  "dexFest 2024": "/assets/series/dexfest.png",
};
import {
  STATUS_LABEL,
  describeRef,
  entryStatus,
  fileTreeByBucket,
  isAbsoluteUrl,
  isValidUrl,
  isValidYear,
  readinessChecks,
  relativeTime,
  resolveImageUrl,
} from "../entryHelpers";
import { BUCKETS, type Bucket, type EntryFolder, type EntryListItem } from "../domain";

type PreflightResult = { ok: boolean; checks?: Array<{ id: string; ok: boolean; detail: string }> };

// Entry list thumbnail. Absolute CDN URLs load directly; repo-relative paths
// (editorial artwork set from this app) may not be published yet, so resolve
// them to a data URL via entry.imageData — the same way the detail sheet does.
function EntryCardThumb({ imageSrc }: { imageSrc?: string }) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    const src = String(imageSrc || "").trim();
    if (!src) { setThumb(""); return; }
    if (isAbsoluteUrl(src) || src.startsWith("data:")) { setThumb(src); return; }
    let alive = true;
    rpc<{ dataUrl?: string }>("entry.imageData", { webPath: src })
      .then((r) => { if (alive) setThumb(r?.dataUrl || resolveImageUrl(src)); })
      .catch(() => { if (alive) setThumb(resolveImageUrl(src)); });
    return () => { alive = false; };
  }, [imageSrc]);
  return (
    <div className="entry-card-thumb">
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <span className="entry-card-thumb-empty"><ImageOff className="icon" /></span>
      )}
    </div>
  );
}

// Capitalize each word of a name ("ethan bailey-gould" -> "Ethan Bailey-Gould").
function titleCaseName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/[A-Za-zÀ-ÿ]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function capitalizeArtists(entry: any): any {
  const artist = entry?.sidebarPageConfig?.credits?.artist;
  if (Array.isArray(artist)) {
    entry.sidebarPageConfig.credits.artist = artist.map((value: unknown) => titleCaseName(String(value ?? "")));
  }
  return entry;
}

// Ensure the nested manifest shape exists so the editor never mutates `entry`
// during render (which would falsely flag it dirty / "Unsaved"), and normalize
// artist credit casing.
function normalizeEntry(raw: any): any {
  const next = structuredClone(raw ?? {});
  const sb = next.sidebarPageConfig && typeof next.sidebarPageConfig === "object" ? next.sidebarPageConfig : (next.sidebarPageConfig = {});
  if (!sb.downloads || typeof sb.downloads !== "object") sb.downloads = {};
  if (!sb.fileSpecs || typeof sb.fileSpecs !== "object") sb.fileSpecs = {};
  if (!sb.fileSpecs.staticSizes || typeof sb.fileSpecs.staticSizes !== "object") sb.fileSpecs.staticSizes = {};
  if (!sb.metadata || typeof sb.metadata !== "object") sb.metadata = {};
  const c = sb.credits && typeof sb.credits === "object" ? sb.credits : (sb.credits = {});
  if (!c.video || typeof c.video !== "object") c.video = {};
  if (!c.audio || typeof c.audio !== "object") c.audio = {};
  c.instrumentLinksEnabled = true;
  if (!c.linksByPerson || typeof c.linksByPerson !== "object") c.linksByPerson = {};
  capitalizeArtists(next);
  return next;
}

export function EntriesScreen() {
  const { notify } = useStore();
  const [items, setItems] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [openEntry, setOpenEntry] = useState<{ slug: string; kind: "catalog" | "uav" } | null>(null);
  const [createMode, setCreateMode] = useState<null | "choose" | "catalog" | "uav">(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"updated" | "title" | "slug">("updated");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogResult, uavResult] = await Promise.all([
        rpc<{ entries: EntryListItem[] }>("entry.list"),
        rpc<{ entries: EntryListItem[] }>("uav.list"),
      ]);
      const uavRows = (uavResult.entries || []).map((row) => ({ ...row, kind: "uav" as const }));
      const uavSlugs = new Set(uavRows.map((row) => row.slug));
      setItems([
        ...(catalogResult.entries || [])
          .filter((row) => !uavSlugs.has(row.slug))
          .map((row) => ({ ...row, kind: "catalog" as const })),
        ...uavRows,
      ]);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = !q ? items : items.filter(
      (item) =>
        item.slug.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.lookupNumber.toLowerCase().includes(q) ||
        String(item.artist || "").toLowerCase().includes(q) ||
        String(item.site || "").toLowerCase().includes(q) ||
        String(item.subject || "").toLowerCase().includes(q) ||
        String(item.tour || "").toLowerCase().includes(q),
    );
    const sorted = [...matched];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "slug") sorted.sort((a, b) => a.slug.localeCompare(b.slug));
    else sorted.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return sorted;
  }, [items, filter, sort]);

  if (createMode === "catalog") {
    return <NewEntryForm onBack={() => { setCreateMode(null); load(); }} onOpen={(slug) => { setCreateMode(null); load(); setOpenEntry({ slug, kind: "catalog" }); }} />;
  }

  if (createMode === "uav") {
    return <NewUavForm onBack={() => { setCreateMode(null); load(); }} onOpen={(slug) => { setCreateMode(null); load(); setOpenEntry({ slug, kind: "uav" }); }} />;
  }

  if (openEntry?.kind === "uav") {
    return <UavEditor slug={openEntry.slug} onBack={() => { setOpenEntry(null); load(); }} />;
  }

  if (openEntry) {
    return <EntryEditor slug={openEntry.slug} onBack={() => { setOpenEntry(null); load(); }} />;
  }

  return (
    <div className="stack">
      <div className="inline">
        <input
          className="board-search"
          placeholder="Filter by title, slug, lookup, artist…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} title="Sort">
          <option value="updated">Recently updated</option>
          <option value="title">Title A–Z</option>
          <option value="slug">Slug A–Z</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setCreateMode("choose")}><Plus className="icon" /> New entry</button>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        {loading && <div className="spinner" />}
      </div>
      <div className="muted">{filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</div>
      <div className="entry-grid">
        {filtered.map((item) => {
          const status = entryStatus(item);
          return (
            <button className={`entry-card status-${status} ${item.kind === "uav" ? "entry-card-uav" : ""}`} key={`${item.kind}:${item.slug}`} onClick={() => setOpenEntry({ slug: item.slug, kind: item.kind || "catalog" })}>
              <EntryCardThumb imageSrc={item.imageSrc} />
              <div className="entry-card-body">
                <div className="entry-card-top">
                  <span className="entry-card-title">{item.title}</span>
                  {item.kind === "uav" ? <span className="entry-kind">dexDRONES</span> : null}
                  <span className={`entry-status entry-status-${status}`}>{STATUS_LABEL[status]}</span>
                </div>
                <div className="entry-card-sub">{item.kind === "uav" ? `${item.site || "Unresolved site"} · ${item.subject || "subject"} · ${item.tour || "tour"}` : item.artist || item.slug}</div>
                <div className="entry-card-foot">
                  {item.lookupNumber ? <span className="entry-card-lookup ws-mono">{item.lookupNumber}</span> : <span className="muted">no lookup</span>}
                  <span className="grow" />
                  {item.buckets.map((b) => <span className="entry-bucket-pip" key={b}>{b}</span>)}
                </div>
                {item.updatedAt ? <div className="entry-card-time">{relativeTime(item.updatedAt)}</div> : null}
              </div>
            </button>
          );
        })}
        {!filtered.length && !loading ? <div className="muted" style={{ padding: 16 }}>No entries match.</div> : null}
      </div>
      <EntryKindModal
        open={createMode === "choose"}
        onClose={() => setCreateMode(null)}
        onChoose={(kind) => setCreateMode(kind)}
      />
    </div>
  );
}

function EntryKindModal({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (kind: "catalog" | "uav") => void;
}) {
  const catalogRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prior = document.activeElement as HTMLElement | null;
    catalogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const dialog = catalogRef.current?.closest('[role="dialog"]');
        const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") || []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prior?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="dx-modal-overlay" onClick={onClose}>
      <div className="dx-modal dx-modal-wide entry-kind-modal" role="dialog" aria-modal="true" aria-labelledby="entry-kind-title" onClick={(event) => event.stopPropagation()}>
        <div className="dx-modal-head">
          <div>
            <p className="uav-eyebrow">Choose a typed workflow</p>
            <h3 className="dx-modal-title" id="entry-kind-title">New entry</h3>
          </div>
          <button className="btn btn-ghost btn-sm entry-kind-close" onClick={onClose} aria-label="Close new-entry dialog"><X className="icon" /></button>
        </div>
        <div className="dx-modal-body entry-kind-grid">
          <button ref={catalogRef} className="entry-kind-tile" onClick={() => onChoose("catalog")}>
            <span className="entry-kind-icon"><BookOpen /></span>
            <strong>Dex catalog</strong>
            <span>dex, dexFest, or inDex</span>
            <p>The existing artist, instrument, season, sample metadata, and A–E/X download workflow.</p>
            <em>Open catalog form →</em>
          </button>
          <button className="entry-kind-tile entry-kind-tile-uav" onClick={() => onChoose("uav")}>
            <span className="entry-kind-icon"><Plane /></span>
            <strong>dexDRONES</strong>
            <span>UAV location collection</span>
            <p>Site and LCSH authorities, V/I/A/D capture series, matching deliverables, X raw/support files, and MARCXML.</p>
            <em>Open UAV form →</em>
          </button>
        </div>
      </div>
    </div>
  );
}

function EntryEditor({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { notify, env } = useStore();
  const [folder, setFolder] = useState<EntryFolder | null>(null);
  const [description, setDescription] = useState("");
  const [entry, setEntry] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [diff, setDiff] = useState<string>("");
  // Baseline snapshot of the last loaded/saved state, for dirty + revert.
  const [baseline, setBaseline] = useState<{ entry: string; description: string } | null>(null);
  // Bucket folder configurator.
  const [activeBucket, setActiveBucket] = useState<Bucket | null>(null);
  const [bucketFolderInput, setBucketFolderInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ count: number; totalBytes: number; humanSize?: string; folderId: string; files?: Array<{ name: string; size: number }> } | null>(null);
  // Catalog artwork (image_src) — managed in the repo, populated when present.
  const [imageSrc, setImageSrc] = useState("");
  const [thumb, setThumb] = useState("");
  const [settingImage, setSettingImage] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [tab, setTab] = useState<"overview" | "downloads" | "credits" | "metadata">("overview");
  const [seasons, setSeasons] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    rpc<{ seasons?: Array<{ id: string; label: string }> }>("catalog.seasons")
      .then((r) => setSeasons(r?.seasons || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    rpc<EntryFolder>("entry.read", { slug })
      .then((data) => {
        const normalized = normalizeEntry(data.entry);
        setFolder(data);
        setEntry(normalized);
        setDescription(data.descriptionText || "");
        setBaseline({ entry: JSON.stringify(normalized), description: data.descriptionText || "" });
      })
      .catch((error) => notify("err", String(error)));
    rpc<{ image_src?: string }>("entry.image.get", { token: slug })
      .then((r) => setImageSrc(r?.image_src || ""))
      .catch(() => {});
  }, [slug, notify]);

  // Preview the artwork: absolute CDN URLs load directly; repo-relative paths
  // are read locally as a data URL so they preview even before publish.
  useEffect(() => {
    if (!imageSrc) { setThumb(""); return; }
    if (isAbsoluteUrl(imageSrc)) { setThumb(imageSrc); return; }
    let alive = true;
    rpc<{ dataUrl?: string }>("entry.imageData", { webPath: imageSrc })
      .then((r) => { if (alive) setThumb(r?.dataUrl || resolveImageUrl(imageSrc)); })
      .catch(() => { if (alive) setThumb(resolveImageUrl(imageSrc)); });
    return () => { alive = false; };
  }, [imageSrc]);

  async function runPreflight() {
    setRunning(true);
    try {
      const result = payloadOf<PreflightResult>(await rpc("entry.preflight", { slug, expectedLookup: sidebar?.lookupNumber || "" }));
      setPreflight(result);
      notify(result.ok ? "ok" : "err", result.ok ? "Preflight passed." : "Preflight found blockers.");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setRunning(false);
    }
  }

  async function chooseEntryImage() {
    const file = await pickImageFile();
    if (!file) return;
    setSettingImage(true);
    try {
      const r = await rpc<{ image_src?: string }>("entry.image.set", { token: slug, sourcePath: file });
      setImageSrc(r?.image_src || "");
      notify("ok", "Entry image saved to the repo and catalog rebuilt.");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSettingImage(false);
    }
  }

  const dirty = baseline !== null && entry !== null
    && (JSON.stringify(entry) !== baseline.entry || description !== baseline.description);

  // Persist (throws on failure so the nav guard keeps its prompt open).
  async function persist(): Promise<void> {
    const toWrite = capitalizeArtists(structuredClone(entry));
    const result = await rpc<{ diff: string; wroteFiles?: string[] }>("entry.write", {
      slug,
      entry: toWrite,
      descriptionText: description,
      manifest: folder!.manifest,
      dryRun: false,
    });
    setDiff(result.diff || "");
    setEntry(toWrite);
    setBaseline({ entry: JSON.stringify(toWrite), description });
  }

  function revert(): void {
    if (!baseline) return;
    try {
      setEntry(JSON.parse(baseline.entry));
    } catch {
      /* keep current if baseline can't parse */
    }
    setDescription(baseline.description);
  }

  // Register unsaved edits with the app-wide guard (tab / env / quit).
  useGuardSource(
    dirty
      ? {
          id: `entry:${slug}`,
          isDirty: () => true,
          title: "Unsaved entry changes",
          message: `"${slug}" has edits that haven't been saved.`,
          commitLabel: "Save",
          discardLabel: "Discard",
          commit: async () => {
            await persist();
          },
          discard: () => revert(),
        }
      : null,
    [dirty, slug, entry, description, baseline],
  );

  function requestBack() {
    if (!dirty) { onBack(); return; }
    setConfirmState({
      title: "Discard unsaved changes?",
      body: <p className="muted" style={{ margin: 0 }}>“{slug}” has edits that haven’t been saved. Leaving will lose them.</p>,
      confirmLabel: "Discard",
      danger: true,
      onConfirm: () => { revert(); onBack(); },
    });
  }

  if (!folder || !entry) {
    return <div className="empty"><div className="spinner" /></div>;
  }

  const sidebar = entry.sidebarPageConfig || {};
  const downloads = sidebar.downloads || {};
  // fileSpecs live under sidebar.fileSpecs for some entries and downloads.fileSpecs
  // for others; read both so existing values always surface.
  const fileSpecs = (sidebar.fileSpecs && Object.keys(sidebar.fileSpecs).length ? sidebar.fileSpecs : null)
    || downloads.fileSpecs || sidebar.fileSpecs || {};
  const ready = readinessChecks(entry, description, imageSrc);
  const readyCount = ready.filter((r) => r.ok).length;
  const canonical = entry.canonical && typeof entry.canonical === "object" ? entry.canonical : {};
  const videoUrl = String(entry.video?.dataUrl || "");
  const fileTree = fileTreeByBucket(downloads);
  const storedBuckets: string[] = Array.isArray(downloads.selectedBuckets)
    ? downloads.selectedBuckets
    : Array.isArray(sidebar.buckets)
      ? sidebar.buckets
      : [];
  // A bucket is "live" if it's stored as selected OR has published files in the
  // recording-index file tree (the case the old UI missed entirely).
  const selectedBuckets: string[] = BUCKETS.filter(
    (b) => storedBuckets.includes(b) || (fileTree[b]?.length ?? 0) > 0,
  );

  function update(mutator: (draft: any) => void) {
    setEntry((prev: any) => {
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
  }

  function toggleBucket(b: Bucket) {
    update((draft) => {
      const sb = draft.sidebarPageConfig;
      const dl = sb.downloads || (sb.downloads = {});
      const cur: string[] = Array.isArray(dl.selectedBuckets) ? dl.selectedBuckets : (Array.isArray(sb.buckets) ? sb.buckets : []);
      const set = new Set(cur);
      if (set.has(b)) set.delete(b);
      else set.add(b);
      const ordered = BUCKETS.filter((x) => set.has(x));
      dl.selectedBuckets = ordered;
      sb.buckets = ordered;
    });
  }

  const bucketFolders: Record<string, { folderId?: string; fileCount?: number; totalBytes?: number; scannedAt?: string }> =
    downloads.bucketFolders && typeof downloads.bucketFolders === "object" ? downloads.bucketFolders : {};

  function openBucket(b: Bucket) {
    setActiveBucket((prev) => (prev === b ? null : b));
    const folderId = bucketFolders[b]?.folderId;
    setBucketFolderInput(folderId ? `https://drive.google.com/drive/folders/${folderId}` : "");
    setScanResult(null);
  }

  async function scanBucket() {
    const b = activeBucket;
    const folderId = bucketFolderInput.trim();
    if (!b || !folderId) return;
    setScanning(true);
    try {
      const res = payloadOf<any>(await rpc("entry.bucketScan", { env, folderId }));
      update((d) => {
        const sb = d.sidebarPageConfig || (d.sidebarPageConfig = {});
        const dl = sb.downloads || (sb.downloads = {});
        const bf = dl.bucketFolders || (dl.bucketFolders = {});
        bf[b] = {
          folderId: res.folderId,
          fileCount: res.count,
          totalBytes: res.totalBytes,
          scannedAt: new Date().toISOString(),
          // File ids are what makes the bucket downloadable at Publish time.
          files: Array.isArray(res.files)
            ? res.files.map((f: any) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType }))
            : [],
        };
        const cur: string[] = Array.isArray(dl.selectedBuckets) ? dl.selectedBuckets : (Array.isArray(sb.buckets) ? sb.buckets : []);
        const set = new Set(cur);
        set.add(b);
        const ordered = BUCKETS.filter((x) => set.has(x));
        dl.selectedBuckets = ordered;
        sb.buckets = ordered;
        const fs = sb.fileSpecs || (sb.fileSpecs = {});
        const ss = fs.staticSizes || (fs.staticSizes = {});
        ss[b] = res.humanSize || "";
      });
      setScanResult(res);
      notify("ok", `Bucket ${b}: ${res.count} file${res.count === 1 ? "" : "s"}${res.humanSize ? ` (${res.humanSize})` : ""}.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setScanning(false);
    }
  }

  function clearBucketFolder(b: Bucket) {
    update((d) => {
      const dl = d.sidebarPageConfig?.downloads;
      if (!dl) return;
      if (dl.bucketFolders) delete dl.bucketFolders[b];
      const cur: string[] = Array.isArray(dl.selectedBuckets) ? dl.selectedBuckets : [];
      const ordered = BUCKETS.filter((x) => cur.includes(x) && x !== b);
      dl.selectedBuckets = ordered;
      if (d.sidebarPageConfig) d.sidebarPageConfig.buckets = ordered;
      if (d.sidebarPageConfig?.fileSpecs?.staticSizes) d.sidebarPageConfig.fileSpecs.staticSizes[b] = "";
    });
    if (activeBucket === b) {
      setBucketFolderInput("");
      setScanResult(null);
    }
  }

  async function save(dryRun: boolean) {
    setSaving(true);
    try {
      if (dryRun) {
        const result = await rpc<{ diff: string }>("entry.write", {
          slug,
          entry,
          descriptionText: description,
          manifest: folder!.manifest,
          dryRun: true,
        });
        setDiff(result.diff || "");
        notify("ok", `Dry run OK — ${result.diff}`);
      } else {
        await persist();
        notify("ok", `Saved ${slug}`);
      }
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSaving(false);
    }
  }

  async function doPublish() {
    setSaving(true);
    try {
      const result = await rpc<{ lines: string[]; htmlPath: string }>("entry.publish", {
        slug,
        entry,
        descriptionText: description,
        manifest: folder!.manifest,
        dryRun: false,
      });
      setDiff((result.lines || []).join("\n"));
      notify("ok", `Published ${slug}.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSaving(false);
    }
  }

  function publish() {
    const preflightOk = preflight?.ok === true;
    setConfirmState({
      title: `Publish ${slug}?`,
      body: (
        <>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Rewrites the entry and syncs catalog linkage + protected-asset mappings.
          </p>
          {!preflightOk ? (
            <p className="ws-line is-blocked" style={{ margin: 0 }}>
              <AlertTriangle className="icon" /> Preflight {preflight ? "has unresolved blockers" : "hasn’t been run"} — publish anyway?
            </p>
          ) : (
            <p className="ws-line is-ready" style={{ margin: 0 }}><CheckCircle2 className="icon" /> Preflight passed.</p>
          )}
        </>
      ),
      confirmLabel: "Publish",
      danger: !preflightOk,
      onConfirm: doPublish,
    });
  }

  const credits = sidebar.credits || {};
  const video = credits.video || {};
  const audio = credits.audio || {};
  const metadata = (sidebar.metadata && Object.keys(sidebar.metadata).length ? sidebar.metadata : null) || entry.metadata || {};
  const staticSizes = fileSpecs.staticSizes || {};
  const linksByPerson: Record<string, Array<{ label?: string; href?: string }>> =
    credits.linksByPerson && typeof credits.linksByPerson === "object" ? credits.linksByPerson : {};

  function setCredit(key: string, value: unknown) {
    update((d) => {
      const c = d.sidebarPageConfig.credits || (d.sidebarPageConfig.credits = {});
      c[key] = value;
    });
  }
  function setCreditLinks(next: CreditLinksByPerson) {
    update((d) => {
      const c = d.sidebarPageConfig.credits || (d.sidebarPageConfig.credits = {});
      c.linksByPerson = next;
      // Linking is now intrinsic to credit chips. Keep the legacy runtime flag
      // enabled so existing entry-sidebar hydration renders those links.
      c.instrumentLinksEnabled = true;
    });
  }
  // Season drives the catalog grouping; mirror it to creditsData so every
  // downstream read (page config + creditsData) stays consistent on publish.
  function setSeason(value: string) {
    update((d) => {
      const c = d.sidebarPageConfig.credits || (d.sidebarPageConfig.credits = {});
      c.season = value;
      if (d.creditsData && typeof d.creditsData === "object") d.creditsData.season = value;
    });
  }
  function setSeries(value: string) {
    update((d) => {
      d.series = value;
      const sb = d.sidebarPageConfig && typeof d.sidebarPageConfig === "object" ? d.sidebarPageConfig : (d.sidebarPageConfig = {});
      sb.series = value;
      // Known series carry a badge ("special event image"); follow the choice.
      // Unknown/custom series leave any existing badge untouched.
      if (Object.prototype.hasOwnProperty.call(SERIES_BADGES, value)) {
        sb.specialEventImage = SERIES_BADGES[value] || null;
      }
    });
  }
  function setGroupList(group: "video" | "audio", key: string, list: string[]) {
    update((d) => {
      const c = d.sidebarPageConfig.credits || (d.sidebarPageConfig.credits = {});
      const g = c[group] || (c[group] = {});
      g[key] = list;
    });
  }
  function setFileSpec(key: string, value: unknown) {
    update((d) => {
      const fs = d.sidebarPageConfig.fileSpecs || (d.sidebarPageConfig.fileSpecs = {});
      fs[key] = value;
    });
  }
  function setStaticSize(b: string, value: string) {
    update((d) => {
      const fs = d.sidebarPageConfig.fileSpecs || (d.sidebarPageConfig.fileSpecs = {});
      const ss = fs.staticSizes || (fs.staticSizes = {});
      ss[b] = value;
    });
  }
  function setMeta(key: string, value: unknown) {
    update((d) => {
      const m = d.sidebarPageConfig.metadata || (d.sidebarPageConfig.metadata = {});
      m[key] = value;
    });
  }
  function setDownload(key: string, value: string) {
    update((d) => {
      const dl = d.sidebarPageConfig.downloads || (d.sidebarPageConfig.downloads = {});
      if (value.trim()) dl[key] = value.trim();
      else delete dl[key];
    });
  }

  return (
    <div className="stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={requestBack}><ArrowLeft className="icon" /> Back</button>
        {dirty ? <span className="chip chip-warn">Unsaved</span> : null}
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => save(true)}>Dry run</button>
        <button className={`btn btn-sm ${dirty ? "btn-primary" : ""}`} disabled={saving || !dirty} onClick={() => save(false)}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={publish} title="Full pipeline: rewrite + sync catalog linkage & protected assets">
          Publish
        </button>
      </div>

      <div className="panel entry-readiness">
        <div className="entry-readiness-head">
          <div className="panel-title" style={{ margin: 0 }}>Readiness</div>
          <span className={`entry-readiness-score ${readyCount === ready.length ? "is-ready" : ""}`}>{readyCount}/{ready.length} ready</span>
          <span className="grow" />
          <button className="btn btn-sm" disabled={running} onClick={runPreflight}>
            <ShieldCheck className="icon" /> {running ? "Running…" : "Run preflight"}
          </button>
        </div>
        <div className="entry-readiness-grid">
          {ready.map((r) => (
            <div key={r.id} className={`entry-check ${r.ok ? "is-ready" : "is-todo"}`}>
              {r.ok ? <CheckCircle2 className="icon" /> : <AlertTriangle className="icon" />}
              <span>{r.label}</span>
              {r.hint ? <span className="entry-check-hint">{r.hint}</span> : null}
            </div>
          ))}
        </div>
        {preflight ? (
          <div className="entry-preflight">
            <div className={`entry-preflight-head ${preflight.ok ? "is-ready" : "is-blocked"}`}>
              {preflight.ok ? <CheckCircle2 className="icon" /> : <AlertTriangle className="icon" />}
              Preflight {preflight.ok ? "passed" : "has blockers"}
            </div>
            {(preflight.checks || []).map((c) => (
              <div key={c.id} className={`ws-line ${c.ok ? "is-ready" : "is-blocked"}`}>
                <span>{c.ok ? "✓" : "×"}</span><span>{c.detail || c.id}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="seg entry-tabs">
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "downloads" ? "on" : ""} onClick={() => setTab("downloads")}>Downloads &amp; files</button>
        <button className={tab === "credits" ? "on" : ""} onClick={() => setTab("credits")}>Credits</button>
        <button className={tab === "metadata" ? "on" : ""} onClick={() => setTab("metadata")}>Metadata</button>
      </div>

      <div className="dx-entry-grid">
      <div className="stack">
      {tab === "overview" ? (
      <div className="panel">
        <div className="panel-title">{entry.title || slug}</div>
        <div className="card-sub" style={{ marginBottom: 12 }}>{slug}</div>
        <div className="field">
          <label>Title</label>
          <input value={entry.title || ""} onChange={(e) => update((d) => (d.title = e.target.value))} />
        </div>
        <div className="field">
          <label>Catalog image</label>
          <div className="entry-artwork">
            <div className="entry-artwork-thumb">
              {thumb ? <img src={thumb} alt="" /> : <span className="entry-card-thumb-empty"><ImageOff className="icon" /></span>}
            </div>
            <div className="entry-artwork-side">
              {imageSrc
                ? <code className="entry-artwork-path">{imageSrc}</code>
                : <span className="muted">No image — carousel uses the fallback</span>}
              <button className="btn btn-sm" type="button" disabled={settingImage} onClick={chooseEntryImage}>
                {settingImage ? "Saving…" : imageSrc ? "Replace image…" : "Choose image…"}
              </button>
            </div>
          </div>
          <div className="field-hint">
            Copied into the repo (<code>/assets/catalog/</code>) and set as <code>image_src</code>; the catalog
            rebuilds on save.
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 160 }} />
        </div>
      </div>
      ) : null}

      {tab === "overview" ? (
      <div className="panel">
        <div className="panel-title">Overview</div>
        <div className="field">
          <label>Lookup number</label>
          <input
            value={sidebar.lookupNumber || ""}
            onChange={(e) => update((d) => (d.sidebarPageConfig.lookupNumber = e.target.value))}
            placeholder="K.Org. At AV2023 S1"
          />
          {!String(sidebar.lookupNumber || "").trim() ? <div className="field-hint field-hint-warn">Required for publish</div> : null}
        </div>
        <div className="field">
          <label>Video URL</label>
          <input
            value={videoUrl}
            onChange={(e) => update((d) => {
              const v = d.video || (d.video = {});
              v.mode = "url";
              v.dataUrl = e.target.value;
              v.dataUrlOriginal = e.target.value;
            })}
            placeholder="https://youtu.be/…"
          />
          {videoUrl && !isValidUrl(videoUrl) ? <div className="field-hint field-hint-warn">Not a valid URL</div> : null}
        </div>
        <div className="field-row">
          <div className="field">
            <label>Canonical instrument</label>
            <input value={canonical.instrument || ""} onChange={(e) => update((d) => { const c = d.canonical || (d.canonical = {}); c.instrument = e.target.value; })} placeholder="TWO ORGANS" />
          </div>
          <div className="field">
            <label>Canonical artist name</label>
            <input value={canonical.artistName || ""} onChange={(e) => update((d) => { const c = d.canonical || (d.canonical = {}); c.artistName = e.target.value; })} />
          </div>
        </div>
        <div className="field">
          <label>Series</label>
          <ChipSelect
            value={String(entry.series || "")}
            options={SERIES_OPTIONS}
            onChange={setSeries}
          />
        </div>
        <div className="field">
          <label>Series badge</label>
          {sidebar.specialEventImage ? (
            <div className="series-badge">
              <img
                src={resolveImageUrl(sidebar.specialEventImage)}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <code className="series-badge-cap">{sidebar.specialEventImage}</code>
            </div>
          ) : (
            <div className="field-static muted">No badge for this series</div>
          )}
        </div>
        <div className="field">
          <label>Season</label>
          <ChipSelect
            value={credits.season || ""}
            options={seasons.map((s) => ({ id: s.id, label: s.id }))}
            onChange={setSeason}
            allowNone
          />
          {(() => {
            const ls = (String(sidebar.lookupNumber || "").match(/\bS(\d+)\b/i)?.[0] || "").toUpperCase();
            return ls && credits.season && ls !== String(credits.season).toUpperCase()
              ? <div className="field-hint field-hint-warn">Lookup implies {ls} — they should usually match</div>
              : null;
          })()}
          <div className="field-hint">Season &amp; series set the catalog grouping — Save or Publish to apply.</div>
        </div>
        <div className="field">
          <label>Attribution sentence</label>
          <textarea
            value={sidebar.attributionSentence || ""}
            onChange={(e) => update((d) => (d.sidebarPageConfig.attributionSentence = e.target.value))}
            style={{ minHeight: 60 }}
          />
        </div>
        <div className="field">
          <label>Buckets &amp; Drive folders</label>
          <div className="bucket-row">
            {BUCKETS.map((b) => {
              const cfg = bucketFolders[b];
              const treeCount = fileTree[b]?.length ?? 0;
              const count = treeCount || cfg?.fileCount || 0;
              const configured = Boolean(cfg?.folderId) || treeCount > 0;
              return (
                <button
                  key={b}
                  className={`bucket ${selectedBuckets.includes(b) ? "on" : ""} ${activeBucket === b ? "is-active" : ""}`}
                  onClick={() => openBucket(b)}
                  title={treeCount ? `${treeCount} published files (recording index)` : configured ? `${count} files configured — click to edit` : "Click to configure a Drive folder"}
                >
                  {b}
                  {configured ? <span className="bucket-dot" /> : null}
                  {count > 0 ? <span className="bucket-count">{count}</span> : null}
                </button>
              );
            })}
          </div>

          {activeBucket ? (
            <div className="bucket-config">
              <div className="bucket-config-head">
                <strong>Bucket {activeBucket}</strong>
                {bucketFolders[activeBucket]?.folderId ? (
                  <a
                    className="bucket-drive-link"
                    href={`https://drive.google.com/drive/folders/${encodeURIComponent(bucketFolders[activeBucket]!.folderId!)}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this bucket's Drive folder"
                  >
                    Open in Drive ↗
                  </a>
                ) : null}
                <span className="grow" />
                <button className="btn btn-ghost btn-sm" onClick={() => toggleBucket(activeBucket!)}>
                  {selectedBuckets.includes(activeBucket) ? "Unpublish" : "Publish"}
                </button>
                {bucketFolders[activeBucket]?.folderId ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => clearBucketFolder(activeBucket!)}>Clear folder</button>
                ) : null}
              </div>
              <div className="inline">
                <input
                  value={bucketFolderInput}
                  onChange={(e) => setBucketFolderInput(e.target.value)}
                  placeholder="Google Drive folder URL or id"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-sm" disabled={scanning || !bucketFolderInput.trim()} onClick={scanBucket}>
                  {scanning ? "Scanning…" : "Scan folder"}
                </button>
              </div>
              {scanning ? <DexLoader phase="Scanning" detail={`bucket ${activeBucket} on Drive`} /> : null}
              {scanResult ? (
                <div className="bucket-scan-result">
                  <div className="muted">
                    {scanResult.count} file{scanResult.count === 1 ? "" : "s"}{scanResult.humanSize ? ` · ${scanResult.humanSize}` : ""} — saved into the manifest. Save the entry to persist; Publish to make it downloadable.
                  </div>
                  {Array.isArray(scanResult.files) && scanResult.files.length ? (
                    <ul className="bucket-file-list">
                      {scanResult.files.slice(0, 8).map((f) => (
                        <li key={f.name}><span>{f.name}</span></li>
                      ))}
                      {scanResult.files.length > 8 ? <li className="muted">+{scanResult.files.length - 8} more…</li> : null}
                    </ul>
                  ) : null}
                </div>
              ) : bucketFolders[activeBucket]?.folderId ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  Configured: {bucketFolders[activeBucket]?.fileCount ?? 0} files
                  {bucketFolders[activeBucket]?.scannedAt ? ` · scanned ${new Date(bucketFolders[activeBucket]!.scannedAt!).toLocaleDateString()}` : ""}. Re-scan to refresh.
                </div>
              ) : (fileTree[activeBucket]?.length ?? 0) > 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {fileTree[activeBucket]!.length} published file{fileTree[activeBucket]!.length === 1 ? "" : "s"} via recording index — listed in the bundle tree below. Scan a Drive folder only to replace them.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      ) : null}

      {tab === "downloads" ? (
      <div className="panel">
        <div className="panel-title">Downloads &amp; file specs</div>
        <div className="field">
          <label>Recording index source URL</label>
          <input
            value={downloads.recordingIndexSourceUrl || ""}
            onChange={(e) => setDownload("recordingIndexSourceUrl", e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/…"
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Recording index PDF ref</label>
            <input
              value={downloads.recordingIndexPdfRef || ""}
              onChange={(e) => setDownload("recordingIndexPdfRef", e.target.value)}
              placeholder="lookup:… or asset:…"
            />
            <RefHint value={downloads.recordingIndexPdfRef} />
          </div>
          <div className="field">
            <label>Recording index bundle ref</label>
            <input
              value={downloads.recordingIndexBundleRef || ""}
              onChange={(e) => setDownload("recordingIndexBundleRef", e.target.value)}
              placeholder="bundle:…"
            />
            <RefHint value={downloads.recordingIndexBundleRef} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Bit depth</label>
            <input type="number" value={fileSpecs.bitDepth ?? ""} onChange={(e) => setFileSpec("bitDepth", Number(e.target.value) || undefined)} />
          </div>
          <div className="field">
            <label>Sample rate</label>
            <input type="number" value={fileSpecs.sampleRate ?? ""} onChange={(e) => setFileSpec("sampleRate", Number(e.target.value) || undefined)} />
          </div>
          <div className="field">
            <label>Channels</label>
            <select value={fileSpecs.channels || ""} onChange={(e) => setFileSpec("channels", e.target.value || undefined)}>
              <option value="">—</option>
              <option value="mono">mono</option>
              <option value="stereo">stereo</option>
              <option value="multichannel">multichannel</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Static download sizes (per bucket)</label>
          <div className="dx-static-sizes">
            {BUCKETS.map((b) => (
              <div className="dx-static-size" key={b}>
                <span>{b}</span>
                <input value={staticSizes[b] || ""} onChange={(e) => setStaticSize(b, e.target.value)} placeholder="—" />
              </div>
            ))}
          </div>
          <div className="field-hint">Auto-filled by a bucket Drive scan; editable for manual overrides.</div>
        </div>
        <div className="field">
          <label>Download bundle</label>
          <DownloadTree downloads={downloads} lookupNumber={sidebar.lookupNumber} />
        </div>
      </div>
      ) : null}

      {tab === "credits" ? (
      <div className="panel">
        <div className="panel-title">Credits</div>
        <div className="field-row">
          <div className="field">
            <label>Artist</label>
            <LinkedCreditInput
              value={asArr(credits.artist)}
              linksByPerson={linksByPerson as CreditLinksByPerson}
              onValueChange={(next) => setCredit("artist", next)}
              onLinksChange={setCreditLinks}
              placeholder="Add artist…"
            />
          </div>
          <div className="field">
            <label>Alias / artistAlt</label>
            <input value={credits.artistAlt || ""} onChange={(e) => setCredit("artistAlt", e.target.value || null)} />
          </div>
        </div>
        <div className="field">
          <label>Instruments</label>
          <TokenInput value={asArr(credits.instruments)} onChange={(next) => setCredit("instruments", next)} placeholder="Add instrument…" />
        </div>
        <div className="field-hint">Click any person credit to add one or more websites, social profiles, or portfolio links.</div>
        <div className="dx-credit-cols">
          <div className="dx-credit-col">
            <div className="dx-credit-col-title">Video</div>
            <div className="field"><label>Director</label><LinkedCreditInput value={asArr(video.director)} linksByPerson={linksByPerson as CreditLinksByPerson} onValueChange={(n) => setGroupList("video", "director", n)} onLinksChange={setCreditLinks} placeholder="Add…" /></div>
            <div className="field"><label>Cinematography</label><LinkedCreditInput value={asArr(video.cinematography)} linksByPerson={linksByPerson as CreditLinksByPerson} onValueChange={(n) => setGroupList("video", "cinematography", n)} onLinksChange={setCreditLinks} placeholder="Add…" /></div>
            <div className="field"><label>Editing</label><LinkedCreditInput value={asArr(video.editing)} linksByPerson={linksByPerson as CreditLinksByPerson} onValueChange={(n) => setGroupList("video", "editing", n)} onLinksChange={setCreditLinks} placeholder="Add…" /></div>
          </div>
          <div className="dx-credit-col">
            <div className="dx-credit-col-title">Audio</div>
            <div className="field"><label>Recording</label><LinkedCreditInput value={asArr(audio.recording)} linksByPerson={linksByPerson as CreditLinksByPerson} onValueChange={(n) => setGroupList("audio", "recording", n)} onLinksChange={setCreditLinks} placeholder="Add…" /></div>
            <div className="field"><label>Mix</label><LinkedCreditInput value={asArr(audio.mix)} linksByPerson={linksByPerson as CreditLinksByPerson} onValueChange={(n) => setGroupList("audio", "mix", n)} onLinksChange={setCreditLinks} placeholder="Add…" /></div>
            <div className="field"><label>Master</label><LinkedCreditInput value={asArr(audio.master)} linksByPerson={linksByPerson as CreditLinksByPerson} onValueChange={(n) => setGroupList("audio", "master", n)} onLinksChange={setCreditLinks} placeholder="Add…" /></div>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Year</label>
            <input type="number" value={credits.year ?? ""} onChange={(e) => setCredit("year", Number(e.target.value) || undefined)} />
            {!isValidYear(credits.year) ? <div className="field-hint field-hint-warn">Out of range</div> : null}
          </div>
          <div className="field">
            <label>Location</label>
            <input value={credits.location || ""} onChange={(e) => setCredit("location", e.target.value)} />
          </div>
          <div className="field">
            <label>Season</label>
            <div className="field-static">{credits.season || "—"} <span className="muted">· set in Overview</span></div>
          </div>
        </div>
      </div>
      ) : null}

      {tab === "metadata" ? (
      <div className="panel">
        <div className="panel-title">Metadata</div>
        <div className="field">
          <label>Sample length</label>
          <input value={metadata.sampleLength || ""} onChange={(e) => setMeta("sampleLength", e.target.value)} placeholder="AUTO" />
        </div>
        <div className="field">
          <label>Tags</label>
          <TokenInput value={asArr(metadata.tags)} onChange={(next) => setMeta("tags", next)} placeholder="Add tag…" />
        </div>
      </div>
      ) : null}
      </div>

      <SidebarPreview title={entry.title || slug} sidebar={sidebar} />
      </div>

      {diff && (
        <div className="panel">
          <div className="panel-title">Last diff</div>
          <div className="diff">{diff}</div>
        </div>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function RefHint({ value }: { value?: string }) {
  const info = describeRef(value || "");
  if (!info) return null;
  return (
    <div className={`field-hint ${info.ok ? "" : "field-hint-warn"}`}>
      {info.ok ? "→ " : "⚠ unrecognized: "}{info.detail}
    </div>
  );
}

// Split into discrete chips: list fields are comma-separated by convention, and
// some legacy entries store both names in a single array element ("A, B").
function asArr(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : (String(value ?? "").trim() ? [String(value)] : []);
  return arr.flatMap((v) => String(v).split(",").map((s) => s.trim())).filter(Boolean);
}

function NewEntryForm({ onBack, onOpen }: { onBack: () => void; onOpen: (slug: string) => void }) {
  const { notify } = useStore();
  const [form, setForm] = useState({
    slug: "",
    title: "",
    lookupNumber: "",
    attributionSentence: "",
    artist: "",
    instruments: "",
    year: String(new Date().getUTCFullYear()),
    season: "S1",
    location: "",
    videoUrl: "",
    descriptionText: "",
  });
  const [buckets, setBuckets] = useState<string[]>(["A"]);
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleBucket(b: Bucket) {
    setBuckets((cur) => {
      const set = new Set(cur);
      if (set.has(b)) set.delete(b);
      else set.add(b);
      return BUCKETS.filter((x) => set.has(x));
    });
  }

  async function submit(dryRun: boolean) {
    if (!form.slug.trim()) {
      notify("err", "Slug is required.");
      return;
    }
    setBusy(true);
    try {
      const artist = toList(form.artist).map(titleCaseName).join(", ");
      const result = await rpc<{ lines: string[] }>("entry.create", { ...form, artist, buckets, dryRun });
      if (dryRun) {
        notify("ok", "Dry run OK — entry would be created.");
      } else {
        notify("ok", `Created ${form.slug}.`);
        onOpen(form.slug.trim());
      }
      void result;
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content-narrow stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft className="icon" /> Back</button>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => submit(true)}>Dry run</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => submit(false)}>
          {busy ? "Creating…" : "Create entry"}
        </button>
      </div>

      <div className="panel">
        <div className="panel-title">New entry</div>
        <div className="field-row">
          <div className="field">
            <label>Slug (folder name)</label>
            <input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="artist-piece" />
          </div>
          <div className="field">
            <label>Title</label>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Lookup number</label>
            <input value={form.lookupNumber} onChange={(e) => set("lookupNumber", e.target.value)} placeholder="V.Sng. Ab AV2026 S1" />
          </div>
          <div className="field">
            <label>Video URL</label>
            <input value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Attribution sentence</label>
          <input value={form.attributionSentence} onChange={(e) => set("attributionSentence", e.target.value)} />
        </div>
        <div className="field">
          <label>Buckets</label>
          <div className="bucket-row">
            {BUCKETS.map((b) => (
              <button key={b} className={`bucket ${buckets.includes(b) ? "on" : ""}`} onClick={() => toggleBucket(b)}>{b}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea value={form.descriptionText} onChange={(e) => set("descriptionText", e.target.value)} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Credits</div>
        <div className="field-row">
          <div className="field">
            <label>Artist (comma-separated)</label>
            <input value={form.artist} onChange={(e) => set("artist", e.target.value)} />
          </div>
          <div className="field">
            <label>Instruments (comma-separated)</label>
            <input value={form.instruments} onChange={(e) => set("instruments", e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Year</label>
            <input value={form.year} onChange={(e) => set("year", e.target.value)} />
          </div>
          <div className="field">
            <label>Season</label>
            <input value={form.season} onChange={(e) => set("season", e.target.value)} />
          </div>
          <div className="field">
            <label>Location</label>
            <input value={form.location} onChange={(e) => set("location", e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function toList(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
