# Gully Devnet (light): a local Arbitrum Nitro dev node

**Status: prepared, not started.** Nothing in this folder has been pulled or run on the box. It is the first,
smallest step towards the "Gully Devnet" the site already announces (see [Related specs](#related-specs-in-this-repo)):
one Nitro node in `--dev` mode, the setup OffchainLabs ships as
[nitro-devnode](https://github.com/OffchainLabs/nitro-devnode).

| | |
|---|---|
| Container | `gully-devnet` (compose project `gully-devnet`, network `gully-devnet`) |
| Image | `offchainlabs/nitro-node:v3.11.5-7d41882`, pinned by digest `sha256:339fa56f…dea9c27` (released 2026-10-02) |
| RPC / WS | `http://127.0.0.1:8547`, `ws://127.0.0.1:8548`, loopback only |
| Chain | Nitro `--dev`: chain id **412346**, one sequencer, an in-memory parent chain, blocks on demand |
| Limits | `mem_limit: 2g` (no swap), `cpus: 2`, `pids_limit: 512`, logs `json-file` 3 × 10 MB |
| Restart | `restart: "no"`: it never comes back by itself after a reboot |
| State | Ephemeral: a restart starts a fresh chain (see [Keeping state](#keeping-state)) |

Files:

- [`compose.yaml`](compose.yaml): the service.
- [`preflight.sh`](preflight.sh): the checks, and the only supported way to start it.

## Disk and RAM

These numbers come from the Docker Hub API (`/v2/repositories/offchainlabs/nitro-node/tags/v3.11.5-7d41882`,
read 2026-10-17). The image was not pulled.

| Image tag (v3.11.5-7d41882) | amd64, compressed | arm64, compressed |
|---|---|---|
| full (pinned) | **1.41 GB** | 1.36 GB |
| `-stripped` | 0.71 GB | 0.69 GB |
| `-slim` | 0.47 GB | 0.46 GB |
| `-slim-stripped` | 0.26 GB | 0.26 GB |

- **Image on disk.** The registry reports compressed layer sizes. Unpacked, an image usually takes 2 to 3
  times that, so budget about **4 GB** for the full tag. Measure it after the first pull with
  `docker image inspect -f '{{.Size}}' offchainlabs/nitro-node:v3.11.5-7d41882`.
  - The `-slim` tags drop the validator and JIT machinery. `--dev` should not need them, but this is untested
    here; try them first on a laptop, never on the shared box.
- **Chain data.** Nothing persists by default. The container's writable layer and logs stay well under 1 GB
  (logs are capped at 30 MB).
- **RAM.** An idle dev node uses a few hundred MB. The cap is 2 GB, and `preflight.sh` asks for 3 GB available
  before starting.
- **Why the 15 GB floor.** About 4 GB is the image, about 1 GB is the node, and the rest is headroom: the box
  is shared, and a full disk once killed other projects' databases.
  - `preflight.sh` refuses to start below 15 GB free on Docker's data filesystem.
  - The floor cannot be lowered below 15 GB.
  - **On 2026-10-17 the box had 5.8 GB free (98% used) and about 5.3 GB of RAM available**, so preflight
    would refuse today.
  - Free space is the owner's call. Never prune other projects' images, volumes or build cache to make room.

## Start and stop (on the box, from `~/gully-web`)

```sh
bash ops/devnet/preflight.sh            # read-only checks: disk >= 15 GB, RAM, ports 8547/8548, name, image
bash ops/devnet/preflight.sh --start    # same checks, then docker compose up -d, then waits for eth_chainId

# check it
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://127.0.0.1:8547
docker logs --tail 50 gully-devnet

# stop it and remove its container and network (the image stays)
docker compose -f ops/devnet/compose.yaml down

# give the image's disk back too (ours only, by exact tag, never a prune)
docker image rm offchainlabs/nitro-node:v3.11.5-7d41882
```

Every command above acts only on `gully-devnet`, its network, or its exact image tag.

### Stylus setup (optional)

nitro-devnode's `run-dev-node.sh` (pinned commit
[`ebb523d`](https://github.com/OffchainLabs/nitro-devnode/blob/ebb523d4ed9c04d4183743af844a038e9843f352/run-dev-node.sh))
runs `cast` steps after the node starts:

1. becomes chain owner;
2. sets the L1 price per unit to 0;
3. deploys the CREATE2 factory;
4. deploys and registers the Stylus Cache Manager;
5. deploys `StylusDeployer`.

Do this from a laptop with Foundry, not on the box, through a tunnel:

```sh
ssh -N -L 8547:127.0.0.1:8547 ubuntu@40.160.136.124 &
git clone https://github.com/OffchainLabs/nitro-devnode && cd nitro-devnode && git checkout ebb523d
# run the script's steps from "Make the caller a chain owner" onwards against http://127.0.0.1:8547
```

The pre-funded dev account is public: `0x3f1Eae7D46d88F08fc2F8ed27FCb2AB183EB2d0E`. Its key is published in
the nitro-devnode README. **Never** expose this RPC publicly with that key funded, and never reuse the key
anywhere else.

### Keeping state

`--dev` is a throwaway chain. To keep it across restarts, add a named volume (`gully-devnet-data:/home/user/.arbitrum`)
and `--persistent.chain=/home/user/.arbitrum/dev`. Then size the disk for growth (`docker system df -v`).

## How the explorer and faucet would hook in

Neither is set up here. They are the next steps, and each needs its own disk check first.

- **Explorer (Chain Kit).**
  - Chain Kit is our branded Blockscout: the fork at `gully-labs/blockscout`, branch `gully/chain-kit/gully`,
    checked out locally as `PROJECTS/gully-blockscout`.
  - It would join the `gully-devnet` network, set as `external: true` in its own compose file, and index
    `http://gully-devnet:8547` with:
    - `CHAIN_ID=412346`
    - `CHAIN_TYPE=arbitrum`
    - `ETHEREUM_JSONRPC_VARIANT=geth`
    - `ETHEREUM_JSONRPC_TRACE_URL` pointing at the same URL (the node exposes the `debug` API)
  - Blockscout needs Postgres, the backend, the frontend and usually Redis. Expect several GB of images and
    1 to 2 GB of RAM, so plan it as its own `gully-devnet-explorer` project with its own limits.
  - It would be served through gully-web on a host such as `explorer.devnet.gullylabs.xyz`, the same way the
    blog and analytics are forwarded (`server/blog.mjs`, `server/analytics.mjs`), never on a public host port.
- **Faucet.**
  - On `--dev` the dev account holds the funds. A faucet is a small endpoint that sends a fixed amount from a
    separate faucet key, which the dev account funds once.
  - It should be rate-limited per address and IP, with the key in `.env` only.
  - The natural home is a gully-web route (for example `POST /api/devnet/faucet`) that calls
    `http://gully-devnet:8547`. For that, gully-web would join the `gully-devnet` network, which is a change to
    `ops/deploy.sh`'s `docker run` and needs the owner's sign-off.
  - The waitlist the site already collects (`/api/notify`, slot 90; see `src/pages/developers/Products.tsx`)
    is the first audience.
- **Bridge.** Not applicable to `--dev`, whose parent chain is simulated. A bridge belongs to the real Gully
  Devnet: an Orbit L3 on Arbitrum Sepolia, deployed with the forks below.

## Related specs in this repo

The repo has no standalone devnet or L3 spec document. A grep for "devnet", "L3" and "Orbit" over `src/`,
`server/`, `ops/` and the README finds only what the site says about it:

- [`src/components/landing/ProductConsole.tsx`](../../src/components/landing/ProductConsole.tsx), the Gully Chains
  roadmap:
  - "Gully Devnet (NEXT): a public test L3 on Arbitrum Sepolia, with a Chain Kit explorer, a faucet and a bridge"
  - then client chains (managed Orbit L3s settling to Arbitrum One)
  - then our own L3
- [`src/docs/pages/Changelog.tsx`](../../src/docs/pages/Changelog.tsx): "A preview of Gully Chains, managed Arbitrum
  Orbit L3s, starting with Gully Devnet. In development; nothing is live yet."
- [`src/pages/developers/Products.tsx`](../../src/pages/developers/Products.tsx): the Devnet waitlist.
- [`server/ask-remote.mjs`](../../server/ask-remote.mjs): the Orbit and Stylus forks in the gully-labs org that
  Gully AI indexes:
  - `arbitrum-orbit-deployment-ui`
  - `orbit-setup-script`
  - `orbit-monitoring-tools`
  - `arbitrum-token-bridge`
  - `arbitrum-token-lists`
  - `stylus-sdk-rs`
  - `stylus-hello-world`
- [`src/components/demos/ChainKitDemo.tsx`](../../src/components/demos/ChainKitDemo.tsx) and `/chain-kit`: the explorer
  the devnet would use.

This light devnet is the local step before that public Orbit L3. It is useful now for testing Chain Kit's
Arbitrum profile, Stylus contracts and the Gully Pay flows against a chain we control.
