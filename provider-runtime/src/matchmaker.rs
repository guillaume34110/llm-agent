// Announces this provider's presence to the Progsoft server on a 60 s cadence.
//
// Friend-graph P2P (Spec A): the server stores ONLY routing meta —
// {modelId, networkAddr, noisePubkey, modelDigest?, weightDigest?}. Never a
// prompt, never a token, never who routed what to whom. Server-side ACL
// (mutual Friendship + opt-in ProviderAcl) decides who sees this row.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct PresenceArgs {
    pub endpoint: String,
    pub server: String,
    pub jwt: String,
}

#[derive(Serialize)]
struct AnnouncePayload<'a> {
    #[serde(rename = "deviceId")]
    device_id: &'a str,
    #[serde(rename = "modelId")]
    model_id: &'a str,
    /// Task category derived from the model id. Lets the matchmaker filter
    /// "any provider serving OCR" via `/presence/friends?task=ocr` without
    /// joining ModelMeta. Source of truth = `crate::tasks::task_for_model`,
    /// mirrored from the server WHITELIST.
    task: &'a str,
    #[serde(rename = "networkAddr")]
    network_addr: &'a str,
    #[serde(rename = "noisePubkey")]
    noise_pubkey: String,
    #[serde(rename = "modelDigest", skip_serializing_if = "Option::is_none")]
    model_digest: Option<String>,
    #[serde(rename = "weightDigest", skip_serializing_if = "Option::is_none")]
    weight_digest: Option<String>,
}

pub async fn announce_loop(state: Arc<AppState>, args: PresenceArgs) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!(error=%e, "could not build presence http client");
            return;
        }
    };
    let url = format!(
        "{}/api/presence/announce",
        args.server.trim_end_matches('/')
    );
    let pub_b64 = B64.encode(&state.static_pub);
    // Cache resolved digests so we don't re-hash multi-GB blobs every tick.
    let mut model_digests: HashMap<String, String> = HashMap::new();
    let mut weight_digests: HashMap<String, String> = HashMap::new();

    const IDLE_WITHDRAW_SECS: u64 = 30 * 60;
    loop {
        // Skip announce when idle — no jobs in the last 30 min means we've
        // already served any queued work. Withdraws presence without an
        // explicit /leave endpoint, since the server TTL-expires presence rows.
        let idle = state.idle_secs();
        if idle > 0 && idle > IDLE_WITHDRAW_SECS {
            tokio::time::sleep(Duration::from_secs(60)).await;
            continue;
        }
        let models = state.models();
        for model in &models {
            if !weight_digests.contains_key(model) {
                if let Some(d) = crate::weight_hash::compute_weight_digest(model).await {
                    weight_digests.insert(model.clone(), d);
                }
            }
            // Do not announce until tamper-resistance check passes — prevents
            // routing a provider whose weight file hasn't been verified yet.
            let Some(weight_digest) = weight_digests.get(model).cloned() else {
                warn!(model=%model, "weight digest not yet ready, skipping announce");
                continue;
            };
            if !model_digests.contains_key(model) {
                if let Some(d) = fetch_model_digest(&state.ollama_base, model).await {
                    model_digests.insert(model.clone(), d);
                }
            }
            let payload = AnnouncePayload {
                device_id: &state.device_id,
                model_id: model,
                task: crate::tasks::task_for_model(model),
                network_addr: &args.endpoint,
                noise_pubkey: pub_b64.clone(),
                model_digest: model_digests.get(model).cloned(),
                weight_digest: Some(weight_digest),
            };
            match client
                .post(&url)
                .bearer_auth(&args.jwt)
                .json(&payload)
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => {
                    info!(model=%model, "presence announced");
                }
                Ok(r) => warn!(status=%r.status(), model=%model, "server rejected presence"),
                Err(e) => warn!(error=%e, model=%model, "presence announce failed"),
            }
        }
        // Drop cached digests for models we no longer serve, so a removed-then-
        // re-added model gets re-hashed (catches a weight swap during downtime).
        model_digests.retain(|k, _| models.iter().any(|m| m == k));
        weight_digests.retain(|k, _| models.iter().any(|m| m == k));
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

async fn fetch_model_digest(base: &str, model: &str) -> Option<String> {
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
    let body: serde_json::Value = resp.json().await.ok()?;
    body.get("digest")
        .or_else(|| body.get("details").and_then(|d| d.get("digest")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
