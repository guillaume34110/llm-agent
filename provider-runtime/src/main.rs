// Progsoft AI provider runtime (Spec A: friend-graph P2P, no monetization).
//
// Operator picks a single model via --model. The runtime:
//   1. Loads (or creates) a persistent Noise XK static keypair on disk.
//   2. Benchmarks the chosen model against the per-archetype SLA and walks
//      the downgrade chain until a runnable one is found.
//   3. Self-attests its own binary hash + sidecar signature.
//   4. Announces presence (modelId, networkAddr, noisePubkey, digests) to the
//      Progsoft server every 60 s. Server only stores routing meta — never
//      prompts, tokens, or who routed what to whom.
//   5. Serves Noise XK handshake + exchange endpoints (one tunnel per call,
//      ephemeral session id in X-P2P-Session).
//   6. Refuses any model other than the active one.

mod archetype;
mod attest;
mod attestation;
mod benchmark;
mod canary;
mod guard;
mod matchmaker;
mod noise_responder;
mod ollama;
mod sidecar;
mod state;
mod tasks;
mod weight_hash;

use axum::{routing::{get, post}, Router};
use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(version, about)]
pub struct Args {
    /// Whitelisted model id this provider will serve.
    #[arg(long, env = "PROGSOFT_MODEL")]
    pub model: Option<String>,

    /// Public endpoint clients reach us at (e.g. https://node-42.progsoft.eu).
    #[arg(long, env = "PROGSOFT_ENDPOINT")]
    pub endpoint: String,

    /// Progsoft server base URL (auth + presence + attestation).
    #[arg(long, env = "PROGSOFT_SERVER", default_value = "http://localhost:3469")]
    pub server: String,

    /// Local Ollama base URL.
    #[arg(long, env = "OLLAMA_BASE_URL", default_value = "http://localhost:11434")]
    pub ollama: String,

    /// Local Python sidecar base URL (OCR/sentiment/image_classify endpoints).
    #[arg(long, env = "MONKEY_SIDECAR_URL", default_value = "http://localhost:3471")]
    pub sidecar: String,

    /// Safety classifier model id (must be pulled in Ollama). Apache-2.0
    /// catalog default = qwen3guard-stream:0.6b.
    #[arg(long, env = "PROGSOFT_GUARD_MODEL", default_value = "qwen3guard-stream:0.6b")]
    pub guard_model: String,

    /// Local bind address for the Noise listener.
    #[arg(long, env = "PROGSOFT_BIND", default_value = "0.0.0.0:4470")]
    pub bind: SocketAddr,

    /// JWT bearer for authenticated server calls (presence + attestation).
    #[arg(long, env = "PROGSOFT_SERVER_JWT")]
    pub server_jwt: String,

    /// Shared secret used to authenticate canary requests from the server.
    /// Defaults to server_jwt when not set. The server must use the same value
    /// when computing the X-Canary-Token HMAC-SHA256 header.
    #[arg(long, env = "PROGSOFT_CANARY_SECRET")]
    pub canary_secret: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let mut args = Args::parse();
    if args.model.is_none() {
        anyhow::bail!("--model is required");
    }

    // Detect hardware archetype once. Drives SLA selection and Ollama
    // concurrency tuning. Best-effort: falls back to SingleGpu.
    let hardware = archetype::detect();
    if std::env::var_os("OLLAMA_NUM_PARALLEL").is_none() {
        let n = archetype::recommended_num_parallel(&hardware);
        // SAFETY: pre-tokio thread setup; no concurrent env access yet.
        std::env::set_var("OLLAMA_NUM_PARALLEL", n.to_string());
        info!(num_parallel = n, "set OLLAMA_NUM_PARALLEL from archetype");
    }

    // Benchmark the chosen model and walk the downgrade chain until we find
    // one that meets the per-archetype SLA. Refuse to announce if the whole
    // chain is below SLA on this hardware.
    let start = args.model.clone().unwrap();
    match benchmark::resolve_runnable_model(
        &args.server,
        &args.ollama,
        &start,
        hardware.archetype,
    )
    .await
    {
        Some((resolved, probe)) => {
            if resolved != start {
                warn!(
                    requested = %start,
                    resolved = %resolved,
                    decode_tps = probe.decode_tok_per_sec,
                    prompt_eval_tps = probe.prompt_eval_tok_per_sec,
                    "model downgraded by SLA benchmark"
                );
            }
            args.model = Some(resolved);
        }
        None => anyhow::bail!(
            "SLA chain exhausted for {} — no model in the downgrade chain meets minThroughput on this hardware",
            start
        ),
    }

    // Preflight: the guard model must be present in Ollama. Without it every
    // guard call errors → fail-closed blocks 100% of traffic and we would
    // announce a black-hole provider. Refuse to boot instead.
    if !guard::model_available(&args.ollama, &args.guard_model).await {
        anyhow::bail!(
            "guard model {} not found in Ollama — run `ollama pull {}` first",
            args.guard_model,
            args.guard_model
        );
    }

    // Resolve canary_secret: explicit arg > env > fall back to server_jwt.
    // The field is Option<String> in Args but state needs a String.
    if args.canary_secret.is_none() {
        args.canary_secret = Some(args.server_jwt.clone());
    }
    let state = Arc::new(state::AppState::load(&args).await?);
    let _ = hardware; // hardware only drives boot-time SLA + Ollama tuning

    let mm = state.clone();
    let mm_args = matchmaker::PresenceArgs {
        endpoint: args.endpoint.clone(),
        server: args.server.clone(),
        jwt: args.server_jwt.clone(),
    };
    tokio::spawn(async move {
        matchmaker::announce_loop(mm, mm_args).await;
    });

    // Fire-and-forget self-attestation per active model.
    let attest_base = args.server.clone();
    let attest_jwt = args.server_jwt.clone();
    let attest_state = state.clone();
    tokio::spawn(async move {
        let device_id = attest_state.device_id.clone();
        for m in attest_state.models() {
            attest::attest_on_boot(&attest_base, &attest_jwt, &m, &device_id).await;
        }
    });

    let app = Router::new()
        .route("/p2p/noise/handshake", post(noise_responder::handshake))
        .route("/p2p/noise/exchange", post(noise_responder::exchange))
        .route("/attestation/manifest", get(attestation::manifest))
        .route("/attestation/canary", post(canary::canary))
        .route("/health", get(|| async { "ok" }))
        .with_state(state);

    info!(endpoint=%args.endpoint, bind=%args.bind, "provider runtime starting");
    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
