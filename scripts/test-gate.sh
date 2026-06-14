#!/usr/bin/env bash
# Regression gate. Runs all non-bench tests + essential e2e (kb).
# Excludes e2e_lazada_hoodie.py (web scraping bench, slow + network-bound).
# Exit 0 = green. Exit 2 = red, caller must fix before declaring done.

set -u
cd "$(dirname "$0")/.."

FAIL=0

echo "==> jest (server)"
npm test --silent 2>&1 | tail -20
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  FAIL=1
  echo "JEST_FAILED"
fi

echo ""
echo "==> pytest (monkey + kb e2e, excl. lazada bench)"
PYTHON=python3
[ -x .venv/bin/python ] && PYTHON=.venv/bin/python
"$PYTHON" -m pytest tests/ --ignore=tests/e2e_lazada_hoodie.py -q 2>&1 | tail -30
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  FAIL=1
  echo "PYTEST_FAILED"
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "==> GATE RED. Fix tests before stopping."
  exit 2
fi
echo ""
echo "==> GATE GREEN."
exit 0
