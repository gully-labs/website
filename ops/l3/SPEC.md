# Gully L3: one spec

**Status (2026-10-17): spec. The light devnet in [`ops/devnet/`](../devnet/README.md) is prepared and not started; the
Hyperlane agents in [`hyperlane/`](hyperlane/README.md) are prepared and not started. Nothing in this document is
deployed.** Every version, address and price below was read from a primary source on 2026-10-17 and is marked
with it; re-check before acting, because factories, images and gas prices move.

This replaces the plan that was scattered over `ProductConsole.tsx` (the Gully Chains roadmap), `Changelog.tsx`,
`developers/Products.tsx` (the Devnet waitlist, `/api/notify` slot 90), `server/ask-remote.mjs` (the Orbit and
Stylus forks Gully AI indexes) and `ops/pitch/arbitrum.md` (milestone M3). Those keep saying what the site says
today; this is the engineering plan behind them.

## 0. Owner decisions this spec needs

| # | Decision | Options | Recommendation here | Why it cannot wait |
|---|---|---|---|---|
| D1 | **Settlement (parent) chain** of the production L3 | Arbitrum One; Base | **Arbitrum One**; devnet on Arbitrum Sepolia | It fixes the `RollupCreator`, the canonical bridge, which Hyperlane mailbox the Warp Routes anchor to, and which ecosystem programs count us ([§2](#2-settlement-chain-arbitrum-one-or-base)) |
| D2 | **Data availability mode** | Rollup; AnyTrust (DAC) | **Rollup** for the devnet and the launch; re-decide on measured batch costs | AnyTrust needs a committee of DA servers run from day one ([§4](#4-data-availability-rollup-or-anytrust)) |
| D3 | **Gas token** | ETH; a custom ERC-20 (18 decimals, on the parent chain) | **ETH** | A custom token changes the bridge, the fee pricer and every wallet's UX ([§5](#5-gas-token)) |
| D4 | Hyperlane security for messages **from** the L3 | our validators only (1 of 1, then 2 of 3); add external validators later | start 1 of 1 on the devnet, 2 of 3 of our own at launch, open the set when there is value to protect | Decides how many validator VPS we pay for ([§9.3](#93-interchain-security-the-validator-set)) |
| D5 | Interop layer | Hyperlane (owner decision, 2026-10-17) | Hyperlane core + Warp Routes, **only when the L3 launches**; LI.FI and Relay stay the swap/bridge aggregators for the chains Gully Pay offers today | Fixed; recorded here so nobody re-opens it |

The rest of this document assumes D1 = Arbitrum One, D2 = Rollup, D3 = ETH, and says where a different answer
changes things.

## 1. What the Gully L3 is

An **Arbitrum chain** (the stack formerly branded Orbit) run by Gully Labs: Nitro, settling to a parent chain,
with the Gully stack attached on day one:

- **Chain Kit** as the explorer: our Blockscout fork `gully-labs/blockscout`, branch `gully/chain-kit/gully`
  (locally `PROJECTS/gully-blockscout`), with the Arbitrum profile (`CHAIN_TYPE=arbitrum`,
  `ETHEREUM_JSONRPC_VARIANT=geth`, trace URL on the same node; see the devnet README).
- **Gully Pay native on the L3**: USDC and ETH on the L3 become payment assets in `server/payments.mjs`
  ([§10](#10-gully-pay-on-and-across-the-l3)).
- **Gully Analytics**, **gap alerts** and **Gully AI** read it like any other chain.
- **Hyperlane** as the interop layer: a Mailbox on the L3, Warp Routes for USDC and ETH from Arbitrum One
  (and Base) into the L3, our own validator and relayer ([§9](#9-interop-hyperlane)).

Three stages, matching the roadmap the site shows:

| Stage | Chain | Parent | Purpose |
|---|---|---|---|
| S0, now | **Gully Devnet (light)**: Nitro `--dev`, chain id **412346**, one container, in-memory parent | none (simulated) | Test Chain Kit, Stylus and Gully Pay flows locally; first target for the Hyperlane agents |
| S1, "Gully Devnet" (pitch milestone M3) | A public Arbitrum chain on **Arbitrum Sepolia** | Arbitrum Sepolia (421614) | Public RPC, Chain Kit explorer, faucet, canonical token bridge, Hyperlane to Arbitrum Sepolia |
| S2, "Gully L3" | The production chain | Arbitrum One (42161) under D1 | Gully venues, Gully Pay, Warp Routes for USDC/ETH, LI.FI/Relay listing |

The chain id for S1 and S2 is not chosen yet: 412346 is nitro-devnode's fixed dev id and must not be reused for a
public chain. Pick an unused id from chainlist before S1 and register it (ethereum-lists/chains PR) so wallets,
LI.FI and Relay recognise it.

## 2. Settlement chain: Arbitrum One or Base

Both are supported parents: the Arbitrum docs' canonical factory table lists a `RollupCreator` and a
`TokenBridgeCreator` on each (read 2026-10-17 from
[canonical factory contracts](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts);
the page warns "the canonical factory contracts get updated", so re-read before deploying):

| Parent | Chain id | `RollupCreator` | `TokenBridgeCreator` |
|---|---|---|---|
| Arbitrum One | 42161 | `0xB90e53fd945Cd28Ec4728cBfB566981dD571eB8b` | `0x2f5624dc8800dfA0A82AC03509Ef8bb8E7Ac000e` |
| Base | 8453 | `0xDbe3e840569a0446CDfEbc65D7d429c5Da5537b7` | `0x4C240987d6fE4fa8C7a0004986e3db563150CA55` |
| Arbitrum Sepolia (S1) | 421614 | `0x5F45675AC8DDF7d45713b2c7D191B287475C16cF` | `0x56C486D3786fA26cc61473C499A36Eb9CC1FbD8E` |

The trade-off:

| | Arbitrum One | Base |
|---|---|---|
| Ecosystem fit | Everything in `ops/pitch/arbitrum.md` (Builders form, ArbiFuel, Portal listing) counts an Arbitrum chain settling to Arbitrum. The tracker already covers Robinhood Chain, an Arbitrum chain. | An Arbitrum-stack chain on Base is unusual: no Base program targets it, and Arbitrum's programs may not count it. |
| Tooling | The forks we index (`arbitrum-orbit-deployment-ui`, `orbit-setup-script`, `orbit-monitoring-tools`, `arbitrum-token-bridge`) assume an Arbitrum parent. | Same contracts, but the bridge UI and monitoring assume Arbitrum parents; expect fixes. |
| Hyperlane | Mailbox `0x979Ca5202784112f4738403dBec5D0F3B9daabB9`, IGP `0x3b6044acd6767f017e99318AA6Ef93b7B06A5a22` (registry `chains/arbitrum/addresses.yaml`, 2026-10-17). | Mailbox `0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D`, IGP `0xc3F23848Ed2e04C0c6d41bd7804fa8f89F940B94` (`chains/base/addresses.yaml`). Either works; Warp Routes can anchor to both at once (multi-collateral). |
| Gully Pay today | Accepts Arbitrum One. | Accepts Base. |
| Parent gas, measured 2026-10-17 | base fee **0.02 gwei** (`eth_feeHistory` on `arb1.arbitrum.io/rpc`) | base fee **0.005 gwei** (`eth_feeHistory` on `mainnet.base.org`) |
| Users | Arbitrum DeFi | the larger retail/consumer base |

The parent's base fee is only part of what a batch costs: a batch posted to an L2 parent also pays that L2's own
L1 data component, which varies with Ethereum blob prices, so the measured spot numbers above do not decide it.
Measure a real batch on each testnet (Arbitrum Sepolia, Base Sepolia) before D1 is final.

**Recommendation: Arbitrum One** (D1). The pitch, the forks, the explorer profile and the tracker are all
Arbitrum-shaped; Base settlement would make the chain an outsider on both sides. Base liquidity still reaches the
L3 through a Base→L3 Warp Route and through LI.FI/Relay once they list the chain, so settling on Arbitrum One
does not lose Base users.

## 3. Sequencer, batch poster, validators (the Nitro side)

Deployed with the **Arbitrum chain SDK** through `RollupCreator` (core contracts) and then `TokenBridgeCreator`
(the canonical token bridge, which needs the inbox so it runs second; source: the
[SDK introduction](https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-chain-sdk-introduction), which also
says "It is highly recommended that you work with a Rollup-as-a-Service (RaaS) provider to deploy a production
chain"). We run S0 and S1 ourselves; the RaaS question is open for S2.

Roles, one Nitro binary each, with the official numbers where they exist:

| Role | What it does | Official sizing / cost (source) | Our note |
|---|---|---|---|
| **Sequencer** | Orders transactions, produces blocks, serves the feed | "approximately $600 per sequencer replica per month" for a low-to-medium activity chain; "with networking and storage included, the estimated monthly cost would be $1,500" ([Arbitrum chain FAQ](https://docs.arbitrum.io/launch-orbit-chain/troubleshooting-building-orbit)) | A single sequencer for S1. HA (two replicas, feed relay) only for S2. |
| **Batch poster** | Posts compressed batches (or DACerts) to the parent chain | No separate figure; usually co-located with the sequencer. Its on-chain spend is the DA cost in [§4](#4-data-availability-rollup-or-anytrust). | Needs a funded key on the parent chain, topped up by the fee collector. |
| **Validator (staker)** | Posts and defends assertions on the parent | Watchtower "approximately $500" per month; active validators "$800 to $900 per month"; about 163,109 gas per assertion, assumed hourly (same FAQ) | S1: one Watchtower plus one active validator we run. Bonds are a chain parameter we set; the FAQ's 3,600 ETH figure is Arbitrum One's, not ours. |
| **Full / RPC node** | Serves the public RPC and the explorer | Arbitrum docs' node minimum is "64 GB" RAM and an "8-core" CPU on NVMe ([Prepare to run a node](https://docs.arbitrum.io/run-arbitrum-node/start-here)), written for Arbitrum One | A new, empty chain needs a fraction of that; the dev node runs under 2 GB. Start small and watch. |
| **DAS** (AnyTrust only) | Stores batch data for the committee | No official sizing found | Only under D2 = AnyTrust. |

Sizing and the cost table are in [§11](#11-cost-table).

## 4. Data availability: Rollup or AnyTrust

From the Arbitrum docs ([choose AnyTrust](https://docs.arbitrum.io/launch-arbitrum-chain/features/common/data-availability/choose-anytrust)
and [Inside AnyTrust](https://docs.arbitrum.io/how-arbitrum-works/inside-anytrust), read 2026-10-17):

- **Rollup**: "Transaction data is posted to the parent chain as calldata or blobs", `DataAvailabilityCommittee: false`,
  "No additional steps are required." Security is the parent's.
- **AnyTrust**: a Data Availability Committee "which is a group of permissioned nodes that you choose and run, or
  outsource to a Rollup-as-a-Service (RaaS)". The batch poster posts a DACert "signed by the required number of
  DAC members (configurable)"; with N members the certificate needs N-1 signatures and the assumption is that
  "at least two are honest". If the sequencer cannot collect enough signatures "within a few minutes" it posts
  the full data to the parent chain instead (rollup fallback). Setup: "Deploy a Data Availability Server (DAS)
  for each DAC member", generate a BLS keyset, register it on `SequencerInbox`.

Costs:

- The Arbitrum docs give no figure for either mode; they say the parent-chain data posting is "the largest
  component of the cost of using Arbitrum". For an **L3 the parent is itself an L2**, whose calldata is already
  cheap (base fees of 0.005 to 0.02 gwei measured above, plus the L2's own L1 data component).
- AnyTrust adds machines: one DAS per committee member, around the clock, plus mirrors. A committee run entirely
  by us has N members but one operator, so it removes no trust; it only cuts DA fees.

**Recommendation: Rollup** (D2) for S1 and the launch. Measure the batch poster's monthly spend on Arbitrum
Sepolia during S1; switch to AnyTrust only if that spend, projected to S2 volume, exceeds the cost of running a
real committee (at least four DAS machines plus a second operator).

## 5. Gas token

Options and their rules (Arbitrum docs, [choose a custom gas token](https://docs.arbitrum.io/launch-arbitrum-chain/features/common/gas-and-fees/choose-custom-gas-token)
and the [custom gas token on AnyTrust](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-anytrust)
page, 2026-10-17):

- **ETH** (default): nothing to configure; wallets, LI.FI, Relay and Hyperlane's gas oracles all understand it;
  Gully Pay already prices ETH with the same-chain Chainlink feed.
- **Custom ERC-20**: "Must be a standard ERC-20 token", "Must not be rebasing or include transfer fees",
  transfers and approvals "must occur directly via the token contract, not via proxies or hooks", no transfer
  callbacks; 18 decimals (SDK guides). It must already exist on the parent chain and is "natively bridged" at
  deployment. In **Rollup mode** the batch poster is reimbursed in the fee token, so a **fee token pricer**
  contract supplying the ETH/token exchange rate must be deployed and registered on the parent; the docs' three
  examples are marked as not for production and "If the fee token pricer returns stale or manipulated prices, the batch poster
  may be under- or over-reimbursed." On AnyTrust the chain owner must also call `SetL1PricePerUnit(0)` and
  `SetL1PricingRewardRate(0)` or "Nitro will apply a parent chain's fee to all transactions".

**Recommendation: ETH** (D3). Gully has no token; a gas token would be a new product with its own risks (the
pricer, liquidity, listings). If the owner wants a Gully gas token later, it is a new chain parameter at
deployment time, not a switch.

## 6. Explorer: Chain Kit

- Chain Kit (our Blockscout fork) joins the chain's compose network and indexes the RPC with `CHAIN_ID`,
  `CHAIN_TYPE=arbitrum`, `ETHEREUM_JSONRPC_VARIANT=geth`, `ETHEREUM_JSONRPC_TRACE_URL` (the node exposes `debug`).
- Stack: Postgres, backend, frontend, Redis: "several GB of images and 1 to 2 GB of RAM" (devnet README), so its
  own compose project and disk check.
- Served through gully-web on `explorer.devnet.gullylabs.xyz` (S1) and `explorer.gullylabs.xyz` (S2) the way the
  blog is forwarded (`server/blog.mjs`), never on a public host port.
- Hyperlane messages are shown by Hyperlane's own explorer once the chain is in the registry; Chain Kit shows
  the Mailbox `Dispatch`/`Process` events like any contract.

## 7. Faucet (S1 only)

A gully-web route (`POST /api/devnet/faucet`) that sends a fixed amount of the L3's ETH from a faucet key held in
`.env`, rate-limited per address and IP, after the same Turnstile the contact form uses. The faucet key is funded
through the canonical bridge from Arbitrum Sepolia ETH (public faucets). The Devnet waitlist (`/api/notify`,
slot 90) is the first audience. On S0 (`--dev`) the pre-funded dev account funds the faucet key; its private key
is public (nitro-devnode README), so the S0 RPC is never exposed.

## 8. Public RPC

- S1/S2: `rpc.devnet.gullylabs.xyz` / `rpc.gullylabs.xyz`, forwarded by gully-web to the full node, with the
  `eth`, `net`, `web3` namespaces only and `debug` kept for Chain Kit on the internal network.
- Hyperlane's validator docs say "You must use your own RPC urls not any public ones": the agents read our node
  on the internal network, never the public host.
- Metadata for wallets: chain id, `ETH`, explorer URL, in `ethereum-lists/chains` and in the Hyperlane registry
  (`metadata.yaml`), both PRs at S1.

## 9. Interop: Hyperlane

Owner decision (2026-10-17): **Hyperlane is the interop layer for the Gully L3 when it launches, not before.**
Until then LI.FI and Relay stay the swap and bridge aggregators for the chains Gully Pay offers today (Base,
Ethereum, BNB Chain, Arbitrum One, plus Solana where the site offers it).

Versions pinned on 2026-10-17:

| Component | Version | Source |
|---|---|---|
| Hyperlane CLI | `@hyperlane-xyz/cli` **45.0.1** (bundles SDK 45.0.1, registry 26.1.0); Node 18+ | registry.npmjs.org `latest`; [CLI reference](https://docs.hyperlane.xyz/docs/reference/developer-tools/cli) |
| Hyperlane registry | `@hyperlane-xyz/registry` **26.1.0** | registry.npmjs.org |
| Agents (validator, relayer) | `ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0`, index digest `sha256:6414aecfdc1b6ea2e364019f672004c113c2a347dd4d1343aa856921d1e0a685`; amd64 manifest `sha256:be933b65413fd9a382f87728de7d31a38592d2a8ca2e4df645662a78131d5ada`, **220 MB compressed**, 6 layers; released 2026-07-22 | ghcr.io manifest API; [monorepo release](https://github.com/hyperlane-xyz/hyperlane-monorepo/releases/tag/agents-v2.3.0); the docs' [validator](https://docs.hyperlane.xyz/docs/operate/validators/run-validators) and [relayer](https://docs.hyperlane.xyz/docs/operate/relayer/run-relayer) pages pull this tag |
| Older image path | `gcr.io/abacus-labs-dev/hyperlane-agent` stops at `agents-v2.0.0` (index digest `sha256:e953983fee85fd01432f9e6a40e192cafc2c39db4a180aac34e55f8f624c964a`) | gcr.io tags API, 2026-10-17. The docs moved to ghcr.io, so the compose file pins ghcr.io. |

### 9.1 Core deployment on the L3

Per the [deploy guide](https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane): `hyperlane registry init`
(writes `~/.hyperlane/chains/<name>/metadata.yaml`), `hyperlane core init` (writes `./configs/core-config.yaml`),
`HYP_KEY=… hyperlane core deploy` (a few minutes; addresses land in the chain's `addresses.yaml`), then
`hyperlane send message --relay` to test. Exact steps, including the devnet run, are in
[`hyperlane/README.md`](hyperlane/README.md).

What `core deploy` puts on the L3:

| Contract | Role | Our setting |
|---|---|---|
| `Mailbox` | Dispatches and processes messages | one per chain |
| `defaultIsm` | Verifies inbound messages | S0: `trustedRelayerIsm` (the guide's default, for testing: it trusts our relayer). S1+: `messageIdMultisigIsm` per origin: for messages **from Arbitrum** the public Arbitrum validator set from the registry; for messages **from the L3** ours ([§9.3](#93-interchain-security-the-validator-set)) |
| `defaultHook` | `merkleTreeHook`: inserts each message into the tree validators sign | as the guide |
| `requiredHook` | `protocolFee`: `protocolFee: "0"`, `maxProtocolFee: "100000000000000000"` (the guide's values) | 0 at S0/S1 |
| `InterchainGasPaymaster` + `StorageGasOracle` | Senders pay the relayer in origin-chain gas; "Relayers are paid in the origin chain's native token"; origin fee = exchange rate × destination gas price × gasLimit ([IGP](https://docs.hyperlane.xyz/docs/protocol/core/interchain-gas-payment)) | Oracle entries for `arbitrum` (and `base`) ↔ L3, kept current by us |
| `ValidatorAnnounce` | Validators announce where their signatures live | one per chain |

On the **parent side nothing is deployed**: Arbitrum One, Base and Arbitrum Sepolia already have Mailboxes
(addresses in [§2](#2-settlement-chain-arbitrum-one-or-base) and in the agent config template). Our L3 only needs
to be added to their routing ISMs and gas oracles, which the CLI does when it deploys Warp Routes.

### 9.2 Warp Routes: USDC and ETH into the L3

Hyperlane Warp Routes are token bridges built on the Mailbox: a **collateral** contract (`HypERC20Collateral`)
locks the token on the origin chain and a **synthetic** (`HypERC20`) mints it on the destination; redeeming burns
and unlocks ([Warp Routes](https://docs.hyperlane.xyz/docs/protocol/warp-routes),
[quickstart](https://docs.hyperlane.xyz/docs/guides/quickstart/deploy-warp-route)).

| Route | Origin (type) | L3 (type) | Notes |
|---|---|---|---|
| **USDC** | Arbitrum One, `collateral` on native USDC; later Base too (multi-collateral) | `synthetic` "USDC" | The L3's working stablecoin for Gully Pay. Multi-collateral means "balancing collateral across chains is important" and is rebalanced manually (docs). If Circle lists the L3 later, the canonical bridge's USDC can replace it. |
| **ETH** | Arbitrum One, `native` | `synthetic` (wrapped) or `native` with pre-funded liquidity | Under D3 the canonical bridge already brings native ETH in; the Warp Route is the **fast path** (minutes, validator trust) beside the canonical path (withdrawals wait the parent's challenge window). |

Commands: `hyperlane warp init` (interactive; writes `./configs/warp-route-deployment.yaml`), `hyperlane warp deploy`
(key from `HYP_KEY`, funded on every chain), `hyperlane warp send --relay -w USDC/arbitrum-<l3>` to test
(default amount 1 smallest unit). Artifacts go to `~/.hyperlane/deployments/warp_routes/<SYMBOL>/<id>/`, edited
with `hyperlane warp apply`. Owners of the route contracts: the team multisig from the pitch checklist, never a
server key.

### 9.3 Interchain security: the validator set

A Multisig ISM "verif[ies] that `m` of `n` Validators have attested to the validity of a particular interchain
message"; validator signatures "are not specific to an ISM" ([Multisig ISM](https://docs.hyperlane.xyz/docs/protocol/ISM/standard-ISMs/multisig-ISM)).
Validators sign checkpoints of their **origin** chain's Mailbox, so:

- Messages **Arbitrum → L3** are verified on the L3 by the validators of the `arbitrum` origin: the public set
  already in the registry. We run nothing for that direction.
- Messages **L3 → Arbitrum** (withdrawals through the Warp Route, Gully Pay settlements out) are verified on
  Arbitrum by validators of **our** L3 origin. That is the set we run and the set every counterparty trusts.

D4 plan: S0 one validator (1 of 1, `localStorage` checkpoint syncer, relayer with `--allowLocalCheckpointSyncers`);
S1 one validator with an S3-compatible checkpoint syncer (the docs support `localStorage` for testing and `s3`
for production; GCS is "not supported"); S2 **2 of 3** validators in different regions, keys in a KMS (the docs
warn a compromised key "can lead to slashing" and recommend AWS KMS for production), and an invitation to one or
two external operators once there is value to protect.

### 9.4 Agents we run

| Agent | Needs | Keys and funding |
|---|---|---|
| **Validator** (origin = the L3) | our L3 RPC; a checkpoint store; "2-Core / 2GB RAM / 4GB Storage", "typical costs around $75/mo" (docs) | validator **signing key** (never funded; it only signs checkpoints) plus a **transaction signer** with "a small amount" of L3 ETH for the one-time announce transaction |
| **Relayer** (`--relayChains <l3>,arbitrum[,base]`) | RPCs for every chain it relays; the validators' checkpoint store; a persistent `--db` | one key, **funded on every destination chain** it delivers to: ETH on the L3, ETH on Arbitrum One (and Base). "Avoid reusing one relayer key across multiple relayer instances" (nonce conflicts). Reimbursed through the IGP in origin gas. |

Each agent is one Rust process in the agent image; the prepared compose file caps each at 1 GB RAM, 1 CPU and
30 MB of logs ([`hyperlane/compose.yaml`](hyperlane/compose.yaml)).

### 9.5 LI.FI and Relay: the aggregator path

- **Relay** states it "can easily be added to any EVM-chain, such as OP stack rollups, Arbitrum Orbit chains, or
  more" and asks teams to "reach out" ([supported chains](https://docs.relay.link/resources/supported-chains)).
- **LI.FI**'s prioritisation "is driven by customer demand"; integrations start through its partnerships contact
  and each must meet the bridge or DEX technical requirements
  ([getting integrated by LI.FI](https://docs.li.fi/introduction/learn-more/getting-integrated-by-lifi)).

What both will ask for, so S1 should produce it: a registered chain id, a stable public RPC and WebSocket, an
explorer with an API (Chain Kit is Blockscout, so its API is standard), USDC and ETH on the chain with a bridge
they can route over (the Warp Routes and the canonical bridge), and a DEX with liquidity (the Gully venues). Until
either lists the L3, Gully Pay's checkout keeps LI.FI/Relay for today's chains and the L3 is reached through the
Warp Routes and the canonical bridge.

## 10. Gully Pay on and across the L3

Gully Pay today verifies plain transfers (`server/billing.mjs`: receipt and tx agree, right chain, treasury paid
in the quoted asset, mined within the quote, confirmations per chain). The L3 fits that model with no new trust:

1. **Native on the L3**: add the L3 to `server/payments.mjs` with ETH (gas token, D3) and the Warp Route USDC as
   assets, a Chainlink-style ETH/USD feed (Chainlink's own feeds will not exist on day one: price the L3's ETH
   with the Arbitrum One feed, which the server already reads, and say so in the quote), confirmations set from
   the sequencer's soft finality (1) with a note that reorg protection is the parent's.
2. **Cross-chain in** (payer on Arbitrum One or Base, merchant paid on the L3): the payer sends into the USDC
   Warp Route with the merchant's L3 address as recipient. The server verifies the **origin** transfer as it does
   today (treasury or merchant is the Warp recipient encoded in the dispatch) and marks the invoice `settling`
   until the Mailbox `Process` event on the L3 credits the recipient; both events are public, so the receipt page
   shows both hashes. No custodian, no off-chain promise.
3. **Cross-chain out** (merchant payouts to Arbitrum One): a Warp transfer from the merchant's L3 balance, paid
   for in L3 ETH through the IGP; the fee quoted from `quoteGasPayment` before the merchant confirms.
4. **Fee splits** (the merchant fee proxy on Base Sepolia today) deploy unchanged on the L3; the proxy is plain
   Solidity.

Hyperlane is only in steps 2 and 3, and only once the L3 exists (D5).

## 11. Cost table

Monthly, for S1 (one of everything, Rollup, ETH gas) and S2 (HA sequencer, 2-of-3 validators). "Docs" means
the figure is quoted from the source named; "ours" means our sizing where the docs give none. All USD, VPS list
prices as of 2026-10-17 are not quoted because they change: fill the right-hand column from the provider chosen.

| Item | Sizing | Figure | Source / basis |
|---|---|---|---|
| Nitro sequencer (+ batch poster process) | 1 replica (S1); 2 replicas + feed relay (S2) | "$600 per sequencer replica per month"; "$1,500" with networking and storage | Arbitrum chain FAQ, [troubleshooting](https://docs.arbitrum.io/launch-orbit-chain/troubleshooting-building-orbit), low-to-medium activity |
| Nitro validator, Watchtower | 1 | "approximately $500" | same FAQ |
| Nitro validator, active (staker) | 1 (S1); 2 (S2) | "$800 to $900 per month" each, plus parent gas: ~163,109 gas per assertion, hourly | same FAQ; gas at Arbitrum One's 0.02 gwei base fee (measured 2026-10-17) is negligible, bonds are our parameter |
| Full/RPC node for the public RPC and Chain Kit | 1 (S1); 2 behind gully-web (S2) | docs' minimum is 8 cores / 64 GB for Arbitrum One; **ours**: 4 vCPU / 16 GB / 500 GB NVMe for a new chain, grow with traffic | [Prepare to run a node](https://docs.arbitrum.io/run-arbitrum-node/start-here) |
| DA (Rollup): batch posting to Arbitrum One | per batch | no official figure; = parent calldata/blob gas × parent price + the parent's L1 data component. Measure on Arbitrum Sepolia during S1. | Arbitrum docs give none; spot base fee 0.02 gwei (Arbitrum One), 0.005 gwei (Base), 2026-10-17 |
| DA (AnyTrust), if D2 changes | N DAS + mirrors, N ≥ 4 for any real trust reduction | **ours**: 2 vCPU / 4 GB / 200 GB each, around the clock | [choose AnyTrust](https://docs.arbitrum.io/launch-arbitrum-chain/features/common/data-availability/choose-anytrust): one DAS per member |
| Hyperlane validator | 1 (S0/S1); 3 (S2) | "2-Core / 2GB RAM / 4GB Storage", "typical costs around $75/mo" each | [Run validators](https://docs.hyperlane.xyz/docs/operate/validators/run-validators) |
| Hyperlane relayer | 1 | docs give no sizing; **ours**: 2 vCPU / 4 GB / 20 GB (same class as the validator, ~$75/mo) plus a **float** of ETH on each destination (L3, Arbitrum One, Base) that the IGP refills | [Run a relayer](https://docs.hyperlane.xyz/docs/operate/relayer/run-relayer) |
| Checkpoint store (S3-compatible bucket) | 1 | cents per month at this volume | validator docs: `s3` syncer for production |
| Chain Kit (Blockscout: Postgres, backend, frontend, Redis) | 1 | **ours**: 2 vCPU / 4 GB / 100 GB; several GB of images | devnet README |
| Faucet, RPC forwarding, Gully Pay | 0 | inside gully-web | |
| **S1 total, docs figures only** | | **≈ $2,900–3,000 / month** (1,500 + 500 + 850 + 75) before the RPC node, Chain Kit, the relayer and the batch poster's gas | sum of the quoted rows |
| **S2 total, docs figures only** | | **≈ $5,100–5,300 / month** (2 × 1,500 + 500 + 2 × 850 + 3 × 75) before the same unquoted rows | sum of the quoted rows |

The shared box (`40.160.136.124`, 97 % disk, ~5 GB RAM free) can host **none** of the S1 roles; it is only the S0
devnet target, and only when `preflight.sh` passes. S1 needs its own machines.

## 12. Order of work

1. **S0 (now, local):** start `ops/devnet` on a laptop; deploy Hyperlane core to it with `trustedRelayerIsm`;
   run the prepared validator and relayer against it and Arbitrum Sepolia; send a test message both ways;
   deploy a test Warp Route (a test ERC-20 on Arbitrum Sepolia → synthetic on the devnet). Everything in
   [`hyperlane/README.md`](hyperlane/README.md).
2. **D1–D4 decided** by the owner (table in [§0](#0-owner-decisions-this-spec-needs)).
3. **S1:** pick and register the chain id; deploy with the chain SDK on Arbitrum Sepolia (Rollup, ETH); nodes on
   their own VPS; Chain Kit; faucet; canonical bridge; Hyperlane core with a 1-of-1 multisig ISM; USDC test Warp
   Route; registry PR (`hyperlane-registry`) and `ethereum-lists/chains` PR; monitoring from
   `orbit-monitoring-tools`. This is pitch milestone **M3** ([§13](#13-pitch-milestones)).
4. **S2:** mainnet on Arbitrum One with the reviewed scope; 2-of-3 validators; USDC and ETH Warp Routes from
   Arbitrum One (then Base); Gully Pay native and cross-chain; LI.FI and Relay listing requests with the S1
   artefacts; the Gully venues move over.

## 13. Pitch milestones

The L3 and Hyperlane milestone text for the Arbitrum programs lives in [`ops/pitch/arbitrum.md`](../pitch/arbitrum.md)
(M3 and the new M5); the public summary for developers is the docs page **Roadmap: Gully L3**
(`src/docs/pages/RoadmapL3.tsx`, `docs.gullylabs.xyz/roadmap-l3`).

## 14. Sources (all read 2026-10-17)

- Arbitrum: [SDK introduction](https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-chain-sdk-introduction);
  [canonical factory contracts](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts);
  [choose AnyTrust](https://docs.arbitrum.io/launch-arbitrum-chain/features/common/data-availability/choose-anytrust);
  [Inside AnyTrust](https://docs.arbitrum.io/how-arbitrum-works/inside-anytrust);
  [choose a custom gas token](https://docs.arbitrum.io/launch-arbitrum-chain/features/common/gas-and-fees/choose-custom-gas-token);
  [custom gas token on AnyTrust](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-anytrust);
  [Arbitrum chain FAQ / troubleshooting](https://docs.arbitrum.io/launch-orbit-chain/troubleshooting-building-orbit);
  [Prepare to run a node](https://docs.arbitrum.io/run-arbitrum-node/start-here);
  [nitro-devnode](https://github.com/OffchainLabs/nitro-devnode) (chain id 412346).
- Hyperlane: [deploy to a new chain](https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane);
  [deploy with local agents](https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane-with-local-agents);
  [run validators](https://docs.hyperlane.xyz/docs/operate/validators/run-validators);
  [run a relayer](https://docs.hyperlane.xyz/docs/operate/relayer/run-relayer);
  [agent configuration](https://docs.hyperlane.xyz/docs/operate/config/agent-config);
  [configuration reference](https://docs.hyperlane.xyz/docs/operate/config/config-reference);
  [Warp Route quickstart](https://docs.hyperlane.xyz/docs/guides/quickstart/deploy-warp-route);
  [multi-collateral Warp Routes](https://docs.hyperlane.xyz/docs/guides/warp-routes/evm/deploy-multi-collateral-warp-routes);
  [Multisig ISM](https://docs.hyperlane.xyz/docs/protocol/ISM/standard-ISMs/multisig-ISM);
  [interchain gas payment](https://docs.hyperlane.xyz/docs/protocol/core/interchain-gas-payment);
  [CLI reference](https://docs.hyperlane.xyz/docs/reference/developer-tools/cli);
  [hyperlane-registry](https://github.com/hyperlane-xyz/hyperlane-registry) `chains/{arbitrum,base,arbitrumsepolia}/{metadata,addresses}.yaml`;
  [agents-v2.3.0 release](https://github.com/hyperlane-xyz/hyperlane-monorepo/releases/tag/agents-v2.3.0); ghcr.io and gcr.io manifest APIs; registry.npmjs.org.
- Aggregators: [Relay supported chains](https://docs.relay.link/resources/supported-chains);
  [getting integrated by LI.FI](https://docs.li.fi/introduction/learn-more/getting-integrated-by-lifi).
- Measurements: `eth_feeHistory` on `https://arb1.arbitrum.io/rpc`, `https://mainnet.base.org`,
  `https://sepolia-rollup.arbitrum.io/rpc` (2026-10-17; the docs page charts the same calls live).
