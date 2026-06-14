// Bundled llama.cpp `llama-server` sidecar manager.
//
// Security model:
//   - bind 127.0.0.1 only — never reachable from another host
//   - random ephemeral port (49152–65535) chosen per boot
//   - random 32-byte bearer token generated per boot, required on every
//     request via `Authorization: Bearer <token>`
//   - no daemon: child process dies with the app (kill on Tauri Exit)
//   - models loaded only from app_data_dir/models, never from arbitrary paths
//   - SHA256 of the GGUF verified by the JS layer before activation
//
// The bundled binary ships at:
//   <resource_dir>/binaries/llama-server-<target-triple>[.exe]
//
// In debug builds, `LLAMA_SERVER_BIN` env var overrides, falling back to
// `llama-server` in PATH. Release builds *only* trust the bundled binary —
// no PATH lookup, no env override.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command as StdCommand, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

const LOOPBACK: &str = "127.0.0.1";

pub struct LlamaState {
    inner: Mutex<Option<RunningLlama>>,
    last_error: Mutex<Option<String>>,
    last_activity: Mutex<Option<Instant>>,
}

impl LlamaState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            last_error: Mutex::new(None),
            last_activity: Mutex::new(None),
        }
    }
}

// Separate process slot for embedding mode. llama-server cannot serve both
// chat completions and embeddings concurrently (a single process is either
// in --embedding mode or not). To let the KB run embeddings while the user
// is chatting, we spawn a second llama-server instance on its own port.
pub struct LlamaEmbedState {
    inner: Mutex<Option<RunningLlama>>,
}

impl LlamaEmbedState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

struct RunningLlama {
    child: Child,
    port: u16,
    bearer: String,
    model_path: PathBuf,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

// Keep last N stderr lines per child. Enough to surface a load-time error
// (typically ~20 lines) without unbounded memory if the server runs for days.
const STDERR_TAIL_LINES: usize = 80;

fn drain_tail(tail: &Arc<Mutex<VecDeque<String>>>) -> String {
    tail.lock().ok().map(|g| g.iter().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

#[derive(Serialize, Clone)]
pub struct LlamaStatus {
    running: bool,
    pid: Option<u32>,
    port: Option<u16>,
    #[serde(rename = "modelPath")]
    model_path: Option<String>,
}

#[derive(Serialize)]
pub struct LlamaInfo {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "bearerToken")]
    bearer_token: String,
    port: u16,
    #[serde(rename = "modelPath")]
    model_path: String,
}

fn current_status(running: &Option<RunningLlama>) -> LlamaStatus {
    match running {
        Some(r) => LlamaStatus {
            running: true,
            pid: Some(r.child.id()),
            port: Some(r.port),
            model_path: Some(r.model_path.display().to_string()),
        },
        None => LlamaStatus {
            running: false,
            pid: None,
            port: None,
            model_path: None,
        },
    }
}

fn format_exit_code(status: &ExitStatus) -> String {
    #[cfg(unix)]
    if let Some(sig) = status.signal() {
        return format!("signal:{sig}");
    }
    status
        .code()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "signal".into())
}

fn tail_or_hint(tail: &str) -> String {
    let snippet = tail
        .lines()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" | ");
    if !snippet.trim().is_empty() {
        return snippet;
    }
    #[cfg(target_os = "macos")]
    {
        return "no stderr output (possible macOS code-sign/quarantine kill; refresh binaries with desktop/src-tauri/scripts/fetch-llama-server.sh FORCE=1)".into();
    }
    #[cfg(not(target_os = "macos"))]
    {
        return "no stderr output".into();
    }
}

fn capture_death(state: &LlamaState, r: &RunningLlama, status: &ExitStatus) {
    let tail = drain_tail(&r.stderr_tail);
    let snippet = tail_or_hint(&tail);
    let code = format_exit_code(status);
    let msg = format!("llama-server exited (code {code}): {snippet}");
    eprintln!("[llama-runtime] {msg}");
    if let Ok(mut g) = state.last_error.lock() {
        *g = Some(msg);
    }
}

#[tauri::command]
pub fn llama_runtime_status(state: State<'_, LlamaState>) -> LlamaStatus {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        match r.child.try_wait() {
            Ok(None) => return current_status(&guard),
            Ok(Some(s)) => capture_death(&state, r, &s),
            Err(_) => {}
        }
    }
    *guard = None;
    current_status(&guard)
}

#[tauri::command]
pub fn llama_runtime_info(state: State<'_, LlamaState>) -> Option<LlamaInfo> {
    active_info(&state)
}

// Same body as llama_runtime_info, but callable from non-Tauri contexts
// (e.g. the OpenAI connector running in its own tokio task).
pub fn active_info(state: &LlamaState) -> Option<LlamaInfo> {
    let mut guard = state.inner.lock().unwrap();
    let r = guard.as_mut()?;
    if let Ok(Some(s)) = r.child.try_wait() {
        capture_death(state, r, &s);
        *guard = None;
        return None;
    }
    Some(LlamaInfo {
        base_url: format!("http://{LOOPBACK}:{}", r.port),
        bearer_token: r.bearer.clone(),
        port: r.port,
        model_path: r.model_path.display().to_string(),
    })
}

impl LlamaInfo {
    pub fn base_url(&self) -> &str { &self.base_url }
    pub fn bearer_token(&self) -> &str { &self.bearer_token }
}

#[tauri::command]
pub fn llama_runtime_last_error(state: State<'_, LlamaState>) -> Option<String> {
    state.last_error.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn llama_runtime_models_dir(app: AppHandle) -> Result<String, String> {
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    Ok(dir.display().to_string())
}

fn start_into_slot(
    app: &AppHandle,
    slot: &Mutex<Option<RunningLlama>>,
    model_path: String,
    context_len: Option<u32>,
    gpu_layers: Option<i32>,
    threads: Option<u32>,
    embedding: Option<bool>,
    pooling: Option<String>,
) -> Result<LlamaStatus, String> {
    let mut guard = slot.lock().unwrap();

    if let Some(r) = guard.as_mut() {
        match r.child.try_wait() {
            Ok(None) => {
                let _ = r.child.kill();
                let _ = r.child.wait();
            }
            _ => {}
        }
        *guard = None;
    }

    let model = PathBuf::from(&model_path);
    let models_root = models_dir(app)?;
    let canonical_model = model
        .canonicalize()
        .map_err(|e| format!("model path: {e}"))?;
    let canonical_root = models_root
        .canonicalize()
        .map_err(|e| format!("models dir: {e}"))?;
    if !canonical_model.starts_with(&canonical_root) {
        return Err(format!(
            "model path must live under {} (got {})",
            canonical_root.display(),
            canonical_model.display()
        ));
    }
    if !canonical_model.is_file() {
        return Err(format!(
            "model file not found: {}",
            canonical_model.display()
        ));
    }

    let binary = locate_binary(app)?;
    #[cfg(all(debug_assertions, target_os = "macos"))]
    maybe_repair_dev_codesign(&binary);
    let port = pick_free_port()?;
    let bearer = random_bearer();

    let mut cmd = StdCommand::new(&binary);
    cmd.arg("--host").arg(LOOPBACK)
        .arg("--port").arg(port.to_string())
        .arg("--api-key").arg(&bearer)
        .arg("--model").arg(&canonical_model)
        .arg("--log-disable");
    if let Some(c) = context_len {
        if c > 0 {
            cmd.arg("--ctx-size").arg(c.to_string());
        }
    }
    if let Some(g) = gpu_layers {
        cmd.arg("--n-gpu-layers").arg(g.to_string());
    }
    if let Some(t) = threads {
        if t > 0 {
            cmd.arg("--threads").arg(t.to_string());
        }
    }
    // Embedding mode: same llama-server binary, exposes /v1/embeddings instead
    // of /v1/chat/completions. Pooling per-model: Qwen3-Embedding family uses
    // 'last' (causal LM, EOS-token pooling — 'mean' produces NaN/null vectors),
    // BGE-M3 uses 'cls'. Defaults to 'mean' for legacy entries when unset.
    if embedding.unwrap_or(false) {
        let pool = pooling.as_deref().unwrap_or("mean");
        let pool = match pool {
            "mean" | "cls" | "last" | "none" => pool,
            _ => "mean",
        };
        cmd.arg("--embedding").arg("--pooling").arg(pool);
    } else {
        // --jinja activates the GGUF-embedded chat template so tool_calls surface
        // in OpenAI format (Phi-4-mini, Llama-3.1, Qwen-2.5, Mistral, Gemma-2 all
        // ship a template). Without it, function-calling models emit tool tags
        // inline in `content` and our agent can't parse them.
        cmd.arg("--jinja");
    }

    let mut child = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn llama-server ({}): {e}", binary.display()))?;

    // Tee stderr: keep last N lines in a ring buffer (for error surfacing on
    // early death) AND mirror to parent stderr so the live Tauri log still
    // shows the boot output.
    let tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
    if let Some(stderr) = child.stderr.take() {
        let tail_w = Arc::clone(&tail);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[llama-server] {line}");
                if let Ok(mut g) = tail_w.lock() {
                    if g.len() == STDERR_TAIL_LINES { g.pop_front(); }
                    g.push_back(line);
                }
            }
        });
    }

    // Spawn-then-die watchdog: llama-server exits within ~1s when the model
    // is incompatible (e.g. unknown pre-tokenizer, unsupported arch). Poll
    // briefly and surface stderr tail instead of returning a misleading
    // "started" status that the JS layer will only catch on the next 8s poll.
    let deadline = Instant::now() + Duration::from_millis(1500);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // Give the reader thread a moment to drain remaining lines.
                thread::sleep(Duration::from_millis(150));
                let stderr_tail = drain_tail(&tail);
                let snippet = tail_or_hint(&stderr_tail);
                let code = format_exit_code(&status);
                return Err(format!("llama-server exited immediately (code {code}): {snippet}"));
            }
            Ok(None) => {
                if Instant::now() >= deadline { break; }
                thread::sleep(Duration::from_millis(80));
            }
            Err(e) => return Err(format!("try_wait: {e}")),
        }
    }

    *guard = Some(RunningLlama {
        child,
        port,
        bearer,
        model_path: canonical_model,
        stderr_tail: tail,
    });
    Ok(current_status(&guard))
}

#[tauri::command]
pub fn llama_runtime_start(
    app: AppHandle,
    state: State<'_, LlamaState>,
    model_path: String,
    context_len: Option<u32>,
    gpu_layers: Option<i32>,
    threads: Option<u32>,
    embedding: Option<bool>,
) -> Result<LlamaStatus, String> {
    let result = start_into_slot(&app, &state.inner, model_path, context_len, gpu_layers, threads, embedding, None);
    if result.is_ok() {
        *state.last_activity.lock().unwrap() = Some(Instant::now());
    }
    result
}

#[tauri::command]
pub fn llama_embed_runtime_start(
    app: AppHandle,
    state: State<'_, LlamaEmbedState>,
    model_path: String,
    context_len: Option<u32>,
    gpu_layers: Option<i32>,
    threads: Option<u32>,
    pooling: Option<String>,
) -> Result<LlamaStatus, String> {
    start_into_slot(&app, &state.inner, model_path, context_len, gpu_layers, threads, Some(true), pooling)
}

#[tauri::command]
pub fn llama_embed_runtime_info(state: State<'_, LlamaEmbedState>) -> Option<LlamaInfo> {
    let mut guard = state.inner.lock().unwrap();
    let r = guard.as_mut()?;
    if r.child.try_wait().ok().flatten().is_some() {
        *guard = None;
        return None;
    }
    Some(LlamaInfo {
        base_url: format!("http://{LOOPBACK}:{}", r.port),
        bearer_token: r.bearer.clone(),
        port: r.port,
        model_path: r.model_path.display().to_string(),
    })
}

#[tauri::command]
pub fn llama_embed_runtime_stop(state: State<'_, LlamaEmbedState>) -> LlamaStatus {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        let _ = r.child.kill();
        let _ = r.child.wait();
    }
    *guard = None;
    current_status(&guard)
}

pub fn kill_embed_on_exit(state: &LlamaEmbedState) {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        let _ = r.child.kill();
    }
    *guard = None;
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    #[serde(rename = "modelId")]
    model_id: String,
    downloaded: u64,
    total: u64,
}

#[tauri::command]
pub async fn llama_runtime_download_model(
    app: AppHandle,
    model_id: String,
    url: String,
    target_name: String,
    expected_size: Option<u64>,
) -> Result<String, String> {
    use std::fs::OpenOptions;
    if target_name.contains('/') || target_name.contains('\\') || target_name.contains("..") {
        return Err("invalid target_name".into());
    }
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    let final_path = dir.join(&target_name);
    let part_path = dir.join(format!("{target_name}.part"));

    // Idempotent: if the final file already exists (previous successful download
    // or concurrent caller won the race), skip. Avoids the ENOENT-on-rename when
    // a second click races and finds the .part already moved.
    if final_path.is_file() {
        if let Ok(meta) = std::fs::metadata(&final_path) {
            let size = meta.len();
            let _ = app.emit(
                "llama-download-progress",
                DownloadProgress { model_id, downloaded: size, total: size },
            );
        }
        let _ = std::fs::remove_file(&part_path);
        return Ok(final_path.to_string_lossy().to_string());
    }

    // Preflight: refuse if the destination volume cannot fit the file.
    // We do not yet know whether the server will honor Range — assume the
    // worst (full re-download) so we never start something that cannot finish.
    if let Some(size) = expected_size {
        if let Some(free) = free_disk_bytes(&dir) {
            let cushion = 256u64 * 1024 * 1024;
            if free < size.saturating_add(cushion) {
                return Err(format!(
                    "not enough free disk space: need ~{} MB, have {} MB",
                    size / (1024 * 1024),
                    free / (1024 * 1024),
                ));
            }
        }
    }

    // Resume support: reuse .part if present.
    let resume_from: u64 = std::fs::metadata(&part_path).ok().map(|m| m.len()).unwrap_or(0);

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let mut req = client.get(&url);
    if resume_from > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
    }
    eprintln!("[llama-dl] GET {url} (resume_from={resume_from})");
    let resp = req.send().await.map_err(|e| format!("GET {url}: {e}"))?;
    let status = resp.status();
    let supports_resume = status == reqwest::StatusCode::PARTIAL_CONTENT;
    eprintln!("[llama-dl] status={status} content_length={:?}", resp.content_length());
    if !status.is_success() {
        return Err(format!("HTTP {status} from {url}"));
    }
    // Server ignored Range → restart from zero, truncate part file.
    let start_offset = if supports_resume { resume_from } else { 0 };
    let total = match resp.content_length() {
        Some(c) if supports_resume => c + start_offset,
        Some(c) => c,
        None => expected_size.unwrap_or(0),
    };

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!supports_resume)
        .append(supports_resume)
        .open(&part_path)
        .map_err(|e| format!("open {}: {e}", part_path.display()))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = start_offset;
    let mut last_emit: u64 = 0;
    // Initial emit so the UI knows the request landed and we are streaming.
    let _ = app.emit(
        "llama-download-progress",
        DownloadProgress { model_id: model_id.clone(), downloaded, total },
    );
    eprintln!("[llama-dl] streaming model_id={model_id} total={total} start_offset={start_offset}");
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream chunk: {e}"))?;
        file.write_all(&bytes)
            .map_err(|e| format!("write: {e}"))?;
        downloaded += bytes.len() as u64;
        if downloaded - last_emit > 1_048_576 {
            last_emit = downloaded;
            let _ = app.emit(
                "llama-download-progress",
                DownloadProgress {
                    model_id: model_id.clone(),
                    downloaded,
                    total,
                },
            );
        }
    }
    file.flush().map_err(|e| format!("flush: {e}"))?;
    drop(file);
    if let Err(e) = std::fs::rename(&part_path, &final_path) {
        if !final_path.is_file() {
            return Err(format!("rename: {e}"));
        }
        let _ = std::fs::remove_file(&part_path);
    }
    let _ = app.emit(
        "llama-download-progress",
        DownloadProgress {
            model_id,
            downloaded,
            total,
        },
    );
    Ok(final_path.display().to_string())
}

#[derive(Serialize)]
pub struct ResourceProbe {
    #[serde(rename = "freeDiskBytes")]
    free_disk_bytes: u64,
    #[serde(rename = "totalRamBytes")]
    total_ram_bytes: u64,
}

#[tauri::command]
pub fn llama_runtime_probe_resources(app: AppHandle) -> Result<ResourceProbe, String> {
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    Ok(ResourceProbe {
        free_disk_bytes: free_disk_bytes(&dir).unwrap_or(0),
        total_ram_bytes: total_ram_bytes(),
    })
}

#[cfg(unix)]
fn free_disk_bytes(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c.as_ptr(), &mut s) };
    if rc != 0 { return None; }
    Some(s.f_bavail as u64 * s.f_frsize as u64)
}

#[cfg(windows)]
fn free_disk_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(std::iter::once(0)).collect();
    let mut free_to_caller: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }
    let rc = unsafe {
        GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_to_caller, &mut total, &mut free)
    };
    if rc == 0 { None } else { Some(free_to_caller) }
}

#[cfg(target_os = "macos")]
fn total_ram_bytes() -> u64 {
    let mut size: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    let name = std::ffi::CString::new("hw.memsize").unwrap();
    let rc = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            &mut size as *mut _ as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc == 0 { size } else { 0 }
}

#[cfg(target_os = "linux")]
fn total_ram_bytes() -> u64 {
    let mut info: libc::sysinfo = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::sysinfo(&mut info) };
    if rc != 0 { return 0; }
    info.totalram as u64 * info.mem_unit as u64
}

#[cfg(windows)]
fn total_ram_bytes() -> u64 {
    #[repr(C)]
    struct MEMORYSTATUSEX {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MEMORYSTATUSEX) -> i32;
    }
    let mut s: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    s.dw_length = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    let rc = unsafe { GlobalMemoryStatusEx(&mut s) };
    if rc == 0 { 0 } else { s.ull_total_phys }
}

#[tauri::command]
pub fn llama_runtime_sha256_file(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(&path).map_err(|e| format!("open {path}: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex_encode(&hasher.finalize()))
}

#[tauri::command]
pub fn llama_runtime_model_file_exists(app: AppHandle, target_name: String) -> Result<bool, String> {
    if target_name.contains('/') || target_name.contains('\\') || target_name.contains("..") {
        return Err("invalid target_name".into());
    }
    let dir = models_dir(&app)?;
    Ok(dir.join(target_name).is_file())
}

#[tauri::command]
pub fn llama_runtime_list_installed_models(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = models_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))? {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if name.ends_with(".part") { continue; }
        let lower = name.to_lowercase();
        if lower.ends_with(".gguf")
            || lower.ends_with(".onnx")
            || lower.ends_with(".onnx.json")
            || lower.ends_with(".bin")
            || lower.ends_with(".safetensors")
        {
            out.push(name);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn llama_runtime_delete_model(app: AppHandle, target_name: String) -> Result<(), String> {
    if target_name.contains('/') || target_name.contains('\\') || target_name.contains("..") {
        return Err("invalid target_name".into());
    }
    let dir = models_dir(&app)?;
    let p = dir.join(&target_name);
    if p.is_file() {
        std::fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn llama_runtime_stop(state: State<'_, LlamaState>) -> LlamaStatus {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        let _ = r.child.kill();
        let _ = r.child.wait();
    }
    *guard = None;
    *state.last_activity.lock().unwrap() = None;
    current_status(&guard)
}

#[tauri::command]
pub fn llama_runtime_touch_activity(state: State<'_, LlamaState>) {
    let guard = state.inner.lock().unwrap();
    if guard.is_some() {
        *state.last_activity.lock().unwrap() = Some(Instant::now());
    }
}

#[tauri::command]
pub fn llama_runtime_idle_stop(state: State<'_, LlamaState>, idle_secs: u64) -> bool {
    let activity = *state.last_activity.lock().unwrap();
    let elapsed = match activity {
        Some(t) => t.elapsed().as_secs(),
        None => return false,
    };
    if elapsed < idle_secs {
        return false;
    }
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        let _ = r.child.kill();
        let _ = r.child.wait();
    }
    *guard = None;
    *state.last_activity.lock().unwrap() = None;
    true
}

pub fn kill_on_exit(state: &LlamaState) {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        let _ = r.child.kill();
    }
    *guard = None;
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(base.join("models"))
}

fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind(format!("{LOOPBACK}:0"))
        .map_err(|e| format!("bind ephemeral: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn random_bearer() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    hex_encode(&bytes)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

fn locate_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let triple = target_triple();
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let file = format!("llama-server-{triple}{exe_suffix}");

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
        if let Ok(s) = std::env::var("LLAMA_SERVER_BIN") {
            let p = PathBuf::from(s);
            if p.is_file() {
                return Ok(p);
            }
        }
        if let Ok(p) = which_in_path("llama-server") {
            return Ok(p);
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dev_path = manifest_dir.join("binaries").join(&file);
        if dev_path.is_file() {
            return Ok(dev_path);
        }
    }

    Err(format!(
        "bundled llama-server not found ({}). Expected at {}",
        file,
        bundled.display()
    ))
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn maybe_repair_dev_codesign(binary: &Path) {
    if std::env::var_os("MONKEY_SKIP_LLAMA_CODESIGN_REPAIR").is_some() {
        return;
    }
    let mut targets: Vec<PathBuf> = vec![binary.to_path_buf()];
    if let Some(dir) = binary.parent() {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                if p.extension().and_then(|e| e.to_str()) == Some("dylib") {
                    targets.push(p);
                }
            }
        }
    }
    for t in targets {
        let _ = StdCommand::new("/usr/bin/xattr")
            .arg("-d")
            .arg("com.apple.quarantine")
            .arg(&t)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = StdCommand::new("/usr/bin/codesign")
            .arg("--force")
            .arg("--sign")
            .arg("-")
            .arg(&t)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
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
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{name}.exe"));
            if is_executable_file(&with_exe) {
                return Ok(with_exe);
            }
        }
    }
    Err(())
}

#[cfg(debug_assertions)]
fn is_executable_file(p: &Path) -> bool {
    p.is_file()
}
