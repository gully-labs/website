# Deploying gully-web without downtime

`ops/deploy.sh` replaces `docker compose up -d --build web`. That command built the image and then recreated
`gully-web` in place. While the old container was stopped and the new one was starting, nothing listened on
port 2053, so Cloudflare showed visitors its **521** page (the audit saw this three times in 10 minutes).

## How it works

```
Cloudflare ──► 0.0.0.0:2053 ──┐
local checks ► 127.0.0.1:8099 ┴► gully-edge (HAProxy, TCP) ──► gully-web-slot-a  or  gully-web-slot-b
```

- **`gully-edge`** is a small HAProxy container (`haproxy:3.0-alpine`, 64 MB cap) that owns both host ports
  and is never restarted by a deploy. It forwards plain TCP:
  - public `2053` goes to the web container's `8443`;
  - local `8099` goes to `8080`.

  `gully-web` still terminates TLS itself, sniffing TLS from HTTP on one port, so the Cloudflare Origin Rule,
  the origin certificate in `certs/` and the `CF-Connecting-IP` header work exactly as before.
- **Web containers have no host port.** Each joins `gully_default` with a slot alias, `gully-web-slot-a` or
  `gully-web-slot-b`. The edge's config (`~/gully-web/.edge/haproxy/haproxy.cfg`, written by the script)
  points at one slot.
- **A deploy runs these steps:**
  1. Build `gully-web:<sha>` (`docker compose --profile legacy build web`, with the same build args as
     before). The live site is untouched while this runs. A failed build stops here.
  2. Start the new image as `gully-web-next` on the free slot, with the same `.env`, the `gully-web-data`
     volume, `./certs` and the same network as the live one.
  3. Wait up to 120 s until it answers `/healthz` on 8080 and 8443 and serves the app shell on `/`.
     - If it doesn't, the script prints its last 40 log lines, removes it and exits.
     - **The old container never stopped serving.**
  4. Point the edge at the new slot and send HAProxy `SIGHUP`, which is a graceful reload:
     - new connections go to the new container;
     - open connections finish on the old one.
  5. Check `/healthz` through the edge (`127.0.0.1:8099`).
     - If that fails, the edge is pointed back at the old slot, the new container is removed and the script
       exits.
  6. Drain for 10 s, then stop and remove the old container.
  7. Rename `gully-web-next` to `gully-web`. The live container is always called `gully-web`. A rename does
     not change the slot alias, so the edge is unaffected.
  8. Tag the image `gully-web:latest`, record the state in `.edge/state`, write `DEPLOYED_SHA`, and delete
     `gully-web` image tags beyond the newest 3. The current and the previous tags are always kept.
- **Downtime:** none. At every moment one healthy container is behind the edge.
- **Overlap:** the two containers run side by side for the start-up and health window plus the drain, about
  15 to 30 s (see Caveats).

## The owner's deploy command

From the repo on your machine, upload the commit exactly as before, then run the script on the box. These
commands do not delete `.edge/`, `.env`, `certs/` or `DEPLOYED_SHA`.

```sh
SHA=$(git rev-parse --short HEAD)
ssh ubuntu@40.160.136.124 'cd ~/gully-web && rm -rf src public server api compare scripts'
git archive --format=tar.gz HEAD | ssh ubuntu@40.160.136.124 'tar -xzf - -C ~/gully-web'
ssh ubuntu@40.160.136.124 "cd ~/gully-web && bash ops/deploy.sh --sha $SHA"
```

Then check that the commit is really live. A healthy container is not a deployed commit (see CLAUDE.md):

```sh
ssh ubuntu@40.160.136.124 'cat ~/gully-web/DEPLOYED_SHA; cd ~/gully-web && bash ops/deploy.sh --status'
curl -s https://gullylabs.xyz/ | grep -o '/assets/index-[^"]*\.js' | head -1   # then grep that bundle for a string the commit added
```

- **Rehearse first** (prints every docker command that would change something; runs only read-only
  `inspect`/`ls` queries): `bash ops/deploy.sh --dry-run --sha $SHA`
- **Status:** `bash ops/deploy.sh --status`

### Options and environment

| Flag / variable | Default | Meaning |
|---|---|---|
| `--sha <sha>` | `UPLOADED_SHA` file, else `t<UTC timestamp>` | Image tag `gully-web:<sha>` and the value written to `DEPLOYED_SHA`. |
| `--dry-run` | off | Print the changing docker commands instead of running them. |
| `--no-build --tag <tag>` | | Deploy an image already on the box. |
| `--rollback` | | Deploy the previous image (`PREV_TAG` in `.edge/state`) through the same no-gap flow. |
| `--status` | | Show the recorded state and the gully-web/gully-edge containers. |
| `GULLY_PUBLIC_PORT` | `2053` | Host port Cloudflare connects to (owned by gully-edge). |
| `GULLY_WEB_PORT` | `8099` | Local check port on 127.0.0.1 (owned by gully-edge). |
| `GULLY_HEALTH_TIMEOUT` | `120` | Seconds to wait for the new container. |
| `GULLY_DRAIN_SECONDS` | `10` | How long open connections may stay on the old container after the switch. This is also HAProxy's `hard-stop-after`. |
| `GULLY_KEEP_IMAGES` | `3` | `gully-web:*` tags kept (plus the current and previous). |
| `GULLY_EDGE_IMAGE` | `haproxy:3.0-alpine` | Pin it to a digest (`haproxy:3.0-alpine@sha256:…`) for fully reproducible deploys. |
| `GULLY_STATE_DIR` | `~/gully-web/.edge` | Edge config, state, lock and the normalised env file. |

The script never prints `.env`. Docker's `--env-file` does not strip quotes or inline comments the way
compose does, so the script writes a normalised copy to `.edge/web.env` (mode 600). Compose-style
`${VAR}` interpolation inside `.env` values is not supported there. Nothing uses it today.

## Rollback

- **Automatic:**
  - a new container that fails its health check, or a switch the edge can't verify, leaves the old container
    serving;
  - a failed one-time migration restarts the old compose container.
- **Manual, to the previous release:** `cd ~/gully-web && bash ops/deploy.sh --rollback`. This also has no
  gap.
- **To any image still on the box:** `bash ops/deploy.sh --no-build --tag <sha>`. List the tags with
  `docker image ls gully-web`.
- **Emergency return to the old one-container setup** (only if the edge itself misbehaves):

  ```sh
  docker rm -f gully-edge gully-web
  docker compose --profile legacy up -d web
  ```

  This leaves a few seconds with no listener on 2053.

## The one-time migration (first run)

On the first run the script finds compose's `gully-web` owning ports 2053 and 8099 and no `gully-edge`. It
then does these steps:

1. Builds the image and starts `gully-web-next` on slot `a` with no host port, then health-checks it. The old
   container keeps serving the whole time.
2. Writes and validates the edge config, pulls HAProxy, and **creates** `gully-edge` without starting it.
3. Stops the old `gully-web`, which frees the ports, then starts `gully-edge` straight away.
4. Checks through the edge.
   - If this fails, the edge is removed and the old `gully-web` is started again.
5. Removes the old container and renames `gully-web-next` to `gully-web`.

**Expected gap:** only step 3, the time between the old process releasing the ports and HAProxy binding them.
Node exits on SIGTERM at once, so this is about **1 to 2 seconds**, and the script prints the measured
figure. Requests landing in that window may see a 521. Every later deploy has no gap. Run the migration at a
quiet hour.

After the migration:

- `docker compose up -d` (for the blog, analytics or backups) no longer touches the site. The `web` service is
  in the `legacy` profile.
- **Don't run `docker compose up -d --build web` any more.** It would fail on the name `gully-web` and the
  ports, which are now in use.

## Safety on the shared box

- Every changing docker command goes through `dk()`, and every container, image, network and volume name
  through `guard()`. Anything not named `gully-*` (or `gully_default`) stops the script before docker runs.
- The only foreign image is HAProxy, and it runs as `gully-edge`.
- Nothing is pruned globally. Old images are removed one tag at a time, only from the `gully-web`
  repository, and never with `-f`.
- A lock (`.edge/deploy.lock`, via `flock`) stops two deploys from overlapping.

## When the origin is down: Cloudflare's error page

Nothing on the box can replace Cloudflare's own 521/522/502 page: when our origin is unreachable, Cloudflare
answers without us. `ops/maintenance.html` is a self-contained branded page (no external files, reloads
itself every 30 s, 44 px links). In the Cloudflare dashboard, the owner can choose one of these:

1. **Custom Error Pages (Pro plan and up).** Go to *gullylabs.xyz → Error Pages* (older dashboards:
   *Custom Pages*) and set the **5XX errors** page.
   - The legacy flow takes a URL that Cloudflare fetches once and stores. The page must contain
     `::CLOUDFLARE_ERROR_500S_BOX::`, which `maintenance.html` already has.
   - It is published at `https://gullylabs.xyz/maintenance.html` (a copy in `public/`; keep the two in step), so
     give Cloudflare that URL when uploading.
   - The newer **Custom Errors** rules can upload the HTML as an asset directly. Remove the `::…::` line for
     that.
2. **Free plan:**
   - 5XX pages can't be customised there.
   - Options:
     - a small **Worker** on `gullylabs.xyz/*` and the subdomains. It does `fetch(request)` and returns the
       maintenance HTML (status 503, `Retry-After: 30`) when the response is 52x or the fetch throws. Workers'
       free tier has a daily request cap, so check it against the traffic, or route the Worker only to
       HTML paths.
     - **Always Online** (*Caching → Configuration*) serves a cached copy of popular pages while the origin
       is down. It's free, but the copies can be stale and API calls still fail.

With the edge in place, the origin should only be down if the box or Docker is down, or if a container
crashes between deploys. HAProxy then has no healthy server and Cloudflare reports a 502/521.

## Caveats

- **Two containers share `gully-web-data` during the overlap.**
  - **Lost writes:** each process keeps its JSON stores in memory and rewrites whole files (atomic rename),
    so the last writer wins. A change written by the old container after the new one loaded the files, such
    as a key created or a session started in those seconds, can be lost when the new one next saves that
    file.
  - **Background loops do not run twice:** the new container starts with `GULLY_STANDBY=1`, so it answers
    requests (health checks) but runs no tracker poll, DeepCore poll, alert evaluation or Telegram webhook
    registration. Right after the switch the script sends it `SIGUSR2` (`promote_next`), which starts them;
    `server/server.mjs` records the promotion in `/data/.promoted-<container id>`, so a later restart of
    that container starts its loops at once. The old container keeps its loops only for the drain (10 s).
    If promotion fails the script says so; `docker kill -s USR2 gully-web` then starts the loops (a plain restart would not: the container keeps `GULLY_STANDBY=1` until promoted once).
  - **Usage counters:** the old one flushes its last-minute usage counters when stopped.
  - **What limits lost writes:** keeping the overlap short (health window plus a 10 s drain). The stores
    are not reloaded on promotion, so a write by the old container in that window can still be lost.
- **In-memory state resets on each deploy:** rate-limit windows, nonces and pending SSO codes. Sessions are
  on disk and survive.
- **Long requests:**
  - a connection still open on the old container after the drain (10 s) is cut, for example a long Gully AI
    stream;
  - raise `GULLY_DRAIN_SECONDS` if that matters.
- **No compose for the live container:** `run_next()` in `ops/deploy.sh` repeats the web service's
  environment, volumes and network. Change both together; `compose.yaml` says so.
- **Untested against real Docker:** the script was checked with `bash -n`, `shellcheck` (clean) and dry runs
  against a fake `docker` (legacy, edge and fresh modes, rollback, and the guard refusing a foreign network
  and a bad tag). It has not run against real Docker. Run `--dry-run` on the box first, then the migration
  at a quiet hour.
