import { useCallback, useEffect, useState } from "react";
import { Plus, ArrowLeft } from "lucide-react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
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

export function PollsScreen() {
  const { env, notify } = useStore();
  const [polls, setPolls] = useState<PollDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ question: "", options: "", visibility: "public" });
  const [selected, setSelected] = useState<PollDef | null>(null);

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
    const options = draft.options.split("\n").map((o) => o.trim()).filter(Boolean);
    if (!draft.question.trim() || options.length < 2) {
      notify("err", "A question and at least 2 options are required.");
      return;
    }
    setBusy("__new__");
    try {
      await rpc("polls.create", { env, question: draft.question, options, visibility: draft.visibility });
      notify("ok", "Poll created (draft).");
      setDraft({ question: "", options: "", visibility: "public" });
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
        <button className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
          <Plus className="icon" /> New poll
        </button>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        {loading && <div className="spinner" />}
      </div>

      {creating && (
        <div className="panel content-narrow">
          <div className="panel-title">New poll</div>
          <div className="field">
            <label>Question</label>
            <input value={draft.question} onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))} />
          </div>
          <div className="field">
            <label>Options (one per line, min 2)</label>
            <textarea value={draft.options} onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))} />
          </div>
          <div className="field">
            <label>Visibility</label>
            <select value={draft.visibility} onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value }))}>
              <option value="public">public</option>
              <option value="members">members</option>
            </select>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy === "__new__"} onClick={createPoll}>
            {busy === "__new__" ? "Creating…" : "Create draft"}
          </button>
        </div>
      )}

      {polls.length === 0 && !loading && <div className="muted">No polls.</div>}

      <div className="grid">
        {polls.map((poll) => {
          const id = pollId(poll);
          const open = String(poll.status || "").toLowerCase() === "open";
          return (
            <div className="card" key={id} onClick={() => setSelected(poll)}>
              <div className="chip-row" style={{ marginBottom: 8 }}>
                <span className={`chip ${open ? "chip-accent" : ""}`}>{poll.status || "—"}</span>
                {poll.visibility && <span className="chip">{poll.visibility}</span>}
              </div>
              <div className="card-title">{poll.question || id}</div>
              <div className="card-sub">{id}</div>
              <div className="inline" style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-sm" disabled={busy === id || open} onClick={() => setStatus(poll, "open")}>Open</button>
                <button className="btn btn-sm" disabled={busy === id || !open} onClick={() => setStatus(poll, "close")}>Close</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PollDetail({ poll, onBack }: { poll: PollDef; onBack: () => void }) {
  const { env, notify } = useStore();
  const id = pollId(poll);
  const [question, setQuestion] = useState(String(poll.question || ""));
  const [options, setOptions] = useState(
    (Array.isArray(poll.options) ? poll.options.map((o: any) => (typeof o === "string" ? o : o?.label || "")) : []).join("\n"),
  );
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

  async function savePatch() {
    setBusy("patch");
    try {
      const patch: any = {
        question,
        options: options.split("\n").map((o) => o.trim()).filter(Boolean),
        visibility,
        status,
        manualClose,
      };
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

  async function setStatus(status: "open" | "close") {
    setBusy(status);
    try {
      await rpc("polls.status", { env, pollId: id, status });
      notify("ok", `${id} ${status === "open" ? "opened" : "closed"}.`);
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
    <div className="content-narrow stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft className="icon" /> Back</button>
        <div className="grow" />
        <button className="btn btn-sm" disabled={busy === "open"} onClick={() => setStatus("open")}>Open</button>
        <button className="btn btn-sm" disabled={busy === "close"} onClick={() => setStatus("close")}>Close</button>
        <button className="btn btn-primary btn-sm" disabled={busy === "patch"} onClick={savePatch}>Save</button>
      </div>

      <div className="panel">
        <div className="panel-title">{id} · {String(poll.status || "—")}</div>
        <div className="field">
          <label>Question</label>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="field">
          <label>Options (one per line)</label>
          <textarea value={options} onChange={(e) => setOptions(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Visibility</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="public">Public</option>
              <option value="members">Members only</option>
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatusValue(e.target.value)}>
              <option value="draft">Draft (hidden)</option>
              <option value="open">Open (accepting votes)</option>
              <option value="closed">Closed</option>
            </select>
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
          <label className="inline" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={manualClose} onChange={(e) => setManualClose(e.target.checked)} style={{ width: "auto" }} />
            <span>Manual close (ignore the close time until closed by hand)</span>
          </label>
        </div>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
          The quick Open/Close buttons above flip status immediately; Save applies the scheduled times, visibility, and status together.
        </p>
      </div>

      <div className="panel">
        <div className="panel-title">Live totals {Number.isFinite(liveTotal) ? `· ${liveTotal} votes` : ""}</div>
        {liveOptions.length === 0 && <div className="muted">No live data.</div>}
        {liveOptions.map((o, i) => {
          const label = o?.label || o?.option || `Option ${i + 1}`;
          const count = Number(o?.count ?? o?.votes ?? 0);
          const pct = liveTotal > 0 ? Math.round((count / liveTotal) * 100) : 0;
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span>{label}</span>
                <span className="muted">{count} · {pct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "var(--dx-border)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--dx-accent-gradient)" }} />
              </div>
            </div>
          );
        })}
        <div className="field-hint" style={{ marginTop: 8 }}>Trend: {trendBuckets.length} buckets (90d/day)</div>
      </div>

      <div className="panel">
        <div className="panel-title">Snapshots</div>
        <div className="list" style={{ marginBottom: 12 }}>
          {snapshots.length === 0 && <div className="muted">No snapshots yet.</div>}
          {snapshots.map((s: any) => (
            <div className="row" key={s.version} style={{ cursor: "default" }}>
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
          <textarea value={snapSummary} onChange={(e) => setSnapSummary(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy === "snap"} onClick={publishSnapshot}>Publish snapshot</button>
      </div>
    </div>
  );
}
