// Noise XK responder with chunked transport. Mirrors initiator in
// desktop/src-tauri/src/noise_p2p.rs.
//
//   handshake: read msg1 (-> e), write msg2 (<- e, ee), store HandshakeState
//              indexed by a fresh X-P2P-Session id.
//   exchange:  body = [u32 BE msg3_len][msg3][u32 BE n_chunks][chunks...]
//              msg3 (-> s, se) carries an empty handshake plaintext in v2.
//              Each chunk is a transport-mode ciphertext (<= 65535 bytes).
//              We reassemble plaintext (32 MB ceiling) into the request JSON,
//              hand off to Ollama/sidecar, and reply with the same framed
//              shape: [u32 BE n_chunks][for each: u32 BE chunk_len + ct].
//
// Sessions are single-use (one request per handshake). DashMap entry is removed
// at the end of exchange().

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use snow::Builder;
use std::sync::{Arc, Mutex};
use tracing::warn;
use uuid::Uuid;

use crate::state::{AppState, Session};

const HANDSHAKE_BUF: usize = 65535;
const CHUNK_CT_MAX: usize = 65535;
const CHUNK_PT: usize = 65000;
const MAX_PT_REQUEST: usize = 32 * 1024 * 1024;

pub async fn handshake(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut responder = Builder::new(state.noise_params.clone())
        .local_private_key(&state.static_priv)
        .build_responder()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut payload = [0u8; HANDSHAKE_BUF];
    responder
        .read_message(&body, &mut payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("read msg1: {e}")))?;

    let mut msg2 = vec![0u8; HANDSHAKE_BUF];
    let n = responder
        .write_message(&[], &mut msg2)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write msg2: {e}")))?;
    msg2.truncate(n);

    // Sweep stale sessions before inserting to prevent unbounded map growth
    // under a handshake-flood. 30 s covers any realistic exchange round-trip.
    let session_ttl = std::time::Duration::from_secs(30);
    state.sessions.retain(|_, s| s.1.elapsed() < session_ttl);

    let session_id = Uuid::new_v4().to_string();
    state
        .sessions
        .insert(session_id.clone(), Session(Mutex::new(Some(responder)), std::time::Instant::now()));

    let mut headers = HeaderMap::new();
    headers.insert(
        "X-P2P-Session",
        session_id.parse().map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, "bad session id".to_string())
        })?,
    );
    headers.insert(
        "Content-Type",
        "application/octet-stream".parse().unwrap(),
    );
    Ok((StatusCode::OK, headers, msg2))
}

pub async fn exchange(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let session_id = headers
        .get("X-P2P-Session")
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing X-P2P-Session".into()))?
        .to_str()
        .map_err(|_| (StatusCode::BAD_REQUEST, "bad session header".into()))?
        .to_string();

    let (_id, session) = state
        .sessions
        .remove(&session_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "unknown session".into()))?;

    let mut handshake_state = session
        .0
        .lock()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "session poisoned".into()))?
        .take()
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "session empty".into()))?;

    let mut cur = 0usize;
    let msg3_len =
        read_u32(&body, &mut cur).ok_or_else(|| bad_req("truncated msg3_len"))?;
    let msg3 = slice_at(&body, &mut cur, msg3_len).ok_or_else(|| bad_req("truncated msg3"))?;

    let mut payload = [0u8; HANDSHAKE_BUF];
    handshake_state
        .read_message(msg3, &mut payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("read msg3: {e}")))?;

    let n_chunks =
        read_u32(&body, &mut cur).ok_or_else(|| bad_req("truncated n_chunks"))?;

    let mut transport = handshake_state
        .into_transport_mode()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("transport: {e}")))?;

    let mut request_pt: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk_pt = vec![0u8; CHUNK_CT_MAX];
    for i in 0..n_chunks {
        let ct_len =
            read_u32(&body, &mut cur).ok_or_else(|| bad_req("truncated chunk len"))?;
        let ct = slice_at(&body, &mut cur, ct_len).ok_or_else(|| bad_req("truncated chunk"))?;
        let n = transport
            .read_message(ct, &mut chunk_pt)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("decrypt chunk {i}: {e}")))?;
        if request_pt.len() + n > MAX_PT_REQUEST {
            return Err((StatusCode::PAYLOAD_TOO_LARGE, "request too large".into()));
        }
        request_pt.extend_from_slice(&chunk_pt[..n]);
    }

    let request_json: serde_json::Value = serde_json::from_slice(&request_pt)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("request not json: {e}")))?;

    let requested_model = request_json
        .get("model")
        .and_then(|v| v.as_str())
        .ok_or_else(|| bad_req("missing model field"))?;
    if !state.is_serving(requested_model) {
        warn!(requested=%requested_model, active=?state.models(), "model not in active set");
        return Err((
            StatusCode::FORBIDDEN,
            format!("model not served by this provider"),
        ));
    }

    let task = crate::tasks::task_for_model(requested_model);

    // Sidecar path: OCR / sentiment / image_classify. Request shape is
    // {image_b64,lang} or {text} — no `messages` array — so the chat-shaped
    // prompt guard does not apply. We still guard the OCR text output
    // (free-form), but skip output guard for sentiment/image_classify which
    // return a bounded label space.
    if crate::tasks::is_sidecar_task(task) {
        let sidecar_resp = match crate::sidecar::dispatch(
            &state.http_client,
            &state.sidecar_base,
            task,
            &request_json,
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                warn!(error=%e, task=%task, "sidecar dispatch failed");
                return encrypt_chunks_and_send(
                    &mut transport,
                    &serde_json::json!({ "error": "sidecar_unavailable" }),
                );
            }
        };

        if task == "ocr" && !sidecar_resp.guardable_text.is_empty() {
            let synth = serde_json::json!({ "messages": [] });
            let verdict = crate::guard::check_output(
                &state.http_client,
                &state.ollama_base,
                &state.guard_model,
                &synth,
                &sidecar_resp.guardable_text,
            )
            .await
            .unwrap_or(crate::guard::GuardVerdict { safe: false });
            if !verdict.safe {
                return encrypt_chunks_and_send(
                    &mut transport,
                    &serde_json::json!({ "text": "", "error": "content_blocked" }),
                );
            }
        }

        state.record_job();
        return encrypt_chunks_and_send(&mut transport, &sidecar_resp.data);
    }

    // Ollama chat / vision / reasoning / code / etc.
    // Pass 1: classify the prompt. Fail-closed: any guard error => block.
    let prompt_verdict = crate::guard::check_prompt(
        &state.http_client,
        &state.ollama_base,
        &state.guard_model,
        &request_json,
    )
    .await
    .unwrap_or(crate::guard::GuardVerdict { safe: false });
    if !prompt_verdict.safe {
        return encrypt_chunks_and_send(
            &mut transport,
            &serde_json::json!({ "text": "", "error": "content_blocked" }),
        );
    }

    let ollama_resp = crate::ollama::chat(
        &state.http_client,
        &state.ollama_base,
        requested_model,
        &request_json,
    )
    .await
    .map_err(|e| (StatusCode::BAD_GATEWAY, format!("ollama: {e}")))?;

    // Pass 2: classify the output.
    let out_verdict = crate::guard::check_output(
        &state.http_client,
        &state.ollama_base,
        &state.guard_model,
        &request_json,
        &ollama_resp.text,
    )
    .await
    .unwrap_or(crate::guard::GuardVerdict { safe: false });
    if !out_verdict.safe {
        return encrypt_chunks_and_send(
            &mut transport,
            &serde_json::json!({ "text": "", "error": "content_blocked" }),
        );
    }

    state.record_job();
    encrypt_chunks_and_send(&mut transport, &serde_json::to_value(&ollama_resp).unwrap())
}

fn bad_req(msg: &str) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, msg.to_string())
}

fn read_u32(body: &[u8], cur: &mut usize) -> Option<u32> {
    let end = cur.checked_add(4)?;
    if end > body.len() {
        return None;
    }
    let v = u32::from_be_bytes([body[*cur], body[*cur + 1], body[*cur + 2], body[*cur + 3]]);
    *cur = end;
    Some(v)
}

fn slice_at<'a>(body: &'a [u8], cur: &mut usize, len: u32) -> Option<&'a [u8]> {
    let len = len as usize;
    let end = cur.checked_add(len)?;
    let s = body.get(*cur..end)?;
    *cur = end;
    Some(s)
}

fn encrypt_chunks_and_send(
    transport: &mut snow::TransportState,
    body: &serde_json::Value,
) -> Result<(StatusCode, HeaderMap, Vec<u8>), (StatusCode, String)> {
    let pt = serde_json::to_vec(body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // Always emit at least one chunk so the receiver can distinguish "well-
    // formed empty body" from "truncated stream".
    let n_chunks = if pt.is_empty() {
        1
    } else {
        (pt.len() + CHUNK_PT - 1) / CHUNK_PT
    };

    let mut out = Vec::with_capacity(4 + pt.len() + n_chunks * (4 + 16));
    out.extend_from_slice(&(n_chunks as u32).to_be_bytes());

    let mut ct_buf = vec![0u8; CHUNK_CT_MAX];
    for i in 0..n_chunks {
        let start = i * CHUNK_PT;
        let end = (start + CHUNK_PT).min(pt.len());
        let slice: &[u8] = if pt.is_empty() { &[] } else { &pt[start..end] };
        let n = transport
            .write_message(slice, &mut ct_buf)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("encrypt chunk {i}: {e}")))?;
        out.extend_from_slice(&(n as u32).to_be_bytes());
        out.extend_from_slice(&ct_buf[..n]);
    }

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/octet-stream".parse().unwrap());
    Ok((StatusCode::OK, headers, out))
}
