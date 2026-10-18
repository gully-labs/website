#!/usr/bin/env bash
# Gully Hyperlane agents preflight. Read-only checks by default; with --start it also starts the two agents, and
# ONLY if every check passes. It never stops, removes, prunes or builds anything, and it touches no container but
# gully-hyperlane-validator and gully-hyperlane-relayer. It never prints a key: it only checks that one is set.
#
#   bash ops/l3/hyperlane/preflight.sh            # checks only, changes nothing
#   bash ops/l3/hyperlane/preflight.sh --start    # checks, then `docker compose up -d` for gully-hyperlane
#
# Thresholds (override with env): MIN_FREE_GB=15, MIN_AVAIL_RAM_MB=2048 (two agents capped at 1 GB each).
set -euo pipefail

MIN_FREE_GB="${MIN_FREE_GB:-15}"
MIN_AVAIL_RAM_MB="${MIN_AVAIL_RAM_MB:-2048}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START=0
[[ "${1:-}" == "--start" ]] && START=1

# The floor is not lowerable below 15 GB: that is the owner's rule for the shared box (same as ops/devnet).
if (( MIN_FREE_GB < 15 )); then echo "refused: MIN_FREE_GB may not be set below 15" >&2; exit 2; fi

fail=0
ok()   { printf '  ok    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; fail=1; }
info() { printf '  info  %s\n' "$*"; }

echo "Gully Hyperlane preflight"

# 0. The .env with the keys. Read for the port and chain settings only; values are never echoed.
ENV_FILE="$HERE/.env"
if [[ -f "$ENV_FILE" ]]; then
  perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '?')"
  if [[ "$perm" == 600 || "$perm" == 400 ]]; then ok ".env present (mode $perm)"; else bad ".env is mode $perm; make it 600 (chmod 600 $ENV_FILE)"; fi
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
else
  bad ".env missing: copy .env.example to .env, fill the keys, chmod 600"
fi
ORIGIN="${HYPERLANE_ORIGIN_CHAIN:-gullydevnet}"
RELAY="${HYPERLANE_RELAY_CHAINS:-gullydevnet,arbitrumsepolia}"
VPORT="${GULLY_HYPERLANE_VALIDATOR_METRICS_PORT:-9090}"
RPORT="${GULLY_HYPERLANE_RELAYER_METRICS_PORT:-9091}"
origin_upper="$(echo "$ORIGIN" | tr '[:lower:]' '[:upper:]')"
for var in HYP_VALIDATOR_KEY "HYP_CHAINS_${origin_upper}_SIGNER_KEY" HYP_DEFAULTSIGNER_KEY; do
  val="${!var:-}"
  if [[ -z "$val" || "$val" == *__* ]]; then bad "$var is unset or still a placeholder (value not shown)"
  elif [[ ! "$val" =~ ^0x[0-9a-fA-F]{64}$ ]]; then bad "$var is not a 32-byte hex key (value not shown)"
  else ok "$var is set (value not shown)"; fi
done

# 1. The agent config: valid JSON, no FILL placeholders, origin and relay chains present.
CFG="$HERE/agent-config.json"
if [[ -f "$CFG" ]]; then
  if command -v python3 >/dev/null; then
    if python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CFG" 2>/dev/null; then ok "agent-config.json is valid JSON"; else bad "agent-config.json is not valid JSON"; fi
  fi
  if grep -q '0xFILL' "$CFG"; then bad "agent-config.json still has 0xFILL placeholders: run hyperlane core deploy and copy the addresses (README.md step 3)"; else ok "agent-config.json has no FILL placeholders"; fi
  IFS=',' read -ra chains <<< "$RELAY"
  for c in "$ORIGIN" "${chains[@]}"; do
    if grep -q "\"$c\"" "$CFG"; then ok "chain $c is in agent-config.json"; else bad "chain $c is not in agent-config.json"; fi
  done
else
  bad "agent-config.json missing"
fi

# 2. Disk: free space on the filesystem that holds Docker's data.
command -v docker >/dev/null || { echo "docker not found" >&2; exit 2; }
root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
[[ -d "$root" ]] || root=/
free_kb="$(df -Pk "$root" | awk 'NR==2 {print $4}')"
free_gb=$(( free_kb / 1024 / 1024 ))
if (( free_gb >= MIN_FREE_GB )); then ok "disk: ${free_gb} GB free on ${root} (need ${MIN_FREE_GB})"
else bad "disk: ${free_gb} GB free on ${root}, need at least ${MIN_FREE_GB} GB. Not starting. Do NOT prune other projects' images to make room: ask the owner."; fi

# 3. RAM actually available.
if [[ -r /proc/meminfo ]]; then
  avail_mb=$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 ))
  if (( avail_mb >= MIN_AVAIL_RAM_MB )); then ok "ram: ${avail_mb} MB available (need ${MIN_AVAIL_RAM_MB}; each agent is capped at 1 GB)"
  else bad "ram: ${avail_mb} MB available, need ${MIN_AVAIL_RAM_MB}"; fi
fi

# 4. Metrics ports on loopback.
for p in "$VPORT" "$RPORT"; do
  if command -v ss >/dev/null && ss -ltn "sport = :$p" | grep -q LISTEN; then bad "port 127.0.0.1:$p is already in use"
  else ok "port $p free"; fi
done

# 5. Names. An existing gully-hyperlane-* is ours; anything else with the name is a conflict to report, not remove.
running=0
for name in gully-hyperlane-validator gully-hyperlane-relayer; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    state="$(docker inspect -f '{{.State.Status}}' "$name")"
    if [[ "$state" == running ]]; then ok "$name is already running"; running=1
    else bad "a stopped $name exists (state: $state). Inspect it; remove it yourself only if it is ours: docker compose -f $HERE/compose.yaml down"; fi
  else ok "container name $name is free"; fi
done
(( running )) && START=0

# 6. The devnet network and node, when the origin is the light devnet.
if [[ "$ORIGIN" == gullydevnet ]]; then
  if docker network inspect gully-devnet >/dev/null 2>&1; then ok "network gully-devnet exists"; else bad "network gully-devnet missing: start ops/devnet first (bash ops/devnet/preflight.sh --start)"; fi
  if docker ps --format '{{.Names}}' | grep -qx gully-devnet; then ok "gully-devnet is running"; else bad "gully-devnet is not running: the validator would find no chain to sign for"; fi
fi

# 7. Image: is it already on the box? If not, starting pulls about 220 MB compressed (amd64).
img="ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0"
if docker image inspect "$img" >/dev/null 2>&1; then ok "image present: $img"
else info "image not on the box yet: --start will pull $img (220 MB compressed, ~0.7 GB unpacked)"; fi

if (( fail )); then echo "Preflight FAILED. Nothing was started."; exit 1; fi
echo "Preflight passed."

if (( START )); then
  echo "Starting gully-hyperlane (validator, then relayer)..."
  docker compose -f "$HERE/compose.yaml" up -d
  for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:${VPORT}/metrics" 2>/dev/null | grep -q hyperlane && curl -fsS "http://127.0.0.1:${RPORT}/metrics" 2>/dev/null | grep -q hyperlane; then
      echo "both agents answer on their metrics ports (${VPORT}, ${RPORT}). Logs: docker logs --tail 50 gully-hyperlane-validator"; exit 0
    fi
    sleep 2
  done
  echo "the agents did not expose metrics within 90 s. Logs: docker logs --tail 50 gully-hyperlane-validator; docker logs --tail 50 gully-hyperlane-relayer" >&2
  exit 1
fi
