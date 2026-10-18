// Holder Map Deep check (server/holders-deep.mjs the engine, server/holders-deep-routes.mjs the paid API), offline:
// every upstream (the holder map, DeepCore, the explorer, name tags, RPCs, Solana) is a stub passed to the engine,
// so no call leaves the machine. The real server runs IN THIS PROCESS on TEST_PORT (default 9051) with a fresh
// temporary DATA_DIR; payments are marked paid in process (Gully Pay's own checks have their own suite).
//
//   npm run test:holders-deep        (no build needed)

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9051
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-holders-deep-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const TREASURY = '0x' + crypto.randomBytes(20).toString('hex')

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  DEEPCORE_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  ASK_REMOTE: 'off',
  GULLY_TREASURY_ADDRESS: TREASURY,
  HOLDER_DEEP_RETRY_MS: '50',
  ...Object.fromEntries([1, 56, 8453, 42161, 10, 137, 43114, 4663, 999].map((id) => [`GULLY_RPC_${id}`, 'http://127.0.0.1:9'])),
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'TELEGRAM_ADMIN_CHAT_ID', 'BLOCKSCOUT_API_KEY', 'GULLY_RPC_SOLANA']) delete process.env[k]

const engine = await import('../server/holders-deep.mjs')
const { HOLDER_DEEP, holderDeepPriceCents } = await import('../server/plans.mjs')
const { HOLDER_CHAINS } = await import('../server/holders.mjs')
await import('../server/server.mjs')
const routes = await import('../server/holders-deep-routes.mjs')
const billing = await import('../server/billing.mjs')
const invoices = await import('../server/invoices.mjs')
const secStore = await import('../server/security-store.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ fixtures --- */

const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const TOKEN = addr(0xa0)
const DEP = addr(0xd0)
const [W1, W2, W3, W4] = [0x11, 0x12, 0x13, 0x14].map(addr)
const F = addr(0xf1) // shared funder (unlabelled)
const X = addr(0xf2) // intermediate funder
const EX = addr(0xe1) // an exchange
const POOL = addr(0xb0)
const C1 = addr(0xc1) // a token the deployer made
const C2 = addr(0xc2) // a contract that is not a token
const OLD = addr(0x77)

const launchMap = () => ({
  state: 'ok',
  kind: 'deepcore-launch',
  token: { address: TOKEN, symbol: 'TST', name: 'Test' },
  sources: { holders: 'stub' },
  holders: { count: 50 },
  nodes: [
    { id: POOL, rank: 1, pct: 30, label: { kind: 'pool', name: 'Pool' }, flags: [], contract: true },
    { id: W1, rank: 2, pct: 10, label: null, flags: ['sniper', 'bundled'], contract: false },
    { id: W2, rank: 3, pct: 8, label: null, flags: ['sniper', 'bundled'], contract: false },
    { id: W3, rank: 4, pct: 6, label: null, flags: [], contract: false },
    { id: W4, rank: 5, pct: 5, label: null, flags: [], contract: false },
    { id: addr(0x99), rank: 6, pct: 4, label: null, flags: [], contract: true },
  ],
  clusters: [{ id: 'c1', wallets: [W3, W4], count: 2, pct: 11, hasDeployer: false }],
  forensics: { deployer: DEP, launchBlock: 100, firstTradeBlock: 101, bundled: { wallets: 2, pct: 18, firstBlockBuyers: 2 }, snipers: { wallets: 2, pct: 18, blocks: 5 }, buyers: 6, riskLine: '2 wallets bought in the first block of trading and hold 18% now.' },
})

/** first native funder per address, and the explorer's other answers. */
const FUND = { [W1]: F, [W2]: F, [W3]: EX, [W4]: X, [X]: F, [DEP]: F, [F]: EX }
function explorerStub(calls, { down = false } = {}) {
  return async (url) => {
    calls.push(url)
    if (down) return { ok: false, status: 503, body: null }
    const u = new URL(url)
    let m = u.pathname.match(/\/(\d+)\/api\/v2\/addresses\/(0x[0-9a-f]{40})\/transactions$/)
    if (m) {
      const [, chainId, a] = m
      if (u.searchParams.get('filter') === 'to') {
        const from = FUND[a]
        return { ok: true, status: 200, body: { items: from ? [{ hash: '0x' + a.slice(-4).padStart(64, '0'), block_number: 5, from: { hash: from }, to: { hash: a }, value: '1000', status: 'ok', timestamp: '2025-01-01T00:00:00Z' }] : [], next_page_params: null } }
      }
      if (u.searchParams.get('filter') === 'from') return { ok: true, status: 200, body: { items: a === DEP && chainId === '8453' ? [{ created_contract: { hash: C1 } }, { created_contract: { hash: C2 } }] : [], next_page_params: chainId === '56' ? { block_number: 1 } : null } }
    }
    m = u.pathname.match(/\/tokens\/(0x[0-9a-f]{40})$/)
    if (m) return m[1] === C1 ? { ok: true, status: 200, body: { address_hash: C1, symbol: 'OLD', name: 'Old token', type: 'ERC-20', holders_count: '12' } } : { ok: false, status: 404, body: null }
    if (u.pathname.endsWith('/api/v1/metadata')) return { ok: true, status: 200, body: { addresses: { [EX]: { tags: [{ tagType: 'name', name: 'Binance 14', slug: 'exchange' }] } } } }
    return { ok: false, status: 404, body: null }
  }
}

function makeDeps(over = {}) {
  const calls = []
  return {
    calls,
    deps: {
      chains: HOLDER_CHAINS,
      explorerKey: () => 'k',
      archive: true,
      solanaSet: false,
      readMap: async (_c, token) => (String(token).endsWith('a4') ? { state: 'not-found' } : { ...launchMap(), token: { address: token, symbol: 'TST', name: 'Test' } }),
      rpc: async () => '0x1',
      code: async (_c, addrs) => new Map(addrs.map((a) => [a, false])),
      dc: async () => ({ ok: false, status: 500, body: null }),
      ownHistory: async () => ({ state: 'no-archive' }),
      deployerHistory: async () => ({ checked: true, total: 1, more: 0, launches: [{ chainKey: 'base', token: OLD, symbol: 'RUG', createdAt: '2025-02-01T00:00:00Z', outcome: 'liquidity-pulled', note: 'The pool has no active liquidity left.', path: `/holders/base/${OLD}` }] }),
      fetchJson: explorerStub(calls),
      solana: async () => null,
      ...over,
    },
  }
}

const everyFindingHasSourceAndConfidence = (r) => r.findings.length > 0 && r.findings.every((f) => typeof f.source === 'string' && f.source.length > 0 && ['high', 'medium', 'low'].includes(f.confidence) && f.text)

/* ============================================================ PART A: the engine === */

try {
  /* ---- a DeepCore launch with an explorer ---------------------------------------------------- */
  {
    const { deps, calls } = makeDeps()
    const r = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps })
    check('launch: the check is done, not partial, with all four sections ok', r.status === 'done' && r.partial === null && ['trading', 'funding', 'clusters', 'deployer'].every((k) => r.sections[k].state === 'ok'), JSON.stringify(Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [k, v.state]))))
    check('every finding states its source and a confidence', everyFindingHasSourceAndConfidence(r), JSON.stringify(r.findings.filter((f) => !f.source || !f.confidence)))
    const tr = r.sections.trading
    check('trading: the map forensics, high confidence, snipers and bundle counts', tr.method === 'deepcore-launch-forensics' && tr.confidence === 'high' && tr.snipers.count === 2 && tr.bundled.count === 2 && tr.snipers.wallets.length === 2 && tr.firstTradeBlock === 101)
    const f = r.sections.funding
    const byAddr = Object.fromEntries(f.traces.map((x) => [x.address, x]))
    check('funding: top unlabelled non-contract holders plus the deployer are traced (the contract and the pool are not)', f.traces.length === 5 && f.traces.some((x) => x.role === 'deployer' && x.address === DEP) && !byAddr[POOL] && !byAddr[addr(0x99)], f.traces.map((x) => x.address.slice(-2)).join(','))
    check('funding: W1 first funded by F with the explorer as the source, native, high', byAddr[W1].hops[0].from === F && byAddr[W1].hops[0].kind === 'native' && byAddr[W1].hops[0].confidence === 'high' && /Explorer/.test(byAddr[W1].hops[0].source))
    check('funding: W3 traced to an exchange (labelled by name tags) and the trace ends there', byAddr[W3].origin.type === 'exchange' && byAddr[W3].origin.label === 'Binance 14' && byAddr[W3].hops.length === 1)
    check('funding: W4 is followed two hops (X, then F) up to an exchange within the hop limit', byAddr[W4].hops.map((h) => h.from).join() === [X, F, EX].join() && byAddr[W4].origin.type === 'exchange', JSON.stringify(byAddr[W4].hops.map((h) => h.from.slice(-2))))
    const sf = f.sharedFunders.find((s) => s.address === F)
    check('funding: F is a shared funder of W1, W2, W4 and the deployer; unlabelled, medium confidence', !!sf && sf.wallets.length === 4 && sf.labelled === false && sf.confidence === 'medium', JSON.stringify(sf))
    const exShared = f.sharedFunders.find((s) => s.address === EX)
    check('funding: a shared exchange is listed but flagged as not evidence (low confidence)', !!exShared && exShared.exchange && exShared.confidence === 'low' && /not evidence/.test(exShared.note))
    const cl = r.sections.clusters
    check('clusters: the direct cluster from the map is kept', cl.direct.clusters.length === 1 && cl.direct.clusters[0].wallets.join() === [W3, W4].join())
    check('clusters: shared-funder cluster joins W1, W2, W4 and the deployer; the exchange creates none', cl.sharedFunder.clusters.length === 1 && [W1, W2, W4, DEP].every((w) => cl.sharedFunder.clusters[0].wallets.includes(w)) && !cl.sharedFunder.clusters[0].wallets.includes(W3))
    const big = cl.combined[0]
    check('clusters: combined merges direct and shared into one group (W3 joins through W4), with its basis', big.wallets.length === 5 && [W1, W2, W3, W4, DEP].every((w) => big.wallets.includes(w)) && big.basis === 'direct-transfers+shared-funder', JSON.stringify(big))
    const d = r.sections.deployer
    check('deployer: DeepCore launches with their outcome', d.state === 'ok' && d.address === DEP && d.tokens.some((x) => x.address === OLD && x.outcome === 'liquidity-pulled' && x.source === 'DeepCore account activity'))
    check('deployer: the explorer found a token the deployer created on Base (and the non-token contract is not listed)', d.tokens.some((x) => x.address === C1 && x.chain === 'base' && x.symbol === 'OLD') && !d.tokens.some((x) => x.address === C2))
    check('deployer: a chain whose page was cut says older deployments may exist; chains without data are listed', d.chains.find((c) => c.chain === 'bsc').reason?.includes('older deployments') && d.chains.length === 4)
    check('deployer: other launchpads are unavailable, with the reason', r.unavailable.some((u) => u.what === 'Other launchpads') && d.otherLaunchpads.state === 'unavailable')
    check('the report records the budget used and the limits', r.budget.limits.hops === HOLDER_DEEP.budgets.hops && r.budget.used.explorerCalls > 10 && r.budget.used.explorerCalls <= HOLDER_DEEP.budgets.explorerCalls && r.budget.used.rpcCalls === 0, JSON.stringify(r.budget.used))
    check('the explorer was only asked about the traced wallets, never more than the budget', calls.length === r.budget.used.explorerCalls + 0 || calls.length <= HOLDER_DEEP.budgets.explorerCalls, `${calls.length} vs ${r.budget.used.explorerCalls}`)
    const again = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps().deps })
    const strip = (x) => JSON.stringify({ ...x, generatedAt: 0, budget: 0 })
    check('same inputs, same result: nothing about the buyer is an input (payment cannot change a result)', strip(again) === strip(r))
  }

  /* ---- hop limit and budgets ------------------------------------------------------------------ */
  {
    const r1 = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps().deps, limits: { ...HOLDER_DEEP.budgets, hops: 1 } })
    const w1 = r1.sections.funding.traces.find((x) => x.address === W1)
    check('hop limit 1: W1 stops at F with an unfollowed "wallet" origin and says why', w1.hops.length === 1 && w1.origin.type === 'wallet' && /Hop limit/.test(w1.origin.note))

    const r2 = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps().deps, limits: { ...HOLDER_DEEP.budgets, explorerCalls: 4 } })
    check('explorer budget 4: finishes "partial" with the reason, never over the limit', r2.status === 'partial' && r2.partial.reasons.some((x) => x.code === 'explorer-calls' && /budget/.test(x.text)) && r2.budget.used.explorerCalls <= 4, JSON.stringify(r2.partial))
    check('partial: what was found is kept (trading, the first funding hops) and findings still carry sources', r2.sections.trading.state === 'ok' && r2.sections.funding.traces.some((x) => x.hops.length) && everyFindingHasSourceAndConfidence(r2))
    check('partial: the funding section is partial with the reason', r2.sections.funding.state === 'partial' && /budget/.test(r2.sections.funding.reason))
    check('partial: sections after the stop are partial or skipped, none claims a complete result', ['clusters', 'deployer'].every((k) => ['partial', 'skipped', 'ok', 'unavailable'].includes(r2.sections[k].state)) && r2.sections.deployer.state !== 'ok')

    let ticks = 0
    const r3 = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps().deps, limits: { ...HOLDER_DEEP.budgets, ms: 5_000 }, now: () => 1_000_000 + 1_000 * ticks++ })
    check('time budget: finishes "partial" with the time reason', r3.status === 'partial' && r3.partial.reasons.some((x) => x.code === 'time'), JSON.stringify(r3.partial))

    const r4 = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps({ readMap: async () => ({ state: 'not-found' }), ownHistory: async () => ({ state: 'ok', transfers: [] }) }).deps, limits: { ...HOLDER_DEEP.budgets, logSpans: 0 } })
    check('log-span budget 0: no log read is made, the reason is reported', r4.partial?.reasons.some((x) => x.code === 'log-spans'), JSON.stringify(r4.partial))
  }

  /* ---- a token that is not a launch or a stock: inferred from its transfers -------------------- */
  {
    const S1 = addr(0x21)
    const S2 = addr(0x22)
    const S3 = addr(0x23)
    const S4 = addr(0x24)
    const S5 = addr(0x25)
    const R = addr(0xb1) // a router: pool -> router -> S3 in one transaction
    const DEPL = addr(0x31)
    const W9 = addr(0x32)
    const tx = (from, to, value, block, txh, index = 0) => ({ from, to, value, block, tx: txh, index, ts: null })
    const ZERO = '0x' + '0'.repeat(40)
    const transfers = [
      tx(ZERO, DEPL, 1000n, 1, '0xm'),
      tx(DEPL, POOL, 800n, 10, '0xliq'),
      tx(POOL, S1, 20n, 12, '0xb1'),
      tx(POOL, S2, 20n, 12, '0xb2'),
      tx(POOL, R, 10n, 13, '0xb3', 0),
      tx(R, S3, 10n, 13, '0xb3', 1),
      tx(POOL, S4, 5n, 30, '0xb4'),
      tx(DEPL, W9, 5n, 40, '0xfund'),
      tx(POOL, S5, 1n, 50, '0xb5'),
    ]
    const codeTable = new Set([POOL, R])
    const { deps } = makeDeps({ explorerKey: () => '', readMap: async () => ({ state: 'not-found' }), ownHistory: async () => ({ state: 'ok', transfers }), code: async (_c, addrs) => new Map(addrs.map((a) => [a, codeTable.has(a)])) })
    const r = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps })
    const tr = r.sections.trading
    check('generic token: no holder map, so the base says so', r.base.mapState === 'not-found' && /no holder map/.test(r.base.note))
    check('generic trading: the pool is inferred (a contract that paid many wallets), medium confidence, labelled as inferred', tr.state === 'ok' && tr.method === 'inferred-from-transfers' && tr.pool === POOL && tr.confidence === 'medium' && /Inferred/.test(tr.poolNote) && /inferred/.test(tr.source), JSON.stringify(tr).slice(0, 200))
    check('generic trading: first liquidity block 10, first trade block 12', tr.firstLiquidityBlock === 10 && tr.firstTradeBlock === 12)
    check('generic trading: snipers are the buyers in the first 5 blocks, a router forward counts as the wallet', tr.snipers.count === 3 && tr.snipers.wallets.map((w) => w.address).sort().join() === [S1, S2, S3].sort().join() && !tr.snipers.wallets.some((w) => w.address === R), JSON.stringify(tr.snipers))
    check('generic trading: a later buyer (block 30) is not a sniper; the bundle is the 2 wallets in block 12', tr.bundles.length === 1 && tr.bundles[0].block === 12 && tr.bundles[0].count === 2 && tr.bundled.count === 2)
    check('generic trading: share of supply held now comes from the complete history', tr.snipers.pctOfSupply !== null && tr.snipers.pctOfSupply > 0)
    const f = r.sections.funding
    const w9 = f.traces.find((x) => x.address === W9)
    check('generic funding: holders come from the history, contracts are dropped (pool, router)', f.state === 'ok' && f.traces.length > 0 && !f.traces.some((x) => [POOL, R].includes(x.address)))
    check('generic funding: with no explorer key, a wallet funded by a wallet shows the token transfer, source and confidence', w9.hops[0].from === DEPL && w9.hops[0].kind === 'token' && w9.hops[0].confidence === 'high' && /Our own index|own index|Transfer/i.test(w9.hops[0].source))
    const s1 = f.traces.find((x) => x.address === S1)
    check('generic funding: a buyer whose first tokens came from the pool is a "buy", not a funding', s1.origin.type === 'buy')
    check('generic deployer: unavailable, with the reason (not a DeepCore launch, no explorer key)', r.sections.deployer.state === 'unavailable' && /explorer key/.test(r.sections.deployer.reason) && r.unavailable.some((u) => u.section === 'deployer'))
    check('generic: every finding has a source and confidence', everyFindingHasSourceAndConfidence(r))

    const noArch = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps({ explorerKey: () => '', readMap: async () => ({ state: 'not-found' }), ownHistory: async () => ({ state: 'no-archive' }) }).deps })
    check('no archive and no map: trading and funding unavailable with the reason; nothing invented; status failed', noArch.sections.trading.state === 'unavailable' && /archive/.test(noArch.sections.trading.reason) && noArch.sections.funding.state === 'unavailable' && noArch.status === 'failed')
    const down = await engine.runDeepCheck({ chain: 'base', token: TOKEN, deps: makeDeps({ fetchJson: explorerStub([], { down: true }) }).deps })
    check('explorer down: funding unavailable with the reason, trading (map) still ok', down.sections.trading.state === 'ok' && down.sections.funding.state === 'unavailable' && down.unavailable.some((u) => u.section === 'funding' && /explorer/i.test(u.reason)))

    const pageGuard = await engine.inferTrading({ chainKey: 'base', token: TOKEN, transfers: [tx(DEPL, S1, 1n, 1, '0x1')], complete: true, deps, budget: engine.makeBudget() })
    check('inferTrading: with no pool-like address it says unavailable instead of guessing', pageGuard.state === 'unavailable')
  }

  /* ---- Solana ---------------------------------------------------------------------------------- */
  {
    const MINT = 'So1anaMint1111111111111111111111111111111'
    const SA = 'SoLWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const SB = 'SoLWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const PAYER = 'PayerPayerPayerPayerPayerPayerPayerPayer111'
    const solMap = { state: 'ok', kind: 'stock', token: { address: MINT, symbol: 'SOLT' }, nodes: [{ id: SA, rank: 1, pct: 5, label: null, flags: [], contract: false }, { id: SB, rank: 2, pct: 4, label: null, flags: [], contract: false }], clusters: [], forensics: null }
    const solana = async (method, params) => {
      if (method === 'getSignaturesForAddress') return params[0] === SA ? [{ signature: 'sigA', slot: 7, blockTime: 1_700_000_000 }] : Array.from({ length: 1000 }, (_, i) => ({ signature: `s${i}` }))
      if (method === 'getTransaction') return { transaction: { message: { accountKeys: [PAYER, SA] } }, meta: { preBalances: [100, 0], postBalances: [50, 50] } }
      return null
    }
    const { deps } = makeDeps({ readMap: async () => solMap, solana, solanaSet: true })
    const r = await engine.runDeepCheck({ chain: 'solana', token: MINT, deps })
    const a = r.sections.funding.traces.find((x) => x.address === SA)
    const b = r.sections.funding.traces.find((x) => x.address === SB)
    check('solana: first funder read from the Solana RPC (payer of the first transaction), with source', a.hops[0].from === PAYER && a.hops[0].kind === 'native' && /Solana RPC/.test(a.hops[0].source))
    check('solana: a wallet with 1000+ transactions is unavailable with the reason', b.origin.type === 'unknown' && b.origin.unavailable === true && /1,000/.test(b.origin.reason))
    check('solana: trading and deployer are unavailable with the reason; the budget counts RPC calls', r.sections.trading.state === 'unavailable' && r.sections.deployer.state === 'unavailable' && r.budget.used.rpcCalls === 4, String(r.budget.used.rpcCalls))
    const cov = engine.coverage('solana', { deps: { chains: HOLDER_CHAINS, explorerKey: () => '', archive: false, solanaSet: false } })
    check('coverage: Solana without a Solana RPC has no part available (so it is not sold)', !engine.anyCoverage(cov))
    const covBase = engine.coverage('base', { deps: { chains: HOLDER_CHAINS, explorerKey: () => 'k', archive: true, solanaSet: false } })
    check('coverage: Base with an explorer key and an archive RPC has every part', ['funding', 'clusters', 'deployer', 'trading'].every((k) => covBase[k].state !== 'unavailable'))
  }

  /* ---- the budget object ----------------------------------------------------------------------- */
  {
    const b = engine.makeBudget({ rpcCalls: 2, logSpans: 1, explorerCalls: 1, ms: 1000, holders: 1, hops: 1 })
    b.take('rpc', 2)
    let stopped = null
    try {
      b.take('rpc')
    } catch (e) {
      stopped = e
    }
    check('budget: one call over the limit throws BudgetStop with the reason, and records it', stopped instanceof engine.BudgetStop && stopped.code === 'rpc-calls' && b.reasons.length === 1 && b.used.rpcCalls === 2)
  }
  check('plans: price, quota and bundle discount are in plans.mjs next to the Holder Map', HOLDER_DEEP.priceUsd === 9 && HOLDER_DEEP.freePerMonth.pro === 3 && HOLDER_DEEP.freePerMonth.business === 3 && HOLDER_DEEP.freePerMonth.free === 0 && HOLDER_DEEP.bundleScanDiscountPct === 20 && holderDeepPriceCents() === 900 && holderDeepPriceCents(true) === 720)
} catch (e) {
  check(`engine tests: no exception (${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')})`, false)
}

/* ============================================================ PART B: the paid API === */

const wallet = () => privateKeyToAccount(generatePrivateKey())
const W = { buyer: wallet(), sub: wallet(), other: wallet() }
const A = Object.fromEntries(Object.entries(W).map(([k, w]) => [k, w.address.toLowerCase()]))
const C = Object.fromEntries(Object.keys(W).map((k) => [k, makeClient(BASE)]))
const ANON = makeClient(BASE)
try {
  for (const k of Object.keys(W)) if ((await C[k].signIn(W[k])).status !== 200) throw new Error(`sign-in failed for ${k}`)
  const { deps } = makeDeps()
  routes.setDeepEngineForTest({ deps, limits: HOLDER_DEEP.budgets })
  const DEEP = '/api/holders/deep'
  const post = (c, body) => c.post(DEEP, body)
  const get = (c, id) => c.call(`${DEEP}/${id}`)
  const waitFor = async (c, id, until, ms = 15_000) => {
    const end = Date.now() + ms
    let last = null
    while (Date.now() < end) {
      last = (await get(c, id)).data?.check
      if (last && until(last)) return last
      await sleep(60)
    }
    return last
  }
  const finished = (s) => ['done', 'partial', 'failed', 'cancelled'].includes(s.status)
  function payInvoice(invoiceId) {
    const inv = billing.ledger().invoices.find((i) => i.id === invoiceId)
    const payment = billing.recordPayment({ kind: 'invoice', invoiceId, txHash: '0x' + crypto.randomBytes(32).toString('hex'), chainId: 8453, assetId: 'usdc-base', symbol: 'USDC', decimals: 6, amountRaw: inv.usdCents + '0000', usdCents: inv.usdCents, price: null, quoteId: null, from: '0x' + '22'.repeat(20), blockNumber: 1 }, null)
    inv.paymentId = payment.id
    inv.paidAt = payment.at
    billing.save()
    for (const h of invoices.invoicePaidHooks) h(inv, payment)
  }
  const T = { chain: 'base', token: TOKEN }

  /* ---- offer, validation, quote ---------------------------------------------------------------- */
  {
    const g = await ANON.call(DEEP)
    check('GET: the offer (price, quotas, budgets), checkout on, coverage per chain', g.status === 200 && g.data.offer.priceUsd === 9 && g.data.offer.budgets.hops === HOLDER_DEEP.budgets.hops && g.data.checkout.enabled === true && g.data.coverage.base.trading.state !== 'unavailable' && g.data.signedIn === false && g.data.quota === null)
    const plans = await ANON.call('/api/plans')
    check('GET /api/plans carries holderDeep (the same object)', plans.status === 200 && plans.data.holderDeep?.priceUsd === 9 && plans.data.holderDeep.freePerMonth.pro === 3)
    check('POST without X-Requested-With: 403', (await ANON.call(DEEP, { method: 'POST', body: T })).status === 403)
    check('400: unknown chain', (await post(ANON, { chain: 'tron', token: TOKEN })).status === 400)
    check('400: malformed token', (await post(ANON, { chain: 'base', token: '0x1234' })).status === 400)
    check('400: zero address', (await post(ANON, { chain: 'base', token: '0x' + '0'.repeat(40) })).status === 400)
    check('400: not JSON-able body', (await ANON.call(DEEP, { method: 'POST', headers: { 'x-requested-with': 'gully' } })).status === 400)
    const q = await post(ANON, T)
    check('quote: 200, $9, not free, no side effects (no job stored)', q.status === 200 && q.data.quote.priceUsd === 9 && q.data.quote.free === false && q.data.quote.listPriceUsd === 9 && q.data.quote.bundle.applied === false && q.data.quote.checkout.enabled && fs.existsSync(path.join(tmp, 'holders-deep.json')) === false)
    const sol = await post(ANON, { chain: 'solana', token: 'So11111111111111111111111111111111111111112' })
    check('422 nothing-available: a chain where no part can run is not sold (here Solana, no Solana RPC set)', sol.status === 422 && sol.data.code === 'nothing-available', `${sol.status} ${sol.data?.code}`)
    check('404 for an unknown or malformed check id', (await get(ANON, 'hd_' + 'x'.repeat(16))).status === 404 && (await get(ANON, 'nope')).status === 404)
  }

  /* ---- an anonymous buyer pays ------------------------------------------------------------------ */
  let paidId
  {
    const wrong = await post(ANON, { ...T, expect: { priceUsd: 5 } })
    check('expect the wrong price: 409 price-changed with the quote, nothing stored', wrong.status === 409 && wrong.data.code === 'price-changed' && wrong.data.quote.priceUsd === 9)
    delete process.env.GULLY_TREASURY_ADDRESS
    const off = await post(ANON, { ...T, expect: { priceUsd: 9 } })
    check('checkout off (no treasury): 402, nothing charged or stored', off.status === 402 && off.data.code === 'checkout-off')
    process.env.GULLY_TREASURY_ADDRESS = TREASURY
    const r = await post(ANON, { ...T, expect: { priceUsd: 9 } })
    paidId = r.data?.check?.id
    const invId = r.data?.payment?.invoiceId
    check('confirmed: 202 with a Gully Pay invoice for $9, check awaiting payment', r.status === 202 && /^hd_[\w-]{16}$/.test(paidId ?? '') && r.data.check.status === 'awaiting_payment' && /^inv_/.test(invId ?? '') && r.data.payment.payUrl === `/pay/${invId}` && r.data.payment.usd === 9 && r.data.check.free === false)
    const inv = await fetch(`${BASE}/api/pay/${invId}`).then((x) => x.json())
    check('the invoice is a real open Gully Pay invoice: $9, the standard assets, paid to the treasury', inv.invoice.status === 'open' && inv.invoice.usdCents === '900' && /Deep check/.test(inv.invoice.title) && inv.invoice.checkout.treasury === TREASURY.toLowerCase() && inv.invoice.assets.length > 0)
    const dup = await post(ANON, { ...T, expect: { priceUsd: 9 } })
    check('the same token again while unpaid: that check back, duplicate, no second invoice', dup.status === 200 && dup.data.duplicate === true && dup.data.check.id === paidId && dup.data.payment.invoiceId === invId)
    const pending = (await get(ANON, paidId)).data.check
    check('GET by id while unpaid: awaiting_payment, no report', pending.status === 'awaiting_payment' && pending.report === null && pending.payment.status === 'open')
    payInvoice(invId)
    const done = await waitFor(ANON, paidId, finished)
    check('once the invoice is paid the check runs and finishes with the full report', done?.status === 'done' && done.report?.sections.funding.state === 'ok' && done.report.chain.key === 'base' && done.report.findings.length > 0 && done.progress === null, `${done?.status}`)
    check('the report has the shareable id and URL', done.url === `/holders/deep/${paidId}` && done.id === paidId)
    check('the report is stored in the data dir', fs.existsSync(path.join(tmp, 'holders-deep', `${paidId}.json`)))
    const open = await fetch(`${BASE}${DEEP}/${paidId}`)
    check('anyone with the id can read it (CORS open, noindex), JSON', open.status === 200 && open.headers.get('access-control-allow-origin') === '*' && /noindex/.test(open.headers.get('x-robots-tag') ?? ''))
    const cancelDone = await ANON.post(`${DEEP}/${paidId}/cancel`)
    check('a finished check cannot be cancelled (409)', cancelDone.status === 409)
    const after = await post(ANON, { ...T })
    check('afterwards a new quote is still $9 (a finished check gives no credit)', after.data.quote.priceUsd === 9)
  }

  /* ---- cancel and expiry ------------------------------------------------------------------------- */
  {
    const T2 = { chain: 'base', token: addr(0xa2) }
    const r = await post(ANON, { ...T2, expect: { priceUsd: 9 } })
    const id = r.data.check.id
    const inv = r.data.payment.invoiceId
    const c = await ANON.post(`${DEEP}/${id}/cancel`)
    check('cancel before payment: 200 cancelled, the invoice is cancelled too', c.status === 200 && c.data.check.status === 'cancelled' && invoices.adminInvoice(inv).status === 'cancelled')

    const T3 = { chain: 'base', token: addr(0xa3) }
    const e = await post(ANON, { ...T3, expect: { priceUsd: 9 } })
    invoices.expireInvoiceForTest(e.data.payment.invoiceId)
    const swept = routes.sweepDeep()
    const view = (await get(ANON, e.data.check.id)).data.check
    check('unpaid and expired: the sweep cancels the check (reason unpaid-expired)', swept.includes(e.data.check.id) && view.status === 'cancelled' && view.cancelReason === 'unpaid-expired')

    const T4 = { chain: 'base', token: addr(0xa4) }
    const p = await post(ANON, { ...T4, expect: { priceUsd: 9 } })
    payInvoice(p.data.payment.invoiceId)
    const late = await ANON.post(`${DEEP}/${p.data.check.id}/cancel`)
    check('cancel after payment: 409, the check is not lost', late.status === 409)
    const fin = await waitFor(ANON, p.data.check.id, finished)
    check('a paid check whose sources give nothing finishes "failed" with an error, not stuck', fin.status === 'failed' && /None of the parts/.test(fin.error ?? '') && fin.report?.unavailable.length > 0, `${fin.status} ${fin.error} ${JSON.stringify(fin.report?.unavailable)} ${JSON.stringify(fin.report?.sections)}`)
  }

  /* ---- plan subscribers: free checks ------------------------------------------------------------- */
  {
    const q0 = await post(C.sub, T)
    check('signed in on the Free plan: no free checks, $9', q0.data.quote.free === false && q0.data.quote.quota.freePerMonth === 0 && q0.data.quote.priceUsd === 9)
    billing.adminSetPlan(A.sub, 'pro', 30)
    const q = await post(C.sub, T)
    check('Pro subscriber: quote is free, quota 3 of 3 left', q.data.quote.free === true && q.data.quote.priceUsd === 0 && q.data.quote.quota.left === 3 && q.data.quote.quota.freePerMonth === HOLDER_DEEP.freePerMonth.pro)
    const g = await C.sub.call(DEEP)
    check('GET shows the signed-in quota', g.data.signedIn === true && g.data.quota.left === 3 && g.data.quota.plan.id === 'pro')
    const ids = []
    for (let i = 0; i < 3; i++) {
      const r = await post(C.sub, { chain: 'base', token: TOKEN.slice(0, -2) + (0xb0 + i).toString(16), expect: { priceUsd: 0 } })
      if (r.status === 201) ids.push(r.data.check.id)
      check(`free check ${i + 1}: 201, free, no invoice, queued or running`, r.status === 201 && r.data.check.free === true && r.data.check.priceUsd === 0 && r.data.check.payment === null && ['queued', 'running', 'done', 'failed'].includes(r.data.check.status), `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
    }
    const q4 = await post(C.sub, { chain: 'base', token: addr(0xcc) })
    check('after 3 free checks: the quota is used up and the next costs $9', q4.data.quote.free === false && q4.data.quote.priceUsd === 9 && q4.data.quote.quota.used === 3 && q4.data.quote.quota.left === 0)
    const stale = await post(C.sub, { chain: 'base', token: addr(0xcc), expect: { priceUsd: 0 } })
    check('a stale "free" confirmation after the quota is used: 409 price-changed, no silent charge', stale.status === 409 && stale.data.code === 'price-changed')
    for (const id of ids) await waitFor(C.sub, id, finished)
    const tf = await post(C.sub, { chain: 'base', token: TOKEN, expect: { priceUsd: 0 } })
    check('with the quota used, a "free" confirmation is refused even for a token not in progress', tf.status === 409)
    const other = await post(C.other, T)
    check('another wallet on the Free plan is not affected by that quota', other.data.quote.free === false)
  }

  /* ---- bundle with a Gully Security scan -------------------------------------------------------- */
  {
    const mkScan = (over = {}) => {
      const inv = invoices.createInvoiceRecord({ title: 'test scan', usdCents: 9900n, assets: ['usdc-base'], ttlMs: 86_400_000 })
      const job = { id: 'sec_' + crypto.randomBytes(12).toString('base64url'), workspace: A.buyer, createdAt: new Date().toISOString(), input: { kind: 'address', chain: 'base', address: TOKEN }, free: false, priceCents: '9900', invoiceId: inv.id, state: 'started', status: 'done', ...over }
      secStore.jobs().push(job)
      return { job, inv }
    }
    const paid = mkScan()
    payInvoice(paid.inv.id)
    const BT = { chain: 'base', token: TOKEN }
    const none = await post(ANON, { ...BT, bundleWithScan: { scanId: paid.job.id } })
    check('bundle without a sign-in: 401', none.status === 401 && none.data.code === 'sign-in-required')
    const wrongWs = await post(C.other, { ...BT, bundleWithScan: { scanId: paid.job.id } })
    check('bundle with another workspace\'s scan: 403', wrongWs.status === 403 && wrongWs.data.code === 'scan-not-yours')
    const unpaid = mkScan()
    check('bundle with an unpaid scan: 400 scan-not-paid (no discount before the scan is bought)', (await post(C.buyer, { ...BT, bundleWithScan: unpaid.job.id })).data?.code === 'scan-not-paid')
    const freeScan = mkScan({ free: true, invoiceId: null })
    check('bundle with a free-quota scan: 400 scan-not-paid', (await post(C.buyer, { ...BT, bundleWithScan: freeScan.job.id })).data?.code === 'scan-not-paid')
    const mism = mkScan({ input: { kind: 'address', chain: 'base', address: addr(0x555) } })
    payInvoice(mism.inv.id)
    check('bundle with a scan of another contract: 400 scan-mismatch', (await post(C.buyer, { ...BT, bundleWithScan: mism.job.id })).data?.code === 'scan-mismatch')
    const repo = mkScan({ input: { kind: 'github', repo: 'a/b', commit: null, ref: 'HEAD' } })
    payInvoice(repo.inv.id)
    check('bundle with a repository scan: 400 scan-mismatch', (await post(C.buyer, { ...BT, bundleWithScan: repo.job.id })).data?.code === 'scan-mismatch')
    check('bundle on a chain outside the scan\'s: 400 bundle-chain', (await post(C.buyer, { chain: 'hyperevm', token: TOKEN, bundleWithScan: paid.job.id })).data?.code === 'bundle-chain')
    const q = await post(C.buyer, { ...BT, bundleWithScan: { scanId: paid.job.id } })
    check('bundle with a paid scan of the same contract: 20% off ($7.20), applied, scan named', q.status === 200 && q.data.quote.priceUsd === 7.2 && q.data.quote.bundle.applied === true && q.data.quote.bundle.discountPct === 20 && q.data.quote.bundle.scanId === paid.job.id && q.data.quote.listPriceUsd === 9, JSON.stringify(q.data).slice(0, 300))
    const r = await post(C.buyer, { ...BT, bundleWithScan: paid.job.id, expect: { priceUsd: 7.2 } })
    const inv = r.data?.payment?.invoiceId
    const got = await fetch(`${BASE}/api/pay/${inv}`).then((x) => x.json())
    check('confirmed: 202 and an invoice of exactly $7.20', r.status === 202 && r.data.check.bundled === true && r.data.payment.usd === 7.2 && got.invoice.usdCents === '720', `${r.status} ${got.invoice?.usdCents}`)
    const reuse = await post(C.buyer, { ...BT, bundleWithScan: paid.job.id })
    check('one scan, one discount: a scan already used by a live check is refused (409 scan-used)', reuse.status === 409 && reuse.data.code === 'scan-used', `${reuse.status} ${reuse.data?.code}`)
    await C.buyer.post(`${DEEP}/${r.data.check.id}/cancel`)
    const again = await post(C.buyer, { ...BT, bundleWithScan: paid.job.id, expect: { priceUsd: 7.2 } })
    check('after cancelling that check (nothing was bought), the scan can give its discount again', again.status === 202 && again.data.payment.usd === 7.2, `${again.status}`)
    await C.buyer.post(`${DEEP}/${again.data.check.id}/cancel`)
    secStore.jobs().find((j) => j.id === paid.job.id).state = 'cancelled'
    check('a cancelled scan gives no discount', (await post(C.buyer, { ...BT, bundleWithScan: paid.job.id })).data?.code === 'scan-not-paid')
  }

  /* ---- persistence and the engine failing ----------------------------------------------------------- */
  {
    routes.resetDeepForTest()
    const again = await get(ANON, paidId)
    check('the store survives a reload from disk (report id still works)', again.status === 200 && again.data.check.status === 'done' && again.data.check.report?.status === 'done')
    let n = 0
    routes.setDeepEngineForTest({ deps: makeDeps().deps, run: async () => { n++; throw new Error('boom') } })
    const r = await post(C.sub, { chain: 'base', token: addr(0xe5), expect: { priceUsd: 9 } })
    payInvoice(r.data.payment.invoiceId)
    const f = await waitFor(ANON, r.data.check.id, finished, 10_000)
    check('an engine crash is retried up to 3 times, then the check is "failed" with a way to reach us (never stuck running)', f.status === 'failed' && n === 3 && /hello@gullylabs\.xyz/.test(f.error ?? ''), `${f?.status} runs ${n}`)
    routes.setDeepEngineForTest({ deps: makeDeps().deps })
  }
} catch (e) {
  check(`API tests: no exception (${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')})`, false)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
