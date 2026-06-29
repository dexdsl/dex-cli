import { useCallback, useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { payloadOf, rpc } from "../api";
import { useStore } from "../store";
import {
  ASSIGNEES,
  PRIORITIES,
  TICKET_STAGES,
  TICKET_STAGE_LABELS,
  ticketStage,
  stageTone,
  type TicketStage,
} from "../submissions";
import { DexLoader } from "./DexLoader";

export function TicketWorkspace({
  kind,
  ticketId,
  onClose,
  onChanged,
}: {
  kind: string;
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { env, notify } = useStore();
  const [ticket, setTicket] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");

  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const [pendingStage, setPendingStage] = useState<TicketStage | null>(null);

  const [priority, setPriority] = useState("normal");
  const [assignee, setAssignee] = useState("");
  const [assigneeCustom, setAssigneeCustom] = useState(false);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = payloadOf<any>(await rpc("ops.get", { env, ticketId }));
      const t = payload.ticket || payload;
      setTicket(t);
      setEvents(payload.events || t.events || []);
      setPriority(String(t.priority || "normal"));
      setAssignee(String(t.assignee || ""));
    } catch (error) {
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
  }, [env, ticketId, notify]);

  useEffect(() => { void load(); }, [load]);

  function armStage(stage: TicketStage) {
    setPendingStage(stage);
    setVisibility("public");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function toggleStage(stage: TicketStage) {
    if (pendingStage === stage) setPendingStage(null);
    else armStage(stage);
  }

  async function publishStatus() {
    if (!pendingStage) return;
    setBusy("transition");
    try {
      if (composer.trim()) {
        await rpc("ops.reply", { env, ticketId, publicNote: composer.trim(), status: pendingStage });
      } else {
        await rpc("ops.patch", { env, ticketId, status: pendingStage });
      }
      notify("ok", `Status → ${TICKET_STAGE_LABELS[pendingStage]}.`);
      setPendingStage(null);
      setComposer("");
      await load();
      onChanged();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  async function sendMessage() {
    if (!composer.trim()) return;
    setBusy("message");
    try {
      await rpc("ops.reply", {
        env,
        ticketId,
        publicNote: visibility === "public" ? composer.trim() : "",
        internalNote: visibility === "internal" ? composer.trim() : "",
      });
      notify("ok", visibility === "public" ? "Reply sent to the contact." : "Internal note saved.");
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
    if (pendingStage) void publishStatus();
    else void sendMessage();
  }

  async function patchMeta(partial: { priority?: string; assignee?: string }) {
    const nextPriority = partial.priority ?? priority;
    const nextAssignee = partial.assignee ?? assignee;
    setPriority(nextPriority);
    setAssignee(nextAssignee);
    setBusy("meta");
    try {
      await rpc("ops.patch", { env, ticketId, priority: nextPriority, assignee: nextAssignee });
      onChanged();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy("");
    }
  }

  const currentStage = ticketStage(String(ticket?.status || ""));
  const title = ticket?.title || ticket?.contact_name || ticket?.contactName || ticketId;
  const contact = ticket?.contact_name || ticket?.contactName || "";
  const email = ticket?.email || "";

  const assigneePredefined = ASSIGNEES as readonly string[];
  const showCustomAssignee = assigneeCustom || (!!assignee && !assigneePredefined.includes(assignee));

  return (
    <div className="dx-modal-overlay ws-overlay" onClick={() => !busy && onClose()}>
      <div className="dx-modal ws ws-narrow" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="ws-head">
          <div className="ws-head-copy">
            <div className="ws-kicker">{kind} ticket</div>
            <h3 className="ws-title">{title}</h3>
            <div className="ws-sub">
              {contact ? <span>{contact}</span> : null}
              {email ? <span className="ws-mono">{email}</span> : null}
            </div>
          </div>
          <div className="ws-head-side">
            <span className={`ws-status-pill tone-${stageTone(currentStage)}`}>{TICKET_STAGE_LABELS[currentStage]}</span>
            <button className="ws-close" aria-label="Close" onClick={() => !busy && onClose()}><X className="icon" /></button>
          </div>
        </header>

        {loading && !ticket ? (
          <div className="ws-body"><DexLoader phase="Loading" detail="ticket" /></div>
        ) : (
          <div className="ws-body">
            <section className="ws-section">
              <div className="ws-section-head"><h4>Status</h4><span className="ws-hint">Pick a column — add a reply below if you want the contact to see it</span></div>
              <div className="status-chips">
                {TICKET_STAGES.map((stage) => (
                  <button
                    key={stage}
                    className={`status-chip tone-${stageTone(stage)} ${pendingStage === stage ? "is-active" : ""}`}
                    disabled={!!busy}
                    onClick={() => toggleStage(stage)}
                  >
                    {TICKET_STAGE_LABELS[stage]}
                  </button>
                ))}
              </div>
            </section>

            <section className="ws-section">
              <div className="ws-meta">
                <div className="ws-meta-group">
                  <span className="ws-meta-label">Priority</span>
                  <div className="meta-chips">
                    {PRIORITIES.map((value) => (
                      <button key={value} className={`meta-chip pri-${value} ${priority === value ? "is-active" : ""}`} disabled={!!busy} onClick={() => patchMeta({ priority: value })}>{value}</button>
                    ))}
                  </div>
                </div>
                <div className="ws-meta-group">
                  <span className="ws-meta-label">Assignee</span>
                  <div className="meta-chips">
                    {assigneePredefined.map((name) => (
                      <button key={name} className={`meta-chip ${assignee === name ? "is-active" : ""}`} disabled={!!busy} onClick={() => { setAssigneeCustom(false); patchMeta({ assignee: name }); }}>{name}</button>
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
                      <button className="meta-chip is-ghost" disabled={!!busy} onClick={() => { setAssigneeCustom(true); setAssignee(""); }}>Someone else…</button>
                    )}
                    {assignee ? <button className="meta-chip is-ghost" disabled={!!busy} onClick={() => { setAssigneeCustom(false); patchMeta({ assignee: "" }); }}>Clear</button> : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="ws-section ws-conversation">
              <div className="ws-section-head"><h4>Conversation</h4><span className="ws-hint">{events.length} events</span></div>
              <div className="ws-timeline">
                {!events.length ? <div className="muted">No events yet.</div> : null}
                {events.map((ev: any, index: number) => {
                  const pub = ev.public_note || ev.publicNote;
                  const intern = ev.internal_note || ev.internalNote;
                  const actor = pub ? "staff" : intern ? "staff" : "system";
                  const body = pub || intern || "";
                  return (
                    <article key={ev.id || index} className={`thread-event thread-${actor} ${intern && !pub ? "thread-internal" : ""}`}>
                      <div className="thread-event-meta">
                        <strong>{ev.event_type || ev.type || ev.stage || "event"}</strong>
                        {ev.status ? <span className="chip chip-mini">{ev.status}</span> : null}
                        <span className="muted">{ev.created_at || ev.event_at || ev.createdAt || ""}</span>
                        {intern && !pub ? <span className="thread-lock">internal</span> : null}
                      </div>
                      {body ? <div className="thread-event-body">{body}</div> : null}
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {ticket ? (
          <footer className={`ws-composer ${pendingStage ? "is-status" : ""}`}>
            {pendingStage ? (
              <div className={`composer-banner tone-${stageTone(pendingStage)}`}>
                <span className="composer-banner-copy">
                  Moving to <strong>{TICKET_STAGE_LABELS[pendingStage]}</strong>. Add a reply to notify the contact, or leave blank for a silent status change.
                </span>
                <button className="composer-banner-cancel" onClick={() => setPendingStage(null)}><X className="icon" /> Cancel</button>
              </div>
            ) : null}
            <div className="composer-input">
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder={pendingStage ? "Optional reply to the contact…" : visibility === "public" ? "Reply to the contact…" : "Internal note…"}
                rows={3}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleSend(); }}
              />
              <div className="composer-actions">
                {!pendingStage ? (
                  <div className="composer-vis seg seg-sm">
                    <button className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>Public</button>
                    <button className={visibility === "internal" ? "on" : ""} onClick={() => setVisibility("internal")}>Internal</button>
                  </div>
                ) : null}
                <span className="grow" />
                <button
                  className="btn btn-primary btn-sm composer-send"
                  disabled={!!busy || (pendingStage ? false : !composer.trim())}
                  onClick={handleSend}
                >
                  <Send className="icon" />
                  {busy === "message" || busy === "transition"
                    ? "Sending…"
                    : pendingStage ? (composer.trim() ? "Update + reply" : "Update status") : visibility === "public" ? "Send" : "Save note"}
                </button>
              </div>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
