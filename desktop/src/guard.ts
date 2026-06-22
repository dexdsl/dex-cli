// App-wide "don't leave work in an ambiguous state" registry.
//
// Any screen can register a GuardSource describing unresolved work plus how to
// commit or discard it. Navigation (tab / env switch) and window close are
// routed through the guard: if any source is dirty, the operator must resolve
// each one (commit or discard) or cancel. This is intentionally generic so the
// same mentality covers unsynced profile claims, unsaved entry edits, etc.

import { useEffect } from "react";

export type GuardSource = {
  id: string;
  isDirty: () => boolean;
  title: string;
  message: string;
  commitLabel: string;
  discardLabel: string;
  commit: () => Promise<void>;
  discard: () => void | Promise<void>;
};

const sources = new Map<string, GuardSource>();

export function registerGuardSource(source: GuardSource): () => void {
  sources.set(source.id, source);
  return () => {
    // Only remove if it's still the same registration.
    if (sources.get(source.id) === source) sources.delete(source.id);
  };
}

export function activeGuardSources(): GuardSource[] {
  return [...sources.values()].filter((source) => {
    try {
      return source.isDirty();
    } catch {
      return false;
    }
  });
}

export function hasGuardWork(): boolean {
  return activeGuardSources().length > 0;
}

// Register a source while mounted. Re-registers when deps change so the source's
// closures (isDirty / commit / discard) always read current state.
export function useGuardSource(source: GuardSource | null, deps: unknown[]): void {
  useEffect(() => {
    if (!source) return;
    return registerGuardSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
