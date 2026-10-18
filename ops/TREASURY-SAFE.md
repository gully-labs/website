# The treasury Safe on every chain (one-click deployment)

Gully Pay pays `GULLY_TREASURY_ADDRESS` on every chain it offers. When that address is a **Safe**, it exists only
on the chains where the Safe was *deployed*: elsewhere it is an empty address, and a payment sent there is lost.
The admin panel's **Treasury Safe** card (`/admin`, under Subscriptions) reads the treasury on every chain and
offers **Deploy Safe on <chain>** where it has no code. Your own wallet signs; the server never holds a key.

Server: `server/safe-deploy.mjs`. Browser: `src/components/pay/SafeDeploy.tsx`, `src/pages/admin/TreasurySafe.tsx`.
Tests: `npm run test:safe-deploy` (stubbed chains, real Safe 1.4.1 bytes) and the live Base Sepolia run in
`contracts/TESTNET-RESULTS.md`, section "Safe deployment".

## What the card shows

| Pill | Meaning |
|---|---|
| `Safe 1.4.1 · 1/2` | A Safe we recognise (1.3.0 or 1.4.1 from Safe's official factory): version, threshold / owners. Payments there are fine. |
| `not deployed` | No code at the treasury address on this chain. **Payments there would be lost.** The Deploy button appears when the Safe exists on another chain. |
| `wallet (EIP-7702)` | The treasury is a delegated EOA there; it receives as a wallet. |
| `contract, not a Safe` | Code we do not recognise as a Safe proxy. Nothing is offered; look at it by hand. |
| `unreadable` | Every RPC for that chain failed. Try again; see `GULLY_RPC_<chainId>`. |
| `ahead of payments` | OP Mainnet, Polygon and Avalanche are listed before Gully Pay takes payments there, so the Safe can be in place first. Once `feat/pay-chains` lists a chain in `server/payments.mjs`, that entry wins and the pill goes. |

If the treasury is a normal wallet (no code anywhere), the card says so: nothing to deploy.

## Deploying the treasury Safe on OP Mainnet, Polygon or Avalanche (owner steps)

1. Open `/admin` with the admin token. In **Treasury Safe**, the Base row should read `Safe 1.4.1 · …` (the origin) and
   the target row `not deployed`.
2. Press **Deploy Safe on OP Mainnet** (or Polygon, Avalanche). The panel reads the Safe on Base, recovers its creation
   transaction, checks that Safe's official factory, singleton and fallback handler are on the target chain with the
   pinned code hashes, and shows: the Safe address with **address verified** (the server's and the page's own CREATE2
   arithmetic agree), the owners it will start with, the gas estimate in the chain's coin, and every check.
   - Read the **warnings**: the copy starts with the Safe's ORIGINAL owners and threshold (the ones in its creation
     transaction). If owners were changed since, change them again on the new chain afterwards, from Safe{Wallet}.
3. Press **Connect a wallet to deploy** and connect any wallet that holds a little of the chain's coin for gas
   (about 240,000 gas; the panel shows the cost). It does not have to be a Safe owner. The wallet is asked to switch to
   the chain (and to add it, if it is new to the wallet), then to confirm one transaction to Safe's factory
   `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` (1.4.1) or `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2` (1.3.0).
4. The stepper runs **Sent → Mined → Verified on chain**: the server reads the receipt, then `eth_getCode` and
   `getOwners()` at the treasury address. On *Verified* the card re-reads the chains and the row turns green.
5. Only then let that chain take payments (`feat/pay-chains`): the same check that refuses a merchant's undeployed
   Safe refuses our own treasury per chain, and it passes once the code is there.

Repeat per chain. The same Safe address appears on every chain; nothing about Base changes.

## What is refused, on purpose

- A prediction that differs from the Safe's address (`mismatch`): nothing is offered. Both the server and the browser
  recompute CREATE2 before the wallet is asked.
- No official factory/singleton/fallback handler on the target chain, or code there whose keccak differs from the
  pinned hash (`no-factory`, `no-fallback`).
- A Safe created with `createProxy` (plain CREATE, 1.3.0) or by a factory we do not know: its address cannot be
  reproduced. Create a new Safe for that chain instead and change `GULLY_TREASURY_ADDRESS`… per chain is not supported
  (one address everywhere), so for the treasury this means a new Safe everywhere.
- A setup that paid for its own deployment (`paymentToken`/`payment`), or whose module set-up call targets a contract
  missing on the target chain.
- The fee-proxy addresses (`server/fee-proxy-guard.mjs`) and the zero address are never a target.

## Finding the creation transaction

The salt nonce and the exact initializer are not stored on chain. The server looks, in order: our own record
(`DATA_DIR/safe-deploys.json`, Safes planned as new here), a transaction hash you paste (`deployTx`), the first block
in which the Safe had code (binary search over `eth_getCode`, needs a node with archive state: drpc and Base's own
RPCs have it; publicnode does not without a key) and that block's `ProxyCreation` log, then Safe's transaction service
as a hint. Every path is verified by recomputing the address; a wrong hash is simply refused.

If the panel says the creation could not be found, open the treasury on the origin chain's explorer, copy the
"Contract Creator" transaction hash and call `POST /api/admin/safe/plan { chainId, deployTx }` (or paste it when the
panel asks, once that field is wired; today the API takes it).

## Env and data

- `GULLY_RPC_<chainId>` overrides the public RPCs for any chain, the extra Safe chains included (10, 137, 43114).
- `GULLY_TESTNET_CHAINS=84532,11155420,421614` adds Base Sepolia, OP Sepolia and Arbitrum Sepolia; ignored when
  `NODE_ENV=production`.
- `DATA_DIR/safe-deploys.json`: Safes planned as new (address, owners, threshold, salt nonce, initializer, per-chain
  deployment tx). It is what makes a second deployment of the same new Safe instant. Backed up with the data volume.
- Pinned deployments: `safe-global/safe-deployments` 1.37.64 (addresses and code hashes in `server/safe-deploy.mjs`).
  A new Safe version means adding its factory, singletons and handler there, with their hashes, nothing else.
