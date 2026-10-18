# Gully Pay fee split: which existing contract

**Question.** Which existing contract, already deployed, can pay the merchant and send the Gully Labs fee to the
treasury in one transaction, without custody?

**Answer.** Use **Request Network's `ERC20FeeProxy`** for tokens (USDC and USDT) on Base, Ethereum, BNB Chain and
Arbitrum. Keep **native coin** (ETH, BNB) **and Robinhood Chain** on plain transfers, with the fee invoiced as it is
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
| Optimism (10) | `0x399F5EE127ce7432E4921a61b8CF52b0af52cbfE` | 2165 / `0xfe7593c88edf` | `0xe11BF2fDA23bF0A98365e1A4c04A87C9339e8687` | 2335 / `0x9f312e885b34` |
| Polygon (137) | registry: `0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9` | **not verified**: every Polygon RPC tried returned an empty body from this machine | registry: `0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8` | not verified |
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

## Limits and follow-ups

- **Two wallet transactions** (approve, then pay) whenever the allowance falls short. The page approves the exact
  total, never an unlimited amount, so this happens on most payments. The proxy supports neither EIP-2612 permit nor
  Permit2.
- **No public audit** of the proxy (above). Mitigations: immutable code, no owner, no custody, live fork tests on
  every chain we use, and the verifier ignores anything that does not come from the four known proxy addresses
  with matching `Transfer` logs.
- **Robinhood Chain** has no Request deployment. It stays on plain transfers with the fee invoiced, unless Request
  deploys there. Its CREATE2 addresses (`0x0Dfb…`, `0x399F…`) would then be the ones to check.
- Polygon could not be checked from this machine. Polygon is not a Gully chain today.
