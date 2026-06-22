import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Upload } from "lucide-react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { type OpsKind, type OpsTicket, ticketId } from "../domain";
import { SubmissionsBoard } from "./SubmissionsBoard";

const KINDS: OpsKind[] = ["submission", "press", "board", "support"];

export function SubmissionsScreen() {
  const { env, notify } = useStore();
  const [view, setView] = useState<"board" | "tickets">("board");
  const [kind, setKind] = useState<OpsKind>("submission");
  const [tickets, setTickets] = useState<OpsTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = payloadOf<{ tickets?: OpsTicket[] }>(await rpc("ops.list", { env, kind, limit: 200 }));
      setTickets(payload.tickets || []);
    } catch (error) {
      notify("err", String(error));
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [env, kind, notify]);

  useEffect(() => {
    load();
    setSelectedId(null);
  }, [load]);

  if (importing) {
    return <ImportPanel kind={kind} onBack={() => { setImporting(false); load(); }} />;
  }

  if (selectedId) {
    return <TicketDetail kind={kind} ticketId={selectedId} onBack={() => { setSelectedId(null); load(); }} />;
  }

  return (
    <div className="stack">
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>Board</button>
        <button className={view === "tickets" ? "on" : ""} onClick={() => setView("tickets")}>Tickets</button>
      </div>

      {view === "board" ? <SubmissionsBoard /> : (
      <>
      <div className="inline">
        <div className="seg">
          {KINDS.map((value) => (
            <button key={value} className={kind === value ? "on" : ""} onClick={() => setKind(value)}>{value}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        <button className="btn btn-sm" onClick={() => setImporting(true)}><Upload className="icon" /> Import</button>
        {loading && <div className="spinner" />}
      </div>

      <div className="panel" style={{ padding: "var(--dx-space-sm)" }}>
        <div className="list">
          {tickets.length === 0 && !loading && <div className="muted" style={{ padding: 16 }}>No {kind} tickets.</div>}
          {tickets.map((t) => {
            const id = ticketId(t);
            return (
              <button key={id} className="row" onClick={() => setSelectedId(id)}>
                <span className={`status-dot ${String(t.status || "").toLowerCase()}`} />
                <span className="grow">
                  <div className="row-title">{t.title || t.contact_name || t.contactName || id}</div>
                  <div className="row-sub">{String(t.email || "")} · {String(t.status || "—")} · {String(t.priority || "")}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function TicketDetail({ kind, ticketId: id, onBack }: { kind: OpsKind; ticketId: string; onBack: () => void }) {
  const { env, notify } = useStore();
  const [ticket, setTicket] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = payloadOf<any>(await rpc("ops.get", { env, ticketId: id }));
      const t = payload.ticket || payload;
      setTicket(t);
      setEvents(payload.events || t.events || []);
      setStatus("");
    } catch (error) {
      notify("err", String(error));
    }
  }, [env, id, notify]);

  useEffect(() => { load(); }, [load]);

  async function sendReply() {
    setBusy("reply");
    try {
      await rpc("ops.reply", { env, ticketId: id, publicNote: reply, internalNote: internal, status: status || undefined });
      notify("ok", `Replied to ${id}.`);
      setReply(""); setInternal("");
      load();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function patchStatus(next: string) {
    setBusy("status");
    try {
      await rpc("ops.patch", { env, ticketId: id, status: next });
      notify("ok", `Status → ${next}.`);
      load();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  if (!ticket) return <div className="empty"><div className="spinner" /></div>;

  return (
    <div className="content-narrow stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft className="icon" /> Back</button>
        <div className="grow" />
        <span className="chip">{kind}</span>
        <span className="chip">{String(ticket.status || "—")}</span>
      </div>

      <div className="panel">
        <div className="panel-title">{ticket.title || id}</div>
        <div className="field-row">
          <div className="field"><label>Contact</label><div className="row-sub">{ticket.contact_name || ticket.contactName || "—"}</div></div>
          <div className="field"><label>Email</label><div className="row-sub">{ticket.email || "—"}</div></div>
          <div className="field"><label>Assignee</label><div className="row-sub">{ticket.assignee || "—"}</div></div>
          <div className="field"><label>Priority</label><div className="row-sub">{ticket.priority || "—"}</div></div>
        </div>
        <div className="field">
          <label>Set status</label>
          <div className="inline">
            <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="reviewing, accepted, closed…" style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={busy === "status" || !status} onClick={() => patchStatus(status)}>Apply</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Timeline ({events.length})</div>
        <div className="list">
          {events.length === 0 && <div className="muted">No events.</div>}
          {events.map((ev: any, i: number) => (
            <div className="row" key={i} style={{ cursor: "default", alignItems: "flex-start" }}>
              <span className="grow">
                <div className="row-title">{ev.event_type || ev.type || ev.stage || "event"} {ev.status ? <span className="chip">{ev.status}</span> : null}</div>
                {(ev.public_note || ev.publicNote) && <div className="row-sub">↪ {ev.public_note || ev.publicNote}</div>}
                {(ev.internal_note || ev.internalNote) && <div className="row-sub muted">🔒 {ev.internal_note || ev.internalNote}</div>}
                <div className="row-sub muted">{ev.created_at || ev.event_at || ev.createdAt || ""}</div>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Reply</div>
        <div className="field">
          <label>Public note (sent to the contact)</label>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} />
        </div>
        <div className="field">
          <label>Internal note</label>
          <textarea value={internal} onChange={(e) => setInternal(e.target.value)} style={{ minHeight: 70 }} />
        </div>
        <div className="field">
          <label>Set status with this reply (optional)</label>
          <input value={status} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy === "reply" || (!reply && !internal && !status)} onClick={sendReply}>
          {busy === "reply" ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function ImportPanel({ kind, onBack }: { kind: OpsKind; onBack: () => void }) {
  const { env, notify } = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function run(dryRun: boolean) {
    let rows: any[];
    try {
      rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error("not an array");
    } catch {
      notify("err", "Rows must be a JSON array of objects.");
      return;
    }
    setBusy(true);
    try {
      const payload = payloadOf<any>(await rpc("ops.import", { env, kind, rows, dryRun }));
      setResult(JSON.stringify(payload, null, 2));
      notify("ok", dryRun ? "Dry run complete." : `Imported ${rows.length} rows.`);
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
        <span className="chip">{kind} import</span>
      </div>
      <div className="panel">
        <div className="panel-title">Import rows (from Sheets export)</div>
        <div className="field">
          <label>Rows — JSON array of objects</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 200, fontFamily: "var(--font-body)" }}
            placeholder='[{"email":"a@b.com","title":"…","sourceRef":"…"}]' />
        </div>
        <div className="inline">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(true)}>Dry run</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(false)}>Import</button>
        </div>
        {result && <div className="diff" style={{ marginTop: 12 }}>{result}</div>}
      </div>
    </div>
  );
}
