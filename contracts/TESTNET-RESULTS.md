# Gully Pay fee path: live results on Base Sepolia

Run on 2026-10-17/18 (UTC) on **Base Sepolia (chain 84532)** with throwaway testnet wallets. No mainnet transaction was
sent. Every row below is a real transaction with its Basescan link. An expected revert was first shown with `eth_call`
(no gas spent), then sent once as a mined failing transaction with a fixed gas limit.

**Result: 22 of 22 contract cases and 15 of 15 server checks passed.**

| Role | Address |
|---|---|
| **ERC20FeeProxy (deployed here)** | [`0xAe5508E1509cCE6a73B38d8B19fEDFdBd0080c18`](https://sepolia.basescan.org/address/0xAe5508E1509cCE6a73B38d8B19fEDFdBd0080c18) |
| **EthereumFeeProxy (deployed here)** | [`0xD302Ce9E3048ad676C6E74bE57042acA31E2957e`](https://sepolia.basescan.org/address/0xD302Ce9E3048ad676C6E74bE57042acA31E2957e) |
| MockUSDT (USDT-style test token) | [`0xc1560702F640166cB382331B5D3561072F6569Be`](https://sepolia.basescan.org/address/0xc1560702F640166cB382331B5D3561072F6569Be) |
| Safe treasury, 1-of-1 | [`0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84`](https://sepolia.basescan.org/address/0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84) |
| USDC (Circle, Base Sepolia; `symbol()` USDC, `decimals()` 6, checked on chain) | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |
| Payer (test wallet) | [`0x18D679735B5D4c5Ead2B0a3F12F12aF4bD110CAD`](https://sepolia.basescan.org/address/0x18D679735B5D4c5Ead2B0a3F12F12aF4bD110CAD) |
| Merchant (EOA) | [`0xD5c89c91161C26d360881e7EA966b09d2c8392B0`](https://sepolia.basescan.org/address/0xD5c89c91161C26d360881e7EA966b09d2c8392B0) |
| Treasury (EOA; also the Safe's owner) | [`0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4`](https://sepolia.basescan.org/address/0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4) |
| Safe v1.4.1 SafeProxyFactory / SafeL2 singleton | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` / `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |

Payer wallet: it started with 0.04899 ETH and 20 USDC, and ended with 0.04851 ETH and 12.52 USDC. Gas for
everything, deployments included, came to well under 0.0001 ETH (gas price about 0.006 gwei). The rest of the spend is the
test payments themselves, most of which went to the test merchant and treasury.

## Why the testnet proxies are the real ones

Request has no proxies on Base Sepolia (no code at `0x1892…b814` or `0x0Dfb…0aC9`), so we deployed its own source:

- **Source:** `contracts/src/request/ERC20FeeProxy.sol` and `EthereumFeeProxy.sol`, verbatim from
  [RequestNetwork/requestNetwork @ `8110c4c7b5a70750ba44f808c4eb7224d7df4f98`](https://github.com/RequestNetwork/requestNetwork/tree/8110c4c7b5a70750ba44f808c4eb7224d7df4f98/packages/smart-contracts/src/contracts)
  (MIT). The second one uses OpenZeppelin 4.9.6 `ReentrancyGuard`, the version pinned in that commit's `package.json`.
- **Build:** solc 0.8.9 with the **optimizer off** (`foundry.toml`, the `src/request/**` restriction). Request's
  hardhat config says optimizer on with 200 runs, but that build does *not* match. The unoptimized one does.
- **Match:** the runtime code, with the CBOR metadata stripped, is byte-identical to Base mainnet
  [`0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814`](https://basescan.org/address/0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814)
  (ERC20FeeProxy: 2,112 bytes, keccak `0xf046d2f7…f06d`) and
  [`0xd9C3889eB8DA6ce449bfFE3cd194d08A436e96f2`](https://basescan.org/address/0xd9C3889eB8DA6ce449bfFE3cd194d08A436e96f2)
  (EthereumFeeProxy: 2,302 bytes, keccak `0x39228807…f380`), read with `eth_getCode`. The deployed Base Sepolia code
  was read back the same way and matches too. `script/DeployFeeProxy.s.sol` refuses to finish if either hash differs.
  Only the metadata hash differs, because the source file paths and formatting differ from Request's 2021 build.

## Results

### Safe

| # | Case | Expected | Actual | Tx | Gas used | Balance change (USDC) | Before → after |
|---|---|---|---|---|---|---|---|
| S1 | Deploy a 1-of-1 Safe (v1.4.1 SafeL2) through the official SafeProxyFactory<br>Safe 0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84, owner 0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4, threshold 1 | success | success ✓ | [0x07ab8d5e…](https://sepolia.basescan.org/tx/0x07ab8d5e8933bc608bc63293639c381dc8d46280ea5427194c776833a61a38e3) | 236,500 |  |  |
| S2 | execTransaction signed by the owner: the Safe sends 0.05 of its fee USDC back to the test wallet<br>Safe nonce 0; signed off-chain by the owner 0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4, relayed by the test wallet | success | success ✓ | [0x4f64581c…](https://sepolia.basescan.org/tx/0x4f64581ce7e29e46d78a26d2feef94d8dc03ac8a1ca426d18fe4438932adef86) | 101,669 | payer +0.05, safe -0.05 | payer 15.4925 → 15.5425<br>safe 0.1 → 0.05 |

### ERC20FeeProxy (USDC)

| # | Case | Expected | Actual | Tx | Gas used | Balance change (USDC) | Before → after |
|---|---|---|---|---|---|---|---|
| E1 | approve, then pay with a fee: merchant gets amount, EOA treasury gets fee, proxy keeps 0<br>setup: approve(proxy, amount + fee) [0xb0fbc3b3…](https://sepolia.basescan.org/tx/0xb0fbc3b32d424d5ec17bd0cd167f29dd082ada251aeb979de2a000cdf04c7bfb) (55437) | success | success ✓ | [0x599ddad8…](https://sepolia.basescan.org/tx/0x599ddad8873b3eb4c1e0851993b7099769218810984b8fa2a8869546f59fd160) | 105,958 | payer -1, merchant +0.995, treasury +0.005, proxy +0 | payer 20 → 19<br>merchant 0 → 0.995<br>treasury 0 → 0.005 |
| E2 | pay with a fee to the Safe treasury: the Safe receives the fee<br>setup: approve(proxy, amount + fee) [0x70554d3b…](https://sepolia.basescan.org/tx/0x70554d3b8dae6a692c51a5bdf50d8a5a533b801bcc8b01d40c837720e07c3e7e) (55437) | success | success ✓ | [0xf7d3213f…](https://sepolia.basescan.org/tx/0xf7d3213fc1df76865c327a49d5c124f788ef48f8d780a80713a225b71d0afe15) | 88,870 | payer -1, merchant +0.9, safe +0.1, proxy +0 | payer 19 → 18<br>merchant 0.995 → 1.895<br>safe 0 → 0.1 |
| E3 | zero fee: the treasury leg is skipped<br>setup: approve(proxy, amount) [0xc09c62ae…](https://sepolia.basescan.org/tx/0xc09c62aeca3f09f96a503c2116587c3a013ff3a06b75cab68832d5cde8f5a737) (55437) | success | success ✓ | [0x21cf7489…](https://sepolia.basescan.org/tx/0x21cf74893ae134edaf1e31c005972597bf639809ce2483891fd4336bf2be33c7) | 58,724 | payer -0.5, merchant +0.5, proxy +0 | payer 18 → 17.5<br>merchant 1.895 → 2.395 |
| E4 | empty payment reference (0x)<br>setup: approve [0x4c659d3b…](https://sepolia.basescan.org/tx/0x4c659d3b5763572afa6c6381f64a53f50b0b5ac41794a5e0b50551d29ae3bf2f) (55437) | success | success ✓ | [0x64b8c533…](https://sepolia.basescan.org/tx/0x64b8c533e0bddd1832260891695def384ad85f13f52385d4db208381737ee783) | 71,513 | payer -0.5025, merchant +0.5, treasury +0.0025, proxy +0 | payer 17.5 → 16.9975<br>merchant 2.395 → 2.895<br>treasury 0.005 → 0.0075 |
| E5 | all-zero payment reference (8 zero bytes)<br>setup: approve [0x441736c7…](https://sepolia.basescan.org/tx/0x441736c712d55f9b7ba90aeddff98046efa5c45736341eeeee6068b2b9020bd7) (55437) | success | success ✓ | [0xb7ebb92b…](https://sepolia.basescan.org/tx/0xb7ebb92bc19826e9b9e7514c1b4512772364e01c7a8ae91bcc2c560dc74d8959) | 71,662 | payer -0.5025, merchant +0.5, treasury +0.0025, proxy +0 | payer 16.9975 → 16.495<br>merchant 2.895 → 3.395<br>treasury 0.0075 → 0.01 |
| E6 | feeAddress = zero address with a zero fee<br>setup: approve [0x56f5daff…](https://sepolia.basescan.org/tx/0x56f5daff533ae550e34cf222972fb2c399658d2d9cb54b05c3d0baf1dba60a3d) (55437) | success | success ✓ | [0x98243afb…](https://sepolia.basescan.org/tx/0x98243afb897793b668cdd7a12def4571b58bb5d2999b440408b030d5d4a05101) | 58,484 | payer -0.5, merchant +0.5, proxy +0 | payer 16.495 → 15.995<br>merchant 3.395 → 3.895 |
| E7 | feeAddress = zero address with a NON-zero fee: the fee leg is skipped, but the event still reports the fee<br>setup: approve(proxy, amount only) [0x9a67b057…](https://sepolia.basescan.org/tx/0x9a67b05780b757894dcb55df25ff7e24dd3855a260110d9ecd876169f30f6db7) (55437)<br>Why the server never trusts the event alone: creditFeeProxy also needs the fee Transfer log to the treasury. | success | success ✓ | [0x7a647006…](https://sepolia.basescan.org/tx/0x7a6470064c3e75c5ddeab980417e8179485e09d1f99bd9fae5c463c0f6e703cf) | 58,534 | payer -0.5, merchant +0.5, proxy +0 | payer 15.995 → 15.495<br>merchant 3.895 → 4.395 |
| E8 | merchant is the payer (to = msg.sender)<br>setup: approve [0x1d172030…](https://sepolia.basescan.org/tx/0x1d172030cf7483583a90cd6ad827cde9e0fb43f258550f3ba8ada20697156b58) (55437) | success | success ✓ | [0xd337ea98…](https://sepolia.basescan.org/tx/0xd337ea98e45e155210573648016f24c7d0a750783c99c7676a70b86a82e6d51f) | 66,958 | payer -0.0025, treasury +0.0025, proxy +0 | payer 15.495 → 15.4925<br>treasury 0.01 → 0.0125 |
| E9 | no allowance: reverts, nothing moves<br>setup: approve(proxy, 0) [0xa5fcdf11…](https://sepolia.basescan.org/tx/0xa5fcdf11bc1bb1be840cde9ad1cf806e0361eb423c57c19f46917e67808b01c1) (35501)<br>eth_call first: reverted (`execution reverted`), no gas spent | revert | reverted ✓ | [0x02da5033…](https://sepolia.basescan.org/tx/0x02da5033a6b8efb05df6e6e24956c086530a7b0afc747530daff998fe833bb2d) | 47,373 | proxy +0 |  |
| E10 | allowance = amount only (short of amount + fee): reverts, the merchant leg is undone too<br>setup: approve(proxy, amount) [0xece0eaea…](https://sepolia.basescan.org/tx/0xece0eaeab14e8ac9b74b54d312da842ec4994f1ae64c23c5affbc5b008fbbde6) (55437)<br>eth_call first: reverted (`execution reverted`), no gas spent | revert | reverted ✓ | [0x0bcfedb9…](https://sepolia.basescan.org/tx/0x0bcfedb9c5d975e9d8693e98097456266acf7e2aba3ac1031e658a6a574f6e18) | 66,052 | proxy +0 |  |

### MockUSDT (USDT-style, no return value)

| # | Case | Expected | Actual | Tx | Gas used | Balance change (mUSDT) | Before → after |
|---|---|---|---|---|---|---|---|
| M1 | mint 10 mUSDT to the payer | success | success ✓ | [0xbe4e5201…](https://sepolia.basescan.org/tx/0xbe4e5201aa2ae2589151f7f72ddc2c2f0cb9417b89f4a4172624720b689c6844) | 68,881 | payer +10, proxy +0 | payer 0 → 10 |
| M2 | transfer (returns nothing) 0.5 to the merchant | success | success ✓ | [0x73d31fb2…](https://sepolia.basescan.org/tx/0x73d31fb2489989a7e63055650632d8252b7da6ba88c7fa0cf2a6a7f95f39fe2b) | 52,188 | payer -0.5, merchant +0.5, proxy +0 | payer 10 → 9.5<br>merchant 0 → 0.5 |
| M3 | approve(proxy, 0.3) from a zero allowance | success | success ✓ | [0xc93e3ac9…](https://sepolia.basescan.org/tx/0xc93e3ac9a787c221c5c2ee555c4bc28c2cb458d432c96a95e4e68924402f5553) | 46,707 | proxy +0 |  |
| M4 | approve(proxy, 1.005) while the allowance is non-zero: reverts (USDT rule)<br>eth_call first: reverted (`execution reverted: reset to 0 first`), no gas spent<br>allowance after: 0.3 (unchanged) | revert | reverted ✓ | [0xcec333d7…](https://sepolia.basescan.org/tx/0xcec333d7b094d10066aa8e94395368d759f151a8e4dd88677ff450438a0b648a) | 24,843 | proxy +0 |  |
| M5 | server's reset-then-approve (approveReset, approve(total)), then pay 1 + 0.005 fee through the proxy<br>setup: approve(proxy, 0.3): a non-zero allowance left over, as from an abandoned checkout [0x6136c691…](https://sepolia.basescan.org/tx/0x6136c69140fc01950265f869b7a06b4b93dbf87a2157dc4f01c11b7b40878650) (46707); server approveReset: approve(proxy, 0) [0x20c7080d…](https://sepolia.basescan.org/tx/0x20c7080d26d9da9b4dc3c528c0388616c03c26795f53a215dd503a33204dd92d) (24586); server approve: approve(proxy, total) [0x768f51c0…](https://sepolia.basescan.org/tx/0x768f51c01528186acf98ddc6eec7ebb5d1e42416388b15b349594785db592d45) (46707)<br>allowance after: 0; fee = 0.5% of the total, rounded down | success | success ✓ | [0x47c26d6d…](https://sepolia.basescan.org/tx/0x47c26d6d997c6a38fb43e176cb3e44ecc51239806fb1fc21ba49fdba6c581e32) | 75,130 | payer -1.005, merchant +0.999975, treasury +0.005025, proxy +0 | payer 9.5 → 8.495<br>merchant 0.5 → 1.499975<br>treasury 0 → 0.005025 |

### EthereumFeeProxy (native ETH)

| # | Case | Expected | Actual | Tx | Gas used | Balance change (ETH) | Before → after |
|---|---|---|---|---|---|---|---|
| N1 | transferWithReferenceAndFee: EOA merchant + EOA treasury | success | success ✓ | [0xe3ff79f4…](https://sepolia.basescan.org/tx/0xe3ff79f4ed44e95e71f6787b6f865cf23f5ec21af8fc1d417586f1c4aec74f44) | 99,381 | payer -0.000100596286080549, merchant +0.000099, treasury +0.000001, proxy +0 | payer 0.048976214315430045 → 0.048875618029349496<br>merchant 0 → 0.000099<br>treasury 0 → 0.000001 |
| N2 | zero fee | success | success ✓ | [0xed9fd45e…](https://sepolia.basescan.org/tx/0xed9fd45e47236d9420c3fa63288b19239477938134536b696da3f4605e26cc36) | 42,633 | payer -0.000100255798081533, merchant +0.0001, proxy +0 | payer 0.048875618029349496 → 0.048775362231267963<br>merchant 0.000099 → 0.000199 |
| N3 | fee to the Safe treasury: reverts (2300-gas transfer() cannot reach a Safe)<br>eth_call first: reverted (`execution reverted`), no gas spent<br>The CHOICE.md finding, live: coin payments stay plain transfers with the fee invoiced. | revert | reverted ✓ | [0x742e16bd…](https://sepolia.basescan.org/tx/0x742e16bd01c11dfa4f708881a997855f45c3d18d5708dd321e978a2ca4accb7a) | 50,117 | payer -0.000000300702084647, proxy +0 | payer 0.048775362231267963 → 0.048775061529183316 |
| N4 | merchant is a contract (the Safe), fee to an EOA: works (the merchant leg forwards all gas) | success | success ✓ | [0x57c8b127…](https://sepolia.basescan.org/tx/0x57c8b1272143d43b28067fe75ec6a28c2dac7ffe6985a35c6c7fa00920d736b5) | 55,710 | payer -0.000100334260084647, treasury +0.000001, safe +0.000099, proxy +0 | payer 0.048775061529183316 → 0.048674727269098669<br>treasury 0.000001 → 0.000002<br>safe 0 → 0.000099 |
| N5 | transferExactEthWithReferenceAndFee with overpayment: the rest is refunded to the payer | success | success ✓ | [0x9d657b66…](https://sepolia.basescan.org/tx/0x9d657b66d5f7259e76b774b9f561c274057c0448a7cea7be5111fbd9e69ef29e) | 56,220 | payer -0.000051337320093546, merchant +0.00005, treasury +0.000001, proxy +0 | payer 0.048674727269098669 → 0.048623389949005123<br>merchant 0.000199 → 0.000249<br>treasury 0.000002 → 0.000003 |

### Our server, end to end (`scripts/testnet-server-e2e.mjs`)

Transactions:

| Step | Tx | Status | Gas used |
|---|---|---|---|
| approve (server bytes) | [0x1fc98fb5…](https://sepolia.basescan.org/tx/0x1fc98fb5806310a35a1bcdd807381f21325e8e0430bfd2d1be597b3a4366d2fe) | success | 55,437 |
| transferFromWithReferenceAndFee (server bytes) | [0x78413f9b…](https://sepolia.basescan.org/tx/0x78413f9b0f4b3976f5cc9bb10d1e58cb05d7c05ca0ae430426434fda8ed56e9e) | success | 71,758 |
| approve for the spoof | [0x77ecb5ab…](https://sepolia.basescan.org/tx/0x77ecb5ab061a2d1a2966c58ced266cebfcefeae724b48c2f24cf179920b7cf00) | success | 55,437 |
| proxy call with feeAddress = payer (spoof) | [0xf9514199…](https://sepolia.basescan.org/tx/0xf9514199380c523638afdfdb0db22402d828679150397f58c56ddef36dce4884) | success | 66,958 |
| plain ETH transfer of 0.000105668 to the store | [0xe8d1b2f7…](https://sepolia.basescan.org/tx/0xe8d1b2f751d7e386a6cc47f3b65bde48eca51115c21ec2d087200c6a2691bcb8) | success | 21,000 |

Checks (15 of 15 passed):

| Check | Result | Tx | Balance change |
|---|---|---|---|
| owner signs in (SIWE, throwaway key) | ✓ |  |  |
| store wallet on Base Sepolia (testnet flag on): accepted and enabled | ✓ |  |  |
| USDC quote carries a split to our proxy and the treasury (0.5% fee, free allowance 0) | ✓ |  |  |
| on chain: the merchant got total - fee, the treasury got the fee | ✓ | [0x78413f9b…](https://sepolia.basescan.org/tx/0x78413f9b0f4b3976f5cc9bb10d1e58cb05d7c05ca0ae430426434fda8ed56e9e) | payer -1.009955, merchant +1.004955, treasury +0.005 |
| verify: 200, invoice paid | ✓ | [0x78413f9b…](https://sepolia.basescan.org/tx/0x78413f9b0f4b3976f5cc9bb10d1e58cb05d7c05ca0ae430426434fda8ed56e9e) |  |
| ledger: one payment, crediting the full quote, with the fee taken on chain | ✓ |  |  |
| ledger: one fee row, collected on chain in full, nothing left to bill | ✓ |  |  |
| the store invoice reads as paid | ✓ |  |  |
| re-using the hash on the same invoice: refused (409) | ✓ |  |  |
| re-using the hash on another invoice: refused (409) | ✓ |  |  |
| the fee was recorded once | ✓ |  |  |
| spoofed fee address: not credited (422), invoice stays open | ✓ | [0xf9514199…](https://sepolia.basescan.org/tx/0xf9514199380c523638afdfdb0db22402d828679150397f58c56ddef36dce4884) |  |
| ETH quote: priced by the Base Sepolia ETH / USD feed, no split (fee invoiced) | ✓ |  |  |
| ETH: verify 200, paid; fee accrued and left for the weekly statement (not on chain) | ✓ | [0xe8d1b2f7…](https://sepolia.basescan.org/tx/0xe8d1b2f751d7e386a6cc47f3b65bde48eca51115c21ec2d087200c6a2691bcb8) | merchant +0.000105668 ETH |
| ETH: re-using the hash is refused (409) | ✓ |  |  |

### Deployments

| Contract | Address | Tx | Gas used |
|---|---|---|---|
| ERC20FeeProxy | [`0xae5508e1509cce6a73b38d8b19fedfdbd0080c18`](https://sepolia.basescan.org/address/0xae5508e1509cce6a73b38d8b19fedfdbd0080c18) | [0xb76ad1ff…](https://sepolia.basescan.org/tx/0xb76ad1fff5845387ecc83e38c59e1a23b79afa20f6adb91f4ebabd3169c6a2c9) | 518,794 |
| EthereumFeeProxy | [`0xd302ce9e3048ad676c6e74be57042aca31e2957e`](https://sepolia.basescan.org/address/0xd302ce9e3048ad676c6e74be57042aca31e2957e) | [0xa184545d…](https://sepolia.basescan.org/tx/0xa184545d4c432caca885daf604dde1a0c871ee2f03c56968c0acedfb89a72a3e) | 581,753 |
| MockUSDT | [`0xc1560702f640166cb382331b5d3561072f6569be`](https://sepolia.basescan.org/address/0xc1560702f640166cb382331b5d3561072f6569be) | [0xe89056c9…](https://sepolia.basescan.org/tx/0xe89056c98a7756782dd62adac2a5dc63c14414f09d1a2916822feb373770ffe2) | 751,835 |
| Safe 1-of-1 (SafeProxyFactory v1.4.1) | [`0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84`](https://sepolia.basescan.org/address/0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84) | [0x07ab8d5e…](https://sepolia.basescan.org/tx/0x07ab8d5e8933bc608bc63293639c381dc8d46280ea5427194c776833a61a38e3) | 236,500 |

For ETH rows, the payer's change includes the gas paid. The merchant, treasury and Safe changes are exact.

## What this shows

- **The fee path works as the server expects.** One call pays the merchant `amount` and the treasury `fee`, from the
  payer. The proxy never holds a balance (`proxy +0` in every row). A Safe receives the fee (E2) and can spend it
  with an owner-signed `execTransaction` (S2).
- **USDT-style tokens work** (M5), including the server's own `approveReset` followed by `approve(total)`, which a
  USDT-style token requires (M4 shows the refusal without the reset).
- **Failures are atomic.** With no allowance (E9), or with an allowance that covers the merchant leg but not the fee
  (E10), the whole call reverts and nothing moves. The revert carries no reason: Circle USDC's reverting
  `transferFrom` returns error data that is neither 0 nor 32 bytes long, so the proxy's `safeTransferFrom` ends with
  `revert(0, 0)`.
- **The event alone proves nothing** (E7). With `feeAddress = 0` and a non-zero fee, the proxy skips the fee
  transfer but still emits `feeAmount`. `creditFeeProxy` already requires the fee `Transfer` log to the treasury, so
  such an event is not credited. The server run's spoof (a fee to a non-treasury address) was refused live.
- **Native coin stays off the proxy** (N3). A fee sent to a Safe through `EthereumFeeProxy` reverts, because its
  `transfer()` forwards only 2,300 gas. This confirms the CHOICE.md finding on chain. A Safe as the *merchant* is
  fine (N4).
- **The server end to end:** the store's USDC quote carried a split to our proxy and treasury. The wallet sent the
  server's own approve and proxy call data. `verify` marked the invoice paid and recorded the fee once, as collected
  on chain with nothing left to bill. The same hash was refused for the same invoice and for another one, and the
  spoofed fee address was not credited. The ETH quote had no split: a plain transfer was verified, and its fee was
  accrued for the weekly statement.

## How it was run

Requirements: Foundry and node (viem from `node_modules`). There are two kinds of variable:

- **Public addresses:** `MERCHANT_ADDR` and `TREASURY_ADDR`.
- **Private keys:** `TESTNET_PK` and `TREASURY_PK`. They live in a `KEY=VALUE` file outside the repo, and nothing
  prints or writes them.

```
cd contracts
forge script script/DeployFeeProxy.s.sol --rpc-url https://sepolia.base.org --private-key $TESTNET_PK --broadcast
cd ..
GULLY_TESTNET_ENV=/path/to/testnet.env node scripts/testnet-fee-proxy.mjs     # contract cases -> contracts/testnet-results.json
GULLY_TESTNET_ENV=/path/to/testnet.env node scripts/testnet-server-e2e.mjs    # server run (TEST_PORT, default 8797)
```

- `scripts/testnet-fee-proxy.mjs` reads the proxy addresses from Foundry's broadcast file, which is gitignored.
  `GULLY_TESTNET_RESUME=1` continues an interrupted run.
- The server reaches Base Sepolia only through `GULLY_TESTNET_CHAINS=84532` and `GULLY_FEEPROXY_84532=<proxy>`
  (`server/payments.mjs`). Both are unset in production and ignored when `NODE_ENV=production`, so production never
  offers a testnet. The e2e also sets `GULLY_PAY_MERCHANT_FREE_USD=0`, so the fee applies from the first dollar.
- The raw data (every hash, block, gas figure and balance) is in `contracts/testnet-results.json`.
- The server e2e needs the merchant fee wiring from `feat/merchant-feesplit` (commit `f52b34e`), which this branch is
  stacked on.

Transactions from interrupted attempts are also in the wallet's history. They are not cases:

- the first Safe (`0xdeD1774eFe4B72Ffe68F05044e4d55Fe66BBD21d`), deployed before a stale RPC read stopped that run;
- one `approve(proxy, 0)` on MockUSDT before M5 was retried;
- an approve and a proxy payment from the first server run
  ([0x7554d974…](https://sepolia.basescan.org/tx/0x7554d9748b5b87dc3cc7aeeae42deffa9ff8103e88a14a30bf536f5911e70479),
  [0x48476ae5…](https://sepolia.basescan.org/tx/0x48476ae52545812db07f0a61dde8d86cb8b7de9a422ac9bdffedf2204e53cc20)).
  That run stopped on the same stale read before it called `verify`.

Since then, every read is pinned to the latest mined block and retried while the load-balanced RPC lags.

## Safe deployment (one-click, `server/safe-deploy.mjs`)

Run on 2026-10-18 (UTC) on **Base Sepolia (84532)** with the same test wallet (`scripts/testnet-safe-deploy.mjs`, 12 of 12
steps passed; raw data in `contracts/testnet-safe-results.json`). The server never held a key: it built the factory call and the
test wallet signed and sent it, exactly as a merchant's or the admin's wallet does behind the "Deploy Safe on <chain>" button.

| Role | Address |
|---|---|
| Existing Safe from S1 (origin) | [`0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84`](https://sepolia.basescan.org/address/0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84) |
| **New Safe, deployed through the server's calldata** | [`0x396879A480516d94e7d0500134842a9db73Ee4aA`](https://sepolia.basescan.org/address/0x396879A480516d94e7d0500134842a9db73Ee4aA) |
| Owner of both (TREASURY_ADDR) | `0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4` |
| Payer / signer (test wallet) | `0x18D679735B5D4c5Ead2B0a3F12F12aF4bD110CAD` |
| Safe v1.4.1 SafeProxyFactory / SafeL2 / CompatibilityFallbackHandler | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` / `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` / `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |

### (a) Recovering an existing Safe's creation and predicting its address

| # | Step | Result |
|---|---|---|
| A1 | Find the creation of the S1 Safe without any hint: binary search over `eth_getCode` for the first block with code, then that block's `ProxyCreation` log | ✓ [0x07ab8d5e…](https://sepolia.basescan.org/tx/0x07ab8d5e8933bc608bc63293639c381dc8d46280ea5427194c776833a61a38e3), block 48258688, `saltNonce 0x1a14c8cd37b` |
| A2 | Decode the initializer: `setup([0x7329…bFA4], 1, 0, 0x, fallback 0x0, token 0x0, 0, 0x0)` | ✓ |
| A3 | Recompute CREATE2(factory, keccak(initializer) ++ saltNonce, keccak(proxyCreationCode ++ singleton)) | ✓ `0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84` = the Safe's address |
| A4 | Plan its copy on **OP Sepolia** (the factory, SafeL2 and handler are there with the pinned code hashes): 6 of 6 checks, predicted address equals the Safe's, 516-byte `createProxyWithNonce` calldata ready | ✓ not sent: the test wallets hold no OP Sepolia ETH |

### (b) A new Safe, built by the server and sent by the wallet

| # | Step | Result | Tx | Gas |
|---|---|---|---|---|
| B1 | `planNew`: 1-of-1 Safe, SafeL2 1.4.1, CompatibilityFallbackHandler, deterministic salt nonce `0xe1526eb333…` (scope `testnet`, salt `live-1792305590985`), predicted `0x396879A480516d94e7d0500134842a9db73Ee4aA`, gas estimate 262,468 (0.00000157 ETH) | ✓ | | |
| B2 | The address recomputed from the plan's own inputs before sending | ✓ equal | | |
| B3 | The wallet sends the server's calldata to the factory | ✓ | [0xed4c2827…](https://sepolia.basescan.org/tx/0xed4c2827c576e2885597974aadaf2fba3ac73a30ff907a977f66bd1fe1aa65d5) | 259,243 used |
| B4 | `deploymentStatus`: sent → mined (block 48268653) → verified: `eth_getCode` non-empty, `getOwners()` = [0x7329…bFA4], threshold 1, VERSION 1.4.1 | ✓ | | |
| B5 | Independent read with viem: 171 bytes of proxy code at the predicted address | ✓ | | |
| B6 | Planning the same Safe again: `alreadyDeployed`, kind `safe` | ✓ | | |
| B7 | Plan its copy on OP Sepolia from our record: same address, calldata byte-identical to Base Sepolia's | ✓ not sent | | |
| B8 | Forget the record and plan again: the chain's history recovers the same salt nonce and inputs | ✓ | | |

Payer balance 0.04851482 → 0.04851327 ETH: the only spend was B3's gas.

### (c) The same address on a second testnet

Not sent: neither test wallet holds OP Sepolia or Arbitrum Sepolia ETH (balances read 0 on 2026-10-17; Sepolia too). The
plan for OP Sepolia was computed live in A4 and B7 (factory, singleton and handler present with the pinned hashes,
predicted address equal, calldata identical). To finish it by hand:

1. Fund the test wallet on OP Sepolia (any faucet, ~0.001 ETH).
2. `GULLY_TESTNET_CHAINS=84532,11155420 GULLY_TESTNET_ENV=<env file> node scripts/testnet-safe-deploy.mjs` plans again, or
   call `planReproduce({ address, targetChainId: 11155420 })` from the module: the result's `tx.to` / `tx.data` are the call.
3. Send `tx` from the funded wallet (viem `sendTransaction`), then `deploymentStatus({ chainId: 11155420, hash, address })`
   until `verified`; the Safe appears at the same address on
   [sepolia-optimism.etherscan.io](https://sepolia-optimism.etherscan.io/address/0x396879A480516d94e7d0500134842a9db73Ee4aA).

In the app the same three steps are the button: the admin panel's **Treasury Safe** card and the merchant tab's wallet rows
show "Deploy Safe on <chain>" where the Safe has no code; the stepper runs sent → mined → verified and re-runs the chain
inspection. `npm run test:safe-deploy` covers the refusals the testnet cannot show (no factory, a tampered factory, a
prediction that differs, a fee-proxy target, a Safe with no origin) against the real Safe 1.4.1 bytes in
`scripts/fixtures/safe-v141.json`.
