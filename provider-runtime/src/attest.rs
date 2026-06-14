// Self-attestation at boot. We compute sha256 of our own executable and post
// it to the matchmaker's /api/attestation/attest. The release signature comes
// from a sidecar file `<exe>.sig` (base64) that Progsoft's signing pipeline
// drops next to the binary at release time. In dev builds the sidecar is
// missing and the signature is empty — the server accepts that only when no
// release pubkey is pinned (PROGSOFT_RUNTIME_PUBKEY_PEM unset).
//
// We use a sidecar (not an embedded const) because embedding the sig in the
// binary changes the binary, which would invalidate the very signature we
// just embedded.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tracing::{info, warn};

#[derive(Serialize)]
struct AttestPayload<'a> {
    #[serde(rename = "modelId")]
    model_id: &'a str,
    #[serde(rename = "deviceId")]
    device_id: &'a str,
    #[serde(rename = "runtimeHash")]
    runtime_hash: String,
    #[serde(rename = "runtimeSig")]
    runtime_sig: String,
}

pub async fn attest_on_boot(matchmaker_base: &str, jwt: &str, model_id: &str, device_id: &str) {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            warn!(error=%e, "could not resolve exe path; skipping attest");
            return;
        }
    };
    let hash = match runtime_hash(&exe) {
        Ok(h) => h,
        Err(e) => {
            warn!(error=%e, "could not hash own executable; skipping attest");
            return;
        }
    };
    let sig = load_sig(&exe);
    if sig.is_empty() {
        warn!("no release signature sidecar — dev mode; matchmaker will reject if pubkey pinned");
    }

    let url = format!(
        "{}/api/attestation/attest",
        matchmaker_base.trim_end_matches('/')
    );
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!(error=%e, "could not build attest client");
            return;
        }
    };
    let payload = AttestPayload {
        model_id,
        device_id,
        runtime_hash: hash,
        runtime_sig: sig,
    };
    match client.post(&url).bearer_auth(jwt).json(&payload).send().await {
        Ok(r) if r.status().is_success() => {
            info!("attested to matchmaker");
        }
        Ok(r) => {
            warn!(status=%r.status(), "attest rejected (clients will refuse this provider)");
        }
        Err(e) => {
            warn!(error=%e, "attest failed");
        }
    }
}

fn runtime_hash(exe: &std::path::Path) -> anyhow::Result<String> {
    let bytes = std::fs::read(exe)?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(hex::encode(h.finalize()))
}

fn load_sig(exe: &std::path::Path) -> String {
    let sig_path = exe.with_extension("sig");
    match std::fs::read_to_string(&sig_path) {
        Ok(s) => s.trim().to_string(),
        Err(_) => String::new(),
    }
}
