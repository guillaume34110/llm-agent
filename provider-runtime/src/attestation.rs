// Attestation manifest. Surface that lets the matchmaker (and curious peers)
// confirm what this provider is actually running.
//
// Online providers serve multiple models concurrently, so we report a list:
//   - models[]: { modelId, modelDigest }
//   - guardModel + guardDigest
//   - staticPubKey (Noise XK responder identity, base64)
//   - version (provider runtime crate version, baked at build time)
//
// The manifest is returned in plaintext. Signing is handled by the binary
// sidecar (`<exe>.sig`) verified by the server.

use axum::{extract::State, Json};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

use crate::state::AppState;

#[derive(Serialize)]
pub struct ModelEntry {
    #[serde(rename = "modelId")]
    pub model_id: String,
    #[serde(rename = "modelDigest")]
    pub model_digest: Option<String>,
}

#[derive(Serialize)]
pub struct Manifest {
    pub version: &'static str,
    pub models: Vec<ModelEntry>,
    #[serde(rename = "guardModel")]
    pub guard_model: String,
    #[serde(rename = "guardDigest")]
    pub guard_digest: Option<String>,
    #[serde(rename = "staticPubKey")]
    pub static_pub_key: String,
}

pub async fn manifest(State(state): State<Arc<AppState>>) -> Json<Manifest> {
    let mut models = Vec::new();
    for m in state.models() {
        let digest = match crate::weight_hash::compute_weight_digest(&m).await {
            Some(d) => Some(d),
            None => ollama_digest(&state.ollama_base, &m).await,
        };
        models.push(ModelEntry {
            model_id: m,
            model_digest: digest,
        });
    }
    let guard_digest = match crate::weight_hash::compute_weight_digest(&state.guard_model).await {
        Some(d) => Some(d),
        None => ollama_digest(&state.ollama_base, &state.guard_model).await,
    };
    Json(Manifest {
        version: env!("CARGO_PKG_VERSION"),
        models,
        guard_model: state.guard_model.clone(),
        guard_digest,
        static_pub_key: B64.encode(&state.static_pub),
    })
}

async fn ollama_digest(base: &str, model: &str) -> Option<String> {
    let url = format!("{}/api/show", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: Value = resp.json().await.ok()?;
    body.get("digest")
        .or_else(|| body.get("details").and_then(|d| d.get("digest")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
