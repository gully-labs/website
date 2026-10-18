#!/usr/bin/env bash
# Gully Devnet preflight. Read-only checks by default; with --start it also starts the devnet, and ONLY if every
# check passes. It never stops, removes, prunes or builds anything, and it touches no container but gully-devnet.
#
#   bash ops/devnet/preflight.sh            # checks only, changes nothing
#   bash ops/devnet/preflight.sh --start    # checks, then `docker compose up -d` for gully-devnet
#
# Thresholds (override with env): MIN_FREE_GB=15, MIN_AVAIL_RAM_MB=3072.
set -euo pipefail

MIN_FREE_GB="${MIN_FREE_GB:-15}"
MIN_AVAIL_RAM_MB="${MIN_AVAIL_RAM_MB:-3072}"
RPC_PORT="${GULLY_DEVNET_RPC_PORT:-8547}"
WS_PORT="${GULLY_DEVNET_WS_PORT:-8548}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START=0
[[ "${1:-}" == "--start" ]] && START=1

# The floor is not lowerable below 15 GB: that is the owner's rule for the shared box.
if (( MIN_FREE_GB < 15 )); then echo "refused: MIN_FREE_GB may not be set below 15" >&2; exit 2; fi

fail=0
ok()   { printf '  ok    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; fail=1; }

echo "Gully Devnet preflight"

# 1. Disk: free space on the filesystem that holds Docker's data (images, container layers, logs).
command -v docker >/dev/null || { echo "docker not found" >&2; exit 2; }
root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
[[ -d "$root" ]] || root=/
free_kb="$(df -Pk "$root" | awk 'NR==2 {print $4}')"
free_gb=$(( free_kb / 1024 / 1024 ))
if (( free_gb >= MIN_FREE_GB )); then ok "disk: ${free_gb} GB free on ${root} (need ${MIN_FREE_GB})"
else bad "disk: ${free_gb} GB free on ${root}, need at least ${MIN_FREE_GB} GB. Not starting. Do NOT prune other projects' images to make room: ask the owner."; fi

# 2. RAM actually available (not just free).
if [[ -r /proc/meminfo ]]; then
  avail_mb=$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 ))
  if (( avail_mb >= MIN_AVAIL_RAM_MB )); then ok "ram: ${avail_mb} MB available (need ${MIN_AVAIL_RAM_MB}; the container is capped at 2 GB)"
  else bad "ram: ${avail_mb} MB available, need ${MIN_AVAIL_RAM_MB}"; fi
fi

# 3. Ports on loopback.
for p in "$RPC_PORT" "$WS_PORT"; do
  if command -v ss >/dev/null && ss -ltn "sport = :$p" | grep -q LISTEN; then bad "port 127.0.0.1:$p is already in use"
  else ok "port $p free"; fi
done

# 4. The name. An existing gully-devnet is ours; anything else with the name is a conflict to report, not remove.
if docker ps -a --format '{{.Names}}' | grep -qx gully-devnet; then
  state="$(docker inspect -f '{{.State.Status}}' gully-devnet)"
  if [[ "$state" == running ]]; then ok "gully-devnet is already running (nothing to do)"; START=0
  else bad "a stopped gully-devnet exists (state: $state). Inspect it; remove it yourself only if it is ours: docker compose -f $HERE/compose.yaml down"; fi
else ok "container name gully-devnet is free"; fi

# 5. Image: is it already on the box? If not, starting pulls about 1.4 GB compressed.
img="offchainlabs/nitro-node:v3.11.5-7d41882"
if docker image inspect "$img" >/dev/null 2>&1; then ok "image present: $img"
else echo "  info  image not on the box yet: --start will pull $img (1.41 GB compressed, more unpacked)"; fi

if (( fail )); then echo "Preflight FAILED. Nothing was started."; exit 1; fi
echo "Preflight passed."

if (( START )); then
  echo "Starting gully-devnet..."
  docker compose -f "$HERE/compose.yaml" up -d
  for _ in $(seq 1 60); do
    if curl -fsS -X POST -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' "http://127.0.0.1:${RPC_PORT}" 2>/dev/null | grep -q result; then
      echo "gully-devnet is answering on http://127.0.0.1:${RPC_PORT} (chain id 412346)"; exit 0
    fi
    sleep 2
  done
  echo "gully-devnet did not answer within 120 s. Logs: docker logs --tail 50 gully-devnet" >&2
  exit 1
fi
