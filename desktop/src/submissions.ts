export type SubmissionStage =
  | "sent"
  | "received"
  | "acknowledged"
  | "reviewing"
  | "revision_requested"
  | "accepted"
  | "producing"
  | "preflight"
  | "in_library"
  | "rejected";

export type ThreadCard = {
  submissionId: string;
  auth0Sub: string;
  title: string;
  lookup: string;
  creator: string;
  category: string;
  instrument: string;
  stage: SubmissionStage;
  statusRaw: string;
  latestPublicNote: string;
  entrySlug: string;
  entryHref: string;
  lookupPublishedAt: number | null;
  preflightVerifiedAt: number | null;
  publicationVerifiedAt: number | null;
  workflowVersion: number;
  kind: string;
  assignee: string;
  priority: string;
  tags: string[];
  updatedAt: number | null;
};

export type WorkflowTransition = {
  toStage: SubmissionStage;
  label: string;
  memberLabel: string;
  allowed: boolean;
  blockers: Array<{ code: string; message: string }>;
  suggestedPublicNote: string;
  requiresPublicNote: boolean;
};

export type ThreadWorkflow = {
  workflowVersion: number;
  currentStage: SubmissionStage;
  transitions: WorkflowTransition[];
  lookup: {
    generated: string;
    final: string;
    effective: string;
    publishedAt: string;
  };
  entryLink: {
    slug: string;
    href: string;
    linkedAt: string;
    linkedBy: string;
  };
  preflight: { evidence: Record<string, unknown>; verifiedAt: string };
  publication: {
    commitSha: string;
    evidence: Record<string, unknown>;
    verifiedAt: string;
    libraryHref: string;
  };
};

export const STAGE_LABELS: Record<SubmissionStage, string> = {
  sent: "Sent",
  received: "Received",
  acknowledged: "Acknowledged",
  reviewing: "Reviewing",
  revision_requested: "Revisions",
  accepted: "Accepted",
  producing: "Producing",
  preflight: "Preflight",
  in_library: "In library",
  rejected: "Rejected",
};

export const BOARD_STAGES: SubmissionStage[] = [
  "received",
  "acknowledged",
  "reviewing",
  // Audit fix: revision_requested threads were stranded off-board (not in this
  // list), so a submission awaiting revisions silently disappeared from the
  // kanban. Surface it between reviewing and accepted where it belongs.
  "revision_requested",
  "accepted",
  "producing",
  "preflight",
  "in_library",
  "rejected",
];

/** Accent family for a stage — drives column + chip color without per-stage CSS. */
export function stageTone(stage: SubmissionStage | TicketStage): "neutral" | "active" | "positive" | "negative" {
  switch (stage) {
    case "accepted":
    case "producing":
    case "preflight":
    case "in_library":
      return "positive";
    case "rejected":
      return "negative";
    case "reviewing":
    case "revision_requested":
    case "acknowledged":
      return "active";
    default:
      return "neutral";
  }
}

/* --------------------------------------------------------------- queues --- */
// The submissions screen is a single kanban surface; this list drives the queue
// switcher. "threads" = the workflow board (stages); "tickets" = ops queues that
// mirror the submission stages over free-form ticket statuses.
export type QueueType = "threads" | "tickets";
export type QueueDef = { id: string; label: string; type: QueueType };

export const QUEUES: QueueDef[] = [
  { id: "submission", label: "Submissions", type: "threads" },
  { id: "press", label: "Press", type: "tickets" },
  { id: "board", label: "Board", type: "tickets" },
  { id: "support", label: "Support", type: "tickets" },
];

// Ticket queues mirror the submission stages (minus production-only stages that
// don't apply to a press/support ticket), plus a terminal "closed".
export type TicketStage =
  | "received"
  | "acknowledged"
  | "reviewing"
  | "accepted"
  | "rejected"
  | "closed";

export const TICKET_STAGES: TicketStage[] = [
  "received",
  "acknowledged",
  "reviewing",
  "accepted",
  "rejected",
  "closed",
];

export const TICKET_STAGE_LABELS: Record<TicketStage, string> = {
  received: "Received",
  acknowledged: "Acknowledged",
  reviewing: "Reviewing",
  accepted: "Accepted",
  rejected: "Rejected",
  closed: "Closed",
};

/** Bucket a free-form ticket status string into one of the board columns. */
export function ticketStage(status: string): TicketStage {
  const s = String(status || "").toLowerCase().trim();
  if ((TICKET_STAGES as string[]).includes(s)) return s as TicketStage;
  if (["new", "open", "queued", "pending", "submitted", "inbox"].includes(s)) return "received";
  if (["ack", "acknowledged", "received_ack"].includes(s)) return "acknowledged";
  if (["in_progress", "in-progress", "working", "triage", "review", "investigating"].includes(s)) return "reviewing";
  if (["approved", "done", "fulfilled", "sent"].includes(s)) return "accepted";
  if (["declined", "denied", "spam"].includes(s)) return "rejected";
  if (["resolved", "archived", "complete", "completed"].includes(s)) return "closed";
  return "received";
}

// Default member-facing copy per stage, used to prefill the composer when the
// server doesn't supply a suggestedPublicNote for a transition.
export const DEFAULT_STAGE_NOTE: Partial<Record<SubmissionStage, string>> = {
  acknowledged: "Thanks for your submission — it's in our review queue and we'll follow up here soon.",
  reviewing: "Your submission is now in editorial review with the Dex team.",
  revision_requested: "We'd like a revision before we continue. We'll share the specifics here — reply when it's ready.",
  accepted: "Congratulations — your submission has been accepted for the Dex library. We'll now prepare its entry; it isn't public yet.",
  producing: "We're preparing your entry and files for the library.",
  preflight: "Final checks are underway before your entry goes live.",
  in_library: "Your entry is now live in the Dex library.",
  rejected: "After review, the Dex team isn't moving this submission into the library at this time. Thank you for sharing it with us.",
};

/* ------------------------------------------------- lookup generation --- */
// Ported from scripts/src/submit.samples.entry.mjs (buildGeneratedSubmissionLookup)
// so the ops app suggests *final* lookups that match the canonical catalog
// format. The operator-published value is the source of truth, so getting this
// right here is what makes lookups line up:
//   SUB{nn}-{instrumentType}.{instrumentPrefix} {performer} {collection}{year}
//   e.g. SUB01-K.Pre Su AV2026

function lookupWord(value: string, length: number, fallback: string): string {
  const letters = String(value || "").replace(/[^A-Za-z]/g, "");
  if (!letters) return fallback;
  const normalized = letters.slice(0, Math.max(1, length)).padEnd(length, "X").slice(0, length);
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
}

function instrumentTypeCode(category: string): string {
  const first = String(category || "").toUpperCase().match(/[A-Z]/)?.[0] || "";
  return ["K", "B", "E", "S", "W", "P", "V", "X"].includes(first) ? first : "X";
}

function collectionTypeCode(value: string): string {
  const raw = String(value || "").toUpperCase();
  if (raw === "AV") return "AV";
  if (raw === "A" || raw.includes("AUDIO")) return "A";
  if (raw === "V" || raw.includes("VIDEO")) return "V";
  return "O";
}

// Best-available name → 2-letter performer token (matches parsePerformerToken):
// take the surname (after a comma, else the last word), first two letters,
// Title-cased; "Un" when there's nothing usable.
function performerToken(name: string): string {
  const raw = String(name || "").trim();
  let surname = "";
  if (raw.includes(",")) surname = raw.split(",")[0].trim();
  else {
    const parts = raw.split(/\s+/).filter(Boolean);
    surname = parts[parts.length - 1] || "";
  }
  const letters = surname.replace(/[^A-Za-z]/g, "");
  if (!letters) return "Un";
  const token = letters.slice(0, 2).padEnd(2, "X");
  return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`;
}

export const GENERATED_LOOKUP_REGEX = /^SUB(\d{2,})-([A-Z])\.([A-Za-z]+)\s([A-Za-z]{2})\s(AV|A|V|O)(\d{4})$/;

/** Extract sequence/collection/year from an existing lookup so they stay stable
 * while the name/instrument-derived parts are regenerated. */
export function parseLookupParts(lookup: string): { counter?: number; collection?: string; year?: number } {
  const m = GENERATED_LOOKUP_REGEX.exec(String(lookup || "").trim());
  if (!m) return {};
  return { counter: Number(m[1]), collection: m[5], year: Number(m[6]) };
}

/** Pick the best name for the performer token: chosen/credit name over the raw
 * submitted name. Accepts a loose record (the server thread or a ThreadCard). */
export function bestSubmissionName(source: Record<string, any>, fallback = ""): string {
  return String(
    source?.creditName || source?.credit_name
      || source?.chosenName || source?.chosen_name
      || source?.displayName || source?.display_name
      || source?.creator || source?.contactName || source?.contact_name
      || fallback || "",
  ).trim();
}

export function buildSubmissionLookup(input: {
  name?: string;
  category?: string;
  instrument?: string;
  collection?: string;
  counter?: number;
  year?: number;
}): string {
  const counter = String(Math.max(1, Math.trunc(Number(input.counter) || 1))).padStart(2, "0");
  const type = instrumentTypeCode(input.category || "");
  const prefix = lookupWord(input.instrument || "", 3, "Unk");
  const performer = performerToken(input.name || "");
  const collection = collectionTypeCode(input.collection || "AV");
  const year = Math.trunc(Number(input.year) || new Date().getFullYear());
  return `SUB${counter}-${type}.${prefix} ${performer} ${collection}${year}`;
}

/* --------------------------------------------------------- assignees --- */
// Predefined operators for one-click assignment; "Someone else" prompts for a
// custom handle (like the "Other" option in a multiple-choice list).
export const ASSIGNEES = ["Cameron", "Seb"] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;
