import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DexRegistry, DexRunEvent, DexRunRequest, DexWorkspace } from "./types";

/* --------------------------------------------------------------- secrets - */
// Admin tokens live in the OS keychain (Rust dex_secret_*). We cache them in
// memory and pass them to the bridge per-call as the `secrets` envelope field.

export const SECRET_KEYS = [
  "DEX_OPS_ADMIN_TOKEN",
  "DEX_POLLS_ADMIN_TOKEN",
  "DEX_PROFILES_ADMIN_TOKEN",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const secretCache: Partial<Record<SecretKey, string>> = {};

export async function loadSecrets(): Promise<Partial<Record<SecretKey, string>>> {
  for (const key of SECRET_KEYS) {
    try {
      const value = await invoke<string | null>("dex_secret_get", { key });
      if (value) secretCache[key] = value;
    } catch {
      /* keychain miss is fine */
    }
  }
  return { ...secretCache };
}

export async function saveSecret(key: SecretKey, value: string): Promise<void> {
  await invoke("dex_secret_set", { key, value });
  if (value) secretCache[key] = value;
  else delete secretCache[key];
}

export function cachedSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = secretCache[key];
    if (value) out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------- rpc - */

export type RpcResult<T> = T;

// Global in-flight RPC tracking so the whole app can show a loading affordance
// for any pending call — no click is ever "blind".
let inFlight = 0;
const RPC_EVENT = "dx:rpc-activity";
function emitRpcActivity() {
  try {
    window.dispatchEvent(new CustomEvent(RPC_EVENT, { detail: { inFlight } }));
  } catch {
    /* non-DOM env */
  }
}
export function rpcActivityCount(): number {
  return inFlight;
}
export function onRpcActivity(handler: (count: number) => void): () => void {
  const listener = () => handler(inFlight);
  window.addEventListener(RPC_EVENT, listener);
  return () => window.removeEventListener(RPC_EVENT, listener);
}

/** Invoke a site-repo ground-truth op through the desktop-rpc bridge. */
export async function rpc<T = unknown>(
  op: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  inFlight += 1;
  emitRpcActivity();
  try {
    return await invoke<T>("dex_rpc", {
      request: { op, args, secrets: cachedSecrets() },
    });
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    emitRpcActivity();
  }
}

/** Admin-api fns return { env, apiBase, requestId, payload }; unwrap payload. */
export function payloadOf<T = any>(result: any): T {
  return (result && typeof result === "object" && "payload" in result ? result.payload : result) as T;
}

/* ------------------------------------------------------------ meta/info - */

export async function workspaceInfo(): Promise<{ siteRoot: string; apiBase: string }> {
  return rpc("workspace.info");
}

/* --------------------------------------------------- site repo linkage - */
// The operator can point the app at the site repo directory; it's persisted and
// passed to the bridge as DEX_SITE_ROOT so a failed auto-scan never bricks ops.
export async function getStoredSiteRoot(): Promise<string | null> {
  return invoke("dex_get_site_root");
}

export async function setStoredSiteRoot(path: string): Promise<void> {
  await invoke("dex_set_site_root", { path });
}

export async function pickSiteDirectory(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({ directory: true, multiple: false, title: "Select the site repo (dexdsl.github.io)" });
  return typeof result === "string" ? result : null;
}

export async function pickImageFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    directory: false,
    multiple: false,
    title: "Choose entry image",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }],
  });
  return typeof result === "string" ? result : null;
}

/* ----------------------------------------------- legacy raw-command path - */
// Retained as an "advanced / raw command" escape hatch for ops without a
// dedicated screen. Uses the original streaming bridge.

export async function loadRegistry(): Promise<DexRegistry | null> {
  try {
    return await invoke<DexRegistry>("dex_command_registry");
  } catch {
    return null;
  }
}

export async function loadWorkspace(repo: string): Promise<DexWorkspace | null> {
  try {
    return await invoke<DexWorkspace>("dex_workspace_status", { repo });
  } catch {
    return null;
  }
}

export async function runDexCommand(request: DexRunRequest): Promise<{ runId: string }> {
  return invoke<{ runId: string }>("dex_run_command", { request });
}

export async function cancelDexRun(runId: string): Promise<boolean> {
  return invoke<boolean>("dex_cancel_run", { runId });
}

export function subscribeRunEvents(handler: (event: DexRunEvent) => void): Promise<() => void> {
  return listen<DexRunEvent>("dex-run-event", (event) => handler(event.payload));
}

export async function openExternal(target: string): Promise<void> {
  return invoke<void>("dex_open_external", { target });
}
