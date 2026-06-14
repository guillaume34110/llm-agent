// Process-wide state: static Noise keypair, in-flight handshake sessions,
// active model set, ollama base URL.
//
// `active_models` holds the single model picked at boot from --model (after
// SLA benchmark + downgrade chain resolution).

use crate::Args;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use dashmap::DashMap;
use snow::{params::NoiseParams, Builder, HandshakeState};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Mutex, RwLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

pub const NOISE_PARAMS: &str = "Noise_XK_25519_ChaChaPoly_BLAKE2s";

pub struct AppState {
    pub static_priv: Vec<u8>,
    pub static_pub: Vec<u8>,
    /// Stable per-install identifier. Persisted alongside the static key so it
    /// survives restarts. Lets the server keep this device's ProviderRegistration
    /// row distinct from other installs of the same user account.
    pub device_id: String,
    pub active_models: RwLock<Vec<String>>,
    pub ollama_base: String,
    pub sidecar_base: String,
    pub guard_model: String,
    pub sessions: DashMap<String, Session>,
    pub http_client: reqwest::Client,
    pub noise_params: NoiseParams,
    /// Unix-seconds timestamp of last completed exchange. 0 = never served.
    pub last_job_ts: AtomicI64,
    /// Shared secret used to authenticate server-issued canary requests.
    pub canary_secret: String,
}

/// In-flight Noise handshake. `created_at` is used for TTL-based cleanup.
pub struct Session(pub Mutex<Option<HandshakeState>>, pub std::time::Instant);

impl AppState {
    pub async fn load(args: &Args) -> anyhow::Result<Self> {
        let (priv_k, pub_k) = load_or_create_keys()?;
        info!(static_pub_b64=%B64.encode(&pub_k), "loaded provider static key");
        let device_id = load_or_create_device_id()?;
        info!(device_id=%device_id, "loaded provider device id");
        let m = args
            .model
            .clone()
            .ok_or_else(|| anyhow::anyhow!("--model is required"))?;
        Ok(Self {
            static_priv: priv_k,
            static_pub: pub_k,
            device_id,
            active_models: RwLock::new(vec![m]),
            ollama_base: args.ollama.clone(),
            sidecar_base: args.sidecar.clone(),
            guard_model: args.guard_model.clone(),
            sessions: DashMap::new(),
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .pool_idle_timeout(Duration::from_secs(90))
                .build()?,
            noise_params: NOISE_PARAMS.parse()?,
            last_job_ts: AtomicI64::new(0),
            canary_secret: args.canary_secret.clone().unwrap_or_default(),
        })
    }

    pub fn models(&self) -> Vec<String> {
        self.active_models.read().unwrap().clone()
    }

    pub fn primary_model(&self) -> Option<String> {
        self.active_models.read().unwrap().first().cloned()
    }

    pub fn is_serving(&self, model: &str) -> bool {
        self.active_models
            .read()
            .unwrap()
            .iter()
            .any(|m| m == model)
    }

    pub fn record_job(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.last_job_ts.store(now, Ordering::Relaxed);
    }

    /// Seconds since last completed job. Returns 0 if no job ever served.
    pub fn idle_secs(&self) -> u64 {
        let ts = self.last_job_ts.load(Ordering::Relaxed);
        if ts == 0 {
            return 0;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        (now - ts).max(0) as u64
    }
}

fn keys_path() -> anyhow::Result<PathBuf> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("no local data dir on this platform"))?;
    let dir = base.join("progsoft-provider-runtime");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("static_key.bin"))
}

fn load_or_create_keys() -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
    let path = keys_path()?;
    if path.exists() {
        let bytes = std::fs::read(&path)?;
        if bytes.len() == 64 {
            return Ok((bytes[..32].to_vec(), bytes[32..].to_vec()));
        }
        warn!("static key file has unexpected length, regenerating");
    }
    let builder = Builder::new(NOISE_PARAMS.parse()?);
    let kp = builder.generate_keypair()?;
    let mut buf = Vec::with_capacity(64);
    buf.extend_from_slice(&kp.private);
    buf.extend_from_slice(&kp.public);
    std::fs::write(&path, &buf)?;
    Ok((kp.private, kp.public))
}

fn device_id_path() -> anyhow::Result<PathBuf> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("no local data dir on this platform"))?;
    let dir = base.join("progsoft-provider-runtime");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("device-id"))
}

fn load_or_create_device_id() -> anyhow::Result<String> {
    let path = device_id_path()?;
    if path.exists() {
        let raw = std::fs::read_to_string(&path)?;
        let id = raw.trim().to_string();
        if id.len() >= 8
            && id.len() <= 128
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Ok(id);
        }
        warn!("device-id file malformed, regenerating");
    }
    let id = new_device_id();
    std::fs::write(&path, &id)?;
    Ok(id)
}

fn new_device_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
