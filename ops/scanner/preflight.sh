#!/bin/sh
# Refuses to build or start gully-scanner unless the box has room for it. Read-only: it only measures.
#   ./ops/scanner/preflight.sh && docker compose -p gully-scanner -f ops/scanner/compose.scanner.yaml up -d --build
# Needs: 15 GB free on the filesystem holding Docker's data (image ~1.5 GB, build layers ~3 GB, headroom
# for every other project on the box), 3 GB of available memory (the worker is capped at 2 GB).
set -eu

MIN_FREE_GB=${MIN_FREE_GB:-15}
MIN_MEM_MB=${MIN_MEM_MB:-3072}

root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
[ -n "$root" ] && [ -d "$root" ] || root=/var/lib/docker
[ -d "$root" ] || root=/

free_kb=$(df -Pk "$root" | awk 'NR==2 {print $4}')
free_gb=$((free_kb / 1024 / 1024))
used_pct=$(df -Pk "$root" | awk 'NR==2 {gsub("%","",$5); print $5}')
echo "preflight: ${free_gb} GB free on ${root} (${used_pct}% used); need ${MIN_FREE_GB} GB"
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  echo "preflight: REFUSED: not enough disk. Free space first (owner decision; do not prune other projects' images or volumes)." >&2
  exit 1
fi

if [ -r /proc/meminfo ]; then
  avail_mb=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
  echo "preflight: ${avail_mb} MB memory available; need ${MIN_MEM_MB} MB"
  if [ "$avail_mb" -lt "$MIN_MEM_MB" ]; then
    echo "preflight: REFUSED: not enough memory available." >&2
    exit 1
  fi
fi

if [ -z "${SCANNER_TOKEN:-}" ] || [ "${#SCANNER_TOKEN}" -lt 24 ]; then
  echo "preflight: REFUSED: export SCANNER_TOKEN (24+ random characters, the same value as in ~/gully-web/.env)." >&2
  exit 1
fi

echo "preflight: OK"
