#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod llama_runtime;
mod noise_p2p;
mod ollama_runtime;
mod openai_connector;

use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_fs::FsExt;

struct SidecarState {
    child: Mutex<Option<Child>>,
    wa_child: Mutex<Option<Child>>,
    provider_child: Mutex<Option<Child>>,
}

fn is_local_port_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

#[derive(serde::Serialize)]
struct ProviderStatus {
    running: bool,
    pid: Option<u32>,
}

#[tauri::command]
#[allow(unused_variables)]
fn provider_runtime_start(
    state: tauri::State<'_, SidecarState>,
    // Spec A (2026-05-22): online mode + capacity are gone. The runtime only
    // runs a single boot-fixed model and announces presence to the friend graph.
    // These params are accepted for backwards compat with existing callers but
    // ignored: mode, vram_mb, ram_mb, max_concurrent.
    mode: Option<String>,
    model: Option<String>,
    endpoint: String,
    // Renamed from `matchmaker` → `server`; old field name still accepted.
    server: Option<String>,
    matchmaker: Option<String>,
    jwt: String,
    bind: Option<String>,
    vram_mb: Option<u32>,
    ram_mb: Option<u32>,
    max_concurrent: Option<u32>,
) -> Result<ProviderStatus, String> {
    let mut guard = state.provider_child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return Err("provider-runtime already running".into()),
            _ => { let _ = child.kill(); }
        }
    }
    if model.as_deref().unwrap_or("").is_empty() {
        return Err("model required".into());
    }
    if endpoint.trim().is_empty() {
        return Err("endpoint required".into());
    }
    if jwt.trim().is_empty() {
        return Err("server JWT required — log in first".into());
    }
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "failed to locate repo root from desktop/src-tauri".to_string())?
        .to_path_buf();
    let pr_dir = repo_root.join("provider-runtime");
    if !pr_dir.join("Cargo.toml").exists() {
        return Err(format!("provider-runtime not found at {}", pr_dir.display()));
    }
    let server_url = server
        .or(matchmaker)
        .unwrap_or_else(|| "http://localhost:3469".into());
    let mut cmd = StdCommand::new("cargo");
    cmd.arg("run").arg("--release").arg("--").current_dir(&pr_dir);
    cmd.env("PROGSOFT_ENDPOINT", &endpoint);
    cmd.env("PROGSOFT_SERVER", &server_url);
    cmd.env("PROGSOFT_SERVER_JWT", &jwt);
    if let Some(m) = model.as_deref() { if !m.is_empty() { cmd.env("PROGSOFT_MODEL", m); } }
    if let Some(b) = bind.as_deref() { if !b.is_empty() { cmd.env("PROGSOFT_BIND", b); } }
    let child = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn provider-runtime: {e}"))?;
    let pid = child.id();
    *guard = Some(child);
    Ok(ProviderStatus { running: true, pid: Some(pid) })
}

#[tauri::command]
fn provider_runtime_stop(state: tauri::State<'_, SidecarState>) -> Result<ProviderStatus, String> {
    let mut guard = state.provider_child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = None;
    Ok(ProviderStatus { running: false, pid: None })
}

#[tauri::command]
fn provider_runtime_status(state: tauri::State<'_, SidecarState>) -> ProviderStatus {
    let mut guard = state.provider_child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return ProviderStatus { running: true, pid: Some(child.id()) },
            _ => {}
        }
    }
    *guard = None;
    ProviderStatus { running: false, pid: None }
}

#[tauri::command]
fn allow_fs_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.fs_scope();
    scope.allow_directory(&path, true).map_err(|e| e.to_string())?;
    Ok(())
}

fn spawn_bundled_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let mut sidecar = app
        .shell()
        .sidecar("monkey-server")
        .map_err(|e| e.to_string())?
        .env("MONKEY_PORT", "3471")
        // Bundled sidecar ships in release apps → talk to prod, never localhost
        // (testers have no local server). Mirrors the frontend .env.production
        // VITE_BACKEND_URL. Override via MONKEY_BACKEND_URL env for self-hosting.
        .env(
            "MONKEY_BACKEND_URL",
            std::env::var("MONKEY_BACKEND_URL")
                .unwrap_or_else(|_| "https://ai.progsoft.eu".into()),
        );
    if let Some(sd) = locate_sd_binary(app) {
        sidecar = sidecar.env("MONKEY_SD_BIN", sd.to_string_lossy().to_string());
    }
    sidecar.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn sd_binary_filename() -> String {
    let triple = if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_arch = "x86_64", target_os = "macos")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_arch = "x86_64", target_os = "linux")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_arch = "aarch64", target_os = "linux")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_arch = "x86_64", target_os = "windows")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unknown"
    };
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    format!("sd-{triple}{suffix}")
}

fn locate_sd_binary(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let file = sd_binary_filename();
    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join("binaries").join(&file);
        if p.is_file() {
            return Some(p);
        }
    }
    #[cfg(debug_assertions)]
    {
        if let Some(p) = locate_sd_binary_dev() {
            return Some(p);
        }
    }
    None
}

#[cfg(debug_assertions)]
fn locate_sd_binary_dev() -> Option<std::path::PathBuf> {
    if let Ok(s) = std::env::var("MONKEY_SD_BIN") {
        let p = std::path::PathBuf::from(s);
        if p.is_file() {
            return Some(p);
        }
    }
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_path = manifest_dir.join("binaries").join(sd_binary_filename());
    if dev_path.is_file() {
        return Some(dev_path);
    }
    None
}

fn spawn_wa_sidecar() -> Result<Child, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "failed to locate repo root from desktop/src-tauri".to_string())?
        .to_path_buf();
    let wa_dir = repo_root.join("whatsapp-sidecar");
    if !wa_dir.join("index.js").exists() {
        return Err(format!("wa sidecar not found at {}", wa_dir.display()));
    }
    StdCommand::new("node")
        .arg("index.js")
        .current_dir(wa_dir)
        .env("MONKEY_WA_PORT", "3472")
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| e.to_string())
}

#[cfg(debug_assertions)]
fn spawn_dev_sidecar() -> Result<Child, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "failed to locate repo root from desktop/src-tauri".to_string())?
        .to_path_buf();

    let mut cmd = StdCommand::new("python3");
    cmd.arg("-m")
        .arg("monkey.main")
        .current_dir(repo_root)
        .env("MONKEY_PORT", "3471")
        .env("MONKEY_BACKEND_URL", "http://localhost:3469")
        .env("PYTHONUTF8", "1");
    if let Some(sd) = locate_sd_binary_dev() {
        cmd.env("MONKEY_SD_BIN", sd);
    }
    cmd.stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| e.to_string())
}

fn main() {
    let conn = db::init();
    let db_state = db::DbState {
        conn: std::sync::Mutex::new(conn),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(db_state)
        .manage(SidecarState {
            child: Mutex::new(None),
            wa_child: Mutex::new(None),
            provider_child: Mutex::new(None),
        })
        .manage(llama_runtime::LlamaState::new())
        .manage(llama_runtime::LlamaEmbedState::new())
        .manage(ollama_runtime::OllamaState::new())
        .manage(openai_connector::ConnectorState::new())
        .invoke_handler(tauri::generate_handler![
            db::db_query,
            db::db_execute,
            db::db_execute_batch,
            allow_fs_path,
            noise_p2p::p2p_static_pubkey,
            noise_p2p::p2p_noise_chat,
            provider_runtime_start,
            provider_runtime_stop,
            provider_runtime_status,
            llama_runtime::llama_runtime_status,
            llama_runtime::llama_runtime_info,
            llama_runtime::llama_runtime_last_error,
            llama_runtime::llama_runtime_models_dir,
            llama_runtime::llama_runtime_start,
            llama_runtime::llama_runtime_stop,
            llama_runtime::llama_runtime_download_model,
            llama_runtime::llama_runtime_sha256_file,
            llama_runtime::llama_runtime_model_file_exists,
            llama_runtime::llama_runtime_delete_model,
            llama_runtime::llama_runtime_list_installed_models,
            llama_runtime::llama_runtime_probe_resources,
            llama_runtime::llama_runtime_touch_activity,
            llama_runtime::llama_runtime_idle_stop,
            llama_runtime::llama_embed_runtime_start,
            llama_runtime::llama_embed_runtime_info,
            llama_runtime::llama_embed_runtime_stop,
            ollama_runtime::ollama_runtime_status,
            ollama_runtime::ollama_runtime_base_url,
            ollama_runtime::ollama_pull_model,
            ollama_runtime::ollama_model_installed,
            openai_connector::openai_connector_status,
            openai_connector::openai_connector_start,
            openai_connector::openai_connector_stop,
            openai_connector::openai_connector_set_credentials,
            openai_connector::openai_connector_regenerate_key,
        ])
        .setup(|app| {
            if is_local_port_listening(3472) {
                eprintln!("wa sidecar already listening on 3472, reusing existing process");
            } else {
                match spawn_wa_sidecar() {
                    Ok(child) => {
                        *app.state::<SidecarState>().wa_child.lock().unwrap() = Some(child);
                    }
                    Err(err) => {
                        eprintln!("wa sidecar spawn failed: {err}");
                    }
                }
            }
            // Boot bundled Ollama (reused if user already runs one).
            // Required for models llama-server b9279 can't decode
            // (e.g. Ministral-3-2512). Non-fatal if spawn fails — the agent
            // path falls back via llm.py.
            if let Err(err) = ollama_runtime::maybe_spawn(&app.handle()) {
                eprintln!("ollama spawn failed (continuing): {err}");
            }
            #[cfg(debug_assertions)]
            {
                if is_local_port_listening(3471) {
                    eprintln!("agent sidecar already listening on 3471, reusing existing process");
                    return Ok(());
                }
                match spawn_dev_sidecar() {
                    Ok(child) => {
                        *app.state::<SidecarState>().child.lock().unwrap() = Some(child);
                        return Ok(());
                    }
                    Err(err) => {
                        eprintln!("dev sidecar spawn failed, falling back to bundled binary: {err}");
                    }
                }
            }
            if is_local_port_listening(3471) {
                eprintln!("agent sidecar already listening on 3471, reusing existing process");
                return Ok(());
            }
            spawn_bundled_sidecar(&app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Monkey desktop app");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<SidecarState>();
            let mut child_guard = state.child.lock().unwrap();
            if let Some(child) = child_guard.as_mut() {
                let _ = child.kill();
            }
            let mut wa_guard = state.wa_child.lock().unwrap();
            if let Some(child) = wa_guard.as_mut() {
                let _ = child.kill();
            }
            let mut pr_guard = state.provider_child.lock().unwrap();
            if let Some(child) = pr_guard.as_mut() {
                let _ = child.kill();
            }
            let llama_state = app_handle.state::<llama_runtime::LlamaState>();
            llama_runtime::kill_on_exit(&llama_state);
            let embed_state = app_handle.state::<llama_runtime::LlamaEmbedState>();
            llama_runtime::kill_embed_on_exit(&embed_state);
            let ollama_state = app_handle.state::<ollama_runtime::OllamaState>();
            ollama_runtime::kill_on_exit(&ollama_state);
            let connector_state = app_handle.state::<openai_connector::ConnectorState>();
            openai_connector::kill_on_exit(&connector_state);
        }
    });
}
