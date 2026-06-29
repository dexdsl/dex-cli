import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  PanelsTopLeft,
  Inbox,
  BarChart3,
  Users,
  UserRound,
  Image as ImageIcon,
  Settings as SettingsIcon,
  Moon,
  Sun,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "./store";
import { loadSecrets, workspaceInfo } from "./api";
import { isProfilesGuardArmed, suppressProfilesGuard, useProfilesDirty } from "./dirty";
import { syncProfilesMap } from "./profilesSync";
import { activeGuardSources, registerGuardSource, type GuardSource } from "./guard";
import { GitBar } from "./components/GitBar";
import { GlobalLoadingBar } from "./components/GlobalLoadingBar";
import type { Env } from "./domain";
import { EntriesScreen } from "./screens/Entries";
import { HeroScreen } from "./screens/Hero";
import { SubmissionsScreen } from "./screens/Submissions";
import { PollsScreen } from "./screens/Polls";
import { ProfilesScreen } from "./screens/Profiles";
import { UsersScreen } from "./screens/Users";
import { AssetsScreen } from "./screens/Assets";
import { SettingsScreen } from "./screens/Settings";

type ScreenId = "entries" | "hero" | "assets" | "submissions" | "polls" | "profiles" | "users" | "settings";

const NAV: Array<{ id: ScreenId; label: string; icon: typeof Boxes }> = [
  { id: "entries", label: "Entries", icon: Boxes },
  { id: "hero", label: "Hero", icon: PanelsTopLeft },
  { id: "assets", label: "Assets", icon: ImageIcon },
  { id: "submissions", label: "Submissions", icon: Inbox },
  { id: "polls", label: "Polls", icon: BarChart3 },
  { id: "profiles", label: "Claims", icon: Users },
  { id: "users", label: "Users", icon: UserRound },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

type GuardState = { mode: "nav" | "quit"; proceed: () => void | Promise<void>; sources: GuardSource[] };

export default function App() {
  const { env, setEnv, theme, toggleTheme, toast, setSiteRoot, notify } = useStore();
  const [screen, setScreen] = useState<ScreenId>("entries");
  const profilesDirty = useProfilesDirty(env);

  const [guard, setGuard] = useState<GuardState | null>(null);
  const [guardBusy, setGuardBusy] = useState<string | null>(null);

  const guardRef = useRef<GuardState | null>(null);
  guardRef.current = guard;
  const closingRef = useRef(false);

  useEffect(() => {
    loadSecrets();
    workspaceInfo()
      .then((info) => setSiteRoot(info.siteRoot))
      .catch(() => setSiteRoot(""));
  }, [setSiteRoot]);

  // The profiles-sync guard source (global; env-aware).
  useEffect(() => {
    return registerGuardSource({
      id: "profiles-sync",
      isDirty: () => isProfilesGuardArmed(env),
      title: "Unsynced profile-claim changes",
      message: "Member /u pages are already live, but published entry-page credits won't update until you sync the map to the repo.",
      commitLabel: "Sync to repo",
      discardLabel: "Leave unsynced",
      commit: async () => {
        await syncProfilesMap(env);
      },
      discard: () => suppressProfilesGuard(env),
    });
  }, [env]);

  // Intercept window close when any guard source is dirty.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested((event) => {
          if (closingRef.current) return;
          if (guardRef.current) {
            event.preventDefault();
            return;
          }
          const sources = activeGuardSources();
          if (sources.length) {
            event.preventDefault();
            setGuard({
              mode: "quit",
              sources,
              proceed: async () => {
                closingRef.current = true;
                await getCurrentWindow().close();
              },
            });
          }
        });
      } catch {
        /* not under Tauri */
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  function guardNavigate(proceed: () => void) {
    if (guardRef.current) return;
    const sources = activeGuardSources();
    if (sources.length) setGuard({ mode: "nav", proceed, sources });
    else proceed();
  }

  async function resolveSource(source: GuardSource, action: "commit" | "discard") {
    setGuardBusy(source.id);
    try {
      if (action === "commit") await source.commit();
      else await source.discard();
      notify("ok", action === "commit" ? `${source.commitLabel} done.` : `${source.discardLabel}.`);
    } catch (error) {
      notify("err", String(error));
      setGuardBusy(null);
      return; // keep the guard open so the choice still stands
    }
    setGuardBusy(null);
    const current = guardRef.current;
    if (!current) return;
    const remaining = current.sources.filter((item) => item.id !== source.id);
    if (remaining.length === 0) {
      const proceed = current.proceed;
      setGuard(null);
      await proceed();
    } else {
      setGuard({ ...current, sources: remaining });
    }
  }

  function guardCancel() {
    if (!guardBusy) setGuard(null);
  }

  return (
    <div className="app">
      <GlobalLoadingBar />
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="dex" />
          <div className="brand-word">DEX OPS</div>
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => guardNavigate(() => setScreen(item.id))}
            >
              <Icon className="icon" />
              {item.label}
              {item.id === "profiles" && profilesDirty ? <span className="dx-dirty-dot nav-dirty-dot" title="Unsynced claim changes" /> : null}
            </button>
          );
        })}
        <div className="nav-spacer" />
        <GitBar />
        <button className="nav-item" onClick={toggleTheme}>
          {theme === "light" ? <Moon className="icon" /> : <Sun className="icon" />}
          {theme === "light" ? "Dark" : "Light"} mode
        </button>
      </aside>

      <main className="main">
        <div className="mesh" aria-hidden="true">
          <span className="blob b1" />
          <span className="blob b2" />
          <span className="blob b3" />
          <span className="blob b4" />
        </div>
        <header className="topbar">
          <h1>{NAV.find((n) => n.id === screen)?.label}</h1>
          <div className="grow" />
          <div className="seg" title="Environment">
            {(["test", "prod"] as Env[]).map((value) => (
              <button key={value} className={env === value ? "on" : ""} onClick={() => guardNavigate(() => setEnv(value))}>
                {value}
              </button>
            ))}
          </div>
        </header>

        <div className="content">
          {screen === "entries" && <EntriesScreen />}
          {screen === "hero" && <HeroScreen />}
          {screen === "assets" && <AssetsScreen />}
          {screen === "submissions" && <SubmissionsScreen />}
          {screen === "polls" && <PollsScreen />}
          {screen === "profiles" && <ProfilesScreen />}
          {screen === "users" && <UsersScreen />}
          {screen === "settings" && <SettingsScreen />}
        </div>
      </main>

      {guard && (
        <div className="dx-modal-overlay" onClick={guardCancel}>
          <div className="dx-modal dx-modal-wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3 className="dx-modal-title">
              {guard.mode === "quit" ? "Unresolved work before quitting" : "Unresolved work"}
            </h3>
            <div className="dx-modal-body">
              <p className="muted" style={{ margin: "0 0 4px" }}>
                Resolve each item below — commit or discard — before {guard.mode === "quit" ? "quitting" : "leaving"}.
              </p>
              <div className="dx-guard-list">
                {guard.sources.map((source) => (
                  <div className="dx-guard-item" key={source.id}>
                    <div className="dx-guard-item-copy">
                      <strong>{source.title}</strong>
                      <span className="muted">{source.message}</span>
                    </div>
                    <div className="dx-guard-item-actions">
                      <button className="btn btn-sm btn-ghost" disabled={guardBusy !== null} onClick={() => resolveSource(source, "discard")}>
                        {source.discardLabel}
                      </button>
                      <button className="btn btn-sm btn-primary" disabled={guardBusy !== null} onClick={() => resolveSource(source, "commit")}>
                        {guardBusy === source.id ? "Working…" : source.commitLabel}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="dx-modal-actions">
              <button className="btn btn-sm" disabled={guardBusy !== null} onClick={guardCancel}>Stay</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
