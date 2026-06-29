import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, RefreshCw, Trash2, Replace, Link2, FileImage, X } from "lucide-react";
import { rpc, pickAnyFile } from "../api";
import { useStore } from "../store";
import { DexLoader } from "../components/DexLoader";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";
import {
  humanBytes,
  type AssetInventory,
  type AssetRow,
  type AssetKind,
  type ProtectedLookup,
  type ProtectedFile,
  type Entitlement,
} from "../domain";

type Tab = "files" | "linked";

export function AssetsScreen() {
  const [tab, setTab] = useState<Tab>("files");
  return (
    <div className="stack">
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>
          <FileImage className="icon" /> Files
        </button>
        <button className={tab === "linked" ? "on" : ""} onClick={() => setTab("linked")}>
          <Link2 className="icon" /> Linked
        </button>
      </div>
      {tab === "files" ? <FilesTab /> : <LinkedTab />}
    </div>
  );
}

/* ----------------------------------------------------------------- files - */

const KIND_OPTIONS: Array<AssetKind | "all"> = ["all", "image", "svg", "font", "media", "js", "css", "pdf", "data", "other"];

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (["png", "gif", "webp", "avif", "ico"].includes(e)) return `image/${e === "ico" ? "x-icon" : e}`;
  return "application/octet-stream";
}

function AssetThumb({ asset }: { asset: AssetRow }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const showable = asset.kind === "image" || asset.kind === "svg";
  useEffect(() => {
    if (!showable) return;
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !done) {
        done = true;
        io.disconnect();
        rpc<{ base64: string }>("assets.read", { webPath: asset.webPath })
          .then((r) => setSrc(`data:${mimeForExt(asset.ext)};base64,${r.base64}`))
          .catch(() => {});
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [asset.webPath, asset.ext, showable]);

  return (
    <div className="dx-asset-thumb" ref={ref} data-kind={asset.kind}>
      {src ? <img src={src} alt="" /> : <span className="dx-asset-thumb-ext">{asset.ext || asset.kind}</span>}
    </div>
  );
}

function FilesTab() {
  const { notify } = useStore();
  const [inv, setInv] = useState<AssetInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [refsFor, setRefsFor] = useState<{ asset: AssetRow; refs: string[] } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInv(await rpc<AssetInventory>("assets.list"));
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
    const list = inv?.assets || [];
    const q = filter.trim().toLowerCase();
    return list.filter((a) => {
      if (kind !== "all" && a.kind !== kind) return false;
      if (orphansOnly && a.refCount > 0) return false;
      if (q && !a.webPath.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [inv, filter, kind, orphansOnly]);

  const totalBytes = useMemo(() => filtered.reduce((s, a) => s + a.sizeBytes, 0), [filtered]);

  async function replaceAsset(asset: AssetRow) {
    const file = await pickAnyFile({ title: `Replace ${asset.webPath}` });
    if (!file) return;
    setBusy(asset.webPath);
    try {
      await rpc("assets.replace", { webPath: asset.webPath, sourcePath: file });
      notify("ok", `Replaced ${asset.webPath} across all mirrors.`);
      await load();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(asset: AssetRow, confirmed: boolean) {
    setBusy(asset.webPath);
    try {
      await rpc("assets.delete", { webPath: asset.webPath, confirmed });
      notify("ok", `Deleted ${asset.webPath}.`);
      await load();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function requestDelete(asset: AssetRow) {
    if (asset.refCount === 0) {
      setConfirm({
        title: "Delete asset",
        body: (
          <div className="stack" style={{ gap: 6 }}>
            <code>{asset.webPath}</code>
            <span className="muted">No references found. Removes all {asset.mirrors.length} mirror copies.</span>
          </div>
        ),
        confirmLabel: "Delete",
        danger: true,
        onConfirm: () => doDelete(asset, true),
      });
      return;
    }
    // Referenced — fetch the full list so the operator sees what breaks.
    let refs: string[] = [];
    try {
      const r = await rpc<{ refs: string[] }>("assets.refs", { webPath: asset.webPath });
      refs = r.refs || [];
    } catch {
      /* fall back to the count */
    }
    setConfirm({
      title: "Delete referenced asset",
      body: (
        <div className="stack" style={{ gap: 6 }}>
          <code>{asset.webPath}</code>
          <span className="muted" style={{ color: "var(--dx-danger, #d66)" }}>
            Still referenced by {asset.refCount} file{asset.refCount === 1 ? "" : "s"}. Deleting will break these:
          </span>
          <ul className="dx-ref-list">
            {refs.slice(0, 12).map((r) => (
              <li key={r}>{r}</li>
            ))}
            {refs.length > 12 ? <li className="muted">+{refs.length - 12} more…</li> : null}
          </ul>
        </div>
      ),
      confirmLabel: "Delete anyway",
      danger: true,
      onConfirm: () => doDelete(asset, true),
    });
  }

  async function viewRefs(asset: AssetRow) {
    try {
      const r = await rpc<{ refs: string[] }>("assets.refs", { webPath: asset.webPath });
      setRefsFor({ asset, refs: r.refs || [] });
    } catch (error) {
      notify("err", String(error));
    }
  }

  return (
    <>
      <div className="dx-asset-toolbar">
        <input
          placeholder="Filter by path…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--dx-border)", background: "var(--dx-surface-strong)" }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind | "all")}>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>{k === "all" ? "All kinds" : k}</option>
          ))}
        </select>
        <label className="dx-check">
          <input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} /> Orphans only
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><FileUp className="icon" /> Add file</button>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw className="icon" /> Refresh</button>
        {loading && <div className="spinner" />}
      </div>
      <div className="muted">
        {filtered.length} of {inv?.totalFiles ?? 0} files · {humanBytes(totalBytes)}
        {inv ? ` · ${(inv.assets || []).filter((a) => a.refCount === 0).length} orphans total` : ""}
      </div>

      {loading && !inv ? (
        <DexLoader phase="Scanning" detail="repo assets + references" />
      ) : (
        <div className="dx-asset-table">
          <div className="dx-asset-row dx-asset-head">
            <span />
            <span>Path</span>
            <span>Kind</span>
            <span>Size</span>
            <span>Refs</span>
            <span>Mirrors</span>
            <span>Actions</span>
          </div>
          {filtered.map((a) => (
            <div className="dx-asset-row" key={a.webPath}>
              <AssetThumb asset={a} />
              <code className="dx-asset-path" title={a.webPath}>{a.webPath}</code>
              <span><span className="chip chip-mini">{a.kind}</span></span>
              <span className="muted">{humanBytes(a.sizeBytes)}</span>
              <span>
                {a.refCount > 0 ? (
                  <button className="dx-linkish" onClick={() => viewRefs(a)}>{a.refCount}</button>
                ) : (
                  <span className="chip chip-mini" title="No references — safe to delete">orphan</span>
                )}
              </span>
              <span className="dx-mirror-badges">
                {["root", "public", "docs"].map((m) => (
                  <span key={m} className={`dx-mirror ${a.mirrors.includes(m) ? "on" : ""}`} title={m}>{m[0]}</span>
                ))}
              </span>
              <span className="inline" style={{ gap: 6 }}>
                <button className="btn btn-ghost btn-sm" disabled={busy === a.webPath} onClick={() => replaceAsset(a)} title="Replace file in place">
                  <Replace className="icon" />
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy === a.webPath} onClick={() => requestDelete(a)} title="Delete from all mirrors">
                  <Trash2 className="icon" />
                </button>
              </span>
            </div>
          ))}
          {filtered.length === 0 ? <div className="empty">No assets match.</div> : null}
        </div>
      )}

      {refsFor ? (
        <div className="dx-modal-overlay" onClick={() => setRefsFor(null)}>
          <div className="dx-modal dx-modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="dx-modal-head">
              <h3 className="dx-modal-title">References</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setRefsFor(null)}><X className="icon" /></button>
            </div>
            <div className="dx-modal-body">
              <code>{refsFor.asset.webPath}</code>
              <ul className="dx-ref-list" style={{ marginTop: 10 }}>
                {refsFor.refs.map((r) => <li key={r}>{r}</li>)}
                {refsFor.refs.length === 0 ? <li className="muted">No references.</li> : null}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {adding ? <AddAssetModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} /> : null}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function AddAssetModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { notify } = useStore();
  const [sourcePath, setSourcePath] = useState("");
  const [destDir, setDestDir] = useState("img");
  const [busy, setBusy] = useState(false);

  async function choose() {
    const file = await pickAnyFile({ title: "Choose a file to add" });
    if (file) setSourcePath(file);
  }

  async function add() {
    if (!sourcePath) {
      notify("err", "Choose a file first.");
      return;
    }
    setBusy(true);
    try {
      const r = await rpc<{ webPath: string }>("assets.add", { sourcePath, destDir });
      notify("ok", `Added ${r.webPath}.`);
      onAdded();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  const fileName = sourcePath ? sourcePath.split("/").pop() : "";

  return (
    <div className="dx-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="dx-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="dx-modal-title">Add asset</h3>
        <div className="dx-modal-body stack">
          <div className="field">
            <label>Source file</label>
            <div className="inline">
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sourcePath || "—"}</code>
              <button className="btn btn-sm" onClick={choose}>Choose…</button>
            </div>
          </div>
          <div className="field">
            <label>Destination (under /assets/)</label>
            <input value={destDir} onChange={(e) => setDestDir(e.target.value)} placeholder="img" />
            <div className="field-hint">
              Saved to <code>/assets/{destDir || "img"}/{fileName || "<file>"}</code>, mirrored to public/ + docs/.
            </div>
          </div>
        </div>
        <div className="dx-modal-actions">
          <button className="btn btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !sourcePath} onClick={add}>{busy ? "Adding…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- linked - */

const STATUS_OPTIONS = ["draft", "submitted", "pending", "reviewing", "triage", "in_review", "needs_info", "approved", "accepted", "active", "rejected", "in_library", "closed"];
const ENTITLEMENT_TYPES = ["public", "role", "email", "email_domain", "membership_tier", "auth0_sub"];

function LinkedTab() {
  const { notify } = useStore();
  const [lookups, setLookups] = useState<ProtectedLookup[]>([]);
  const [loading, setLoading] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rpc<{ lookups: ProtectedLookup[] }>("protected.list");
      setLookups(r.lookups || []);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (openKey) {
    return <LookupDetail lookupNumber={openKey} onBack={() => { setOpenKey(null); load(); }} />;
  }

  return (
    <>
      <div className="inline">
        <div className="muted" style={{ flex: 1 }}>{lookups.length} protected lookups (data/protected.assets.json)</div>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw className="icon" /> Refresh</button>
        {loading && <div className="spinner" />}
      </div>
      {loading && !lookups.length ? (
        <DexLoader phase="Loading" detail="protected assets" />
      ) : (
        <div className="dx-asset-table">
          <div className="dx-asset-row dx-linked-head dx-asset-head">
            <span>Lookup</span>
            <span>Title</span>
            <span>Status</span>
            <span>Season</span>
            <span>Files</span>
            <span>Size</span>
          </div>
          {lookups.map((l) => (
            <div className="dx-asset-row dx-linked-row" key={l.lookupNumber} onClick={() => setOpenKey(l.lookupNumber)} role="button">
              <code className="dx-asset-path">{l.lookupNumber}</code>
              <span className="dx-asset-path">{l.title}</span>
              <span><span className="chip chip-mini">{l.status}</span></span>
              <span className="muted">{l.season}</span>
              <span className="muted">{l.fileCount}</span>
              <span className="muted">{l.totalBytes ? humanBytes(l.totalBytes) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function LookupDetail({ lookupNumber, onBack }: { lookupNumber: string; onBack: () => void }) {
  const { notify } = useStore();
  const [lookup, setLookup] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [season, setSeason] = useState("");
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => {
    rpc<{ lookup: any }>("protected.get", { lookupNumber })
      .then((r) => {
        setLookup(r.lookup);
        setTitle(r.lookup.title || "");
        setStatus(r.lookup.status || "");
        setSeason(r.lookup.season || "");
        setEntitlements(Array.isArray(r.lookup.entitlements) ? r.lookup.entitlements : []);
      })
      .catch((error) => notify("err", String(error)));
  }, [lookupNumber, notify]);

  async function save() {
    setSaving(true);
    try {
      await rpc("protected.patchLookup", {
        lookupNumber,
        patch: { title, status, season, entitlements: entitlements.filter((e) => e.type && e.value) },
      });
      notify("ok", `Saved ${lookupNumber}.`);
      onBack();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    setConfirm({
      title: "Remove lookup",
      body: (
        <div className="stack" style={{ gap: 6 }}>
          <code>{lookupNumber}</code>
          <span className="muted">Removes this lookup and all its file mappings from protected.assets.json (+ mirrors). Downloads for this entry stop resolving.</span>
        </div>
      ),
      confirmLabel: "Remove lookup",
      danger: true,
      onConfirm: async () => {
        await rpc("protected.removeLookup", { lookupNumber });
        notify("ok", `Removed ${lookupNumber}.`);
        onBack();
      },
    });
  }

  if (!lookup) {
    return <div className="empty"><div className="spinner" /></div>;
  }

  const files: ProtectedFile[] = Array.isArray(lookup.files) ? lookup.files : [];

  return (
    <div className="content-narrow stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm btn-danger" disabled={saving} onClick={remove}>Remove lookup</button>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>

      <div className="panel">
        <div className="panel-title">{lookupNumber}</div>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Season</label>
            <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="S1" />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Entitlements</div>
        {entitlements.map((ent, i) => (
          <div className="field-row" key={i} style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label>Type</label>
              <select value={ent.type} onChange={(e) => setEntitlements((cur) => cur.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                {ENTITLEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Value</label>
              <input value={ent.value} onChange={(e) => setEntitlements((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setEntitlements((cur) => cur.filter((_, j) => j !== i))}><X className="icon" /></button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => setEntitlements((cur) => [...cur, { type: "role", value: "" }])}>+ Add entitlement</button>
      </div>

      <div className="panel">
        <div className="panel-title">Files ({files.length})</div>
        <div className="dx-asset-table">
          {files.map((f, i) => (
            <div className="dx-asset-row dx-file-row" key={f.fileId || f.r2Key || i}>
              <span className="muted">{f.bucketNumber}</span>
              <code className="dx-asset-path" title={f.r2Key}>{f.label || f.r2Key}</code>
              <span><span className="chip chip-mini">{f.type}</span></span>
              <span className="muted">{f.sizeBytes ? humanBytes(f.sizeBytes) : "—"}</span>
            </div>
          ))}
          {files.length === 0 ? <div className="empty">No files.</div> : null}
        </div>
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
