// Throughput benchmark + downgrade chain resolver.
//
// SLA (2026-05-19): 30 tok/s baseline, 20 tok/s for large flagships, tuned
// per archetype (Mac unified gets a lower bar — decode is fast but prompt
// eval is structurally slow). Server catalog (/api/models) is the source of
// truth — we read `minThroughput`, `slaPerArchetype`, `throughputUnit`,
// `downgradeTo` from there and follow the chain until a model passes.
//
// Two probes per resolve, via Ollama's native `/api/generate` so we get
// prompt-eval and decode timings separately. A warm-up run is discarded so
// cold-load doesn't poison the measurement.
//   - decode probe: short prompt, generate 128 tokens. Measures sustained
//     decode tok/s (the number users feel during streaming).
//   - prompt-eval probe: ~2048-tok prompt, generate 32 tokens. Measures
//     prompt_eval_tok_per_sec (TTFT proxy — matters most on Macs).

use serde::Deserialize;
use std::time::Duration;
use tracing::{info, warn};

use crate::archetype::Archetype;

const DECODE_PROMPT: &str = "Write the integers 1 to 100 separated by spaces.";
const DECODE_MAX_TOKENS: u32 = 128;
const PROBE_TIMEOUT_SECS: u64 = 180;
/// Padding chunk that approximates ~50 tokens per copy. 40 copies ≈ 2000
/// input tokens, enough to make prompt_eval_duration meaningful.
const PROMPT_EVAL_CHUNK: &str = "The quick brown fox jumps over the lazy dog. \
Sphinx of black quartz, judge my vow. Pack my box with five dozen liquor jugs. ";

#[derive(Debug, Clone, Deserialize)]
pub struct ModelMeta {
    pub id: String,
    #[serde(rename = "minThroughput")]
    pub min_throughput: Option<f64>,
    #[serde(rename = "throughputUnit")]
    pub throughput_unit: Option<String>,
    #[serde(rename = "downgradeTo")]
    pub downgrade_to: Option<String>,
    /// Optional per-archetype SLA overrides:
    /// `{ "mac_unified": 20, "cpu": 5 }`. Falls back to `min_throughput`.
    #[serde(rename = "slaPerArchetype", default)]
    pub sla_per_archetype: Option<std::collections::HashMap<String, f64>>,
}

#[derive(Debug, Deserialize)]
struct CatalogResponse {
    categories: std::collections::HashMap<String, Vec<ModelMeta>>,
}

/// Fetches the full catalog once and returns a flat map id → ModelMeta.
pub async fn fetch_catalog(matchmaker: &str) -> Option<std::collections::HashMap<String, ModelMeta>> {
    let url = format!("{}/api/models", matchmaker.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        warn!(status=%resp.status(), "catalog fetch failed");
        return None;
    }
    let body: CatalogResponse = resp.json().await.ok()?;
    let mut out = std::collections::HashMap::new();
    for (_cat, models) in body.categories {
        for m in models {
            out.insert(m.id.clone(), m);
        }
    }
    Some(out)
}

#[derive(Deserialize, Default)]
struct GenerateBody {
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    prompt_eval_duration: Option<u64>, // nanoseconds
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    eval_duration: Option<u64>, // nanoseconds
}

#[derive(Debug, Clone, Copy)]
pub struct ProbeStats {
    pub decode_tok_per_sec: f64,
    pub prompt_eval_tok_per_sec: f64,
}

async fn ollama_generate(
    client: &reqwest::Client,
    ollama: &str,
    model: &str,
    prompt: &str,
    max_tokens: u32,
) -> Option<GenerateBody> {
    let url = format!("{}/api/generate", ollama.trim_end_matches('/'));
    let payload = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "num_predict": max_tokens },
    });
    let resp = client.post(&url).json(&payload).send().await.ok()?;
    if !resp.status().is_success() {
        warn!(status=%resp.status(), model=%model, "ollama generate failed");
        return None;
    }
    resp.json().await.ok()
}

/// Runs a discarded warm-up then two probes. Returns None on transport
/// failure or implausibly short output.
pub async fn measure_probe(ollama: &str, model: &str) -> Option<ProbeStats> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
        .ok()?;

    // Warm-up: load weights, fill caches. Result discarded.
    let _ = ollama_generate(&client, ollama, model, "Hello.", 8).await;

    // Decode probe — short prompt, generate 128 tokens.
    let decode = ollama_generate(&client, ollama, model, DECODE_PROMPT, DECODE_MAX_TOKENS).await?;
    let eval_count = decode.eval_count.unwrap_or(0);
    let eval_ns = decode.eval_duration.unwrap_or(0);
    if eval_count < 16 || eval_ns == 0 {
        warn!(model=%model, eval_count, "decode probe too short or missing timing");
        return None;
    }
    let decode_tps = eval_count as f64 / (eval_ns as f64 / 1e9);

    // Prompt-eval probe — ~2k input tokens, generate 32 tokens.
    let long_prompt: String = PROMPT_EVAL_CHUNK.repeat(40);
    let pe = ollama_generate(&client, ollama, model, &long_prompt, 32).await?;
    let pe_count = pe.prompt_eval_count.unwrap_or(0);
    let pe_ns = pe.prompt_eval_duration.unwrap_or(0);
    let prompt_eval_tps = if pe_count >= 200 && pe_ns > 0 {
        pe_count as f64 / (pe_ns as f64 / 1e9)
    } else {
        // Fallback: not all Ollama backends populate these fields cleanly.
        // Use decode tps as a conservative proxy.
        warn!(model=%model, pe_count, "prompt_eval timing missing; using decode as fallback");
        decode_tps
    };

    info!(
        model=%model,
        decode_tps,
        prompt_eval_tps,
        eval_count,
        "benchmark complete"
    );
    Some(ProbeStats { decode_tok_per_sec: decode_tps, prompt_eval_tok_per_sec: prompt_eval_tps })
}

/// Effective SLA for a model on this archetype: per-archetype override
/// when present, else the generic `min_throughput`, else 30.
pub fn effective_sla(meta: &ModelMeta, arch: Archetype) -> f64 {
    if let Some(map) = &meta.sla_per_archetype {
        if let Some(v) = map.get(arch.as_str()) {
            return *v;
        }
    }
    meta.min_throughput.unwrap_or(30.0)
}

/// Walks the downgrade chain starting from `start_model`. Returns the first
/// model whose decode throughput meets the per-archetype SLA. Returns None
/// if the chain is exhausted on this hardware.
pub async fn resolve_runnable_model(
    matchmaker: &str,
    ollama: &str,
    start_model: &str,
    arch: Archetype,
) -> Option<(String, ProbeStats)> {
    let catalog = fetch_catalog(matchmaker).await?;
    let mut current = start_model.to_string();
    loop {
        let meta = match catalog.get(&current) {
            Some(m) => m.clone(),
            None => {
                warn!(model=%current, "model not in catalog; refusing");
                return None;
            }
        };
        let unit = meta.throughput_unit.as_deref().unwrap_or("tokPerSec");
        if unit != "tokPerSec" {
            info!(model=%current, %unit, "non-tokPerSec model — bench skipped");
            return Some((current, ProbeStats { decode_tok_per_sec: 0.0, prompt_eval_tok_per_sec: 0.0 }));
        }
        let min = effective_sla(&meta, arch);
        match measure_probe(ollama, &current).await {
            Some(p) if p.decode_tok_per_sec >= min => {
                info!(model=%current, decode=p.decode_tok_per_sec, min, "passes SLA");
                return Some((current, p));
            }
            Some(p) => {
                warn!(model=%current, decode=p.decode_tok_per_sec, min, "below SLA — trying downgrade");
                match meta.downgrade_to {
                    Some(next) => current = next,
                    None => {
                        warn!(model=%current, "no downgrade target; chain exhausted");
                        return None;
                    }
                }
            }
            None => {
                warn!(model=%current, "benchmark failed — trying downgrade");
                match meta.downgrade_to {
                    Some(next) => current = next,
                    None => return None,
                }
            }
        }
    }
}
