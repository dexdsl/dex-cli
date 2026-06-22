import { rpc } from "./api";
import { setProfilesDirty } from "./dirty";

// Shared "commit" for unsynced profile-claim changes: regenerates the public
// credit map into the repo and clears the dirty flag. Used by both the Public
// map tab's Sync button and the navigation guard.
export async function syncProfilesMap(env: string): Promise<{ entries?: number; profiles?: number; targets?: string[] }> {
  const res = await rpc<any>("profiles.syncMap", { env });
  setProfilesDirty(env, false);
  return res?.written ?? {};
}
