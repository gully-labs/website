// GET /api/admin/revenue?range=24h|7d|30d|all: what each Gully income line actually earns, side by side (owner order
// "go revenue", 2026-11-06). admin.mjs routes here behind the admin guard. Read-only: every figure is read from an
// existing source on the server and cached; nothing is written anywhere and no key reaches the browser.
//
// Sources
//   indexer   REST /head, /stats/fees, /stats/analytics, /stats/flywheel and paged GraphQL (fee_event, pool_swap, token,
//             bridge_fee, router_swap, quest_funding, pass_subscription, rental). GULLY_INDEXER is testnet;
//             REVENUE_MAINNET_INDEXER is the mainnet one, unset until mainnet runs, and is refused if it answers as testnet.
//   chain     eth_getLogs on Gully Chain testnet for what the indexer does not follow (.gully registrars, GullyTipJar,
//             CreatorMemberships v2, CreatorEditions) and block headers for gas (gasUsed x base fee).
//   local     this server's own ledgers: billing.mjs payments (site plans, invoices) and merchants.mjs fees.
//   Gully ID  /v1/admin/revenue, only with GULLY_ID_ADMIN_TOKEN set (server-side). GULLY_ID_REVENUE_NETWORK says which side
//             its checkouts count on: testnet until the owner confirms they are real money ("mainnet").
//
// Rules
//   - Testnet and mainnet are separate columns with separate totals. Only mainnet cells reach `totals.mainnet`, the one
//     figure with `money: true`; testnet USD is the testnet pool's price of test coins and says so.
//   - A cell's status is tracked, partial (real but incomplete, `missing` says what), not_tracked (no source yet),
//     not_live (nothing deployed on that side), not_billed, or error (the source did not answer). Only tracked and
//     partial carry a number. Nothing is estimated, and an unknown is null, never 0.
//   - A fee in a coin with no price is counted in `unpriced`, not valued.
import { keccak_256 } from './vendor/noble.mjs'
import { ledger } from './billing.mjs'
import { json } from './http.mjs'
import { merchantFeeEvents, merchantStatementInvoiceIds } from './merchants.mjs'
import { CHAIN_LIST, CHAINS, publicAssets, rpc } from './payments.mjs'
import { treasury } from './plans.mjs'

const TTL = 60_000
const FRESH_GAP = 15_000
const TREASURY_TTL = 5 * 60_000
const TIMEOUT = 10_000
const PAGE = 1000
const MAX_PAGES = 20
const LOG_CHUNK = 5000
const GAS_BUDGET = 600
const GAS_WORKERS = 3
const MAX_BUCKETS = 120

const HOUR = 3600
const DAY = 86_400
export const RANGES = {
  '24h': { span: DAY, step: HOUR },
  '7d': { span: 7 * DAY, step: 6 * HOUR },
  '30d': { span: 30 * DAY, step: DAY },
  all: { span: null, step: DAY },
}

export const TESTNET_CHAIN = 485590
const ZERO = '0x0000000000000000000000000000000000000000'
const WETH = '0x26acccb2e98ca9e067e58668aa3b101bef432754'
const USDCE = '0x65ba03c6fa90ed549f465d4c8f2e784d6eeb7e76'
// gully-ops l3/generated: tipjar.json, name-registrar.json, gully-id-revenue.json, registry.json (creators).
const CONTRACTS = {
  tips: ['0x400c73ec3e40dd84a6bf3be8ecd5984a26bf1e9b'],
  names: ['0xbd34ac796fb5a12cdfd4605a247f455cb900b695', '0x2c6f37394763d0fa07292d96804cb44067a54a94'],
  memberships: ['0x1f9092ef9cbd36f1d13a10b2f2eb0696b869dfc2'],
  editions: ['0x91281c011373350c0b5a6075078e56ca958bb448'],
}
const ARB_OWNER_PUBLIC = '0x000000000000000000000000000000000000006b'
const GET_NETWORK_FEE_ACCOUNT = '0x2d9125e9'
const BALANCE_OF = '0x70a08231'

const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
const topic = (sig) => '0x' + hexOf(keccak_256(new TextEncoder().encode(sig)))
export const TOPICS = {
  tipped: topic('Tipped(address,address,address,uint256,uint256,bytes32)'),
  nameV1: topic('NameRegistered(bytes32,address,address,uint256)'),
  nameV11: topic('NameRegistered(bytes32,address,address,uint256,string)'),
  subscribed: topic('Subscribed(uint256,address,uint256,address,uint256,uint40,uint256,uint256,uint256,address)'),
  minted: topic('Minted(uint256,address,address,uint256,address,uint256,uint256,uint256,address)'),
}

const env = (k, d = '') => String(process.env[k] ?? d).trim().replace(/\/+$/, '')
const indexerUrl = () => env('GULLY_INDEXER', 'https://indexer.gullychain.xyz')
const mainnetIndexerUrl = () => env('REVENUE_MAINNET_INDEXER')
const gullyIdUrl = () => env('GULLY_ID_URL', 'https://gullyid.xyz')
const gullyIdToken = () => String(process.env.GULLY_ID_ADMIN_TOKEN ?? '').trim()
const gullyIdNetwork = () => (env('GULLY_ID_REVENUE_NETWORK') === 'mainnet' ? 'mainnet' : 'testnet')

const big = (v) => {
  try {
    return BigInt(v ?? 0)
  } catch {
    return 0n
  }
}
const word = (data, i) => {
  const hex = String(data ?? '0x').slice(2 + 64 * i, 2 + 64 * (i + 1))
  return hex.length === 64 ? BigInt('0x' + hex) : 0n
}
const wordAddr = (data, i) => '0x' + word(data, i).toString(16).padStart(40, '0')
const topicAddr = (t) => '0x' + String(t ?? '').slice(-40).toLowerCase()

/** USD of a raw amount at an ETH price, or null: ETH, WETH and USDC.e are the only coins with a known price here. */
export function priced(token, raw, ethUsd) {
  const a = String(token ?? ZERO).toLowerCase()
  const n = big(raw)
  if (a === USDCE) return Number(n) / 1e6
  if (a === ZERO || a === WETH) return ethUsd == null ? null : (Number(n) / 1e18) * ethUsd
  return null
}

/* ------------------------------------------------------------- the income lines --- */

// `group` is the chart colour: one per stream family, so a colour always means the same thing.
export const LINES = [
  { id: 'kre8_trade', name: 'kre8 trade fee', group: 'trading', rate: '0.50% of each trade, 10% of creator tax' },
  { id: 'core_builder', name: 'Gully Core builder fee', group: 'trading', rate: 'flat 0.30%, per chain' },
  { id: 'swap_router', name: 'Swap router fee', group: 'trading', rate: '0.25% of the input' },
  { id: 'launch_fees', name: 'Launch fees', group: 'launch', rate: 'about $2 a launch' },
  { id: 'names', name: '.gully names', group: 'launch', rate: '$1 and up, once' },
  { id: 'ads', name: 'Ads', group: 'creators', rate: '50% of ad spend' },
  { id: 'tips_members', name: 'Tips and memberships', group: 'creators', rate: '5% platform share' },
  { id: 'quests', name: 'Quest funding fee', group: 'creators', rate: 'fee on each quest funded' },
  { id: 'hyperlane', name: 'Hyperlane fees', group: 'bridge', rate: '0.0001 ETH a message, delivery margin 10%' },
  { id: 'integrator', name: 'Integrator fee', group: 'bridge', rate: '0.25% on Relay and LI.FI quotes' },
  { id: 'gully_id', name: 'Gully ID plans', group: 'products', rate: 'Build, Scale, Verified, Secure+' },
  { id: 'gully_rpc', name: 'Gully RPC', group: 'products', rate: 'plans and overage' },
  { id: 'gully_pay', name: 'Gully Pay fees', group: 'products', rate: 'merchant and platform fees' },
  { id: 'site_plans', name: 'gullylabs.xyz plans', group: 'products', rate: 'site plans and invoices' },
  { id: 'multisig', name: 'Gully Multisig', group: 'products', rate: 'not priced' },
  { id: 'chain_gas', name: 'Chain gas', group: 'chain', rate: 'gas used x base fee, gross' },
]

const NO_MAINNET_INDEXER = 'No mainnet chain or indexer yet: set REVENUE_MAINNET_INDEXER once mainnet runs.'
const NOT_TRACKED = {
  ads: { source: 'gully-offerwall Ads API', missing: 'Ads are off. The Ads API only answers per creator (/v1/ads/creator/earnings); it needs a platform total the admin can read.' },
  integrator: { source: 'xchain-buy /stats', missing: 'xchain-buy /stats reports buys and volume, not the fee. It needs to record the 0.25% per buy, or a read of the Relay and LI.FI payouts.' },
  gully_rpc: { source: 'gully-rpc portal marginView', missing: 'The numbers exist in the portal admin (lib/pricing/margin.ts) behind a signed-in session. It needs a read-only server endpoint and key.' },
  multisig: { source: 'none', missing: 'Gully Multisig has no price and no billing yet.', status: 'not_billed' },
}

const cell = (status, fields = {}) => ({ status, events: [], unpriced: 0, ...fields })
const tracked = (events, fields = {}) => cell(fields.missing ? 'partial' : 'tracked', { events, ...fields })
const errorCell = (source) => cell('error', { source, missing: 'The source did not answer on the last read. Nothing is shown for it.' })
const notLive = (why = NO_MAINNET_INDEXER) => cell('not_live', { missing: why })

/* -------------------------------------------------------------------- reads --- */

let fetchFn = (...a) => globalThis.fetch(...a)
/** Tests swap the fetch. */
export const setRevenueFetch = (f) => (fetchFn = f ?? ((...a) => globalThis.fetch(...a)))

async function getJson(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetchFn(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'GullyLabs-Admin/1', ...(init.headers ?? {}) } })
    if (!r.ok) throw new Error(`status ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

/** Every row of one GraphQL table, newest first. `truncated` when the read limit stops short of the table's end. */
async function rowsOf(base, name, fields, where = '', orderBy = 'timestamp') {
  const items = []
  let after = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const args = [`limit:${PAGE}`, `orderBy:${JSON.stringify(orderBy)}`, 'orderDirection:"desc"', where ? `where:{${where}}` : '', after ? `after:${JSON.stringify(after)}` : ''].filter(Boolean).join(',')
    const query = `{${name}(${args}){items{${fields}} pageInfo{hasNextPage endCursor}}}`
    const j = await getJson(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
    const page = j?.data?.[name]
    if (!page) throw new Error('no data')
    items.push(...page.items)
    if (!page.pageInfo?.hasNextPage) return { items, truncated: false }
    after = page.pageInfo.endCursor
  }
  return { items, truncated: true }
}

const soft = (p) => p.then((v) => ({ ok: true, v }), () => ({ ok: false, v: null }))

/** All indexer tables of one side, each one failing alone. A mainnet URL that answers as testnet is refused outright. */
async function readIndexer(base, side) {
  const head = await getJson(`${base}/head`)
  const chainId = Number(head?.chainId)
  if (!Number.isInteger(chainId)) throw new Error('no chain id')
  if (side === 'testnet' ? chainId !== TESTNET_CHAIN : chainId === TESTNET_CHAIN) throw new Error('wrong side')
  const [analytics, fees, flywheel, feeEvents, swaps, tokens, bridge, router, quests, pass, rentals] = await Promise.all([
    soft(getJson(`${base}/stats/analytics?range=24h`)),
    soft(getJson(`${base}/stats/fees`)),
    soft(getJson(`${base}/stats/flywheel?range=24h`)),
    soft(rowsOf(base, 'feeEvents', 'timestamp kind currency protocolShare protocolUsd')),
    soft(rowsOf(base, 'poolSwaps', 'timestamp protocolFeesUsd', 'protocolFeesUsd_gt:0')),
    soft(rowsOf(base, 'tokens', 'createdAt launchFeeWei', 'source:"gully-core"', 'createdAt')),
    soft(rowsOf(base, 'bridgeFees', 'timestamp category revenueWei revenueUsd')),
    soft(rowsOf(base, 'routerSwaps', 'timestamp fee tokenIn')),
    soft(rowsOf(base, 'questFundings', 'timestamp fee asset')),
    soft(rowsOf(base, 'passSubscriptions', 'timestamp fee')),
    soft(rowsOf(base, 'rentals', 'timestamp fee')),
  ])
  return { chainId, analytics, fees, flywheel, feeEvents, swaps, tokens, bridge, router, quests, pass, rentals }
}

const TRUNCATED = 'The read stops at the newest 20,000 rows, so older rows are not counted.'
const INTEGRATOR_NOTE = 'Integrator shares of the guard fee and tax are left out: they go to the launch integrator.'

/** Shapes one side's indexer tables into the lines that come from the indexer. */
export function indexerLines(s) {
  const ethUsd = s.analytics.ok && typeof s.analytics.v?.ethUsd === 'number' ? s.analytics.v.ethUsd : null
  const noPrice = ethUsd == null ? 'The ETH price did not read, so ETH amounts are not valued.' : null
  const out = {}
  const from = (r, build) => (r.ok ? build(r.v.items, r.v.truncated) : null)

  out.kre8_trade =
    from(s.feeEvents, (items, cut) => {
      const events = []
      let unpriced = 0
      for (const e of items) {
        if (big(e.protocolShare) === 0n) continue
        const usd = typeof e.protocolUsd === 'number' ? e.protocolUsd : priced(e.currency, e.protocolShare, ethUsd)
        if (usd == null) unpriced++
        else events.push({ t: Number(e.timestamp), usd })
      }
      return tracked(events, { unpriced, source: 'Indexer fee_event: protocol share of the guard fee, creator tax and LP collects', note: INTEGRATOR_NOTE, missing: cut ? TRUNCATED : undefined })
    }) ?? errorCell('Indexer fee_event')

  out.core_builder =
    from(s.swaps, (items, cut) =>
      tracked(items.map((e) => ({ t: Number(e.timestamp), usd: Number(e.protocolFeesUsd) })), {
        source: 'Indexer pool_swap: protocol fee on swaps',
        note: 'Gully Chain only. Controller V5 (flat 0.30%) is not on testnet yet, so this is the rate of the controller in force.',
        missing: cut ? TRUNCATED : undefined,
      }),
    ) ?? errorCell('Indexer pool_swap')

  out.swap_router =
    from(s.router, (items, cut) => {
      const events = []
      let unpriced = 0
      for (const e of items) {
        const usd = priced(e.tokenIn, e.fee, ethUsd)
        if (usd == null) unpriced++
        else events.push({ t: Number(e.timestamp), usd })
      }
      return tracked(events, { unpriced, source: 'Indexer router_swap: fee taken in the input coin', missing: cut ? TRUNCATED : noPrice ?? undefined })
    }) ?? errorCell('Indexer router_swap')

  out.launch_fees =
    from(s.tokens, (items, cut) => {
      const paid = items.filter((e) => big(e.launchFeeWei) > 0n)
      const events = ethUsd == null ? [] : paid.map((e) => ({ t: Number(e.createdAt), usd: priced(ZERO, e.launchFeeWei, ethUsd) }))
      return tracked(events, { unpriced: ethUsd == null ? paid.length : 0, source: 'Indexer token.launchFeeWei (Gully Core launches)', missing: cut ? TRUNCATED : noPrice ?? undefined })
    }) ?? errorCell('Indexer token')

  out.quests =
    from(s.quests, (items, cut) => {
      const events = []
      let unpriced = 0
      for (const e of items) {
        const usd = priced(e.asset, e.fee, ethUsd)
        if (usd == null) unpriced++
        else if (usd > 0) events.push({ t: Number(e.timestamp), usd })
      }
      return tracked(events, { unpriced, source: 'Indexer quest_funding.fee', missing: cut ? TRUNCATED : noPrice ?? undefined })
    }) ?? errorCell('Indexer quest_funding')

  const fees = s.fees.ok ? s.fees.v : null
  const deliveryOff = fees?.categories?.delivery?.enabled === false
  out.hyperlane =
    from(s.bridge, (items, cut) => {
      const events = []
      let unpriced = 0
      for (const e of items) {
        const usd = typeof e.revenueUsd === 'number' ? e.revenueUsd : priced(ZERO, e.revenueWei, ethUsd)
        if (usd == null) unpriced++
        else if (big(e.revenueWei) > 0n) events.push({ t: Number(e.timestamp), usd })
      }
      const why = cut ? TRUNCATED : deliveryOff ? 'Delivery margin is missing: the IGP is live but the indexer has no PONDER_HYPERLANE_IGP, so GasPayment is not read. Other-chain paymasters are not indexed either.' : undefined
      return tracked(events, { unpriced, source: 'Indexer bridge_fee: mirror request fee and message fee', missing: why })
    }) ?? errorCell('Indexer bridge_fee')

  return { out, ethUsd, fees, flywheel: s.flywheel.ok ? s.flywheel.v : null }
}

/* ----------------------------------------------------------------- chain reads --- */

const scan = { to: -1, logs: [], blocks: new Map(), gas: new Map() }
/** Tests start from an empty scan. */
export function resetRevenueScan() {
  Object.assign(scan, { to: -1, logs: [], blocks: new Map(), gas: new Map() })
}

async function blockOf(n) {
  const known = scan.blocks.get(n)
  if (known) return known
  const b = await rpc(TESTNET_CHAIN, 'eth_getBlockByNumber', ['0x' + n.toString(16), false])
  if (!b) throw new Error('no block')
  const row = { t: Number(BigInt(b.timestamp)), wei: big(b.gasUsed) * big(b.baseFeePerGas) }
  scan.blocks.set(n, row)
  return row
}

/** New logs since the last read. Blocks are immutable, so each range is read once; a failed range stays for next time. */
async function syncLogs(head) {
  const addresses = Object.values(CONTRACTS).flat()
  const topics = [[TOPICS.tipped, TOPICS.nameV1, TOPICS.nameV11, TOPICS.subscribed, TOPICS.minted]]
  while (scan.to < head) {
    const from = scan.to + 1
    const to = Math.min(head, from + LOG_CHUNK - 1)
    const logs = await rpc(TESTNET_CHAIN, 'eth_getLogs', [{ address: addresses, topics, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }])
    for (const l of logs ?? []) {
      const b = await blockOf(Number(BigInt(l.blockNumber)))
      scan.logs.push({ t: b.t, topic: l.topics[0], topics: l.topics, address: String(l.address).toLowerCase(), data: l.data })
    }
    scan.to = to
  }
}

/** Reads headers newest first, a bounded number per refresh, so a cold start fills over a few refreshes. A refused read
    (the public RPC rate-limits) ends this pass and keeps what was read. */
async function syncGas(head) {
  const want = []
  for (let n = head; n >= 0 && want.length < GAS_BUDGET; n--) if (!scan.gas.has(n)) want.push(n)
  let i = 0
  let stopped = false
  const worker = async () => {
    while (i < want.length && !stopped) {
      const n = want[i++]
      try {
        scan.gas.set(n, await blockOf(n))
      } catch {
        stopped = true
      }
    }
  }
  await Promise.all(Array.from({ length: GAS_WORKERS }, worker))
  if (stopped && !scan.gas.size) throw new Error('no block read')
  let low = head + 1
  while (low > 0 && scan.gas.has(low - 1)) low--
  return { low, head, read: scan.gas.size }
}

/** Income in the chain's logs: fee in USDC.e or ETH, split by product. */
export function logLines(logs, ethUsd) {
  const parts = { tips: [], memberships: [], editions: [], names: [] }
  let unpriced = 0
  const add = (key, t, token, raw) => {
    if (big(raw) === 0n) return
    const usd = priced(token, raw, ethUsd)
    if (usd == null) unpriced++
    else parts[key].push({ t, usd })
  }
  for (const l of logs) {
    if (l.topic === TOPICS.tipped) add('tips', l.t, topicAddr(l.topics[3]), word(l.data, 1))
    else if (l.topic === TOPICS.nameV1 || l.topic === TOPICS.nameV11) add('names', l.t, USDCE, word(l.data, 0))
    else if (l.topic === TOPICS.subscribed) add('memberships', l.t, USDCE, word(l.data, 4))
    else if (l.topic === TOPICS.minted) add('editions', l.t, wordAddr(l.data, 1), word(l.data, 3))
  }
  return { parts, unpriced }
}

async function readChain(ethUsd) {
  const head = Number(BigInt(await rpc(TESTNET_CHAIN, 'eth_blockNumber', [])))
  let logsOk = true
  let gasOk = true
  await syncLogs(head).catch(() => (logsOk = false))
  let cover = null
  try {
    cover = await syncGas(head)
  } catch {
    gasOk = false
  }
  const { parts, unpriced } = logLines(scan.logs, ethUsd)
  const paid = [...scan.gas.values()].filter((b) => b.wei > 0n)
  const gasEvents = ethUsd == null ? [] : paid.map((b) => ({ t: b.t, usd: priced(ZERO, b.wei, ethUsd) }))
  return { head, logsOk, gasOk, cover, parts, unpriced, gasEvents, gasUnpriced: ethUsd == null ? paid.length : 0 }
}

/* ------------------------------------------------------------- local ledgers --- */

function localLines() {
  const statements = merchantStatementInvoiceIds()
  const site = { mainnet: [], testnet: [] }
  for (const p of ledger().payments ?? []) {
    if (p.kind === 'merchant' || p.usdCents == null) continue
    if (p.invoiceId && statements.has(p.invoiceId)) continue
    const side = CHAINS[p.chainId]?.testnet ? 'testnet' : 'mainnet'
    site[side].push({ t: Math.floor(Date.parse(p.at) / 1000), usd: Number(p.usdCents) / 100 })
  }
  const pay = { mainnet: [], testnet: [] }
  for (const f of merchantFeeEvents()) pay[CHAINS[f.chainId]?.testnet ? 'testnet' : 'mainnet'].push({ t: f.t, usd: f.usd })
  return { site, pay }
}

async function readGullyId() {
  const token = gullyIdToken()
  if (!token) return null
  const j = await getJson(`${gullyIdUrl()}/v1/admin/revenue`, { headers: { authorization: `Bearer ${token}` } })
  const streams = Array.isArray(j?.streams) ? j.streams : []
  const allUsd = streams.filter((s) => ['verified', 'secureplus', 'developer_plans'].includes(s.id) && s.available).reduce((sum, s) => sum + (Number(s.totalUsd) || 0), 0)
  const events = []
  for (const r of [...(j?.dailyIdentityUsd ?? []), ...(j?.dailyDeveloperUsd ?? [])]) {
    const t = Math.floor(Date.parse(`${r.day}T00:00:00Z`) / 1000)
    if (Number.isFinite(t) && r.usd > 0) events.push({ t, usd: Number(r.usd) })
  }
  return { allUsd, events }
}

const unit = (x, d) => Number(big(x)) / 10 ** d
/** One address's native balance and its stablecoins, as read now; null on a read that failed. */
async function balanceOf(chainId, address, stables) {
  const [native, ...coins] = await Promise.all([
    rpc(chainId, 'eth_getBalance', [address, 'latest']).catch(() => null),
    ...stables.map((a) => rpc(chainId, 'eth_call', [{ to: a.address, data: BALANCE_OF + address.slice(2).padStart(64, '0') }, 'latest']).catch(() => null)),
  ])
  const read = native != null
  return { native: read ? unit(native, 18) : null, stableUsd: coins.some((c) => c != null) ? coins.reduce((s, c, i) => s + (c == null ? 0 : unit(c, stables[i].decimals)), 0) : null }
}

let treasuryCache = { at: 0, value: null }
async function readTreasuries(fees, flywheel) {
  if (treasuryCache.value && Date.now() - treasuryCache.at < TREASURY_TTL) return treasuryCache.value
  const assets = publicAssets({ all: true }).filter((a) => a.kind === 'token' && /^USD/.test(a.symbol) && a.address)
  const stablesOf = (id) => assets.filter((a) => a.chainId === id)
  const safe = treasury()
  const mainnet = safe
    ? await Promise.all(
        CHAIN_LIST.filter((c) => !c.testnet).map(async (c) => {
          const symbol = publicAssets({ all: true }).find((a) => a.chainId === c.id && a.kind === 'native')?.symbol ?? 'ETH'
          return { label: 'Treasury Safe', chain: c.name, address: safe, symbol, ...(await balanceOf(c.id, safe, stablesOf(c.id))) }
        }),
      )
    : []
  const usdce = [{ address: USDCE, decimals: 6 }]
  const receivers = [
    ['Gully Core Safe', flywheel?.contracts?.safe],
    ['KRE flywheel', flywheel?.contracts?.flywheel],
    ['Message fee beneficiary', fees?.config?.protocolFee?.beneficiary],
  ]
  const feeAccount = await rpc(TESTNET_CHAIN, 'eth_call', [{ to: ARB_OWNER_PUBLIC, data: GET_NETWORK_FEE_ACCOUNT }, 'latest']).catch(() => null)
  if (feeAccount) receivers.push(['Chain network fee account', wordAddr(feeAccount, 0)])
  const testnet = await Promise.all(
    receivers
      .filter(([, a]) => /^0x[0-9a-fA-F]{40}$/.test(a ?? ''))
      .map(async ([label, address]) => ({ label, chain: 'Gully Chain testnet', address, symbol: 'test ETH', ...(await balanceOf(TESTNET_CHAIN, address, usdce)) })),
  )
  const value = { mainnet, testnet, readAt: new Date().toISOString() }
  treasuryCache = { at: Date.now(), value }
  return value
}

/* ----------------------------------------------------------------- one snapshot --- */

/** Every line's cells, from every source. Any one source failing marks its own cells and nothing else. */
async function snapshot() {
  const now = Math.floor(Date.now() / 1000)
  const testRaw = await readIndexer(indexerUrl(), 'testnet').then(
    (s) => s,
    () => null,
  )
  const test = testRaw ? indexerLines(testRaw) : null
  const mainBase = mainnetIndexerUrl()
  const mainRaw = mainBase ? await readIndexer(mainBase, 'mainnet').catch(() => 'refused') : null
  const main = mainRaw && mainRaw !== 'refused' ? indexerLines(mainRaw) : null
  const ethUsd = test?.ethUsd ?? null
  const chain = await readChain(ethUsd).catch(() => null)
  const local = localLines()
  const idRead = await soft(readGullyId())

  const cells = {}
  for (const l of LINES) cells[l.id] = { mainnet: notLive(), testnet: notLive('Nothing on testnet for this line.') }
  for (const id of ['kre8_trade', 'core_builder', 'swap_router', 'launch_fees', 'quests', 'hyperlane']) {
    cells[id].testnet = test?.out[id] ?? errorCell('Gully Chain testnet indexer')
    cells[id].mainnet = main?.out[id] ?? (mainRaw === 'refused' ? errorCell('REVENUE_MAINNET_INDEXER (refused: it did not answer as a mainnet)') : notLive())
  }
  cells.core_builder.mainnet = main?.out.core_builder ?? notLive('No mainnet indexer is configured for Gully Core here (REVENUE_MAINNET_INDEXER): its fees on Anubis, Robinhood Chain, Base, BNB Chain and Kinetiq Elysium are read on gullycore.xyz, not on this page yet.')

  for (const id of Object.keys(NOT_TRACKED)) {
    const n = NOT_TRACKED[id]
    const c = cell(n.status ?? 'not_tracked', { source: n.source, missing: n.missing })
    cells[id] = { mainnet: c, testnet: c }
  }

  // Chain logs and gas (Gully Chain testnet only: no contract of these runs on a mainnet yet).
  const nameSource = 'Gully Chain NameRegistered logs, registrars v1 and v1.1'
  cells.names.testnet = chain?.logsOk ? tracked(chain.parts.names, { source: nameSource }) : errorCell(nameSource)
  cells.names.mainnet = notLive('The .gully registrar runs on testnet only.')
  const pass = testRaw?.pass.ok ? testRaw.pass.v.items : []
  const rentals = testRaw?.rentals.ok ? testRaw.rentals.v.items : []
  const usdce = (rows) => rows.filter((r) => big(r.fee) > 0n).map((r) => ({ t: Number(r.timestamp), usd: Number(big(r.fee)) / 1e6 }))
  const passEvents = usdce(pass)
  const rentalEvents = usdce(rentals)
  if (chain?.logsOk) {
    const events = [...chain.parts.tips, ...chain.parts.memberships, ...chain.parts.editions, ...passEvents, ...rentalEvents]
    const c = tracked(events, {
      unpriced: chain.unpriced,
      source: 'Gully Chain logs (GullyTipJar, CreatorMemberships v2, CreatorEditions), indexer pass_subscription and rental',
      missing: testRaw?.pass.ok && testRaw?.rentals.ok ? undefined : 'Gully Pass or rentals did not read on the last try.',
    })
    const usd = (rows) => rows.reduce((s, e) => s + e.usd, 0)
    c.parts = [
      { name: 'Tips', usd: usd(chain.parts.tips), count: chain.parts.tips.length },
      { name: 'Memberships', usd: usd(chain.parts.memberships), count: chain.parts.memberships.length },
      { name: 'Editions and PPV', usd: usd(chain.parts.editions), count: chain.parts.editions.length },
      { name: 'Gully Pass', usd: usd(passEvents), count: passEvents.length },
      { name: 'Rentals', usd: usd(rentalEvents), count: rentalEvents.length },
    ]
    cells.tips_members.testnet = c
  } else cells.tips_members.testnet = errorCell('Gully Chain logs')
  cells.tips_members.mainnet = notLive('These contracts run on testnet only.')

  if (chain?.gasOk && chain.cover) {
    const whole = chain.cover.low === 0
    cells.chain_gas.testnet = tracked(chain.gasEvents, {
      unpriced: chain.gasUnpriced,
      source: 'Gully Chain block headers: gas used x base fee, gross, parent-chain data cost not taken off',
      missing: whole ? undefined : `Reading blocks: ${chain.cover.read.toLocaleString('en-US')} of ${(chain.head + 1).toLocaleString('en-US')} so far, newest first.`,
    })
  } else cells.chain_gas.testnet = errorCell('Gully Chain block headers')
  cells.chain_gas.mainnet = notLive('Gully Chain mainnet (48559) is not running yet.')

  // Local ledgers: real payments on this server.
  cells.site_plans = {
    mainnet: tracked(local.site.mainnet, { source: 'This server: billing ledger, paid on mainnets' }),
    testnet: tracked(local.site.testnet, { source: 'This server: billing ledger, paid on testnets' }),
  }
  const payMissing = 'gullypay.xyz fees sit in its fee_ledger_entries behind the platform admin. It needs a read-only server endpoint and key. Only gullylabs.xyz merchant fees are here.'
  cells.gully_pay = {
    mainnet: tracked(local.pay.mainnet, { source: 'This server: merchant fees collected on chain and statements paid', missing: payMissing }),
    testnet: tracked(local.pay.testnet, { source: 'This server: merchant fees collected on chain and statements paid', missing: payMissing }),
  }

  const idSide = gullyIdNetwork()
  const idOther = idSide === 'mainnet' ? 'testnet' : 'mainnet'
  if (!gullyIdToken()) {
    const c = cell('not_tracked', { source: 'Gully ID /v1/admin/revenue', missing: 'The numbers exist. This server has no GULLY_ID_ADMIN_TOKEN, and that token can also lock accounts, so a read-only key is the safer way in.' })
    cells.gully_id = { mainnet: c, testnet: c }
  } else if (idRead.ok && idRead.v) {
    cells.gully_id = {
      [idSide]: tracked(idRead.v.events, { allUsd: idRead.v.allUsd, source: 'Gully ID /v1/admin/revenue: Verified, Secure+ and developer plans (windows up to 30 days from its daily rows)', note: `Counted on ${idSide} by GULLY_ID_REVENUE_NETWORK.` }),
      [idOther]: notLive('Gully ID checkouts are counted on the other side.'),
    }
  } else {
    const c = errorCell('Gully ID /v1/admin/revenue')
    cells.gully_id = { mainnet: c, testnet: c }
  }

  const treasuries = await readTreasuries(test?.fees, test?.flywheel).catch(() => ({ mainnet: [], testnet: [], readAt: null }))
  return { at: Date.now(), now, cells, treasuries, ethUsd, indexer: { testnet: !!testRaw, mainnet: mainRaw === 'refused' ? 'refused' : mainBase ? !!mainRaw : null } }
}

/* -------------------------------------------------------------------- the view --- */

/** Bucket starts for a range; `all` runs from the first event, widened to stay under MAX_BUCKETS. */
export function bucketsOf(range, now, firstT) {
  const r = RANGES[range]
  let step = r.step
  let start = Math.floor(now / step) * step
  if (r.span) start -= r.span - step
  else {
    const first = Math.floor((firstT ?? now) / step) * step
    const n = Math.ceil((start - first) / step) + 1
    if (n > MAX_BUCKETS) step *= Math.ceil(n / MAX_BUCKETS)
    start = first
  }
  const end = Math.floor(now / step) * step + step
  const t = []
  for (let x = start; x < end && t.length <= MAX_BUCKETS + 1; x += step) t.push(x)
  return { t, step, from: r.span ? t[0] : -Infinity }
}

const NUMBERED = new Set(['tracked', 'partial'])

function viewCell(c, b, range) {
  const shown = { status: c.status, usd: null, count: null, unpriced: c.unpriced ?? 0, series: null, source: c.source ?? null, missing: c.missing ?? null, note: c.note ?? null, parts: c.parts ?? null }
  if (!NUMBERED.has(c.status)) return shown
  const series = b.t.map(() => 0)
  let usd = 0
  let count = 0
  for (const e of c.events) {
    if (e.t < b.from) continue
    const i = Math.floor((e.t - b.t[0]) / b.step)
    if (i < 0 || i >= series.length) continue
    series[i] += e.usd
    usd += e.usd
    count++
  }
  if (range === 'all' && typeof c.allUsd === 'number') usd = c.allUsd
  return { ...shown, usd, count, series }
}

function totalOf(lines, side, b) {
  const series = b.t.map(() => 0)
  let usd = 0
  for (const l of lines) {
    const c = l[side]
    if (c.usd == null) continue
    usd += c.usd
    c.series.forEach((v, i) => (series[i] += v))
  }
  return { usd, series }
}

/** The answer for one range. Mainnet and testnet are added up apart, and only mainnet is money. */
export function buildView(snap, range) {
  let first = snap.now
  for (const c of Object.values(snap.cells)) for (const e of [...c.mainnet.events, ...c.testnet.events]) if (e.t < first) first = e.t
  const b = bucketsOf(range, snap.now, first)
  const lines = LINES.map((l) => ({ ...l, mainnet: viewCell(snap.cells[l.id].mainnet, b, range), testnet: viewCell(snap.cells[l.id].testnet, b, range) }))
  const open = []
  for (const l of lines) {
    for (const side of ['mainnet', 'testnet']) {
      const c = l[side]
      if (c.status === 'tracked' || !c.missing) continue
      const seen = open.find((o) => o.id === l.id && o.missing === c.missing)
      if (seen) seen.sides.push(side)
      else open.push({ id: l.id, name: l.name, status: c.status, missing: c.missing, sides: [side] })
    }
  }
  const counts = {}
  for (const side of ['mainnet', 'testnet']) {
    counts[side] = lines.reduce((m, l) => ((m[l[side].status] = (m[l[side].status] ?? 0) + 1), m), {})
  }
  return {
    generatedAt: new Date(snap.at).toISOString(),
    range,
    buckets: b.t,
    step: b.step,
    ethUsd: snap.ethUsd,
    totals: {
      mainnet: { ...totalOf(lines, 'mainnet', b), money: true, label: 'Mainnet income' },
      testnet: { ...totalOf(lines, 'testnet', b), money: false, label: 'Testnet activity', note: 'Test coins at the testnet pool price. Not money.' },
    },
    counts,
    lines,
    open,
    treasuries: snap.treasuries,
    indexer: snap.indexer,
  }
}

let cache = null
let inflight = null
/** Clears the cache (tests). */
export const resetRevenueCache = () => {
  cache = null
  inflight = null
  treasuryCache = { at: 0, value: null }
}

function read(maxAge) {
  if (cache && Date.now() - cache.at < maxAge) return Promise.resolve(cache)
  inflight ??= snapshot()
    .then((s) => (cache = s))
    .finally(() => (inflight = null))
  return inflight
}

/** GET /api/admin/revenue. The admin guard has already run. Refreshes are shared: `fresh=1` only shortens the cache. */
export async function handleRevenueAdmin(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
  const range = url.searchParams.get('range') ?? '7d'
  if (!Object.hasOwn(RANGES, range)) return json(res, 400, { error: 'range is 24h, 7d, 30d or all.' }), true
  try {
    const snap = await read(url.searchParams.get('fresh') === '1' ? FRESH_GAP : TTL)
    return json(res, 200, buildView(snap, range)), true
  } catch (e) {
    console.error('revenue: read failed:', e?.message ?? e)
    return json(res, 502, { error: 'The revenue sources could not be read.' }), true
  }
}
