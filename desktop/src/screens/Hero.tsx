import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  Blocks,
  Copy,
  LayoutPanelLeft,
  Monitor,
  Plus,
  Rocket,
  Save,
  Smartphone,
} from "lucide-react";
import { rpc } from "../api";
import { useStore } from "../store";
import { useGuardSource } from "../guard";
import { TokenInput } from "../components/TokenInput";
import type {
  HeroCampaignModule,
  HeroComposition,
  HeroFeaturedModule,
  HeroLibrary,
  HeroModule,
  HeroPromoModule,
  HeroWorkspace,
} from "../domain";

type StudioView = "compositions" | "modules";
type PreviewSize = "desktop" | "mobile";

const isoNow = () => new Date().toISOString();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function idFrom(label: string, existing: Set<string>): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hero";
  let id = base;
  let suffix = 2;
  while (existing.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function defaultModule(type: HeroModule["type"], existing: Set<string>): HeroModule {
  const now = isoNow();
  if (type === "featured") {
    return {
      id: idFrom("featured-entries", existing),
      name: "Featured entries",
      type,
      title: "FEATURED ENTRIES",
      source: "home-featured",
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
  }
  if (type === "promo") {
    return {
      id: idFrom("full-width-promo", existing),
      name: "Full-width promo",
      type,
      eyebrow: "PROGRAM / CAMPAIGN",
      headline: "A public-facing headline.",
      body: "Add the concise campaign description here.",
      values: [
        { title: "Open access", text: "Describe the first concrete benefit." },
        { title: "Built to last", text: "Describe the second concrete benefit." },
      ],
      stats: [{ value: "100+", label: "proof point" }],
      sponsor: null,
      ctas: [{ kind: "link", label: "LEARN MORE →", href: "/about/" }],
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
  }
  return {
    id: idFrom("campaign", existing),
    name: "Campaign",
    type,
    headlineLines: ["THE OPEN-ACCESS", "RECORDING LIBRARY FOR"],
    rotatingWords: ["EVERYONE."],
    body: "Free and open recordings.",
    primaryCta: { kind: "link", label: "EXPLORE CATALOG", href: "/catalog/" },
    secondaryCta: {
      kind: "auth-switch",
      guestLabel: "SIGN UP FREE ↗",
      authenticatedLabel: "SUBMIT SAMPLES ↗",
      authenticatedHref: "/entry/submit/",
    },
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

function typeLabel(module: HeroModule): string {
  if (module.type === "campaign") return "Campaign";
  if (module.type === "featured") return "Featured";
  return "Promo";
}

export function HeroScreen() {
  const { notify } = useStore();
  const [workspace, setWorkspace] = useState<HeroWorkspace | null>(null);
  const [library, setLibrary] = useState<HeroLibrary | null>(null);
  const [savedLibrary, setSavedLibrary] = useState<HeroLibrary | null>(null);
  const [view, setView] = useState<StudioView>("compositions");
  const [compositionId, setCompositionId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [previewHtml, setPreviewHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "prepare" | null>(null);

  const dirty = useMemo(
    () => Boolean(library && savedLibrary && JSON.stringify(library) !== JSON.stringify(savedLibrary)),
    [library, savedLibrary],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await rpc<HeroWorkspace>("hero.read");
      setWorkspace(next);
      setLibrary(clone(next.library));
      setSavedLibrary(clone(next.library));
      setCompositionId((current) => current && next.library.compositions.some((item) => item.id === current)
        ? current
        : next.library.activeCompositionId);
      setModuleId((current) => current && next.library.modules.some((item) => item.id === current)
        ? current
        : next.library.modules.find((item) => !item.archived)?.id || "");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const saveLibrary = useCallback(async () => {
    if (!library) return null;
    setBusy("save");
    try {
      const next = await rpc<HeroWorkspace>("hero.save", { library });
      setWorkspace(next);
      setLibrary(clone(next.library));
      setSavedLibrary(clone(next.library));
      notify("ok", "Hero library saved. Prepare it when it is ready for the next deploy.");
      return next.library;
    } catch (error) {
      notify("err", String(error));
      throw error;
    } finally {
      setBusy(null);
    }
  }, [library, notify]);

  useGuardSource(library && savedLibrary ? {
    id: "hero-library",
    isDirty: () => dirty,
    title: "Unsaved hero composition changes",
    message: "Save the structured hero library or discard the editor changes before leaving.",
    commitLabel: "Save library",
    discardLabel: "Discard edits",
    commit: async () => { await saveLibrary(); },
    discard: () => setLibrary(clone(savedLibrary)),
  } : null, [dirty, library, savedLibrary, saveLibrary]);

  const previewPayload = useMemo(() => {
    if (!library) return null;
    if (view === "compositions") return { library, compositionId };
    const selected = library.modules.find((item) => item.id === moduleId);
    if (!selected || selected.archived) return null;
    const now = isoNow();
    const previewComposition: HeroComposition = {
      id: "module-preview",
      name: "Module preview",
      layout: "single",
      slots: [selected.id],
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    return {
      library: {
        ...library,
        activeCompositionId: previewComposition.id,
        compositions: [...library.compositions.filter((item) => item.id !== previewComposition.id), previewComposition],
      },
      compositionId: previewComposition.id,
    };
  }, [library, view, compositionId, moduleId]);

  useEffect(() => {
    if (!previewPayload) {
      setPreviewHtml("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      rpc<{ html: string }>("hero.preview", previewPayload)
        .then((result) => { if (!cancelled) setPreviewHtml(result.html); })
        .catch((error) => { if (!cancelled) setPreviewHtml(`<p style="font-family:monospace;padding:20px">Preview unavailable: ${String(error)}</p>`); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [previewPayload]);

  function updateLibrary(mutator: (draft: HeroLibrary) => void) {
    setLibrary((current) => {
      if (!current) return current;
      const draft = clone(current);
      mutator(draft);
      draft.updatedAt = isoNow();
      return draft;
    });
  }

  function patchComposition(patch: Partial<HeroComposition>) {
    updateLibrary((draft) => {
      const index = draft.compositions.findIndex((item) => item.id === compositionId);
      if (index < 0) return;
      draft.compositions[index] = { ...draft.compositions[index], ...patch, updatedAt: isoNow() };
    });
  }

  function patchModule(patch: Partial<HeroModule>) {
    updateLibrary((draft) => {
      const index = draft.modules.findIndex((item) => item.id === moduleId);
      if (index < 0) return;
      draft.modules[index] = { ...draft.modules[index], ...patch, updatedAt: isoNow() } as HeroModule;
    });
  }

  function createComposition() {
    if (!library) return;
    const ids = new Set(library.compositions.map((item) => item.id));
    const modules = library.modules.filter((item) => !item.archived);
    if (!modules.length) return notify("err", "Create a module before creating a composition.");
    const now = isoNow();
    const split = modules.length > 1;
    const composition: HeroComposition = {
      id: idFrom("new-composition", ids),
      name: "New composition",
      layout: split ? "split" : "single",
      slots: modules.slice(0, split ? 2 : 1).map((item) => item.id),
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    updateLibrary((draft) => { draft.compositions.push(composition); });
    setCompositionId(composition.id);
  }

  function duplicateComposition() {
    const source = library?.compositions.find((item) => item.id === compositionId);
    if (!source || !library) return;
    const now = isoNow();
    const copy: HeroComposition = {
      ...clone(source),
      id: idFrom(`${source.id}-copy`, new Set(library.compositions.map((item) => item.id))),
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    updateLibrary((draft) => { draft.compositions.push(copy); });
    setCompositionId(copy.id);
  }

  function createModule(type: HeroModule["type"]) {
    if (!library) return;
    const module = defaultModule(type, new Set(library.modules.map((item) => item.id)));
    updateLibrary((draft) => { draft.modules.push(module); });
    setModuleId(module.id);
    setView("modules");
  }

  function duplicateModule() {
    const source = library?.modules.find((item) => item.id === moduleId);
    if (!source || !library) return;
    const now = isoNow();
    const copy: HeroModule = {
      ...clone(source),
      id: idFrom(`${source.id}-copy`, new Set(library.modules.map((item) => item.id))),
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    updateLibrary((draft) => { draft.modules.push(copy); });
    setModuleId(copy.id);
  }

  function archiveSelectedModule() {
    if (!library) return;
    const usedBy = library.compositions.filter((item) => !item.archived && item.slots.includes(moduleId));
    if (usedBy.length) {
      notify("err", `Used by ${usedBy.map((item) => item.name).join(", ")}. Reassign those slots first.`);
      return;
    }
    patchModule({ archived: true });
  }

  async function prepare() {
    if (!library || !compositionId) return;
    setBusy("prepare");
    try {
      if (dirty) await rpc("hero.save", { library });
      const next = await rpc<HeroWorkspace>("hero.prepare", { compositionId });
      setWorkspace(next);
      setLibrary(clone(next.library));
      setSavedLibrary(clone(next.library));
      notify("ok", `${next.library.compositions.find((item) => item.id === compositionId)?.name || compositionId} is prepared in the worktree.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  if (loading || !library || !workspace) {
    return <div className="hero-studio-loading"><div className="spinner" /> Loading hero library…</div>;
  }

  const selectedComposition = library.compositions.find((item) => item.id === compositionId) || null;
  const selectedModule = library.modules.find((item) => item.id === moduleId) || null;
  const activeName = library.compositions.find((item) => item.id === library.activeCompositionId)?.name || library.activeCompositionId;

  return (
    <div className="hero-studio">
      <div className="hero-studio-toolbar">
        <div className="seg">
          <button className={view === "compositions" ? "on" : ""} onClick={() => setView("compositions")}><LayoutPanelLeft className="icon" /> Compositions</button>
          <button className={view === "modules" ? "on" : ""} onClick={() => setView("modules")}><Blocks className="icon" /> Modules</button>
        </div>
        <span className={`ws-status-pill ${dirty ? "tone-active" : workspace.prepared ? "tone-positive" : "tone-neutral"}`}>
          {dirty ? "Unsaved edits" : workspace.prepared ? "Prepared" : "Needs preparation"}
        </span>
        <span className="muted hero-active-label">Next deploy: {activeName}</span>
        <span className="grow" />
        <button className="btn btn-sm" disabled={!dirty || busy !== null} onClick={() => void saveLibrary()}><Save className="icon" /> {busy === "save" ? "Saving…" : "Save library"}</button>
        <button className="btn btn-primary btn-sm" disabled={!selectedComposition || selectedComposition.archived || busy !== null} onClick={() => void prepare()}>
          <Rocket className="icon" /> {busy === "prepare" ? "Preparing…" : "Prepare for next deploy"}
        </button>
      </div>

      <div className="hero-studio-grid">
        <aside className="hero-library panel">
          <div className="hero-library-head">
            <strong>{view === "compositions" ? "Saved compositions" : "Reusable modules"}</strong>
            {view === "compositions" ? (
              <button className="icon-btn" title="New composition" onClick={createComposition}><Plus className="icon" /></button>
            ) : null}
          </div>
          {view === "modules" ? (
            <div className="hero-new-module">
              <button onClick={() => createModule("campaign")}>+ Campaign</button>
              <button onClick={() => createModule("featured")}>+ Featured</button>
              <button onClick={() => createModule("promo")}>+ Promo</button>
            </div>
          ) : null}
          <div className="hero-library-list">
            {(view === "compositions" ? library.compositions : library.modules).map((item) => {
              const selected = view === "compositions" ? item.id === compositionId : item.id === moduleId;
              const active = view === "compositions" && item.id === library.activeCompositionId;
              const detail = "layout" in item ? `${item.layout} · ${item.slots.length} module${item.slots.length === 1 ? "" : "s"}` : typeLabel(item);
              return (
                <button
                  key={item.id}
                  className={`hero-library-item ${selected ? "is-selected" : ""} ${item.archived ? "is-archived" : ""}`}
                  onClick={() => view === "compositions" ? setCompositionId(item.id) : setModuleId(item.id)}
                >
                  <span><strong>{item.name}</strong><small>{detail}</small></span>
                  {active ? <span className="chip chip-accent">next</span> : item.archived ? <span className="chip">archived</span> : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="hero-preview panel">
          <div className="hero-preview-head">
            <strong>Preview</strong>
            <span className="muted">Same renderer as the homepage</span>
            <span className="grow" />
            <div className="seg seg-sm">
              <button className={previewSize === "desktop" ? "on" : ""} onClick={() => setPreviewSize("desktop")}><Monitor className="icon" /> Desktop</button>
              <button className={previewSize === "mobile" ? "on" : ""} onClick={() => setPreviewSize("mobile")}><Smartphone className="icon" /> Mobile</button>
            </div>
          </div>
          <div className={`hero-preview-canvas is-${previewSize}`}>
            {previewHtml ? <iframe title="Hero composition preview" sandbox="allow-scripts" srcDoc={previewHtml} /> : <div className="spinner" />}
          </div>
        </section>

        <aside className="hero-inspector panel">
          {view === "compositions" && selectedComposition ? (
            <CompositionEditor
              composition={selectedComposition}
              modules={library.modules.filter((item) => !item.archived)}
              onPatch={patchComposition}
              onDuplicate={duplicateComposition}
              onArchive={() => {
                if (selectedComposition.id === library.activeCompositionId) notify("err", "Prepare another composition before archiving this one.");
                else patchComposition({ archived: !selectedComposition.archived });
              }}
            />
          ) : null}
          {view === "modules" && selectedModule ? (
            <ModuleEditor
              module={selectedModule}
              onPatch={patchModule}
              onDuplicate={duplicateModule}
              onArchive={archiveSelectedModule}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CompositionEditor({
  composition,
  modules,
  onPatch,
  onDuplicate,
  onArchive,
}: {
  composition: HeroComposition;
  modules: HeroModule[];
  onPatch: (patch: Partial<HeroComposition>) => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  function changeLayout(layout: HeroComposition["layout"]) {
    const count = layout === "split" ? 2 : 1;
    const available = modules.map((item) => item.id);
    const slots = [...composition.slots];
    while (slots.length < count) {
      const next = available.find((id) => !slots.includes(id));
      if (!next) break;
      slots.push(next);
    }
    onPatch({ layout, slots: slots.slice(0, count) });
  }
  function setSlot(index: number, moduleId: string) {
    const slots = [...composition.slots];
    if (slots.some((id, slot) => slot !== index && id === moduleId)) return;
    slots[index] = moduleId;
    onPatch({ slots });
  }
  return (
    <div className="stack">
      <div className="hero-inspector-title"><div><span className="muted">Composition</span><strong>{composition.name}</strong></div></div>
      <label className="ws-field"><span>Name</span><input className="ws-input" value={composition.name} onChange={(event) => onPatch({ name: event.target.value })} /></label>
      <div className="ws-field"><span>Layout</span>
        <div className="seg">
          <button className={composition.layout === "single" ? "on" : ""} onClick={() => changeLayout("single")}>One pane</button>
          <button className={composition.layout === "split" ? "on" : ""} disabled={modules.length < 2} onClick={() => changeLayout("split")}>Two pane</button>
        </div>
      </div>
      {composition.slots.map((slot, index) => (
        <label className="ws-field" key={`${composition.id}-${index}`}><span>Pane {index + 1}</span>
          <select value={slot} onChange={(event) => setSlot(index, event.target.value)}>
            {modules.map((module) => <option key={module.id} value={module.id} disabled={composition.slots.some((id, slotIndex) => slotIndex !== index && id === module.id)}>{module.name} · {typeLabel(module)}</option>)}
          </select>
        </label>
      ))}
      {composition.layout === "split" ? (
        <button className="btn btn-sm" onClick={() => onPatch({ slots: [...composition.slots].reverse() })}><ArrowLeftRight className="icon" /> Swap panes</button>
      ) : null}
      <div className="hero-inspector-actions">
        <button className="btn btn-sm" onClick={onDuplicate}><Copy className="icon" /> Duplicate</button>
        <button className="btn btn-sm btn-ghost" onClick={onArchive}><Archive className="icon" /> {composition.archived ? "Restore" : "Archive"}</button>
      </div>
      <code className="hero-id">{composition.id}</code>
    </div>
  );
}

function ModuleEditor({
  module,
  onPatch,
  onDuplicate,
  onArchive,
}: {
  module: HeroModule;
  onPatch: (patch: Partial<HeroModule>) => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="stack">
      <div className="hero-inspector-title"><div><span className="muted">{typeLabel(module)} module</span><strong>{module.name}</strong></div></div>
      <label className="ws-field"><span>Name</span><input className="ws-input" value={module.name} onChange={(event) => onPatch({ name: event.target.value })} /></label>
      {module.type === "campaign" ? <CampaignFields module={module} onPatch={onPatch} /> : null}
      {module.type === "featured" ? <FeaturedFields module={module} onPatch={onPatch} /> : null}
      {module.type === "promo" ? <PromoFields module={module} onPatch={onPatch} /> : null}
      <div className="hero-inspector-actions">
        <button className="btn btn-sm" onClick={onDuplicate}><Copy className="icon" /> Duplicate</button>
        <button className="btn btn-sm btn-ghost" onClick={onArchive}><Archive className="icon" /> Archive</button>
      </div>
      <code className="hero-id">{module.id}</code>
    </div>
  );
}

function CampaignFields({ module, onPatch }: { module: HeroCampaignModule; onPatch: (patch: Partial<HeroModule>) => void }) {
  return (
    <>
      <label className="ws-field"><span>Headline lines</span><textarea className="ws-input hero-textarea" value={module.headlineLines.join("\n")} onChange={(event) => onPatch({ headlineLines: event.target.value.split("\n").filter(Boolean) } as Partial<HeroCampaignModule>)} /></label>
      <div className="ws-field"><span>Rotating words</span><TokenInput value={module.rotatingWords} onChange={(rotatingWords) => onPatch({ rotatingWords } as Partial<HeroCampaignModule>)} placeholder="Add a word…" /></div>
      <label className="ws-field"><span>Body</span><textarea className="ws-input hero-textarea" value={module.body} onChange={(event) => onPatch({ body: event.target.value } as Partial<HeroCampaignModule>)} /></label>
      <div className="hero-field-pair">
        <label className="ws-field"><span>Primary label</span><input className="ws-input" value={module.primaryCta.label} onChange={(event) => onPatch({ primaryCta: { ...module.primaryCta, label: event.target.value } } as Partial<HeroCampaignModule>)} /></label>
        <label className="ws-field"><span>Primary link</span><input className="ws-input" value={module.primaryCta.href} onChange={(event) => onPatch({ primaryCta: { ...module.primaryCta, href: event.target.value } } as Partial<HeroCampaignModule>)} /></label>
      </div>
      {module.secondaryCta.kind === "auth-switch" ? (
        <>
          <div className="hero-field-pair">
            <label className="ws-field"><span>Guest CTA</span><input className="ws-input" value={module.secondaryCta.guestLabel} onChange={(event) => onPatch({ secondaryCta: { ...module.secondaryCta, guestLabel: event.target.value } } as Partial<HeroCampaignModule>)} /></label>
            <label className="ws-field"><span>Member CTA</span><input className="ws-input" value={module.secondaryCta.authenticatedLabel} onChange={(event) => onPatch({ secondaryCta: { ...module.secondaryCta, authenticatedLabel: event.target.value } } as Partial<HeroCampaignModule>)} /></label>
          </div>
          <label className="ws-field"><span>Member link</span><input className="ws-input" value={module.secondaryCta.authenticatedHref} onChange={(event) => onPatch({ secondaryCta: { ...module.secondaryCta, authenticatedHref: event.target.value } } as Partial<HeroCampaignModule>)} /></label>
        </>
      ) : null}
    </>
  );
}

function FeaturedFields({ module, onPatch }: { module: HeroFeaturedModule; onPatch: (patch: Partial<HeroModule>) => void }) {
  return (
    <>
      <label className="ws-field"><span>Heading</span><input className="ws-input" value={module.title} onChange={(event) => onPatch({ title: event.target.value } as Partial<HeroFeaturedModule>)} /></label>
      <div className="hero-info-callout">The ordered lineup remains managed by the existing Home Featured workflow. This module controls placement only and reads <code>home.featured.snapshot.json</code>.</div>
    </>
  );
}

function parsePairs(value: string, left: string, right: string) {
  return value.split("\n").map((line) => {
    const [a, ...rest] = line.split("|");
    return { [left]: a.trim(), [right]: rest.join("|").trim() };
  }).filter((item) => String(item[left as keyof typeof item] || "") && String(item[right as keyof typeof item] || ""));
}

function PromoFields({ module, onPatch }: { module: HeroPromoModule; onPatch: (patch: Partial<HeroModule>) => void }) {
  return (
    <>
      <label className="ws-field"><span>Eyebrow</span><input className="ws-input" value={module.eyebrow} onChange={(event) => onPatch({ eyebrow: event.target.value } as Partial<HeroPromoModule>)} /></label>
      <label className="ws-field"><span>Headline</span><textarea className="ws-input hero-textarea" value={module.headline} onChange={(event) => onPatch({ headline: event.target.value } as Partial<HeroPromoModule>)} /></label>
      <label className="ws-field"><span>Body</span><textarea className="ws-input hero-textarea" value={module.body} onChange={(event) => onPatch({ body: event.target.value } as Partial<HeroPromoModule>)} /></label>
      <label className="ws-field"><span>Value rows · title | text</span><textarea className="ws-input hero-textarea is-tall" value={module.values.map((item) => `${item.title} | ${item.text}`).join("\n")} onChange={(event) => onPatch({ values: parsePairs(event.target.value, "title", "text") } as Partial<HeroPromoModule>)} /></label>
      <label className="ws-field"><span>Stats · value | label</span><textarea className="ws-input hero-textarea" value={module.stats.map((item) => `${item.value} | ${item.label}`).join("\n")} onChange={(event) => onPatch({ stats: parsePairs(event.target.value, "value", "label") } as Partial<HeroPromoModule>)} /></label>
      <label className="ws-field"><span>Primary CTA label</span><input className="ws-input" value={module.ctas[0]?.label || ""} onChange={(event) => onPatch({ ctas: [{ ...(module.ctas[0] || { kind: "link", href: "/about/" }), label: event.target.value }, ...module.ctas.slice(1)] } as Partial<HeroPromoModule>)} /></label>
      <label className="ws-field"><span>Primary CTA link</span><input className="ws-input" value={module.ctas[0]?.href || ""} onChange={(event) => onPatch({ ctas: [{ ...(module.ctas[0] || { kind: "link", label: "LEARN MORE" }), href: event.target.value }, ...module.ctas.slice(1)] } as Partial<HeroPromoModule>)} /></label>
    </>
  );
}
