import { useEffect, useState } from "react";
import { SECRET_KEYS, type SecretKey, saveSecret, loadSecrets, workspaceInfo } from "../api";
import { useStore } from "../store";

const LABELS: Record<SecretKey, string> = {
  DEX_OPS_ADMIN_TOKEN: "Ops admin token",
  DEX_POLLS_ADMIN_TOKEN: "Polls admin token",
  DEX_PROFILES_ADMIN_TOKEN: "Profiles admin token",
};

export function SettingsScreen() {
  const { notify, siteRoot, setSiteRoot } = useStore();
  const [values, setValues] = useState<Record<string, string>>({});
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [apiBase, setApiBase] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    loadSecrets().then((secrets) => {
      const flags: Record<string, boolean> = {};
      for (const key of SECRET_KEYS) flags[key] = Boolean(secrets[key]);
      setPresent(flags);
    });
    workspaceInfo()
      .then((info) => {
        setSiteRoot(info.siteRoot);
        setApiBase(info.apiBase);
      })
      .catch((error) => notify("err", String(error)));
  }, [notify, setSiteRoot]);

  async function save(key: SecretKey) {
    setSaving(key);
    try {
      await saveSecret(key, values[key] ?? "");
      setPresent((prev) => ({ ...prev, [key]: Boolean(values[key]) }));
      setValues((prev) => ({ ...prev, [key]: "" }));
      notify("ok", `${LABELS[key]} saved to keychain.`);
    } catch (error) {
      notify("err", String(error));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="content-narrow stack">
      <div className="panel">
        <div className="panel-title">Workspace</div>
        <div className="field">
          <label>Site repo (ground truth)</label>
          <input readOnly value={siteRoot || "resolving…"} />
          <div className="field-hint">
            Resolved from ~/.config/dexdsl/workspaces.json. Override with DEX_SITE_ROOT.
          </div>
        </div>
        <div className="field">
          <label>API base</label>
          <input readOnly value={apiBase || "—"} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Admin tokens (OS keychain)</div>
        <p className="field-hint" style={{ marginTop: 0 }}>
          Stored securely in the system keychain, never on disk in plaintext. Passed to the
          bridge per-call. Leave blank and save to clear.
        </p>
        {SECRET_KEYS.map((key) => (
          <div className="field" key={key}>
            <label>
              {LABELS[key]} {present[key] ? <span className="chip">set</span> : <span className="chip">unset</span>}
            </label>
            <div className="inline">
              <input
                type="password"
                placeholder={present[key] ? "•••••••• (stored)" : "paste token"}
                value={values[key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={saving === key}
                onClick={() => save(key)}
              >
                {saving === key ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
