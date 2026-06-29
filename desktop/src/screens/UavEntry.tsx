import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  ImageOff,
  Plus,
  Radar,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { payloadOf, rpc } from "../api";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";
import { DexLoader } from "../components/DexLoader";
import {
  LinkedCreditInput,
  type CreditLinksByPerson,
} from "../components/LinkedCreditInput";
import type {
  UavAuthorities,
  UavAuthorityRef,
  UavCollectionFolder,
  UavFile,
} from "../domain";
import { resolveImageUrl } from "../entryHelpers";
import { useGuardSource } from "../guard";
import { useStore } from "../store";

const CAPTURE_CLASSES = {
  V: "Aerial video",
  I: "Field stills",
  A: "Ambient sound",
  D: "Imaging study",
} as const;
const SPECTRA = {
  FS: "Full-spectrum",
  RGB: "Visible light",
  IR: "Infrared",
  TH: "Thermal",
} as const;

type CaptureClass = keyof typeof CAPTURE_CLASSES;
type Spectrum = keyof typeof SPECTRA;
type UavTab = "overview" | "downloads" | "credits" | "metadata";
type PreflightResult = {
  ok: boolean;
  checks?: Array<{ id: string; ok: boolean; detail: string }>;
  blockers?: Array<{ id: string; detail: string }>;
};

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatCollection(subject: string, cutter: string, year: number, tour: string): string {
  return `DR.${subject}. ${cutter} ${year} ${tour.toUpperCase()}`;
}

function formatSeries(
  subject: string,
  cutter: string,
  captureClass: CaptureClass,
  year: number,
  tour: string,
  spectrum?: Spectrum,
): string {
  return `DR.${subject}. ${cutter} ${captureClass}${year} ${tour.toUpperCase()}${captureClass === "A" ? "" : ` [${spectrum || "RGB"}]`}`;
}

function refreshIdentifiers(collectionInput: any, manifestInput: any, authorities: UavAuthorities) {
  const collection = structuredClone(collectionInput);
  const manifest = structuredClone(manifestInput);
  const subject = authorities.subjects.find((row) => row.code === collection.identity.primarySubjectCode);
  const site = authorities.sites.find((row) => row.id === collection.siteAuthorityId);
  if (!subject || !site) return { collection, manifest };
  collection.identity.siteCutter = site.cutter;
  collection.lookupRaw = formatCollection(subject.code, site.cutter, Number(collection.identity.year), collection.identity.tour);
  collection.lookupNorm = collection.lookupRaw.toLowerCase();
  manifest.collectionLookup = collection.lookupRaw;
  for (const series of collection.series || []) {
    if (series.captureClass === "A") delete series.spectrum;
    else if (!series.spectrum) series.spectrum = "RGB";
    series.lookupRaw = formatSeries(
      subject.code,
      site.cutter,
      series.captureClass,
      Number(collection.identity.year),
      collection.identity.tour,
      series.spectrum,
    );
    series.lookupNorm = series.lookupRaw.toLowerCase();
    const group = (manifest.groups || []).find((row: any) => row.seriesId === series.id);
    if (!group) continue;
    group.seriesLookup = series.lookupRaw;
    group.captureClass = series.captureClass;
    for (const bucket of group.buckets || []) {
      for (const file of bucket.files || []) file.lookupRaw = `${series.lookupRaw} ${file.bucketNumber}`;
    }
  }
  return { collection, manifest };
}

function emptyAuthorities(): UavAuthorities {
  return { version: "uav-authorities-v1", updatedAt: "", subjects: [], sites: [] };
}

function humanBytes(value: number): string {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[index]}`;
}

function authorityId(kind: "subject" | "site", label: string, uri: string): string {
  return `${kind}-${slugify(label)}-${uri.split("/").filter(Boolean).pop() || Date.now()}`;
}

export function NewUavForm({ onBack, onOpen }: { onBack: () => void; onOpen: (slug: string) => void }) {
  const { notify } = useStore();
  const [authorities, setAuthorities] = useState<UavAuthorities>(emptyAuthorities());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    primarySubjectId: "",
    siteAuthorityId: "",
    year: String(new Date().getUTCFullYear()),
    tour: "T1",
    captureClass: "V" as CaptureClass,
    spectrum: "FS" as Spectrum,
    capturedFrom: "",
    capturedTo: "",
    attribution: "",
    operators: "",
    previewUrl: "",
    descriptionText: "",
  });

  useEffect(() => {
    rpc<{ authorities: UavAuthorities }>("uav.authorities")
      .then((result) => {
        setAuthorities(result.authorities);
        setForm((current) => ({
          ...current,
          primarySubjectId: current.primarySubjectId || result.authorities.subjects[0]?.id || "",
          siteAuthorityId: current.siteAuthorityId || result.authorities.sites[0]?.id || "",
        }));
      })
      .catch((error) => notify("err", String(error)));
  }, [notify]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const selectedSubject = authorities.subjects.find((row) => row.id === form.primarySubjectId);
  const selectedSite = authorities.sites.find((row) => row.id === form.siteAuthorityId);
  const previewLookup = selectedSubject && selectedSite && /^T[1-9]\d*$/.test(form.tour.toUpperCase())
    ? formatCollection(selectedSubject.code, selectedSite.cutter, Number(form.year), form.tour)
    : "";

  async function submit(dryRun: boolean) {
    if (!form.slug.trim() || !form.title.trim() || !form.primarySubjectId || !form.siteAuthorityId) {
      notify("err", "Slug, title, subject authority, and site authority are required.");
      return;
    }
    setBusy(true);
    try {
      await rpc("uav.create", {
        ...form,
        year: Number(form.year),
        spectrum: form.captureClass === "A" ? "" : form.spectrum,
        operators: form.operators.split(",").map((row) => row.trim()).filter(Boolean),
        capturedFrom: form.capturedFrom || undefined,
        capturedTo: form.capturedTo || undefined,
        dryRun,
      });
      if (dryRun) notify("ok", `Dry run passed — ${previewLookup}.`);
      else {
        notify("ok", `Created ${form.slug}.`);
        onOpen(form.slug.trim());
      }
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
          {busy ? "Creating…" : "Create UAV collection"}
        </button>
      </div>
      <div className="panel uav-form-hero">
        <p className="uav-eyebrow">dexDRONES / typed location collection</p>
        <div className="panel-title">New UAV collection</div>
        <code className="uav-lookup-preview">{previewLookup || "DR.Subject. Site YYYY T#"}</code>
        <p className="muted">Choose registered authorities and an initial capture series. The full editor handles registry authoring, Drive buckets, credits, and technical metadata.</p>
      </div>
      <div className="panel">
        <div className="field-row">
          <div className="field"><label>Slug</label><input value={form.slug} onChange={(event) => set("slug", slugify(event.target.value))} placeholder="mojave-wind-farm" /></div>
          <div className="field"><label>Collection title</label><input value={form.title} onChange={(event) => set("title", event.target.value)} /></div>
        </div>
        <div className="field-row">
          <div className="field"><label>Primary LCSH subject</label><select value={form.primarySubjectId} onChange={(event) => set("primarySubjectId", event.target.value)}>{authorities.subjects.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.label}</option>)}</select></div>
          <div className="field"><label>Site authority</label><select value={form.siteAuthorityId} onChange={(event) => set("siteAuthorityId", event.target.value)}>{authorities.sites.map((row) => <option key={row.id} value={row.id}>{row.cutter} · {row.name}</option>)}</select></div>
        </div>
        <div className="field-row">
          <div className="field"><label>Year</label><input type="number" min="2000" max="2100" value={form.year} onChange={(event) => set("year", event.target.value)} /></div>
          <div className="field"><label>Tour</label><input value={form.tour} onChange={(event) => set("tour", event.target.value.toUpperCase())} placeholder="T1" /></div>
          <div className="field"><label>Initial capture class</label><select value={form.captureClass} onChange={(event) => set("captureClass", event.target.value as CaptureClass)}>{Object.entries(CAPTURE_CLASSES).map(([id, label]) => <option key={id} value={id}>{id} · {label}</option>)}</select></div>
          {form.captureClass !== "A" ? <div className="field"><label>Acquisition spectrum</label><select value={form.spectrum} onChange={(event) => set("spectrum", event.target.value as Spectrum)}>{Object.entries(SPECTRA).map(([id, label]) => <option key={id} value={id}>{id} · {label}</option>)}</select></div> : null}
        </div>
        <div className="field-row">
          <div className="field"><label>Captured from</label><input type="date" value={form.capturedFrom} onChange={(event) => set("capturedFrom", event.target.value)} /></div>
          <div className="field"><label>Captured to</label><input type="date" value={form.capturedTo} onChange={(event) => set("capturedTo", event.target.value)} /></div>
        </div>
        <div className="field"><label>Attribution</label><textarea value={form.attribution} onChange={(event) => set("attribution", event.target.value)} /></div>
        <div className="field"><label>Operators (comma-separated)</label><input value={form.operators} onChange={(event) => set("operators", event.target.value)} /></div>
        <div className="field"><label>Preview URL</label><input value={form.previewUrl} onChange={(event) => set("previewUrl", event.target.value)} /></div>
        <div className="field"><label>Description</label><textarea value={form.descriptionText} onChange={(event) => set("descriptionText", event.target.value)} style={{ minHeight: 140 }} /></div>
      </div>
    </div>
  );
}

export function UavEditor({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { notify } = useStore();
  const [folder, setFolder] = useState<UavCollectionFolder | null>(null);
  const [collection, setCollection] = useState<any>(null);
  const [manifest, setManifest] = useState<any>(null);
  const [authorities, setAuthorities] = useState<UavAuthorities>(emptyAuthorities());
  const [description, setDescription] = useState("");
  const [baseline, setBaseline] = useState("");
  const [tab, setTab] = useState<UavTab>("overview");
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [marcXml, setMarcXml] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  function snapshot(nextCollection = collection, nextManifest = manifest, nextDescription = description, nextAuthorities = authorities) {
    return JSON.stringify({ collection: nextCollection, manifest: nextManifest, description: nextDescription, authorities: nextAuthorities });
  }

  useEffect(() => {
    rpc<UavCollectionFolder>("uav.read", { slug })
      .then((result) => {
        setFolder(result);
        setCollection(result.collection);
        setManifest(result.manifest);
        setDescription(result.descriptionText || "");
        setAuthorities(result.authorities);
        setBaseline(JSON.stringify({
          collection: result.collection,
          manifest: result.manifest,
          description: result.descriptionText || "",
          authorities: result.authorities,
        }));
      })
      .catch((error) => notify("err", String(error)));
  }, [slug, notify]);

  useEffect(() => {
    if (!collection || !manifest || !authorities.subjects.length || !authorities.sites.length) return;
    const refreshed = refreshIdentifiers(collection, manifest, authorities);
    if (JSON.stringify(refreshed.collection) !== JSON.stringify(collection)) setCollection(refreshed.collection);
    if (JSON.stringify(refreshed.manifest) !== JSON.stringify(manifest)) setManifest(refreshed.manifest);
  }, [authorities]);

  const dirty = Boolean(baseline && collection && manifest && snapshot() !== baseline);

  function updateCollection(mutator: (draft: any) => void, rebase = false) {
    const nextCollection = structuredClone(collection);
    const nextManifest = structuredClone(manifest);
    mutator(nextCollection);
    const next = rebase ? refreshIdentifiers(nextCollection, nextManifest, authorities) : { collection: nextCollection, manifest: nextManifest };
    setCollection(next.collection);
    setManifest(next.manifest);
    setPreflight(null);
  }

  function updateManifest(mutator: (draft: any) => void) {
    setManifest((current: any) => {
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
    setPreflight(null);
  }

  async function persist() {
    const authorityResult = await rpc<any>("uav.authorities.write", { authorities });
    const nextAuthorities = authorityResult.authorities || authorities;
    const result = await rpc<any>("uav.write", { slug, collection, manifest, descriptionText: description, dryRun: false });
    const nextCollection = result.collection || collection;
    const nextManifest = result.manifest || manifest;
    setAuthorities(nextAuthorities);
    setCollection(nextCollection);
    setManifest(nextManifest);
    setBaseline(snapshot(nextCollection, nextManifest, description, nextAuthorities));
    setFolder((current) => current ? { ...current, collection: nextCollection, manifest: nextManifest, descriptionText: description, authorities: nextAuthorities } : current);
  }

  function revert() {
    if (!baseline) return;
    const saved = JSON.parse(baseline);
    setCollection(saved.collection);
    setManifest(saved.manifest);
    setDescription(saved.description);
    setAuthorities(saved.authorities);
  }

  useGuardSource(
    dirty ? {
      id: `uav:${slug}`,
      isDirty: () => true,
      title: "Unsaved UAV collection changes",
      message: `"${slug}" has UAV metadata, authority, credit, or inventory changes that have not been saved.`,
      commitLabel: "Save",
      discardLabel: "Discard",
      commit: persist,
      discard: revert,
    } : null,
    [dirty, slug, collection, manifest, description, authorities, baseline],
  );

  function requestBack() {
    if (!dirty) { onBack(); return; }
    setConfirmState({
      title: "Discard unsaved UAV changes?",
      body: <p className="muted" style={{ margin: 0 }}>Collection metadata, authority, credit, series, or file changes will be lost.</p>,
      confirmLabel: "Discard",
      danger: true,
      onConfirm: () => { revert(); onBack(); },
    });
  }

  async function save(dryRun = false) {
    setBusy(true);
    try {
      if (dryRun) {
        const result = await rpc<any>("uav.write", { slug, collection, manifest, descriptionText: description, dryRun: true });
        setMarcXml(result.marcXml || "");
        notify("ok", "UAV dry run passed.");
      } else {
        await persist();
        notify("ok", `Saved ${slug}.`);
      }
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runPreflight() {
    setBusy(true);
    try {
      if (dirty) await persist();
      const [preflightResult, previewResult] = await Promise.all([
        rpc("uav.preflight", { slug }),
        rpc("uav.write", { slug, collection, manifest, descriptionText: description, dryRun: true }),
      ]);
      const result = payloadOf<PreflightResult>(preflightResult);
      setMarcXml((previewResult as any).marcXml || "");
      setPreflight(result);
      notify(result.ok ? "ok" : "err", result.ok ? "UAV preflight passed." : "UAV preflight found blockers.");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      const result = await rpc<any>("uav.publish", { slug, collection, manifest, descriptionText: description });
      const nextCollection = result.collection || collection;
      const nextManifest = result.manifest || manifest;
      setCollection(nextCollection);
      setManifest(nextManifest);
      setPreflight(result.preflight || null);
      setBaseline(snapshot(nextCollection, nextManifest, description, authorities));
      notify("ok", `Published UAV outputs for ${slug}.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!folder || !collection || !manifest) return <div className="empty"><div className="spinner" /></div>;

  const site = authorities.sites.find((row) => row.id === collection.siteAuthorityId);
  const primarySubject = authorities.subjects.find((row) => row.code === collection.identity.primarySubjectCode);
  const localChecks = [
    { id: "identity", label: "Collection identifier", ok: /^DR\.[A-Z][a-z]{2}\. [A-Z][a-z] \d{4} T[1-9]\d*$/.test(collection.lookupRaw) },
    { id: "authority", label: "Subject and site authorities", ok: Boolean(site && primarySubject) },
    { id: "series", label: "Capture series", ok: collection.series.length > 0 },
    { id: "files", label: "Deliverable groups", ok: collection.series.every((series: any) => manifest.groups.find((row: any) => row.seriesId === series.id)?.buckets?.some((bucket: any) => bucket.bucket === series.captureClass)) },
    { id: "license", label: "License and attribution", ok: Boolean(collection.license && collection.attribution) },
    { id: "description", label: "Description", ok: Boolean(description.trim()) },
  ];
  const readyCount = localChecks.filter((row) => row.ok).length;

  return (
    <div className="stack uav-editor">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={requestBack}><ArrowLeft className="icon" /> Back</button>
        {dirty ? <span className="chip chip-warn">Unsaved</span> : null}
        <div className="uav-editor-heading">
          <span className="uav-eyebrow">dexDRONES / {site?.name || "Unresolved site"}</span>
          <strong>{collection.title}</strong>
          <code>{collection.lookupRaw}</code>
        </div>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(true)}>Dry run</button>
        <button className={`btn btn-sm ${dirty ? "btn-primary" : ""}`} disabled={busy || !dirty} onClick={() => save(false)}>Save</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setConfirmState({
          title: `Publish ${collection.lookupRaw}?`,
          body: <p className="muted" style={{ margin: 0 }}>Regenerates the UAV detail page, collection MARCXML, aggregate data, and catalog linkage. It does not deploy the site.</p>,
          confirmLabel: "Publish outputs",
          danger: preflight?.ok !== true,
          onConfirm: publish,
        })}>Publish outputs</button>
      </div>

      <div className="panel entry-readiness">
        <div className="entry-readiness-head">
          <div className="panel-title" style={{ margin: 0 }}>Readiness</div>
          <span className={`entry-readiness-score ${readyCount === localChecks.length ? "is-ready" : ""}`}>{readyCount}/{localChecks.length} ready</span>
          <span className="grow" />
          <button className="btn btn-sm" disabled={busy} onClick={runPreflight}><ShieldCheck className="icon" /> {busy ? "Running…" : "Save & run preflight"}</button>
        </div>
        <div className="entry-readiness-grid">
          {localChecks.map((row) => <div className={`entry-check ${row.ok ? "is-ready" : "is-todo"}`} key={row.id}>{row.ok ? <CheckCircle2 className="icon" /> : <AlertTriangle className="icon" />}<span>{row.label}</span></div>)}
        </div>
        {preflight ? (
          <div className="entry-preflight">
            <div className={`entry-preflight-head ${preflight.ok ? "is-ready" : "is-blocked"}`}>{preflight.ok ? <CheckCircle2 className="icon" /> : <AlertTriangle className="icon" />} Preflight {preflight.ok ? "passed" : "has blockers"}</div>
            {(preflight.checks || []).map((check) => <div key={check.id} className={`ws-line ${check.ok ? "is-ready" : "is-blocked"}`}><span>{check.ok ? "✓" : "×"}</span><span>{check.detail || check.id}</span></div>)}
          </div>
        ) : null}
      </div>

      <details className="panel uav-marc-persistent">
        <summary>
          <div>
            <span className="uav-eyebrow">Persistent output</span>
            <strong>Collection-level MARCXML</strong>
            <small>{preflight?.checks?.find((row) => row.id === "marcxml_schema")?.detail || "Run preflight or dry run to validate and preview."}</small>
          </div>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={(event) => { event.preventDefault(); save(true); }}>Refresh</button>
          <ChevronDown className="icon uav-marc-chevron" />
        </summary>
        {marcXml ? <pre className="uav-marc-preview">{marcXml}</pre> : <div className="empty">No preview loaded yet.</div>}
      </details>

      <div className="seg entry-tabs">
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "downloads" ? "on" : ""} onClick={() => setTab("downloads")}>Downloads &amp; files</button>
        <button className={tab === "credits" ? "on" : ""} onClick={() => setTab("credits")}>Credits</button>
        <button className={tab === "metadata" ? "on" : ""} onClick={() => setTab("metadata")}>Metadata</button>
      </div>

      <div className="dx-entry-grid">
        <div className="stack">
          {tab === "overview" ? (
            <>
              <CollectionOverview
                collection={collection}
                description={description}
                onDescriptionChange={setDescription}
                onChange={updateCollection}
                onIdentityChange={(mutator) => updateCollection(mutator, true)}
              />
              <CaptureSeriesEditor
                collection={collection}
                manifest={manifest}
                authorities={authorities}
                onChange={(nextCollection, nextManifest) => {
                  const refreshed = refreshIdentifiers(nextCollection, nextManifest, authorities);
                  setCollection(refreshed.collection);
                  setManifest(refreshed.manifest);
                  setPreflight(null);
                }}
                notify={notify}
              />
            </>
          ) : null}

          {tab === "downloads" ? (
            <UavDownloadsEditor collection={collection} manifest={manifest} onChange={updateManifest} onCollectionChange={updateCollection} notify={notify} />
          ) : null}

          {tab === "credits" ? (
            <UavCreditsEditor collection={collection} onChange={updateCollection} />
          ) : null}

          {tab === "metadata" ? (
            <>
              <AuthorityRegistryEditor
                authorities={authorities}
                collection={collection}
                onAuthoritiesChange={(next) => { setAuthorities(next); setPreflight(null); }}
                onCollectionChange={(mutator) => updateCollection(mutator, true)}
                notify={notify}
              />
              <UavTechnicalMetadataEditor collection={collection} onChange={updateCollection} />
            </>
          ) : null}
        </div>

        <UavSidebarPreview
          collection={collection}
          manifest={manifest}
          authorities={authorities}
          readyCount={readyCount}
          readyTotal={localChecks.length}
          marcReady={preflight?.checks?.find((row) => row.id === "marcxml_schema")?.ok === true}
        />
      </div>

      {busy ? <DexLoader phase="Working" detail="validating typed UAV outputs" /> : null}
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function CollectionOverview({
  collection,
  description,
  onDescriptionChange,
  onChange,
  onIdentityChange,
}: {
  collection: any;
  description: string;
  onDescriptionChange: (value: string) => void;
  onChange: (mutator: (draft: any) => void) => void;
  onIdentityChange: (mutator: (draft: any) => void) => void;
}) {
  return (
    <>
      <div className="panel">
        <div className="panel-title">{collection.title}</div>
        <div className="card-sub" style={{ marginBottom: 12 }}>{collection.slug}</div>
        <div className="field-row">
          <div className="field"><label>Title</label><input value={collection.title} onChange={(event) => onChange((draft) => { draft.title = event.target.value; })} /></div>
          <div className="field"><label>Status</label><select value={collection.status} onChange={(event) => onChange((draft) => { draft.status = event.target.value; })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></div>
        </div>
        <div className="field">
          <label>Catalog image</label>
          <div className="entry-artwork">
            <div className="entry-artwork-thumb">{collection.imageSrc ? <img src={resolveImageUrl(collection.imageSrc)} alt="" /> : <span className="entry-card-thumb-empty"><ImageOff className="icon" /></span>}</div>
            <div className="entry-artwork-side"><input value={collection.imageSrc || ""} onChange={(event) => onChange((draft) => { draft.imageSrc = event.target.value; })} placeholder="/assets/catalog/… or https://…" /><span className="field-hint">Stored directly on the UAV collection and projected into the shared catalog card.</span></div>
          </div>
        </div>
        <div className="field"><label>Description</label><textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} style={{ minHeight: 170 }} /></div>
      </div>
      <div className="panel">
        <div className="panel-title">Overview</div>
        <div className="field"><label>Collection lookup</label><input value={collection.lookupRaw} readOnly /><div className="field-hint">Derived from the primary subject code, site Cutter, year, and tour.</div></div>
        <div className="field-row">
          <div className="field"><label>Year</label><input type="number" min="2000" max="2100" value={collection.identity.year} onChange={(event) => onIdentityChange((draft) => { draft.identity.year = Number(event.target.value); })} /></div>
          <div className="field"><label>Tour</label><input value={collection.identity.tour} onChange={(event) => onIdentityChange((draft) => { draft.identity.tour = event.target.value.toUpperCase(); })} /></div>
          <div className="field"><label>Captured from</label><input type="date" value={collection.capturedFrom || ""} onChange={(event) => onChange((draft) => { draft.capturedFrom = event.target.value || undefined; })} /></div>
          <div className="field"><label>Captured to</label><input type="date" value={collection.capturedTo || ""} onChange={(event) => onChange((draft) => { draft.capturedTo = event.target.value || undefined; })} /></div>
        </div>
        <div className="field"><label>Preview URL</label><input value={collection.previewUrl || ""} onChange={(event) => onChange((draft) => { draft.previewUrl = event.target.value; })} /></div>
      </div>
    </>
  );
}

function CaptureSeriesEditor({
  collection,
  manifest,
  authorities,
  onChange,
  notify,
}: {
  collection: any;
  manifest: any;
  authorities: UavAuthorities;
  onChange: (collection: any, manifest: any) => void;
  notify: (kind: "ok" | "err", message: string) => void;
}) {
  function updateSeries(id: string, mutator: (series: any) => void) {
    const nextCollection = structuredClone(collection);
    const nextManifest = structuredClone(manifest);
    const series = nextCollection.series.find((row: any) => row.id === id);
    const group = nextManifest.groups.find((row: any) => row.seriesId === id);
    if (!series || !group) return;
    const previousClass = series.captureClass;
    mutator(series);
    if (previousClass !== series.captureClass) {
      if (group.buckets.some((bucket: any) => bucket.files?.length)) {
        notify("err", "Remove or move series files before changing its capture class.");
        return;
      }
      group.captureClass = series.captureClass;
      const raw = group.buckets.find((row: any) => row.bucket === "X") || { bucket: "X", folderId: "", files: [] };
      group.buckets = [{ bucket: series.captureClass, folderId: "", files: [] }, raw];
    }
    onChange(nextCollection, nextManifest);
  }

  function addSeries() {
    const nextCollection = structuredClone(collection);
    const nextManifest = structuredClone(manifest);
    let index = nextCollection.series.length + 1;
    let id = `v-rgb-${index}`;
    while (nextCollection.series.some((row: any) => row.id === id)) { index += 1; id = `v-rgb-${index}`; }
    nextCollection.series.push({ id, title: "Aerial video — Visible light", captureClass: "V", spectrum: "RGB", lookupRaw: "", lookupNorm: "", technical: {}, folders: {} });
    nextManifest.groups.push({ seriesId: id, seriesLookup: "", captureClass: "V", buckets: [{ bucket: "V", folderId: "", files: [] }, { bucket: "X", folderId: "", files: [] }] });
    const refreshed = refreshIdentifiers(nextCollection, nextManifest, authorities);
    onChange(refreshed.collection, refreshed.manifest);
  }

  function removeSeries(id: string) {
    const group = manifest.groups.find((row: any) => row.seriesId === id);
    if (group?.buckets?.some((bucket: any) => bucket.files?.length)) {
      notify("err", "A series with assigned files cannot be removed.");
      return;
    }
    const nextCollection = structuredClone(collection);
    const nextManifest = structuredClone(manifest);
    nextCollection.series = nextCollection.series.filter((row: any) => row.id !== id);
    nextManifest.groups = nextManifest.groups.filter((row: any) => row.seriesId !== id);
    onChange(nextCollection, nextManifest);
  }

  return (
    <div className="panel">
      <div className="inline">
        <div><div className="panel-title">Capture series</div><p className="muted" style={{ margin: 0 }}>Each series creates one matching deliverable bucket and one optional X raw/support bucket.</p></div>
        <span className="grow" />
        <button className="btn btn-primary btn-sm" onClick={addSeries}><Plus className="icon" /> Add series</button>
      </div>
      <div className="uav-series-stack">
        {collection.series.map((series: any) => (
          <section className="uav-series-editor" key={series.id}>
            <div className="inline"><code>{series.lookupRaw}</code><span className="grow" /><button className="btn btn-ghost btn-sm" onClick={() => removeSeries(series.id)}><Trash2 className="icon" /> Remove</button></div>
            <div className="field-row">
              <div className="field"><label>Series title</label><input value={series.title} onChange={(event) => updateSeries(series.id, (draft) => { draft.title = event.target.value; })} /></div>
              <div className="field"><label>Capture class</label><select value={series.captureClass} onChange={(event) => updateSeries(series.id, (draft) => { draft.captureClass = event.target.value; if (draft.captureClass === "A") delete draft.spectrum; else draft.spectrum ||= "RGB"; })}>{Object.entries(CAPTURE_CLASSES).map(([id, label]) => <option value={id} key={id}>{id} · {label}</option>)}</select></div>
              {series.captureClass !== "A" ? <div className="field"><label>Acquisition spectrum</label><select value={series.spectrum || "RGB"} onChange={(event) => updateSeries(series.id, (draft) => { draft.spectrum = event.target.value; })}>{Object.entries(SPECTRA).map(([id, label]) => <option value={id} key={id}>{id} · {label}</option>)}</select></div> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function UavDownloadsEditor({
  collection,
  manifest,
  onChange,
  onCollectionChange,
  notify,
}: {
  collection: any;
  manifest: any;
  onChange: (mutator: (draft: any) => void) => void;
  onCollectionChange: (mutator: (draft: any) => void) => void;
  notify: (kind: "ok" | "err", message: string) => void;
}) {
  const [seriesId, setSeriesId] = useState(collection.series[0]?.id || "");
  const [activeBucket, setActiveBucket] = useState("");
  const [folderInput, setFolderInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const recordingIndex = collection.recordingIndex || {};
  function setRecordingIndex(key: "sourceUrl" | "pdfRef" | "bundleRef", value: string) {
    onCollectionChange((draft) => {
      draft.recordingIndex = { sourceUrl: "", pdfRef: "", bundleRef: "", ...(draft.recordingIndex || {}), [key]: value };
    });
  }
  const xRecordingPdf = manifest.groups
    .flatMap((g: any) => g.buckets || [])
    .flatMap((b: any) => b.files || [])
    .find((file: UavFile) => !file.missing && file.role === "recording_index_pdf");
  const series = collection.series.find((row: any) => row.id === seriesId) || collection.series[0];
  const group = manifest.groups.find((row: any) => row.seriesId === series?.id);
  const buckets = group?.buckets || [];
  const bucket = buckets.find((row: any) => row.bucket === activeBucket);
  const totalFiles = buckets.reduce((sum: number, row: any) => sum + (row.files?.filter((file: UavFile) => !file.missing).length || 0), 0);
  const totalBytes = buckets.reduce((sum: number, row: any) => sum + (row.files || []).filter((file: UavFile) => !file.missing).reduce((fileSum: number, file: UavFile) => fileSum + Number(file.sizeBytes || 0), 0), 0);

  useEffect(() => {
    if (!series && collection.series[0]) setSeriesId(collection.series[0].id);
  }, [collection.series, series]);

  function openBucket(code: string) {
    const next = activeBucket === code ? "" : code;
    setActiveBucket(next);
    const target = buckets.find((row: any) => row.bucket === next);
    setFolderInput(target?.folderId || "");
  }

  async function scanBucket() {
    if (!series || !bucket || !folderInput.trim()) return;
    setScanning(true);
    try {
      const result = payloadOf<any>(await rpc("uav.scanBucket", {
        folderId: folderInput,
        seriesLookup: series.lookupRaw,
        bucket: bucket.bucket,
        existingFiles: bucket.files || [],
      }));
      onChange((draft) => {
        const target = draft.groups.find((row: any) => row.seriesId === series.id).buckets.find((row: any) => row.bucket === bucket.bucket);
        target.folderId = result.folderId;
        target.scannedAt = result.scannedAt;
        target.files = result.files;
      });
      setFolderInput(result.folderId || folderInput);
      notify("ok", `Bucket ${bucket.bucket}: reconciled ${result.count} Drive file${result.count === 1 ? "" : "s"}${result.humanSize ? ` (${result.humanSize})` : ""}.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setScanning(false);
    }
  }

  function clearFolder() {
    if (!series || !bucket) return;
    onChange((draft) => {
      const target = draft.groups.find((row: any) => row.seriesId === series.id).buckets.find((row: any) => row.bucket === bucket.bucket);
      target.folderId = "";
      delete target.scannedAt;
    });
    setFolderInput("");
  }

  function updateFile(driveFileId: string, mutator: (file: any) => void) {
    if (!series || !bucket) return;
    onChange((draft) => {
      const file = draft.groups.find((row: any) => row.seriesId === series.id)
        .buckets.find((row: any) => row.bucket === bucket.bucket)
        .files.find((row: any) => row.driveFileId === driveFileId);
      if (file) mutator(file);
    });
  }

  return (
    <>
    <div className="panel">
      <div className="panel-title">Recording index</div>
      <p className="muted" style={{ marginTop: 0 }}>Collection-level recording-index references, mirroring the entry downloads flow. The PDF ref drives the “Recording index PDF” download on the published detail page.</p>
      <div className="field">
        <label>Recording index source URL</label>
        <input
          value={recordingIndex.sourceUrl || ""}
          onChange={(event) => setRecordingIndex("sourceUrl", event.target.value)}
          placeholder="https://docs.google.com/spreadsheets/…"
        />
        <div className="field-hint">Authoring source sheet — stored on the collection, not shown publicly.</div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Recording index PDF ref</label>
          <input
            value={recordingIndex.pdfRef || ""}
            onChange={(event) => setRecordingIndex("pdfRef", event.target.value)}
            placeholder="asset:… or lookup:…"
          />
          <div className="field-hint">
            {/^(asset|lookup):/i.test(String(recordingIndex.pdfRef || "").trim())
              ? "Resolves the published Recording index PDF download."
              : xRecordingPdf
              ? `Empty — falls back to X-bucket file ${xRecordingPdf.bucketNumber}.`
              : "Empty and no X-bucket recording_index_pdf file — the PDF button stays disabled."}
          </div>
        </div>
        <div className="field">
          <label>Recording index bundle ref</label>
          <input
            value={recordingIndex.bundleRef || ""}
            onChange={(event) => setRecordingIndex("bundleRef", event.target.value)}
            placeholder="bundle:…"
          />
          <div className="field-hint">
            {/^bundle:/i.test(String(recordingIndex.bundleRef || "").trim())
              ? "“Get files” downloads this curated bundle directly."
              : "Empty — “Get files” assembles the bundle from scanned bucket files."}
          </div>
        </div>
      </div>
    </div>
    <div className="panel">
      <div className="inline">
        <div>
          <div className="panel-title">Downloads &amp; files</div>
          <p className="muted" style={{ margin: 0 }}>{totalFiles} present files · {humanBytes(totalBytes)} · counters stay independent per bucket.</p>
        </div>
        <span className="grow" />
        <select value={series?.id || ""} onChange={(event) => { setSeriesId(event.target.value); setActiveBucket(""); setFolderInput(""); }}>
          {collection.series.map((row: any) => <option key={row.id} value={row.id}>{row.captureClass}{row.spectrum ? `/${row.spectrum}` : ""} · {row.title}</option>)}
        </select>
      </div>
      {series ? (
        <>
          <div className="field">
            <label>Buckets &amp; Drive folders</label>
            <div className="bucket-row">
              {buckets.map((row: any) => {
                const present = (row.files || []).filter((file: UavFile) => !file.missing).length;
                const configured = Boolean(row.folderId);
                return (
                  <button
                    key={row.bucket}
                    className={`bucket ${configured || present ? "on" : ""} ${activeBucket === row.bucket ? "is-active" : ""}`}
                    onClick={() => openBucket(row.bucket)}
                    title={row.bucket === "X" ? "Raw and support files, including recording-index PDFs" : `${series.captureClass} deliverables only`}
                  >
                    {row.bucket}
                    {configured ? <span className="bucket-dot" /> : null}
                    {present ? <span className="bucket-count">{present}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          {bucket ? (
            <div className="bucket-config">
              <div className="bucket-config-head">
                <strong>Bucket {bucket.bucket} · {bucket.bucket === "X" ? "raw + support" : CAPTURE_CLASSES[series.captureClass as CaptureClass]}</strong>
                {bucket.folderId ? <a className="bucket-drive-link" href={`https://drive.google.com/drive/folders/${encodeURIComponent(bucket.folderId)}`} target="_blank" rel="noreferrer">Open in Drive ↗</a> : null}
                <span className="grow" />
                {bucket.folderId ? <button className="btn btn-ghost btn-sm" onClick={clearFolder}>Clear folder</button> : null}
              </div>
              <div className="inline">
                <input value={folderInput} onChange={(event) => setFolderInput(event.target.value)} placeholder="Google Drive folder URL or id" style={{ flex: 1 }} />
                <button className="btn btn-primary btn-sm" disabled={scanning || !folderInput.trim()} onClick={scanBucket}>{scanning ? "Scanning…" : "Scan folder"}</button>
              </div>
              {scanning ? <DexLoader phase="Scanning" detail={`${bucket.bucket} on Drive`} /> : null}
              {bucket.scannedAt ? <div className="muted" style={{ fontSize: 12 }}>Last reconciled {new Date(bucket.scannedAt).toLocaleString()}. Existing numbers stay frozen by Drive file ID; missing files remain tombstoned.</div> : null}
              <div className="uav-file-table">
                {(bucket.files || []).map((file: UavFile) => (
                  <div className={`uav-file-row ${file.missing ? "is-missing" : ""}`} key={file.driveFileId}>
                    <code>{file.bucketNumber}</code>
                    <div><strong>{file.originalName}</strong><span>{file.mime} · {humanBytes(file.sizeBytes)}</span></div>
                    <span className={`entry-status ${file.missing ? "entry-status-error" : "entry-status-published"}`}>{file.missing ? "Missing" : file.role.replaceAll("_", " ")}</span>
                    {bucket.bucket === "X" ? (
                      <select value={file.role} onChange={(event) => updateFile(file.driveFileId, (draft) => { draft.role = event.target.value; })}><option value="raw">Raw</option><option value="support">Support</option><option value="recording_index_pdf">Recording-index PDF</option></select>
                    ) : (
                      <input value={(file.sourceXItems || []).join(", ")} onChange={(event) => updateFile(file.driveFileId, (draft) => { draft.sourceXItems = event.target.value.split(",").map((row) => row.trim()).filter(Boolean); })} placeholder="Optional source X lookup(s)" />
                    )}
                    <input value={(file.qualifiers || []).join(", ")} onChange={(event) => updateFile(file.driveFileId, (draft) => { draft.qualifiers = event.target.value.split(",").map((row) => row.trim()).filter(Boolean); })} placeholder="[6K], [60fps], [NDVI], [Stab]" />
                  </div>
                ))}
                {!bucket.files?.length ? <p className="muted">No stable file identities yet. Scan the folder to assign natural-order numbers.</p> : null}
              </div>
            </div>
          ) : <div className="empty">Select the deliverable or X bucket to configure its Drive folder.</div>}
        </>
      ) : <div className="empty">Add a capture series in Overview first.</div>}
    </div>
    </>
  );
}

function UavCreditsEditor({ collection, onChange }: { collection: any; onChange: (mutator: (draft: any) => void) => void }) {
  const links = collection.creditLinks && typeof collection.creditLinks === "object" ? collection.creditLinks : {};
  function setLinks(next: CreditLinksByPerson) {
    onChange((draft) => { draft.creditLinks = next; });
  }
  return (
    <div className="panel">
      <div className="panel-title">Credits</div>
      <p className="muted">Click any credit chip to attach one or more websites, social profiles, or portfolio links.</p>
      <div className="field-row">
        <div className="field"><label>UAV operators</label><LinkedCreditInput value={collection.operators || []} linksByPerson={links} onValueChange={(value) => onChange((draft) => { draft.operators = value; })} onLinksChange={setLinks} placeholder="Add operator…" /></div>
        <div className="field"><label>Contributors</label><LinkedCreditInput value={collection.contributors || []} linksByPerson={links} onValueChange={(value) => onChange((draft) => { draft.contributors = value; })} onLinksChange={setLinks} placeholder="Add contributor…" /></div>
      </div>
      <div className="field"><label>Attribution sentence</label><textarea value={collection.attribution || ""} onChange={(event) => onChange((draft) => { draft.attribution = event.target.value; })} style={{ minHeight: 90 }} /></div>
      <div className="field"><label>License</label><input value={collection.license || ""} onChange={(event) => onChange((draft) => { draft.license = event.target.value; })} /></div>
    </div>
  );
}

function UavTechnicalMetadataEditor({
  collection,
  onChange,
}: {
  collection: any;
  onChange: (mutator: (draft: any) => void) => void;
}) {
  function updateSeries(id: string, key: string, value: unknown) {
    onChange((draft) => {
      const series = draft.series.find((row: any) => row.id === id);
      if (!series) return;
      series.technical ||= {};
      if (value === "" || value == null) delete series.technical[key];
      else series.technical[key] = value;
    });
  }
  return (
    <div className="panel">
      <div className="panel-title">Equipment, sensor &amp; flight metadata</div>
      <p className="muted">Structured per capture series; this data stays in UAV JSON and contributes to collection-level MARC summaries where applicable.</p>
      <div className="uav-series-stack">
        {collection.series.map((series: any) => (
          <section className="uav-series-editor" key={series.id}>
            <div className="inline"><strong>{series.title}</strong><span className="grow" /><code>{series.lookupRaw}</code></div>
            <div className="field-row">
              <div className="field"><label>Platform</label><input value={series.technical?.platform || ""} onChange={(event) => updateSeries(series.id, "platform", event.target.value)} placeholder="UAV" /></div>
              <div className="field"><label>Aircraft</label><input value={series.technical?.aircraft || ""} onChange={(event) => updateSeries(series.id, "aircraft", event.target.value)} /></div>
              <div className="field"><label>Camera</label><input value={series.technical?.camera || ""} onChange={(event) => updateSeries(series.id, "camera", event.target.value)} /></div>
              <div className="field"><label>Sensor</label><input value={series.technical?.sensor || ""} onChange={(event) => updateSeries(series.id, "sensor", event.target.value)} /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Lens</label><input value={series.technical?.lens || ""} onChange={(event) => updateSeries(series.id, "lens", event.target.value)} /></div>
              <div className="field"><label>Filter</label><input value={series.technical?.filter || ""} onChange={(event) => updateSeries(series.id, "filter", event.target.value)} /></div>
              <div className="field"><label>Altitude</label><input value={series.technical?.altitude || ""} onChange={(event) => updateSeries(series.id, "altitude", event.target.value)} placeholder="120 m AGL" /></div>
              <div className="field"><label>Camera attitude</label><select value={series.technical?.attitude || ""} onChange={(event) => updateSeries(series.id, "attitude", event.target.value)}><option value="">—</option><option value="vertical">Vertical</option><option value="low-oblique">Low oblique</option><option value="high-oblique">High oblique</option><option value="mixed">Mixed</option><option value="unknown">Unknown</option></select></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Cloud cover (%)</label><input type="number" min="0" max="100" value={series.technical?.cloudCover ?? ""} onChange={(event) => updateSeries(series.id, "cloudCover", event.target.value === "" ? "" : Number(event.target.value))} /></div>
              <div className="field"><label>Technical notes</label><textarea value={series.technical?.notes || ""} onChange={(event) => updateSeries(series.id, "notes", event.target.value)} /></div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AuthorityRegistryEditor({
  authorities,
  collection,
  onAuthoritiesChange,
  onCollectionChange,
  notify,
}: {
  authorities: UavAuthorities;
  collection: any;
  onAuthoritiesChange: (next: UavAuthorities) => void;
  onCollectionChange: (mutator: (draft: any) => void) => void;
  notify: (kind: "ok" | "err", message: string) => void;
}) {
  const [subjectId, setSubjectId] = useState(authorities.subjects[0]?.id || "");
  const [siteId, setSiteId] = useState(collection.siteAuthorityId || authorities.sites[0]?.id || "");
  const [privateCoordinates, setPrivateCoordinates] = useState({ lat: "", lon: "" });
  const subject = authorities.subjects.find((row) => row.id === subjectId) || authorities.subjects[0];
  const site = authorities.sites.find((row) => row.id === siteId) || authorities.sites[0];

  function updateSubject(mutator: (draft: any) => void) {
    if (!subject) return;
    const next = structuredClone(authorities);
    const target = next.subjects.find((row) => row.id === subject.id);
    if (target) mutator(target);
    onAuthoritiesChange(next);
  }

  function updateSite(mutator: (draft: any) => void) {
    if (!site) return;
    const next = structuredClone(authorities);
    const target = next.sites.find((row) => row.id === site.id);
    if (target) mutator(target);
    onAuthoritiesChange(next);
  }

  async function savePrivateCoordinates() {
    if (!site) return;
    try {
      await rpc("uav.site.private.set", { siteId: site.id, lat: Number(privateCoordinates.lat), lon: Number(privateCoordinates.lon) });
      notify("ok", "Exact coordinates saved to ~/.config/dexdsl/uav-sites.private.json.");
      setPrivateCoordinates({ lat: "", lon: "" });
    } catch (error) {
      notify("err", String(error));
    }
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="inline">
          <div><div className="panel-title">Authority registry</div><p className="muted" style={{ margin: 0 }}>Reusable across every future UAV collection. Codes and Cutters are frozen after registration; labels, source snapshots, administrative context, and coordinate policy remain configurable.</p></div>
          <span className="grow" />
          <span className="chip">{authorities.subjects.length} subjects</span>
          <span className="chip">{authorities.sites.length} sites</span>
        </div>
        <div className="uav-registry-columns">
          <section>
            <div className="uav-registry-head"><strong>Subjects</strong><span>Primary LCSH plus searchable terms</span></div>
            <div className="uav-registry-list">
              {authorities.subjects.map((row) => (
                <button key={row.id} className={subject?.id === row.id ? "is-active" : ""} onClick={() => setSubjectId(row.id)}>
                  <code>{row.code}</code><span><strong>{row.label}</strong><small>{row.authority.source.toUpperCase()} · {row.authority.uri}</small></span>
                  {collection.identity.primarySubjectCode === row.code ? <em>Primary</em> : (collection.subjectAuthorityIds || []).includes(row.id) ? <em>Selected</em> : null}
                </button>
              ))}
            </div>
          </section>
          <section>
            <div className="uav-registry-head"><strong>Sites</strong><span>LCNAF → GeoNames → local</span></div>
            <div className="uav-registry-list">
              {authorities.sites.map((row) => (
                <button key={row.id} className={site?.id === row.id ? "is-active" : ""} onClick={() => setSiteId(row.id)}>
                  <code>{row.cutter}</code><span><strong>{row.name}</strong><small>{row.authority.source.toUpperCase()} · {row.coordinateVisibility}</small></span>
                  {collection.siteAuthorityId === row.id ? <em>Current</em> : null}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {subject ? (
        <div className="panel">
          <div className="inline"><div className="panel-title" style={{ margin: 0 }}>Configure subject · {subject.code}</div><span className="grow" /><button className="btn btn-sm" disabled={collection.identity.primarySubjectCode === subject.code} onClick={() => onCollectionChange((draft) => { draft.identity.primarySubjectCode = subject.code; draft.subjectAuthorityIds = Array.from(new Set([subject.id, ...(draft.subjectAuthorityIds || [])])); })}>Make primary</button><button className="btn btn-ghost btn-sm" onClick={() => onCollectionChange((draft) => { const ids = new Set(draft.subjectAuthorityIds || []); if (ids.has(subject.id) && draft.identity.primarySubjectCode !== subject.code) ids.delete(subject.id); else ids.add(subject.id); draft.subjectAuthorityIds = Array.from(ids); })}>{(collection.subjectAuthorityIds || []).includes(subject.id) ? "Remove from collection" : "Add to collection"}</button></div>
          <div className="field-row">
            <div className="field"><label>Frozen local code</label><input value={subject.code} readOnly /></div>
            <div className="field"><label>Display label</label><input value={subject.label} onChange={(event) => updateSubject((draft) => { draft.label = event.target.value; })} /></div>
            <div className="field"><label>Authority source</label><input value="LCSH" readOnly /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Authority label snapshot</label><input value={subject.authority.label} onChange={(event) => updateSubject((draft) => { draft.authority.label = event.target.value; })} /></div>
            <div className="field"><label>Stable authority URI</label><input value={subject.authority.uri} onChange={(event) => updateSubject((draft) => { draft.authority.uri = event.target.value; })} /></div>
          </div>
        </div>
      ) : null}

      {site ? (
        <div className="panel">
          <div className="inline"><div className="panel-title" style={{ margin: 0 }}>Configure site · {site.cutter}</div><span className="grow" /><button className="btn btn-sm" disabled={collection.siteAuthorityId === site.id} onClick={() => onCollectionChange((draft) => { draft.siteAuthorityId = site.id; })}>Use for collection</button></div>
          <div className="field-row">
            <div className="field"><label>Frozen site Cutter</label><input value={site.cutter} readOnly /></div>
            <div className="field"><label>Site name</label><input value={site.name} onChange={(event) => updateSite((draft) => { draft.name = event.target.value; })} /></div>
            <div className="field"><label>Administrative area</label><input value={site.admin || ""} onChange={(event) => updateSite((draft) => { draft.admin = event.target.value; })} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Authority source</label><select value={site.authority.source} onChange={(event) => updateSite((draft) => { draft.authority.source = event.target.value; })}><option value="lcnaf">LCNAF</option><option value="geonames">GeoNames</option><option value="local">Local</option></select></div>
            <div className="field"><label>Authority label snapshot</label><input value={site.authority.label} onChange={(event) => updateSite((draft) => { draft.authority.label = event.target.value; })} /></div>
            <div className="field"><label>Stable authority URI</label><input value={site.authority.uri} onChange={(event) => updateSite((draft) => { draft.authority.uri = event.target.value; })} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Public coordinate policy</label><select value={site.coordinateVisibility} onChange={(event) => updateSite((draft) => { draft.coordinateVisibility = event.target.value; if (draft.coordinateVisibility === "hidden") delete draft.publicCoordinates; })}><option value="rounded">Rounded</option><option value="hidden">Hidden</option><option value="exact">Exact/public</option></select></div>
            <div className="field"><label>Public latitude</label><input type="number" step="any" disabled={site.coordinateVisibility === "hidden"} value={site.publicCoordinates?.lat ?? ""} onChange={(event) => updateSite((draft) => { draft.publicCoordinates ||= { lat: 0, lon: 0, precision: 2 }; draft.publicCoordinates.lat = Number(event.target.value); })} /></div>
            <div className="field"><label>Public longitude</label><input type="number" step="any" disabled={site.coordinateVisibility === "hidden"} value={site.publicCoordinates?.lon ?? ""} onChange={(event) => updateSite((draft) => { draft.publicCoordinates ||= { lat: 0, lon: 0, precision: 2 }; draft.publicCoordinates.lon = Number(event.target.value); })} /></div>
            <div className="field"><label>Precision</label><input type="number" min="0" max="6" disabled={site.coordinateVisibility === "hidden"} value={site.publicCoordinates?.precision ?? 2} onChange={(event) => updateSite((draft) => { draft.publicCoordinates ||= { lat: 0, lon: 0, precision: 2 }; draft.publicCoordinates.precision = Number(event.target.value); })} /></div>
          </div>
          <div className="uav-private-coordinate">
            <div><strong>Exact private coordinates</strong><span>Stored outside the repo. Build projection applies the public policy above.</span></div>
            <input value={privateCoordinates.lat} onChange={(event) => setPrivateCoordinates((current) => ({ ...current, lat: event.target.value }))} placeholder="Exact latitude" />
            <input value={privateCoordinates.lon} onChange={(event) => setPrivateCoordinates((current) => ({ ...current, lon: event.target.value }))} placeholder="Exact longitude" />
            <button className="btn btn-sm" disabled={!privateCoordinates.lat || !privateCoordinates.lon} onClick={savePrivateCoordinates}>Save privately</button>
          </div>
        </div>
      ) : null}

      <LocAuthoritySearch
        authorities={authorities}
        onAuthoritiesChange={onAuthoritiesChange}
        onCollectionChange={onCollectionChange}
        onSubjectCreated={(id) => setSubjectId(id)}
        onSiteCreated={(id) => setSiteId(id)}
        notify={notify}
      />
    </div>
  );
}

function LocAuthoritySearch({
  authorities,
  onAuthoritiesChange,
  onCollectionChange,
  onSubjectCreated,
  onSiteCreated,
  notify,
}: {
  authorities: UavAuthorities;
  onAuthoritiesChange: (next: UavAuthorities) => void;
  onCollectionChange: (mutator: (draft: any) => void) => void;
  onSubjectCreated: (id: string) => void;
  onSiteCreated: (id: string) => void;
  notify: (kind: "ok" | "err", message: string) => void;
}) {
  const [kind, setKind] = useState<"subject" | "site">("subject");
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [admin, setAdmin] = useState("");
  const [visibility, setVisibility] = useState<"exact" | "rounded" | "hidden">("rounded");
  const [results, setResults] = useState<Array<{ source: "lcsh" | "lcnaf"; label: string; uri: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [fallbackSource, setFallbackSource] = useState<"geonames" | "local">("geonames");
  const [fallbackUri, setFallbackUri] = useState("");

  async function search() {
    setSearching(true);
    try {
      const result = await rpc<any>("uav.authority.search", { query, kind });
      setResults(result.results || []);
      if (!result.results?.length) notify("err", "No Library of Congress matches. Use the fallback site authority form when appropriate.");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSearching(false);
    }
  }

  function register(result: { source: UavAuthorityRef["source"]; label: string; uri: string }) {
    const frozenCode = code.trim();
    if (kind === "subject" && !/^[A-Z][a-z]{2}$/.test(frozenCode)) {
      notify("err", "Subject code must be three Title-case letters, for example Win.");
      return;
    }
    if (kind === "site" && !/^[A-Z][a-z]$/.test(frozenCode)) {
      notify("err", "Site Cutter must be two Title-case letters, for example Mo.");
      return;
    }
    const next = structuredClone(authorities);
    const id = authorityId(kind, result.label, result.uri);
    if (kind === "subject") {
      if (next.subjects.some((row) => row.code === frozenCode)) {
        notify("err", `Subject code ${frozenCode} is already registered.`);
        return;
      }
      next.subjects.push({ id, code: frozenCode, label: result.label, authority: result, additionalAuthorities: [] });
      onAuthoritiesChange(next);
      onCollectionChange((draft) => {
        draft.identity.primarySubjectCode = frozenCode;
        draft.subjectAuthorityIds = Array.from(new Set([id, ...(draft.subjectAuthorityIds || [])]));
      });
      onSubjectCreated(id);
    } else {
      if (next.sites.some((row) => row.cutter === frozenCode)) {
        notify("err", `Site Cutter ${frozenCode} is already registered.`);
        return;
      }
      next.sites.push({ id, name: result.label, cutter: frozenCode, admin, authority: result, coordinateVisibility: visibility });
      onAuthoritiesChange(next);
      onCollectionChange((draft) => { draft.siteAuthorityId = id; draft.identity.siteCutter = frozenCode; });
      onSiteCreated(id);
    }
    setResults([]);
    setQuery("");
    setCode("");
    notify("ok", `Registered ${result.label}. Save the collection to persist it for future collections.`);
  }

  function registerFallbackSite() {
    const label = query.trim();
    const uri = fallbackSource === "local" && !fallbackUri.trim()
      ? `https://dexdsl.org/authorities/sites/${slugify(label)}`
      : fallbackUri.trim();
    if (!label) {
      notify("err", "Enter the site authority label.");
      return;
    }
    try {
      new URL(uri);
    } catch {
      notify("err", "GeoNames and local authority records require a stable URI.");
      return;
    }
    register({ source: fallbackSource, label, uri });
  }

  return (
    <div className="panel uav-loc-search">
      <div className="inline">
        <div>
          <p className="uav-eyebrow">Reusable authority intake</p>
          <div className="panel-title">Search Library of Congress linked data</div>
          <p className="muted" style={{ margin: 0 }}>Search first, inspect the returned label and URI, then assign the frozen local code used by UAV identifiers.</p>
        </div>
        <span className="grow" />
        <span className="chip">LOC live · registry works offline</span>
      </div>
      <div className="field-row">
        <div className="field"><label>Authority type</label><select value={kind} onChange={(event) => { setKind(event.target.value as "subject" | "site"); setResults([]); setCode(""); }}><option value="subject">LCSH subject</option><option value="site">LCNAF geographic name</option></select></div>
        <div className="field"><label>{kind === "subject" ? "Frozen 3-letter code" : "Frozen 2-letter Cutter"}</label><input value={code} onChange={(event) => setCode(event.target.value)} placeholder={kind === "subject" ? "Win" : "Mo"} /><span className="field-hint">Unique and immutable after registration.</span></div>
        {kind === "site" ? <div className="field"><label>Coordinate policy</label><select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="rounded">Rounded (default 2 decimals)</option><option value="hidden">Hidden</option><option value="exact">Exact/public</option></select></div> : null}
      </div>
      {kind === "site" ? <div className="field"><label>Administrative area</label><input value={admin} onChange={(event) => setAdmin(event.target.value)} placeholder="California, United States" /></div> : null}
      <div className="uav-loc-query">
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) search(); }} placeholder={kind === "subject" ? "Wind power plants" : "Mojave Desert"} />
        <button className="btn btn-primary" disabled={searching || !query.trim()} onClick={search}><Radar className="icon" /> {searching ? "Searching…" : "Search LOC"}</button>
      </div>
      {results.length ? (
        <div className="uav-authority-results">
          {results.map((row) => (
            <button key={row.uri} onClick={() => register(row)}>
              <strong>{row.label}</strong><span>{row.uri}</span><em>Register {kind === "subject" ? code || "code" : code || "Cutter"} →</em>
            </button>
          ))}
        </div>
      ) : <div className="uav-search-empty"><Radar className="icon" /><span>Results will show authoritative labels and persistent id.loc.gov URIs here.</span></div>}
      {kind === "site" ? (
        <div className="uav-authority-fallback">
          <strong>No LCNAF record?</strong>
          <p className="muted">Register a GeoNames authority or documented local record without leaving this workflow.</p>
          <div className="field-row">
            <div className="field"><label>Fallback source</label><select value={fallbackSource} onChange={(event) => setFallbackSource(event.target.value as typeof fallbackSource)}><option value="geonames">GeoNames</option><option value="local">Local authority</option></select></div>
            <div className="field"><label>Stable URI</label><input value={fallbackUri} onChange={(event) => setFallbackUri(event.target.value)} placeholder={fallbackSource === "geonames" ? "https://www.geonames.org/…" : "Optional; generated under dexdsl.org"} /></div>
            <button className="btn btn-sm uav-coordinate-save" disabled={!query.trim() || !code.trim()} onClick={registerFallbackSite}>Register fallback</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UavSidebarPreview({
  collection,
  manifest,
  authorities,
  readyCount,
  readyTotal,
  marcReady,
}: {
  collection: any;
  manifest: any;
  authorities: UavAuthorities;
  readyCount: number;
  readyTotal: number;
  marcReady: boolean;
}) {
  const site = authorities.sites.find((row) => row.id === collection.siteAuthorityId);
  const subjects = collection.subjectAuthorityIds.map((id: string) => authorities.subjects.find((row) => row.id === id)).filter(Boolean);
  const creditLinks: CreditLinksByPerson = collection.creditLinks || {};
  const credit = (name: string) => {
    const links = (creditLinks[name] || []).filter((row) => row.href);
    return links.length ? <a href={links[0].href} target="_blank" rel="noreferrer">{name} ↗{links.length > 1 ? ` +${links.length - 1}` : ""}</a> : name;
  };
  return (
    <aside className="dx-sidebar-preview uav-sidebar-preview" aria-label="UAV sidebar preview">
      <section className="dx-sbp-section"><div className="dx-sbp-title">Overview</div><div className="dx-sbp-entry-title">{collection.title || "Untitled"}</div><div className="dx-sbp-lookup">#{collection.lookupRaw}</div></section>
      <section className="dx-sbp-section">
        <div className="dx-sbp-title">Collection</div>
        <div className="dx-sbp-grid"><span className="dx-sbp-key">Site</span><span className="dx-sbp-value">{site?.name || "—"}</span><span className="dx-sbp-key">Subjects</span><span className="dx-sbp-value">{subjects.map((row: any) => row.label).join(", ") || "—"}</span><span className="dx-sbp-key">Capture</span><span className="dx-sbp-value">{[collection.capturedFrom, collection.capturedTo].filter(Boolean).join(" – ") || collection.identity.year}</span></div>
      </section>
      <section className="dx-sbp-section">
        <div className="dx-sbp-title">Capture series</div>
        {collection.series.map((series: any) => {
          const group = manifest.groups.find((row: any) => row.seriesId === series.id);
          return <div className="uav-sbp-series" key={series.id}><code>{series.captureClass}{series.spectrum ? `/${series.spectrum}` : ""}</code><span>{series.title}</span><div className="dx-sbp-buckets">{(group?.buckets || []).map((bucket: any) => <span className={`dx-sbp-bucket ${bucket.folderId || bucket.files?.length ? "on" : ""}`} key={bucket.bucket}>{bucket.bucket}{bucket.files?.length ? <span className="dx-sbp-count">{bucket.files.length}</span> : null}</span>)}</div></div>;
        })}
      </section>
      <section className="dx-sbp-section"><div className="dx-sbp-title">License</div><span className="dx-sbp-badge">{collection.license || "—"}</span><div className="dx-sbp-attr">{collection.attribution || "—"}</div></section>
      <section className="dx-sbp-section"><div className="dx-sbp-title">Credits</div><div className="dx-sbp-grid"><span className="dx-sbp-key">Operators</span><span className="dx-sbp-value">{collection.operators?.length ? collection.operators.map((name: string, index: number) => <span key={name}>{index ? ", " : ""}{credit(name)}</span>) : "—"}</span><span className="dx-sbp-key">Contributors</span><span className="dx-sbp-value">{collection.contributors?.length ? collection.contributors.map((name: string, index: number) => <span key={name}>{index ? ", " : ""}{credit(name)}</span>) : "—"}</span></div></section>
      <section className="dx-sbp-section"><div className="dx-sbp-title">Outputs</div><div className="dx-sbp-buckets"><span className={`dx-sbp-bucket ${readyCount === readyTotal ? "on" : ""}`}>{readyCount}/{readyTotal} ready</span><span className={`dx-sbp-bucket ${marcReady ? "on" : ""}`}>MARCXML</span></div></section>
    </aside>
  );
}
