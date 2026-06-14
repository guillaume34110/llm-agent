#!/usr/bin/env bash
# Fetch a pinned llama.cpp `llama-server` binary for the host triple and place
# it under desktop/src-tauri/binaries/llama-server-<triple>[.exe].
#
# Same script for dev (run it once before `cargo tauri dev`) and CI (matrix
# over targets sets LLAMA_TARGET and runs this).
#
# Pin the release tag so dev/CI/prod all run the exact same llama-server.
# Bump LLAMA_RELEASE deliberately and re-test the catalog against it.

set -euo pipefail

LLAMA_RELEASE="${LLAMA_RELEASE:-b9279}"
BASE_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_RELEASE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/../binaries"
mkdir -p "${BIN_DIR}"

detect_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}-${arch}" in
    Darwin-arm64)   echo "aarch64-apple-darwin" ;;
    Darwin-x86_64)  echo "x86_64-apple-darwin" ;;
    Linux-x86_64)   echo "x86_64-unknown-linux-gnu" ;;
    Linux-aarch64)  echo "aarch64-unknown-linux-gnu" ;;
    MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) echo "x86_64-pc-windows-msvc" ;;
    *) echo "unknown" ;;
  esac
}

TRIPLE="${LLAMA_TARGET:-$(detect_triple)}"

case "${TRIPLE}" in
  aarch64-apple-darwin)        ASSET="llama-${LLAMA_RELEASE}-bin-macos-arm64.tar.gz" ; EXE="" ; ARCHIVE="tgz" ;;
  x86_64-apple-darwin)         ASSET="llama-${LLAMA_RELEASE}-bin-macos-x64.tar.gz"   ; EXE="" ; ARCHIVE="tgz" ;;
  x86_64-unknown-linux-gnu)    ASSET="llama-${LLAMA_RELEASE}-bin-ubuntu-x64.tar.gz"  ; EXE="" ; ARCHIVE="tgz" ;;
  x86_64-pc-windows-msvc)      ASSET="llama-${LLAMA_RELEASE}-bin-win-cpu-x64.zip"    ; EXE=".exe" ; ARCHIVE="zip" ;;
  *) echo "unsupported triple: ${TRIPLE}" >&2 ; exit 1 ;;
esac

OUT="${BIN_DIR}/llama-server-${TRIPLE}${EXE}"
if [[ -f "${OUT}" ]] && [[ -z "${FORCE:-}" ]]; then
  echo "already present: ${OUT} (set FORCE=1 to redownload)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "fetching ${ASSET} (${LLAMA_RELEASE}) for ${TRIPLE}..."
curl -fL --retry 3 -o "${TMP}/release.${ARCHIVE}" "${BASE_URL}/${ASSET}"

echo "extracting llama-server..."
mkdir -p "${TMP}/extracted"
case "${ARCHIVE}" in
  tgz) tar -xzf "${TMP}/release.tgz" -C "${TMP}/extracted" ;;
  zip) unzip -q "${TMP}/release.zip" -d "${TMP}/extracted" ;;
esac

SRC="$(find "${TMP}/extracted" -type f -name "llama-server${EXE}" | head -n 1)"
if [[ -z "${SRC}" ]]; then
  echo "llama-server${EXE} not found in ${ASSET}" >&2
  exit 1
fi
SRC_DIR="$(dirname "${SRC}")"

cp "${SRC}" "${OUT}"
chmod +x "${OUT}" 2>/dev/null || true
echo "installed: ${OUT}"

# llama.cpp ships shared libs alongside llama-server since ~b5000. The binary's
# LC_RPATH is @loader_path so the dylibs must sit next to the binary at runtime.
# Copy every shared object from the archive into the same binaries dir.
case "${TRIPLE}" in
  *apple-darwin) LIB_GLOB="*.dylib" ;;
  *linux-gnu)    LIB_GLOB="*.so*"   ;;
  *windows-msvc) LIB_GLOB="*.dll"   ;;
esac
shopt -s nullglob 2>/dev/null || true
copied=0
for lib in "${SRC_DIR}"/${LIB_GLOB}; do
  [[ -f "${lib}" ]] || continue
  cp -P "${lib}" "${BIN_DIR}/"
  copied=$((copied + 1))
done
echo "copied ${copied} shared libraries to ${BIN_DIR}"

# macOS: re-sign binary + dylibs with proper adhoc signature.
# linker-signed adhoc (flags 0x20002) is rejected by the macOS code-signing
# monitor when spawned from a signed parent app (SIGKILL Code Signature Invalid).
# codesign --force replaces it with a full adhoc (flags 0x2) that passes validation.
if command -v codesign &>/dev/null; then
  echo "re-signing with adhoc..."
  codesign --force --sign - "${OUT}"
  for lib in "${BIN_DIR}"/*.dylib; do
    [[ -f "${lib}" ]] || continue
    codesign --force --sign - "${lib}"
  done
  echo "signing done"
fi
