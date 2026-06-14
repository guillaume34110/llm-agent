// Content safety classifier. Runs against the local Ollama with an
// open-weight guard model (default: `qwen3guard-stream:0.6b`). Two passes
// per request:
//
//   1. Prompt pass — last user message (+ system if any) classified before
//      we touch the real model. Blocked prompts never reach Ollama.
//   2. Output pass — model response classified before we hand it back to the
//      client over the Noise tunnel. Blocked outputs are dropped.
//
// Anti-bypass: we return a single opaque error string ("content_blocked"). We
// never tell the client which category fired or which pass blocked — that
// would let an attacker iterate against the classifier.

use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct RawChoice {
    message: Option<RawMessage>,
}
#[derive(Deserialize)]
struct RawMessage {
    content: Option<String>,
}
#[derive(Deserialize)]
struct RawResponse {
    choices: Option<Vec<RawChoice>>,
}

pub struct GuardVerdict {
    pub safe: bool,
}

pub async fn classify(
    client: &reqwest::Client,
    base: &str,
    guard_model: &str,
    messages: &serde_json::Value,
) -> anyhow::Result<GuardVerdict> {
    let body = json!({
        "model": guard_model,
        "messages": messages,
        "stream": false,
        "temperature": 0.0,
    });
    let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));
    let resp = client.post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        anyhow::bail!("guard HTTP {}: {}", s, t.chars().take(200).collect::<String>());
    }
    let raw: RawResponse = resp.json().await?;
    let verdict_text = raw
        .choices
        .and_then(|mut cs| cs.drain(..).next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    // Llama-Guard returns either "safe" or "unsafe\nS<n>". Anything we don't
    // recognise as explicitly "safe" is treated as unsafe (fail-closed).
    let safe = verdict_text == "safe" || verdict_text.starts_with("safe\n");
    Ok(GuardVerdict { safe })
}

/// Boot preflight: verify the guard model is pulled in Ollama. Without it,
/// every classify() errors and fail-closed blocks 100% of traffic — we would
/// announce a provider that can only answer "content_blocked" (black hole).
pub async fn model_available(base: &str, guard_model: &str) -> bool {
    let url = format!("{}/api/show", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    match client
        .post(&url)
        .json(&json!({ "name": guard_model }))
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

pub async fn check_prompt(
    client: &reqwest::Client,
    base: &str,
    guard_model: &str,
    request: &serde_json::Value,
) -> anyhow::Result<GuardVerdict> {
    let messages = request
        .get("messages")
        .cloned()
        .unwrap_or_else(|| json!([]));
    classify(client, base, guard_model, &messages).await
}

pub async fn check_output(
    client: &reqwest::Client,
    base: &str,
    guard_model: &str,
    request: &serde_json::Value,
    output_text: &str,
) -> anyhow::Result<GuardVerdict> {
    let mut messages = request
        .get("messages")
        .cloned()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    messages.push(json!({ "role": "assistant", "content": output_text }));
    classify(client, base, guard_model, &serde_json::Value::Array(messages)).await
}
