# Gully Hyperlane agents: a validator and a relayer, prepared

**Status: prepared, not started.** Nothing in this folder has been pulled or run anywhere. It is the Hyperlane half
of the [Gully L3 spec](../SPEC.md) (§9), sized for the **light devnet** in [`ops/devnet`](../../devnet/README.md)
first, and for the public chain later with two edits (the chain's RPC and the removal of the devnet network).

| | |
|---|---|
| Containers | `gully-hyperlane-validator`, `gully-hyperlane-relayer` (compose project `gully-hyperlane`) |
| Image | `ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0` pinned by index digest `sha256:6414aecf…e0a685` (amd64 manifest `sha256:be933b65…5ada`, **220 MB** compressed, released 2026-07-22) |
| Networks | own `gully-hyperlane`, plus `gully-devnet` (external, the devnet's) to reach `http://gully-devnet:8547` |
| Volumes | `gully-hyperlane-validator-db`, `gully-hyperlane-relayer-db`, `gully-hyperlane-signatures` (validator writes, relayer reads) |
| Ports | metrics only, loopback: `127.0.0.1:9090` (validator), `127.0.0.1:9091` (relayer) |
| Limits | `mem_limit: 1g` each (no swap), `cpus: 1`, `pids_limit: 256`, logs `json-file` 3 × 10 MB, `restart: "no"` |
| Config | [`agent-config.json`](agent-config.json) (template: devnet `gullydevnet` 412346 with `0xFILL` addresses, and `arbitrumsepolia` 421614 from the Hyperlane registry), [`.env.example`](.env.example) (keys, no values) |
| Start | only through [`preflight.sh`](preflight.sh) `--start` |

Why ghcr.io and not `gcr.io/abacus-labs-dev/hyperlane-agent`: the Hyperlane docs' validator and relayer pages
pull `ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0` (read 2026-10-17). The gcr.io path still exists but
its newest agents tag is `agents-v2.0.0` (index digest `sha256:e953983fee85fd01432f9e6a40e192cafc2c39db4a180aac34e55f8f624c964a`,
gcr.io tags API, same day). If the owner prefers the gcr.io path, change the `image:` line in
[`compose.yaml`](compose.yaml) to that tag and digest; the flags are the same.

## Sources, pinned

- Hyperlane CLI `@hyperlane-xyz/cli` **45.0.1**, registry **26.1.0** (npm `latest`, 2026-10-17); Node 18+.
- Guides read 2026-10-17: [deploy to a new chain](https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane),
  [deploy with local agents](https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane-with-local-agents),
  [run validators](https://docs.hyperlane.xyz/docs/operate/validators/run-validators),
  [run a relayer](https://docs.hyperlane.xyz/docs/operate/relayer/run-relayer),
  [agent configuration](https://docs.hyperlane.xyz/docs/operate/config/agent-config),
  [configuration reference](https://docs.hyperlane.xyz/docs/operate/config/config-reference),
  [Warp Route quickstart](https://docs.hyperlane.xyz/docs/guides/quickstart/deploy-warp-route).
- Arbitrum Sepolia Hyperlane addresses: `hyperlane-registry` `chains/arbitrumsepolia/addresses.yaml`
  (Mailbox `0x598facE78a4302f11E3de0bee1894Da0b2Cb71F8`, IGP `0xc756cFc1b7d0d4646589EDf10eD54b201237F5e8`,
  ValidatorAnnounce `0x1b33611fCc073aB0737011d5512EF673Bff74962`, MerkleTreeHook `0xAD34A66Bf6dB18E858F6B686557075568c6E031C`,
  index from block 49690504).

## Keys needed

Four keys, all generated fresh (`cast wallet new`), none reused from anything else, none committed:

| Key | Used by | Funded where | Where it goes |
|---|---|---|---|
| **Deployer** | `hyperlane core deploy`, `hyperlane warp deploy`, `hyperlane send message` | gas on the devnet **and** on Arbitrum Sepolia (the guide: "funded on your custom chain and any chain you will be passing messages to & from") | `HYP_KEY` in the shell that runs the CLI, on a laptop, never on the box |
| **Validator signing key** | validator, signs Mailbox checkpoints | never | `HYP_VALIDATOR_KEY` in `.env`; its **address** goes into the multisig ISM later |
| **Validator transaction signer** | validator, the one-time `ValidatorAnnounce` transaction | "a small amount" of gas on the **origin** chain (the devnet) | `HYP_CHAINS_GULLYDEVNET_SIGNER_KEY` in `.env` |
| **Relayer key** | relayer, `Mailbox.process()` on every destination | gas on **every** chain in `HYPERLANE_RELAY_CHAINS`: devnet ETH and Arbitrum Sepolia ETH | `HYP_DEFAULTSIGNER_KEY` in `.env` |

Funding on the devnet: the pre-funded dev account (`0x3f1Eae7D46d88F08fc2F8ed27FCb2AB183EB2d0E`, key published in
the nitro-devnode README) sends ETH to the deployer, the transaction signer and the relayer. Its key is public:
never fund it anywhere else and never expose the devnet RPC. Funding on Arbitrum Sepolia: any Arbitrum Sepolia
faucet (Sepolia ETH bridged, or a provider faucet); the deployer needs enough for the Warp Route contracts.

## Run it against the devnet locally first

All of this on a **laptop with Docker and Node 18+**, not on the shared box. The box runs nothing until the owner
has room for it (97 % disk on 2026-10-17; `preflight.sh` refuses under 15 GB free).

### 1. Start the devnet and install the CLI

```sh
bash ops/devnet/preflight.sh --start          # chain id 412346 on http://127.0.0.1:8547
npm install -g @hyperlane-xyz/cli@45.0.1
hyperlane --version
```

### 2. Register the devnet chain in a local registry

`hyperlane registry init` is interactive; answer with these values (they match `agent-config.json`). It writes
`~/.hyperlane/chains/gullydevnet/metadata.yaml`.

```yaml
name: gullydevnet
displayName: Gully Devnet (light)
chainId: 412346
domainId: 412346
protocol: ethereum
technicalStack: arbitrumnitro
isTestnet: true
rpcUrls:
  - http: http://127.0.0.1:8547        # from the laptop; the agents in Docker use http://gully-devnet:8547
nativeToken: { name: Ether, symbol: ETH, decimals: 18 }
blocks: { confirmations: 1, estimateBlockTime: 0.25, reorgPeriod: 0 }
```

`arbitrumsepolia` is already in the canonical registry (`hyperlane registry list`).

### 3. Deploy Hyperlane core to the devnet

```sh
export HYP_KEY='<deployer key>'               # funded on the devnet by the dev account
hyperlane core init                           # writes ./configs/core-config.yaml (see core-config.example.yaml)
hyperlane core deploy                         # pick gullydevnet; a few minutes; writes ~/.hyperlane/chains/gullydevnet/addresses.yaml
```

For the devnet the generated `defaultIsm` is a `trustedRelayerIsm` whose `relayer` must be the **address of the
relayer key**. Then fill the template:

```sh
hyperlane registry agent-config --chains gullydevnet arbitrumsepolia --registry ~/.hyperlane
# writes ./configs/agent-config.json: replace ops/l3/hyperlane/agent-config.json with it, after changing the
# gullydevnet rpc to http://gully-devnet:8547 (the agents run inside Docker on the devnet's network).
```

Or copy the seven `0xFILL_*` addresses from `addresses.yaml` by hand. `preflight.sh` refuses while any `0xFILL`
remains.

### 4. Keys and start the agents

```sh
cp ops/l3/hyperlane/.env.example ops/l3/hyperlane/.env && chmod 600 ops/l3/hyperlane/.env
# fill HYP_VALIDATOR_KEY, HYP_CHAINS_GULLYDEVNET_SIGNER_KEY, HYP_DEFAULTSIGNER_KEY; fund the last two
bash ops/l3/hyperlane/preflight.sh            # read-only: .env, config, disk, RAM, ports, names, devnet network, image
bash ops/l3/hyperlane/preflight.sh --start    # docker compose up -d, then waits for both /metrics
docker logs --tail 50 gully-hyperlane-validator   # expect the announce transaction, then checkpoints
docker logs --tail 50 gully-hyperlane-relayer
```

What the compose file runs is the local-agents guide's two commands:

```
./validator --db /hyperlane_db --originChainName gullydevnet \
  --checkpointSyncer.type localStorage --checkpointSyncer.path /tmp/validator-signatures   (+ --validator.key from env)
./relayer   --db /hyperlane_db --relayChains gullydevnet,arbitrumsepolia \
  --allowLocalCheckpointSyncers true                                                        (+ --defaultSigner.key from env)
```

### 5. Send a message both ways

```sh
hyperlane send message --origin gullydevnet --destination arbitrumsepolia      # relayed by our relayer
hyperlane send message --origin arbitrumsepolia --destination gullydevnet
```

The second direction is verified on the devnet by the `trustedRelayerIsm` (our relayer), the first on Arbitrum
Sepolia by… nothing yet: Arbitrum Sepolia's default ISM does not know our validator. The CLI's `--relay` flag
delivers test messages itself; for the real path, set a `messageIdMultisigIsm` for origin `gullydevnet` on the
test recipient with our validator's address and threshold 1. This is the step that proves the validator set
([spec §9.3](../SPEC.md#93-interchain-security-the-validator-set)).

### 6. A test Warp Route

```sh
# a throwaway ERC-20 on Arbitrum Sepolia first (forge create / any faucet token you own)
hyperlane warp init          # arbitrumsepolia: collateral <token>; gullydevnet: synthetic  (see warp-route-deployment.example.yaml)
hyperlane warp deploy        # HYP_KEY funded on both chains
hyperlane warp send --relay -w <SYMBOL>/arbitrumsepolia-gullydevnet   # default amount: 1 smallest unit
```

Artifacts land in `~/.hyperlane/deployments/warp_routes/<SYMBOL>/`; `hyperlane warp apply` after edits.

### 7. Stop

```sh
docker compose -f ops/l3/hyperlane/compose.yaml down        # the two containers, the network, keeps the volumes
docker volume rm gully-hyperlane-validator-db gully-hyperlane-relayer-db gully-hyperlane-signatures   # ours only
docker image rm ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0                                 # exact tag, never a prune
```

Every command above acts only on `gully-hyperlane-*`, its network and volumes, or its exact image tag. The devnet
is stopped with its own compose file.

## From the devnet to the public chain

1. `agent-config.json`: replace `gullydevnet` with the public chain (new name, its real chain id, `rpcUrls` to
   **our** node on the internal network; the validator docs require your own RPC), `index.from` = the Mailbox
   deployment block.
2. `compose.yaml`: delete the `devnet` network and the two `- devnet` entries; set `HYPERLANE_ORIGIN_CHAIN` and
   `HYPERLANE_RELAY_CHAINS` (`<chain>,arbitrum` on mainnet).
3. Checkpoints: `--checkpointSyncer.type s3` with `bucket`, `region`, `folder` instead of `localStorage`, and
   `--allowLocalCheckpointSyncers false` on the relayer (docs: local syncers are for testing).
4. Keys: validator and relayer keys in a KMS (`--validator.type aws`, `--defaultSigner.type aws`), not hex in
   `.env` (docs: a compromised validator key "can lead to slashing").
5. Gas: drop `HYP_GASPAYMENTENFORCEMENT=[{"type":"none"}]` so the relayer only delivers paid messages, and keep
   the `StorageGasOracle` on the L3 current.
6. Registry PR (`hyperlane-xyz/hyperlane-registry`) with `metadata.yaml`, `addresses.yaml`, `logo.svg`,
   `deployer`, `isTestnet` right, so the Hyperlane explorer and other relayers see the chain.
7. Monitoring: scrape `:9090` and `:9091` into the same Prometheus the Orbit monitoring tools use.
