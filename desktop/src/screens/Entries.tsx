import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { rpc, payloadOf, pickImageFile } from "../api";
import { useStore } from "../store";
import { useGuardSource } from "../guard";
import { DexLoader } from "../components/DexLoader";
import { DownloadTree } from "../components/DownloadTree";
import { BUCKETS, type Bucket, type EntryFolder, type EntryListItem } from "../domain";

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
  const dl = sb.downloads && typeof sb.downloads === "object" ? sb.downloads : (sb.downloads = {});
  if (!dl.fileSpecs || typeof dl.fileSpecs !== "object") dl.fileSpecs = {};
  capitalizeArtists(next);
  return next;
}

export function EntriesScreen() {
  const { notify } = useStore();
  const [items, setItems] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await rpc<{ entries: EntryListItem[] }>("entry.list");
      setItems(result.entries || []);
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
    if (!q) return items;
    return items.filter(
      (item) =>
        item.slug.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.lookupNumber.toLowerCase().includes(q),
    );
  }, [items, filter]);

  if (creating) {
    return <NewEntryForm onBack={() => { setCreating(false); load(); }} onOpen={(slug) => { setCreating(false); load(); setOpenSlug(slug); }} />;
  }

  if (openSlug) {
    return <EntryEditor slug={openSlug} onBack={() => { setOpenSlug(null); load(); }} />;
  }

  return (
    <div className="stack">
      <div className="inline">
        <input
          placeholder="Filter entries…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--dx-border)", background: "var(--dx-surface-strong)" }}
        />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus className="icon" /> New entry</button>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        {loading && <div className="spinner" />}
      </div>
      <div className="muted">{filtered.length} entries</div>
      <div className="grid">
        {filtered.map((item) => (
          <div className="card" key={item.slug} onClick={() => setOpenSlug(item.slug)}>
            <div className="card-title">{item.title}</div>
            <div className="card-sub">{item.slug}</div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              {item.lookupNumber && <span className="chip">{item.lookupNumber}</span>}
              {item.buckets.map((b) => (
                <span className="chip chip-accent" key={b}>{b}</span>
              ))}
            </div>
          </div>
        ))}
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
  const [settingImage, setSettingImage] = useState(false);

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
    if (dirty && !confirm(`Discard unsaved changes to ${slug}?`)) return;
    onBack();
  }

  if (!folder || !entry) {
    return <div className="empty"><div className="spinner" /></div>;
  }

  const sidebar = entry.sidebarPageConfig || {};
  const downloads = sidebar.downloads || {};
  const fileSpecs = downloads.fileSpecs || {};
  const selectedBuckets: string[] = Array.isArray(downloads.selectedBuckets)
    ? downloads.selectedBuckets
    : Array.isArray(sidebar.buckets)
      ? sidebar.buckets
      : [];

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
        const fs = dl.fileSpecs || (dl.fileSpecs = {});
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
      if (dl.fileSpecs?.staticSizes) dl.fileSpecs.staticSizes[b] = "";
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

  async function publish() {
    if (!confirm(`Full publish ${slug}? This rewrites the entry AND syncs catalog linkage + protected-asset mappings.`)) return;
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

  const credits = sidebar.credits || {};

  return (
    <div className="content-narrow stack">
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

      <div className="panel">
        <div className="panel-title">{entry.title || slug}</div>
        <div className="card-sub" style={{ marginBottom: 12 }}>{slug}</div>
        <div className="field">
          <label>Title</label>
          <input value={entry.title || ""} onChange={(e) => update((d) => (d.title = e.target.value))} />
        </div>
        <div className="field">
          <label>Catalog image</label>
          <div className="inline">
            {imageSrc ? (
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{imageSrc}</code>
            ) : (
              <span className="muted" style={{ flex: 1 }}>No image — carousel uses the fallback</span>
            )}
            <button className="btn btn-sm" type="button" disabled={settingImage} onClick={chooseEntryImage}>
              {settingImage ? "Saving…" : imageSrc ? "Replace image…" : "Choose image…"}
            </button>
          </div>
          <div className="field-hint">
            Copied into the repo (<code>/assets/catalog/</code>) and set as <code>image_src</code>; the catalog
            rebuilds. Shown when present so you don't overwrite by accident.
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 160 }} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Sidebar metadata</div>
        <div className="field">
          <label>Lookup number</label>
          <input
            value={sidebar.lookupNumber || ""}
            onChange={(e) => update((d) => (d.sidebarPageConfig.lookupNumber = e.target.value))}
          />
        </div>
        <div className="field">
          <label>Buckets &amp; Drive folders</label>
          <div className="bucket-row">
            {BUCKETS.map((b) => {
              const cfg = bucketFolders[b];
              const configured = Boolean(cfg?.folderId);
              return (
                <button
                  key={b}
                  className={`bucket ${selectedBuckets.includes(b) ? "on" : ""} ${activeBucket === b ? "is-active" : ""}`}
                  onClick={() => openBucket(b)}
                  title={configured ? `${cfg?.fileCount ?? 0} files configured — click to edit` : "Click to configure a Drive folder"}
                >
                  {b}
                  {configured ? <span className="bucket-dot" /> : null}
                  {typeof cfg?.fileCount === "number" && cfg.fileCount > 0 ? <span className="bucket-count">{cfg.fileCount}</span> : null}
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
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label>Recording index link</label>
          <input
            value={downloads.recordingIndexUrl || ""}
            onChange={(e) => update((d) => {
              const dl = d.sidebarPageConfig.downloads || (d.sidebarPageConfig.downloads = {});
              dl.recordingIndexUrl = e.target.value;
            })}
            placeholder="Google Sheet URL for this entry's recording index"
          />
        </div>
        <div className="field">
          <label>Download bundle</label>
          <DownloadTree downloads={downloads} lookupNumber={sidebar.lookupNumber} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Bit depth</label>
            <input
              type="number"
              value={fileSpecs.bitDepth ?? ""}
              onChange={(e) => update((d) => (d.sidebarPageConfig.downloads.fileSpecs = { ...d.sidebarPageConfig.downloads.fileSpecs, bitDepth: Number(e.target.value) || undefined }))}
            />
          </div>
          <div className="field">
            <label>Sample rate</label>
            <input
              type="number"
              value={fileSpecs.sampleRate ?? ""}
              onChange={(e) => update((d) => (d.sidebarPageConfig.downloads.fileSpecs = { ...d.sidebarPageConfig.downloads.fileSpecs, sampleRate: Number(e.target.value) || undefined }))}
            />
          </div>
          <div className="field">
            <label>Channels</label>
            <select
              value={fileSpecs.channels || ""}
              onChange={(e) => update((d) => (d.sidebarPageConfig.downloads.fileSpecs = { ...d.sidebarPageConfig.downloads.fileSpecs, channels: e.target.value || undefined }))}
            >
              <option value="">—</option>
              <option value="mono">mono</option>
              <option value="stereo">stereo</option>
              <option value="multichannel">multichannel</option>
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Credits</div>
        <div className="field">
          <label>Artist (comma-separated)</label>
          <input
            value={asList(credits.artist)}
            onChange={(e) => update((d) => (d.sidebarPageConfig.credits = { ...d.sidebarPageConfig.credits, artist: toList(e.target.value) }))}
          />
        </div>
        <div className="field">
          <label>Instruments (comma-separated)</label>
          <input
            value={asList(credits.instruments)}
            onChange={(e) => update((d) => (d.sidebarPageConfig.credits = { ...d.sidebarPageConfig.credits, instruments: toList(e.target.value) }))}
          />
        </div>
      </div>

      {diff && (
        <div className="panel">
          <div className="panel-title">Last diff</div>
          <div className="diff">{diff}</div>
        </div>
      )}
    </div>
  );
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

function asList(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

function toList(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
