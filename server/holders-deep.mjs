// Holder Map "Deep check": the paid, bounded investigation of one (chain, token), built on the free map.
//
// What it computes (each part is a section of the report; every finding states its source and confidence,
// and what cannot be read shows as "unavailable" with the reason, never as a guess):
//   funding    for the top N unlabelled holders (and the deployer): where the first native coin (explorer) or
//              first token transfer (Transfer logs) came from, followed up to K hops. Exchange origins (labelled)
//              end a trace. Funders shared by two or more traced wallets are listed.
//   clusters   the map's direct-transfer clusters, the clusters formed by shared funders, and both combined.
//   deployer   the deployer's record across the supported chains: other tokens deployed (the Gully Launchpad's
//              record on Gully Chain, and the explorer's contract-creation transactions where an explorer key is set).
//   trading    snipers and bundled buys: buys in the first blocks after the first liquidity. For a launch the map
//              recognises (complete history) this is the map's own forensics (exact); for ANY other EVM token it is
//              inferred from the token's Transfer history (the pool is the contract that paid tokens out to many
//              wallets), and says so.
//
// Budgets: HOLDER_DEEP.budgets (plans.mjs) cap RPC calls, log reads, explorer reads, wall time, the holders traced
// and the hops. A check that reaches a limit finishes "partial" with the reason(s) and keeps what it found.
//
// Read-only on holders.mjs, holders-logs.mjs and gully-chain.mjs: only their exports are used. Own helpers here (not
// exported there): the Blockscout explorer reads, name tags, Solana first-funder reads. All upstream IO goes through
// `deps` so tests stub it.

import { evmRpc, HOLDER_CHAINS, holdersAvailable, readCode, readHolderMap, reconstructBalances } from './holders.mjs'
import { archiveKnown, readOwnHistory } from './holders-logs.mjs'
import { creatorHistory } from './gully-chain.mjs'
import { HOLDER_DEEP } from './plans.mjs'
import { solanaRpc } from './solana.mjs'

const ZERO = '0x0000000000000000000000000000000000000000'
const DEAD = '0x000000000000000000000000000000000000dead'
const SNIPER_BLOCKS = 5
const lower = (a) => String(a ?? '').toLowerCase()
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null)
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a ?? ''))
const EXCHANGE_RE = /\b(binance|coinbase|okx|bybit|kraken|kucoin|gate\.io|bitget|mexc|htx|huobi|crypto\.com|bitfinex|upbit|bitstamp)\b/i
const INFRA_KINDS = new Set(['pool', 'lock', 'burn', 'token', 'router', 'gully', 'exchange'])

/* ------------------------------------------------------------------ budget --- */

export class BudgetStop extends Error {
  constructor(code, text) {
    super(text)
    this.code = code
  }
}
const STOP_TEXT = {
  'rpc-calls': (l) => `The RPC call budget (${l.rpcCalls} calls) was reached.`,
  'log-spans': (l) => `The log-read budget (${l.logSpans} reads) was reached.`,
  'explorer-calls': (l) => `The explorer and API read budget (${l.explorerCalls} reads) was reached.`,
  time: (l) => `The time budget (${Math.round(l.ms / 1000)} s) was reached.`,
}

/** A per-check budget. `take(kind, n)` spends or throws BudgetStop; `reasons` lists the limits that were hit. */
export function makeBudget(limits = HOLDER_DEEP.budgets, now = () => Date.now()) {
  const started = now()
  const used = { rpcCalls: 0, logSpans: 0, explorerCalls: 0 }
  const KEY = {
    rpc: ['rpcCalls', 'rpc-calls'],
    span: ['logSpans', 'log-spans'],
    explorer: ['explorerCalls', 'explorer-calls'],
  }
  const hit = new Map()
  const stop = (code) => {
    if (!hit.has(code)) hit.set(code, { code, text: STOP_TEXT[code](limits) })
    throw new BudgetStop(code, hit.get(code).text)
  }
  return {
    limits,
    used,
    elapsed: () => now() - started,
    check() {
      if (now() - started >= limits.ms) stop('time')
    },
    take(kind, n = 1) {
      this.check()
      const [field, code] = KEY[kind]
      if (used[field] + n > limits[field]) stop(code)
      used[field] += n
    },
    /** Records a stop that was caught elsewhere. */
    note(e) {
      if (e instanceof BudgetStop && !hit.has(e.code)) hit.set(e.code, { code: e.code, text: e.message })
    },
    get reasons() {
      return [...hit.values()]
    },
    snapshot: () => ({
      rpcCalls: used.rpcCalls,
      logSpans: used.logSpans,
      explorerCalls: used.explorerCalls,
      ms: now() - started,
    }),
  }
}

/* ------------------------------------------------------------ upstream deps --- */

const explorerKey = () => String(process.env.BLOCKSCOUT_API_KEY ?? '').trim()
const explorerBase = () => String(process.env.BLOCKSCOUT_API ?? 'https://api.blockscout.com').replace(/\/+$/, '')
const metaBase = () => String(process.env.BLOCKSCOUT_METADATA_API ?? 'https://metadata.services.blockscout.com').replace(/\/+$/, '')
const solanaRpcSet = () => String(process.env.GULLY_RPC_SOLANA ?? '').trim() !== ''

async function fetchJson(url) {
  try {
    const r = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'gully-labs-holder-deep/1',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    })
    const body = await r.json().catch(() => null)
    return { ok: r.ok && !!body, status: r.status, body }
  } catch (e) {
    return {
      ok: false,
      status: null,
      body: null,
      error: String(e?.message ?? e).slice(0, 160),
    }
  }
}

/** The real upstreams. Tests pass their own object with the same members. */
export function liveDeps() {
  return {
    readMap: (chainKey, token) => readHolderMap(chainKey, token, { tier: 'pro' }),
    rpc: (chainKey, method, params) => evmRpc(chainKey, method, params),
    code: (chainKey, addrs) => readCode(chainKey, addrs),
    ownHistory: (chainKey, token) => readOwnHistory(chainKey, token),
    // The Gully Launchpad's record of a creator on Gully Chain (our own indexer), or null.
    launchpadRecord: (creator) => creatorHistory(creator),
    fetchJson,
    solana: (method, params) => solanaRpc(method, params),
    chains: HOLDER_CHAINS,
    explorerKey,
  }
}

/* ---------------------------------------------------------------- coverage --- */

/**
 * What a Deep check can compute on a chain right now, from configuration only (no network): shown in the quote so
 * nobody pays for a section that cannot run. `state`: 'available' | 'limited' | 'unavailable'.
 */
export function coverage(chainKeyIn, { deps = null } = {}) {
  const chainKey = String(chainKeyIn ?? '').toLowerCase()
  const chains = deps?.chains ?? HOLDER_CHAINS
  const c = chains[chainKey]
  if (!c) return null
  const key = deps ? !!deps.explorerKey?.() : explorerKey() !== ''
  const sol = chainKey === 'solana'
  const archive = sol ? false : deps ? !!deps.archive : archiveKnown(chainKey)
  // Gully Chain: the Gully Launchpad's own record names a launch's creator and their other launches.
  const launchpad = !sol && !!c.ownArchive
  const part = (state, reason) => ({ state, reason: reason ?? null })
  if (sol) {
    const have = deps ? !!deps.solanaSet : solanaRpcSet()
    return {
      chain: chainKey,
      funding: have
        ? part('limited', 'First funding is read from the Solana RPC for wallets with up to 1,000 transactions.')
        : part('unavailable', 'No Solana RPC with transaction history is configured.'),
      clusters: have ? part('limited', 'Direct-transfer clusters are not drawn on Solana yet; shared-funder clusters follow the funding trace.') : part('unavailable', 'Clusters on Solana come from the funding trace, which needs a Solana RPC with history.'),
      deployer: part('unavailable', 'The deployer of a Solana token is not read yet.'),
      trading: part('unavailable', 'Sniper and bundle detection needs the token’s transfer history, which is not read on Solana yet.'),
    }
  }
  return {
    chain: chainKey,
    funding: key
      ? part('available', archive ? null : 'Only the explorer’s first-funding reads; token transfers need an archive RPC.')
      : archive
        ? part('limited', 'No explorer key: only the first transfer of this token to each wallet is traced, not the native coin.')
        : part('unavailable', 'No explorer key and no archive RPC.'),
    clusters: archive ? part('available', null) : part('limited', 'Direct-transfer clusters need the token’s full transfer history; shared-funder clusters still work.'),
    deployer: launchpad
      ? part('limited', 'The Gully Launchpad’s record only (Gully Chain has no explorer API for contract creations).')
      : key
        ? part('limited', 'Explorer contract creations only.')
        : part('unavailable', 'The deployer needs an explorer key (or a Gully Launchpad launch on Gully Chain).'),
    trading: archive
      ? part('available', 'Exact for launches the map recognises; inferred from transfers for any other token.')
      : part('unavailable', 'Needs an archive RPC to read the first blocks.'),
  }
}

/** True when at least one section can run (a Deep check is not sold for a chain where nothing can). */
export const anyCoverage = (cov) => !!cov && ['funding', 'clusters', 'deployer', 'trading'].some((k) => cov[k].state !== 'unavailable')

/* --------------------------------------------------------------- the engine --- */

const finding = (f) => f
const conf = (c) => (['high', 'medium', 'low'].includes(c) ? c : 'low')

/**
 * Runs one Deep check. Never throws. Resolves to the report (see holders-deep-routes.mjs for the shape).
 *   onProgress({ pct, message })    optional
 *   deps                            upstreams (liveDeps() by default)
 *   limits                          budgets (HOLDER_DEEP.budgets by default)
 */
export async function runDeepCheck({ chain, token: tokenIn, deps = liveDeps(), limits = HOLDER_DEEP.budgets, onProgress = () => {}, now = () => Date.now() } = {}) {
  const chains = deps.chains ?? HOLDER_CHAINS
  const chainKey = String(chain ?? '').toLowerCase()
  const c = chains[chainKey]
  const budget = makeBudget(limits, now)
  const sol = chainKey === 'solana'
  const token = sol ? String(tokenIn) : lower(tokenIn)
  const report = {
    version: 1,
    chain: c ? { key: chainKey, id: c.id, name: c.name } : { key: chainKey, id: null, name: chainKey },
    token: { address: token, symbol: null, name: null, url: null },
    generatedAt: new Date(now()).toISOString(),
    status: 'done',
    partial: null,
    budget: { limits, used: null },
    base: { mapState: null, kind: null, note: null },
    sections: {},
    findings: [],
    unavailable: [],
    notes: [
      'Every finding names its source and confidence. Confidence "high" is read directly from chain data or a labelled source; "medium" is inferred from it; "low" rests on partial data. Data we could not get is listed as unavailable, never guessed.',
      'Payment buys the computation only; it cannot change what a check finds.',
    ],
  }
  const unavailable = (section, what, reason) => {
    report.unavailable.push({ section, what, reason })
  }
  const step = (pct, message) => {
    try {
      onProgress({ pct, message })
    } catch {
      /* progress is best effort */
    }
  }
  const safe = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      if (e instanceof BudgetStop) {
        budget.note(e)
        report.sections[name] ??= { state: 'partial', reason: e.message }
        if (report.sections[name].state === 'ok') report.sections[name].state = 'partial'
        report.sections[name].reason ??= e.message
      } else {
        console.error(`holders-deep ${name}:`, e?.message ?? e)
        report.sections[name] = {
          state: 'unavailable',
          reason: `This part failed while reading its sources (${String(e?.message ?? e).slice(0, 100)}).`,
        }
        unavailable(name, name, report.sections[name].reason)
        budget.note(new BudgetStop('error', 'A source failed while reading.'))
      }
    }
  }

  if (!c) {
    report.status = 'failed'
    report.error = 'Unknown chain.'
    return report
  }
  const cov = coverage(chainKey, { deps })

  // ---- 1. the map (the existing holder data) -----------------------------------------------------------
  step(5, 'Reading the holder map')
  let map = null
  try {
    map = await deps.readMap(chainKey, token)
  } catch (e) {
    map = { state: 'error', reason: String(e?.message ?? e) }
  }
  report.base.mapState = map?.state ?? 'error'
  if (map?.state === 'ok') {
    report.token = { ...report.token, ...map.token }
    report.base.kind = map.kind
    report.base.sources = map.sources ?? null
    report.base.holders = map.holders ?? null
    report.base.note = 'Built on the Holder Map for this token.'
  } else {
    report.base.note =
      map?.state === 'not-found'
        ? 'There is no holder map for this address, so the check runs from the token’s own transfers and the explorer.'
        : `The holder map is not available (${map?.reason ?? map?.state}); the check runs from the token’s own transfers and the explorer.`
  }
  const nodes = map?.state === 'ok' ? map.nodes : []
  const labels = new Map() // address -> { kind, name, exchange? }
  for (const n of nodes)
    if (n.label)
      labels.set(n.id, {
        kind: n.label.kind,
        name: n.label.name,
        exchange: n.label.kind === 'exchange',
      })
  const funderCache = new Map() // address -> result
  const unavailableFunding = new Set()
  const tagged = new Set()
  const deployer = map?.state === 'ok' ? (map.forensics?.deployer ?? null) : null

  // ---- 2. transfers (lazy, memoised) -----------------------------------------------------------------
  let history = null // { state, transfers, complete, source, note }
  async function getHistory() {
    if (history) return history
    history = {
      state: 'unavailable',
      transfers: [],
      complete: false,
      source: null,
      note: null,
    }
    if (sol)
      return Object.assign(history, {
        note: 'Transfer history is not read on Solana.',
      })
    try {
      budget.take('span')
    } catch (e) {
      budget.note(e)
      return Object.assign(history, { note: e.message })
    }
    const own = await deps.ownHistory(chainKey, token).catch(() => ({ state: 'error' }))
    if (own.state === 'ok')
      return Object.assign(history, {
        state: 'ok',
        transfers: own.transfers,
        complete: true,
        source: 'Our own index of the chain’s Transfer logs (every transfer since deployment)',
      })
    const why = {
      backfilling: 'The token’s full history is still being read from the chain; try again later.',
      'no-archive': 'No archive RPC answers for this chain, so the token’s history cannot be read.',
      capped: 'The token has more transfers than the index rebuilds.',
      error: 'The token’s transfers could not be read.',
    }
    return Object.assign(history, {
      note: why[own.state] ?? 'The token’s transfers could not be read.',
    })
  }

  // ---- 3. trading: snipers and bundles -----------------------------------------------------------------
  step(15, 'Looking at the first blocks after liquidity')
  await safe('trading', async () => {
    if (sol) {
      report.sections.trading = {
        state: 'unavailable',
        reason: cov.trading.reason,
      }
      unavailable('trading', 'Snipers and bundled buys', cov.trading.reason)
      return
    }
    if (map?.state === 'ok' && map.forensics) {
      const f = map.forensics
      const flagged = (flag) => nodes.filter((n) => n.flags.includes(flag)).map((n) => ({ address: n.id, pct: n.pct }))
      report.sections.trading = {
        state: 'ok',
        method: 'launch-forensics',
        source: 'The launch’s full transfer history (the Holder Map) and its pool labels',
        confidence: 'high',
        launchBlock: f.launchBlock,
        firstTradeBlock: f.firstTradeBlock,
        window: { blocks: f.snipers.blocks },
        snipers: {
          count: f.snipers.wallets,
          pctOfSupply: f.snipers.pct,
          wallets: flagged('sniper'),
          walletsNote: 'Wallets listed are those among the mapped top holders; the count covers all buyers.',
        },
        bundled: {
          count: f.bundled.wallets,
          pctOfSupply: f.bundled.pct,
          firstBlockBuyers: f.bundled.firstBlockBuyers,
          wallets: flagged('bundled'),
        },
        buyers: f.buyers,
      }
      report.findings.push(
        finding({
          id: 'trading-bundle',
          section: 'trading',
          text: f.riskLine,
          confidence: 'high',
          source: 'Launch transfer history + launch pool labels',
        }),
      )
      if (f.firstTradeBlock !== null)
        report.findings.push(
          finding({
            id: 'trading-snipers',
            section: 'trading',
            text: `${f.snipers.wallets} wallet${f.snipers.wallets === 1 ? '' : 's'} made their first buy within ${f.snipers.blocks} blocks of the first trade and hold ${f.snipers.pct ?? '?'}% now.`,
            confidence: 'high',
            source: 'Launch transfer history + launch pool labels',
          }),
        )
      return
    }
    const h = await getHistory()
    if (!h.transfers.length) {
      const reason = h.note ?? 'The token’s transfers could not be read.'
      report.sections.trading = { state: 'unavailable', reason }
      unavailable('trading', 'Snipers and bundled buys', reason)
      return
    }
    const t = await inferTrading({
      chainKey,
      token,
      transfers: h.transfers,
      complete: h.complete,
      deps,
      budget,
    })
    if (t.pool) labels.set(t.pool, { kind: 'pool', name: 'Inferred liquidity pool' })
    report.sections.trading = {
      ...t,
      source: `${h.source ?? 'Transfer history'}; the pool is inferred, not labelled`,
      window: { blocks: SNIPER_BLOCKS },
    }
    if (t.state === 'unavailable') {
      unavailable('trading', 'Snipers and bundled buys', t.reason)
      return
    }
    if (h.state === 'partial') {
      report.sections.trading.state = 'partial'
      report.sections.trading.reason = h.note
    }
    const cf = conf(t.confidence)
    report.findings.push(
      finding({
        id: 'trading-snipers',
        section: 'trading',
        text: `${t.snipers.count} wallet${t.snipers.count === 1 ? '' : 's'} bought within ${SNIPER_BLOCKS} blocks of the first trade out of the inferred pool ${short(t.pool)}.`,
        confidence: cf,
        source: report.sections.trading.source,
      }),
    )
    for (const b of t.bundles.slice(0, 3))
      report.findings.push(
        finding({
          id: `trading-bundle-${b.block}`,
          section: 'trading',
          text: `${b.wallets.length} wallets bought in block ${b.block}${b.block === t.firstTradeBlock ? ', the first block of trading' : ''}.`,
          confidence: cf,
          source: report.sections.trading.source,
        }),
      )
    if (!t.bundles.length)
      report.findings.push(
        finding({
          id: 'trading-bundle',
          section: 'trading',
          text: 'No block in the first blocks of trading had two or more buying wallets.',
          confidence: cf,
          source: report.sections.trading.source,
        }),
      )
  })

  // ---- 4. funding trace --------------------------------------------------------------------------------
  step(35, 'Tracing where the biggest holders were funded')
  const traces = []
  await safe('funding', async () => {
    const wallets = await pickWallets()
    if (!wallets.length) {
      const reason = sol
        ? 'The top holders of this token are not known (no holder map on Solana for this token).'
        : 'The holders could not be listed: there is no holder map for this token and its full transfer history is not available.'
      report.sections.funding = { state: 'unavailable', reason }
      unavailable('funding', 'Funding trace', reason)
      return
    }
    const sec = (report.sections.funding = {
      state: 'ok',
      reason: null,
      wallets: wallets.length,
      hopsMax: limits.hops,
      traces,
      sharedFunders: [],
      sources: [],
    })
    for (const w of wallets)
      traces.push({
        address: w.address,
        role: w.role,
        rank: w.rank ?? null,
        pctOfSupply: w.pct ?? null,
        hops: [],
        origin: null,
      })
    await traceAll(sec)
  })

  async function pickWallets() {
    const N = limits.holders
    const out = []
    if (map?.state === 'ok') {
      for (const n of nodes) {
        if (n.label || n.contract === true) continue
        out.push({ address: n.id, rank: n.rank, pct: n.pct, role: 'holder' })
        if (out.length >= N) break
      }
    } else if (!sol) {
      const h = await getHistory()
      if (!h.complete) return []
      const bal = reconstructBalances(h.transfers)
      const total = [...bal].reduce((s, [a, v]) => (v > 0n && a !== ZERO ? s + v : s), 0n)
      const ranked = [...bal]
        .filter(([a, v]) => v > 0n && a !== ZERO && a !== DEAD && a !== token)
        .sort((a, b) => (b[1] > a[1] ? 1 : -1))
        .slice(0, N * 3)
      budget.take('rpc', ranked.length)
      const code = await deps.code(
        chainKey,
        ranked.map(([a]) => a),
      )
      let rank = 0
      for (const [a, v] of ranked) {
        rank++
        if (code.get(a) !== false) continue
        out.push({
          address: a,
          rank,
          pct: total > 0n ? round2(Number((v * 1_000_000n) / total) / 10_000) : null,
          role: 'holder',
        })
        if (out.length >= N) break
      }
    }
    if (deployer && !out.some((w) => w.address === deployer))
      out.push({
        address: deployer,
        rank: null,
        pct: nodes.find((n) => n.id === deployer)?.pct ?? null,
        role: 'deployer',
      })
    return out
  }

  async function firstFunder(addr) {
    if (funderCache.has(addr)) return funderCache.get(addr)
    const r = await firstFunderUncached(addr)
    funderCache.set(addr, r)
    return r
  }
  async function firstFunderUncached(addr) {
    if (sol) return solanaFirstFunder(addr, { deps, budget })
    const tries = []
    if (deps.explorerKey?.()) {
      const r = await explorerFirstNativeFunder(addr, {
        deps,
        budget,
        chainId: c.id,
      })
      if (r.from) return r
      tries.push(r)
    }
    const h = history ?? (nodes.length && !deps.explorerKey?.() ? await getHistory() : null)
    if (h?.transfers?.length) {
      const first = h.transfers.find((t) => t.to === addr && t.from !== ZERO && t.from !== addr)
      if (first) {
        const lk = labels.get(first.from)
        const viaPool = h.transfers.some((x) => x.tx === first.tx && ['pool', 'router'].includes(labels.get(x.from)?.kind))
        if (viaPool || lk?.kind === 'pool' || lk?.kind === 'router')
          return {
            from: null,
            bought: true,
            reason: 'The first tokens came from a pool (a buy), which is not funding.',
            source: h.source,
          }
        return {
          from: first.from,
          kind: 'token',
          block: first.block,
          tx: first.tx,
          source: `${h.source ?? 'Transfer logs'}: first transfer of this token to the wallet`,
          confidence: h.complete ? 'high' : 'low',
        }
      }
      if (h.complete)
        tries.push({
          from: null,
          reason: 'No transfer of this token to the wallet from another address.',
        })
    }
    return (
      tries.at(-1) ?? {
        from: null,
        unavailable: true,
        reason: cov.funding.reason ?? 'No source for first funding is available on this chain.',
      }
    )
  }

  async function traceAll(sec) {
    const live = traces.filter((t) => t)
    let frontier = live.map((t) => ({
      t,
      cur: t.address,
      seen: new Set([t.address]),
    }))
    try {
      for (let hop = 1; hop <= limits.hops && frontier.length; hop++) {
        const next = []
        for (const f of frontier) {
          budget.check()
          const r = await firstFunder(f.cur)
          if (!r.from) {
            if (r.bought && r.source && !sec.sources.includes(r.source)) sec.sources.push(r.source)
            f.t.origin = r.bought
              ? { type: 'buy', note: r.reason }
              : {
                  type: 'unknown',
                  reason: r.reason ?? 'No funding found.',
                  unavailable: !!r.unavailable,
                }
            if (r.unavailable && !unavailableFunding.has(r.reason)) {
              unavailableFunding.add(r.reason)
              unavailable('funding', 'First funding', r.reason)
            }
            continue
          }
          f.t.hops.push({
            hop,
            from: r.from,
            to: f.cur,
            kind: r.kind,
            block: r.block ?? null,
            tx: r.tx ?? null,
            at: r.at ?? null,
            source: r.source,
            confidence: conf(r.confidence),
          })
          if (r.kind && !sec.sources.includes(r.source)) sec.sources.push(r.source)
          if (f.seen.has(r.from)) {
            f.t.origin = { type: 'cycle', address: r.from }
            continue
          }
          f.seen.add(r.from)
          next.push({ ...f, cur: r.from })
        }
        // Labels for this hop's funders (map labels, then explorer name tags), before deciding who goes on.
        await labelFunders(next.map((n) => n.cur))
        frontier = []
        for (const n of next) {
          const lk = labels.get(n.cur)
          if (lk && (lk.exchange || INFRA_KINDS.has(lk.kind) || lk.kind === 'known')) {
            n.t.origin = {
              type: lk.exchange ? 'exchange' : 'labelled',
              address: n.cur,
              label: lk.name,
            }
          } else if (hop === limits.hops)
            n.t.origin = {
              type: 'wallet',
              address: n.cur,
              note: `Hop limit (${limits.hops}) reached; the funder of this wallet was not followed.`,
            }
          else frontier.push(n)
        }
      }
    } catch (e) {
      if (!(e instanceof BudgetStop)) throw e
      budget.note(e)
      sec.state = 'partial'
      sec.reason = e.message
    }
    for (const t of traces) t.origin ??= { type: 'unknown', reason: 'Not traced further.' }
    for (const t of traces) for (const h of t.hops) h.fromLabel = labels.get(h.from)?.name ?? null
    // Shared funders: any funder (any hop) that funded two or more traced wallets' chains.
    const byFunder = new Map()
    for (const t of traces)
      for (const h of t.hops) {
        const e = byFunder.get(h.from) ?? {
          address: h.from,
          wallets: new Set(),
          hops: new Set(),
        }
        e.wallets.add(t.address)
        e.hops.add(h.hop)
        byFunder.set(h.from, e)
      }
    for (const e of byFunder.values()) {
      if (e.wallets.size < 2) continue
      const lk = labels.get(e.address)
      sec.sharedFunders.push({
        address: e.address,
        label: lk?.name ?? null,
        labelled: !!lk,
        exchange: !!lk?.exchange,
        wallets: [...e.wallets],
        hops: [...e.hops].sort(),
        confidence: lk ? 'low' : 'medium',
        note: lk?.exchange
          ? 'A shared exchange is not evidence of common control: many people use one exchange.'
          : lk
            ? 'A shared labelled service is not evidence of common control.'
            : 'The same unlabelled address first funded these wallets.',
      })
    }
    sec.sharedFunders.sort((a, b) => b.wallets.length - a.wallets.length)
    const ex = traces.filter((t) => t.origin?.type === 'exchange').length
    report.findings.push(
      finding({
        id: 'funding-summary',
        section: 'funding',
        text: `Traced ${traces.length} wallet${traces.length === 1 ? '' : 's'}: ${traces.filter((t) => t.hops.length).length} with a funding source found, ${ex} funded from an exchange${sec.sharedFunders.some((s) => !s.labelled) ? `, ${sec.sharedFunders.filter((s) => !s.labelled).length} shared unlabelled funder${sec.sharedFunders.filter((s) => !s.labelled).length === 1 ? '' : 's'}` : ''}.`,
        confidence: sec.sources.length ? 'high' : 'low',
        source: sec.sources.join('; ') || 'none',
      }),
    )
    for (const s of sec.sharedFunders.filter((x) => !x.labelled).slice(0, 5))
      report.findings.push(
        finding({
          id: `funding-shared-${s.address.slice(2, 8)}`,
          section: 'funding',
          text: `${short(s.address)} first funded ${s.wallets.length} of the traced wallets (${s.wallets.map(short).join(', ')}).`,
          confidence: 'medium',
          source: sec.sources.join('; '),
        }),
      )
    if (!sec.sources.length) {
      sec.state = 'unavailable'
      sec.reason = report.unavailable.find((u) => u.section === 'funding')?.reason ?? 'No funding source could be read.'
    }
  }
  async function labelFunders(addrs) {
    if (sol || !deps.explorerKey?.()) return
    const want = [...new Set(addrs)].filter((a) => !labels.has(a) && !tagged.has(a)).slice(0, 50)
    if (!want.length) return
    budget.take('explorer')
    for (const a of want) tagged.add(a)
    const r = await deps.fetchJson(`${metaBase()}/api/v1/metadata?addresses=${want.join(',')}&chainId=${c.id}`)
    for (const [a, v] of Object.entries(r.body?.addresses ?? {})) {
      const tags = Array.isArray(v?.tags) ? v.tags : []
      const name = tags.find((t) => t?.tagType === 'name')?.name
      if (!name) continue
      labels.set(lower(a), {
        kind: 'known',
        name: String(name).slice(0, 48),
        exchange: tags.some((t) => /exchange|cex/i.test(String(t?.slug ?? ''))) || EXCHANGE_RE.test(String(name)),
      })
    }
  }

  // ---- 5. clusters -----------------------------------------------------------------------------------
  step(65, 'Building clusters')
  await safe('clusters', async () => {
    const direct = (map?.state === 'ok' ? map.clusters : []).map((k) => ({
      id: k.id,
      wallets: k.wallets,
      pctOfSupply: k.pct,
      hasDeployer: !!k.hasDeployer,
    }))
    const edges = []
    const shared = (report.sections.funding?.sharedFunders ?? []).filter((s) => !s.labelled)
    for (const s of shared) for (let i = 1; i < s.wallets.length; i++) edges.push([s.wallets[0], s.wallets[i]])
    const sharedGroups = clusterGroups(edges).map((g, i) => ({
      id: `s${i + 1}`,
      wallets: g,
      pctOfSupply: pctOfNodes(g),
      via: shared.filter((s) => s.wallets.some((w) => g.includes(w))).map((s) => s.address),
    }))
    const all = [...direct.flatMap((k) => k.wallets.slice(1).map((w) => [k.wallets[0], w])), ...edges]
    const combined = clusterGroups(all)
      .map((g, i) => {
        const inDirect = direct.some((k) => k.wallets.some((w) => g.includes(w)))
        const inShared = sharedGroups.some((k) => k.wallets.some((w) => g.includes(w)))
        return {
          id: `m${i + 1}`,
          wallets: g,
          count: g.length,
          pctOfSupply: pctOfNodes(g),
          basis: inDirect && inShared ? 'direct-transfers+shared-funder' : inShared ? 'shared-funder' : 'direct-transfers',
          confidence: inDirect ? 'high' : 'medium',
        }
      })
      .sort((a, b) => (b.pctOfSupply ?? 0) - (a.pctOfSupply ?? 0))
    const dState = map?.state === 'ok' ? 'ok' : 'unavailable'
    const sState = report.sections.funding?.state === 'ok' || report.sections.funding?.state === 'partial' ? 'ok' : 'unavailable'
    report.sections.clusters = {
      state: dState === 'ok' || sState === 'ok' ? 'ok' : 'unavailable',
      reason:
        dState === 'ok' && sState === 'ok'
          ? null
          : dState !== 'ok'
            ? 'Direct-transfer clusters come from the holder map, which this token does not have.'
            : 'Shared-funder clusters need the funding trace, which was not available.',
      direct: {
        state: dState,
        source: 'Holder Map: direct transfers between the top holders',
        confidence: 'high',
        clusters: direct,
      },
      sharedFunder: {
        state: sState,
        source: 'Funding trace: wallets whose first funding came from the same unlabelled address',
        confidence: 'medium',
        clusters: sharedGroups,
      },
      combined,
    }
    if (report.sections.clusters.state === 'unavailable') unavailable('clusters', 'Clusters', report.sections.clusters.reason)
    else
      report.findings.push(
        finding({
          id: 'clusters-summary',
          section: 'clusters',
          text: combined.length
            ? `${combined.length} connected group${combined.length === 1 ? '' : 's'} among the traced and mapped wallets; the largest holds ${combined[0].pctOfSupply ?? '?'}% across ${combined[0].count} wallets.`
            : 'No connected groups were found by direct transfers or shared funders.',
          confidence: combined[0]?.confidence ?? 'medium',
          source: 'Holder Map direct transfers; funding trace shared funders',
        }),
      )
  })
  function clusterGroups(edges) {
    const parent = new Map()
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x)
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)))
        x = parent.get(x)
      }
      return x
    }
    for (const [a, b] of edges) {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    const groups = new Map()
    for (const a of parent.keys()) {
      const r = find(a)
      groups.set(r, [...(groups.get(r) ?? []), a])
    }
    return [...groups.values()].filter((g) => g.length >= 2)
  }
  function pctOfNodes(list) {
    const known = list.map((a) => nodes.find((n) => n.id === a)?.pct ?? traces.find((t) => t.address === a)?.pctOfSupply).filter((p) => typeof p === 'number')
    return known.length ? round2(known.reduce((s, p) => s + p, 0)) : null
  }

  // ---- 6. the deployer's record ------------------------------------------------------------------------
  step(80, 'Reading the deployer’s record')
  await safe('deployer', async () => {
    const sec = (report.sections.deployer = {
      state: 'ok',
      reason: null,
      address: deployer,
      source: null,
      chains: [],
      tokens: [],
    })
    if (sol) {
      sec.state = 'unavailable'
      sec.reason = cov.deployer.reason
      unavailable('deployer', 'Deployer record', sec.reason)
      return
    }
    let who = deployer
    let whoSource = deployer ? `${map?.venue ?? 'Launchpad'} launch record` : null
    if (!who && deps.explorerKey?.()) {
      budget.take('explorer')
      const r = await deps.fetchJson(`${explorerBase()}/${c.id}/api/v2/addresses/${token}?apikey=${encodeURIComponent(deps.explorerKey())}`)
      const creator = lower(r.body?.creator_address_hash)
      if (isAddr(creator)) {
        who = creator
        whoSource = 'Explorer: contract creator'
      }
    }
    if (!who) {
      sec.state = 'unavailable'
      sec.reason = deps.explorerKey?.() ? 'The explorer does not say who deployed this token.' : 'The deployer is not known: this is not a launch the map recognises and no explorer key is set.'
      unavailable('deployer', 'Deployer record', sec.reason)
      return
    }
    sec.address = who
    sec.source = whoSource
    const seen = new Map()
    // The Gully Launchpad's record (Gully Chain): every token this address launched there, from our own indexer.
    if (c.ownArchive && deps.launchpadRecord) {
      budget.take('explorer')
      const h = await deps.launchpadRecord(who).catch(() => null)
      if (h) {
        for (const t of h.tokens ?? []) {
          if (t.address === token || seen.has(`${chainKey}:${t.address}`)) continue
          seen.set(`${chainKey}:${t.address}`, true)
          sec.tokens.push({
            chain: chainKey,
            address: t.address,
            symbol: t.symbol ?? null,
            outcome: null,
            outcomeNote: t.graduated ? 'Graduated to a Gully Swap pool.' : `On the bonding curve (${t.progressPct}%).`,
            source: 'Gully Launchpad record (Gully Chain indexer)',
            confidence: 'high',
            path: `/holders/${chainKey}/${t.address}`,
          })
        }
        sec.launchpad = { state: 'ok', total: h.launches, graduated: h.graduated }
      } else sec.launchpad = { state: 'unavailable', reason: 'The Gully Chain indexer could not be read for the creator’s other launches.' }
    } else sec.launchpad = { state: 'unavailable', reason: 'Launchpad records are read for the Gully Launchpad on Gully Chain.' }
    // The explorer's contract creations, chain by chain.
    if (deps.explorerKey?.()) {
      for (const [ck, ch] of Object.entries(deps.chains)) {
        // Solana is not read yet; a testnet (Gully Chain Testnet) has no explorer API that lists contract creations.
        if (ck === 'solana' || ch.testnet) continue
        const row = {
          chain: ck,
          name: ch.name,
          state: 'ok',
          reason: null,
          created: 0,
          tokens: 0,
          complete: false,
        }
        sec.chains.push(row)
        try {
          budget.take('explorer')
          const r = await deps.fetchJson(`${explorerBase()}/${ch.id}/api/v2/addresses/${who}/transactions?filter=from&apikey=${encodeURIComponent(deps.explorerKey())}`)
          if (!r.ok || !Array.isArray(r.body?.items)) {
            Object.assign(row, {
              state: 'unavailable',
              reason: `The explorer could not be read for ${ch.name}.`,
            })
            continue
          }
          const created = r.body.items.map((t) => lower(t?.created_contract?.hash)).filter(isAddr)
          row.created = created.length
          row.complete = !r.body.next_page_params
          for (const a of created.slice(0, 8)) {
            if (seen.has(`${ck}:${a}`) || (ck === chainKey && a === token)) continue
            budget.take('explorer')
            const tr = await deps.fetchJson(`${explorerBase()}/${ch.id}/api/v2/tokens/${a}?apikey=${encodeURIComponent(deps.explorerKey())}`)
            if (tr.ok && tr.body?.address_hash !== undefined && /20/.test(String(tr.body.type ?? 'ERC-20'))) {
              seen.set(`${ck}:${a}`, true)
              row.tokens++
              sec.tokens.push({
                chain: ck,
                address: a,
                symbol: tr.body.symbol ?? null,
                name: tr.body.name ?? null,
                holders: Number(tr.body.holders_count ?? tr.body.holders) || null,
                source: `Explorer (${ch.name}): contract created by the deployer`,
                confidence: 'high',
                outcome: null,
              })
            }
          }
          if (!row.complete) row.reason = 'Only the latest page of the deployer’s transactions was read; older deployments may exist.'
        } catch (e) {
          if (e instanceof BudgetStop) {
            row.state = 'partial'
            row.reason = e.message
            throw e
          }
          Object.assign(row, {
            state: 'unavailable',
            reason: 'The explorer could not be read.',
          })
        }
      }
    } else {
      sec.chains = Object.entries(deps.chains).filter(([, ch]) => !ch.testnet).map(([ck, ch]) => ({
        chain: ck,
        name: ch.name,
        state: 'unavailable',
        reason: ck === 'solana' ? 'The deployer of a Solana token is not read yet.' : 'No explorer key is configured, so contract creations on this chain are not read.',
        created: null,
        tokens: null,
      }))
    }
    const n = sec.tokens.length
    const noOutcome = n === 0 && sec.launchpad.state !== 'ok' && !sec.chains.some((r) => r.state === 'ok')
    if (noOutcome) {
      sec.state = 'unavailable'
      sec.reason = 'Neither a launchpad record nor an explorer could be read for the deployer’s other tokens.'
      unavailable('deployer', 'Deployer record', sec.reason)
      return
    }
    sec.source = [whoSource, sec.launchpad.state === 'ok' ? 'Gully Launchpad record' : null, sec.chains.some((r) => r.state === 'ok') ? 'explorer contract creations' : null]
      .filter(Boolean)
      .join('; ')
    const bad = sec.tokens.filter((t) => t.outcome === 'liquidity-pulled' || t.outcome === 'deployer-sold')
    report.findings.push(
      finding({
        id: 'deployer-record',
        section: 'deployer',
        text: n
          ? `The deployer ${short(who)} deployed ${n} other token${n === 1 ? '' : 's'} that we can see${bad.length ? `, ${bad.length} with a bad outcome (${bad.map((t) => t.outcome).join(', ')})` : ''}.`
          : `The deployer ${short(who)} has no other token we can see in the sources that answered.`,
        confidence: sec.chains.some((r) => r.state === 'ok' && r.complete) || sec.launchpad.state === 'ok' ? 'medium' : 'low',
        source: sec.source,
      }),
    )
    for (const ch of sec.chains) if (ch.state !== 'ok') unavailable('deployer', `${ch.name} deployments`, ch.reason)

  })

  // ---- finish ----------------------------------------------------------------------------------------------
  step(95, 'Writing the report')
  report.budget.used = budget.snapshot()
  const reasons = budget.reasons
  const notRun = ['trading', 'funding', 'clusters', 'deployer'].filter((k) => !report.sections[k])
  for (const k of notRun)
    report.sections[k] = {
      state: 'skipped',
      reason: reasons.length ? reasons[0].text : 'Not run.',
    }
  if (reasons.length || Object.values(report.sections).some((s) => s.state === 'partial')) {
    report.status = 'partial'
    report.partial = {
      reasons: reasons.length
        ? reasons
        : [
            {
              code: 'source',
              text: 'A source answered only part of what was asked.',
            },
          ],
    }
  }
  const okSections = Object.values(report.sections).filter((s) => s.state === 'ok' || s.state === 'partial').length
  if (!okSections) {
    report.status = 'failed'
    report.error = 'None of the parts could be computed for this token with the sources available.'
  }
  return report
}

/* ------------------------------------------------------------------ helpers --- */

/** Blockscout's first inbound native transfer of an address. { from, ... } or { from: null, unavailable?, reason }. */
async function explorerFirstNativeFunder(addr, { deps, budget, chainId }) {
  budget.take('explorer')
  const url = `${explorerBase()}/${chainId}/api/v2/addresses/${addr}/transactions?filter=to&sort=block_number&order=asc&apikey=${encodeURIComponent(deps.explorerKey())}`
  const r = await deps.fetchJson(url)
  if (!r.ok || !Array.isArray(r.body?.items))
    return {
      from: null,
      unavailable: true,
      reason: 'The explorer could not be read for first funding just now.',
    }
  let items = r.body.items
  const more = !!r.body.next_page_params
  const blk = (t) => Number(t?.block_number ?? t?.block ?? 0)
  const ascending = items.length < 2 || blk(items[0]) <= blk(items.at(-1))
  if (!ascending) {
    if (more)
      return {
        from: null,
        unavailable: true,
        reason: 'The wallet has too many incoming transactions for the explorer to return its first one.',
      }
    items = [...items].reverse()
  }
  const first = items.find(
    (t) => lower(t?.to?.hash) === addr && isAddr(t?.from?.hash) && lower(t.from.hash) !== addr && /^[1-9]\d*$/.test(String(t.value ?? '')) && (t.status === undefined || t.status === 'ok'),
  )
  if (first)
    return {
      from: lower(first.from.hash),
      kind: 'native',
      block: blk(first) || null,
      tx: lower(first.hash),
      at: first.timestamp ?? null,
      source: 'Explorer: first incoming native-coin transfer',
      confidence: 'high',
    }
  if (more)
    return {
      from: null,
      unavailable: true,
      reason: 'No native funding in the first page of the wallet’s incoming transactions.',
    }
  return {
    from: null,
    reason: 'The wallet never received native coin from another address.',
  }
}

/** Solana: the first signature of a wallet with at most 1,000 transactions, and who paid it SOL. */
async function solanaFirstFunder(addr, { deps, budget }) {
  if (!deps.solana)
    return {
      from: null,
      unavailable: true,
      reason: 'No Solana RPC is available.',
    }
  budget.take('rpc')
  const sigs = await deps.solana('getSignaturesForAddress', [addr, { limit: 1000 }]).catch(() => null)
  if (!Array.isArray(sigs))
    return {
      from: null,
      unavailable: true,
      reason: 'The Solana RPC could not list the wallet’s transactions.',
    }
  if (!sigs.length) return { from: null, reason: 'The wallet has no transactions.' }
  if (sigs.length >= 1000)
    return {
      from: null,
      unavailable: true,
      reason: 'The wallet has more than 1,000 transactions, so its first one is not read.',
    }
  const oldest = sigs.at(-1)
  budget.take('rpc')
  const tx = await deps.solana('getTransaction', [oldest.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }]).catch(() => null)
  const keys = tx?.transaction?.message?.accountKeys
  const pre = tx?.meta?.preBalances
  const post = tx?.meta?.postBalances
  if (!Array.isArray(keys) || !Array.isArray(pre) || !Array.isArray(post))
    return {
      from: null,
      unavailable: true,
      reason: 'The Solana RPC could not read the wallet’s first transaction.',
    }
  const names = keys.map((k) => (typeof k === 'string' ? k : k?.pubkey))
  const i = names.indexOf(addr)
  if (i < 0 || post[i] - pre[i] <= 0)
    return {
      from: null,
      reason: 'The wallet’s first transaction did not give it SOL.',
    }
  const payer = names[0]
  const delta = (j) => post[j] - pre[j]
  if (payer && payer !== addr && delta(0) < 0)
    return {
      from: payer,
      kind: 'native',
      block: oldest.slot ?? null,
      tx: oldest.signature,
      at: oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null,
      source: 'Solana RPC: payer of the wallet’s first transaction',
      confidence: 'high',
    }
  return {
    from: null,
    reason: 'The wallet’s first transaction was not funded by its fee payer.',
  }
}

/**
 * Snipers and bundled buys for any token from its Transfer history. The pool is inferred: the contract that paid
 * tokens out to the most distinct wallets (checked to have code). Buys are transfers from it (a router's forward in
 * the same transaction counts as the wallet's buy). Confidence: medium with a complete history, low otherwise.
 */
export async function inferTrading({ chainKey, token, transfers, complete, deps, budget }) {
  const early = transfers.slice(0, 3_000)
  const out = new Map()
  for (const t of early) {
    if (t.from === ZERO || t.from === token || t.to === t.from) continue
    if (!out.has(t.from)) out.set(t.from, new Set())
    out.get(t.from).add(t.to)
  }
  const cands = [...out]
    .filter(([, s]) => s.size >= 3)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3)
    .map(([a]) => a)
  if (!cands.length)
    return {
      state: 'unavailable',
      reason: 'No liquidity pool could be identified: no address paid this token out to several wallets in its early transfers.',
    }
  budget.take('rpc', cands.length)
  const code = await deps.code(chainKey, cands)
  const pool = cands.find((a) => code.get(a) === true)
  if (!pool)
    return {
      state: 'unavailable',
      reason: 'The addresses that paid the token out to many wallets are not contracts, so no pool was identified.',
    }
  const firstIn = transfers.find((t) => t.to === pool)
  const outs = transfers.filter((t) => t.from === pool && t.to !== ZERO && t.to !== pool && (!firstIn || t.block >= firstIn.block))
  if (!outs.length)
    return {
      state: 'unavailable',
      reason: 'The inferred pool never paid tokens out, so there were no buys to examine.',
    }
  const byTx = new Map()
  for (const t of transfers) {
    if (!byTx.has(t.tx)) byTx.set(t.tx, [])
    byTx.get(t.tx).push(t)
  }
  const firstBuy = new Map() // wallet -> block
  const perBlock = new Map() // block -> Set(wallets)
  for (const t of outs) {
    // A router/aggregator that received from the pool and forwarded in the same transaction: the receiver is the buyer.
    const fwd = (byTx.get(t.tx) ?? []).filter((x) => x.from === t.to && x.to !== pool && x.to !== ZERO && x.to !== t.to)
    const buyers = fwd.length ? fwd.map((x) => x.to) : [t.to]
    for (const w of buyers) {
      if (!firstBuy.has(w) || firstBuy.get(w) > t.block) firstBuy.set(w, t.block)
      if (!perBlock.has(t.block)) perBlock.set(t.block, new Set())
      perBlock.get(t.block).add(w)
    }
  }
  const firstTradeBlock = Math.min(...outs.map((t) => t.block))
  const snipers = [...firstBuy].filter(([, b]) => b <= firstTradeBlock + SNIPER_BLOCKS - 1)
  const bundles = [...perBlock]
    .filter(([b, s]) => b <= firstTradeBlock + SNIPER_BLOCKS - 1 && s.size >= 2)
    .map(([block, s]) => ({
      block,
      wallets: [...s].slice(0, 25),
      count: s.size,
    }))
    .sort((a, b) => a.block - b.block)
  let bal = null
  let total = 0n
  if (complete) {
    bal = reconstructBalances(transfers)
    total = [...bal].reduce((s, [a, v]) => (v > 0n && a !== ZERO ? s + v : s), 0n)
  }
  const pct = (list) => (bal && total > 0n ? round2(Number(([...list].reduce((s, a) => s + (bal.get(a) > 0n ? bal.get(a) : 0n), 0n) * 1_000_000n) / total) / 10_000) : null)
  return {
    state: 'ok',
    method: 'inferred-from-transfers',
    confidence: complete ? 'medium' : 'low',
    pool,
    poolNote: 'Inferred, not labelled: the contract that paid this token out to the most wallets.',
    firstLiquidityBlock: firstIn?.block ?? null,
    firstTradeBlock,
    snipers: {
      count: snipers.length,
      pctOfSupply: pct(snipers.map(([a]) => a)),
      wallets: snipers.slice(0, 25).map(([a, b]) => ({
        address: a,
        firstBuyBlock: b,
        pct: bal ? pct([a]) : null,
      })),
    },
    bundled: {
      count: new Set(bundles.flatMap((b) => b.wallets)).size,
      pctOfSupply: pct(bundles.flatMap((b) => b.wallets)),
    },
    bundles,
    buyers: firstBuy.size,
  }
}
