// Tracks whether profile-claim changes have been made that aren't yet synced to
// the repo's public-profiles.json (which the published entry pages read). Stored
// per-env in localStorage so the reminder survives app restarts, and broadcast
// so the sidebar + Profiles screen stay in sync.
//
// "Suppression" is the in-memory acknowledgement that the operator chose to
// leave the repo unsynced for now: it silences the blocking nav guard for this
// session/env (the dirty dot stays visible) and is re-armed automatically the
// next time a change is made.

import { useEffect, useState } from "react";

const EVENT = "dx:profiles-dirty";
const key = (env: string) => `dx.profiles.dirty.${env}`;
const suppressed = new Set<string>();

export function getProfilesDirty(env: string): boolean {
  try {
    return localStorage.getItem(key(env)) === "1";
  } catch {
    return false;
  }
}

export function setProfilesDirty(env: string, dirty: boolean): void {
  try {
    if (dirty) localStorage.setItem(key(env), "1");
    else localStorage.removeItem(key(env));
  } catch {
    /* ignore storage failures */
  }
  // Any change to the dirty state re-arms the guard for this env.
  suppressed.delete(env);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { env } }));
}

export function suppressProfilesGuard(env: string): void {
  suppressed.add(env);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { env } }));
}

export function isProfilesGuardSuppressed(env: string): boolean {
  return suppressed.has(env);
}

// The guard should block navigation only when there are unsynced changes that
// the operator hasn't already chosen to defer.
export function isProfilesGuardArmed(env: string): boolean {
  return getProfilesDirty(env) && !isProfilesGuardSuppressed(env);
}

export function useProfilesDirty(env: string): boolean {
  const [dirty, setDirty] = useState(() => getProfilesDirty(env));
  useEffect(() => {
    setDirty(getProfilesDirty(env));
    const handler = () => setDirty(getProfilesDirty(env));
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [env]);
  return dirty;
}
