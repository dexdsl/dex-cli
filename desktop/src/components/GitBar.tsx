import { useCallback, useEffect, useState } from "react";
import { GitBranch, UploadCloud, DownloadCloud, RefreshCw } from "lucide-react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";

type GitStatus = {
  isRepo: boolean;
  root?: string;
  branch?: string;
  fetched?: boolean;
  hasUpstream?: boolean;
  dirtyFiles?: number;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
};

export function GitBar() {
  const { notify } = useStore();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(payloadOf<GitStatus>(await rpc("git.status")));
    } catch (error) {
      setStatus({ isRepo: false });
      notify("err", String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  // Boot check: confirm the repo is linked + how far behind main we are.
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function pull() {
    setBusy("pull");
    try {
      await rpc("git.pull");
      notify("ok", "Pulled latest from main.");
      await refresh();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  async function push() {
    setBusy("push");
    try {
      const res = payloadOf<{ committed: boolean; branch: string }>(await rpc("git.push", { message: message.trim() || undefined }));
      notify("ok", res.committed ? `Pushed to ${res.branch}.` : "Pushed (nothing new to commit).");
      setPushOpen(false);
      setMessage("");
      await refresh();
    } catch (error) {
      notify("err", String(error));
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return <div className="git-bar"><div className="spinner" /></div>;
  }
  if (!status.isRepo) {
    return <div className="git-bar git-bar-warn">⚠ Site repo not linked — set DEX_SITE_ROOT.</div>;
  }

  const dirty = status.dirtyFiles ?? 0;
  const behind = status.behind ?? 0;
  const ahead = status.ahead ?? 0;

  return (
    <div className="git-bar">
      <div className="git-line">
        <GitBranch className="icon" />
        <span className="git-branch" title={status.lastCommit || ""}>{status.branch}</span>
        <span className="grow" />
        <button className="git-refresh" title="Refresh git status" disabled={loading || busy !== null} onClick={refresh}>
          <RefreshCw className="icon" />
        </button>
      </div>
      <div className="git-meta">
        <span className={dirty > 0 ? "git-dirty" : "muted"}>{dirty} changed</span>
        <span className="muted">↑{ahead} ↓{behind}</span>
      </div>

      {behind > 0 ? (
        <button className="btn btn-sm git-pull" disabled={busy !== null} onClick={pull}>
          <DownloadCloud className="icon" /> {busy === "pull" ? "Pulling…" : `Pull ${behind} from main`}
        </button>
      ) : null}

      <button className="git-push" disabled={busy !== null || dirty === 0} onClick={() => { setMessage(""); setPushOpen(true); }}>
        <UploadCloud className="icon" />
        Push to repo{dirty > 0 ? ` · ${dirty}` : ""}
      </button>

      {pushOpen ? (
        <div className="dx-modal-overlay" onClick={() => busy === null && setPushOpen(false)}>
          <div className="dx-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3 className="dx-modal-title">Push to {status.branch}?</h3>
            <div className="dx-modal-body">
              <p style={{ margin: "0 0 8px" }}>
                Stages and commits <strong>{dirty} changed file{dirty === 1 ? "" : "s"}</strong>, then pushes to{" "}
                <strong>origin/{status.branch}</strong>. This publishes to the live site.
              </p>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Commit message (optional)"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 10, border: "1px solid var(--dx-border)", background: "var(--dx-surface-strong)" }}
              />
            </div>
            <div className="dx-modal-actions">
              <button className="btn btn-sm" disabled={busy !== null} onClick={() => setPushOpen(false)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={push}>
                {busy === "push" ? "Pushing…" : "Push"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
