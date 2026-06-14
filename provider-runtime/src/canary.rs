// Canary endpoint. The matchmaker periodically pings this with a known prompt;
// we run it through the local Ollama at temperature=0 and return the response.
// The server compares against the expected output to detect a provider that's
// running a different model than it claims (or skipping inference entirely).
//
// Auth: server must include X-Canary-Token = hex(HMAC-SHA256(canary_secret, prompt)).
// This prevents the provider from distinguishing canary from real user traffic
// by watching plain HTTP headers — the token binds to the prompt content and
// is only valid for the holder of the shared secret.

use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
pub struct CanaryReq {
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Serialize)]
pub struct CanaryResp {
    pub model: String,
    pub response: String,
}

pub async fn canary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CanaryReq>,
) -> Result<Json<CanaryResp>, (StatusCode, String)> {
    // Validate HMAC-SHA256 token — constant-time via hmac::Mac::verify_slice.
    let token_header = headers
        .get("x-canary-token")
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "missing X-Canary-Token".to_string()))?
        .to_str()
        .map_err(|_| (StatusCode::BAD_REQUEST, "bad X-Canary-Token header".to_string()))?;

    let token_bytes = hex::decode(token_header)
        .map_err(|_| (StatusCode::BAD_REQUEST, "X-Canary-Token must be hex".to_string()))?;

    let mut mac = HmacSha256::new_from_slice(state.canary_secret.as_bytes())
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "hmac init failed".to_string()))?;
    mac.update(req.prompt.as_bytes());
    mac.verify_slice(&token_bytes)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid canary token".to_string()))?;

    let model = match req.model.as_deref() {
        Some(m) if state.is_serving(m) => m.to_string(),
        Some(m) => {
            return Err((
                StatusCode::FORBIDDEN,
                format!("model {m} not in active set"),
            ));
        }
        None => state
            .primary_model()
            .ok_or((StatusCode::SERVICE_UNAVAILABLE, "no active model".into()))?,
    };
    let request_json = serde_json::json!({
        "messages": [{ "role": "user", "content": req.prompt }],
        "temperature": 0.0,
    });
    let resp = crate::ollama::chat(&state.http_client, &state.ollama_base, &model, &request_json)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("ollama: {e}")))?;
    Ok(Json(CanaryResp {
        model,
        response: resp.text,
    }))
}
