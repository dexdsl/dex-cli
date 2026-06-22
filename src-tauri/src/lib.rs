use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct DexProcessState {
    pids: Mutex<HashMap<String, u32>>,
}

#[derive(Debug, Deserialize)]
struct RunRequest {
    #[serde(rename = "commandId")]
    command_id: String,
    repo: Option<String>,
    values: Option<Value>,
    #[serde(rename = "dryRun")]
    dry_run: Option<bool>,
    confirmation: Option<String>,
}

#[derive(Debug, Serialize)]
struct RunStart {
    #[serde(rename = "runId")]
    run_id: String,
}

// Resolve a usable `node` binary. Finder-launched apps inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that usually lacks Homebrew/nvm node, which
// would make every bridge call fail and brick the app. Search the common install
// locations and, as a last resort, ask the user's login shell.
fn resolve_node_bin() -> String {
    if let Ok(explicit) = env::var("DEX_NODE_BIN") {
        if !explicit.trim().is_empty() {
            return explicit;
        }
    }

    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];

    if let Ok(home) = env::var("HOME") {
        candidates.push(PathBuf::from(format!("{home}/.volta/bin/node")));
        candidates.push(PathBuf::from(format!("{home}/.fnm/aliases/default/bin/node")));
        // nvm: pick the newest installed version.
        let nvm = PathBuf::from(format!("{home}/.nvm/versions/node"));
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path().join("bin/node"))
                .filter(|path| path.exists())
                .collect();
            versions.sort();
            if let Some(latest) = versions.pop() {
                candidates.push(latest);
            }
        }
    }

    for candidate in &candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }

    // Last resort: a login shell sources the user's PATH (Homebrew/nvm/etc.).
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = Command::new(&shell)
        .args(["-lc", "command -v node"])
        .output()
    {
        let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !found.is_empty() && PathBuf::from(&found).exists() {
            return found;
        }
    }

    "node".to_string()
}

fn node_bin() -> String {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE.get_or_init(resolve_node_bin).clone()
}

fn repo_root_from_manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn app_root(app: &AppHandle) -> PathBuf {
    if let Ok(root) = env::var("DEX_CLI_ROOT") {
        let root = PathBuf::from(root);
        if root.join("scripts").join("dex-gui-bridge.mjs").exists() {
            return root;
        }
    }

    let dev_root = repo_root_from_manifest();
    if dev_root.join("scripts").join("dex-gui-bridge.mjs").exists() {
        return dev_root;
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        if resource_dir.join("scripts").join("dex-gui-bridge.mjs").exists() {
            return resource_dir;
        }
    }

    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn bridge_path(app: &AppHandle) -> PathBuf {
    app_root(app).join("scripts").join("dex-gui-bridge.mjs")
}

fn rpc_bridge_path(app: &AppHandle) -> PathBuf {
    app_root(app).join("scripts").join("desktop-rpc.mjs")
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    op: String,
    #[serde(default)]
    args: Value,
    #[serde(default)]
    secrets: HashMap<String, String>,
}

/// Request/response RPC into the site-repo ground-truth modules. The envelope
/// (including admin tokens) is piped over stdin so secrets never appear in the
/// process argument list.
#[tauri::command]
fn dex_rpc(app: AppHandle, request: RpcRequest) -> Result<Value, String> {
    let root = app_root(&app);
    let envelope = json!({
        "op": request.op,
        "args": if request.args.is_null() { json!({}) } else { request.args },
        "secrets": request.secrets,
    });

    let mut command = Command::new(node_bin());
    command
        .arg(rpc_bridge_path(&app))
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(site) = stored_site_root(&app) {
        command.env("DEX_SITE_ROOT", site);
    }
    let mut child = command.spawn().map_err(|error| error.to_string())?;

    child
        .stdin
        .take()
        .ok_or_else(|| "failed to open bridge stdin".to_string())?
        .write_all(envelope.to_string().as_bytes())
        .map_err(|error| error.to_string())?;

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last_line = stdout.lines().rev().find(|line| !line.trim().is_empty());

    let Some(line) = last_line else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "bridge produced no output".to_string()
        } else {
            stderr
        });
    };

    let parsed: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
    if parsed.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown bridge error")
            .to_string())
    }
}

fn run_bridge_json(app: &AppHandle, args: &[String]) -> Result<Value, String> {
    let root = app_root(app);
    let mut command = Command::new(node_bin());
    command.arg(bridge_path(app)).args(args).current_dir(root);
    if let Some(site) = stored_site_root(app) {
        command.env("DEX_SITE_ROOT", site);
    }
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }

    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[tauri::command]
fn dex_command_registry(app: AppHandle) -> Result<Value, String> {
    run_bridge_json(&app, &[String::from("registry")])
}

#[tauri::command]
fn dex_workspace_status(app: AppHandle, repo: Option<String>) -> Result<Value, String> {
    let mut args = vec![String::from("workspace")];
    if let Some(repo) = repo {
        args.push(String::from("--repo"));
        args.push(repo);
    }
    run_bridge_json(&app, &args)
}

fn emit_line(app: &AppHandle, run_id: &str, line: &str, fallback_type: &str) {
    if let Ok(value) = serde_json::from_str::<Value>(line) {
        let _ = app.emit("dex-run-event", value);
    } else {
        let _ = app.emit(
            "dex-run-event",
            json!({
                "runId": run_id,
                "type": fallback_type,
                "text": line
            }),
        );
    }
}

fn stream_reader<R>(app: AppHandle, run_id: String, reader: R, fallback_type: &'static str)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                emit_line(&app, &run_id, &line, fallback_type);
            }
        }
    });
}

#[tauri::command]
fn dex_run_command(
    app: AppHandle,
    state: State<'_, DexProcessState>,
    request: RunRequest,
) -> Result<RunStart, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let run_id = format!("dex-{now}");
    let root = app_root(&app);
    let mut payload = json!({
        "runId": run_id,
        "commandId": request.command_id,
        "repo": request.repo.unwrap_or_else(|| "site".to_string()),
        "values": request.values.unwrap_or_else(|| json!({})),
        "dryRun": request.dry_run.unwrap_or(false),
        "confirmation": request.confirmation.unwrap_or_default()
    });

    if payload.get("values").is_none() {
        payload["values"] = json!({});
    }

    let mut child = Command::new(node_bin())
        .arg(bridge_path(&app))
        .arg("run")
        .arg(payload.to_string())
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let pid = child.id();
    state
        .pids
        .lock()
        .map_err(|_| "process state lock poisoned".to_string())?
        .insert(run_id.clone(), pid);

    if let Some(stdout) = child.stdout.take() {
        stream_reader(app.clone(), run_id.clone(), stdout, "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        stream_reader(app.clone(), run_id.clone(), stderr, "stderr");
    }

    let wait_app = app.clone();
    let wait_run_id = run_id.clone();
    thread::spawn(move || {
        let status = child.wait();
        let payload = match status {
            Ok(status) => json!({
                "runId": wait_run_id,
                "type": if status.success() { "closed" } else { "closed-error" },
                "ok": status.success(),
                "exitCode": status.code()
            }),
            Err(error) => json!({
                "runId": wait_run_id,
                "type": "error",
                "ok": false,
                "error": error.to_string()
            }),
        };
        let _ = wait_app.emit("dex-run-event", payload);
    });

    Ok(RunStart { run_id })
}

#[tauri::command]
fn dex_cancel_run(state: State<'_, DexProcessState>, run_id: String) -> Result<bool, String> {
    let pid = state
        .pids
        .lock()
        .map_err(|_| "process state lock poisoned".to_string())?
        .remove(&run_id);

    let Some(pid) = pid else {
        return Ok(false);
    };

    #[cfg(unix)]
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .map_err(|error| error.to_string())?;

    #[cfg(windows)]
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| error.to_string())?;

    Ok(status.success())
}

#[tauri::command]
fn dex_open_external(app: AppHandle, target: String) -> Result<(), String> {
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|error| error.to_string())
}

const SECRET_SERVICE: &str = "io.github.cbassuarez.dex-ops-studio";

fn secret_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SECRET_SERVICE, key).map_err(|error| error.to_string())
}

/// Store an admin token in the OS keychain (never written to disk in plaintext).
#[tauri::command]
fn dex_secret_set(key: String, value: String) -> Result<(), String> {
    let entry = secret_entry(&key)?;
    if value.is_empty() {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    } else {
        entry.set_password(&value).map_err(|error| error.to_string())
    }
}

/// Read an admin token from the OS keychain. Returns null when unset.
#[tauri::command]
fn dex_secret_get(key: String) -> Result<Option<String>, String> {
    let entry = secret_entry(&key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

// User-selected site repo directory (ground truth). Persisted to the app config
// dir and passed to the bridge as DEX_SITE_ROOT so a missing auto-scan never
// bricks functionality — the operator just points the app at the repo.
fn site_root_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("site_root.txt"))
}

fn stored_site_root(app: &AppHandle) -> Option<String> {
    let path = site_root_file(app)?;
    let content = std::fs::read_to_string(path).ok()?;
    let trimmed = content.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[tauri::command]
fn dex_set_site_root(app: AppHandle, path: String) -> Result<(), String> {
    let file = site_root_file(&app).ok_or_else(|| "config directory unavailable".to_string())?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let trimmed = path.trim();
    if trimmed.is_empty() {
        let _ = std::fs::remove_file(&file);
        return Ok(());
    }
    if !PathBuf::from(trimmed).is_dir() {
        return Err(format!("Not a directory: {trimmed}"));
    }
    std::fs::write(&file, trimmed).map_err(|error| error.to_string())
}

#[tauri::command]
fn dex_get_site_root(app: AppHandle) -> Result<Option<String>, String> {
    Ok(stored_site_root(&app))
}

fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        handle,
        "Dex",
        true,
        &[
            &MenuItem::with_id(handle, "about", "About Dex Ops Studio", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;
    Menu::with_items(handle, &[&app_menu, &edit, &view, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DexProcessState::default())
        .menu(|handle| build_menu(handle))
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if id == "about" || id == "reload" {
                let _ = app.emit("menu", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            dex_command_registry,
            dex_workspace_status,
            dex_run_command,
            dex_cancel_run,
            dex_open_external,
            dex_rpc,
            dex_secret_set,
            dex_secret_get,
            dex_set_site_root,
            dex_get_site_root,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dex Ops Studio");
}
