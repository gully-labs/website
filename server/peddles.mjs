// Peddles and PeddleQuest, read straight from their contracts on Base, Robinhood Chain, Arc and BNB Chain.
//
// Peddles is a launchpad on Uniswap v4: every launch is a pool on the chain's canonical PoolManager that runs
// PeddlesFeeHook. So the hook's own PoolRegistered event is the pool registry, the PoolManager's Swap events on
// those pool ids are the trades, and the hook's FeeAccrued / SniperFeeAccrued events are the fees. Addresses come
// from Peddles' docs (https://docs.peddles.xyz/docs/addresses, the deployment table its docs bundle ships) and
// agree with DefiLlama's adapters (dimension-adapters helpers/peddles.ts, DefiLlama-Adapters projects/peddles);
// every one was read back with eth_getCode before it was written here, and is re-checked at runtime
// (verifyContracts) so a page never links a contract that is not there.
//
// What is read, per chain, from the deploy block of the fee hook, once (backfill), then incrementally:
//   - Peddles contracts (one eth_getLogs over all of them per range):
//       PeddlesFeeHook      PoolRegistered (launches) · FeeAccrued + SniperFeeAccrued (swap and opening fees)
//                           CreatorSwept · HoldersSwept (paid out to creators and to holders of the launched token)
//       launch collectors   LaunchFeePaid (PeddlesStockLaunchpad, both PeddlesLaunchOrchestratorV20 generations,
//                           PeddlesNFTFactory, PeddlesNFTBondingGraduationOrchestratorV20)
//       PeddlesFeeForwarder FeeCollected (the Terminal's and trade bot's fee)
//       PeddlesNFTFactory   CollectionCreated
//       PeddlesFlywheel     BuybackAndBurn (Base only: ETH in, PEDL burned)
//       PeddleQuest         QuestCreated + TreasuryAccrued (escrow), TreasuryAccrued (promotion market),
//                           FeeAccrued (badge)
//   - Uniswap v4 PoolManager, filtered to the registered pool ids: Swap (volume, current price),
//     ModifyLiquidity (positions, for value locked), Initialize (opening price).
//
// Dollar values: stablecoin legs at 1, ETH and BNB at the chain's Chainlink USD feed, tokenised stocks at their
// Chainlink feed (BNB Chain: times the token's uiMultiplier), each read at a block of the day the swap happened
// when the node keeps that state, otherwise at the latest block (counted, and said). An asset with no feed is
// never priced: its swaps are counted as "unpriced", never as $0.
//
// DefiLlama stays as a cross-check and as history until our backfill has covered a day on every chain. If our
// all-time differs from DefiLlama's by more than 10%, ours is shown with a footnote saying so, and it is logged.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak_256 } from './vendor/noble.mjs'
import { CHAINS as PAY_CHAINS } from './payments.mjs'
import { DATA_DIR } from './http.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const loadTable = (f) => JSON.parse(fs.readFileSync(path.join(here, 'data', f), 'utf8'))

/* ------------------------------------------------------------- helpers --- */

const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
export const topic = (sig) => '0x' + hexOf(keccak_256(new TextEncoder().encode(sig)))
const lc = (a) => String(a).toLowerCase()
const ZERO = '0x0000000000000000000000000000000000000000'
const DAY = 86400
const HOUR = 3600
const hexBlock = (n) => '0x' + Number(n).toString(16)
const word = (data, i) => BigInt('0x' + (data.slice(2 + 64 * i, 2 + 64 * (i + 1)) || '0'))
const sword = (data, i, bits = 256) => BigInt.asIntN(bits, word(data, i))
const addrTopic = (t) => '0x' + t.slice(26)
const pad32 = (a) => '0x' + lc(a).replace(/^0x/, '').padStart(64, '0')

/* -------------------------------------------------------------- events --- */

export const EV = {
  PoolRegistered: topic('PoolRegistered(bytes32,address,address,address,uint16,uint16,address)'),
  FeeAccrued: topic('FeeAccrued(bytes32,address,uint256,uint256,uint256,bool)'),
  SniperFeeAccrued: topic('SniperFeeAccrued(bytes32,address,uint256,uint256,uint256,bool)'),
  CreatorSwept: topic('CreatorSwept(bytes32,address,uint256)'),
  HoldersSwept: topic('HoldersSwept(bytes32,address,uint256)'),
  LaunchFeePaid: topic('LaunchFeePaid(address,uint256)'),
  FeeCollected: topic('FeeCollected(address,address,address,uint256,uint16)'),
  CollectionCreated: topic('CollectionCreated(address,address,uint8,string,string)'),
  BuybackAndBurn: topic('BuybackAndBurn(address,uint256,uint256)'),
  QuestCreated: topic('QuestCreated(bytes32,address,address,uint256,uint256,uint256,uint64)'),
  EscrowAccrued: topic('TreasuryAccrued(address,uint256,uint256)'),
  MarketAccrued: topic('TreasuryAccrued(uint256,uint256)'),
  BadgeFeeAccrued: topic('FeeAccrued(uint256,uint256)'),
  Swap: topic('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
  ModifyLiquidity: topic('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)'),
  Initialize: topic('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
}

/* -------------------------------------------------------------- chains --- */

// PeddleQuest: immutable, deployed from the same deployer nonce, so the same addresses on all four chains
// (DefiLlama dimension-adapters fees/peddlequest; Sourcify exact match). Re-checked by verifyContracts.
export const QUEST = {
  escrow: '0x16267bE6D067b3d411bf779B5aD041f9eba4CadE', // PeddlesQuestEscrow: reward pools
  market: '0x704E5eA6752EbfcEDB377512b67c0138461f4849', // PeddlesPromotionMarket: trending and banner slots
  badge: '0x6DA219d4072A91665F702e34ca6CcaCd3eA7AE91', // PeddlesQuestBadge: completion badges
}

const robinhoodStocks = loadTable('robinhood-stocks.json').stocks
const bscStocks = loadTable('bsc-stocks.json').stocks

/* One entry per chain. `contracts` is every contract Peddles' docs list for that chain (verified at runtime);
   `reads` are the ones whose events are read. `rpcs` are public defaults, replaced by GULLY_RPC_<chainId>. */
export const CHAINS = [
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    explorer: 'https://basescan.org',
    // thirdweb serves eth_getLogs over 1,000 blocks of old history; publicnode answers recent blocks only (archive
    // needs a token), mainnet.base.org rate-limits hard, drpc's free plan refuses old ranges (all checked 2026-10-18).
    rpcs: ['https://8453.rpc.thirdweb.com', 'https://base-rpc.publicnode.com', 'https://base.gateway.tenderly.co', 'https://mainnet.base.org', 'https://base.drpc.org', 'https://1rpc.io/base'],
    span: 1000,
    confirmations: 5,
    fromBlock: 51855962,
    poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
    feeHook: '0xAB8E39207718f519865D6f0d52eFB31b231D40cc',
    launchFeeCollectors: ['0x680805FBd0D6225d0bE4E12A2B73b2Ed83a31978', '0xB2f25Fd1b20269CD1553d63A942935Ab09F91978', '0x7e7E62B41E447B6526E89D0AAAd7Cac9FB9f1978', '0xd111413B91b0E31865464658071099779e2C1978', '0xB7bB0f25B1AE59adcAa2787C68cd50296d2B1978'],
    feeForwarder: '0x77886951f19458B2FC27D4373553001A620264D3',
    nftFactory: '0xd111413B91b0E31865464658071099779e2C1978',
    flywheel: '0x2E9366BF81d0D0ebA905927B55d3Fa3008891978',
    token: '0xCF2Be52981b5BD563C268a0e2b17D50B53e21978', // PEDL
    native: { kind: 'eth', decimals: 18, symbol: 'ETH' },
    feeds: { eth: PAY_CHAINS[8453].feed.address },
    assets: {
      '0x4200000000000000000000000000000000000006': { kind: 'eth', decimals: 18, symbol: 'WETH' },
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { kind: 'usd', decimals: 6, symbol: 'USDC' },
    },
    stocks: [],
  },
  {
    id: 4663,
    key: 'robinhood',
    name: 'Robinhood Chain',
    explorer: 'https://robinhoodchain.blockscout.com',
    // The chain's own RPC serves eth_getLogs over a million blocks and stamps every log with blockTimestamp.
    rpcs: ['https://rpc.mainnet.chain.robinhood.com', 'https://rpc.ordofi.network', 'https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org'],
    span: 500_000,
    confirmations: 20,
    fromBlock: 76092920,
    poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    feeHook: '0xfe055282E3cD471A8b2cd922d31E75ECd3bBc0CC',
    // The docs list 0x8BD4… as the current PeddlesLaunchOrchestratorV20 and 0x8121… as the first generation;
    // DefiLlama's adapter lists only the first, so both are read here.
    launchFeeCollectors: ['0x4b7Aa977eA4B95D9859D73e6bc922ecF2F881978', '0x8BD4Cdb2248E4a5443Acdf52b22FE1A4A2ca1978', '0x81213e2cE27f03714143152aE5cf5c94094f1978', '0x2e0029BeDCBb2f211Fd17EeBA8f40657cF6A1978', '0x6C5032DeDCc78b92b370C86a2aA0EA3AD0D71978'],
    feeForwarder: '0xc572A003d0Ab529da670a42177Fc583b03D5b026',
    nftFactory: '0x2e0029BeDCBb2f211Fd17EeBA8f40657cF6A1978',
    flywheel: null,
    native: { kind: 'eth', decimals: 18, symbol: 'ETH' },
    // ETH / USD on Robinhood Chain, the feed tracker.mjs reads (nativeUsdFeed).
    feeds: { eth: '0x78f3556b67e17df817d51ef5a990cdaf09e8d3a9' },
    assets: {
      '0x0bd7d308f8e1639fab988df18a8011f41eacad73': { kind: 'eth', decimals: 18, symbol: 'WETH' },
      '0x5fc5360d0400a0fd4f2af552add042d716f1d168': { kind: 'usd', decimals: 6, symbol: 'USDG' },
    },
    stocks: robinhoodStocks.map((s) => ({ token: lc(s.token), symbol: s.ticker, decimals: s.decimals, feed: s.feed, feedDecimals: s.feedDecimals, multiplier: false })),
  },
  {
    id: 5042,
    key: 'arc',
    name: 'Arc',
    explorer: 'https://explorer.arc.io',
    // Arc's RPCs as Peddles' own app lists them; rpc.mainnet.arc.io serves 5,000-block log ranges, beamrpc 1,000;
    // blockdaemon has pruned the history and drpc's free plan refuses old ranges.
    rpcs: ['https://rpc.mainnet.arc.io', 'https://rpc.quicknode.mainnet.arc.io', 'https://rpc.beamrpc.com', 'https://rpc.drpc.mainnet.arc.io', 'https://arc.drpc.org', 'https://rpc.blockdaemon.mainnet.arc.io'],
    span: 5000,
    confirmations: 2,
    fromBlock: 23687888,
    poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    feeHook: '0x317e34De0298F23bd41bf9A853289e227E9cC0CC',
    launchFeeCollectors: ['0x6B176b9FDB11ffDc35dDdC0839EB62D537Ee1978', '0xe7666f1D0d7b9026CaCAe4a267c14CD490c01978', '0x5762d02f271891d18a4f6AF48787Ed97904e1978', '0x4f5199cA08864A85da6AB483Da93b8e40E501978', '0x586afEdc7721076BD854c1eF560f90AE48Aa1978'],
    feeForwarder: '0xfe9563B7952fEB2091816133a22A4D62171fD77e',
    nftFactory: '0x4f5199cA08864A85da6AB483Da93b8e40E501978',
    flywheel: null,
    // Arc's gas token is USDC: 18 decimals as the native currency, 6 as the ERC-20 at 0x3600…0000.
    native: { kind: 'usd', decimals: 18, symbol: 'USDC' },
    feeds: {},
    assets: { '0x3600000000000000000000000000000000000000': { kind: 'usd', decimals: 6, symbol: 'USDC' } },
    stocks: [],
  },
  {
    id: 56,
    key: 'bsc',
    name: 'BNB Chain',
    explorer: 'https://bscscan.com',
    // BNB Chain's own dataseed nodes refuse eth_getLogs; thirdweb serves 1,000-block ranges.
    rpcs: ['https://56.rpc.thirdweb.com', 'https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://1rpc.io/bnb', 'https://bsc-dataseed.bnbchain.org'],
    span: 1000,
    confirmations: 5,
    fromBlock: 125076797,
    poolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
    feeHook: '0x39D760601731025e0F02A3e5D232445797fAC0CC',
    launchFeeCollectors: ['0xB2dea73eC6673d13e020E1e4eA966321790e1978', '0x87f4c95773eA0bD5dddF948e4F4Ef55a09791978', '0xa20C6ae36a5C5068E9290048f2D2B165ac5C1978', '0x533cBF74c6f2F0A96900F61A95E13D3c63d21978', '0x6e3F734BAA78205f91404178AB5Cb0C04aB61978'],
    feeForwarder: '0x97b0d349FFE2eD262654C60dCC04d9622970Ae4F',
    nftFactory: '0x533cBF74c6f2F0A96900F61A95E13D3c63d21978',
    flywheel: null,
    native: { kind: 'bnb', decimals: 18, symbol: 'BNB' },
    feeds: { bnb: PAY_CHAINS[56].feed.address },
    assets: {
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { kind: 'bnb', decimals: 18, symbol: 'WBNB' },
      '0x55d398326f99059ff775485246999027b3197955': { kind: 'usd', decimals: 18, symbol: 'USDT' },
      '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d': { kind: 'usd', decimals: 18, symbol: 'USD1' },
    },
    stocks: bscStocks.map((s) => ({ token: lc(s.token), symbol: s.ticker, decimals: s.decimals, feed: s.feed, feedDecimals: s.feedDecimals, multiplier: true })),
  },
]

/** Every contract Peddles' docs list per chain (plus PeddleQuest's), for verification and the project page.
    `reads` says which events we read from it; an empty list means it is listed and verified but not read. */
export const DOC_CONTRACTS = {
  8453: {
    PeddlesFeeHook: '0xAB8E39207718f519865D6f0d52eFB31b231D40cc', PoolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b', PeddlesFeeForwarder: '0x77886951f19458B2FC27D4373553001A620264D3', PeddlesFlywheel: '0x2E9366BF81d0D0ebA905927B55d3Fa3008891978', PeddlesToken: '0xCF2Be52981b5BD563C268a0e2b17D50B53e21978',
    PeddlesStockLaunchpad: '0x680805FBd0D6225d0bE4E12A2B73b2Ed83a31978', PeddlesLaunchOrchestratorV20: '0xB2f25Fd1b20269CD1553d63A942935Ab09F91978', 'PeddlesLaunchOrchestratorV20 (first generation)': '0x7e7E62B41E447B6526E89D0AAAd7Cac9FB9f1978', PeddlesNFTFactory: '0xd111413B91b0E31865464658071099779e2C1978', PeddlesNFTBondingGraduationOrchestratorV20: '0xB7bB0f25B1AE59adcAa2787C68cd50296d2B1978',
    PeddlesFactoryV20: '0x90bD4d38F621529b4aD6480c221075B7317b1978', PeddlesVaultFactoryV20: '0x80d0B683B5e8D4B4e669d0367C62fC9893F11978', PeddlesVaultRegistry: '0xb390c4A83D8B308b378250a59F273A7c9aDF1978', PeddlesHolderRewardsFactory: '0xE4A89dCb02211409b50CEFd9B570E67dA2aD1978', PeddlesNFTMarketplace: '0x5362a7DE96E8b3474Aef1a0fE6F6e2427Bd81978', PeddlesNftLiquidityReserve: '0x444C34FF8503eA088a36792659D7c34D7F931978', PeddlesNftFeeDistributorFactory: '0x9B0c155e7248706860c9707c2a8f41A0a2281978', PeddlesNftStockGraduationOrchestrator: '0xD6d41a5029EC7F78886C135A71A9c85e96781978', PeddlesPartnerFeeForwarder: '0xB31C7DcAd2b1e10B7FF67F376bE7235cbcD50dC0', PeddlesV4SwapRouter: '0xbf7A709cBf71b303B856126D3aEb5051a07c1978', PeddlesStockSwapRouter: '0xd150B1E102493e4F35A1e95DdA80948C0e581978', PeddlesRouteSwapRouter: '0x8f04A804Ba989d38A68D93eb8679d3a967f2b079', PeddlesV4LiquidityExecutor: '0x4Ca94531420F0e4f5a612475c8c4E35E9c8d1978', PeddlesLiquidityActivationManager: '0xa8bfd83d21eec43F9a984C6B13a31Ce1df191978', PeddlesStockVaultFactory: '0x5EF74DFc6Dfd9e5dAb314Df5747AC4E117e41978', PeddlesTransferValidator: '0xD1390f3E4741963A7eEd1E53163a1B09c97e1978', PeddlesHandleLauncher: '0xC4E82Bd9a0d3cfa00CdCc0de1ADfE0461B761978', PeddlesHandlePotFactory: '0xC2575Cc3Eb3934C826Fa33FC9BA2e6DA8186D725', PeddlesClogVaultFactory: '0x8563Aeec8C63d53BC8dfbE56FF9134a7b1e80503', PeddlesSnowballFactory: '0x249fcF53b13f3bd27e2969D5A3DF6f6B96aCDaAb', PeddlesSnowballHandleFactory: '0xa9657E7ECcf589bd9A3FD460bA4a610f310DfF1F', PeddlesSnowballVaultDeployer: '0x2B86071De444F68931FA91EF26B71D2c34bcf3b9', PeddlesSnowballHandleVaultDeployer: '0xdB3869F858fF95d99725a6b4a8a3dFfc2689947E', PositionManager: '0x7C5f5A4bBd8fD63184577525326123B519429bDc', StateView: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71',
  },
  4663: {
    PeddlesFeeHook: '0xfe055282E3cD471A8b2cd922d31E75ECd3bBc0CC', PoolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', PeddlesFeeForwarder: '0xc572A003d0Ab529da670a42177Fc583b03D5b026',
    PeddlesStockLaunchpad: '0x4b7Aa977eA4B95D9859D73e6bc922ecF2F881978', PeddlesLaunchOrchestratorV20: '0x8BD4Cdb2248E4a5443Acdf52b22FE1A4A2ca1978', 'PeddlesLaunchOrchestratorV20 (first generation)': '0x81213e2cE27f03714143152aE5cf5c94094f1978', PeddlesNFTFactory: '0x2e0029BeDCBb2f211Fd17EeBA8f40657cF6A1978', PeddlesNFTBondingGraduationOrchestratorV20: '0x6C5032DeDCc78b92b370C86a2aA0EA3AD0D71978',
    PeddlesFactoryV20: '0x51336A94B55Ad82D1099Dc82b27b151eDFfc1978', PeddlesVaultFactoryV20: '0x33c100477D9D2E5d0f0Ed9Ab82aa2ea62d601978', PeddlesVaultRegistry: '0xd322A44c4600dfDcF399Ceb7a32869e83d561978', PeddlesHolderRewardsFactory: '0xB22d6D7B1eC296AA79cbFf4ABE4992A726BE1978', PeddlesNFTMarketplace: '0xC0374a0776449fE60dD1653C6421bEB41e911978', PeddlesNftLiquidityReserve: '0x367F626775E22818C369BB3a276E3e9Fbc201978', PeddlesNftFeeDistributorFactory: '0x3081d5E69b7D12A330C9594C175F88EB77f31978', PeddlesNftStockGraduationOrchestrator: '0x3DAd8D2B78C8a71f01600FDecA0b17af5F961978', PeddlesPartnerFeeForwarder: '0x1d1f4293c1b5475aa7A4ae2e4475E85930F4906C', PeddlesV4SwapRouter: '0xDd1F65380C9f7283A61FC489DCAceA352ee31978', PeddlesStockSwapRouter: '0x5A934c5eE47daa3b4562f9Dc9224bB00e9191978', PeddlesRouteSwapRouter: '0xA4858047F9c7359CC0d9071598BFA74187739d8D', PeddlesV4LiquidityExecutor: '0xAB23BD1234AB1BCa48a97aB8e2baaFAaE7A21978', PeddlesLiquidityActivationManager: '0xBE8d8999b53c5E5249feBafe5f505221F3e41978', PeddlesStockVaultFactory: '0xa565E57046B51C4C1144b837A1871FF89c141978', PeddlesTransferValidator: '0x2ADA0EA86925b5EbA1CF7B75e0d606C89b1B1978', PeddlesHandleLauncher: '0x4930F82F2F92427CcFa1116ef0E68835328C1978', PeddlesHandlePotFactory: '0x2b5881c79a83C9EB17C67354F6737f3c9A120DE2', PeddlesClogVaultFactory: '0x1d2142699F1D818203738226240C605243a39b9e', PeddlesSnowballFactory: '0x8Bf9DD5E7a64e8818d170f857d146D34c48939E6', PeddlesSnowballHandleFactory: '0xD0CF6a70B4aB609d95A34B60a9D09a3DA3362245', PeddlesSnowballVaultDeployer: '0xe756a92cff0512BB87DeB784A6897f7a9E7b8a02', PeddlesSnowballHandleVaultDeployer: '0x9051ed499E496f4D45F848698c7589d54667483E', PositionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7', StateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
  },
  5042: {
    PeddlesFeeHook: '0x317e34De0298F23bd41bf9A853289e227E9cC0CC', PoolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', PeddlesFeeForwarder: '0xfe9563B7952fEB2091816133a22A4D62171fD77e',
    PeddlesStockLaunchpad: '0x6B176b9FDB11ffDc35dDdC0839EB62D537Ee1978', PeddlesLaunchOrchestratorV20: '0xe7666f1D0d7b9026CaCAe4a267c14CD490c01978', 'PeddlesLaunchOrchestratorV20 (first generation)': '0x5762d02f271891d18a4f6AF48787Ed97904e1978', PeddlesNFTFactory: '0x4f5199cA08864A85da6AB483Da93b8e40E501978', PeddlesNFTBondingGraduationOrchestratorV20: '0x586afEdc7721076BD854c1eF560f90AE48Aa1978',
    PeddlesFactoryV20: '0x1f9D8c53028d5289C9B206B6684bFC2BaC001978', PeddlesVaultFactoryV20: '0x760707bad60FbFcC4CDb21A3C894770010841978', PeddlesVaultRegistry: '0xD9d977FDc79B39f9c12c3D480E9ABd886F721978', PeddlesHolderRewardsFactory: '0x5Db48C3EfcacBd42539C766d1B4f8c32C15B1978', PeddlesNFTMarketplace: '0xa6Ac3Cc4126C171f948431D66b23ff5DFb861978', PeddlesNftLiquidityReserve: '0x268C91647cD5d884B99Fa25C6141A83df8BA1978', PeddlesNftFeeDistributorFactory: '0x32fC87f491F9F5e5FDd93c2175828A12eAa81978', PeddlesNftStockGraduationOrchestrator: '0x9aa971BA0698da9193535Dd0D1C70Af8945e1978', PeddlesPartnerFeeForwarder: '0x97b0d349FFE2eD262654C60dCC04d9622970Ae4F', PeddlesV4SwapRouter: '0xDD4fBa27a668F616dBb0b10c0881480bFAc31978', PeddlesStockSwapRouter: '0x02DCd8b32F98905F54425c64B9FB8e9717d11978', PeddlesRouteSwapRouter: '0x3a6a8e21Fc09d27fc3f9Ad57E012dA69032149D4', PeddlesV4LiquidityExecutor: '0xD4F4b9cddbbf62E5Af822118EF7e5e08a1301978', PeddlesLiquidityActivationManager: '0x3A1a67005100DEB206be2f9C5Ae3B665d08d1978', PeddlesStockVaultFactory: '0xF94B0Db7420A36a7E3c48c4F7907464B85241978', PeddlesTransferValidator: '0x141313774788Cecb1a58B9d93653D6df862C1978', PeddlesHandleLauncher: '0xA4336E83E3dd124Cd366705b5CC3C285BdfD1978', PeddlesHandlePotFactory: '0xeb4151af845A51a8d14917fA9dC47cAd208bEf8D', PeddlesClogVaultFactory: '0x019d6A0e4c8a0E585946eF12dCFA1e8E2f0BCd0b', PeddlesSnowballFactory: '0x2C322f48B2dD97f6c5050eDF5F349C7f70126dB5', PeddlesSnowballHandleFactory: '0xde677e2A912B0169716E10244921c90fbE88Dea3', PeddlesSnowballVaultDeployer: '0x6Eb675f991c4B7645660aCbc289AF41528886724', PeddlesSnowballHandleVaultDeployer: '0x540f0E93E6a9bE2A44e6f0290004EAae296cfD8D', PositionManager: '0x6049c9a0e26405C0985f9E3685C87d0aE917f82B', StateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
  },
  56: {
    PeddlesFeeHook: '0x39D760601731025e0F02A3e5D232445797fAC0CC', PoolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', PeddlesFeeForwarder: '0x97b0d349FFE2eD262654C60dCC04d9622970Ae4F',
    PeddlesStockLaunchpad: '0xB2dea73eC6673d13e020E1e4eA966321790e1978', PeddlesLaunchOrchestratorV20: '0x87f4c95773eA0bD5dddF948e4F4Ef55a09791978', 'PeddlesLaunchOrchestratorV20 (first generation)': '0xa20C6ae36a5C5068E9290048f2D2B165ac5C1978', PeddlesNFTFactory: '0x533cBF74c6f2F0A96900F61A95E13D3c63d21978', PeddlesNFTBondingGraduationOrchestratorV20: '0x6e3F734BAA78205f91404178AB5Cb0C04aB61978',
    PeddlesFactoryV20: '0x220F5e98C3085E34EE68298847Fb63a3132D1978', PeddlesVaultFactoryV20: '0xDE0A7E2aACD433846483F80160c25CB310A91978', PeddlesVaultRegistry: '0x3F6A92B1e758D4C95160C68859c79977A5d31978', PeddlesHolderRewardsFactory: '0xa298E61fa142FD4b402ce1d03F0F5b2Ba6261978', PeddlesNFTMarketplace: '0xD4682e185010f93a5Ce0Ba859cE3AD9c4FB11978', PeddlesNftLiquidityReserve: '0x8bE8A8EDefaD08345a8b53E1A6532E0ebF991978', PeddlesNftFeeDistributorFactory: '0x623E59f26b9C277F4481D2418d4665d255E31978', PeddlesNftStockGraduationOrchestrator: '0x46B2Ade88b098c7b5e3AB29cAE44EBb016cb1978', PeddlesPartnerFeeForwarder: '0x36b2fa3c827d5F2475254191209548364A6F9a88', PeddlesV4SwapRouter: '0x2ab259c52e93ef0bD6deecF98D60e2494F221978', PeddlesStockSwapRouter: '0x593d9Df3aAAcDC0466462107C14AB9Edf2711978', PeddlesRouteSwapRouter: '0xde677e2A912B0169716E10244921c90fbE88Dea3', PeddlesV4LiquidityExecutor: '0x8e13c0713733294a2DED1DcE71Df9cb5F4251978', PeddlesLiquidityActivationManager: '0xe01ba8A47da547BB72cD61100F3D50a627331978', PeddlesStockVaultFactory: '0x252A47c58E82C2f26eF910F25f94203680111978', PeddlesTransferValidator: '0x0bF567a2aaEe5426C3Db0519409367fC8b9d1978', PeddlesHandleLauncher: '0x328F5E4C10a410c85fF081823d97E07d8E931978', PeddlesHandlePotFactory: '0xeb4151af845A51a8d14917fA9dC47cAd208bEf8D', PeddlesClogVaultFactory: '0x019d6A0e4c8a0E585946eF12dCFA1e8E2f0BCd0b', PeddlesSnowballFactory: '0xe3c49423edFE54909BCB2B140eF15c401e645Bb1', PeddlesSnowballHandleFactory: '0xB31C7DcAd2b1e10B7FF67F376bE7235cbcD50dC0', PeddlesSnowballVaultDeployer: '0xd1ea1A3c3FF0A1BF6b18ADA64ad04E424C86b6d5', PeddlesSnowballHandleVaultDeployer: '0x9096740D9134876fb1f3e464f27C8904f3E5c881', PositionManager: '0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b', StateView: '0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4',
  },
}
for (const id of Object.keys(DOC_CONTRACTS)) Object.assign(DOC_CONTRACTS[id], { PeddlesQuestEscrow: QUEST.escrow, PeddlesPromotionMarket: QUEST.market, PeddlesQuestBadge: QUEST.badge })

/** What we read from each contract, by name (anything not here is verified and listed, not read). */
export const READS = {
  PeddlesFeeHook: ['PoolRegistered: launches', 'FeeAccrued, SniperFeeAccrued: swap and opening fees', 'CreatorSwept, HoldersSwept: paid out'],
  PoolManager: ['Swap: volume and price (Peddles pools only)', 'ModifyLiquidity: positions, for value locked', 'Initialize: opening price'],
  PeddlesFeeForwarder: ['FeeCollected: Terminal and trade bot fees'],
  PeddlesFlywheel: ['BuybackAndBurn: ETH spent, PEDL burned'],
  PeddlesStockLaunchpad: ['LaunchFeePaid: launch fees'],
  PeddlesLaunchOrchestratorV20: ['LaunchFeePaid: launch fees'],
  'PeddlesLaunchOrchestratorV20 (first generation)': ['LaunchFeePaid: launch fees'],
  PeddlesNFTFactory: ['LaunchFeePaid: launch fees', 'CollectionCreated: NFT collections'],
  PeddlesNFTBondingGraduationOrchestratorV20: ['LaunchFeePaid: launch fees'],
  PeddlesQuestEscrow: ['QuestCreated: quests and reward pools', 'TreasuryAccrued: quest fees'],
  PeddlesPromotionMarket: ['TreasuryAccrued: promotion fees'],
  PeddlesQuestBadge: ['FeeAccrued: badge fees'],
}

/* ---------------------------------------------------------------- rpc --- */

/* The same failover pattern as payments.mjs rpc(): each URL first proves it is on the chain (eth_chainId), a URL
   that times out, errors over HTTP or rate-limits steps aside for 30 s doubling to 10 min. Added here: a URL that
   refuses a log range remembers the largest span it will take, so a backfill uses each node within its limits. */
const RANGE_ERR = /range|too (large|many|big)|limit exceeded|max(imum)?[^0-9]{0,40}\d+\s*blocks|exceed|archive|pruned|history|10000 blocks|response size/i
// A range refusal that is about the node's history or plan, not the number of blocks asked for.
const HISTORY_ERR = /archive|pruned|history|plan|personal token|limit exceeded$/i
const cooling = new Map()
const chainOk = new Map()
const urlSpan = new Map()

export function rpcUrls(chain) {
  const env = String(process.env[`GULLY_RPC_${chain.id}`] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const all = env.length ? env : chain.rpcs
  const now = Date.now()
  return [...all.filter((u) => (cooling.get(u)?.until ?? 0) <= now), ...all.filter((u) => (cooling.get(u)?.until ?? 0) > now).sort((a, b) => cooling.get(a).until - cooling.get(b).until)]
}
function strike(url, minMs = 30_000) {
  const c = cooling.get(url) ?? { until: 0, strikes: 0 }
  c.strikes = Math.min(c.strikes + 1, 6)
  c.until = Date.now() + Math.max(minMs, Math.min(30_000 * 2 ** (c.strikes - 1), 600_000))
  cooling.set(url, c)
}
async function post(url, method, params, ms = 15_000) {
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(ms) })
  } catch (e) {
    throw Object.assign(new Error(`${new URL(url).host}: ${e?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}`), { nodeFault: true })
  }
  const text = await res.text()
  let j = null
  try {
    j = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  const msg = j?.error ? String(j.error.message ?? 'RPC error') : !res.ok ? `HTTP ${res.status}` : !j ? 'not a JSON-RPC answer' : null
  if (msg) throw Object.assign(new Error(msg), { nodeFault: !res.ok || /rate|too many|quota|api ?key|unauthori[sz]ed|forbidden|capacity|upgrade/i.test(msg), rangeFault: RANGE_ERR.test(msg) })
  return j.result
}

/** One JSON-RPC call on a chain through the failover. `span` (for eth_getLogs) skips nodes known to refuse it. */
export async function chainRpc(chain, method, params, { span = 0 } = {}) {
  let last
  let sizeFault = false
  let maxSpan = 0
  for (const url of rpcUrls(chain)) {
    if (span && (urlSpan.get(url) ?? Infinity) < span) continue
    try {
      if (!chainOk.get(url)) {
        const id = await post(url, 'eth_chainId', [])
        if (typeof id !== 'string' || Number(BigInt(id)) !== chain.id) throw Object.assign(new Error(`${new URL(url).host} is not on chain ${chain.id}`), { nodeFault: true })
        chainOk.set(url, true)
      }
      const out = await post(url, method, params)
      cooling.delete(url)
      return out
    } catch (e) {
      last = e
      const msg = String(e?.message ?? '')
      if (span && e.rangeFault) {
        const said = Number(/(\d{3,})/.exec(msg)?.[1] ?? 0)
        if (HISTORY_ERR.test(msg)) {
          // The node keeps no history this old (or its plan refuses it): rest it, whatever the span.
          strike(url, 600_000)
        } else {
          // The node refuses this many blocks: remember what it said it takes (or half), and ask again smaller.
          sizeFault = true
          const cap = said > 0 && said < span ? said : Math.max(1, Math.floor(span / 2))
          urlSpan.set(url, cap)
          maxSpan = Math.max(maxSpan, cap)
        }
      } else if (e.nodeFault) strike(url)
    }
  }
  // Only a size refusal asks the caller for a smaller range; anything else is an outage, retried later.
  throw Object.assign(last ?? new Error('no RPC configured'), { rangeFault: sizeFault, maxSpan: sizeFault ? maxSpan : 0 })
}
export const resetRpcForTest = () => (cooling.clear(), chainOk.clear(), urlSpan.clear())

/* ------------------------------------------------------------- decoding --- */

/** The addresses and topic0s of the Peddles-side query for a chain, and who may emit what. */
export function peddlesFilter(chain) {
  const emitters = new Map() // topic0 -> Set(address)
  const add = (t, ...as) => emitters.set(t, new Set([...(emitters.get(t) ?? []), ...as.filter(Boolean).map(lc)]))
  add(EV.PoolRegistered, chain.feeHook)
  add(EV.FeeAccrued, chain.feeHook)
  add(EV.SniperFeeAccrued, chain.feeHook)
  add(EV.CreatorSwept, chain.feeHook)
  add(EV.HoldersSwept, chain.feeHook)
  add(EV.LaunchFeePaid, ...chain.launchFeeCollectors)
  add(EV.FeeCollected, chain.feeForwarder)
  add(EV.CollectionCreated, chain.nftFactory)
  add(EV.BuybackAndBurn, chain.flywheel)
  add(EV.QuestCreated, QUEST.escrow)
  add(EV.EscrowAccrued, QUEST.escrow)
  add(EV.MarketAccrued, QUEST.market)
  add(EV.BadgeFeeAccrued, QUEST.badge)
  for (const [t, s] of emitters) if (!s.size) emitters.delete(t)
  const addresses = [...new Set([...emitters.values()].flatMap((s) => [...s]))]
  return { addresses, topics: [...emitters.keys()], emitters }
}

/**
 * Decodes one log into a typed event, or null when it is not one we read (or came from a contract that is not
 * the documented emitter of that event: same topic0 from another address is never trusted).
 */
export function decodeLog(log, chain, emitters) {
  const t0 = log.topics?.[0]
  const addr = lc(log.address)
  const d = log.data ?? '0x'
  if (lc(addr) === lc(chain.poolManager)) {
    const id = lc(log.topics[1])
    if (t0 === EV.Swap) return { e: 'swap', id, amount0: sword(d, 0, 128), amount1: sword(d, 1, 128), sqrtP: word(d, 2) }
    if (t0 === EV.ModifyLiquidity) return { e: 'liquidity', id, lo: Number(sword(d, 0, 24)), hi: Number(sword(d, 1, 24)), delta: sword(d, 2) }
    if (t0 === EV.Initialize) return { e: 'init', id, c0: addrTopic(log.topics[2]), c1: addrTopic(log.topics[3]), sqrtP: word(d, 3) }
    return null
  }
  if (!emitters.get(t0)?.has(addr)) return null
  switch (t0) {
    case EV.PoolRegistered:
      return { e: 'pool', id: lc(log.topics[1]), token: addrTopic(log.topics[2]), quote: addrTopic(log.topics[3]), creator: '0x' + d.slice(26, 66) }
    case EV.FeeAccrued:
      return { e: 'fee', id: lc(log.topics[1]), quote: addrTopic(log.topics[2]), amount: word(d, 0) + word(d, 1) + word(d, 2), creator: word(d, 1), holders: word(d, 2), kind: 'swap' }
    case EV.SniperFeeAccrued:
      return { e: 'fee', id: lc(log.topics[1]), quote: addrTopic(log.topics[2]), amount: word(d, 0) + word(d, 1) + word(d, 2), creator: word(d, 1), holders: 0n, kind: 'opening' }
    case EV.CreatorSwept:
      return { e: 'paid', id: lc(log.topics[1]), to: 'creators', amount: word(d, 0) }
    case EV.HoldersSwept:
      return { e: 'paid', id: lc(log.topics[1]), to: 'holders', amount: word(d, 0) }
    case EV.LaunchFeePaid:
      return { e: 'nativeFee', kind: 'launch', amount: word(d, 0) }
    case EV.FeeCollected:
      return { e: 'nativeFee', kind: 'terminal', amount: word(d, 0) }
    case EV.CollectionCreated:
      return { e: 'collection' }
    case EV.BuybackAndBurn:
      return { e: 'buyback', ethIn: word(d, 0), burned: word(d, 1) }
    case EV.QuestCreated:
      return { e: 'quest', rewardToken: addrTopic(log.topics[3]), funded: word(d, 1) }
    case EV.EscrowAccrued:
      return { e: 'questFee', asset: addrTopic(log.topics[1]), amount: word(d, 0) }
    case EV.MarketAccrued:
      return { e: 'questFee', asset: ZERO, amount: word(d, 0) }
    case EV.BadgeFeeAccrued:
      return { e: 'questFee', asset: ZERO, amount: word(d, 0) + word(d, 1) }
  }
  return null
}

/* ------------------------------------------------------------ v4 maths --- */

const Q96 = 2 ** 96
const sqrtAt = (tick) => Math.pow(1.0001, tick / 2)
/** Token amounts (raw, as floats) held by liquidity L between two ticks at the pool's current sqrt price. */
export function positionAmounts(L, lo, hi, sqrtPX96) {
  const l = Number(L)
  const s = Number(sqrtPX96) / Q96
  const a = sqrtAt(lo)
  const b = sqrtAt(hi)
  if (!(l > 0) || !(s > 0)) return { amount0: 0, amount1: 0 }
  if (s <= a) return { amount0: (l * (b - a)) / (a * b), amount1: 0 }
  if (s >= b) return { amount0: 0, amount1: l * (b - a) }
  return { amount0: (l * (b - s)) / (s * b), amount1: l * (s - a) }
}

/* ------------------------------------------------------------- pricing --- */

const LATEST_ROUND = '0xfeaf968c'
const UI_MULTIPLIER = '0xa60bf13d'

/** What an asset is, for pricing: { kind: 'usd'|'eth'|'bnb'|'stock'|null, decimals, symbol }. */
export function assetInfo(chain, address) {
  const a = lc(address)
  if (a === ZERO) return { ...chain.native }
  if (chain.assets[a]) return { ...chain.assets[a] }
  const s = chain.stocks.find((x) => x.token === a)
  if (s) return { kind: 'stock', decimals: s.decimals, symbol: s.symbol, stock: s }
  return { kind: null, decimals: null, symbol: null }
}

async function feedAnswer(chain, feed, decimals, block, rpc) {
  const out = await rpc(chain, 'eth_call', [{ to: feed, data: LATEST_ROUND }, block])
  if (typeof out !== 'string' || out.length < 2 + 64 * 5) throw new Error('unreadable feed answer')
  const answer = sword(out, 1)
  if (answer <= 0n) throw new Error('feed reports no price')
  return Number(answer) / 10 ** decimals
}

/**
 * A USD pricer for one chain. price(asset, block) -> { usd, latest } or null (cannot be priced). Prices are read at
 * `block` (a hex tag) and cached per asset and UTC day; a node without that state answers at 'latest' instead
 * (latest: true, and the caller counts it).
 */
export function makePricer(chain, rpc, { now = () => Date.now() } = {}) {
  const cache = new Map()
  async function read(info, tag) {
    if (info.kind === 'usd') return 1
    if (info.kind === 'eth' || info.kind === 'bnb') {
      const feed = chain.feeds[info.kind]
      if (!feed) return null
      return feedAnswer(chain, feed, 8, tag, rpc)
    }
    if (info.kind === 'stock') {
      const s = info.stock
      const share = await feedAnswer(chain, s.feed, s.feedDecimals, tag, rpc)
      if (!s.multiplier) return share
      const m = await rpc(chain, 'eth_call', [{ to: s.token, data: UI_MULTIPLIER }, tag])
      const mult = Number(word(m, 0)) / 1e18
      if (!(mult > 0)) throw new Error('multiplier unreadable')
      return share * mult
    }
    return null
  }
  return async function price(asset, block = 'latest', t = now() / 1000) {
    const info = assetInfo(chain, asset)
    if (!info.kind) return null
    if (info.kind === 'usd') return { usd: 1, latest: false, info }
    const live = block === 'latest' || now() / 1000 - t < 2 * HOUR
    const key = `${info.kind}:${lc(asset)}:${live ? 'live' : Math.floor(t / DAY)}`
    const hit = cache.get(key)
    if (hit && (!live || now() - hit.at < 60_000)) return hit.value
    let value = null
    try {
      const usd = await read(info, live ? 'latest' : block)
      value = usd === null ? null : { usd, latest: live, info }
    } catch {
      try {
        const usd = await read(info, 'latest')
        value = usd === null ? null : { usd, latest: true, info }
      } catch {
        value = null
      }
    }
    if (value) cache.set(key, { at: now(), value })
    return value
  }
}

/* --------------------------------------------------------------- state --- */

const emptyBucket = () => ({ vol: 0, swaps: 0, unpricedSwaps: 0, fees: 0, swapFees: 0, openingFees: 0, launchFees: 0, terminalFees: 0, unpricedFees: 0, creatorsPaid: 0, holdersPaid: 0, launches: 0, collections: 0, buybackUsd: 0, burned: 0, quests: 0, questRewards: 0, questFees: 0, questUnpriced: 0 })
export const emptyChainState = (chain) => ({ cursor: chain.fromBlock - 1, head: null, headAt: null, pools: {}, days: {}, hours: {}, latestPriced: 0, error: null, updatedAt: null })

const addTo = (map, t, f) => {
  const b = (map[t] ??= emptyBucket())
  f(b)
}

/** Interpolated timestamp for a block between two known (block, time) points. */
const interp = (n, a, b) => (b.n === a.n ? a.t : Math.round(a.t + ((b.t - a.t) * (n - a.n)) / (b.n - a.n)))

async function blockTime(chain, n, rpc) {
  const b = await rpc(chain, 'eth_getBlockByNumber', [hexBlock(n), false])
  if (!b?.timestamp) throw new Error(`block ${n} unreadable`)
  return Number(BigInt(b.timestamp))
}

/**
 * Applies one scanned range's logs to a chain's state. Pure apart from `price` (async). Logs must be from the
 * Peddles-side query and the PoolManager query of the same range, in any order: they are sorted by position.
 */
export async function applyLogs(st, chain, logs, { price, timeOf, emitters }) {
  const events = []
  for (const log of logs) {
    const ev = decodeLog(log, chain, emitters)
    if (ev) events.push({ ...ev, n: Number(BigInt(log.blockNumber)), i: Number(BigInt(log.logIndex ?? '0x0')), log })
  }
  // Registrations first: a pool's Initialize can precede its PoolRegistered in the same transaction (the hook
  // registers on afterInitialize), and nothing else of a pool can come before its registration.
  events.sort((a, b) => (a.e === 'pool' ? 0 : 1) - (b.e === 'pool' ? 0 : 1) || a.n - b.n || a.i - b.i)
  const usdOf = async (asset, raw, n, t) => {
    const p = await price(asset, hexBlock(n), t)
    if (!p || p.info.decimals === null) return null
    if (p.latest) st.latestPriced++
    return (Number(raw) / 10 ** p.info.decimals) * p.usd
  }
  for (const ev of events) {
    const t = await timeOf(ev.log, ev.n)
    const day = Math.floor(t / DAY) * DAY
    const hour = Math.floor(t / HOUR) * HOUR
    const both = (f) => (addTo(st.days, day, f), addTo(st.hours, hour, f))
    const pool = ev.id ? st.pools[ev.id] : null
    switch (ev.e) {
      case 'pool': {
        st.pools[ev.id] = { token: lc(ev.token), quote: lc(ev.quote), quoteIs0: BigInt(ev.quote) < BigInt(ev.token), block: ev.n, t, sqrtP: st.pools[ev.id]?.sqrtP ?? null, ranges: st.pools[ev.id]?.ranges ?? {} }
        both((b) => b.launches++)
        break
      }
      case 'init':
        if (pool) pool.sqrtP = ev.sqrtP.toString()
        break
      case 'liquidity':
        if (pool) {
          const k = `${ev.lo}:${ev.hi}`
          const next = BigInt(pool.ranges[k] ?? '0') + ev.delta
          if (next > 0n) pool.ranges[k] = next.toString()
          else delete pool.ranges[k]
        }
        break
      case 'swap': {
        if (!pool) break
        pool.sqrtP = ev.sqrtP.toString()
        const raw = pool.quoteIs0 ? ev.amount0 : ev.amount1
        const usd = await usdOf(pool.quote, raw < 0n ? -raw : raw, ev.n, t)
        both((b) => {
          b.swaps++
          if (usd === null) b.unpricedSwaps++
          else b.vol += usd
        })
        break
      }
      case 'fee': {
        const usd = await usdOf(ev.quote, ev.amount, ev.n, t)
        both((b) => {
          if (usd === null) b.unpricedFees++
          else {
            b.fees += usd
            if (ev.kind === 'swap') b.swapFees += usd
            else b.openingFees += usd
          }
        })
        break
      }
      case 'paid': {
        if (!pool) break
        const usd = await usdOf(pool.quote, ev.amount, ev.n, t)
        if (usd !== null) both((b) => (ev.to === 'creators' ? (b.creatorsPaid += usd) : (b.holdersPaid += usd)))
        break
      }
      case 'nativeFee': {
        const usd = await usdOf(ZERO, ev.amount, ev.n, t)
        both((b) => {
          if (usd === null) b.unpricedFees++
          else {
            b.fees += usd
            if (ev.kind === 'launch') b.launchFees += usd
            else b.terminalFees += usd
          }
        })
        break
      }
      case 'collection':
        both((b) => b.collections++)
        break
      case 'buyback': {
        const usd = await usdOf(ZERO, ev.ethIn, ev.n, t)
        both((b) => {
          b.burned += Number(ev.burned) / 1e18
          if (usd !== null) b.buybackUsd += usd
        })
        break
      }
      case 'quest': {
        const usd = await usdOf(ev.rewardToken, ev.funded, ev.n, t)
        both((b) => {
          b.quests++
          if (usd === null) b.questUnpriced++
          else b.questRewards += usd
        })
        break
      }
      case 'questFee': {
        const usd = await usdOf(ev.asset, ev.amount, ev.n, t)
        both((b) => (usd === null ? b.questUnpriced++ : (b.questFees += usd)))
        break
      }
    }
  }
  return events.length
}

/**
 * Scans one chain forward from its cursor: bounded ranges (the chain's span, halved when every node refuses it),
 * at most `budget` RPC calls, stopping at head minus confirmations. Saves through `save` after each range.
 * Returns { ranges, events, caughtUp }.
 */
export async function scanChain(st, chain, { rpc, price, budget = 60, deadline = Infinity, save = () => {}, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const { addresses, emitters } = peddlesFilter(chain)
  let calls = 0
  const call = (m, p, o) => (calls++, rpc(chain, m, p, o))
  const head = Number(BigInt(await call('eth_blockNumber', []))) - chain.confirmations
  st.head = head
  st.headAt = new Date(now()).toISOString()
  st.span ??= chain.span
  let ranges = 0
  let events = 0
  let outages = 0
  while (st.cursor < head && calls < budget && now() < deadline) {
    const from = st.cursor + 1
    const to = Math.min(head, from + st.span - 1)
    let logs
    try {
      // No topic filter on the Peddles side: some nodes (Arc's) refuse an OR list of a dozen topic0s as "range too
      // large", and these contracts emit little else. decodeLog keeps only the documented (emitter, event) pairs.
      const a = await call('eth_getLogs', [{ address: addresses, fromBlock: hexBlock(from), toBlock: hexBlock(to) }], { span: to - from + 1 })
      // Pools registered in this range are filtered for in the same range (Initialize and the launch's first
      // liquidity land in the same transaction as PoolRegistered).
      for (const l of a) if (l.topics?.[0] === EV.PoolRegistered && emitters.get(EV.PoolRegistered)?.has(lc(l.address))) st.pools[lc(l.topics[1])] ??= null
      const ids = Object.keys(st.pools)
      const b = []
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        // Any PoolManager event whose first indexed argument is one of these pool ids (Swap, ModifyLiquidity,
        // Initialize, Donate); decodeLog keeps the three we read.
        b.push(...(await call('eth_getLogs', [{ address: chain.poolManager, topics: [null, chunk], fromBlock: hexBlock(from), toBlock: hexBlock(to) }], { span: to - from + 1 })))
      }
      logs = [...a, ...b]
    } catch (e) {
      for (const [k, v] of Object.entries(st.pools)) if (v === null) delete st.pools[k]
      // A node that names its limit gets exactly that; otherwise halve, down to 50 blocks.
      if (e.rangeFault && e.maxSpan && e.maxSpan < st.span) {
        st.span = e.maxSpan
        continue
      }
      if (e.rangeFault && st.span > 50) {
        st.span = Math.max(50, Math.floor(st.span / 2))
        continue
      }
      // Every node failed (rate limits, mostly): back off 2, 4, 8 s within the pass before giving up until the next.
      if (++outages <= 3 && now() + 2000 * 2 ** outages < deadline) {
        await sleep(1000 * 2 ** outages)
        continue
      }
      throw e
    }
    for (const [k, v] of Object.entries(st.pools)) if (v === null) delete st.pools[k]
    // Timestamps: the log's own blockTimestamp where the node adds it, else interpolated across the range's ends.
    let ends = null
    const timeOf = async (log, n) => {
      if (log.blockTimestamp) return Number(BigInt(log.blockTimestamp))
      ends ??= { a: { n: from, t: await blockTime(chain, from, (c, m, p) => call(m, p)) }, b: { n: to, t: await blockTime(chain, to, (c, m, p) => call(m, p)) } }
      return interp(n, ends.a, ends.b)
    }
    events += await applyLogs(st, chain, logs, { price, timeOf, emitters })
    outages = 0
    st.cursor = to
    ranges++
    // A range that went through at full span lets the span grow back toward the chain's default.
    if (st.span < chain.span && ranges % 8 === 0) st.span = Math.min(chain.span, st.span * 2)
    if (ends) st.cursorAt = ends.b.t
    save()
  }
  // How far in time the scan has reached (for which days are fully counted): one block read per pass.
  if (ranges && st.cursor < head) {
    try {
      st.cursorAt = await blockTime(chain, st.cursor, (c, m, p) => call(m, p))
    } catch {
      /* keep the last known */
    }
  }
  if (st.cursor >= head) st.cursorAt = Math.floor(now() / 1000)
  // Hourly buckets older than 49 hours are only needed as days.
  const cut = Math.floor(now() / 1000) - 49 * HOUR
  for (const k of Object.keys(st.hours)) if (Number(k) < cut) delete st.hours[k]
  st.updatedAt = new Date(now()).toISOString()
  return { ranges, events, caughtUp: st.cursor >= head }
}

/** Value locked in a chain's Peddles pools now: both legs, the launched token at its own pool price. */
export async function chainTvl(st, chain, price) {
  let usd = 0
  let quoteUsd = 0
  let unpriced = 0
  for (const p of Object.values(st.pools)) {
    if (!p?.sqrtP) continue
    let a0 = 0
    let a1 = 0
    for (const [k, L] of Object.entries(p.ranges)) {
      const [lo, hi] = k.split(':').map(Number)
      const { amount0, amount1 } = positionAmounts(BigInt(L), lo, hi, BigInt(p.sqrtP))
      a0 += amount0
      a1 += amount1
    }
    if (!a0 && !a1) continue
    const px = await price(p.quote)
    if (!px || px.info.decimals === null) {
      unpriced++
      continue
    }
    const s = Number(BigInt(p.sqrtP)) / Q96
    const quoteRaw = p.quoteIs0 ? a0 : a1
    // The token leg in quote units at the pool's price (price of currency1 in currency0 is s^2).
    const tokenAsQuote = p.quoteIs0 ? a1 / (s * s) : a0 * s * s
    const q = (quoteRaw / 10 ** px.info.decimals) * px.usd
    quoteUsd += q
    usd += q + (tokenAsQuote / 10 ** px.info.decimals) * px.usd
  }
  return { usd, quoteUsd, unpriced }
}

/* ----------------------------------------------------------- summaries --- */

const sumBuckets = (map, pred = () => true) => {
  const out = emptyBucket()
  for (const [k, b] of Object.entries(map)) if (pred(Number(k))) for (const f of Object.keys(out)) out[f] += b[f] ?? 0
  return out
}

/** The figures for one chain from its state. `tvl` is from chainTvl (or null). */
export function chainSummary(st, chain, nowSec, tvl = null) {
  const today = Math.floor(nowSec / DAY) * DAY
  const all = sumBuckets(st.days)
  const h24 = sumBuckets(st.hours, (t) => t > nowSec - DAY)
  const d7 = sumBuckets(st.days, (t) => t > today - 7 * DAY)
  const d30 = sumBuckets(st.days, (t) => t > today - 30 * DAY)
  const head = st.head ?? st.cursor
  const span = Math.max(1, head - (chain.fromBlock - 1))
  const progress = Math.min(1, Math.max(0, (st.cursor - (chain.fromBlock - 1)) / span))
  return {
    chainId: chain.id,
    key: chain.key,
    name: chain.name,
    explorer: chain.explorer,
    caughtUp: st.head !== null && st.cursor >= st.head,
    progress,
    cursorBlock: st.cursor,
    headBlock: st.head,
    // The time the scan has reached: everything before it is counted.
    coveredUntil: st.cursorAt ? new Date(st.cursorAt * 1000).toISOString() : null,
    pools: Object.keys(st.pools).length,
    volumeAllUsd: all.vol,
    volume24hUsd: h24.vol,
    volume7dUsd: d7.vol,
    volume30dUsd: d30.vol,
    swaps: all.swaps,
    swaps24h: h24.swaps,
    unpricedSwaps: all.unpricedSwaps,
    feesAllUsd: all.fees,
    fees24hUsd: h24.fees,
    feesBy: { swap: all.swapFees, opening: all.openingFees, launch: all.launchFees, terminal: all.terminalFees },
    unpricedFees: all.unpricedFees,
    creatorsPaidUsd: all.creatorsPaid,
    holdersPaidUsd: all.holdersPaid,
    launches: all.launches,
    launches24h: h24.launches,
    collections: all.collections,
    buybackUsd: all.buybackUsd,
    pedlBurned: all.burned,
    quests: all.quests,
    questRewardsUsd: all.questRewards,
    questFeesUsd: all.questFees,
    questUnpriced: all.questUnpriced,
    tvlUsd: tvl ? tvl.usd : null,
    tvlQuoteUsd: tvl ? tvl.quoteUsd : null,
    tvlUnpricedPools: tvl ? tvl.unpriced : null,
    latestPriced: st.latestPriced,
    error: st.error,
    daily: Object.entries(st.days)
      .map(([t, b]) => ({ t: Number(t), v: b.vol, fees: b.fees, swaps: b.swaps, qf: b.questFees }))
      .sort((a, b) => a.t - b.t),
  }
}

/**
 * Merges our per-chain daily volume with DefiLlama's: a day is ours once every chain's scan has passed its end
 * (today: once every chain is caught up); before that, DefiLlama's figure for the day is used. Returns the
 * series and which days came from where.
 */
export function mergeDaily(chains, llamaDaily, nowSec, field = 'v') {
  const today = Math.floor(nowSec / DAY) * DAY
  const covered = (t) => chains.every((c) => (t === today ? c.caughtUp : c.coveredUntil && Date.parse(c.coveredUntil) / 1000 >= t + DAY))
  const ours = new Map()
  for (const c of chains) for (const p of c.daily) ours.set(p.t, (ours.get(p.t) ?? 0) + (p[field] ?? 0))
  const days = new Set([...ours.keys(), ...(llamaDaily ?? []).map((p) => p.t)])
  // Our days with no swaps on any chain are true zeros once covered.
  const first = Math.min(...[...days, today])
  for (let t = first; t <= today; t += DAY) days.add(t)
  const llama = new Map((llamaDaily ?? []).map((p) => [p.t, p.v]))
  const out = []
  let onchainDays = 0
  let llamaDays = 0
  for (const t of [...days].sort((a, b) => a - b)) {
    if (covered(t)) {
      out.push({ t, v: ours.get(t) ?? 0 })
      onchainDays++
    } else if (llama.has(t)) {
      out.push({ t, v: llama.get(t) })
      llamaDays++
    }
  }
  return { daily: out, onchainDays, llamaDays }
}

/** The divergence footnote, or null when within tolerance (or nothing to compare). */
export function divergence(ours, theirs, tolerance = 0.1) {
  if (!(ours > 0) || !(theirs > 0)) return null
  const pct = (ours - theirs) / theirs
  if (Math.abs(pct) <= tolerance) return null
  return { ours, theirs, pct }
}

/* ---------------------------------------------------------------- store --- */

const STATE_FILE = () => path.join(process.env.PEDDLES_STATE_DIR ?? DATA_DIR, 'peddles-onchain.json')
let state = null

export function loadState(file = STATE_FILE()) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j?.v === 1) return j
  } catch {
    /* first run */
  }
  return { v: 1, chains: {} }
}
export function saveState(s, file = STATE_FILE()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s))
    fs.renameSync(tmp, file)
  } catch (e) {
    console.error('peddles state:', e?.message ?? e)
  }
}

/* ------------------------------------------------------- contract checks --- */

let verified = { at: 0, byChain: {} }
/** eth_getCode for every documented contract, every six hours. A contract with no code is flagged, never linked. */
export async function verifyContracts({ rpc = chainRpc, force = false } = {}) {
  if (!force && Date.now() - verified.at < 6 * HOUR * 1000) return verified
  const byChain = {}
  await Promise.all(
    CHAINS.map(async (c) => {
      const rows = []
      for (const [name, address] of Object.entries(DOC_CONTRACTS[c.id])) {
        let code = null
        try {
          const out = await rpc(c, 'eth_getCode', [address, 'latest'])
          code = typeof out === 'string' ? (out.length - 2) / 2 : null
        } catch {
          code = null
        }
        rows.push({ name, address, verified: code === null ? null : code > 0, codeBytes: code, reads: READS[name] ?? [] })
      }
      byChain[c.id] = rows
    }),
  )
  verified = { at: Date.now(), byChain }
  return verified
}

/* ---------------------------------------------------------------- loop --- */

let running = null
let lastTick = 0
let loop = null
const tvlCache = new Map()
// Tests switch every upstream loop off with TRACKER_LOOP=off; this reader follows it, or PEDDLES_LOOP=off alone.
const loopOff = () => process.env.PEDDLES_LOOP === 'off' || process.env.TRACKER_LOOP === 'off'

/** One pass over every chain (in parallel), within a call budget each. Never throws. */
export async function tick({ budget = Number(process.env.PEDDLES_BUDGET) || 80, rpc = chainRpc, seconds = 45 } = {}) {
  if (running) return running
  running = (async () => {
    state ??= loadState()
    const deadline = Date.now() + seconds * 1000
    let dirty = 0
    const save = () => {
      if (++dirty % 10 === 0) saveState(state)
    }
    await Promise.all(
      CHAINS.map(async (c) => {
        const st = (state.chains[c.id] ??= emptyChainState(c))
        const price = makePricer(c, rpc)
        try {
          await scanChain(st, c, { rpc, price, budget, deadline, save })
          st.error = null
          if (st.cursor >= (st.head ?? Infinity)) tvlCache.set(c.id, { at: Date.now(), value: await chainTvl(st, c, price) })
        } catch (e) {
          st.error = String(e?.message ?? e).slice(0, 200)
        }
      }),
    )
    saveState(state)
    lastTick = Date.now()
  })().finally(() => (running = null))
  return running
}

/** Starts the background reader (server.mjs). PEDDLES_LOOP=off or TRACKER_LOOP=off leaves it off (tests). */
export function startPeddlesLoop(everyMs = 30_000) {
  if (loop || loopOff()) return
  tick().catch(() => {})
  loop = setInterval(() => tick().catch(() => {}), everyMs)
  loop.unref?.()
}

/** The current on-chain picture for /api/stats. Without the loop (dev, Vercel), a read kicks a bounded pass. */
export function onchainSnapshot(nowMs = Date.now()) {
  state ??= loadState()
  if (!loop && !running && nowMs - lastTick > 60_000 && !loopOff() && !process.env.GULLY_STANDBY) tick({ seconds: 20 }).catch(() => {})
  const nowSec = Math.floor(nowMs / 1000)
  const chains = CHAINS.map((c) => {
    const st = state.chains[c.id]
    if (!st) return { ...chainSummary(emptyChainState(c), c, nowSec), started: false }
    const tvl = tvlCache.get(c.id)?.value ?? null
    return { ...chainSummary(st, c, nowSec, tvl), started: true }
  })
  return { chains, at: new Date(nowMs).toISOString(), contracts: verified.byChain }
}

/** GET /api/peddles/onchain: every chain's figures with its daily rows, and every documented contract with
    whether it has code on chain and what we read from it. */
export async function handlePeddlesOnchain() {
  await Promise.race([verifyContracts().catch(() => null), new Promise((r) => setTimeout(r, 8000))])
  const snap = onchainSnapshot()
  return {
    at: snap.at,
    live: snap.chains.every((c) => c.started && c.caughtUp),
    chains: snap.chains,
    contracts: Object.fromEntries(CHAINS.map((c) => [c.id, verified.byChain[c.id] ?? Object.entries(DOC_CONTRACTS[c.id]).map(([name, address]) => ({ name, address, verified: null, codeBytes: null, reads: READS[name] ?? [] }))])),
  }
}

export const _setStateForTest = (s) => (state = s)
