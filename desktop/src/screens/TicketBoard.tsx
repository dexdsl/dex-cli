import { useCallback, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { type OpsTicket, ticketId } from "../domain";
import { DexLoader, SkeletonRows } from "../components/DexLoader";
import { TicketWorkspace } from "../components/TicketWorkspace";
import { TICKET_STAGES, TICKET_STAGE_LABELS, ticketStage, stageTone, type TicketStage } from "../submissions";

function ago(value: unknown): string {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export function TicketBoard({ kind }: { kind: string }) {
  const { env, notify } = useStore();
  const [tickets, setTickets] = useState<OpsTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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

  useEffect(() => { void load(); }, [load]);

  const filtered = tickets.filter((t) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const hay = `${t.title || ""} ${t.email || ""} ${t.contact_name || t.contactName || ""} ${t.assignee || ""} ${t.status || ""}`.toLowerCase();
    return hay.includes(q);
  });

  const moveToStage = useCallback(async (id: string, stage: TicketStage) => {
    const ticket = tickets.find((t) => ticketId(t) === id);
    if (!ticket || ticketStage(String(ticket.status || "")) === stage) return;
    // Optimistic: reflect the move immediately, reconcile on reload.
    setTickets((prev) => prev.map((t) => (ticketId(t) === id ? { ...t, status: stage } : t)));
    try {
      await rpc("ops.patch", { env, ticketId: id, status: stage });
      notify("ok", `${id} → ${TICKET_STAGE_LABELS[stage]}.`);
      void load();
    } catch (error) {
      notify("err", String(error));
      void load();
    }
  }, [tickets, env, notify, load]);

  if (loading && !tickets.length) {
    return (
      <div className="panel" style={{ padding: "var(--dx-space-sm)" }}>
        <DexLoader phase="Loading" detail={`${kind} queue`} />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  return (
    <div className="stack board-fill">
      <div className="inline board-filters">
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>Refresh</button>
        <input className="board-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${kind} tickets…`} />
        <button className="btn btn-sm" onClick={() => setImporting(true)}><Upload className="icon" /> Import</button>
        <span className="muted">{filtered.length}/{tickets.length}</span>
      </div>

      <div className="board-lanes">
       <div className="board-lane">
        <div className="kanban">
        {TICKET_STAGES.map((stage) => {
          const stageTickets = filtered.filter((t) => ticketStage(String(t.status || "")) === stage);
          return (
            <div
              key={stage}
              className={`kanban-col tone-${stageTone(stage)}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) void moveToStage(id, stage);
                setDragId(null);
              }}
            >
              <div className="kanban-col-head">
                <span>{TICKET_STAGE_LABELS[stage]}</span>
                <span className="kanban-count">{stageTickets.length}</span>
              </div>
              <div className="kanban-cards">
                {stageTickets.map((t) => {
                  const id = ticketId(t);
                  return (
                    <div
                      key={id}
                      className={`kanban-card pri-${String(t.priority || "normal")}`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", id); setDragId(id); }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setSelected(id)}
                    >
                      <div className="kanban-card-title">{t.title || t.contact_name || t.contactName || id}</div>
                      <div className="kanban-card-meta">
                        {t.email ? <span>{String(t.email)}</span> : null}
                      </div>
                      <div className="kanban-card-foot">
                        {t.priority && t.priority !== "normal" ? <span className={`kanban-pri kanban-pri-${t.priority}`}>{String(t.priority)}</span> : null}
                        {t.assignee ? <span className="kanban-assignee">@{String(t.assignee)}</span> : null}
                        <span className="grow" />
                        <span className="kanban-sla kanban-sla-fresh">{ago(t.updated_at || t.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
                {stageTickets.length === 0 ? <div className="kanban-empty">—</div> : null}
              </div>
            </div>
          );
        })}
        </div>
       </div>
      </div>

      {selected ? (
        <TicketWorkspace kind={kind} ticketId={selected} onClose={() => setSelected(null)} onChanged={load} />
      ) : null}

      {importing ? <ImportModal kind={kind} onClose={() => { setImporting(false); void load(); }} /> : null}
    </div>
  );
}

function ImportModal({ kind, onClose }: { kind: string; onClose: () => void }) {
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
    <div className="dx-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="dx-modal dx-modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="dx-modal-title">Import {kind} tickets</h3>
        <div className="dx-modal-body">
          <label className="ws-field">
            <span>Rows — JSON array of objects (from a Sheets export)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 200, width: "100%" }} placeholder='[{"email":"a@b.com","title":"…","sourceRef":"…"}]' />
          </label>
          {result ? <div className="diff" style={{ marginTop: 12 }}>{result}</div> : null}
        </div>
        <div className="dx-modal-actions">
          <button className="btn btn-sm" disabled={busy} onClick={onClose}>Close</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(true)}>Dry run</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(false)}>Import</button>
        </div>
      </div>
    </div>
  );
}
