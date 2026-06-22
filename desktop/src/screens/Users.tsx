import { useCallback, useEffect, useState } from "react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";
import { DexLoader, SkeletonRows } from "../components/DexLoader";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";

const PUBLIC_SITE_BASE = "https://dexdsl.github.io";
const PER_PAGE = 50;

type UserAction = "resend_verification" | "block" | "unblock" | "delete";

type Auth0User = {
  user_id: string;
  email?: string;
  email_verified?: boolean;
  blocked?: boolean;
  name?: string;
  nickname?: string;
  picture?: string;
  logins_count?: number;
  last_login?: string | null;
  created_at?: string | null;
  connection?: string;
  auth0_url?: string;
  dex_id?: string;
  handle?: string;
  credit_name?: string;
  profile_public?: boolean;
  profile_url?: string;
  has_profile?: boolean;
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : String(value);
}

export function UsersScreen() {
  const { env, notify } = useStore();
  const [users, setUsers] = useState<Auth0User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = payloadOf<any>(await rpc("users.list", { env, page, perPage: PER_PAGE, q: query }));
      setUsers(Array.isArray(payload.users) ? payload.users : []);
      setTotal(Number(payload.total || 0));
    } catch (error) {
      notify("err", String(error));
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [env, page, query, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = useCallback(
    async (user: Auth0User, action: UserAction) => {
      if (busy) return;
      setBusy(user.user_id);
      try {
        await rpc("users.action", { env, userId: user.user_id, action });
        if (action === "delete") {
          setUsers((prev) => prev.filter((item) => item.user_id !== user.user_id));
          notify("ok", "User deleted.");
        } else if (action === "block" || action === "unblock") {
          setUsers((prev) => prev.map((item) => (item.user_id === user.user_id ? { ...item, blocked: action === "block" } : item)));
          notify("ok", action === "block" ? "User blocked." : "User unblocked.");
        } else {
          notify("ok", "Verification email sent.");
        }
      } catch (error) {
        notify("err", String(error));
      } finally {
        setBusy(null);
      }
    },
    [env, busy, notify],
  );

  // Confirm destructive actions always; confirm everything in prod.
  const requestAction = useCallback(
    (user: Auth0User, action: UserAction, label: string, danger = false) => {
      const run = () => runAction(user, action);
      const who = user.name || user.email || user.user_id;
      const mustConfirm = action === "delete" || env === "prod";
      if (!mustConfirm) {
        run();
        return;
      }
      const detail =
        action === "delete"
          ? "This permanently deletes the Auth0 account and removes their Dex profile + claims. This cannot be undone."
          : action === "block"
            ? "The user will be unable to sign in until unblocked."
            : action === "unblock"
              ? "The user will be able to sign in again."
              : "Auth0 will email them a new verification link.";
      setConfirmState({
        title: `${label}?`,
        body: (
          <>
            <p style={{ margin: "0 0 8px" }}><strong>{who}</strong></p>
            <p className="muted" style={{ margin: 0 }}>
              {detail}{env === "prod" ? " Running against prod." : ""}
            </p>
          </>
        ),
        confirmLabel: label,
        danger,
        onConfirm: run,
      });
    },
    [env, runAction],
  );

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="stack">
      <form
        className="inline"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setQuery(q.trim());
        }}
      >
        <input
          placeholder="Search name, email, handle…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--dx-border)", background: "var(--dx-surface-strong)" }}
        />
        <button className="btn btn-sm btn-primary" type="submit">Search</button>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => {
            setQ("");
            setQuery("");
            setPage(0);
          }}
        >
          Clear
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={load} disabled={loading}>Refresh</button>
      </form>

      <div className="muted">{total} user{total === 1 ? "" : "s"} · page {page + 1} of {totalPages}</div>

      <div className="panel" style={{ padding: "var(--dx-space-sm)" }}>
        {loading ? (
          <>
            <DexLoader phase="Loading" detail="Auth0 directory" />
            <SkeletonRows rows={4} />
          </>
        ) : (
        <div className="list">
          {users.length === 0 && <div className="muted" style={{ padding: 16 }}>No users found.</div>}
          {users.map((user) => (
            <div className="row claim-card" key={user.user_id} style={{ cursor: "default" }}>
              {user.picture ? (
                <img
                  className="user-avatar"
                  src={user.picture}
                  alt=""
                  onError={(event) => {
                    (event.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
              ) : (
                <span className="user-avatar user-avatar-empty" aria-hidden="true" />
              )}
              <span className="grow claim-main">
                <div className="row-title">{user.name || user.nickname || user.email || user.user_id}</div>

                <div className="claim-meta">
                  <span>{user.email || "no email"}</span>
                  {user.email_verified ? (
                    <span className="chip chip-mini">verified</span>
                  ) : (
                    <span className="chip chip-mini chip-warn">unverified</span>
                  )}
                  {user.connection ? <span className="chip chip-mini">{user.connection}</span> : null}
                  {user.blocked ? <span className="chip chip-mini chip-warn">blocked</span> : null}
                </div>

                <div className="claim-meta claim-meta-sub">
                  <span>{user.logins_count ?? 0} logins</span>
                  <span>last {formatDate(user.last_login)}</span>
                  <span>joined {formatDate(user.created_at)}</span>
                </div>

                <div className="claim-links">
                  {user.has_profile ? (
                    <>
                      {user.handle ? (
                        <a href={`${PUBLIC_SITE_BASE}${user.profile_url}`} target="_blank" rel="noreferrer">{user.profile_url}</a>
                      ) : (
                        <span className="muted">no handle</span>
                      )}
                      {user.dex_id ? <span>{user.dex_id}</span> : null}
                      {user.profile_public ? (
                        <span className="chip chip-mini">public</span>
                      ) : (
                        <span className="chip chip-mini chip-warn">private</span>
                      )}
                    </>
                  ) : (
                    <span className="muted">no Dex profile</span>
                  )}
                  <span className="claim-sub-id" title={user.user_id}>{user.user_id}</span>
                </div>
              </span>

              <span className="inline claim-actions user-actions">
                {user.auth0_url ? (
                  <a className="btn btn-sm btn-ghost" href={user.auth0_url} target="_blank" rel="noreferrer">Auth0 ↗</a>
                ) : null}
                {!user.email_verified ? (
                  <button className="btn btn-sm" disabled={busy === user.user_id} onClick={() => requestAction(user, "resend_verification", "Resend verification")}>Verify</button>
                ) : null}
                {user.blocked ? (
                  <button className="btn btn-sm" disabled={busy === user.user_id} onClick={() => requestAction(user, "unblock", "Unblock")}>Unblock</button>
                ) : (
                  <button className="btn btn-sm" disabled={busy === user.user_id} onClick={() => requestAction(user, "block", "Block", true)}>Block</button>
                )}
                <button className="btn btn-sm btn-danger" disabled={busy === user.user_id} onClick={() => requestAction(user, "delete", "Delete", true)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
        )}
      </div>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

      <div className="inline">
        <button className="btn btn-sm" disabled={page <= 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Prev</button>
        <button className="btn btn-sm" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next →</button>
      </div>
    </div>
  );
}
