import { useState } from "react";
import { SubmissionsBoard } from "./SubmissionsBoard";
import { TicketBoard } from "./TicketBoard";
import { QUEUES } from "../submissions";

export function SubmissionsScreen() {
  const [queue, setQueue] = useState(QUEUES[0].id);
  const active = QUEUES.find((q) => q.id === queue) || QUEUES[0];

  return (
    <div className="stack submissions-screen">
      <div className="queue-switcher" role="tablist" aria-label="Queues">
        {QUEUES.map((q) => (
          <button
            key={q.id}
            role="tab"
            aria-selected={queue === q.id}
            className={`queue-tab ${queue === q.id ? "is-active" : ""}`}
            onClick={() => setQueue(q.id)}
          >
            {q.label}
          </button>
        ))}
      </div>

      {active.type === "threads"
        ? <SubmissionsBoard />
        : <TicketBoard key={active.id} kind={active.id} />}
    </div>
  );
}
