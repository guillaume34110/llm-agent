// Maps a whitelisted model id to its task category.
//
// Source of truth lives in the server WHITELIST (src/models/models.service.ts).
// Kept in sync by hand — the runtime is tiny, only serves a single model at
// a time, so a static `match` is simpler than an HTTP catalogue fetch at
// startup (and survives a degraded server).
//
// Sidecar tasks (ocr/sentiment/image_classify) are dispatched to the local
// Python sidecar; all others go to Ollama via `crate::ollama::chat`.

pub fn task_for_model(model: &str) -> &'static str {
    match model {
        // Sidecar (Python adapter) — must match monkey/local_models/catalog.py
        "tesseract" | "paddle-ocr-v4" => "ocr",
        "xlm-sentiment" => "sentiment",
        "vit-image-classify" => "image_classify",
        // Specialty Ollama tasks
        "qwen3guard-stream:0.6b" => "guard",
        "bge-m3" => "embed",
        "qwen3-vl-reranker" => "rerank",
        "voxtral:3b" => "asr",
        "qwen-image" => "image-gen",
        // Vision-capable chat
        "qwen3-vl:4b"
        | "qwen3-vl:8b"
        | "qwen3-vl:32b"
        | "mistral-small-3.1:24b"
        | "phi-4-multimodal:5.6b" => "vision",
        // Reasoning
        "magistral:24b" | "phi-4-reasoning-vision:15b" => "reasoning",
        // Code
        "devstral:24b" => "code",
        // Everything else is plain chat — covers the long tail of qwen3/phi/
        // mistral chat models and any future addition that goes through Ollama.
        _ => "chat",
    }
}

pub fn is_sidecar_task(task: &str) -> bool {
    matches!(task, "ocr" | "sentiment" | "image_classify")
}
