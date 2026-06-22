// Domain types for the ops dashboard. Kept intentionally loose — the bridge
// returns whatever the site-repo modules produce; these describe the fields the
// UI actually reads.

export type Env = "test" | "prod";

export const BUCKETS = ["A", "B", "C", "D", "E", "X"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type EntryListItem = {
  slug: string;
  title: string;
  lookupNumber: string;
  buckets: string[];
  updatedAt: string;
  error?: boolean;
};

export type EntryFolder = {
  slug: string;
  folder: string;
  entry: any;
  descriptionText: string;
  manifest: any;
  indexHtml: string;
};

export type OpsKind = "submission" | "press" | "board" | "support";

export type OpsTicket = {
  ticket_id?: string;
  ticketId?: string;
  kind?: string;
  title?: string;
  status?: string;
  email?: string;
  contact_name?: string;
  contactName?: string;
  priority?: string;
  assignee?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type PollDef = {
  id?: string;
  pollId?: string;
  slug?: string;
  question?: string;
  status?: string;
  visibility?: string;
  options?: Array<{ label?: string } | string>;
  close_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ProfileClaim = {
  claim_id?: string;
  claimId?: string;
  auth0_sub?: string;
  entry_lookup?: string;
  entry_slug?: string;
  entry_href?: string;
  entry_title?: string;
  role?: string;
  status?: string;
  created_at?: string | number;
  updated_at?: string | number;
  // Claimant metadata (joined from user_profiles by the admin API).
  name?: string;
  credit_name?: string;
  social_name?: string;
  avatar_url?: string;
  handle?: string;
  profile_url?: string;
  dex_id?: string;
  profile_public?: boolean;
  pronouns?: string;
  location?: string;
  [key: string]: unknown;
};

export function ticketId(t: OpsTicket): string {
  return String(t.ticket_id || t.ticketId || "");
}

export function pollId(p: PollDef): string {
  return String(p.id || p.pollId || p.slug || "");
}

export function claimId(c: ProfileClaim): string {
  return String(c.claim_id || c.claimId || "");
}
