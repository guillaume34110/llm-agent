// Computes the sha256 of the actual on-disk Ollama model blob, instead of
// trusting whatever `/api/show` returns. A tampered Ollama could lie about
// `digest` in its API responses; it cannot lie about the bytes the kernel
// hands us when we read `~/.ollama/models/blobs/sha256-<hex>`.
//
// Path resolution:
//   1. Read `<OLLAMA_MODELS>/manifests/registry.ollama.ai/library/<name>/<tag>`
//      (a tiny JSON file listing layers + digests).
//   2. Pick the layer with mediaType `application/vnd.ollama.image.model`.
//   3. Stream-hash `<OLLAMA_MODELS>/blobs/sha256-<digest>` (multi-GB files —
//      never load the whole thing in memory).
//   4. Compare to the digest claimed by the manifest. Mismatch ⇒ refuse to
//      announce a digest (caller treats this as "unknown weights").

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::PathBuf;
use tokio::task;
use tracing::warn;

#[derive(Deserialize)]
struct Manifest {
    layers: Vec<Layer>,
}

#[derive(Deserialize)]
struct Layer {
    #[serde(rename = "mediaType")]
    media_type: String,
    digest: String,
}

pub async fn compute_weight_digest(model: &str) -> Option<String> {
    let model = model.to_string();
    task::spawn_blocking(move || compute_blocking(&model))
        .await
        .ok()
        .flatten()
}

fn compute_blocking(model: &str) -> Option<String> {
    let root = ollama_root()?;
    let (name, tag) = parse_model_ref(model);
    let manifest_path = root
        .join("manifests/registry.ollama.ai/library")
        .join(&name)
        .join(&tag);
    let manifest_bytes = match std::fs::read(&manifest_path) {
        Ok(b) => b,
        Err(e) => {
            warn!(path=%manifest_path.display(), error=%e, "ollama manifest not found");
            return None;
        }
    };
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).ok()?;
    let layer = manifest
        .layers
        .iter()
        .find(|l| l.media_type == "application/vnd.ollama.image.model")?;
    let claimed = layer.digest.strip_prefix("sha256:")?.to_string();
    let blob_path = root.join("blobs").join(format!("sha256-{}", claimed));
    let actual = sha256_stream(&blob_path).ok()?;
    if actual != claimed {
        warn!(claimed=%claimed, actual=%actual, "weight blob digest mismatch — refusing to announce");
        return None;
    }
    Some(actual)
}

fn ollama_root() -> Option<PathBuf> {
    if let Ok(s) = std::env::var("OLLAMA_MODELS") {
        return Some(PathBuf::from(s));
    }
    let home = dirs::home_dir()?;
    Some(home.join(".ollama").join("models"))
}

fn parse_model_ref(model: &str) -> (String, String) {
    match model.split_once(':') {
        Some((n, t)) => (n.to_string(), t.to_string()),
        None => (model.to_string(), "latest".to_string()),
    }
}

fn sha256_stream(path: &std::path::Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}
