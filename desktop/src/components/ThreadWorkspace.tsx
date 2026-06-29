import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { payloadOf, rpc } from "../api";
import type { EntryListItem } from "../domain";
import { useStore } from "../store";
import {
  ASSIGNEES,
  BOARD_STAGES,
  DEFAULT_STAGE_NOTE,
  PRIORITIES,
  STAGE_LABELS,
  bestSubmissionName,
  buildSubmissionLookup,
  parseLookupParts,
  stageTone,
  type SubmissionStage,
  type ThreadCard,
  type ThreadWorkflow,
} from "../submissions";

type StatusChip = {
  toStage: SubmissionStage;
  label: string;
  allowed: boolean;
  blockers: Array<{ code: string; message: string }>;
  suggestedPublicNote: string;
};
import { DexLoader } from "./DexLoader";

const REPLY_TEMPLATES = [
  { label: "Acknowledge", body: "Thanks for your submission. The Dex team confirmed it is ready for editorial review, and we’ll post the next update here." },
  { label: "Need files", body: "We need updated source files before we can continue. Please review the request below and reply here when they are ready." },
  { label: "Accepted", body: "Congratulations — your submission has been accepted for the Dex library. We’ll now prepare its entry and files; it is not public yet." },
  { label: "Revisions", body: "We need a revision before making a final decision. Please review the details below and reply here when it is ready." },
  { label: "Declined", body: "The Dex team is not moving this submission into the library at this time. Thank you for sharing the work with us." },
];

type ThreadDetail = {
  thread: any;
  timeline: any[];
  workflow: ThreadWorkflow;
};

type PreflightResult = {
  ok: boolean;
  slug: string;
  contentHash?: string;
  relevantPaths?: string[];
  checks?: Array<{ id: string; ok: boolean; detail: string }>;
  blockers?: Array<{ id?: string; detail?: string; message?: string }>;
};

type PublicationResult = {
  ok: boolean;
  code?: string;
  message?: string;
  commitSha?: string;
  relevantPaths?: string[];
  [key: string]: unknown;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeDetail(payload: any): ThreadDetail {
  const nested = payload?.thread?.thread ? payload.thread : null;
  return {
    thread: nested?.thread || payload?.thread || {},
    timeline: nested?.timeline || payload?.timeline || payload?.thread?.timeline || [],
    workflow: payload?.workflow || nested?.workflow || {
      workflowVersion: Number(payload?.thread?.workflowVersion || 0),
      currentStage: payload?.thread?.currentStage || "received",
      transitions: [],
      lookup: {},
      entryLink: {},
      preflight: {},
      publication: {},
    },
  };
}

export function ThreadWorkspace({
  card,
  requestedStage = null,
  onClose,
  onChanged,
}: {
  card: ThreadCard;
  requestedStage?: SubmissionStage | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { env, notify } = useStore();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");

  // Unified composer: one box drives both free messages and status updates.
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const [pendingStage, setPendingStage] = useState<SubmissionStage | null>(null);

  const [priority, setPriority] = useState(card.priority || "normal");
  const [assignee, setAssignee] = useState(card.assignee || "");
  const [assigneeCustom, setAssigneeCustom] = useState(false);

  const [lookup, setLookup] = useState(card.lookup || "");
  const [entrySlug, setEntrySlug] = useState(card.entrySlug || "");
  const [newSlug, setNewSlug] = useState(slugify(`${card.creator}-${card.title}`));
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [publication, setPublication] = useState<PublicationResult | null>(null);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [threadPayload, entryPayload] = await Promise.all([
        rpc("threads.get", { env, submissionId: card.submissionId }),
        rpc("entry.list"),
      ]);
      const next = normalizeDetail(payloadOf<any>(threadPayload));
      setDetail(next);
      setPriority(next.thread.priority || card.priority || "normal");
      setAssignee(next.thread.assignee || card.assignee || "");
      const finalLookup = next.workflow?.lookup?.final || next.thread.finalLookupNumber || next.thread.effectiveLookupNumber || card.lookup || "";
      // Prefill a sensible, canonical-format suggestion when nothing is set yet.
      setLookup(finalLookup || next.workflow?.lookup?.generated || buildSubmissionLookup({
        name: bestSubmissionName(next.thread, card.creator),
        category: next.thread.category || card.category,
        instrument: next.thread.instrument || card.instrument,
      }));
      setEntrySlug(next.workflow?.entryLink?.slug || next.thread.entrySlug || card.entrySlug || "");
      const rows = payloadOf<{ entries?: EntryListItem[] }>(entryPayload).entries || [];
      setEntries(rows);
      if (requestedStage) {
        const transition = next.workflow?.transitions?.find((item) => item.toStage === requestedStage);
        armStage(requestedStage, transition?.suggestedPublicNote || DEFAULT_STAGE_NOTE[requestedStage] || "");
      }
    } catch (error) {
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, card, requestedStage, notify]);

  useEffect(() => { void load(); }, [load]);

  const workflow = detail?.workflow;
  const thread = detail?.thread || card;
  const timeline = detail?.timeline || [];
  const version = Number(workflow?.workflowVersion ?? thread.workflowVersion ?? card.workflowVersion ?? 0);
  const currentStage = (workflow?.currentStage || thread.currentStage || thread.stage || card.stage) as SubmissionStage;
  const serverTransitions = useMemo(() => workflow?.transitions || [], [workflow?.transitions]);
  // Status chips are predefined (every stage except the current one). Server
  // transitions, when present, enrich a chip with allowed/blockers/suggested
  // copy; when absent we allow the move optimistically and let the API decide.
  const statusChips: StatusChip[] = useMemo(() => {
    return BOARD_STAGES.filter((stage) => stage !== currentStage).map((stage) => {
      const server = serverTransitions.find((item) => item.toStage === stage);
      return {
        toStage: stage,
        label: server?.label || STAGE_LABELS[stage] || stage,
        allowed: server ? server.allowed : true,
        blockers: server?.blockers || [],
        suggestedPublicNote: server?.suggestedPublicNote || DEFAULT_STAGE_NOTE[stage] || "",
      };
    });
  }, [serverTransitions, currentStage]);
  const selectedTransition = statusChips.find((item) => item.toStage === pendingStage);
  const selectedEntry = entries.find((entry) => entry.slug === entrySlug);
  const canProduce = currentStage === "producing";
  const lookupMatches = !!selectedEntry && selectedEntry.lookupNumber === lookup;
  const lookupPublishedAt = workflow?.lookup?.publishedAt;
  // Canonical-format suggestion derived from the submission's best name +
  // instrument/category; keeps the sequence/collection/year of any existing
  // lookup stable. Prefer a server-provided generated value when present.
  const generatedLookup = useMemo(() => {
    if (workflow?.lookup?.generated) return workflow.lookup.generated;
    const base = card.lookup || thread.finalLookupNumber || thread.effectiveLookupNumber || "";
    const parts = parseLookupParts(base);
    return buildSubmissionLookup({
      name: bestSubmissionName(thread, card.creator),
      category: thread.category || card.category,
      instrument: thread.instrument || card.instrument,
      collection: parts.collection,
      counter: parts.counter,
      year: parts.year,
    });
  }, [workflow?.lookup?.generated, thread, card]);

  function armStage(stage: SubmissionStage, note: string) {
    setPendingStage(stage);
    setVisibility("public");
    setComposer(note || "");
    // Bring the composer into view so the update is obviously the next step.
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      composerRef.current?.focus();
    });
  }

  function toggleStage(stage: SubmissionStage) {
    if (pendingStage === stage) {
      setPendingStage(null);
      return;
    }
    const chip = statusChips.find((item) => item.toStage === stage);
    armStage(stage, chip?.suggestedPublicNote || DEFAULT_STAGE_NOTE[stage] || "");
  }

  // Some deployments don't expose the workflow-engine /actions endpoint (it
  // 404s) and return no workflow.transitions. In that case we fall back to the
  // documented PATCH /admin/threads/:id (+ a public message) so status, lookup,
  // and entry links still work. The rich action path is preferred when present.
  async function runAction(
    action: Record<string, unknown>,
    success: string,
    fallback?: { patch?: Record<string, unknown>; publicNote?: string },
  ) {
    setBusy(String(action.action || "action"));
    try {
      let next: ThreadDetail;
      try {
        const response = await rpc("threads.action", { env, submissionId: card.submissionId, action });
        next = normalizeDetail(payloadOf<any>(response));
      } catch (error) {
        if (!fallback || !/404|not\s*found/i.test(String(error))) throw error;
        if (fallback.patch) {
          await rpc("threads.patch", { env, submissionId: card.submissionId, patch: fallback.patch });
        }
        if (fallback.publicNote) {
          await rpc("threads.message", { env, submissionId: card.submissionId, body: fallback.publicNote, visibility: "public" });
        }
        const response = await rpc("threads.get", { env, submissionId: card.submissionId });
        next = normalizeDetail(payloadOf<any>(response));
      }
      setDetail(next);
      notify("ok", success);
      onChanged();
      return next;
    } catch (error) {
      notify("err", String(error));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function publishTransition() {
    if (!pendingStage || !composer.trim()) return;
    const action: Record<string, unknown> = {
      action: "transition",
      toStage: pendingStage,
      publicNote: composer.trim(),
      expectedVersion: version,
    };
    if (pendingStage === "preflight") {
      if (!preflight?.ok) {
        notify("err", "Run and pass local preflight first.");
        return;
      }
      action.preflightEvidence = preflight;
    }
    if (pendingStage === "in_library") {
      if (!publication?.ok || !publication.commitSha) {
        notify("err", "Verify the pushed public entry first.");
        return;
      }
      action.publicationEvidence = publication;
      action.publicationCommitSha = publication.commitSha;
    }
    const label = STAGE_LABELS[pendingStage];
    const next = await runAction(action, `Published ${label}.`, {
      patch: { stage: pendingStage },
      publicNote: composer.trim(),
    });
    if (next) {
      setPendingStage(null);
      setComposer("");
      setPreflight(null);
      setPublication(null);
    }
  }

  async function sendMessage() {
    if (!composer.trim()) return;
    setBusy("message");
    try {
      await rpc("threads.message", { env, submissionId: card.submissionId, body: composer.trim(), visibility });
      notify("ok", visibility === "public" ? "Message sent to the member." : "Internal note saved.");
      setComposer("");
      await load();
      onChanged();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  function handleSend() {
    if (pendingStage) void publishTransition();
    else void sendMessage();
  }

  async function patchMeta(partial: { priority?: string; assignee?: string }) {
    const nextPriority = partial.priority ?? priority;
    const nextAssignee = partial.assignee ?? assignee;
    setPriority(nextPriority);
    setAssignee(nextAssignee);
    setBusy("meta");
    try {
      await rpc("threads.patch", { env, submissionId: card.submissionId, patch: { priority: nextPriority, assignee: nextAssignee } });
      onChanged();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  async function saveLookup(publish: boolean) {
    if (!lookup.trim()) return;
    const publicNote = publish
      ? `${lookup.trim()} is now the final reference for this submission and its library entry.`
      : undefined;
    const next = await runAction({
      action: "set_lookup",
      lookup: lookup.trim(),
      publish,
      publicNote,
      expectedVersion: version,
    }, publish ? "Final lookup published." : "Lookup saved privately.", {
      patch: { finalLookupNumber: lookup.trim() },
      publicNote,
    });
    if (next) {
      setPreflight(null);
      setPublication(null);
    }
  }

  async function linkEntry(slug = entrySlug) {
    if (!slug) return;
    const next = await runAction({
      action: "link_entry",
      entrySlug: slug,
      entryHref: `/entry/${slug}/`,
      expectedVersion: version,
    }, `Linked /entry/${slug}/.`, {
      patch: { entrySlug: slug, entryHref: `/entry/${slug}/` },
    });
    if (next) {
      setEntrySlug(slug);
      setPreflight(null);
      setPublication(null);
    }
  }

  async function createAndLink() {
    if (!canProduce || !newSlug) return;
    setBusy("create");
    try {
      await rpc("entry.create", {
        slug: newSlug,
        title: thread.title || card.title,
        lookupNumber: lookup,
        artist: thread.creator || card.creator,
        instruments: thread.instrument || card.instrument,
        buckets: ["A"],
        descriptionText: "",
        dryRun: false,
      });
      notify("ok", `Created local entry ${newSlug}.`);
      setEntrySlug(newSlug);
      const entryPayload = payloadOf<{ entries?: EntryListItem[] }>(await rpc("entry.list"));
      setEntries(entryPayload.entries || []);
      await linkEntry(newSlug);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  async function runPreflight() {
    if (!entrySlug || !lookup) return;
    setBusy("preflight");
    try {
      const result = payloadOf<PreflightResult>(await rpc("entry.preflight", { slug: entrySlug, expectedLookup: lookup }));
      setPreflight(result);
      notify(result.ok ? "ok" : "err", result.ok ? "Local preflight passed." : "Preflight has blockers.");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  async function verifyPublication() {
    if (!entrySlug || !lookup) return;
    setBusy("publication");
    try {
      const result = payloadOf<PublicationResult>(await rpc("entry.verifyPublished", {
        slug: entrySlug,
        expectedLookup: lookup,
        expectedTitle: thread.title || card.title,
        expectedContentHash: preflight?.contentHash,
        relevantPaths: preflight?.relevantPaths,
      }));
      setPublication(result);
      notify(result.ok ? "ok" : "err", result.ok ? "Public entry verified." : result.message || "Publication is not live yet.");
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  const assigneePredefined = ASSIGNEES as readonly string[];
  const showCustomAssignee = assigneeCustom || (!!assignee && !assigneePredefined.includes(assignee));

  return (
    <div className="dx-modal-overlay ws-overlay" onClick={() => !busy && onClose()}>
      <div className="dx-modal ws" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="ws-head">
          <div className="ws-head-copy">
            <div className="ws-kicker">Submission workspace</div>
            <h3 className="ws-title">{thread.title || card.title || card.lookup || card.submissionId}</h3>
            <div className="ws-sub">
              {(lookup || card.lookup) ? <span className="ws-mono">{lookup || card.lookup}</span> : null}
              {(thread.creator || card.creator) ? <span>{thread.creator || card.creator}</span> : null}
            </div>
          </div>
          <div className="ws-head-side">
            <span className={`ws-status-pill tone-${stageTone(currentStage)}`}>{STAGE_LABELS[currentStage] || currentStage}</span>
            <button className="ws-close" aria-label="Close" onClick={() => !busy && onClose()}><X className="icon" /></button>
          </div>
        </header>

        {loading && !detail ? (
          <div className="ws-body"><DexLoader phase="Loading" detail="submission workspace" /></div>
        ) : (
          <div className="ws-body">
            {/* STATUS — predefined, clickable chips */}
            <section className="ws-section">
              <div className="ws-section-head"><h4>Status</h4><span className="ws-hint">Pick the next milestone — write the member update below</span></div>
              <div className="status-chips">
                {statusChips.map((chip) => {
                  const active = pendingStage === chip.toStage;
                  return (
                    <button
                      key={chip.toStage}
                      className={`status-chip tone-${stageTone(chip.toStage)} ${active ? "is-active" : ""} ${chip.allowed ? "" : "is-blocked"}`}
                      disabled={!chip.allowed || !!busy}
                      title={chip.allowed ? chip.label : (chip.blockers?.[0]?.message || "Blocked")}
                      onClick={() => toggleStage(chip.toStage)}
                    >
                      {chip.label}
                      {!chip.allowed ? <Lock className="icon ws-chip-lock" /> : null}
                    </button>
                  );
                })}
              </div>
              {selectedTransition?.blockers?.length ? (
                <div className="ws-blockers">
                  {selectedTransition.blockers.map((blocker) => <div key={blocker.code}>• {blocker.message}</div>)}
                </div>
              ) : null}
            </section>

            {/* LOOKUP — clearer current/published state */}
            <section className="ws-section">
              <div className="ws-section-head"><h4>Final lookup</h4>
                <span className={`ws-tag ${lookupPublishedAt ? "is-ready" : ""}`}>
                  {lookupPublishedAt ? "Published to member" : "Not published"}
                </span>
              </div>
              <div className="lookup-card">
                <div className="lookup-current">
                  <span className="lookup-current-value ws-mono">{lookup || "—"}</span>
                  {generatedLookup && generatedLookup !== lookup ? (
                    <span className="lookup-generated">
                      auto: <span className="ws-mono">{generatedLookup}</span>
                      <button type="button" className="lookup-use" onClick={() => setLookup(generatedLookup)}>Use</button>
                    </span>
                  ) : null}
                </div>
                <div className="lookup-edit">
                  <input className="ws-input ws-mono" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="SUB00-…" />
                  <button className="btn btn-ghost btn-sm" disabled={!!busy || !lookup.trim()} onClick={() => saveLookup(false)}>Save privately</button>
                  <button className="btn btn-sm" disabled={!!busy || !lookup.trim()} onClick={() => saveLookup(true)}>Publish</button>
                </div>
                {lookupPublishedAt ? <div className="ws-line is-ready"><CheckCircle2 className="icon" /> Published {lookupPublishedAt}</div> : null}
              </div>
            </section>

            {/* ENTRY PRODUCTION + PUBLICATION GATE */}
            <div className="ws-grid">
              <section className="ws-section ws-card">
                <div className="ws-section-head"><h4>Entry production</h4></div>
                {!canProduce ? (
                  <p className="muted ws-muted-block">Move the submission to <strong>Producing</strong> before creating or linking its entry.</p>
                ) : (
                  <>
                    <label className="ws-field">
                      <span>Link existing local entry</span>
                      <select className="ws-input" value={entrySlug} onChange={(event) => setEntrySlug(event.target.value)}>
                        <option value="">Choose entry…</option>
                        {entries.map((entry) => <option key={entry.slug} value={entry.slug}>{entry.title} · {entry.lookupNumber || "no lookup"}</option>)}
                      </select>
                    </label>
                    {selectedEntry ? (
                      <div className={`ws-line ${lookupMatches ? "is-ready" : "is-blocked"}`}>
                        {lookupMatches ? <CheckCircle2 className="icon" /> : null}
                        {lookupMatches ? "Lookup matches" : `Entry lookup is ${selectedEntry.lookupNumber || "missing"}`}
                      </div>
                    ) : null}
                    <button className="btn btn-sm" disabled={!!busy || !entrySlug || !lookupMatches} onClick={() => linkEntry()}>
                      <Link2 className="icon" /> Link entry
                    </button>
                    <div className="ws-divider">or create</div>
                    <div className="ws-row">
                      <input className="ws-input ws-mono" value={newSlug} onChange={(event) => setNewSlug(slugify(event.target.value))} placeholder="entry-slug" />
                      <button className="btn btn-sm" disabled={!!busy || !newSlug || !lookup} onClick={createAndLink}>
                        <Plus className="icon" /> Create + link
                      </button>
                    </div>
                  </>
                )}
                {workflow?.entryLink?.href ? <div className="ws-line is-ready"><Link2 className="icon" /> {workflow.entryLink.href}</div> : null}
              </section>

              <section className="ws-section ws-card">
                <div className="ws-section-head"><h4>Publication gate</h4></div>
                <div className="ws-row">
                  <button className="btn btn-sm" disabled={!!busy || !entrySlug || !lookup} onClick={runPreflight}>
                    <ShieldCheck className="icon" /> Run preflight
                  </button>
                  {preflight?.ok ? (
                    <button className="btn btn-sm" onClick={() => window.dispatchEvent(new CustomEvent("dx:git-review", {
                      detail: { paths: preflight.relevantPaths || [], message: `publish: ${thread.title || entrySlug}` },
                    }))}>
                      <GitBranch className="icon" /> Review &amp; push
                    </button>
                  ) : null}
                </div>
                {preflight?.checks?.map((check) => (
                  <div key={check.id} className={`ws-line ${check.ok ? "is-ready" : "is-blocked"}`}>
                    <span>{check.ok ? "✓" : "×"}</span><span>{check.detail}</span>
                  </div>
                ))}
                <button className="btn btn-sm" disabled={!!busy || !preflight?.ok} onClick={verifyPublication}>
                  <RefreshCw className="icon" /> Verify public entry
                </button>
                {publication ? (
                  <div className={`ws-line ${publication.ok ? "is-ready" : "is-blocked"}`}>
                    {publication.ok ? <CheckCircle2 className="icon" /> : null}
                    {publication.ok ? "Remote and live page verified" : publication.message}
                  </div>
                ) : null}
                {publication?.ok && typeof publication.url === "string" ? (
                  <a className="thread-entry-link" href={publication.url} target="_blank" rel="noreferrer"><ExternalLink className="icon" /> Open live entry</a>
                ) : null}
              </section>
            </div>

            {/* META — predefined chips for priority + assignee */}
            <section className="ws-section">
              <div className="ws-meta">
                <div className="ws-meta-group">
                  <span className="ws-meta-label">Priority</span>
                  <div className="meta-chips">
                    {PRIORITIES.map((value) => (
                      <button
                        key={value}
                        className={`meta-chip pri-${value} ${priority === value ? "is-active" : ""}`}
                        disabled={!!busy}
                        onClick={() => patchMeta({ priority: value })}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ws-meta-group">
                  <span className="ws-meta-label">Assignee</span>
                  <div className="meta-chips">
                    {assigneePredefined.map((name) => (
                      <button
                        key={name}
                        className={`meta-chip ${assignee === name ? "is-active" : ""}`}
                        disabled={!!busy}
                        onClick={() => { setAssigneeCustom(false); patchMeta({ assignee: name }); }}
                      >
                        {name}
                      </button>
                    ))}
                    {showCustomAssignee ? (
                      <input
                        className="ws-input meta-custom"
                        autoFocus={assigneeCustom}
                        value={assigneePredefined.includes(assignee) ? "" : assignee}
                        placeholder="Custom handle…"
                        onChange={(event) => setAssignee(event.target.value)}
                        onBlur={() => patchMeta({ assignee })}
                        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                      />
                    ) : (
                      <button className="meta-chip is-ghost" disabled={!!busy} onClick={() => { setAssigneeCustom(true); setAssignee(""); }}>
                        Someone else…
                      </button>
                    )}
                    {assignee ? (
                      <button className="meta-chip is-ghost" disabled={!!busy} onClick={() => { setAssigneeCustom(false); patchMeta({ assignee: "" }); }} title="Unassign">Clear</button>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {/* CONVERSATION */}
            <section className="ws-section ws-conversation">
              <div className="ws-section-head"><h4>Conversation</h4><span className="ws-hint">{timeline.length} events</span></div>
              <div className="ws-timeline">
                {timeline.map((event, index) => {
                  const actor = ["member", "user"].includes(String(event.actorType || event.actor_type || "").toLowerCase())
                    ? "user"
                    : String(event.actorType || event.actor_type || "system").toLowerCase();
                  const internal = !!(event.internalNote || event.internal_note);
                  const presentation = event.presentation || {};
                  const body = presentation.body || event.publicNote || event.public_note || event.internalNote || event.internal_note || "";
                  const title = actor === "user" ? "Member" : presentation.title || event.eventType || event.event_type || event.stage || "Update";
                  return (
                    <article key={event.id || index} className={`thread-event thread-${actor} ${internal ? "thread-internal" : ""}`} data-tone={presentation.tone || actor}>
                      <div className="thread-event-meta">
                        <strong>{title}</strong>
                        <span className="muted">{event.eventAt || event.event_at || ""}</span>
                        {internal ? <span className="thread-lock">internal</span> : null}
                      </div>
                      {body ? <div className="thread-event-body">{body}</div> : null}
                      {presentation.link?.href ? <a className="thread-entry-link" href={presentation.link.href} target="_blank" rel="noreferrer">{presentation.link.label || "Open entry"} <ExternalLink className="icon" /></a> : null}
                    </article>
                  );
                })}
                {!timeline.length ? <div className="muted">No timeline events yet.</div> : null}
              </div>
            </section>
          </div>
        )}

        {/* COMPOSER — unified message + status update */}
        {detail ? (
          <footer className={`ws-composer ${pendingStage ? "is-status" : ""}`}>
            {pendingStage ? (
              <div className={`composer-banner tone-${stageTone(pendingStage)}`}>
                <span className="composer-banner-copy">
                  Publishing status → <strong>{STAGE_LABELS[pendingStage]}</strong>. This update is sent to the member.
                </span>
                <button className="composer-banner-cancel" onClick={() => setPendingStage(null)}><X className="icon" /> Cancel</button>
              </div>
            ) : (
              <div className="composer-templates">
                {REPLY_TEMPLATES.map((template) => (
                  <button key={template.label} className="composer-template" disabled={!!busy} onClick={() => setComposer((current) => current.trim() ? `${current}\n\n${template.body}` : template.body)}>
                    {template.label}
                  </button>
                ))}
              </div>
            )}
            <div className="composer-input">
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder={pendingStage ? "Write the member-facing update…" : visibility === "public" ? "Message the member…" : "Internal note (members can’t see this)…"}
                rows={3}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleSend(); }}
              />
              <div className="composer-actions">
                {!pendingStage ? (
                  <div className="composer-vis seg seg-sm">
                    <button className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>Public</button>
                    <button className={visibility === "internal" ? "on" : ""} onClick={() => setVisibility("internal")}>Internal</button>
                  </div>
                ) : <span className="grow" />}
                <span className="grow" />
                <button
                  className="btn btn-primary btn-sm composer-send"
                  disabled={!!busy || !composer.trim() || (pendingStage ? !selectedTransition?.allowed : false)}
                  onClick={handleSend}
                >
                  <Send className="icon" />
                  {busy === "message" || busy === "transition"
                    ? "Sending…"
                    : pendingStage ? "Publish status + update" : visibility === "public" ? "Send" : "Save note"}
                </button>
              </div>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
