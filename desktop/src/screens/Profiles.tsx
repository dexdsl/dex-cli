import { useCallback, useEffect, useState, type ReactNode } from "react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { type ProfileClaim, claimId } from "../domain";
import { DexLoader, SkeletonRows } from "../components/DexLoader";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";
import { setProfilesDirty, useProfilesDirty } from "../dirty";
import { syncProfilesMap } from "../profilesSync";

const STATUSES = ["pending", "approved", "rejected", "revoked"] as const;
type ClaimStatus = (typeof STATUSES)[number];
type NextStatus = "approved" | "rejected" | "revoked";

// Public site that hosts the member profile (/u/...) and entry pages.
const PUBLIC_SITE_BASE = "https://dexdsl.github.io";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  revoked: "Revoked",
  withdrawn: "Withdrawn",
};

// Every action available for a claim in a given status.
function actionsFor(status: string): Array<{ label: string; next: NextStatus; danger?: boolean }> {
  switch (status) {
    case "pending":
      return [
        { label: "Approve", next: "approved" },
        { label: "Reject", next: "rejected", danger: true },
      ];
    case "approved":
      return [{ label: "Revoke", next: "revoked", danger: true }];
    case "rejected":
      return [{ label: "Approve", next: "approved" }];
    case "revoked":
      return [
        { label: "Restore", next: "approved" },
        { label: "Reject", next: "rejected", danger: true },
      ];
    default:
      return [
        { label: "Approve", next: "approved" },
        { label: "Reject", next: "rejected", danger: true },
      ];
  }
}

function formatDate(value?: string | number): string {
  if (value === undefined || value === null || value === "") return "—";
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(String(value));
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

export function ProfilesScreen() {
  const [tab, setTab] = useState<"claims" | "map">("claims");
  const { env } = useStore();
  const dirty = useProfilesDirty(env);
  return (
    <div className="stack">
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button className={tab === "claims" ? "on" : ""} onClick={() => setTab("claims")}>Claims</button>
        <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>
          Public map {dirty ? <span className="dx-dirty-dot" title="Unsynced changes" /> : null}
        </button>
      </div>
      {tab === "claims" ? <ClaimsTab /> : <PublicMapTab />}
    </div>
  );
}

function ClaimsTab() {
  const { env, notify } = useStore();
  const [status, setStatus] = useState<ClaimStatus>("pending");
  const [claims, setClaims] = useState<ProfileClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [detail, setDetail] = useState<ProfileClaim | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = payloadOf<any>(await rpc("profiles.claims", { env, status, limit: 200 }));
      const list: ProfileClaim[] = payload.claims || payload.items || [];
      setClaims(Array.isArray(list) ? list : []);
    } catch (error) {
      notify("err", String(error));
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }, [env, status, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // Optimistic + click-guarded: the claim leaves the current tab immediately,
  // the request runs in the background, and we revert (reload) on failure.
  const runDecision = useCallback(
    async (claim: ProfileClaim, next: NextStatus) => {
      const id = claimId(claim);
      if (!id || busy) return;
      setBusy(id);
      setDetail(null);
      setClaims((prev) => prev.filter((item) => claimId(item) !== id));
      try {
        await rpc("profiles.updateClaim", { env, claimId: id, status: next, role: claim.role });
        setProfilesDirty(env, true);
        notify("ok", `Claim ${STATUS_LABEL[next] || next}.`);
      } catch (error) {
        notify("err", String(error));
        load();
      } finally {
        setBusy(null);
      }
    },
    [env, busy, notify, load],
  );

  // Confirm every mutating action when pointed at prod.
  const requestDecision = useCallback(
    (claim: ProfileClaim, next: NextStatus, label: string) => {
      const run = () => runDecision(claim, next);
      if (env !== "prod") {
        run();
        return;
      }
      const name = claim.name || claim.credit_name || claim.auth0_sub || "this member";
      const entry = claim.entry_title || claim.entry_lookup || claimId(claim);
      setConfirmState({
        title: `${label} claim?`,
        body: (
          <>
            <p style={{ margin: "0 0 8px" }}>
              <strong>{name}</strong> &rarr; <strong>{entry}</strong>
            </p>
            <p className="muted" style={{ margin: 0 }}>
              This runs against <strong>prod</strong>
              {next === "approved" ? " and makes the credit publicly visible." : " and removes the public credit."}{" "}
              Remember to run <strong>Sync to repo</strong> afterward.
            </p>
          </>
        ),
        confirmLabel: label,
        danger: next !== "approved",
        onConfirm: run,
      });
    },
    [env, runDecision],
  );

  return (
    <div className="stack">
      <div className="inline">
        <div className="seg">
          {STATUSES.map((value) => (
            <button key={value} className={status === value ? "on" : ""} onClick={() => setStatus(value)}>
              {value}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      <div className="panel" style={{ padding: "var(--dx-space-sm)", position: "relative" }}>
        {busy ? <DexLoader phase="Updating" detail="applying claim change" /> : null}

        {loading ? (
          <>
            <DexLoader phase="Loading" detail={`${status} claims`} />
            <SkeletonRows rows={3} />
          </>
        ) : (
          <div className="list">
            {claims.length === 0 && <div className="muted" style={{ padding: 16 }}>No {status} claims.</div>}
            {claims.map((claim) => {
              const id = claimId(claim);
              const name = claim.name || claim.credit_name || "Unknown member";
              return (
                <div
                  className="row claim-card claim-card-click"
                  key={id}
                  onClick={() => setDetail(claim)}
                  title="View claim details"
                >
                  <span className="grow claim-main">
                    <div className="row-title">{claim.entry_title || claim.entry_lookup || id}</div>
                    <div className="claim-meta">
                      <span className="claim-name">{name}</span>
                      {claim.dex_id ? <span className="chip chip-mini">{claim.dex_id}</span> : null}
                      {claim.profile_public === false ? <span className="chip chip-mini chip-warn">private</span> : null}
                    </div>
                    <div className="claim-meta claim-meta-sub">
                      {claim.entry_lookup ? <span>{claim.entry_lookup}</span> : null}
                      <span>role: {claim.role || "—"}</span>
                      <span>submitted {formatDate(claim.created_at)}</span>
                    </div>
                  </span>

                  <span className="inline claim-actions" onClick={(event) => event.stopPropagation()}>
                    {actionsFor(claim.status || status).map((action) => (
                      <button
                        key={action.next}
                        className={`btn btn-sm ${action.danger ? "btn-danger" : action.label === "Approve" || action.label === "Restore" ? "btn-primary" : ""}`}
                        disabled={busy === id}
                        onClick={() => requestDecision(claim, action.next, action.label)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detail ? (
        <ClaimDetailModal
          claim={detail}
          busy={busy === claimId(detail)}
          onClose={() => setDetail(null)}
          onAction={(next, label) => requestDecision(detail, next, label)}
        />
      ) : null}
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dx-detail-row">
      <span className="dx-detail-label">{label}</span>
      <span className="dx-detail-value">{children}</span>
    </div>
  );
}

function ClaimDetailModal({
  claim,
  busy,
  onClose,
  onAction,
}: {
  claim: ProfileClaim;
  busy: boolean;
  onClose: () => void;
  onAction: (next: NextStatus, label: string) => void;
}) {
  const name = claim.name || claim.credit_name || "Unknown member";
  const profileUrl = claim.profile_url ? `${PUBLIC_SITE_BASE}${claim.profile_url}` : "";
  const entryUrl = claim.entry_href ? `${PUBLIC_SITE_BASE}${claim.entry_href}` : "";
  return (
    <div className="dx-modal-overlay" onClick={onClose}>
      <div className="dx-modal dx-modal-wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="dx-modal-head">
          <h3 className="dx-modal-title">{claim.entry_title || claim.entry_lookup || claimId(claim)}</h3>
          <span className={`chip status-${claim.status || ""}`}>{STATUS_LABEL[String(claim.status)] || claim.status}</span>
        </div>

        {busy ? <DexLoader phase="Updating" detail="applying claim change" /> : null}

        <div className="dx-detail-grid">
          <DetailRow label="Member">{name}</DetailRow>
          {claim.social_name && claim.social_name !== name ? <DetailRow label="Social name">{claim.social_name}</DetailRow> : null}
          {claim.credit_name && claim.credit_name !== name ? <DetailRow label="Credit name">{claim.credit_name}</DetailRow> : null}
          <DetailRow label="Profile">
            {profileUrl ? (
              <a href={profileUrl} target="_blank" rel="noreferrer">{claim.profile_url}</a>
            ) : (
              <span className="muted">no public handle</span>
            )}
            {claim.profile_public === false ? <span className="chip chip-mini chip-warn" style={{ marginLeft: 8 }}>private</span> : null}
          </DetailRow>
          <DetailRow label="Dex ID">{claim.dex_id || "—"}</DetailRow>
          <DetailRow label="Entry">
            <div style={{ display: "grid", gap: 2 }}>
              <span>{claim.entry_lookup || "—"}</span>
              {entryUrl ? <a href={entryUrl} target="_blank" rel="noreferrer">{claim.entry_href}</a> : null}
            </div>
          </DetailRow>
          <DetailRow label="Role">{claim.role || "—"}</DetailRow>
          {claim.location ? <DetailRow label="Location">{claim.location}</DetailRow> : null}
          <DetailRow label="Submitted">{formatDate(claim.created_at)}</DetailRow>
          <DetailRow label="Updated">{formatDate(claim.updated_at)}</DetailRow>
          <DetailRow label="Auth0 sub">
            <span className="claim-sub-id" style={{ maxWidth: "none" }}>{claim.auth0_sub}</span>
          </DetailRow>
        </div>

        <div className="dx-modal-actions">
          <button className="btn btn-sm" onClick={onClose}>Close</button>
          {actionsFor(claim.status || "").map((action) => (
            <button
              key={action.next}
              className={`btn btn-sm ${action.danger ? "btn-danger" : "btn-primary"}`}
              disabled={busy}
              onClick={() => onAction(action.next, action.label)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PublicMapTab() {
  const { env, notify } = useStore();
  const dirty = useProfilesDirty(env);
  const [map, setMap] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMap(payloadOf<any>(await rpc("profiles.publicMap", { env })));
    } catch (error) {
      notify("err", String(error));
      setMap(null);
    } finally {
      setLoading(false);
    }
  }, [env, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    if (syncing) return;
    if (!confirm("Sync the public profiles map to data/, docs/data/ and public/data/?")) return;
    setSyncing(true);
    try {
      const written = await syncProfilesMap(env);
      notify("ok", `Synced ${written.entries ?? 0} entries, ${written.profiles ?? 0} profiles to ${written.targets?.length ?? 0} files.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSyncing(false);
    }
  }

  const allKeys = map?.entries && typeof map.entries === "object" ? Object.entries(map.entries) : [];
  // Each credited entry is keyed up to 4 ways (lookup, folded lookup, slug,
  // href). The href key (starts with "/") is exactly one per entry, so use it
  // for an honest count and a de-duplicated display.
  const entryRows = allKeys.filter(([key]) => key.startsWith("/"));
  const displayRows = entryRows.length ? entryRows : allKeys;
  const profiles = map?.profiles && typeof map.profiles === "object" ? Object.keys(map.profiles) : [];
  const profileCount = Math.ceil(profiles.length / 2) || profiles.length;

  return (
    <div className="stack">
      {dirty ? (
        <div className="dx-dirty-banner">
          <span><span className="dx-dirty-dot" /> Unsynced claim changes — run <strong>Sync to repo</strong> so published entry pages update.</span>
        </div>
      ) : null}

      <div className="inline">
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>Refresh</button>
        <button className={`btn btn-sm ${dirty ? "btn-primary" : "btn-ghost"}`} disabled={syncing} onClick={sync}>
          {syncing ? "Syncing…" : dirty ? "Sync to repo •" : "Sync to repo"}
        </button>
      </div>
      <div className="muted">
        {profileCount} public profile{profileCount === 1 ? "" : "s"} · {entryRows.length} credited entr{entryRows.length === 1 ? "y" : "ies"} · {allKeys.length} lookup aliases
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        "Sync to repo" writes this credit map to <code>data/</code>, <code>docs/data/</code> and <code>public/data/public-profiles.json</code>,
        so published entry pages can link each credited performer to their <code>/u/…</code> profile. Member <code>/u/…</code> pages update live; the
        entry-page links only update after a sync.
      </div>

      <div className="panel" style={{ padding: "var(--dx-space-sm)" }}>
        {loading ? (
          <>
            <DexLoader phase="Loading" detail="public credit map" />
            <SkeletonRows rows={3} />
          </>
        ) : (
          <div className="list">
            {displayRows.length === 0 && <div className="muted" style={{ padding: 16 }}>No public map data.</div>}
            {displayRows.slice(0, 300).map(([key, value]: [string, any]) => {
              const handle = value && typeof value === "object" ? (value.handle || "") : "";
              const credit = value && typeof value === "object" ? (value.credit_name || "") : "";
              return (
                <div className="row" key={key} style={{ cursor: "default" }}>
                  <span className="grow">
                    <div className="row-title">{key}</div>
                    <div className="row-sub">{credit || "—"}{handle ? ` · /u/${handle}/` : ""}</div>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
