// HTTP client to the local Python sidecar for non-LLM tasks.
//
// The sidecar exposes /p2p/<task> endpoints (ocr | sentiment | image_classify)
// that wrap the loaded ONNX / system adapters. The provider runtime never
// loads these models in-process — it only proxies the decrypted payload to
// the sidecar and tunnels the JSON response back over Noise.

use serde_json::Value;

pub struct SidecarResponse {
    /// Guardable plain-text portion of the response (OCR text). Empty for
    /// label-only tasks (sentiment, image_classify) since their output is
    /// a bounded label space — no free-form content to classify.
    pub guardable_text: String,
    /// Raw JSON body returned by the sidecar — passed verbatim to the
    /// client over the Noise tunnel.
    pub data: Value,
}

pub async fn dispatch(
    client: &reqwest::Client,
    sidecar_base: &str,
    task: &str,
    request: &Value,
) -> anyhow::Result<SidecarResponse> {
    let path = match task {
        "ocr" => "/p2p/ocr",
        "sentiment" => "/p2p/sentiment",
        "image_classify" => "/p2p/image_classify",
        other => anyhow::bail!("unsupported sidecar task: {}", other),
    };
    let url = format!("{}{}", sidecar_base.trim_end_matches('/'), path);
    let resp = client.post(&url).json(request).send().await?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        anyhow::bail!(
            "sidecar HTTP {}: {}",
            s,
            t.chars().take(200).collect::<String>()
        );
    }
    let data: Value = resp.json().await?;
    let guardable_text = match task {
        "ocr" => data
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    };
    Ok(SidecarResponse {
        guardable_text,
        data,
    })
}
