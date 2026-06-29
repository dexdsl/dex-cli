import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { UploadCloud, DownloadCloud, RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import { rpc, payloadOf } from "../api";
import { useStore } from "../store";

/** The actual Git logo (rotated-square branch graph) — lucide only ships a
 * generic two-node "branch" glyph, which doesn't read as Git. */
function GitMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.05" y="5.05" width="13.9" height="13.9" rx="2.4" transform="rotate(45 12 12)" />
      <line x1="9.4" y1="15.9" x2="9.4" y2="9.1" />
      <path d="M9.4 11.7 12.8 9.9" />
      <circle cx="9.4" cy="16.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9.4" cy="8.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="13.3" cy="9.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

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

type ChangeStatus = "added" | "modified" | "deleted" | "renamed";
type GitChange = {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  untracked: boolean;
  staged: boolean;
  insertions: number;
  deletions: number;
};
type ChangeAction = "commit" | "keep" | "discard";

const STATUS_BADGE: Record<ChangeStatus, string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };
const ACTION_LABEL: Record<ChangeAction, string> = { commit: "Commit", keep: "Keep", discard: "Discard" };
const ACTION_TITLE: Record<ChangeAction, string> = {
  commit: "Stage, commit and push this change",
  keep: "Leave it in the working tree (stash / modify later)",
  discard: "Throw the change away (restore to last commit)",
};

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="git-diff">
      {lines.map((line, i) => {
        let cls = "git-diff-ctx";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "git-diff-meta";
        else if (line.startsWith("@@")) cls = "git-diff-hunk";
        else if (line.startsWith("+")) cls = "git-diff-add";
        else if (line.startsWith("-")) cls = "git-diff-del";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "git-diff-meta";
        return (
          <div key={i} className={`git-diff-line ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function GitBar() {
  const { notify } = useStore();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [message, setMessage] = useState("");

  const [changes, setChanges] = useState<GitChange[] | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [actions, setActions] = useState<Record<string, ChangeAction>>({});
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  async function openPush(preselectedPaths: string[] = [], suggestedMessage = "") {
    setMessage(suggestedMessage);
    setChanges(null);
    setActions({});
    setDiffs({});
    setExpanded({});
    setPushOpen(true);
    setChangesLoading(true);
    try {
      const res = payloadOf<{ branch: string; files: GitChange[] }>(await rpc("git.changes"));
      setChanges(res.files);
      const init: Record<string, ChangeAction> = {};
      const matchesSelection = (filePath: string) => preselectedPaths.some(
        (selected) => filePath === selected || filePath.startsWith(`${selected.replace(/\/+$/, "")}/`),
      );
      res.files.forEach((file) => {
        init[file.path] = preselectedPaths.length === 0 || matchesSelection(file.path) ? "commit" : "keep";
      });
      setActions(init);
    } catch (error) {
      notify("err", String(error));
      setChanges([]);
    } finally {
      setChangesLoading(false);
    }
  }

  useEffect(() => {
    const onReview = (event: Event) => {
      const detail = (event as CustomEvent<{ paths?: string[]; message?: string }>).detail || {};
      void openPush(Array.isArray(detail.paths) ? detail.paths : [], String(detail.message || ""));
    };
    window.addEventListener("dx:git-review", onReview);
    return () => window.removeEventListener("dx:git-review", onReview);
  }, []);

  async function toggleDiff(path: string) {
    const next = !expanded[path];
    setExpanded((prev) => ({ ...prev, [path]: next }));
    if (next && diffs[path] === undefined) {
      try {
        const res = payloadOf<{ diff: string }>(await rpc("git.fileDiff", { path }));
        setDiffs((prev) => ({ ...prev, [path]: res.diff || "(no diff)" }));
      } catch (error) {
        setDiffs((prev) => ({ ...prev, [path]: `Could not load diff: ${String(error)}` }));
      }
    }
  }

  function setAllActions(action: ChangeAction) {
    setActions(() => {
      const next: Record<string, ChangeAction> = {};
      (changes || []).forEach((file) => { next[file.path] = action; });
      return next;
    });
  }

  const commitList = useMemo(
    () => (changes || []).filter((file) => actions[file.path] === "commit").map((file) => file.path),
    [changes, actions],
  );
  const discardList = useMemo(
    () => (changes || []).filter((file) => actions[file.path] === "discard").map((file) => file.path),
    [changes, actions],
  );

  async function applyPush() {
    setBusy("push");
    try {
      const res = payloadOf<{ pushed: boolean; committed: boolean; branch: string; commitCount: number; discardCount: number }>(
        await rpc("git.pushSelective", {
          message: message.trim() || undefined,
          commit: commitList,
          discard: discardList,
        }),
      );
      if (res.pushed) notify("ok", `Pushed ${res.commitCount} change${res.commitCount === 1 ? "" : "s"} to ${res.branch}.`);
      else if (res.discardCount) notify("ok", `Discarded ${res.discardCount} change${res.discardCount === 1 ? "" : "s"} — nothing pushed.`);
      else notify("ok", "Nothing to push.");
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
  const keepCount = (changes || []).filter((file) => actions[file.path] === "keep").length;

  return (
    <div className="git-bar">
      <div className="git-line">
        <GitMark className="icon" />
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

      <button className="git-push" disabled={busy !== null || dirty === 0} onClick={() => void openPush()}>
        <UploadCloud className="icon" />
        Push to repo{dirty > 0 ? ` · ${dirty}` : ""}
      </button>

      {pushOpen ? createPortal(
        <div className="dx-modal-overlay" onClick={() => busy === null && setPushOpen(false)}>
          <div className="dx-modal dx-modal-wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dx-modal-head">
              <h3 className="dx-modal-title">Review &amp; push to {status.branch}</h3>
              <span className="muted">{commitList.length} commit · {keepCount} keep · {discardList.length} discard</span>
            </div>

            <div className="dx-modal-body git-preflight">
              {changesLoading ? <div className="git-preflight-loading"><div className="spinner" /> Reading changes…</div> : null}
              {changes && changes.length === 0 ? <p className="muted">No changes to push.</p> : null}

              {changes && changes.length > 0 ? (
                <>
                  <div className="git-preflight-bulk">
                    <span className="muted">Set all:</span>
                    <button className="git-act" onClick={() => setAllActions("commit")}>Commit</button>
                    <button className="git-act" onClick={() => setAllActions("keep")}>Keep</button>
                    <button className="git-act" onClick={() => setAllActions("discard")}>Discard</button>
                  </div>

                  <div className="git-changes">
                    {changes.map((file) => {
                      const action = actions[file.path] || "commit";
                      const isOpen = !!expanded[file.path];
                      return (
                        <div className={`git-change is-${action}`} key={file.path}>
                          <div className="git-change-row">
                            <span className={`git-change-badge git-change-${file.status}`} title={file.status}>
                              {STATUS_BADGE[file.status]}
                            </span>
                            <button className="git-change-path" onClick={() => toggleDiff(file.path)} title={file.path}>
                              {isOpen ? <ChevronDown className="icon-xs" /> : <ChevronRight className="icon-xs" />}
                              <span className="git-change-name">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
                            </button>
                            <span className="git-change-stat">
                              {file.insertions ? <span className="git-add">+{file.insertions}</span> : null}
                              {file.deletions ? <span className="git-del">−{file.deletions}</span> : null}
                              {file.untracked ? <span className="git-newtag">new</span> : null}
                            </span>
                            <div className="git-change-actions" role="group" aria-label={`Action for ${file.path}`}>
                              {(["commit", "keep", "discard"] as ChangeAction[]).map((act) => (
                                <button
                                  key={act}
                                  type="button"
                                  className={`git-act ${action === act ? `is-active is-${act}` : ""}`}
                                  title={ACTION_TITLE[act]}
                                  onClick={() => setActions((prev) => ({ ...prev, [file.path]: act }))}
                                >
                                  {ACTION_LABEL[act]}
                                </button>
                              ))}
                            </div>
                          </div>
                          {isOpen ? (
                            diffs[file.path] === undefined ? (
                              <div className="git-diff-loading">Loading diff…</div>
                            ) : (
                              <DiffView diff={diffs[file.path]} />
                            )
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Commit message (optional)"
                    className="git-commit-msg"
                  />
                  <p className="git-preflight-note muted">
                    Commit + push the selected files. <strong>Keep</strong> leaves changes in the working tree; <strong>Discard</strong> reverts them.
                  </p>
                </>
              ) : null}
            </div>

            <div className="dx-modal-actions">
              <button className="btn btn-sm" disabled={busy !== null} onClick={() => setPushOpen(false)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy !== null || (commitList.length === 0 && discardList.length === 0)}
                onClick={applyPush}
              >
                {busy === "push"
                  ? "Working…"
                  : commitList.length > 0
                    ? `Commit & push ${commitList.length}`
                    : `Apply${discardList.length ? ` (discard ${discardList.length})` : ""}`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
