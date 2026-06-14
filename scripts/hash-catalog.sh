#!/usr/bin/env bash
# Populate the sha256 column of desktop/src/models/catalog.ts.
#
# Strategy: for every catalog entry, look for its ggufFile inside the local
# models directory. If present, sha256 it and emit a sed expression that
# replaces the matching empty `sha256: ''` line. Files that are not yet on
# disk are skipped (the release pipeline will re-run this after pulling).
#
# Usage:
#   scripts/hash-catalog.sh                  # report only
#   scripts/hash-catalog.sh --apply          # patch catalog.ts in place
#   MODELS_DIR=/path scripts/hash-catalog.sh # override discovery
#
# Default search locations (first match wins):
#   $MODELS_DIR
#   ~/Library/Application Support/com.monkey.app/models  (macOS dev bundle)
#   ~/.local/share/com.monkey.app/models                 (Linux dev bundle)
#   desktop/src-tauri/target/models                      (manual stash)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG="$ROOT/desktop/src/models/catalog.ts"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

CANDIDATES=(
  "${MODELS_DIR:-}"
  "$HOME/Library/Application Support/com.monkey.app/models"
  "$HOME/.local/share/com.monkey.app/models"
  "$ROOT/desktop/src-tauri/target/models"
)

resolve_dir() {
  for d in "${CANDIDATES[@]}"; do
    [[ -n "$d" && -d "$d" ]] && { echo "$d"; return 0; }
  done
  return 1
}

MODELS=""
if MODELS=$(resolve_dir); then
  echo "[hash-catalog] scanning $MODELS"
else
  echo "[hash-catalog] no models dir found — nothing to hash" >&2
  exit 0
fi

# Extract (ggufFile, current_sha256) pairs by reading catalog.ts line-by-line.
# We do a minimal grep instead of pulling in node — the file is structured
# enough that a sed pipeline is robust here.
files=$(grep -E "ggufFile: '" "$CATALOG" | sed -E "s/.*ggufFile: '([^']+)'.*/\1/")

patched=0
for f in $files; do
  src="$MODELS/$f"
  if [[ ! -f "$src" ]]; then
    echo "  skip  $f (not downloaded)"
    continue
  fi
  if command -v shasum >/dev/null 2>&1; then
    digest=$(shasum -a 256 "$src" | awk '{print $1}')
  else
    digest=$(sha256sum "$src" | awk '{print $1}')
  fi
  printf "  hash  %-50s %s\n" "$f" "$digest"
  if [[ "$APPLY" == "1" ]]; then
    # Replace only entries whose ggufFile precedes an empty sha256 within the
    # next ~12 lines. We anchor on the literal filename to avoid drift.
    python3 - "$CATALOG" "$f" "$digest" <<'PY'
import re, sys
path, fname, digest = sys.argv[1:4]
src = open(path).read()
pat = re.compile(
    r"(ggufFile: '" + re.escape(fname) + r"',[\s\S]{0,600}?sha256: ')'",
)
new, n = pat.subn(r"\g<1>" + digest + "'", src, count=1)
if n == 0:
    sys.stderr.write(f"  warn: no empty sha256 slot found for {fname}\n")
else:
    open(path, 'w').write(new)
PY
    patched=$((patched + 1))
  fi
done

if [[ "$APPLY" == "1" ]]; then
  echo "[hash-catalog] patched $patched entries in $CATALOG"
else
  echo "[hash-catalog] dry run (pass --apply to write)"
fi
