"""Curated catalogue of installable on-device models.

Each entry is the source-of-truth for one model. Keep this list short and
high-signal. New entries must come with an adapter under `adapters/`.

Schema:
  id           — stable internal id (kebab-case). Becomes the folder name.
  task         — short task family (ner, embed, rerank, asr, tts, classify,
                 lang, features, ocr). Used to group in UI and for tool naming.
  label        — UI label (FR-friendly).
  description  — one-liner explaining what the model does (UI tooltip).
  repo         — HuggingFace repo id (or "system" for binaries like tesseract).
  files        — list of repo files to download. Empty list = whole repo via
                 snapshot_download (heavier but covers irregular layouts).
  size_mb      — approximate disk footprint after download.
  runtime      — "onnx" | "ct2" | "system".
  adapter      — adapter module under monkey/local_models/adapters/.
  tool_name    — agent tool name exposed when installed.
  tool_desc    — agent tool description (used in SYSTEM_PROMPT hint too).
  license      — short license id for UI display.
  languages    — list of ISO language codes the model is best at.

If a model needs more than one tool, set `extra_tools` to a list of dicts
{name, desc, schema} — the adapter must handle dispatch by tool name.
"""
from __future__ import annotations


CATALOG: list[dict] = [
    {
        "id": "camembert-base",
        "task": "features",
        "label": "CamemBERT (base, FR)",
        "description": "Encoder FR généraliste. Donne des vecteurs 768d pour similarité, clustering, classif baseline FR.",
        "repo": "Xenova/camembert-base",
        "files": [],  # ONNX-converted by Xenova, snapshot_download takes the lot
        "size_mb": 110,
        "runtime": "onnx",
        "adapter": "features",
        "tool_name": "local_camembert_features",
        "tool_desc": "Encode a French text into a 768d mean-pooled vector (CamemBERT base). LOCAL/free/offline — prefer over remote embeddings when the text is French and you only need a feature vector for similarity or clustering.",
        "license": "MIT",
        "languages": ["fr"],
    },
    {
        "id": "camembert-ner-fr",
        "task": "ner",
        "label": "CamemBERT NER (FR)",
        "description": "Extraction d'entités nommées en français (PER/ORG/LOC/MISC).",
        "repo": "Xenova/camembert-ner-with-dates",
        "files": [],
        "size_mb": 110,
        "runtime": "onnx",
        "adapter": "ner",
        "tool_name": "local_ner_fr",
        "tool_desc": "Extract named entities (person/org/location/date) from FRENCH text. LOCAL/free/offline. Returns a JSON list of {entity, label, start, end, score}. Prefer over web search when extracting structured entities from a French document.",
        "license": "MIT",
        "languages": ["fr"],
    },
    {
        "id": "e5-small-multi",
        "task": "embed",
        "label": "Multilingual E5 small",
        "description": "Embeddings multilingues 384d. Bon ratio qualité/taille pour KB local.",
        "repo": "Xenova/multilingual-e5-small",
        "files": [],
        "size_mb": 130,
        "runtime": "onnx",
        "adapter": "embed",
        "tool_name": "local_embed",
        "tool_desc": "Embed a batch of texts into 384d vectors (multilingual-e5-small). LOCAL/free/offline. Returns JSON {dim, vectors}. Use for offline similarity/retrieval; for KB queries the user can also pick this model in Settings.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "bge-reranker-base-multi",
        "task": "rerank",
        "label": "BGE reranker base (multi)",
        "description": "Re-classement de résultats de recherche par cross-encoder. Multi-langues.",
        "repo": "Xenova/bge-reranker-base",
        "files": [],
        "size_mb": 280,
        "runtime": "onnx",
        "adapter": "rerank",
        "tool_name": "local_rerank",
        "tool_desc": "Rerank candidate passages for a query (cross-encoder, multilingual). LOCAL/free/offline. Args: query (str), documents (list[str]). Returns JSON list of {index, score} sorted by score desc. Prefer as a 2nd-stage filter after kb_search or search_web.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "xlm-roberta-lang-id",
        "task": "lang",
        "label": "XLM-Roberta lang ID",
        "description": "Détection de langue (20 langues principales).",
        "repo": "Xenova/xlm-roberta-base-language-detection",
        "files": [],
        "size_mb": 280,
        "runtime": "onnx",
        "adapter": "lang",
        "tool_name": "local_detect_lang",
        "tool_desc": "Detect the language of a text. LOCAL/free/offline. Returns JSON {lang, score, top: [{lang, score}, ...]}. Prefer over any cloud language-detection call.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "distilcamembert-xnli",
        "task": "classify",
        "label": "DistilCamemBERT zero-shot (FR)",
        "description": "Classification zero-shot en français. Donne des labels libres sans fine-tune.",
        "repo": "Xenova/distilcamembert-base-nli",
        "files": [],
        "size_mb": 270,
        "runtime": "onnx",
        "adapter": "zero_shot",
        "tool_name": "local_classify",
        "tool_desc": "Zero-shot text classification in FRENCH against caller-provided labels. LOCAL/free/offline. Args: text (str), labels (list[str]), multi_label (bool, default false). Returns JSON {labels, scores}.",
        "license": "MIT",
        "languages": ["fr"],
    },
    {
        "id": "whisper-base",
        "task": "asr",
        "label": "Whisper base (ASR)",
        "description": "Transcription audio → texte. Multilingue, CPU rapide.",
        "repo": "Systran/faster-whisper-base",
        "files": [],
        "size_mb": 145,
        "runtime": "ct2",
        "adapter": "asr",
        "tool_name": "local_transcribe",
        "tool_desc": "Transcribe an audio file to text (Whisper base, multilingual). LOCAL/free/offline. Args: audio_path (str, absolute), language (str, optional ISO code; auto-detect if omitted). Returns JSON {text, language, duration}.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "piper-tts",
        "task": "tts",
        "label": "Piper TTS (FR + EN)",
        "description": "Synthèse vocale locale. Voix FR (siwis) et EN (amy), qualité medium, ONNX CPU.",
        "repo": "rhasspy/piper-voices",
        "files": [
            "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx",
            "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json",
            "en/en_US/amy/medium/en_US-amy-medium.onnx",
            "en/en_US/amy/medium/en_US-amy-medium.onnx.json",
        ],
        "size_mb": 130,
        "runtime": "onnx",
        "adapter": "tts",
        "tool_name": "local_speak",
        "tool_desc": "Synthesize speech from text and write a WAV file (Piper TTS, FR + EN voices). LOCAL/free/offline. Args: text (str), voice (str, optional 'fr' or 'en'; auto by lang prefix if omitted). Returns JSON {audio_path, voice, bytes, format}. Use to produce audio deliverables; for in-app read-aloud the desktop already uses the system TTS.",
        "license": "MIT",
        "languages": ["fr", "en"],
    },
    {
        "id": "sentence-camembert-fr",
        "task": "embed",
        "label": "Sentence-CamemBERT large (FR)",
        "description": "Embeddings 1024d FR (sentence-trained). Bien plus précis sur retrieval/RAG français qu'un mean-pool de CamemBERT brut.",
        "repo": "Xenova/sentence-camembert-large",
        "files": [],
        "size_mb": 450,
        "runtime": "onnx",
        "adapter": "embed",
        "tool_name": "local_embed_fr",
        "tool_desc": "Embed FRENCH texts into 1024d vectors (sentence-camembert-large). LOCAL/free/offline, sentence-trained (better retrieval than mean-pooled CamemBERT). Args: texts (list[str]). Returns JSON {dim, vectors}. Prefer over local_embed/local_embed_en for FR-only KB.",
        "license": "MIT",
        "languages": ["fr"],
    },
    {
        "id": "minilm-l6-en",
        "task": "embed",
        "label": "MiniLM-L6 (EN, fast)",
        "description": "Embeddings 384d ultra-rapides pour anglais. Plus léger que E5, idéal pour KB EN volumineuse.",
        "repo": "Xenova/all-MiniLM-L6-v2",
        "files": [],
        "size_mb": 90,
        "runtime": "onnx",
        "adapter": "embed",
        "tool_name": "local_embed_en",
        "tool_desc": "Embed ENGLISH texts into 384d vectors (all-MiniLM-L6-v2). LOCAL/free/offline, faster than E5 multilingual. Args: texts (list[str]). Returns JSON {dim, vectors}. Prefer over remote embeddings for EN-only KB.",
        "license": "Apache-2.0",
        "languages": ["en"],
    },
    {
        "id": "xlm-sentiment",
        "task": "sentiment",
        "label": "Multilingual sentiment (BERT)",
        "description": "Multilingual sentiment classifier (NLPTown bert-base-multilingual-uncased-sentiment). Outputs a 1-5 star rating. Trained on product reviews — FR/EN/ES/DE/IT/NL.",
        "repo": "Xenova/bert-base-multilingual-uncased-sentiment",
        "files": [
            "onnx/model_quantized.onnx",
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "vocab.txt",
        ],
        "size_mb": 170,
        "runtime": "onnx",
        "adapter": "sentiment",
        "tool_name": "local_sentiment",
        "tool_desc": "Multilingual sentiment analysis on a text — returns a 1-5 star rating (1=very negative, 5=very positive). LOCAL/free/offline. Args: text (str). Returns JSON {label, score, all: {'1 star', '2 stars', '3 stars', '4 stars', '5 stars'}}. Prefer over remote sentiment APIs.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "clip-vit-base",
        "task": "image_features",
        "label": "CLIP ViT-B/32 (image)",
        "description": "Encodeur d'images CLIP. Donne un vecteur 512d compatible avec l'encodeur texte pour recherche image↔texte.",
        "repo": "Xenova/clip-vit-base-patch32",
        "files": [],
        "size_mb": 350,
        "runtime": "onnx",
        "adapter": "clip_image",
        "tool_name": "local_image_features",
        "tool_desc": "Encode an image file into a 512d CLIP vector. LOCAL/free/offline. Args: image_path (str, absolute). Returns JSON {dim, vector}. Use for image similarity/search, dedup, content-based retrieval.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "vit-image-classify",
        "task": "image_classify",
        "label": "ViT image classifier (ImageNet)",
        "description": "Classification d'image sur 1000 catégories ImageNet. Donne les top-k labels avec scores.",
        "repo": "Xenova/vit-base-patch16-224",
        "files": [],
        "size_mb": 340,
        "runtime": "onnx",
        "adapter": "vit",
        "tool_name": "local_image_classify",
        "tool_desc": "Classify an image into ImageNet labels. LOCAL/free/offline. Args: image_path (str, absolute), top_k (int, default 5). Returns JSON {top: [{label, score}, ...]}. Use to recognize what an image depicts.",
        "license": "Apache-2.0",
        "languages": ["multi"],
    },
    {
        "id": "flux-schnell-gguf",
        "task": "image_gen",
        "label": "FLUX.1-schnell (GGUF, sd.cpp)",
        "description": "Photoreal text-to-image. Cross-platform on-device via stable-diffusion.cpp, GGUF Q4 ~6.3 GB transformer + ~3 GB companion encoders.",
        # The desktop UI is the authoritative downloader for these weights; the
        # Python sidecar only resolves the on-disk files. `repo`/`files` are
        # informational here, not pulled by registry.install().
        "repo": "city96/FLUX.1-schnell-gguf",
        "files": ["flux1-schnell-Q4_0.gguf"],
        # Sum of: transformer Q4 (~6.45 GB) + T5xxl fp8 (~4.55 GB) +
        # CLIP-L (~235 MB) + ae fp32 (~320 MB) ≈ 11.5 GB.
        "size_mb": 11600,
        "runtime": "sdcpp",
        "adapter": "sdcpp",
        "tool_name": "local_image_gen",
        "tool_desc": "Generate a PNG image from a text prompt (FLUX.1-schnell via stable-diffusion.cpp, on-device). LOCAL/free/offline. Args: prompt (str), size (str, default '1024x1024', multiples of 16 up to 1536), seed (int, optional), steps (int, default 4, schnell-distilled). Returns JSON {image_path, bytes, format, prompt, seed, width, height, steps}. Prefer over any remote image API.",
        "license": "Apache-2.0",
        "languages": ["multi"],
        # Cross-process file discovery: the sidecar downloader writes these
        # filenames into the user's app-data models dir. The sdcpp adapter
        # passes them to the sd binary as --diffusion-model / --t5xxl /
        # --clip_l / --vae. Override the parent dir with MONKEY_DESKTOP_MODELS_DIR.
        "desktop_file": "flux1-schnell-Q4_0.gguf",
        "desktop_companions": {
            "t5": "t5xxl_fp8_e4m3fn.safetensors",
            "clip_l": "clip_l.safetensors",
            "vae": "ae.safetensors",
        },
        # Four open-weight files, three repos, all non-gated. The transformer
        # GGUF is city96's redistribution; the T5/CLIP-L encoders come from
        # comfyanonymous's canonical FLUX text-encoder pack; the VAE mirror is
        # `sirorable/flux-ae-vae` (the BFL original at black-forest-labs/FLUX.1-schnell
        # is gated). All four sit flat in `_desktop_models_dir()` so sdcpp.py
        # can locate them by `desktop_file` / `desktop_companions` name.
        "download_sources": [
            {"repo": "city96/FLUX.1-schnell-gguf", "filename": "flux1-schnell-Q4_0.gguf"},
            {"repo": "comfyanonymous/flux_text_encoders", "filename": "t5xxl_fp8_e4m3fn.safetensors"},
            {"repo": "comfyanonymous/flux_text_encoders", "filename": "clip_l.safetensors"},
            {"repo": "sirorable/flux-ae-vae", "filename": "ae.safetensors"},
        ],
    },
    {
        "id": "triposplat",
        "task": "image_to_3d",
        "label": "TripoSplat (image → 3D)",
        "description": "Convertit une image 2D en objet 3D (Gaussian splats, .ply/.splat). Modèle VAST-AI TripoSplat, poids fp16 + VAE + DINOv3 + background removal.",
        "repo": "VAST-AI/TripoSplat",
        "files": [],  # whole-repo snapshot (ckpts/ subtree: diffusion + vae + clip_vision + bg removal)
        # birefnet (~1 GB) + triposplat_fp16 (~3.5 GB) + dino_v3_vit_h (~1.2 GB)
        # + flux2-vae + decoder (~1.6 GB) ≈ 7.3 GB on disk.
        "size_mb": 7400,
        "runtime": "torch",
        "adapter": "triposplat",
        "tool_name": "local_image_to_3d",
        "tool_desc": "Convert a single 2D image into a 3D object (Gaussian splats, .ply) on-device (VAST-AI TripoSplat). LOCAL/free/offline. Args: image_path (str, absolute), gaussians (int, optional density up to 262144). Returns JSON {output_path, format, bytes}. Needs torch + the TripoSplat runtime; returns an actionable error if absent.",
        "license": "MIT",
        "languages": ["multi"],
    },
    {
        "id": "tesseract",
        "task": "ocr",
        "label": "Tesseract OCR",
        "description": "OCR système (fallback). Nécessite le binaire tesseract (brew install tesseract tesseract-lang sur macOS).",
        "repo": "system",
        "files": [],
        "size_mb": 0,  # system binary
        "runtime": "system",
        "adapter": "ocr",
        "tool_name": "local_ocr",
        "tool_desc": "Extract text from an image file via local OCR. LOCAL/free/offline. Args: image_path (str, absolute), lang (str, optional ISO code or tesseract code), hints (object, optional {handwritten: bool, scientific: bool, lang: str}). Engine is auto-routed: PaddleOCR (default if installed), Tesseract (fallback). Prefer over any remote OCR.",
        "license": "Apache-2.0",
        "languages": ["multi"],
    },
    {
        "id": "paddle-ocr-v4",
        "task": "ocr",
        "label": "PaddleOCR v4 (ONNX)",
        "description": "OCR moderne PP-OCRv4 (détection + reconnaissance) via rapidocr-onnxruntime. CPU pur, ~40 MB total, multi-script. Default si installé.",
        # `repo` is informational for system runtimes — no HF download.
        "repo": "RapidAI/rapidocr_onnxruntime (PyPI)",
        "files": [],
        "size_mb": 40,
        "runtime": "system",
        "adapter": "paddle_ocr",
        # Shares the tool name with Tesseract — tools.py emits a single
        # `local_ocr` tool and routes to the best installed engine.
        "tool_name": "local_ocr",
        "tool_desc": "Extract text from an image file via local OCR (PaddleOCR + Tesseract fallback). LOCAL/free/offline. Args: image_path (str, absolute), lang (str, optional), hints (object, optional). Auto-routed.",
        "license": "Apache-2.0",
        "languages": ["multi"],
    },
]


_BY_ID = {m["id"]: m for m in CATALOG}


def by_id(model_id: str) -> dict | None:
    return _BY_ID.get(model_id)


def all_models() -> list[dict]:
    return list(CATALOG)


def by_task(task: str) -> list[dict]:
    return [m for m in CATALOG if m["task"] == task]
