#!/usr/bin/env bash
# Build the Python sidecar with PyArmor obfuscation, then PyInstaller.
# Goal: harden monkey/ against trivial pyinstxtractor + decompyle3 recovery.
#
# Requirements:
#   pip install pyarmor pyinstaller
#
# Usage:
#   ./scripts/build-sidecar-protected.sh
#
# Output:
#   dist/monkey-server-aarch64-apple-darwin
#
# Skip obfuscation (fast dev build):
#   SKIP_PYARMOR=1 ./scripts/build-sidecar-protected.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_DIR="build/sidecar-protected"
SPEC_FILE="monkey-server-aarch64-apple-darwin.spec"
SIDECAR_BIN="monkey-server-aarch64-apple-darwin"
TAURI_BIN_DIR="desktop/src-tauri/binaries"

# tauri externalBin reads from desktop/src-tauri/binaries/, the spec writes to dist/.
# Keep them in sync or `npm run tauri build` silently bundles a stale sidecar.
sync_tauri_binary() {
  mkdir -p "$TAURI_BIN_DIR"
  cp "dist/$SIDECAR_BIN" "$TAURI_BIN_DIR/$SIDECAR_BIN"
  echo "[sync] dist/$SIDECAR_BIN -> $TAURI_BIN_DIR/$SIDECAR_BIN"
}

if ! command -v pyinstaller >/dev/null; then
  echo "ERREUR: pyinstaller introuvable. pip install pyinstaller" >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

if [[ "${SKIP_PYARMOR:-0}" == "1" ]]; then
  echo "[skip] PyArmor désactivé (SKIP_PYARMOR=1), build standard"
  pyinstaller --clean --noconfirm "$SPEC_FILE"
  sync_tauri_binary
  exit 0
fi

if ! command -v pyarmor >/dev/null; then
  echo "ERREUR: pyarmor introuvable. pip install pyarmor" >&2
  exit 1
fi

echo "[1/3] PyArmor obfuscation -> $BUILD_DIR/obf"
# --recursive: walk monkey/ tree
# --output: write obfuscated tree
# --platform: target macOS arm64 runtime
pyarmor gen \
  --output "$BUILD_DIR/obf" \
  --recursive \
  --platform darwin.aarch64 \
  monkey/

# PyArmor writes the obfuscated package as monkey/ inside output dir.
# Also emits pyarmor_runtime_xxxx/ next to it — must be importable.

echo "[2/3] PyInstaller spec patché vers tree obfusqué"
PATCHED_SPEC="$BUILD_DIR/monkey-server-protected.spec"
sed "s|'monkey/main.py'|'$BUILD_DIR/obf/monkey/main.py'|" \
  "$SPEC_FILE" > "$PATCHED_SPEC"

echo "[3/3] PyInstaller build"
PYTHONPATH="$BUILD_DIR/obf:${PYTHONPATH:-}" \
  pyinstaller --clean --noconfirm "$PATCHED_SPEC"

sync_tauri_binary
echo "[ok] sidecar protégé -> dist/monkey-server-aarch64-apple-darwin"
