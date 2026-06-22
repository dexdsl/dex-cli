import { useCallback, useEffect, useState } from "react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { DexLoader, SkeletonRows } from "../components/DexLoader";

type ThreadCard = {
  submissionId: string;
  auth0Sub: string;
  title: string;
  lookup: string;
  creator: string;
  category: string;
  instrument: string;
  stage: string;
  statusRaw: string;
  latestPublicNote: string;
  kind: string;
  assignee: string;
  priority: string;
  tags: string[];
  updatedAt: number | null;
};

const STAGE_LABELS: Record<string, string> = {
  sent: "Sent",
  received: "Received",
  acknowledged: "Acknowledged",
  reviewing: "Reviewing",
  accepted: "Accepted",
  rejected: "Rejected",
  in_library: "In library",
};
// Columns shown on the board (rejected is a side column).
const BOARD_STAGES = ["received", "acknowledged", "reviewing", "accepted", "in_library", "rejected"];

function ago(unix: number | null): string {
  if (!unix) return "";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export function SubmissionsBoard() {
  const { env, notify } = useStore();
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ThreadCard | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = payloadOf<any>(await rpc("threads.board", { env }));
      setThreads(Array.isArray(payload.threads) ? payload.threads : []);
    } catch (error) {
      notify("err", String(error));
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [env, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const moveToStage = useCallback(
    async (submissionId: string, stage: string) => {
      const card = threads.find((t) => t.submissionId === submissionId);
      if (!card || card.stage === stage) return;
      setThreads((prev) => prev.map((t) => (t.submissionId === submissionId ? { ...t, stage } : t)));
      try {
        await rpc("threads.patch", { env, submissionId, patch: { stage } });
        notify("ok", `Moved to ${STAGE_LABELS[stage] || stage}.`);
      } catch (error) {
        notify("err", String(error));
        load();
      }
    },
    [env, threads, notify, load],
  );

  if (loading && !threads.length) {
    return (
      <div className="panel" style={{ padding: "var(--dx-space-sm)" }}>
        <DexLoader phase="Loading" detail="submission board" />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>Refresh</button>
        <span className="muted">{threads.length} threads</span>
      </div>

      <div className="kanban">
        {BOARD_STAGES.map((stage) => {
          const cards = threads.filter((t) => t.stage === stage);
          return (
            <div
              key={stage}
              className={`kanban-col kanban-${stage}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) moveToStage(id, stage);
                setDragId(null);
              }}
            >
              <div className="kanban-col-head">
                <span>{STAGE_LABELS[stage] || stage}</span>
                <span className="kanban-count">{cards.length}</span>
              </div>
              <div className="kanban-cards">
                {cards.map((card) => (
                  <div
                    key={card.submissionId}
                    className={`kanban-card pri-${card.priority || "normal"}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card.submissionId);
                      setDragId(card.submissionId);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setDetail(card)}
                  >
                    <div className="kanban-card-title">{card.title || card.lookup || card.submissionId}</div>
                    <div className="kanban-card-meta">
                      {card.lookup ? <span>{card.lookup}</span> : null}
                      {card.creator ? <span>· {card.creator}</span> : null}
                    </div>
                    <div className="kanban-card-foot">
                      {card.priority ? <span className={`kanban-pri kanban-pri-${card.priority}`}>{card.priority}</span> : null}
                      {card.assignee ? <span className="kanban-assignee">@{card.assignee}</span> : null}
                      <span className="grow" />
                      <span className="muted">{ago(card.updatedAt)}</span>
                    </div>
                    {card.tags.length ? (
                      <div className="kanban-tags">
                        {card.tags.slice(0, 3).map((t) => <span className="kanban-tag" key={t}>{t}</span>)}
                      </div>
                    ) : null}
                  </div>
                ))}
                {cards.length === 0 ? <div className="kanban-empty">—</div> : null}
              </div>
            </div>
          );
        })}
      </div>

      {detail ? <ThreadDrawer card={detail} onClose={() => setDetail(null)} onChanged={load} /> : null}
    </div>
  );
}

function ThreadDrawer({ card, onClose, onChanged }: { card: ThreadCard; onClose: () => void; onChanged: () => void }) {
  const { env, notify } = useStore();
  const [full, setFull] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const [priority, setPriority] = useState(card.priority || "normal");
  const [assignee, setAssignee] = useState(card.assignee || "");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFull(payloadOf<any>(await rpc("threads.get", { env, submissionId: card.submissionId })));
    } catch (error) {
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
  }, [env, card.submissionId, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await rpc("threads.message", { env, submissionId: card.submissionId, body: reply.trim(), visibility });
      notify("ok", "Message sent.");
      setReply("");
      await load();
      onChanged();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    setBusy(true);
    try {
      await rpc("threads.patch", { env, submissionId: card.submissionId, patch: { priority, assignee } });
      notify("ok", "Saved.");
      onChanged();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(false);
    }
  }

  const timeline: any[] = full?.thread?.timeline || full?.timeline || [];

  return (
    <div className="dx-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="dx-modal dx-modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dx-modal-head">
          <h3 className="dx-modal-title">{card.title || card.lookup || card.submissionId}</h3>
          <span className={`chip status-${card.stage}`}>{STAGE_LABELS[card.stage] || card.stage}</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{card.lookup} · {card.creator} · {card.category} {card.instrument}</div>

        <div className="field-row">
          <div className="field">
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="field">
            <label>Assignee</label>
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="staff handle" />
          </div>
          <div className="field" style={{ alignSelf: "flex-end" }}>
            <button className="btn btn-sm" disabled={busy} onClick={saveMeta}>Save meta</button>
          </div>
        </div>

        <div className="thread-timeline">
          {loading ? <DexLoader phase="Loading" detail="timeline" /> : null}
          {timeline.map((ev, i) => {
            const internal = (ev.visibility || (ev.internalNote ? "internal" : "public")) === "internal" || Boolean(ev.internalNote);
            const body = ev.publicNote || ev.public_note || ev.internalNote || ev.internal_note || ev.note || "";
            const who = ev.actorType || ev.actor_type || "system";
            return (
              <div key={i} className={`thread-event thread-${who} ${internal ? "thread-internal" : ""}`}>
                <div className="thread-event-meta">
                  <strong>{who}</strong>
                  <span className="muted">{ev.eventType || ev.event_type || ev.stage}</span>
                  {internal ? <span className="thread-lock">internal</span> : null}
                </div>
                {body ? <div className="thread-event-body">{body}</div> : null}
              </div>
            );
          })}
          {!loading && timeline.length === 0 ? <div className="muted">No timeline events.</div> : null}
        </div>

        <div className="thread-composer">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={visibility === "public" ? "Reply to the member…" : "Internal note (staff only)…"} rows={3} />
          <div className="inline">
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as "public" | "internal")}>
              <option value="public">Public (member sees)</option>
              <option value="internal">Internal note</option>
            </select>
            <span className="grow" />
            <button className="btn btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-sm btn-primary" disabled={busy || !reply.trim()} onClick={sendReply}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
