// Bundled Ollama sidecar manager.
//
// Why bundled: some catalog models (Ministral-3-2512 family) require a newer
// llama.cpp build than the one we ship for llama-server (b9279). Ollama 0.24+
// supports them out of the box, so we bundle the Ollama binary as a fallback
// for those models. The Python sidecar (monkey/llm.py) already falls back
// from `_chat_bundled` → `_chat_ollama` on incompatible-model errors, and
// `OLLAMA_BASE_URL` env var (default http://localhost:11434) points it at the
// right instance.
//
// Lifecycle:
//   - On Tauri boot: if port 11434 already responds, reuse the user's existing
//     Ollama daemon — never spawn a competing process.
//   - Otherwise spawn the bundled `ollama serve` on default port 11434 with
//     OLLAMA_MODELS pointing at `~/.ollama/models` (default) so any existing
//     model pulls are visible.
//   - On Tauri exit: kill the child we spawned. If we reused an existing
//     daemon, leave it alone.
//
// The bundled binary ships at:
//   <resource_dir>/binaries/ollama-<target-triple>[.exe]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const OLLAMA_PORT: u16 = 11434;
const LOOPBACK: &str = "127.0.0.1";

pub struct OllamaState {
    inner: Mutex<Option<RunningOllama>>,
}

impl OllamaState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

struct RunningOllama {
    child: Child,
    // True when we spawned the binary ourselves. False when we detected an
    // existing daemon on 11434 and skipped spawning — in that case we must
    // not kill anything at shutdown.
    spawned_by_us: bool,
}

#[derive(Serialize, Clone)]
pub struct OllamaStatus {
    running: bool,
    pid: Option<u32>,
    reused: bool,
}

fn is_port_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

#[tauri::command]
pub fn ollama_runtime_status(state: State<'_, OllamaState>) -> OllamaStatus {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        if let Ok(Some(_)) = r.child.try_wait() {
            *guard = None;
        }
    }
    match guard.as_ref() {
        Some(r) => OllamaStatus {
            running: true,
            pid: Some(r.child.id()),
            reused: !r.spawned_by_us,
        },
        None => OllamaStatus {
            running: is_port_listening(OLLAMA_PORT),
            pid: None,
            reused: is_port_listening(OLLAMA_PORT),
        },
    }
}

#[tauri::command]
pub fn ollama_runtime_base_url() -> String {
    format!("http://{LOOPBACK}:{OLLAMA_PORT}")
}

pub fn maybe_spawn(app: &AppHandle) -> Result<OllamaStatus, String> {
    if is_port_listening(OLLAMA_PORT) {
        eprintln!("[ollama-runtime] port {OLLAMA_PORT} already listening — reusing existing daemon");
        // Track a placeholder so kill_on_exit knows not to touch it.
        return Ok(OllamaStatus { running: true, pid: None, reused: true });
    }
    let binary = locate_binary(app)?;
    eprintln!("[ollama-runtime] spawning {}", binary.display());

    let mut cmd = StdCommand::new(&binary);
    cmd.arg("serve")
        // Default ~/.ollama/models — keeps compatibility with any existing
        // user pulls. We don't override OLLAMA_MODELS so power users who set
        // it for an external drive still benefit.
        .env("OLLAMA_HOST", format!("{LOOPBACK}:{OLLAMA_PORT}"))
        .env("OLLAMA_KEEP_ALIVE", "5m");

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn ollama ({}): {e}", binary.display()))?;

    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                eprintln!("[ollama] {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[ollama] {line}");
            }
        });
    }

    // Wait briefly for port to become reachable so callers right after boot
    // don't get a connection refused.
    let pid = child.id();
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if is_port_listening(OLLAMA_PORT) {
            break;
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("ollama exited during boot (code {:?})", status.code()));
        }
        thread::sleep(Duration::from_millis(150));
    }

    let status = OllamaStatus { running: true, pid: Some(pid), reused: false };
    let state_handle = app.state::<OllamaState>();
    let mut guard = state_handle.inner.lock().unwrap();
    *guard = Some(RunningOllama { child, spawned_by_us: true });
    Ok(status)
}

pub fn kill_on_exit(state: &OllamaState) {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        if r.spawned_by_us {
            let _ = r.child.kill();
        }
    }
    *guard = None;
}

#[derive(Serialize, Clone)]
struct PullProgress {
    #[serde(rename = "modelTag")]
    model_tag: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed: Option<u64>,
}

#[tauri::command]
pub async fn ollama_pull_model(app: AppHandle, model_tag: String) -> Result<(), String> {
    if !is_port_listening(OLLAMA_PORT) {
        return Err(format!("ollama not running on {LOOPBACK}:{OLLAMA_PORT}"));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post(format!("http://{LOOPBACK}:{OLLAMA_PORT}/api/pull"))
        .json(&serde_json::json!({ "name": model_tag, "stream": true }))
        .send()
        .await
        .map_err(|e| format!("POST /api/pull: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("ollama pull HTTP {status}: {}", body.chars().take(300).collect::<String>()));
    }
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream: {e}"))?;
        buf.extend_from_slice(&bytes);
        while let Some(nl) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line[..line.len().saturating_sub(1)]);
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let status_str = v.get("status").and_then(|s| s.as_str()).unwrap_or("").to_string();
                let digest = v.get("digest").and_then(|s| s.as_str()).map(|s| s.to_string());
                let total = v.get("total").and_then(|n| n.as_u64());
                let completed = v.get("completed").and_then(|n| n.as_u64());
                if let Some(err) = v.get("error").and_then(|s| s.as_str()) {
                    return Err(format!("ollama pull: {err}"));
                }
                let _ = app.emit(
                    "ollama-pull-progress",
                    PullProgress {
                        model_tag: model_tag.clone(),
                        status: status_str,
                        digest,
                        total,
                        completed,
                    },
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ollama_model_installed(model_tag: String) -> Result<bool, String> {
    if !is_port_listening(OLLAMA_PORT) {
        return Ok(false);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get(format!("http://{LOOPBACK}:{OLLAMA_PORT}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("GET /api/tags: {e}"))?;
    if !resp.status().is_success() {
        return Ok(false);
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("parse: {e}"))?;
    let models = v.get("models").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    Ok(models.iter().any(|m| {
        m.get("name").and_then(|n| n.as_str()).map(|n| n == model_tag).unwrap_or(false)
    }))
}

fn locate_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let triple = target_triple();
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let file = format!("ollama-{triple}{exe_suffix}");

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let bundled = resource_dir.join("binaries").join(&file);
    if bundled.is_file() {
        return Ok(bundled);
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(s) = std::env::var("OLLAMA_BIN") {
            let p = PathBuf::from(s);
            if p.is_file() {
                return Ok(p);
            }
        }
        if let Ok(p) = which_in_path("ollama") {
            return Ok(p);
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dev_path = manifest_dir.join("binaries").join(&file);
        if dev_path.is_file() {
            return Ok(dev_path);
        }
    }

    Err(format!(
        "bundled ollama not found ({}). Expected at {}",
        file,
        bundled.display()
    ))
}

fn target_triple() -> &'static str {
    if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
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
    }
}

#[cfg(debug_assertions)]
fn which_in_path(name: &str) -> Result<PathBuf, ()> {
    let path = std::env::var_os("PATH").ok_or(())?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{name}.exe"));
            if with_exe.is_file() {
                return Ok(with_exe);
            }
        }
    }
    Err(())
}

#[allow(dead_code)]
fn _unused_path_marker(_: &Path) {}
