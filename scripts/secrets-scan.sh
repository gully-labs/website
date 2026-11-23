#!/usr/bin/env bash
# secrets-scan.sh: scan the working tree and (with --history) the full git history. Prints redacted findings only.
# Usage: bash scripts/secrets-scan.sh [--history]    (package.json: "secrets": "bash scripts/secrets-scan.sh --history")
# Needs gitleaks on PATH, or Docker. Exit code 1 when there is a finding. Never prints a secret value (--redact=100).
set -euo pipefail
CFG="${GITLEAKS_CONFIG:-.gitleaks.toml}"
[ -f "$CFG" ] || { echo "missing $CFG (copy gully-ops/.gitleaks.toml)" >&2; exit 2; }
run() {
  if command -v gitleaks >/dev/null 2>&1; then gitleaks "$@"
  else docker run --rm -v "$PWD:/repo:ro" -w /repo zricethezav/gitleaks:v8.30.1 "$@"; fi
}
rc=0
run dir . --config "$CFG" --redact=100 --no-banner || rc=1
if [ "${1:-}" = "--history" ]; then run git . --config "$CFG" --log-opts="--all" --redact=100 --no-banner || rc=1; fi
[ "$rc" = 0 ] && echo "secrets-scan: clean" || echo "secrets-scan: FINDINGS (see above). Rotate the credential first, then remove it." >&2
exit "$rc"
