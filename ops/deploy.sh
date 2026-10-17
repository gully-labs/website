#!/usr/bin/env bash
# Zero-downtime deploy of gully-web, run ON the box from ~/gully-web after the source is uploaded.
# Design and owner instructions: ops/DEPLOY.md.
#
#   Cloudflare ──► 0.0.0.0:2053 ─┐
#   local checks ► 127.0.0.1:8099 ┴► gully-edge (HAProxy, plain TCP) ──► gully-web-slot-a | gully-web-slot-b
#
# gully-edge owns the host ports and never restarts during a deploy. Each web container joins gully_default
# with a slot alias (gully-web-slot-a or -b). A deploy builds gully-web:<sha>, starts it as gully-web-next on the
# free slot, waits for /healthz, points the edge at the new slot with a graceful reload (old connections
# finish on the old process), checks through the edge, drains, stops the old container and renames the new
# one to gully-web. A failed check at any step removes gully-web-next and leaves the old one serving.
#
# Usage: ops/deploy.sh [--sha <sha>] [--dry-run] [--no-build --tag <tag>] [--rollback] [--status]
#
# Safety: every docker command that changes something goes through dk(), and every name it touches is checked
# by guard(): containers, images, networks and volumes must start with gully- (or gully_, compose's network name).
# The only foreign image used is the edge's HAProxy image, run as a gully-* container. Nothing else on this shared box
# is ever started, stopped, removed or pruned (owner rule).

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

PUBLIC_PORT=${GULLY_PUBLIC_PORT:-2053}
LOCAL_PORT=${GULLY_WEB_PORT:-8099}
NETWORK=${GULLY_NETWORK:-gully_default}
EDGE_IMAGE=${GULLY_EDGE_IMAGE:-haproxy:3.0-alpine}
HEALTH_TIMEOUT=${GULLY_HEALTH_TIMEOUT:-120}
DRAIN=${GULLY_DRAIN_SECONDS:-10}
KEEP_IMAGES=${GULLY_KEEP_IMAGES:-3}
STATE_DIR=${GULLY_STATE_DIR:-$ROOT/.edge}
LIVE=gully-web
NEXT=gully-web-next
EDGE=gully-edge
REPO=gully-web

DRY=0
BUILD=1
TAG=
ACTION=deploy

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY=1 ;;
    --sha) TAG=${2:?--sha needs a value}; shift ;;
    --tag) TAG=${2:?--tag needs a value}; shift ;;
    --no-build) BUILD=0 ;;
    --rollback) ACTION=rollback; BUILD=0 ;;
    --status) ACTION=status ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

# Refuses any name that is not ours. Image references are checked by repository (the part before ':').
guard() {
  local name
  for name in "$@"; do
    # gully_default is compose's name for the project network.
    case ${name%%:*} in
      gully-?* | gully_?*) ;;
      *) die "refusing to touch '$name': only gully-* containers, images, networks and volumes" ;;
    esac
  done
}

# Runs (or, with --dry-run, prints) a docker command that changes state.
dk() {
  if [ "$DRY" = 1 ]; then
    { printf '  DRY-RUN: docker'; printf ' %q' "$@"; printf '\n'; } >&2
    return 0
  fi
  docker "$@"
}

# Read-only queries always run (they are what the dry run reasons from).
exists() { guard "$1"; docker container inspect "$1" >/dev/null 2>&1; }
running() { guard "$1"; [ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
label() { guard "$1"; docker container inspect -f "{{ index .Config.Labels \"$2\" }}" "$1" 2>/dev/null || true; }

other_slot() { if [ "$1" = a ]; then echo b; else echo a; fi; }

state_get() { [ -f "$STATE_DIR/state" ] && sed -n "s/^$1=//p" "$STATE_DIR/state" | tail -n1 || true; }
state_write() {
  [ "$DRY" = 1 ] && { log "would record state: SLOT=$1 TAG=$2 PREV_TAG=$3"; return; }
  printf 'SLOT=%s\nTAG=%s\nPREV_TAG=%s\nAT=%s\n' "$1" "$2" "$3" "$(date -u +%FT%TZ)" > "$STATE_DIR/state.tmp"
  mv "$STATE_DIR/state.tmp" "$STATE_DIR/state"
}

# .env in the format `docker run --env-file` reads. Compose strips quotes and inline comments; docker run
# does not, so the file is normalised here. The copy is mode 600 and never printed.
write_env() {
  local out=$STATE_DIR/web.env line key val
  [ "$DRY" = 1 ] && { log "would normalise .env into $out (mode 600)"; return; }
  : > "$out.tmp"
  chmod 600 "$out.tmp"
  if [ -f "$ROOT/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line=${line%$'\r'}
      line=${line#"${line%%[![:space:]]*}"}
      case $line in ''|'#'*) continue ;; esac
      line=${line#export }
      key=${line%%=*}
      val=${line#*=}
      [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      if [[ $val =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]] || [[ $val =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
        val=${BASH_REMATCH[1]}
      else
        val=$(printf '%s' "$val" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')
      fi
      printf '%s=%s\n' "$key" "$val" >> "$out.tmp"
    done < "$ROOT/.env"
  fi
  mv "$out.tmp" "$out"
}

# The HAProxy config for the live slot. Plain TCP: gully-web terminates TLS itself on 8443 (it sniffs TLS vs
# HTTP on one port), so Cloudflare's TLS session and its CF-Connecting-IP header pass through untouched.
write_edge_cfg() {
  local slot=$1 file=$STATE_DIR/haproxy/haproxy.cfg
  [ "$DRY" = 1 ] && { log "would point $file at gully-web-slot-$slot"; return; }
  mkdir -p "$STATE_DIR/haproxy"
  cat > "$file.tmp" <<EOF
# Written by ops/deploy.sh: do not edit by hand. Live slot: $slot.
global
  # A reload lets the old worker finish its connections for at most this long.
  hard-stop-after ${DRAIN}s
  maxconn 4096

resolvers docker
  nameserver dns 127.0.0.11:53
  hold valid 5s

defaults
  mode tcp
  timeout connect 5s
  timeout client 5m
  timeout server 5m
  timeout tunnel 1h
  default-server init-addr last,libc,none resolvers docker inter 2s fall 3 rise 1

frontend public
  bind :2053
  default_backend web_tls

frontend local
  bind :8099
  default_backend web_http

backend web_tls
  option httpchk
  http-check send meth GET uri /healthz
  http-check expect status 200
  server live gully-web-slot-$slot:8443 check port 8080

backend web_http
  option httpchk
  http-check send meth GET uri /healthz
  http-check expect status 200
  server live gully-web-slot-$slot:8080 check
EOF
  chmod 755 "$STATE_DIR/haproxy"
  chmod 644 "$file.tmp"
  mv "$file.tmp" "$file"
}

ensure_edge_image() {
  [ "$DRY" = 1 ] && return 0
  docker image inspect "$EDGE_IMAGE" >/dev/null 2>&1 || docker pull -q "$EDGE_IMAGE" >/dev/null || die "could not pull $EDGE_IMAGE"
}

edge_check_cfg() {
  dk run --rm -v "$STATE_DIR/haproxy:/usr/local/etc/haproxy:ro" "$EDGE_IMAGE" haproxy -c -q -f /usr/local/etc/haproxy/haproxy.cfg \
    || die "the edge config did not validate"
}

edge_create() {
  guard "$EDGE"
  dk create --name "$EDGE" --restart unless-stopped --network "$NETWORK" \
    -p "0.0.0.0:$PUBLIC_PORT:2053" -p "127.0.0.1:$LOCAL_PORT:8099" \
    -v "$STATE_DIR/haproxy:/usr/local/etc/haproxy:ro" \
    --memory 64m --label gully.role=edge "$EDGE_IMAGE" >/dev/null
}

# Graceful reload: the HAProxy image runs in master-worker mode, so SIGHUP starts a worker on the new config
# while the old worker finishes its open connections (up to hard-stop-after).
edge_reload() { guard "$EDGE"; dk kill -s HUP "$EDGE" >/dev/null; }

# Starts the new container on `slot`. Keep these settings in step with the web service in compose.yaml.
run_next() {
  local slot=$1 image=$2
  guard "$NEXT" "$image" "$NETWORK" gully-web-data
  dk run -d --name "$NEXT" --restart unless-stopped \
    --network "$NETWORK" --network-alias "gully-web-slot-$slot" \
    --env-file "$STATE_DIR/web.env" \
    -e TLS_PORT=8443 -e TRACKER_DATA=/data/tracker-history.json -e DATA_DIR=/data \
    -e GULLY_STANDBY=1 \
    -v "$ROOT/certs:/certs:ro" -v gully-web-data:/data \
    --label gully.role=web --label "gully.slot=$slot" --label "gully.image=$image" \
    "$image" >/dev/null
}

# /healthz on both listeners inside the new container, then the app shell.
wait_healthy() {
  local name=$1 deadline=$((SECONDS + HEALTH_TIMEOUT))
  [ "$DRY" = 1 ] && { log "would wait up to ${HEALTH_TIMEOUT}s for $name /healthz (8080 and 8443) and /"; return 0; }
  while [ $SECONDS -lt $deadline ]; do
    running "$name" || { log "$name stopped while starting"; return 1; }
    if docker exec "$name" wget -qO- -T 3 http://127.0.0.1:8080/healthz >/dev/null 2>&1 \
      && docker exec "$name" wget -qO- -T 3 http://127.0.0.1:8443/healthz >/dev/null 2>&1 \
      && docker exec "$name" wget -qO- -T 5 http://127.0.0.1:8080/ 2>/dev/null | grep -q '<div id="root"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Through the edge, from the host: proves the edge reaches the new slot.
edge_ok() {
  local _
  [ "$DRY" = 1 ] && { log "would check http://127.0.0.1:$LOCAL_PORT/healthz through the edge"; return 0; }
  for _ in $(seq 1 15); do
    if curl -fsS -m 3 "http://127.0.0.1:$LOCAL_PORT/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# The new container runs no background loops (polls, alerts, Telegram webhook) until promoted, so alerts are
# not sent twice while the old one still serves (server/server.mjs: GULLY_STANDBY and SIGUSR2).
promote_next() { guard "$NEXT"; dk kill -s USR2 "$NEXT" >/dev/null || log "warning: could not promote $NEXT; run: docker kill -s USR2 gully-web"; }

abort_next() {
  log "rolling back: removing $NEXT; the old container keeps serving"
  if exists "$NEXT"; then
    [ "$DRY" = 1 ] || docker logs --tail 40 "$NEXT" 2>&1 | sed 's/^/  next| /' || true
    dk rm -f "$NEXT" >/dev/null || true
  fi
}

prune_images() {
  local keep=$1 current=$2 previous=$3 tags tag n=0
  tags=$(docker image ls "$REPO" --format '{{.Tag}}' 2>/dev/null | grep -v -e '^latest$' -e '^<none>$' || true)
  for tag in $tags; do
    n=$((n + 1))
    if [ "$tag" = "$current" ] || [ "$tag" = "$previous" ] || [ "$n" -le "$keep" ]; then continue; fi
    guard "$REPO:$tag"
    # Never forced: an image a container still uses is refused by docker and kept.
    dk image rm "$REPO:$tag" >/dev/null || true
  done
}

status() {
  echo "state: $(tr '\n' ' ' < "$STATE_DIR/state" 2>/dev/null || echo none)"
  docker ps -a --filter name=gully-web --filter name=gully-edge --format '{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
}

# ------------------------------------------------------------------------------------------------ main ---

command -v docker >/dev/null || die "docker is not on PATH"
mkdir -p "$STATE_DIR/haproxy"
chmod 700 "$STATE_DIR"
[ "$ACTION" = status ] && { status; exit 0; }

# One deploy at a time.
exec 9>"$STATE_DIR/deploy.lock"
command -v flock >/dev/null && { flock -n 9 || die "another deploy is running"; }

guard "$LIVE" "$NEXT" "$EDGE" "$NETWORK"
[ "$DRY" = 1 ] && log "DRY RUN: no docker command that changes anything will run"

PREV_TAG=$(state_get TAG)
if [ "$ACTION" = rollback ]; then
  TAG=$(state_get PREV_TAG)
  [ -n "$TAG" ] || die "no previous image recorded in $STATE_DIR/state"
  log "rolling back to $REPO:$TAG"
fi
[ -n "$TAG" ] || TAG=$(cat "$ROOT/UPLOADED_SHA" 2>/dev/null || true)
[ -n "$TAG" ] || TAG=t$(date -u +%Y%m%d%H%M%S)
[[ $TAG =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || die "bad tag '$TAG'"
IMAGE=$REPO:$TAG
guard "$IMAGE"

# Where are we? edge = the new layout; legacy = compose's gully-web owns the ports; fresh = nothing yet.
if exists "$EDGE"; then MODE=edge; elif exists "$LIVE"; then MODE=legacy; else MODE=fresh; fi
CUR_SLOT=$(label "$LIVE" gully.slot)
if [ "$MODE" = edge ] && [ -z "$CUR_SLOT" ]; then CUR_SLOT=$(state_get SLOT); fi
NEW_SLOT=$(other_slot "${CUR_SLOT:-b}")
log "mode=$MODE live-slot=${CUR_SLOT:-none} new-slot=$NEW_SLOT image=$IMAGE"

# 1. Build first; the live site is untouched while this runs.
if [ "$BUILD" = 1 ]; then
  log "building $IMAGE"
  GULLY_WEB_TAG=$TAG dk compose --profile legacy build web || die "build failed; nothing changed"
else
  [ "$DRY" = 1 ] || docker image inspect "$IMAGE" >/dev/null 2>&1 || die "$IMAGE is not on this box"
fi

# 2. Start it beside the live one, on no host port.
if exists "$NEXT"; then log "removing a leftover $NEXT"; dk rm -f "$NEXT" >/dev/null; fi
write_env
run_next "$NEW_SLOT" "$IMAGE" || { abort_next; die "could not start $NEXT"; }

# 3. Health.
log "waiting for $NEXT to answer"
wait_healthy "$NEXT" || { abort_next; die "$NEXT did not become healthy in ${HEALTH_TIMEOUT}s"; }
log "$NEXT is healthy"

# 4. Switch.
write_edge_cfg "$NEW_SLOT"
ensure_edge_image
edge_check_cfg
case $MODE in
  edge)
    running "$EDGE" || dk start "$EDGE" >/dev/null
    edge_reload
    if ! edge_ok; then
      log "the edge cannot reach the new slot; switching back"
      if [ -n "$CUR_SLOT" ]; then write_edge_cfg "$CUR_SLOT"; edge_reload; fi
      abort_next
      die "switch failed"
    fi
    promote_next
    log "traffic is on slot $NEW_SLOT; draining the old container for ${DRAIN}s"
    [ "$DRY" = 1 ] || sleep "$DRAIN"
    if exists "$LIVE"; then dk stop -t 10 "$LIVE" >/dev/null; dk rm "$LIVE" >/dev/null; fi
    ;;
  legacy | fresh)
    # One-time move from compose's gully-web (which owns the host ports) to the edge. The edge is created
    # beforehand, so the gap is only "stop old" + "start edge": about 1 to 2 seconds.
    edge_create
    t0=$(date +%s%N)
    if [ "$MODE" = legacy ]; then dk stop -t 10 "$LIVE" >/dev/null; fi
    if ! dk start "$EDGE" >/dev/null || ! edge_ok; then
      log "the edge did not come up; restoring the old container"
      dk rm -f "$EDGE" >/dev/null || true
      if [ "$MODE" = legacy ]; then dk start "$LIVE" >/dev/null; fi
      abort_next
      die "migration failed; the old setup is back"
    fi
    promote_next
    log "edge is serving; port gap was about $(( ($(date +%s%N) - t0) / 1000000 )) ms"
    if [ "$MODE" = legacy ]; then dk rm "$LIVE" >/dev/null; fi
    ;;
esac

# 5. The new container takes the stable name. Its slot alias, and so the edge, are unaffected by a rename.
dk rename "$NEXT" "$LIVE"
dk tag "$IMAGE" "$REPO:latest"
if [ "$ACTION" = rollback ]; then state_write "$NEW_SLOT" "$TAG" ""; else state_write "$NEW_SLOT" "$TAG" "$PREV_TAG"; fi
[ "$DRY" = 1 ] || printf '%s\n' "$TAG" > "$ROOT/DEPLOYED_SHA"
prune_images "$KEEP_IMAGES" "$TAG" "$PREV_TAG"
log "deployed $IMAGE as $LIVE on slot $NEW_SLOT"
