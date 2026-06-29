import { useCallback, useEffect, useState } from "react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { DexLoader, SkeletonRows } from "../components/DexLoader";
import { ThreadWorkspace } from "../components/ThreadWorkspace";
import { BOARD_STAGES, STAGE_LABELS, stageTone, type SubmissionStage, type ThreadCard } from "../submissions";

function ago(unix: number | null): string {
  if (!unix) return "";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

// Aging signal from last activity (proxy for SLA): fresh < 1d, warn < 3d, stale ≥ 3d.
function ageLevel(unix: number | null): "fresh" | "warn" | "stale" {
  if (!unix) return "fresh";
  const days = (Date.now() / 1000 - unix) / 86400;
  if (days >= 3) return "stale";
  if (days >= 1) return "warn";
  return "fresh";
}

const FILTERS_KEY = "dx.board.filters";
type BoardFilters = { search: string; priority: string };
function loadFilters(): BoardFilters {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTERS_KEY) || "{}");
    return { search: String(raw.search || ""), priority: String(raw.priority || "") };
  } catch {
    return { search: "", priority: "" };
  }
}

export function SubmissionsBoard() {
  const { env, notify } = useStore();
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<{ card: ThreadCard; requestedStage: SubmissionStage | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(loadFilters);
  const [swimlane, setSwimlane] = useState<"none" | "assignee">("none");

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const filtered = threads.filter((t) => {
    if (filters.priority && (t.priority || "normal") !== filters.priority) return false;
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      const hay = `${t.title} ${t.lookup} ${t.creator} ${t.assignee} ${t.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const lanes = swimlane === "assignee"
    ? Array.from(new Set(filtered.map((t) => t.assignee || "Unassigned"))).sort()
    : ["__all__"];

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
    async (submissionId: string, stage: SubmissionStage) => {
      const card = threads.find((t) => t.submissionId === submissionId);
      if (!card || card.stage === stage) return;
      setDetail({ card, requestedStage: stage });
    },
    [threads],
  );

  if (loading && !threads.length) {
    return (
      <div className="panel" style={{ padding: "var(--dx-space-sm)" }}>
        <DexLoader phase="Loading" detail="submission board" />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const renderCard = (card: ThreadCard) => {
    const age = ageLevel(card.updatedAt);
    return (
      <div
        key={card.submissionId}
        className={`kanban-card pri-${card.priority || "normal"}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", card.submissionId);
          setDragId(card.submissionId);
        }}
        onDragEnd={() => setDragId(null)}
        onClick={() => setDetail({ card, requestedStage: null })}
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
          <span className={`kanban-sla kanban-sla-${age}`} title="Time since last activity">{ago(card.updatedAt)}</span>
        </div>
        {card.tags.length ? (
          <div className="kanban-tags">
            {card.tags.slice(0, 3).map((t) => <span className="kanban-tag" key={t}>{t}</span>)}
          </div>
        ) : null}
      </div>
    );
  };

  const renderBoard = (cards: ThreadCard[]) => (
    <div className="kanban">
      {BOARD_STAGES.map((stage) => {
        const stageCards = cards.filter((t) => t.stage === stage);
        return (
          <div
            key={stage}
            className={`kanban-col kanban-${stage} tone-${stageTone(stage)}`}
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
              <span className="kanban-count">{stageCards.length}</span>
            </div>
            <div className="kanban-cards">
              {stageCards.map(renderCard)}
              {stageCards.length === 0 ? <div className="kanban-empty">—</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="stack board-fill">
      <div className="inline board-filters">
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>Refresh</button>
        <input
          className="board-search"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search title, lookup, creator, tag…"
        />
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select value={swimlane} onChange={(e) => setSwimlane(e.target.value as "none" | "assignee")} title="Swimlanes">
          <option value="none">No swimlanes</option>
          <option value="assignee">By assignee</option>
        </select>
        <span className="muted">{filtered.length}/{threads.length}</span>
      </div>

      <div className={`board-lanes ${swimlane === "assignee" ? "is-swimlanes" : ""}`}>
        {lanes.map((lane) => {
          const laneCards = swimlane === "assignee"
            ? filtered.filter((t) => (t.assignee || "Unassigned") === lane)
            : filtered;
          return (
            <div key={lane} className="board-lane">
              {swimlane === "assignee" ? <div className="board-lane-head">@{lane} · {laneCards.length}</div> : null}
              {renderBoard(laneCards)}
            </div>
          );
        })}
      </div>

      {detail ? (
        <ThreadWorkspace
          card={detail.card}
          requestedStage={detail.requestedStage}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}
