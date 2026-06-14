// Hardware archetype detection. Runs once at boot; the result drives:
//   - SLA selection (Macs get a lower bar — decode is fast, prompt-eval slow)
//   - VRAM accounting (multi-GPU sums for shardable LLMs)
//   - Auto-tuned OLLAMA_NUM_PARALLEL
//
// Detection is best-effort. We never fail boot just because nvidia-smi or
// sysctl are missing; we default to SingleGpu (the most conservative,
// non-degrading assumption).

use std::process::Command;
use tracing::{info, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Archetype {
    MacUnified,
    SingleGpu,
    MultiGpu,
    Cpu,
}

impl Archetype {
    pub fn as_str(self) -> &'static str {
        match self {
            Archetype::MacUnified => "mac_unified",
            Archetype::SingleGpu => "single_gpu",
            Archetype::MultiGpu => "multi_gpu",
            Archetype::Cpu => "cpu",
        }
    }
}

#[derive(Debug, Clone)]
pub struct HardwareProfile {
    pub archetype: Archetype,
    pub gpu_count: u32,
    /// Sum of VRAM across all visible GPUs, in MB. On Mac unified, this is
    /// 75% of physical RAM (rough budget for ML workloads alongside the OS).
    pub gpu_total_vram_mb: u32,
    /// Largest single contiguous VRAM region in MB (largest GPU on multi-GPU
    /// hosts; same as total on single GPU and Mac unified).
    pub gpu_single_vram_mb: u32,
}

pub fn detect() -> HardwareProfile {
    if cfg!(target_os = "macos") {
        if let Some(profile) = detect_mac() {
            info!(
                archetype = profile.archetype.as_str(),
                total_vram_mb = profile.gpu_total_vram_mb,
                "detected Mac unified memory archetype"
            );
            return profile;
        }
    }
    if let Some(profile) = detect_nvidia() {
        info!(
            archetype = profile.archetype.as_str(),
            gpu_count = profile.gpu_count,
            total_vram_mb = profile.gpu_total_vram_mb,
            single_vram_mb = profile.gpu_single_vram_mb,
            "detected NVIDIA archetype"
        );
        return profile;
    }
    warn!("no GPU detected — falling back to CPU archetype");
    HardwareProfile {
        archetype: Archetype::Cpu,
        gpu_count: 0,
        gpu_total_vram_mb: 0,
        gpu_single_vram_mb: 0,
    }
}

fn detect_mac() -> Option<HardwareProfile> {
    let out = Command::new("sysctl").args(["-n", "hw.memsize"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let bytes: u64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    let mb = (bytes / 1024 / 1024) as u32;
    // Reserve ~25% for OS+other apps. The remainder is realistically usable
    // by Metal for inference (Ollama tunes this further at runtime).
    let usable_mb = (mb as u64 * 3 / 4) as u32;
    Some(HardwareProfile {
        archetype: Archetype::MacUnified,
        gpu_count: 1,
        gpu_total_vram_mb: usable_mb,
        gpu_single_vram_mb: usable_mb,
    })
}

fn detect_nvidia() -> Option<HardwareProfile> {
    let out = Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let sizes: Vec<u32> = text
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .collect();
    if sizes.is_empty() {
        return None;
    }
    let gpu_count = sizes.len() as u32;
    let total: u32 = sizes.iter().sum();
    let largest = *sizes.iter().max().unwrap_or(&0);
    let archetype = if gpu_count >= 2 {
        Archetype::MultiGpu
    } else {
        Archetype::SingleGpu
    };
    Some(HardwareProfile {
        archetype,
        gpu_count,
        gpu_total_vram_mb: total,
        gpu_single_vram_mb: largest,
    })
}

/// Recommended `OLLAMA_NUM_PARALLEL` for an archetype. Set as env var at
/// process start unless the operator already exported one.
pub fn recommended_num_parallel(profile: &HardwareProfile) -> u32 {
    match profile.archetype {
        Archetype::MacUnified => 1, // RAM contention; Apple Silicon hates parallel decodes
        Archetype::SingleGpu => 2,
        Archetype::MultiGpu => profile.gpu_count.max(2),
        Archetype::Cpu => 1,
    }
}
