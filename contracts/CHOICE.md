# Gully Pay fee split: which existing contract

**Question.** Which existing contract, already deployed, can pay the merchant and send the Gully Labs fee to the
treasury in one transaction, without custody?

**Answer.** Use **Request Network's `ERC20FeeProxy`** for tokens (USDC and USDT) on Base, Ethereum, BNB Chain and
Arbitrum, and since 2026-10-18 on OP Mainnet, Polygon and Avalanche too (section "Chains added 2026-10-18" below). Keep
**native coin** (ETH, BNB, POL, AVAX) **and Robinhood Chain** on plain transfers, with the fee invoiced as it is
today. Gully Labs deploys nothing, and the custom splitter on this branch has been deleted.

**Caveat the owner must see.** I found **no public audit of `ERC20FeeProxy`** in any primary source. The Hacken
report usually cited for Request covers the REQ token, not the payment proxies (details below). All the candidates
that *are* audited have the wrong shape. The proxy is about 100 lines, immutable, has no owner and holds nothing. It has
been live on Ethereum since 2020 (block 10,774,767). Its behaviour on every Gully chain is proven below by fork tests against live
chain state. If "audited" is a hard requirement, the cheapest way to meet it is a short paid review of this one
100-line file. That is far smaller than auditing a new contract.

Checked on 2026-10-17. Every address was read with `eth_getCode` through the same public RPCs that
`server/payments.mjs` uses.

---

## Comparison

| | Request `ERC20FeeProxy` | Request `EthereumFeeProxy` (native) | Coinbase Commerce Onchain Payment Protocol (`Transfers`) | 0xSplits (v1 SplitMain / v2) | thirdweb `Split` |
|---|---|---|---|---|---|
| Shape | `transferFrom(payer→merchant)` + `transferFrom(payer→fee)` in one call, then an event | payable; forwards `msg.value − fee` to the merchant and the fee to the fee address | the payer pays the contract, which pays the merchant and the operator fee (and can swap through Uniswap) | funds accumulate in a split or warehouse, and a later `distribute` pays the shares | OpenZeppelin `PaymentSplitter`: funds sit in the contract until each payee calls `release` |
| Custody | **none**: tokens never touch the proxy | passes through within one call | passes through within one call (funds are pulled into the contract, then paid out) | **holds funds** between calls | **holds funds** between calls |
| Admin powers | **none**: no owner, no upgrade, no pause | none (OZ `ReentrancyGuard` only) | **`Ownable` + `Pausable` + `Sweepable`**: Coinbase can pause it | not reviewed (wrong shape) | not reviewed (wrong shape) |
| Fee model | arbitrary `feeAmount` and `feeAddress` per call; the payer pays `amount + fee` | same, with the fee taken out of `msg.value` | fee fixed in a `TransferIntent` that the **registered operator must sign** for every payment | fixed percentages per split; the free tier needs a second split | fixed shares per deployment |
| Third-party use | permissionless | permissionless | operator registration is permissionless, but every payment needs an operator signature from our server | permissionless | deploy your own |
| Licence | MIT ([repo licence](https://github.com/RequestNetwork/requestNetwork/blob/master/LICENSE)) | MIT | Apache-2.0 | GPL-3.0 | Apache-2.0 (repo archived) |
| Audits (primary sources) | **none found** for the proxies (see below); the repo runs slither and echidna in CI | **none found** | **none found** in the [repo](https://github.com/coinbase/commerce-onchain-payment-protocol) (no audit folder; the README links none) | v1: [`audit/0xSplits_A-1.pdf`](https://github.com/0xSplits/splits-contracts/tree/main/audit); v2: [`audits/splits-v2.md`](https://github.com/0xSplits/splits-contracts-monorepo/blob/main/audits/splits-v2.md) (Zach Obront, Feb 2023, commit `9dde20f`) | [`audit-reports/`](https://github.com/thirdweb-dev/contracts/tree/main/audit-reports) (listed in the README's "Contract Audits") |
| Gully chains deployed | **Base, Ethereum, BNB, Arbitrum** (verified); not Robinhood | Base, Ethereum, BNB, Arbitrum (verified); not Robinhood | Ethereum and Base only (verified); **not Arbitrum, BNB or Robinhood** | many (not checked: wrong shape) | per-deployment |
| Event we read | `TransferWithReferenceAndFee(token, to, amount, bytes indexed ref, fee, feeAddress)` | `TransferWithReferenceAndFee(to, amount, bytes indexed ref, fee, feeAddress)` | `Transferred(operator, id, recipient, sender, spent, spentCurrency)` | n/a | n/a |
| Integration cost | **small**: approve + one call; the server builds the call data; verification adds one function | small, but **unusable with a Safe treasury** (below) | large: operator key, signed intents, Permit2 flow, and it covers only 2 of our 4 chains | large, and the wrong model (per-merchant splits, a distribution step, custody) | same as 0xSplits |
| Verdict | **use for tokens** | **do not use** (Safe treasury) | no: chain coverage, admin pause, operator signing | no: holds funds | no: holds funds |

0xSplits and thirdweb `Split` are the wrong shape, as expected. Both receive funds into a contract and pay out
later, so money sits in a contract between calls. Each merchant needs its own split, and a 0% free tier means
deploying or reconfiguring splits. That is the custody and setup the non-custodial checkout exists to avoid.

### Request audits, checked

- **Hacken, April 2022** ("[SCA] Request Network | ERC20", report page
  `hacken.io/audits/request-network/sca-request-network-erc20-apr2022`). Its *Review Scope* is the deployed contract
  `etherscan.io/address/0x8f8221afbb33998d8584a2b05749ba73c37a938a`, which is the **REQ token**, not
  `ERC20FeeProxy`.
- **VeriChains, March 2018**: the original Request contracts. It predates the fee proxies.
- `RequestNetwork/requestNetwork` (MIT) has **no audit folder**. Its CI runs `security-slither.yml` and
  `security-echidna.yml`.
- docs.request.network does not mention audits at all.

### Request deployed sources, checked

- The Ethereum `ERC20FeeProxy` at `0x0Dfb…0aC9` is verified on Blockscout (solc 0.8.4, full match). It differs from
  `master`'s `ERC20FeeProxy.sol` only in formatting.
- `0x370D…623C`, the address Request's SDK lists as "0.2.0" on Ethereum, is the same source built with solc 0.5.17.
- The Ethereum `EthereumFeeProxy` at `0xfCFB…D6a8` is verified (solc 0.8.9). It sends the fee with
  `_feeAddress.transfer(_feeAmount)`.
- Equal bytecode hashes (table below) tie the other chains' deployments to these sources.

---

## Deployments, as verified with `eth_getCode`

Code hash = the first 6 bytes of keccak256 of the runtime code. Rows with the same hash run identical code.

| Chain (id) | `ERC20FeeProxy` | bytes / code hash | `EthereumFeeProxy` | bytes / code hash |
|---|---|---|---|---|
| Ethereum (1) | **`0x370DE27fdb7D1Ff1e1BaA7D11c5820a324Cf623C`** (Request "0.2.0", the address we use) | 1631 / `0x344a0d50cd74` | `0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8` | 2335 / `0xd5f5bb48b43e` |
| Ethereum (1), alternative | `0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9` | 2120 / `0x577dab9d22b7` | | |
| Base (8453) | **`0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814`** | 2165 / `0xfe7593c88edf` | `0xd9C3889eB8DA6ce449bfFE3cd194d08A436e96f2` | 2355 / `0xe51c20f07694` |
| BNB Chain (56) | **`0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9`** | 2120 / `0x577dab9d22b7` | `0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8` | 2335 / `0xd5f5bb48b43e` |
| Arbitrum (42161) | **`0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9`** | 2120 / `0x577dab9d22b7` | `0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8` | 2335 / `0xd5f5bb48b43e` |
| OP Mainnet (10) | **`0x399F5EE127ce7432E4921a61b8CF52b0af52cbfE`** (used since 2026-10-18) | 2165 / `0xfe7593c88edf` (= Base, byte for byte) | `0xe11BF2fDA23bF0A98365e1A4c04A87C9339e8687` | 2335 / `0x9f312e885b34` |
| Polygon (137) | **`0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9`** (used since 2026-10-18) | 1631 / `0x7e71cc3d1762`; stripped runtime `0x47eecc776c20b737…` = Ethereum `0x370D…` (same build, other metadata) | `0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8` | 2335 / `0xd5f5bb48b43e` |
| Avalanche (43114) | **`0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9`** (used since 2026-10-18) | 2120 / `0x577dab9d22b7` (= BNB Chain and Arbitrum, byte for byte) | `0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8` | 2335 / `0xd5f5bb48b43e` |
| Robinhood Chain (4663) | **none**: no code at `0x0Dfb…`, `0x399F…`, `0x370D…` or `0x1892…` | 0 | none at `0xfCFB…`, `0xe11B…` or `0xd9C3…` | 0 |

Coinbase `Transfers`: Ethereum `0x1DAe28D7007703196d6f456e810F67C33b51b25C` (19,336 bytes) and Base
`0xeADE6bE02d043b3550bE19E960504dbA14A14971` (19,336 bytes). There is no code at either address on Arbitrum, and
none was listed for BNB.

The source registry is
[`packages/smart-contracts/src/lib/artifacts/ERC20FeeProxy/index.ts`](https://github.com/RequestNetwork/requestNetwork/blob/master/packages/smart-contracts/src/lib/artifacts/ERC20FeeProxy/index.ts)
(and `EthereumFeeProxy/index.ts`).

**Why `0x370D…` on Ethereum.** It is the address Request's own SDK uses there. Both Ethereum deployments pass the
same fork tests, USDT included.

---

## Chains added 2026-10-18: OP Mainnet, Polygon, Avalanche

Request's deployment artifact was read at commit `8110c4c7b5a70750ba44f808c4eb7224d7df4f98` of
`RequestNetwork/requestNetwork` (`packages/smart-contracts/src/lib/artifacts/ERC20FeeProxy/index.ts`, version
`0.2.0`): `optimism` → `0x399F…cbfE`, `matic` → `0x0Dfb…0aC9`, `avalanche` → `0x0Dfb…0aC9`
(`EthereumFeeProxy/index.ts`: `optimism` → `0xe11B…8687`, `matic` and `avalanche` → `0xfCFB…D6a8`, with the older
`0xC6E2…6C1F` 0.1.0 build on both). Every address was then read with `eth_getCode` through the public RPCs below and
the runtime compared, CBOR metadata stripped (the last two bytes give its length, as `script/DeployFeeProxy.s.sol`
does), with the proxies already in use. **Only byte-identical matches went into `FEE_PROXIES` / `SPLIT_PROXIES`.**

| Chain | `ERC20FeeProxy` | RPCs that answered, all with the same code | Match |
|---|---|---|---|
| OP Mainnet (10) | `0x399F5EE127ce7432E4921a61b8CF52b0af52cbfE` | mainnet.optimism.io, optimism-rpc.publicnode.com, op-pokt.nodies.app, api.zan.top/opt-mainnet, optimism.drpc.org, 10.rpc.thirdweb.com, optimism.publicnode.com, optimism-mainnet.gateway.tatum.io (8) | 2165 bytes, full hash `0xfe7593c88edf` **= Base `0x1892…`**; stripped `0xf046d2f7d0f32b2f…` (2112 bytes) = `BASE_ERC20_FEE_PROXY_RUNTIME` in `DeployFeeProxy.s.sol` |
| Polygon (137) | `0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9` | polygon-bor.publicnode.com, api.zan.top/polygon-mainnet, 137.rpc.thirdweb.com, polygon.rpc.thirdweb.com (4; see the RPC note) | 1631 bytes, full hash `0x7e71cc3d1762`; stripped `0x47eecc776c20b737…` (1579 bytes) **= Ethereum `0x370D…`** (solc 0.5.17 build; only the metadata differs). Celo's `0x2171…` is the same runtime |
| Avalanche (43114) | `0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9` | api.avax.network, avalanche-c-chain-rpc.publicnode.com, avalanche.api.onfinality.io, api.zan.top/avax-mainnet, avalanche.drpc.org, 43114.rpc.thirdweb.com, avax-mainnet.gateway.tatum.io, avalanche.publicnode.com (8) | 2120 bytes, full hash `0x577dab9d22b7` **= BNB Chain and Arbitrum `0x0Dfb…`**; stripped `0x43da4b52fee9a1f7…` (2067 bytes) |

`EthereumFeeProxy` (not used, listed for the guard's registry): `0xe11B…8687` on OP Mainnet and `0xfCFB…D6a8` on Polygon
and Avalanche are 2335 bytes with the same stripped runtime `0x3c56e094dd7b0639…` as Ethereum's `0xfCFB…D6a8`.

Other mainnets in the artifact, read the same day for completeness (not Gully Pay chains): Gnosis (100) and Fantom
(250) carry the BNB build at `0x0Dfb…`; Sonic (146), Mantle (5000), Core (1116) and Ronin (2020, at `0xAe23…B64B`)
carry the Base build; Celo (42220, `0x2171…dB0C`) the Ethereum `0x370D` build; Boba (288) and zkSync Era (324) are
different builds (1119 and 4768 bytes) and would need their own review; Moonbeam's RPCs did not answer from here.

**RPC note.** From the development machine several public hosts fail with a TLS interception error
(`ERR_SSL_WRONG_VERSION_NUMBER`), among them `*.drpc.org` for Polygon only, `1rpc.io`, `*.gateway.tenderly.co`,
`polygon-rpc.com` and `*.publicnode.com` for some chains; the production box does not have it. Each new chain's six
default RPCs in `server/payments.mjs` answered `eth_chainId`, `eth_blockNumber` and `eth_getCode` from here, except
three of Polygon's (`polygon.drpc.org`, `polygon-mainnet.public.blastapi.io`, `polygon.gateway.tenderly.co`), which
are the same providers that serve our other chains and are kept behind the three that answered. The cool-off fallback
in `payments.rpc` steps around any host that fails.

### Tokens and feeds, read on chain the same day (`symbol()`, `decimals()`, `name()`; `description()`, `decimals()`, `latestRoundData()`)

| Chain | Token | Address | On chain | Note |
|---|---|---|---|---|
| OP Mainnet | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | USDC, 6, "USD Coin", 1852-byte proxy, owner `0xb04f…441f` | Circle's native issuance (the bridged `USDC.e` `0x7F5c…1607` is not offered) |
| OP Mainnet | USDT | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | USDT, 6, "Tether USD" | the OP standard bridge's USDT, the only USDT on OP Mainnet |
| OP Mainnet | ETH / USD feed | `0x13e3Ee699D1909E989722E753853AE30b17e08c5` | "ETH / USD", 8 decimals, fresh answer | Chainlink |
| Polygon | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | USDC, 6, "USD Coin", 1852-byte proxy, owner `0xaee2…2bcc` | Circle's native issuance (`USDC.e` PoS `0x2791…4174` is not offered) |
| Polygon | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | **symbol `USDT0`, name "USDT0"**, 6 | Tether's omnichain USDT0 replaced the PoS USDT at this address; **not offered** (different symbol and product) until the owner decides |
| Polygon | POL price | `0xAB594600376Ec9fD91F8e885dADF0CE036862dE0` | "MATIC / USD", 8 decimals, fresh answer | Chainlink's data directory lists no separate POL / USD feed on Polygon; POL replaced MATIC 1:1 (Sept 2024), so this feed prices POL |
| Avalanche | USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | USDC, 6, "USD Coin", 1852-byte proxy, owner `0x4b7c…508e` | Circle's native issuance (`USDC.e` `0xA7D7…C664` is not offered) |
| Avalanche | USDT | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | **symbol `USDt`**, 6, "TetherToken", owner `0xd83d…2aaa` | Tether's native Avalanche issuance (shown as USDT; `USDT.e` `0xc719…5118` is not offered) |
| Avalanche | AVAX / USD feed | `0x0A77230d17318075983913bC2145DB16C7366156` | "AVAX / USD", 8 decimals, fresh answer | Chainlink |

### The treasury gate (`server/treasury-chains.mjs`)

`GULLY_TREASURY_ADDRESS` is a Safe: the same address on every chain, deployed on some. A payment to the address on a
chain where nothing is deployed can be lost (nobody can sign there), so the server reads `eth_getCode(treasury)` on
every chain at start and hourly (sooner while a read fails) and **does not offer** a chain where the treasury has no
code: not in `GET /api/plans`, not in quotes (409), pay links, checkouts or QR codes, and `withFeeSplit` drops the fee
leg there (merchant payments stay plain transfers with the fee invoiced). The treasury is taken for a contract as soon
as any chain shows code at its address (`GULLY_TREASURY_KIND=contract` pins it before the first deployment); an
address with no code anywhere is an EOA and receives everywhere. The admin panel (Subscriptions card) lists every
chain's state with "Treasury not deployed on <chain> — deploy the Safe at the same address via app.safe.global, then
it switches on by itself", and `POST /api/admin/treasury/check` reads again at once. Merchant wallets have had the
same rule since `merchants.inspectWallet`.

### Per-chain matrix

| Chain | Proxy verified | Treasury | Offered to payers | Merchant fee on stablecoins |
|---|---|---|---|---|
| Base, Ethereum, BNB Chain, Arbitrum | yes (above) | deployed (payments have been received there) | yes | in the payment (`withFeeSplit`) |
| OP Mainnet | yes, = Base's build | **gated**: not offered until the Safe is deployed there | after deployment, automatically | in the payment once deployed; invoiced until then |
| Polygon | yes, = Ethereum's build | **gated** | after deployment, automatically | same |
| Avalanche | yes, = BNB/Arbitrum's build | **gated** | after deployment, automatically | same |
| Solana | no Request deployment | its own `GULLY_SOLANA_TREASURY` | while that is set | invoiced |
| Robinhood Chain | none | n/a | not a Gully Pay chain | n/a |

What the payer sees never changes with the fee path: the quoted amount is what leaves the wallet; a split adds an
approval step before the one payment call.

### Gas (`node scripts/gas-report.mjs`, read live)

Gas price, the coin's Chainlink price, and the USD cost of approve (46k), the fee-proxy payment (106k, measured on
Base Sepolia) and a plain transfer (65k); on Base and OP Mainnet the L1 data fee from the `GasPriceOracle` predeploy,
on Arbitrum from `NodeInterface.gasEstimateL1Component`. On 2026-10-18 every chain's fee-proxy payment cost under one
cent: Base $0.0015, Ethereum $0.0099, BNB Chain $0.0038, Arbitrum $0.0052, OP Mainnet $0.0003, Polygon $0.0025,
Avalanche $0.0052.

---

## Fee semantics: payer-pays vs payee-pays

The proxy has no notion of who bears the fee. It moves `amount` to `to` and `feeAmount` to `feeAddress`, both from
`msg.sender`, so as designed the payer pays `amount + fee` on top. Gully Pay charges the **merchant**, so the server
sets `amount = quote total − fee`. The payer still pays exactly the quoted total, the merchant receives `total − fee`,
and the treasury receives the fee in the same transaction. The fee is `floor(total × bps / 10000)`, rounded in the
merchant's favour, so `merchant + fee == total` always holds.

## The native-coin finding

`EthereumFeeProxy` pays the fee with Solidity `transfer`, which forwards 2,300 gas. A Safe proxy cannot receive
coin under that limit: its fallback does a cold `SLOAD` of the singleton (2,100 gas) and a cold `DELEGATECALL`
(2,600 gas). The fork test `test_native_feeToSafeTreasury_reverts` reproduces this on all four chains. The trace
shows `Safe::receive{value: 0.005 ETH}` failing with `[2300] … OutOfGas`. Since the treasury is a Safe, native coin
stays on plain transfers, with the fee invoiced as today. A fee address that is an EOA would work
(`test_native_feeToEoa_works`), but routing fees to a hot wallet to suit one contract is the wrong trade.

---

## Evidence: live testnet run

[`TESTNET-RESULTS.md`](TESTNET-RESULTS.md) has the live run on Base Sepolia. Request's own source was rebuilt there
byte-identical to the Base mainnet proxies and deployed. Every case is a real transaction: fees to an EOA and to a Safe,
zero fee, no or short allowance, a USDT-style token, the native proxy's Safe revert, and a Safe spending its fees. It
also includes an end-to-end payment through our server.

## Evidence: fork tests (`contracts/test/RequestFeeProxy.fork.t.sol`)

These run against live state at the latest block of each chain, through the same public RPCs (override them with
`GULLY_RPC_<chainId>`). `isolate = true` makes every call its own transaction, so storage starts cold as it does on
mainnet; otherwise the Safe bug would hide.

```
cd contracts && forge test        # 27 passed, 0 failed (Base 6, Ethereum 9, BNB 6, Arbitrum 6)
```

| Check | Base | Ethereum | BNB | Arbitrum |
|---|---|---|---|---|
| USDC: merchant gets `amount`, a real 1-of-1 **Safe treasury** gets `fee`, the proxy keeps 0, and the event decodes as the server expects (topic0, topic1 = keccak(ref), data layout) | ✓ | ✓ (both deployments) | ✓ | ✓ |
| USDT, which returns no bool | | ✓ (both deployments) | ✓ | |
| Zero fee: the treasury leg is skipped | ✓ | ✓ USDT | ✓ USDT | ✓ |
| No allowance: reverts, nothing moves | ✓ | ✓ USDT | | ✓ |
| Native coin, fee to the Safe: **reverts (OutOfGas in `transfer`)** | ✓ | ✓ | ✓ | ✓ |
| Native coin, fee to an EOA: works | ✓ | ✓ | ✓ | ✓ |
| Plain coin transfer to the Safe works (the QR path) | ✓ | ✓ | ✓ | ✓ |

---

## Integration (this branch)

| Piece | Where | What |
|---|---|---|
| Addresses, topic, reference | `server/payments.mjs` → `FEE_PROXIES`, `FEE_PROXY_TOPIC`, `paymentReference(quoteId)` | the reference is 8 bytes: `keccak256("gully-pay:" + quoteId)[0..8]` |
| Mark a quote as split | `withFeeSplit(quote, { bps, feeTo })` | sets `feeRaw`, `feeTo` and `ref` on a **token** quote on a chain with a proxy; native coin, a zero fee (free tier) or `feeTo == recipient` leave it as a plain transfer |
| Server-built call data | `quoteSplit(quote)` → `quoteView().split` in `server/billing.mjs` | `approve(proxy, total)`, `approveReset` (USDT needs 0 first) and `transferFromWithReferenceAndFee(token, merchant, total − fee, ref, fee, treasury)` |
| Wallet path | `src/components/pay/PayWallet.tsx` | when `quote.split` is set: read the allowance; approve only if it falls short (resetting it first when non-zero) and wait for that; then send the server's call data. Otherwise it is the plain `transfer` as before |
| Checkout copy | `src/pages/pay/Checkout.tsx` | states the merchant and fee amounts, and that the wallet asks for an approval first |
| Verification | `readPayment` → `creditFeeProxy` / `feeProxyPayments` | a `TransferWithReferenceAndFee` from the known proxy, for this token and payee, with `feeAddress ==` treasury and both `Transfer` logs from the same payer present, turns that payer's credit into `amount + fee` and attaches `{ fee, ref }`. The exact-amount match against the quote then holds. Plain transfers are unchanged |
| QR / EIP-681 | unchanged | a plain transfer of the full total to the merchant; it carries no `fee`, so the fee is invoiced as today |
| Tests | `npm run test:feeproxy` (35 checks, chain stubbed) | call data is decoded with viem; spoofed events (wrong emitter, wrong fee address, missing fee leg, fee from another wallet, another merchant) are ignored |

### Wired into the merchants code (`feat/merchant-feesplit`)

`server/merchants.mjs` uses the hooks as follows:

1. `createQuote` sizes the fee exactly like `merchant-fees.mjs` `accrue()` with the store's volume so far, so it
   covers only the part of the payment above the remaining free allowance, converts it to the token's base units
   (1:1) and calls `withFeeSplit(quote, { bps, feeTo: treasury(), feeRaw })`. A fully free payment gets no split;
   coins and chains without a proxy stay plain transfers. `quote.treasury` is the merchant wallet.
2. In `checkTx`'s `run({ match })`, `match.fee` (set only when the fee leg went to `GULLY_TREASURY_ADDRESS`) is
   recorded on the payment (`feeRaw`) and on its fee row as `collectedMicros` (capped at the fee accrued) with
   `onchain: true`. A statement bills `feeMicros − collectedMicros`, so collected + billed = accrued exactly and
   nothing is billed twice or refunded. A proxy payment whose fee is above the quoted one is refused (it would
   have come out of the merchant's share).
3. `creditFeeProxy(…, feeTo)` keeps its default, `GULLY_TREASURY_ADDRESS`, the same value `plans.treasury()`
   returns.

## Funds can't get stuck (owner rule, `feat/feeproxy-guards`)

> "no funds can ever get stuck in fee splitter contract"

The proxy never custodies anything: `transferFromWithReferenceAndFee` does `transferFrom(payer → merchant)` and
`transferFrom(payer → feeAddress)` inside one call and returns, so its token balance is zero before and after every
payment (the fork tests and the Base Sepolia run assert `proxy +0` on each case). Neither `ERC20FeeProxy` nor
`EthereumFeeProxy` has an owner, a sweep or a fallback that forwards, so the **only** way funds end up in one is a
token or coin transfer sent **straight to the proxy's address**, and such a transfer is lost for good. The code
therefore makes that impossible from anything Gully builds, and visible if a third party does it:

1. **One server-side validator on every emission path** (`server/pay-guard.mjs`, rules in
   `server/fee-proxy-guard.mjs`, which is pure and shared with the browser). Every quote view (plan, product,
   invoice, pay link, merchant), every EIP-681 / Solana Pay URI (the QR codes), every treasury or merchant recipient
   shown on a checkout, and every split's call data passes it before it leaves the server:
   - (a) no plain-transfer recipient is ever a fee proxy on **any** chain (every known `ERC20FeeProxy` and
     `EthereumFeeProxy` address above, plus Optimism and Polygon from Request's registry, the Base Sepolia proxies
     we deployed, and any `GULLY_FEEPROXY_<chainId>`), nor the zero address;
   - (b) a split reaches the proxy only through `transferFromWithReferenceAndFee` with `value` 0, an allowed token,
     `to` = the quote's recipient (never a proxy, never zero), `feeAddress` = `GULLY_TREASURY_ADDRESS` (never a
     proxy, never zero, never `to`), `0 < fee < amount`, `amount + fee` = what the payer pays, the reference of the
     quote, and `approve(proxy, amount + fee)` exactly (reset `approve(proxy, 0)` for USDT);
   - (c) the token is USDC or USDT on its chain (no fee-on-transfer token, whose legs would not add up).
   A violation is logged (`pay-guard: …`), kept for the admin banner, and answers **500** with a message that
   carries no address: nothing is emitted. `withFeeSplit` also refuses to split when either address is a proxy, and
   `readPayment` names a transaction that paid a proxy directly as an unrecoverable mis-send (422) instead of
   "sent to another address".
2. **The wallet path re-checks** (`src/components/pay/PayWallet.tsx`, importing the same `fee-proxy-guard.mjs`):
   the quote's asset, recipient and split against the same rules; the proxy call is **simulated with `eth_call`**
   from the payer's account before the wallet sees it; every transaction the page sends passes `txViolations`
   (never native value to a proxy, never a call to a proxy other than `transferFromWithReferenceAndFee`, never
   `transfer`/`transferFrom` whose recipient is a proxy); a split that fails is refused outright and **never**
   retried as a plain transfer. Every address input (merchant wallets in `merchants.mjs inspectWallet` and the
   portal form, plan and analytics account fields in the admin) rejects a proxy address.
3. **A monitor** (`server/fee-proxy-monitor.mjs`, started from `startLoops`, never in standby) reads the USDC/USDT
   and native balance of every known proxy on every Gully Pay EVM chain once an hour through the usual RPC
   failover (reads cached 50 min, about 25 calls an hour). A non-zero balance raises an alert: a banner and the
   "Fee proxy balances" card in the admin panel (`/api/admin/overview` → `feeProxy`, "Check now" →
   `POST /api/admin/fee-proxy/check`), plus a Telegram message to `TELEGRAM_ADMIN_CHAT_ID` when it is set, saying
   it is a third-party mis-send that nobody, Gully Labs included, can recover.
4. **Tests**: `npm run test:feeproxy` (every rule, each violated one way at a time; the monitor against stubbed
   balances), `npm run test:pay` (every emission path with a proxy as treasury answers 500 with no address; the
   admin still loads and says why; the check-now endpoint and the alert), `npm run test:merchants` (a proxy as
   a store wallet is refused; a store whose stored wallet is a proxy gets no checkout, quote or recipient).

## Limits and follow-ups

- **Two wallet transactions** (approve, then pay) whenever the allowance falls short. The page approves the exact
  total, never an unlimited amount, so this happens on most payments. The proxy supports neither EIP-2612 permit nor
  Permit2.
- **No public audit** of the proxy (above). Mitigations: immutable code, no owner, no custody, live fork tests on
  every chain we use, and the verifier ignores anything that does not come from the four known proxy addresses
  with matching `Transfer` logs.
- **Robinhood Chain** has no Request deployment. It stays on plain transfers with the fee invoiced, unless Request
  deploys there. Its CREATE2 addresses (`0x0Dfb…`, `0x399F…`) would then be the ones to check.
- Polygon's proxy was verified on 2026-10-18 through four RPCs (above); Polygon, OP Mainnet and Avalanche are Gully
  Pay chains since then, each offered only once the Safe treasury is deployed there.
- Polygon USDT0 (`0xc213…8e8F`) is not offered: its on-chain symbol is `USDT0` and it is Tether's omnichain product,
  not the plain USDT; adding it needs the owner's decision and its own mark.
