// Harness for scripts/e2e.mjs: boots the real server in this process against the built dist/ with a temp
// DATA_DIR, with every outbound call the SERVER makes stubbed (globalThis.fetch is replaced before the
// server loads), and gives the browser side fixtures and page checks.
//
// Server-side stubs (no network): Anthropic (Gully AI), Telegram Bot API, JSON-RPC for every payment chain
// (Chainlink feeds, blocks), DeepCore, the venue stats APIs and DexScreener/GeckoTerminal (refused, so the
// tracker's own build fails fast; the browser gets fixtures for /api/tracker*). Anything else outbound is
// refused and recorded in `blockedOutbound`, and the suite fails if any were made.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DIST = path.join(ROOT, 'dist')

const word = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const nowSec = () => Math.floor(Date.now() / 1000)

/* ------------------------------------------------------------- tracker fixture --- */

const readTable = (key) => JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data', `${key}-stocks.json`), 'utf8')).stocks
const CHAINS = [
  { key: 'robinhood', id: 4663, name: 'Robinhood Chain', session: '24/5' },
  { key: 'bsc', id: 56, name: 'BNB Chain', session: 'NYSE hours' },
]

/** A deterministic /api/tracker body in the server's own shape (server/tracker.mjs build()). */
export function trackerFixture(at = Date.now()) {
  const iso = new Date(at).toISOString()
  const rows = []
  for (const c of CHAINS) {
    readTable(c.key).forEach((s, i) => {
      const fair = 50 + ((i * 37) % 400) + 0.25
      const gapPct = [0.12, -0.4, 2.6, -3.1, 0.8, -1.6, 4.2, 0][i % 8]
      const status = Math.abs(gapPct) <= 1 ? 'in-line' : gapPct > 0 ? 'premium' : 'discount'
      const onchain = +(fair * (1 + gapPct / 100)).toFixed(4)
      rows.push({
        chain: c.key,
        ticker: s.ticker,
        name: s.name,
        token: s.token,
        feed: s.feed,
        fair,
        feedPrices: s.prices,
        multiplier: c.key === 'bsc' ? 1 : null,
        feedUpdatedAt: iso,
        feedError: null,
        onchain,
        gapPct,
        status,
        rawGapPct: gapPct,
        trusted: true,
        untrustedReason: null,
        onchainSource: 'chain',
        onchainAt: iso,
        pool: { dex: 'uniswap', labels: ['v3'], against: 'USDC', url: `https://dexscreener.com/${c.key}/0x${'1'.repeat(40)}`, pair: '0x' + '1'.repeat(40), liquidityUsd: 2_500_000 + i * 1000, volume24hUsd: 180_000 + i * 500, pools: 1, totalLiquidityUsd: 2_500_000 + i * 1000, totalVolume24hUsd: 180_000 + i * 500, readableOnChain: true },
        poolError: null,
        logo: null,
        chainLogo: null,
        poolStale: false,
      })
    })
  }
  return {
    generatedAt: iso,
    chains: CHAINS.map((c) => ({ key: c.key, id: c.id, name: c.name, sessionOpen: true, sessionName: c.session, poolsAsOf: iso, poolsStale: false, poolSource: 'on chain', fairMethod: 'Chainlink feed' })),
    rules: { minLiquidityUsd: 10_000, inLinePct: 1, flagPct: 2, implausiblePct: 15, trustLiquidityUsd: 1_000_000, unitsRatio: 5 },
    sources: { fair: 'Chainlink (e2e fixture)', onchain: 'pools (e2e fixture)', tables: [] },
    rows,
  }
}

/** /api/tracker/history: [unixSeconds, gapPct, onchain, fair][] over `days`, hourly. */
export function historyFixture(chain, ticker, days = 7) {
  const end = nowSec()
  const points = []
  for (let t = end - days * 86400; t <= end; t += 3600) {
    const k = (t / 3600) % 48
    const gap = +(Math.sin(k / 7) * 1.8).toFixed(3)
    const fair = 180 + Math.sin(k / 11) * 4
    points.push([t, gap, +(fair * (1 + gap / 100)).toFixed(3), +fair.toFixed(3)])
  }
  return { chain, ticker, days, points }
}

/* ------------------------------------------------------------- Holder Map fixture --- */

export const E2E_LAUNCH_TOKEN = '0x8d901a1b3f3a57f9c36a71382fa183476c41545b'

/**
 * A deterministic /api/holders body in the server's shape (server/holders.mjs buildMap, src/lib/holders.ts):
 * 30 wallets with a pool, a lock and a burn address, two clusters, bundled buyers and the deployer for a
 * launch, the fair-price overlay for a stock, and 24 replay frames.
 */
export function holdersFixture(kind = 'deepcore-launch', at = Date.now()) {
  const addr = (i) => '0x' + (0xa11ce000 + i * 7919).toString(16).padStart(40, '0')
  const launch = kind === 'deepcore-launch'
  const raw = Array.from({ length: 30 }, (_, i) => 1000 / (i + 1) ** 1.15)
  const total = raw.reduce((a, b) => a + b, 0)
  const labels = { 0: { kind: 'pool', name: 'DeepCore pools (vault)' }, 4: { kind: 'lock', name: 'DeepCore launch lock' }, 9: { kind: 'burn', name: 'Burn (dead address)' }, ...(launch ? { 3: { kind: 'deployer', name: 'Deployer' } } : { 6: { kind: 'exchange', name: 'Binance 8' } }) }
  const clusterA = [1, 2, 5, 7, 11]
  const clusterB = [8, 13, 17]
  const nodes = raw.map((v, i) => {
    const pct = Math.round((v / total) * 10000) / 100
    const flags = []
    if (launch && [2, 5, 12].includes(i)) flags.push('bundled')
    if (launch && i === 3) flags.push('deployer')
    if (launch && [7, 11].includes(i)) flags.push('funded-by-deployer')
    return {
      id: addr(i),
      short: `${addr(i).slice(0, 6)}…${addr(i).slice(-4)}`,
      rank: i + 1,
      balance: Math.round(v * 1_000_000),
      pct,
      label: labels[i] ?? null,
      contract: [0, 4, 9].includes(i),
      cluster: clusterA.includes(i) || (launch && i === 3) ? 'c1' : clusterB.includes(i) ? 'c2' : null,
      flags,
      url: `https://robinhoodchain.blockscout.com/address/${addr(i)}`,
      ...(launch ? {} : { valueAtFairUsd: Math.round(v * 1_000_000 * 180), premiumUsd: Math.round(v * 1_000_000 * 180 * 0.026), boughtGapPct: i % 3 === 0 ? 1.2 : null }),
    }
  })
  const pair = (a, b, n, k = 'transfer') => ({ source: addr(a), target: addr(b), transfers: n, pct: 0.4, kind: k })
  const via = '0x' + 'feed'.repeat(10)
  const viaLinks = [{ source: addr(14), target: via, transfers: 2, pct: null, kind: 'via' }, { source: via, target: addr(20), transfers: 2, pct: null, kind: 'via' }]
  const links = [...viaLinks, pair(1, 2, 4), pair(2, 5, 2), pair(5, 7, 1), pair(7, 11, 3), pair(8, 13, 2), pair(13, 17, 1), ...(launch ? [pair(3, 7, 1, 'funding'), pair(3, 11, 1, 'funding'), pair(3, 1, 2)] : [])]
  const sum = (ids) => Math.round(ids.reduce((s, i) => s + nodes[i].pct, 0) * 100) / 100
  const c1 = launch ? [...clusterA, 3] : clusterA
  const clusters = [
    { id: 'c1', wallets: c1.map(addr), count: c1.length, pct: sum(c1), hasDeployer: launch },
    { id: 'c2', wallets: clusterB.map(addr), count: clusterB.length, pct: sum(clusterB), hasDeployer: false },
  ]
  const people = nodes.filter((n) => !n.label || n.label.kind === 'deployer')
  const top10 = Math.round(people.slice(0, 10).reduce((s, n) => s + n.pct, 0) * 100) / 100
  const frames = Array.from({ length: 24 }, (_, f) => ({
    block: 85_689_748 + f * 1200,
    at: new Date(at - (24 - f) * 3_600_000).toISOString(),
    pcts: nodes.map((n, i) => Math.round(n.pct * Math.min(1, (f + 1) / (6 + (i % 5) * 3)) * 100) / 100),
    top10Pct: Math.round(top10 * Math.min(1, (f + 4) / 20) * 100) / 100,
    holders: launch ? 3 + f * 2 : null,
  }))
  const line = `Top 10 wallets hold ${Math.round(top10)}%; the largest connected cluster holds ${Math.round(clusters[0].pct)}% across ${clusters[0].count} wallets.`
  return {
    state: 'ok',
    kind,
    chain: { key: 'robinhood', id: 4663, name: 'Robinhood Chain' },
    token: { address: launch ? E2E_LAUNCH_TOKEN : '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', symbol: launch ? 'DTC' : 'NVDA', name: launch ? null : 'NVIDIA', decimals: 18, supply: launch ? 1_000_000_000 : null, url: 'https://robinhoodchain.blockscout.com/address/x' },
    asOf: new Date(at - 120_000).toISOString(),
    sources: launch ? { holders: 'DeepCore’s log index: all 812 transfers since launch (exact balances)', links: 'Direct transfers between the mapped wallets, since launch' } : { holders: 'Blockscout (top 50 holders)', links: 'Direct transfers between the mapped wallets in the latest 5,000 transfers' },
    holders: { count: launch ? 41 : 18_204, shown: 30, graph: 30, sharesOf: launch ? 'total supply' : 'total supply', partial: null },
    tier: 'pro',
    locked: [],
    features: { replay: true, csv: true, alerts: true, holders: 500, gated: false, liveMinutes: null },
    nodes,
    links,
    clusters,
    legend: [
      ...(launch ? [{ kind: 'deployer', text: 'Deployer (created the launch)' }] : []),
      { kind: 'pool', text: 'Trading pool' },
      { kind: 'lock', text: 'Liquidity or token lock' },
      { kind: 'burn', text: 'Burned (no one can spend it)' },
      ...(launch ? [] : [{ kind: 'exchange', text: 'Exchange' }]),
    ],
    summary: {
      top10Pct: top10,
      largestCluster: { pct: clusters[0].pct, wallets: clusters[0].count },
      line,
      plain: [`The 10 biggest wallets (not counting pools, locks, burn and exchanges) own ${Math.round(top10)}% of all ${launch ? 'DTC' : 'NVDA'}.`, `${clusters[0].count} of the biggest wallets have sent tokens to each other: together they hold ${Math.round(clusters[0].pct)}%.`],
    },
    forensics: launch
      ? { snipers: { wallets: 2, pct: 2.5, blocks: 3 }, deployer: addr(3), launchBlock: 85_689_748, firstTradeBlock: 85_689_760, bundled: { wallets: 3, pct: sum([2, 5, 12]), firstBlockBuyers: 3 }, funded: { wallets: 2, pct: sum([7, 11]), coinChecked: false, coinNote: 'Coin transfers from the deployer are not checked yet.' }, deployerPct: nodes[3].pct, liquidity: { locked: true, locker: addr(4), since: new Date(at - 86_400_000).toISOString() }, buyers: 38, riskLine: `3 wallets bought in the first block of trading and hold ${Math.round(sum([2, 5, 12]))}% now.` }
      : null,
    fair: launch ? null : { fair: 180, onchain: 184.68, gapPct: 2.6, status: 'premium', top10ValueAtFairUsd: 1_250_000_000, top10PremiumUsd: 32_500_000, buyersAvgGapPct: 1.2, buyers: 4 },
    timeline: { basis: launch ? 'every transfer since launch' : 'rolled back from today over the latest transfers', frames },
    hidden: [{ via, short: `${via.slice(0, 6)}…${via.slice(-4)}`, url: `https://robinhoodchain.blockscout.com/address/${via}`, connects: [addr(14), addr(20)], transfers: 2 }],
    live: { supported: launch, cursor: launch ? 85_700_000 : null },
    health: launch
      ? {
          score: 58,
          level: 'mixed',
          verdict: 'Liquidity is locked, but three wallets bundled the first block and still hold 14%.',
          counted: 5,
          parts: [
            { id: 'liquidity', label: 'Liquidity locked', weight: 25, points: 25, value: 'Locked', reason: 'The launch liquidity sits in DeepCore’s launch lock.', wallets: [] },
            { id: 'bundle', label: 'Bundled buys', weight: 20, points: 6, value: '3 wallets · 14%', reason: 'Three wallets bought in the first block of trading.', wallets: [addr(2), addr(5), addr(12)] },
            { id: 'snipers', label: 'Snipers', weight: 15, points: 9, value: '2 wallets · 2.5%', reason: 'Two wallets bought in the first 3 blocks.', wallets: [addr(15), addr(16)] },
            { id: 'deployer', label: 'Deployer’s share', weight: 15, points: 8, value: `${nodes[3].pct}%`, reason: 'The deployer still holds a share.', wallets: [addr(3)] },
            { id: 'top10', label: 'Top 10 wallets', weight: 15, points: 10, value: `${Math.round(top10)}%`, reason: 'Concentration of the ten biggest wallets.', wallets: people.slice(0, 10).map((n) => n.id) },
            { id: 'record', label: 'Deployer’s record', weight: 10, points: null, value: 'not known', reason: 'Earlier launches could not be read just now.', wallets: [] },
          ],
        }
      : null,
    deployerHistory: launch
      ? {
          checked: true,
          reason: null,
          total: 2,
          serial: true,
          launches: [
            { chainKey: 'robinhood', token: '0x' + 'ab'.repeat(20), symbol: 'OLD1', createdAt: new Date(at - 30 * 86_400_000).toISOString(), outcome: 'liquidity-pulled', note: 'Liquidity was withdrawn 2 days after launch.', path: `/holders/robinhood/0x${'ab'.repeat(20)}` },
            { chainKey: 'base', token: '0x' + 'cd'.repeat(20), symbol: 'OLD2', createdAt: new Date(at - 12 * 86_400_000).toISOString(), outcome: 'trading', note: 'Still trading.', path: `/holders/base/0x${'cd'.repeat(20)}` },
          ],
        }
      : null,
    crossToken: launch ? { cluster: 'c1', checkedWallets: 6, line: '4 wallets of the largest cluster also hold OLD1.', tokens: [{ chainKey: 'robinhood', token: '0x' + 'ab'.repeat(20), symbol: 'OLD1', wallets: 4, path: `/holders/robinhood/0x${'ab'.repeat(20)}` }] } : null,
  }
}

/** The other Holder Map endpoints (server/holders.mjs), deterministic: resolve, the checked-launch feed, top scanned, live, wallet and Gully AI. */
export function holdersExtraFixtures(at = Date.now()) {
  const launch = holdersFixture('deepcore-launch', at)
  const path = `/holders/robinhood/${E2E_LAUNCH_TOKEN}`
  const tok = (i) => '0x' + String(i).repeat(40).slice(0, 40)
  const feedRow = (i, score, level) => ({ chainKey: 'robinhood', chainName: 'Robinhood Chain', token: tok(i), symbol: `NEW${i}`, createdAt: new Date(at - i * 600_000).toISOString(), state: 'checked', health: { score, level, verdict: `Launch ${i}` }, riskLine: `${i} wallets bought in the first block of trading.`, path: `/holders/robinhood/${tok(i)}` })
  return {
    resolve: (q) => ({
      matches:
        /^dtc$/i.test(q) || q.toLowerCase() === E2E_LAUNCH_TOKEN
          ? [{ chain: 'robinhood', chainName: 'Robinhood Chain', token: E2E_LAUNCH_TOKEN, symbol: 'DTC', kind: 'deepcore-launch', path }]
          : /^nvda$/i.test(q)
            ? [
                { chain: 'robinhood', chainName: 'Robinhood Chain', token: 'NVDA', symbol: 'NVDA', kind: 'stock', path: '/holders/robinhood/NVDA' },
                { chain: 'bsc', chainName: 'BNB Chain', token: 'NVDA', symbol: 'NVDA', kind: 'stock', path: '/holders/bsc/NVDA' },
              ]
            : [],
    }),
    launches: {
      asOf: new Date(at - 20_000).toISOString(),
      launches: [
        { chainKey: 'robinhood', chainName: 'Robinhood Chain', token: E2E_LAUNCH_TOKEN, symbol: 'DTC', createdAt: new Date(at - 7 * 86_400_000).toISOString(), state: 'checked', health: { score: launch.health.score, level: launch.health.level, verdict: launch.health.verdict }, riskLine: launch.forensics.riskLine, path },
        feedRow(2, 82, 'good'),
        feedRow(3, 31, 'poor'),
        feedRow(4, 64, 'mixed'),
        { ...feedRow(5, null, null), state: 'checking', health: null, riskLine: null },
      ],
    },
    top: { day: new Date(at).toISOString().slice(0, 10), items: [{ chain: 'robinhood', token: E2E_LAUNCH_TOKEN, symbol: 'DTC', kind: 'deepcore-launch', scans: 214, path }, { chain: 'robinhood', token: 'NVDA', symbol: 'NVDA', kind: 'stock', scans: 120, path: '/holders/robinhood/NVDA' }] },
    live: { state: 'ok', cursor: 85_700_010, transfers: [{ from: launch.nodes[1].id, to: launch.nodes[2].id, pct: 0.2, block: 85_700_005, at: new Date(at).toISOString() }, { from: '0x' + '99'.repeat(20), to: launch.nodes[6].id, pct: 0.1, block: 85_700_006, at: new Date(at).toISOString() }], pcts: { [launch.nodes[2].id]: launch.nodes[2].pct + 0.2 }, asOf: new Date(at).toISOString() },
    wallet: { state: 'ok', firstBuy: { at: new Date(at - 6 * 86_400_000).toISOString(), block: 85_689_760, tokens: 12_500_000, paid: { amount: 0.42, symbol: 'WETH' } }, buys: 3, sells: 1, entryPrice: 0.0000000336, priceNow: 0.0000000477, quote: 'WETH', pnlPct: 42, otherLaunches: [{ chainKey: 'robinhood', token: '0x' + 'ab'.repeat(20), symbol: 'OLD1', path: `/holders/robinhood/0x${'ab'.repeat(20)}` }], asOf: new Date(at).toISOString() },
    ask: { answer: 'Most of DTC sits with a few wallets. Three of them bought together in the first block, which is a warning sign.', citations: [{ n: 1, title: 'Holder Map', url: 'https://docs.gullylabs.xyz/holder-map', source: 'Docs' }] },
  }
}

/** /api/deepcore/launches in the server's shape (server.mjs). */
export function launchesFixture(at = Date.now()) {
  return { state: 'ok', asOf: new Date(at).toISOString(), launches: [{ chainId: 4663, chainKey: 'robinhood', chainName: 'Robinhood Chain', token: E2E_LAUNCH_TOKEN, symbol: 'DTC', createdAt: new Date(at - 7 * 86_400_000).toISOString(), locked: true, links: { token: 'https://deepcore.fun/tokens/x', launch: 'https://deepcore.fun/app/launch/v2/x', swap: 'https://deepcore.fun/app/swap' } }] }
}

/** /api/stats in the server's shape (server/stats.mjs, src/lib/stats.ts): four venues read, one unreadable. */
export function statsFixture(at = Date.now()) {
  const day0 = Math.floor(at / 86_400_000) * 86400
  const daily = (base) => Array.from({ length: 30 }, (_, i) => ({ t: day0 - (29 - i) * 86400, v: base + ((i * 53) % 400) }))
  const iso = new Date(at).toISOString()
  const venue = (key, base, extra = {}) => ({ key, state: 'ok', volumeAllUsd: base * 90, volumeAllSince: '2026-01-01', volume30dUsd: base * 30, volume24hUsd: base, tvlUsd: base * 4, fees24hUsd: base / 100, feesAllUsd: base, daily: daily(base), counts: {}, notes: [], source: { url: `https://${key}.example/api`, readAt: iso }, ...extra })
  const venues = [venue('cartel-family', 1200), venue('deepcore', 900), venue('peddleswap', 400), venue('peddles', 650), { key: 'peddlequest', state: 'error', error: 'e2e: unreadable on purpose' }]
  const ok = venues.filter((v) => v.state === 'ok')
  const sum = (k) => ok.reduce((a, v) => a + v[k], 0)
  const keys = ok.map((v) => v.key)
  const byDay = new Map()
  for (const v of ok) for (const p of v.daily) byDay.set(p.t, (byDay.get(p.t) ?? 0) + p.v)
  return {
    generatedAt: iso,
    totals: { volumeAllUsd: sum('volumeAllUsd'), volume24hUsd: sum('volume24hUsd'), tvlUsd: sum('tvlUsd'), fees24hUsd: sum('fees24hUsd'), feesAllUsd: sum('feesAllUsd'), covers: { volumeAllUsd: keys, volume24hUsd: keys, tvlUsd: keys, fees24hUsd: keys, feesAllUsd: keys }, unread: ['peddlequest'] },
    daily: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v })),
    venues,
  }
}

/** Seeds the tracker's history (and so /api/tracker/history and /movers) with 26 hours of snapshots. */
export async function seedTrackerHistory(body) {
  const tracker = await import(pathToFileURL(path.join(ROOT, 'server/tracker.mjs')).href)
  const end = Date.now()
  for (let i = 26 * 6; i >= 0; i--) {
    const at = end - i * 10 * 60_000
    const wobble = Math.sin(i / 9)
    tracker.recordSnapshotForTest(body.rows.map((r, k) => ({ ...r, gapPct: +(r.gapPct + wobble * (k % 3) * 0.2).toFixed(3), onchain: +(r.onchain * (1 + wobble * 0.002 * (k % 4))).toFixed(4), sessionOpen: true })), at)
  }
}

/* ------------------------------------------------------------- server-side stubs --- */

export const blockedOutbound = []
export const anthropicCalls = []
export const telegramCalls = []

const FEEDS = { 8453: 2_400_00000000n, 1: 2_500_00000000n, 56: 700_00000000n, 42161: 2_450_00000000n, 10: 2_400_00000000n, 137: 9_000000n, 43114: 10_00000000n }

/* Safe deployment (server/safe-deploy.mjs) and the treasury deployment gate (server/treasury-chains.mjs): real Safe
   1.4.1 bytes and the real creations of two 1-of-1 Safes on Base Sepolia (scripts/fixtures/safe-v141.json).

   The chain matrix this harness models. It mirrors production on 2026-10-18, where the treasury Safe exists on Base,
   Ethereum, BNB Chain and Arbitrum, and OP Mainnet, Polygon and Avalanche joined Gully Pay before the Safe was
   deployed there:

     chain              treasury Safe 0x041F9F5F…   store Safe 0x396879A4…   Safe factory/singletons   Gully Pay offers it
     Base 8453          deployed (origin: creation   deployed (origin)        yes                       yes
                        tx and logs live here)
     Ethereum 1         deployed                     not deployed             yes                       yes
     BNB Chain 56       deployed                     not deployed             NO (see below)            yes
     Arbitrum 42161     deployed                     not deployed             yes                       yes
     OP Mainnet 10      NOT deployed                 not deployed             yes                       no (gated)
     Polygon 137        NOT deployed                 not deployed             yes                       no (gated)
     Avalanche 43114    NOT deployed                 not deployed             yes                       no (gated)

   So /api/plans, quotes and checkouts offer Base, Ethereum, BNB Chain and Arbitrum only. The admin's Treasury Safe
   card shows the Safe on those four and "not deployed" with "Deploy Safe on <chain>" on the other three (the e2e demo
   deploys on Avalanche). The store Safe (merchant tab) is on Base only, so its demo deploys on Arbitrum and is refused
   on BNB Chain. On BNB Chain the treasury proxy is present while Safe's factory is withheld: a fixture device so that
   one chain refuses a NEW deployment (a deployed proxy is read through its own storage and calls, not the factory).
   Addresses lower-case. Any other address falls through to the generic stub in rpcAnswer (a plain wallet, no code). */
export const SAFE_FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/safe-v141.json'), 'utf8'))
const SF = SAFE_FIXTURE
/** Where the treasury Safe has code; the other payment chains are "not yet deployed" and so not offered. */
export const TREASURY_DEPLOYED_CHAINS = [8453, 1, 56, 42161]
export const TREASURY_UNDEPLOYED_CHAINS = [10, 137, 43114]
const ORIGIN_CHAIN = 8453
const NO_SAFE_FACTORY_CHAINS = [56]
const SAFES = [
  { address: SF.safe.address.toLowerCase(), view: SF.safe, creation: SF.creation, block: Number(BigInt(SF.creation.tx.blockNumber)), chains: TREASURY_DEPLOYED_CHAINS },
  { address: SF.safe2.address.toLowerCase(), view: SF.safe2, creation: SF.safe2.creation, block: Number(BigInt(SF.safe2.creation.tx.blockNumber)), chains: [ORIGIN_CHAIN] },
]
const SAFE_ADDR = SAFES[0].address
const SAFE_HEAD = Math.max(...SAFES.map((s) => s.block)) + 1000
const SAFE_CODE = { [SF.contracts.factory.address]: SF.contracts.factory.code, [SF.contracts.safeL2.address]: SF.contracts.safeL2.code, [SF.contracts.safe.address]: SF.contracts.safe.code, [SF.contracts.fallback.address]: SF.contracts.fallback.code }
const padAddr = (a) => '0x' + String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0')
/** Whether a fixture Safe has code on a chain at a block ('latest' or a number; on the origin, none before its creation block). */
const safeHasCode = (s, chainId, block = 'latest') => s.chains.includes(chainId) && !(chainId === ORIGIN_CHAIN && block !== 'latest' && Number(BigInt(block)) < s.block)
/** Safe-related JSON-RPC answers; `undefined` when the call is not about a fixture Safe or Safe's own contracts. */
function safeRpcAnswer(chainId, q) {
  const p = q.params ?? []
  const to = String(p[0]?.to ?? p[0] ?? '').toLowerCase()
  const safe = SAFES.find((s) => s.address === to)
  const byTx = (h) => SAFES.find((s) => s.creation.tx.hash === h)
  if (q.method === 'eth_getCode') {
    if (safe) return safeHasCode(safe, chainId, p[1] ?? 'latest') ? SF.contracts.proxy.code : '0x'
    if (SAFE_CODE[to]) return NO_SAFE_FACTORY_CHAINS.includes(chainId) ? '0x' : SAFE_CODE[to]
    return undefined // anyone else: the generic stub (a plain wallet)
  }
  if (q.method === 'eth_getStorageAt') return safe && safeHasCode(safe, chainId) && p[1] === '0x0' ? padAddr(SF.contracts.safeL2.address) : padAddr('0x0')
  if (q.method === 'eth_estimateGas') return hex(236_880)
  if (q.method === 'eth_gasPrice') return hex(1_000_000_000)
  if (q.method === 'eth_getLogs') {
    const from = Number(BigInt(p[0].fromBlock))
    const toB = p[0].toBlock === 'latest' ? SAFE_HEAD : Number(BigInt(p[0].toBlock))
    if (chainId !== ORIGIN_CHAIN) return []
    return SAFES.filter((s) => from <= s.block && toB >= s.block).flatMap((s) => s.creation.receipt.logs.filter((l) => !p[0].topics || l.topics[0] === p[0].topics[0]))
  }
  if (q.method === 'eth_getTransactionByHash') return chainId === ORIGIN_CHAIN ? (byTx(p[0])?.creation.tx ?? null) : null
  if (q.method === 'eth_getTransactionReceipt') return chainId === ORIGIN_CHAIN ? (byTx(p[0])?.creation.receipt ?? null) : null
  if (q.method === 'eth_call') {
    const data = String(p[0]?.data ?? '')
    if (to === SF.contracts.factory.address && data === '0x53e5d935') return '0x' + word(32) + word((SF.proxyCreationCode.length - 2) / 2) + SF.proxyCreationCode.slice(2).padEnd(Math.ceil((SF.proxyCreationCode.length - 2) / 64) * 64, '0')
    if (safe && safeHasCode(safe, chainId)) {
      if (data === '0xa0e67e2b') return safe.view.owners
      if (data === '0xe75235b8') return safe.view.threshold
      if (data === '0xffa1ad74') return safe.view.version
      if (data.startsWith('0xcc2f8452')) return safe.view.modulesPaginated
    }
  }
  return undefined
}

function rpcAnswer(chainId, q) {
  if (q.method === 'eth_chainId') return hex(chainId)
  if (q.method === 'eth_blockNumber') return hex(SAFE_HEAD)
  const safe = safeRpcAnswer(chainId, q)
  if (safe !== undefined) return safe
  if (q.method === 'eth_getBlockByNumber') return { number: q.params[0], timestamp: hex(nowSec()) }
  if (q.method === 'eth_getTransactionReceipt' || q.method === 'eth_getTransactionByHash') return null
  // Every address is a plain wallet (no code): merchant receiving wallets register as EOAs.
  if (q.method === 'eth_getCode') return '0x'
  if (q.method === 'eth_getBalance') return '0x0' // the fee-proxy monitor's coin reads (fee-proxy-monitor.mjs): nothing stuck
  if (q.method === 'eth_call') {
    const data = String(q.params?.[0]?.data ?? '')
    if (data === '0xfeaf968c') return '0x' + word(777) + word(FEEDS[chainId] ?? 2_400_00000000n) + word(nowSec() - 60) + word(nowSec() - 60) + word(777)
    if (data === '0x313ce567') return '0x' + word(8)
    return '0x'
  }
  return null
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Replaces globalThis.fetch for the server: local calls pass, known upstreams are stubbed, the rest refused. */
export function stubServerFetch() {
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input)
    let u
    try {
      u = new URL(url)
    } catch {
      return real(input, init)
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return real(input, init)
    const m = u.hostname.match(/^rpc-(\d+)\.e2e\.invalid$/)
    if (m) {
      const body = JSON.parse(String(init.body ?? 'null'))
      const one = (q) => ({ jsonrpc: '2.0', id: q.id, result: rpcAnswer(Number(m[1]), q) })
      return jsonResponse(Array.isArray(body) ? body.map(one) : one(body))
    }
    if (u.hostname === 'api.anthropic.com') {
      anthropicCalls.push(JSON.parse(String(init.body ?? '{}')))
      return jsonResponse({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'stub', content: [{ type: 'text', text: 'Gap alerts fire when a stock’s gap crosses the threshold you set [1]. You can get them by webhook or Telegram [2].' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 40 } })
    }
    if (u.hostname === 'api.telegram.org') {
      const method = u.pathname.split('/').pop()
      telegramCalls.push(method)
      if (method === 'getMe') return jsonResponse({ ok: true, result: { id: 7000000001, is_bot: true, username: 'GullyE2EBot' } })
      if (method === 'getChatMember') return jsonResponse({ ok: true, result: { status: 'member', user: { id: Number(JSON.parse(String(init.body ?? '{}')).user_id) } } })
      if (method === 'sendMessage') return jsonResponse({ ok: true, result: { message_id: telegramCalls.length, chat: { id: 1 } } })
      return jsonResponse({ ok: true, result: true })
    }
    blockedOutbound.push(url.slice(0, 120))
    throw new TypeError(`fetch failed (e2e: outbound ${u.hostname} is stubbed)`)
  }
}

/* ------------------------------------------------------------- Telegram Mini App --- */

export const E2E_BOT_TOKEN = '7000000001:' + 'E'.repeat(35)

/** initData signed as Telegram signs it (HMAC-SHA256 with the bot token; see server/telegram-miniapp.mjs). */
export function signedInitData(user, token = E2E_BOT_TOKEN, authDate = nowSec()) {
  const fields = { query_id: 'AAE2E', auth_date: String(authDate), user: JSON.stringify(user) }
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  return new URLSearchParams({ ...fields, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString()
}

/**
 * A stand-in for https://telegram.org/js/telegram-web-app.js: Telegram.WebApp with the given initData and
 * theme. It records BackButton/MainButton/haptics calls on window.__tg, and draws the MainButton as a bar
 * at the bottom (Telegram draws it natively, outside the page) so tests can press it and screenshots show it.
 */
export function telegramSdkStub(initData, theme = {}) {
  return `(() => {
  const log = (window.__tg = { haptics: [], back: false, main: null })
  const clicks = { back: new Set(), main: new Set() }
  let bar = null
  const draw = (p) => {
    if (!document.body) return
    bar ??= Object.assign(document.createElement('button'), { id: 'tg-main-button' })
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:56px;border:0;font:600 15px system-ui;z-index:99;background:' + ${JSON.stringify(theme.button_color ?? '#2481cc')} + ';color:' + ${JSON.stringify(theme.button_text_color ?? '#ffffff')}
    bar.onclick = () => clicks.main.forEach((f) => f())
    bar.textContent = p.text
    bar.style.display = p.is_visible ? 'block' : 'none'
    bar.style.opacity = p.is_active === false ? '0.6' : '1'
    if (!bar.isConnected) document.body.appendChild(bar)
    // Telegram's own button sits below the webview; keep the page clear of the stand-in.
    document.body.style.paddingBottom = p.is_visible ? '56px' : ''
  }
  const main = { text: '', is_visible: false, is_active: true }
  window.Telegram = { WebApp: {
    initData: ${JSON.stringify(initData)},
    initDataUnsafe: {},
    version: '8.0', platform: 'tdesktop', colorScheme: 'dark',
    themeParams: ${JSON.stringify(theme)},
    ready() {}, expand() {}, close() {},
    isVersionAtLeast: () => true,
    setHeaderColor() {}, setBackgroundColor() {},
    openLink(u) { log.opened = u }, openTelegramLink(u) { log.opened = u },
    showConfirm(_m, cb) { cb(true) },
    onEvent() {}, offEvent() {},
    BackButton: { isVisible: false, show() { log.back = true }, hide() { log.back = false }, onClick(f) { clicks.back.add(f) }, offClick(f) { clicks.back.delete(f) } },
    MainButton: {
      setParams(p) { Object.assign(main, p); log.main = { ...main }; draw(main) },
      show() { main.is_visible = true; draw(main) }, hide() { main.is_visible = false; log.main = { ...main }; draw(main) },
      enable() {}, disable() {}, showProgress() {}, hideProgress() {},
      onClick(f) { clicks.main.add(f) }, offClick(f) { clicks.main.delete(f) },
    },
    HapticFeedback: { impactOccurred(s) { log.haptics.push('impact:' + s) }, notificationOccurred(s) { log.haptics.push('notify:' + s) }, selectionChanged() { log.haptics.push('select') } },
  } }
  window.__tgBack = () => clicks.back.forEach((f) => f())
})()`
}

/* ------------------------------------------------------------- boot --- */

export async function bootServer({ port }) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first (test:e2e serves the built site).')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-e2e-'))
  const admin = crypto.randomBytes(24).toString('hex')
  // The treasury is the fixture Safe: deployed on Base, Ethereum, BNB Chain and Arbitrum, not yet on OP Mainnet,
  // Polygon or Avalanche (the chain matrix above safeRpcAnswer), so the deployment gate closes those three.
  const treasury = SAFE_ADDR
  Object.assign(process.env, {
    PORT: String(port),
    DATA_DIR: tmp,
    TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
    DIST_DIR: DIST,
    ADMIN_TOKEN: admin,
    TRACKER_LOOP: 'off',
    DEEPCORE_LOOP: 'off',
    TRACKER_SKIP_APIS: '1',
    ASK_REMOTE: 'off',
    GULLY_TREASURY_ADDRESS: treasury,
    ANTHROPIC_API_KEY: 'sk-ant-e2e-' + 'x'.repeat(30),
    TELEGRAM_BOT_TOKEN: E2E_BOT_TOKEN,
    DEEPCORE_API: 'https://deepcore-api.e2e.invalid',
    // Every payment chain (FEEDS has one per chain).
    ...Object.fromEntries(Object.keys(FEEDS).map((id) => [`GULLY_RPC_${id}`, `https://rpc-${id}.e2e.invalid`])),
  })
  for (const k of ['GULLY_TREASURY_KIND', 'GULLY_TREASURY_CHECK_MS', 'GULLY_TESTNET_CHAINS', 'GULLY_BASE_RPC', 'GULLY_MIN_CONFIRMATIONS', 'ANALYTICS_ADMIN_PASSWORD', 'ANTHROPIC_API_URL', 'TELEGRAM_API']) delete process.env[k]
  stubServerFetch()
  await import(pathToFileURL(path.join(ROOT, 'server/server.mjs')).href)
  await new Promise((r) => setTimeout(r, 300))
  return { tmp, admin, treasury, base: `http://localhost:${port}` }
}
