#!/usr/bin/env bash
# Sign a built provider-runtime binary with the Progsoft release ed25519 key.
# Produces a sidecar <binary>.sig containing base64(signature(sha256(binary))).
#
# Usage:
#   scripts/sign-provider-runtime.sh <path/to/binary> <path/to/release-private-key.pem>
#
# Verify locally:
#   openssl pkeyutl -verify -pubin -inkey release-pub.pem \
#     -rawin -in <(openssl dgst -sha256 -binary <binary>) \
#     -sigfile <(base64 -d <binary>.sig)
#
# The server side expects PROGSOFT_RUNTIME_PUBKEY_PEM to match this private key.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <binary> <release-private-key.pem>" >&2
  exit 2
fi

BIN="$1"
KEY="$2"

if [[ ! -f "$BIN" ]]; then echo "binary not found: $BIN" >&2; exit 1; fi
if [[ ! -f "$KEY" ]]; then echo "key not found: $KEY" >&2; exit 1; fi

HASH_HEX=$(shasum -a 256 "$BIN" | awk '{print $1}')
echo "binary sha256: $HASH_HEX"

# Sign the raw hex hash bytes (lowercase, no newline) using the release key.
# Payload = the hex digest string itself; the server verifies against the
# same payload with the corresponding public key (Ed25519 or RSA/ECDSA-SHA256).
# openssl pkeyutl -rawin needs a seekable file, so we stage in a tmpfile.
TMP_PAYLOAD=$(mktemp)
TMP_SIG=$(mktemp)
trap 'rm -f "$TMP_PAYLOAD" "$TMP_SIG"' EXIT
printf '%s' "$HASH_HEX" > "$TMP_PAYLOAD"
openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$TMP_PAYLOAD" -out "$TMP_SIG"
SIG_B64=$(base64 < "$TMP_SIG" | tr -d '\n')

OUT="${BIN}.sig"
printf '%s' "$SIG_B64" > "$OUT"
echo "wrote $OUT (${#SIG_B64} chars)"
