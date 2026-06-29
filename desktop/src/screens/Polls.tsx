import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ArrowLeft, Send } from "lucide-react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { TokenInput } from "../components/TokenInput";
import { ChipSelect } from "../components/ChipSelect";
import { relativeTime } from "../entryHelpers";
import { type PollDef, pollId } from "../domain";

// ISO <-> <input type="datetime-local"> (local wall-clock) conversions.
function isoToLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

type PollPhase = "open" | "draft" | "closed";
function pollPhase(poll: PollDef): PollPhase {
  const s = String(poll.status || "").toLowerCase();
  if (s === "open") return "open";
  if (s === "closed") return "closed";
  return "draft";
}
const PHASE_TONE: Record<PollPhase, string> = { open: "positive", draft: "active", closed: "neutral" };
const PHASE_LABEL: Record<PollPhase, string> = { open: "Open", draft: "Draft", closed: "Closed" };

function optionLabels(poll: PollDef): string[] {
  return Array.isArray(poll.options)
    ? poll.options.map((o: any) => (typeof o === "string" ? o : o?.label || "")).filter(Boolean)
    : [];
}

export function PollsScreen() {
  const { env, notify } = useStore();
  const [polls, setPolls] = useState<PollDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ question: string; options: string[]; visibility: string }>({ question: "", options: [], visibility: "public" });
  const [selected, setSelected] = useState<PollDef | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"updated" | "question" | "status">("updated");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = payloadOf<any>(await rpc("polls.list", { env, limit: 200 }));
      const list: PollDef[] = payload.polls || payload.definitions || payload.items || [];
      setPolls(Array.isArray(list) ? list : []);
    } catch (error) {
      notify("err", String(error));
      setPolls([]);
    } finally {
      setLoading(false);
    }
  }, [env, notify]);

  useEffect(() => {
    load();
    setSelected(null);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = !q ? polls : polls.filter((p) =>
      `${p.question || ""} ${pollId(p)} ${p.status || ""}`.toLowerCase().includes(q));
    const sorted = [...matched];
    if (sort === "question") sorted.sort((a, b) => String(a.question || "").localeCompare(String(b.question || "")));
    else if (sort === "status") sorted.sort((a, b) => pollPhase(a).localeCompare(pollPhase(b)));
    else sorted.sort((a, b) => String((b as any).updatedAt || b.updated_at || "").localeCompare(String((a as any).updatedAt || a.updated_at || "")));
    return sorted;
  }, [polls, search, sort]);

  async function setStatus(poll: PollDef, status: "open" | "close") {
    const id = pollId(poll);
    setBusy(id);
    try {
      await rpc("polls.status", { env, pollId: id, status });
      notify("ok", `${id} ${status === "open" ? "opened" : "closed"}.`);
      load();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function createPoll() {
    if (!draft.question.trim() || draft.options.length < 2) {
      notify("err", "A question and at least 2 options are required.");
      return;
    }
    setBusy("__new__");
    try {
      await rpc("polls.create", { env, question: draft.question, options: draft.options, visibility: draft.visibility });
      notify("ok", "Poll created (draft).");
      setDraft({ question: "", options: [], visibility: "public" });
      setCreating(false);
      load();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  if (selected) {
    return <PollDetail poll={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  return (
    <div className="stack">
      <div className="inline">
        <input
          className="board-search"
          placeholder="Filter by question, id, status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} title="Sort">
          <option value="updated">Recently updated</option>
          <option value="question">Question A–Z</option>
          <option value="status">Status</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}><Plus className="icon" /> New poll</button>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        {loading && <div className="spinner" />}
      </div>

      {creating && (
        <div className="panel content-narrow ws-section">
          <div className="ws-section-head"><h4>New poll</h4></div>
          <label className="ws-field"><span>Question</span>
            <input className="ws-input" value={draft.question} onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))} placeholder="What should we ask?" />
          </label>
          <label className="ws-field"><span>Options (min 2)</span>
            <TokenInput value={draft.options} onChange={(next) => setDraft((d) => ({ ...d, options: next }))} placeholder="Add an option…" />
          </label>
          <div className="ws-field"><span>Visibility</span>
            <ChipSelect value={draft.visibility} options={["public", "members"]} onChange={(v) => setDraft((d) => ({ ...d, visibility: v }))} allowCustom={false} />
          </div>
          <div className="inline">
            <button className="btn btn-primary btn-sm" disabled={busy === "__new__" || !draft.question.trim() || draft.options.length < 2} onClick={createPoll}>
              {busy === "__new__" ? "Creating…" : "Create draft"}
            </button>
            <button className="btn btn-sm" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="muted">{filtered.length} poll{filtered.length === 1 ? "" : "s"}</div>

      {filtered.length === 0 && !loading ? <div className="muted" style={{ padding: 16 }}>No polls match.</div> : null}

      <div className="entry-grid">
        {filtered.map((poll) => {
          const id = pollId(poll);
          const phase = pollPhase(poll);
          const open = phase === "open";
          const opts = optionLabels(poll);
          const updated = String((poll as any).updatedAt || poll.updated_at || "");
          return (
            <button className={`entry-card poll-card`} key={id} onClick={() => setSelected(poll)}>
              <div className="entry-card-body">
                <div className="entry-card-top">
                  <span className="entry-card-title">{poll.question || id}</span>
                  <span className={`ws-status-pill tone-${PHASE_TONE[phase]}`}>{PHASE_LABEL[phase]}</span>
                </div>
                <div className="entry-card-sub">{opts.length} option{opts.length === 1 ? "" : "s"}{poll.visibility ? ` · ${poll.visibility}` : ""}</div>
                <div className="entry-card-foot">
                  <span className="entry-card-lookup ws-mono">{id}</span>
                  <span className="grow" />
                  {updated ? <span className="entry-card-time">{relativeTime(updated)}</span> : null}
                </div>
                <div className="poll-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm" disabled={busy === id || open} onClick={() => setStatus(poll, "open")}>Open</button>
                  <button className="btn btn-sm" disabled={busy === id || !open} onClick={() => setStatus(poll, "close")}>Close</button>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PollDetail({ poll, onBack }: { poll: PollDef; onBack: () => void }) {
  const { env, notify } = useStore();
  const id = pollId(poll);
  const [tab, setTab] = useState<"setup" | "results" | "snapshots">("setup");
  const [question, setQuestion] = useState(String(poll.question || ""));
  const [options, setOptions] = useState<string[]>(optionLabels(poll));
  const [visibility, setVisibility] = useState(String(poll.visibility || "public"));
  const [status, setStatusValue] = useState(String(poll.status || "draft"));
  const [openAt, setOpenAt] = useState(isoToLocal(String((poll as any).createdAt || (poll as any).created_at || "")));
  const [closeAt, setCloseAt] = useState(isoToLocal(String((poll as any).closeAt || poll.close_at || "")));
  const [manualClose, setManualClose] = useState(Boolean((poll as any).manualClose ?? (poll as any).manual_close ?? false));
  const [live, setLive] = useState<any>(null);
  const [trend, setTrend] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [snapHeadline, setSnapHeadline] = useState("");
  const [snapSummary, setSnapSummary] = useState("");

  const phase = pollPhase({ ...poll, status });

  const loadAnalytics = useCallback(async () => {
    try {
      setLive(payloadOf(await rpc("polls.live", { env, pollId: id })));
    } catch (error) { notify("err", `live: ${error}`); }
    try {
      setTrend(payloadOf(await rpc("polls.trend", { env, pollId: id, window: "90d", bucket: "day" })));
    } catch { /* trend optional */ }
    try {
      const s = payloadOf<any>(await rpc("polls.snapshots", { env, pollId: id }));
      setSnapshots(s.snapshots || s.items || []);
    } catch { /* snapshots optional */ }
  }, [env, id, notify]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  const valid = question.trim().length > 0 && options.length >= 2;

  async function savePatch() {
    if (!valid) { notify("err", "A question and at least 2 options are required."); return; }
    setBusy("patch");
    try {
      const patch: any = { question, options, visibility, status, manualClose };
      const openIso = localToIso(openAt);
      const closeIso = localToIso(closeAt);
      if (openIso) patch.createdAt = openIso;
      if (closeIso) patch.closeAt = closeIso;
      await rpc("polls.patch", { env, pollId: id, patch });
      notify("ok", `Saved ${id}.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(next: "open" | "close") {
    setBusy(next);
    try {
      await rpc("polls.status", { env, pollId: id, status: next });
      setStatusValue(next === "open" ? "open" : "closed");
      notify("ok", `${id} ${next === "open" ? "opened" : "closed"}.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function publishSnapshot() {
    if (!snapSummary.trim()) { notify("err", "Summary markdown is required."); return; }
    setBusy("snap");
    try {
      await rpc("polls.publishSnapshot", { env, pollId: id, headline: snapHeadline, summaryMarkdown: snapSummary, publish: true });
      notify("ok", "Snapshot published.");
      setSnapHeadline(""); setSnapSummary("");
      loadAnalytics();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function promote(version: number) {
    setBusy(`promote-${version}`);
    try {
      await rpc("polls.promoteSnapshot", { env, pollId: id, version });
      notify("ok", `Promoted v${version}.`);
      loadAnalytics();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  const liveOptions: any[] = live?.options || live?.totals || live?.results || [];
  const liveTotal = Number(live?.total ?? liveOptions.reduce((a, o) => a + Number(o?.count ?? o?.votes ?? 0), 0));
  const trendBuckets: any[] = trend?.buckets || trend?.points || trend?.series || [];

  return (
    <div className="stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft className="icon" /> Back</button>
        <span className={`ws-status-pill tone-${PHASE_TONE[phase]}`}>{PHASE_LABEL[phase]}</span>
        <div className="grow" />
        <button className="btn btn-sm" disabled={busy === "open" || phase === "open"} onClick={() => setStatus("open")}>Open</button>
        <button className="btn btn-sm" disabled={busy === "close" || phase === "closed"} onClick={() => setStatus("close")}>Close</button>
        <button className="btn btn-primary btn-sm" disabled={busy === "patch" || !valid} onClick={savePatch}>{busy === "patch" ? "Saving…" : "Save"}</button>
      </div>

      <div className="panel" style={{ paddingBottom: 4 }}>
        <div className="ws-kicker">Poll · {id}</div>
        <h3 className="ws-title" style={{ fontSize: 18 }}>{question || id}</h3>
      </div>

      <div className="seg entry-tabs">
        <button className={tab === "setup" ? "on" : ""} onClick={() => setTab("setup")}>Setup</button>
        <button className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>Results</button>
        <button className={tab === "snapshots" ? "on" : ""} onClick={() => setTab("snapshots")}>Snapshots</button>
      </div>

      {tab === "setup" ? (
        <div className="panel">
          <div className="field">
            <label>Question</label>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="field">
            <label>Options</label>
            <TokenInput value={options} onChange={setOptions} placeholder="Add an option…" />
            {options.length < 2 ? <div className="field-hint field-hint-warn">At least 2 options required</div> : null}
          </div>
          <div className="field-row">
            <div className="field">
              <label>Visibility</label>
              <ChipSelect value={visibility} options={["public", "members"]} onChange={setVisibility} allowCustom={false} />
            </div>
            <div className="field">
              <label>Status</label>
              <ChipSelect value={status} options={["draft", "open", "closed"]} onChange={setStatusValue} allowCustom={false} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Opens (created)</label>
              <input type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} />
            </div>
            <div className="field">
              <label>Closes</label>
              <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="dx-check">
              <input type="checkbox" checked={manualClose} onChange={(e) => setManualClose(e.target.checked)} />
              Manual close (ignore the close time until closed by hand)
            </label>
          </div>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            The Open/Close buttons above flip status immediately; Save applies the scheduled times, visibility, and status together.
          </p>
        </div>
      ) : null}

      {tab === "results" ? (
        <div className="panel">
          <div className="ws-section-head"><h4>Live totals</h4>{Number.isFinite(liveTotal) ? <span className="ws-hint">{liveTotal} votes</span> : null}</div>
          {liveOptions.length === 0 ? <div className="muted">No live data yet.</div> : null}
          {liveOptions.map((o, i) => {
            const label = o?.label || o?.option || `Option ${i + 1}`;
            const count = Number(o?.count ?? o?.votes ?? 0);
            const pct = liveTotal > 0 ? Math.round((count / liveTotal) * 100) : 0;
            return (
              <div key={i} className="poll-bar">
                <div className="poll-bar-head">
                  <span>{label}</span>
                  <span className="muted">{count} · {pct}%</span>
                </div>
                <div className="poll-bar-track"><div className="poll-bar-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
          <div className="field-hint" style={{ marginTop: 8 }}>Trend: {trendBuckets.length} buckets (90d/day)</div>
        </div>
      ) : null}

      {tab === "snapshots" ? (
        <div className="panel">
          <div className="ws-section-head"><h4>Snapshots</h4><span className="ws-hint">{snapshots.length}</span></div>
          <div className="list" style={{ marginBottom: 12 }}>
            {snapshots.length === 0 ? <div className="muted">No snapshots yet.</div> : null}
            {snapshots.map((s: any) => (
              <div className="row" key={s.version} style={{ cursor: "default", alignItems: "center" }}>
                <span className="grow">
                  <div className="row-title">v{s.version} {s.current || s.promoted ? <span className="chip chip-accent">current</span> : null}</div>
                  <div className="row-sub">{s.headline || ""} · {s.publishedAt || s.published_at || ""}</div>
                </span>
                <button className="btn btn-sm" disabled={busy === `promote-${s.version}`} onClick={() => promote(Number(s.version))}>Promote</button>
              </div>
            ))}
          </div>
          <div className="field">
            <label>New snapshot headline</label>
            <input value={snapHeadline} onChange={(e) => setSnapHeadline(e.target.value)} />
          </div>
          <div className="field">
            <label>Summary (markdown, required)</label>
            <textarea value={snapSummary} onChange={(e) => setSnapSummary(e.target.value)} style={{ minHeight: 120 }} />
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy === "snap" || !snapSummary.trim()} onClick={publishSnapshot}>
            <Send className="icon" /> Publish snapshot
          </button>
        </div>
      ) : null}
    </div>
  );
}
