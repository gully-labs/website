# Chain launch flow: licences of what it is built on

Checked 2026-10-18 against the npm registry, the packages' own LICENSE files in `node_modules`, and GitHub.

The launch flow (`/app#chains/launch`) is our own code. It does not copy, host or modify
`OffchainLabs/arbitrum-orbit-deployment-ui` (no licence file, so all rights reserved). It calls a licensed SDK.

## Direct libraries

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
| `@arbitrum/chain-sdk` (the successor of `@arbitrum/orbit-sdk`, same repo; npm `latest`) | 0.28.0 (pinned) | **Apache-2.0** (full text in the package, `author: Offchain Labs, Inc.`) | https://github.com/OffchainLabs/arbitrum-chain-sdk , https://www.npmjs.com/package/@arbitrum/chain-sdk |
| `@arbitrum/orbit-sdk` (old name, still published, not used) | 0.26.0 | Apache-2.0 | same repository |
| `viem` | 2.57.7 | **MIT** (Copyright 2023-present weth, LLC) | https://github.com/wevm/viem |

Apache-2.0 and MIT are permissive: use, modification, bundling into our app and hosting it are all allowed.
Apache-2.0 asks us to keep the licence text and notices when we redistribute the SDK; the production bundle is
served from our own site, and this file plus `package.json` record the dependency.

## The SDK's own dependencies (installed with it)

| Package | Licence |
| --- | --- |
| `@arbitrum/sdk` 4.1.0, `@arbitrum/chain-actions`, `@arbitrum/token-bridge-contracts`, `@offchainlabs/upgrade-executor` | Apache-2.0 |
| `@offchainlabs/fund-distribution-contracts`, `@safe-global/protocol-kit`, `ethers` 5.8, `zod`, `abitype`, `jsonc-parser`, `@ethersproject/*` | MIT |
| `@arbitrum/nitro-contracts` 3.2.0 | **BUSL-1.1** (see below) |

### The one non-permissive piece: `@arbitrum/nitro-contracts` (BUSL-1.1)

The SDK imports the Nitro contracts' ABIs and bytecode to build the rollup-creation transaction. Business Source
Licence 1.1 allows copying and non-production use, and Offchain Labs' **Additional Use Grant** allows production
use "to deploy and operate (x) a blockchain that settles to a Covered Arbitrum Chain or (y) a blockchain in
accordance with ... the Arbitrum Expansion Program Term of Use". The Covered Arbitrum Chains include **Arbitrum
Sepolia (421614)**, the only parent chain this flow supports, and any Layer 3 built on and settling to one. The
Change Date is 2030-12-31 (then Apache-2.0). Our flow only ever deploys chains settling to Arbitrum Sepolia, so
it stays inside the grant. A mainnet path is deliberately not built; a Arbitrum One / mainnet chain falls under the
Arbitrum Expansion Program terms and needs a separate review before it is offered.
Licence text: https://github.com/OffchainLabs/nitro-contracts/blob/main/LICENSE.md

## Not used (no licence, so not touched)

`arbitrum-orbit-deployment-ui`, `orbit-setup-script`, `orbit-monitoring-tools`, `arbitrum-token-lists` carry no
licence file. See `ops/OFFCHAIN-LABS-LICENCE-REQUEST.md` for the request to Offchain Labs.

## Install note

`@arbitrum/chain-sdk` declares `peerDependencies: { viem: ^1.20.0 }`, but the app uses viem 2. `package.json`
`overrides` maps the SDK's viem to the app's (`"$viem"`); the flow is covered by `npm run test:chains-launch`
and an e2e that stub the SDK's prepare step, and the real prepare call was run against the Arbitrum Sepolia RPC
(read-only, nothing sent) to confirm the SDK works with viem 2.
