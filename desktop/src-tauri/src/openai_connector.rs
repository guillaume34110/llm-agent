// OpenAI-compatible HTTP connector. Lets external apps (LangChain, LiteLLM,
// custom scripts, IDE plugins) talk to Monkey's inference stack via the
// standard OpenAI /v1 surface.
//
// Security model:
//   - bind 127.0.0.1 only — never reachable from another host
//   - Bearer token required on every call (random 32-byte hex per install,
//     prefixed `mk-`, persisted in app data dir, regeneratable from Settings)
//   - no logging of prompts or responses (local-first invariant)
//   - no cloud fallback. If no transport works, returns 503.
//
// Routing mirrors the in-app pickTransport priority:
//   1. bundled llama-server sidecar (if running on this device)
//   2. another device of the same user (own provider running elsewhere)
//   3. mutual-friend P2P provider
//   4. 503 with explicit "no provider available"

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::llama_runtime::{self, LlamaState};
use crate::noise_p2p;

// ---------- Tauri-managed state ----------

pub struct ConnectorState {
    inner: Mutex<Option<RunningConnector>>,
}

impl ConnectorState {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }
}

pub fn kill_on_exit(state: &ConnectorState) {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.take() {
        let _ = r.shutdown.send(());
    }
}

struct RunningConnector {
    port: u16,
    shutdown: oneshot::Sender<()>,
    app_state: Arc<ConnectorAppState>,
}

struct ConnectorAppState {
    api_key: String,
    jwt: RwLock<String>,
    server_base: RwLock<String>,
    models: RwLock<Vec<String>>,
    app: AppHandle,
}

// ---------- Persisted settings ----------

#[derive(Serialize, Deserialize, Default)]
struct Persisted {
    api_key: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("mkdir app_data: {e}"))?;
    Ok(base.join("openai-connector.json"))
}

fn load_or_create_api_key(app: &AppHandle) -> Result<String, String> {
    let path = settings_path(app)?;
    if path.exists() {
        if let Ok(s) = std::fs::read_to_string(&path) {
            if let Ok(p) = serde_json::from_str::<Persisted>(&s) {
                if let Some(k) = p.api_key.filter(|k| k.len() >= 32) {
                    return Ok(k);
                }
            }
        }
    }
    let key = random_api_key();
    let p = Persisted { api_key: Some(key.clone()) };
    std::fs::write(&path, serde_json::to_string(&p).unwrap())
        .map_err(|e| format!("write settings: {e}"))?;
    Ok(key)
}

fn write_api_key(app: &AppHandle, key: &str) -> Result<(), String> {
    let path = settings_path(app)?;
    let p = Persisted { api_key: Some(key.to_string()) };
    std::fs::write(&path, serde_json::to_string(&p).unwrap())
        .map_err(|e| format!("write settings: {e}"))?;
    Ok(())
}

fn random_api_key() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(3 + bytes.len() * 2);
    s.push_str("mk-");
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

// ---------- Tauri commands ----------

#[derive(Serialize)]
pub struct ConnectorInfo {
    running: bool,
    port: Option<u16>,
    url: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: String,
}

#[tauri::command]
pub fn openai_connector_status(
    state: tauri::State<'_, ConnectorState>,
    app: AppHandle,
) -> Result<ConnectorInfo, String> {
    let guard = state.inner.lock().unwrap();
    let api_key = load_or_create_api_key(&app)?;
    Ok(match guard.as_ref() {
        Some(r) => ConnectorInfo {
            running: true,
            port: Some(r.port),
            url: Some(format!("http://127.0.0.1:{}/v1", r.port)),
            api_key,
        },
        None => ConnectorInfo {
            running: false,
            port: None,
            url: None,
            api_key,
        },
    })
}

#[tauri::command]
pub async fn openai_connector_start(
    state: tauri::State<'_, ConnectorState>,
    app: AppHandle,
    jwt: String,
    server_base: String,
    models: Vec<String>,
    port: Option<u16>,
) -> Result<ConnectorInfo, String> {
    let api_key = load_or_create_api_key(&app)?;

    // Stop any existing instance first.
    {
        let mut guard = state.inner.lock().unwrap();
        if let Some(r) = guard.take() {
            let _ = r.shutdown.send(());
        }
    }

    let bind_port = port.unwrap_or(0);
    let addr: SocketAddr = format!("127.0.0.1:{bind_port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    let listener = TcpListener::bind(addr).await.map_err(|e| format!("bind: {e}"))?;
    let actual_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let app_state = Arc::new(ConnectorAppState {
        api_key: api_key.clone(),
        jwt: RwLock::new(jwt),
        server_base: RwLock::new(server_base),
        models: RwLock::new(models),
        app: app.clone(),
    });
    let router = build_router(app_state.clone());

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = rx.await;
        });
        if let Err(e) = server.await {
            eprintln!("[openai-connector] serve error: {e}");
        }
    });

    let info = ConnectorInfo {
        running: true,
        port: Some(actual_port),
        url: Some(format!("http://127.0.0.1:{actual_port}/v1")),
        api_key: api_key.clone(),
    };
    {
        let mut guard = state.inner.lock().unwrap();
        *guard = Some(RunningConnector {
            port: actual_port,
            shutdown: tx,
            app_state,
        });
    }
    Ok(info)
}

#[tauri::command]
pub fn openai_connector_stop(state: tauri::State<'_, ConnectorState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();
    if let Some(r) = guard.take() {
        let _ = r.shutdown.send(());
    }
    Ok(())
}

// Mutate credentials of a running instance in place (no restart needed). JWT
// rotates on relogin — caller must push the new value here.
#[tauri::command]
pub fn openai_connector_set_credentials(
    state: tauri::State<'_, ConnectorState>,
    jwt: Option<String>,
    server_base: Option<String>,
    models: Option<Vec<String>>,
) -> Result<(), String> {
    let guard = state.inner.lock().unwrap();
    let r = guard.as_ref().ok_or_else(|| "connector not running".to_string())?;
    if let Some(j) = jwt {
        *r.app_state.jwt.write().unwrap() = j;
    }
    if let Some(s) = server_base {
        *r.app_state.server_base.write().unwrap() = s;
    }
    if let Some(m) = models {
        *r.app_state.models.write().unwrap() = m;
    }
    Ok(())
}

// Generate a fresh API key. The caller must restart the connector for the new
// key to apply (the running instance keeps validating against its boot-time
// key until it's torn down).
#[tauri::command]
pub fn openai_connector_regenerate_key(app: AppHandle) -> Result<String, String> {
    let key = random_api_key();
    write_api_key(&app, &key)?;
    Ok(key)
}

// ---------- Router & handlers ----------

fn build_router(state: Arc<ConnectorAppState>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/models", get(models_handler))
        .route("/v1/chat/completions", post(chat_handler))
        .with_state(state)
}

fn check_auth(headers: &HeaderMap, expected: &str) -> Option<Response> {
    let bearer = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.trim());
    if bearer == Some(expected) {
        None
    } else {
        Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": { "message": "invalid api key", "type": "auth_error" } })),
            )
                .into_response(),
        )
    }
}

async fn models_handler(
    headers: HeaderMap,
    State(s): State<Arc<ConnectorAppState>>,
) -> Response {
    if let Some(r) = check_auth(&headers, &s.api_key) {
        return r;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let models = s.models.read().unwrap().clone();
    let data: Vec<Value> = models
        .iter()
        .map(|id| {
            json!({
                "id": id,
                "object": "model",
                "created": now,
                "owned_by": "monkey",
            })
        })
        .collect();
    Json(json!({ "object": "list", "data": data })).into_response()
}

async fn chat_handler(
    headers: HeaderMap,
    State(s): State<Arc<ConnectorAppState>>,
    Json(body): Json<Value>,
) -> Response {
    if let Some(r) = check_auth(&headers, &s.api_key) {
        return r;
    }
    let model = body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if model.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "missing `model` field");
    }
    match route_request(&s, &model, body).await {
        Ok(v) => Json(v).into_response(),
        Err((code, msg)) => error_response(code, &msg),
    }
}

fn error_response(code: StatusCode, msg: &str) -> Response {
    (
        code,
        Json(json!({ "error": { "message": msg, "type": "monkey_error" } })),
    )
        .into_response()
}

async fn route_request(
    s: &ConnectorAppState,
    model: &str,
    body: Value,
) -> Result<Value, (StatusCode, String)> {
    // 1. local llama
    let llama_state = s.app.state::<LlamaState>();
    if let Some(info) = llama_runtime::active_info(&llama_state) {
        return call_local_llama(info.base_url(), info.bearer_token(), body).await;
    }

    // 2. own devices
    match list_presence(s, "/api/presence/mine", model).await {
        Ok(rows) => {
            if let Some(p) = pick_attested(&rows) {
                return call_noise(&p, model, body).await;
            }
        }
        Err(e) => eprintln!("[openai-connector] presence/mine: {e}"),
    }

    // 3. mutual friends
    match list_presence(s, "/api/presence/friends", model).await {
        Ok(rows) => {
            if let Some(p) = pick_attested(&rows) {
                return call_noise(&p, model, body).await;
            }
        }
        Err(e) => eprintln!("[openai-connector] presence/friends: {e}"),
    }

    Err((
        StatusCode::SERVICE_UNAVAILABLE,
        format!(
            "no local model active and no P2P provider online for \"{model}\". \
             activate a model in Settings → Local LLM, or wait for a peer."
        ),
    ))
}

fn pick_attested(rows: &[PresenceRow]) -> Option<PresenceRow> {
    // Attestation mandatory: desktop NoiseP2PTransport refuses unattested
    // providers (desktop/src/p2p/transport.ts). External callers via /v1
    // must get the same guarantee — never send a prompt to a peer whose
    // binary hash hasn't been verified.
    rows.iter().find(|p| p.attested).cloned()
}

#[derive(Deserialize, Clone)]
struct PresenceRow {
    #[serde(rename = "networkAddr")]
    network_addr: String,
    #[serde(rename = "noisePubkey")]
    noise_pubkey: String,
    #[serde(default)]
    attested: bool,
}

async fn list_presence(
    s: &ConnectorAppState,
    path: &str,
    model: &str,
) -> Result<Vec<PresenceRow>, String> {
    let jwt = s.jwt.read().unwrap().clone();
    if jwt.is_empty() {
        return Err("no JWT — not logged in".into());
    }
    let server = s.server_base.read().unwrap().clone();
    let url = format!("{}{}", server.trim_end_matches('/'), path);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .query(&[("modelId", model)])
        .bearer_auth(&jwt)
        .header("X-Device-Id", "openai-connector")
        .send()
        .await
        .map_err(|e| format!("{path}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{path}: HTTP {}", resp.status()));
    }
    resp.json::<Vec<PresenceRow>>()
        .await
        .map_err(|e| format!("decode {path}: {e}"))
}

async fn call_local_llama(
    base_url: &str,
    bearer: &str,
    mut body: Value,
) -> Result<Value, (StatusCode, String)> {
    // Streaming through the connector is not supported yet — force non-stream.
    if let Some(obj) = body.as_object_mut() {
        obj.insert("stream".into(), Value::Bool(false));
    }
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let resp = client
        .post(&url)
        .bearer_auth(bearer)
        .json(&body)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("local llama: {e}")))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("local llama body: {e}")))?;
    if !status.is_success() {
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            text,
        ));
    }
    serde_json::from_str(&text)
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("decode llama: {e}")))
}

async fn call_noise(
    p: &PresenceRow,
    model: &str,
    mut body: Value,
) -> Result<Value, (StatusCode, String)> {
    // Force non-streaming for the P2P leg (the noise transport delivers a
    // single ciphertext response, not a stream of SSE frames).
    if let Some(obj) = body.as_object_mut() {
        obj.insert("stream".into(), Value::Bool(false));
    }
    let req_json = serde_json::to_string(&body).unwrap();
    let resp_text = noise_p2p::p2p_noise_chat(
        p.network_addr.clone(),
        p.noise_pubkey.clone(),
        req_json,
    )
    .await
    .map_err(|e| (StatusCode::BAD_GATEWAY, format!("p2p call: {e}")))?;
    let resp: Value = serde_json::from_str(&resp_text)
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("decode peer response: {e}")))?;

    // Pass through OpenAI-shaped responses (provider runtime that already
    // emits chat.completion format).
    if resp.get("choices").is_some() {
        return Ok(resp);
    }
    // Legacy { text, tool_calls?, usage? } shape → wrap in OpenAI format so
    // clients see a uniform surface regardless of which transport ran.
    let content = resp
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_calls = resp.get("tool_calls").cloned();
    let usage = resp.get("usage").cloned();
    Ok(wrap_openai_response(model, content, tool_calls, usage))
}

fn wrap_openai_response(
    model: &str,
    content: String,
    tool_calls: Option<Value>,
    usage: Option<Value>,
) -> Value {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut message = json!({ "role": "assistant", "content": content });
    if let Some(tc) = tool_calls {
        if let Some(obj) = message.as_object_mut() {
            obj.insert("tool_calls".into(), tc);
        }
    }
    json!({
        "id": format!("chatcmpl-mk-{now}"),
        "object": "chat.completion",
        "created": now,
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": "stop"
        }],
        "usage": usage.unwrap_or_else(|| json!({
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }))
    })
}
