// Thin Ollama-native client. We use `/api/chat` (not the OpenAI-compat
// endpoint) because the native shape exposes per-request timings —
// `prompt_eval_duration` and `eval_duration` in nanoseconds — that we need
// to report decode tok/s and prompt-eval tok/s back to the matchmaker.
//
// The provider runtime owns this connection; the client on the other side
// of the Noise tunnel never reaches Ollama directly.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
struct NativeMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Value>,
}

#[derive(Deserialize)]
struct NativeResponse {
    message: Option<NativeMessage>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
}

#[derive(Serialize)]
pub struct FlatResponse {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Value>,
    /// OpenAI-shaped { prompt_tokens, completion_tokens } for client parity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
}

pub async fn chat(
    client: &reqwest::Client,
    base: &str,
    model: &str,
    request: &Value,
) -> anyhow::Result<FlatResponse> {
    let messages = request
        .get("messages")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let tools = request.get("tools").cloned();
    let temperature = request
        .get("temperature")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });
    if let Some(t) = tools {
        body["tools"] = t;
    }
    if let Some(temp) = temperature {
        body["options"] = serde_json::json!({ "temperature": temp });
    }

    let url = format!("{}/api/chat", base.trim_end_matches('/'));
    let resp = client.post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        anyhow::bail!("ollama HTTP {}: {}", s, t.chars().take(200).collect::<String>());
    }
    let raw: NativeResponse = resp.json().await?;
    let mut text = String::new();
    let mut tool_calls = None;
    if let Some(m) = raw.message {
        text = m.content.unwrap_or_default();
        tool_calls = m.tool_calls;
    }
    let tokens_in = raw.prompt_eval_count.unwrap_or(0);
    let tokens_out = raw.eval_count.unwrap_or(0);
    let usage = Some(serde_json::json!({
        "prompt_tokens": tokens_in,
        "completion_tokens": tokens_out,
        "total_tokens": tokens_in + tokens_out,
    }));
    Ok(FlatResponse {
        text,
        tool_calls,
        usage,
    })
}
