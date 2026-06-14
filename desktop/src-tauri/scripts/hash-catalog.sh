#!/usr/bin/env bash
# Streams each catalog GGUF and prints its SHA256, ready to paste into
# desktop/src/models/catalog.ts as the `sha256` field for each model.
#
# Streaming (no on-disk cache) — runs in ~25 GB of bandwidth, ~0 GB of disk.
# Run once when bumping the catalog or rotating quantizations. Pin the result
# into catalog.ts so production builds verify against an immutable hash.
#
# Usage:
#   ./hash-catalog.sh                # all 5 models
#   ./hash-catalog.sh phi-3-mini-4k  # subset by catalog id

set -euo pipefail

# (id, ggufFile, downloadUrl) — keep in sync with desktop/src/models/catalog.ts
ENTRIES=(
  "phi-3-mini-4k|Phi-3-mini-4k-instruct-Q4_K_M.gguf|https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-GGUF/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf?download=true"
  "mistral-7b-instruct-v0.3|Mistral-7B-Instruct-v0.3-Q4_K_M.gguf|https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf?download=true"
  "qwen2.5-7b-instruct|Qwen2.5-7B-Instruct-Q4_K_M.gguf|https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf?download=true"
  "llama-3.1-8b-instruct|Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf|https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf?download=true"
  "gemma-2-9b-it|gemma-2-9b-it-Q4_K_M.gguf|https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q4_K_M.gguf?download=true"
)

if command -v sha256sum >/dev/null 2>&1; then
  HASH_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD="shasum -a 256"
else
  echo "need sha256sum or shasum on PATH" >&2
  exit 1
fi

FILTER="${1:-}"

for entry in "${ENTRIES[@]}"; do
  IFS='|' read -r id file url <<<"${entry}"
  if [[ -n "${FILTER}" && "${FILTER}" != "${id}" ]]; then
    continue
  fi
  echo "hashing ${id} (${file})..." >&2
  hash="$(curl -fL --retry 3 "${url}" | ${HASH_CMD} | awk '{print $1}')"
  echo "${id}  ${hash}"
done
