/* Landing "Constellation" (owner pick, 2026-10-27): the eight products, how they connect, the dated What's new and the
   pure adapters that turn the live sources into one reading per product. No React here, so scripts/test-hub-landing.mjs
   can run every adapter against fixtures (node strips the types).
   Sources: /api/hub (uptime, quests, x402, RPC gateway), /api/hub/products (Gully Chain by hour, HolderMaps, Security),
   /api/stats (venues we built) and /api/hub/live (Gully ID stats, Gully Pay status, Gully RPC status.json, indexer).
   Labels were checked live on 2026-10-27: pay.gullypay.xyz tip pages answered 525 (rolling out), merchant review is
   live (admin.gullypay.xyz, gullypay.xyz/setup), sentry.gullychain.xyz is up with the mint not open yet.
   2026-10-28: Gully Sentry's free testnet mint is open (sale/stats deployed, saleMode testnet); it has its own product
   page (/products/gully-sentry) and its numbers come through /api/hub/live (sentryNet, sentrySale, sentryChain). */
import type { HubBody } from '../../console/live'
import type { HubProducts } from '../../terminal/kit'

export type LayerKey = 'identity' | 'payments' | 'chain' | 'data' | 'play'
export type ProductKey = 'id' | 'pay' | 'chain' | 'rpc' | 'holdermaps' | 'security' | 'studio' | 'ai'
export type Status = 'live' | 'testnet' | 'beta' | 'soon'

export interface HubProduct {
  key: ProductKey
  name: string
  domain: string
  url: string
  /** this site's product page, /products/<page> */
  page: string
  layer: LayerKey
  status: Status
  color: string
  icon: string
  iconNote?: string
  line: string
  about: string
  live: string[]
  next: string[]
  links: [string, string][]
  /** more of this site's product pages that belong to it: [label, /products/<slug>] */
  pages?: [string, string][]
}

export const LAYERS: { key: LayerKey; n: string; name: string }[] = [
  { key: 'identity', n: '01', name: 'Identity' },
  { key: 'payments', n: '02', name: 'Payments' },
  { key: 'chain', n: '03', name: 'Chain' },
  { key: 'data', n: '04', name: 'Data & security' },
  { key: 'play', n: '05', name: 'Games & AI' },
]
export const STATUS_LABEL: Record<Status, string> = { live: 'Live', testnet: 'Testnet', beta: 'Open beta', soon: 'Coming online' }

const I = '/brand/hub/icons/'
export const HUB_PRODUCTS: HubProduct[] = [
  {
    key: 'id', name: 'Gully ID', domain: 'gullyid.xyz', url: 'https://gullyid.xyz', page: 'gully-id', layer: 'identity', status: 'live', color: '#00D2FF',
    icon: I + 'labs.png', iconNote: 'Gully ID has no kit yet: Gully Labs icon',
    line: 'Passwordless sign-in for any app.',
    about: 'Passkeys, wallets (SIWE) and email codes over standard OpenID Connect, with per-app consent and slow, visible recovery. Free up to 1,000 monthly active users.',
    live: ['Passkey, wallet and email sign-in', 'Sign in with Gully SDK for any site', 'Developer console (gullyid.xyz/developers/console)', 'Required by the Gully Chain faucet'],
    next: ['Google and X sign-in (keys pending)', 'Sign in with Gully on Gully Pay and Gully RPC (built, flagged off)'],
    links: [['Developers', 'https://gullyid.xyz/developers'], ['Console', 'https://gullyid.xyz/developers/console']],
  },
  {
    key: 'pay', name: 'Gully Pay', domain: 'gullypay.xyz', url: 'https://gullypay.xyz', page: 'pay', layer: 'payments', status: 'live', color: '#3479FD',
    icon: I + 'pay.png',
    line: 'Checkout, payment links and x402 for merchants and AI agents.',
    about: 'Accept cards, Apple Pay and USDC on Base, Ethereum, BNB Chain, Solana and Gully Chain, and let AI agents pay your API over x402. glUSD is its stablecoin, on Gully Chain testnet.',
    live: ['Hosted checkout and payment links', 'Store plugins: WooCommerce, Magento 2, OpenCart 4, PrestaShop; Shopify connector (beta)', 'x402 facilitator, Gully Chain among its networks', 'glUSD on Gully Chain testnet', 'Merchant review: KYB checks and Stripe Connect verification', 'Creator tip pages at pay.gullypay.xyz (rolling out)', 'glUSD yield vault: earn on idle glUSD (testnet, simulated yield)'],
    next: ['Agent Wallets', 'One-tap passkey checkout', 'Pay with any token', 'Splits and escrow', 'Tap to pay', 'Non-custodial wallet', 'iOS and Android apps'],
    links: [['Docs', 'https://gullypay.xyz/docs'], ['Merchant setup', 'https://gullypay.xyz/setup'], ['glUSD yield', 'https://gullypay.xyz']],
  },
  {
    key: 'chain', name: 'Gully Chain', domain: 'gullychain.xyz', url: 'https://gullychain.xyz', page: 'chain', layer: 'chain', status: 'testnet', color: '#00B2FA',
    icon: I + 'chain.png',
    line: 'The social L3 where your profile is your wallet.',
    about: 'An Arbitrum Orbit L3 (testnet, chain 485590): one passkey, one .gully name, sponsored gas. Launch, swap, copy trades, run quests and bridge in a minute.',
    live: ['Gully Street app and social feed', 'Gully Social: posts, follows and profiles', 'Copy trading with your own limits', 'Quests with on-chain rewards', 'DeepCore launchpad and swap', 'Bridge, faucet (Gully ID), explorer', 'Gully Safe and token lists', 'Contract verification (verify.gullychain.xyz)', 'Gully Sentry: free testnet Sentry Keys and watchers', 'Gully Offerwall: funded quests any site can embed (offers.gullychain.xyz)'],
    next: ['Mainnet'],
    links: [['App', 'https://app.gullychain.xyz'], ['Docs', 'https://docs.gullychain.xyz'], ['Verify', 'https://verify.gullychain.xyz'], ['Sentry', 'https://sentry.gullychain.xyz'], ['Offerwall', 'https://offers.gullychain.xyz/'], ['Social', 'https://app.gullychain.xyz'], ['Copy trading', 'https://app.gullychain.xyz/copy']],
    pages: [['Gully Social', 'gully-social'], ['Copy Trading', 'copy-trading'], ['Gully Offerwall', 'offerwall'], ['Gully Quests', 'quests'], ['Gully Street', 'street']],
  },
  {
    key: 'rpc', name: 'Gully RPC', domain: 'gullyrpc.xyz', url: 'https://gullyrpc.xyz', page: 'rpc', layer: 'chain', status: 'beta', color: '#FF7300',
    icon: I + 'rpc.png',
    line: 'One API key for Gully Chain, Ethereum, Base and more.',
    about: 'Multi-chain RPC with failover, live usage per key and a free tier. Gully Chain is served from Gully nodes; other chains through a partner network while Gully nodes are built.',
    live: ['API keys (open sign-up, free tier)', 'Usage metering (beta)', 'Gully Chain on the gateway, keyless endpoint too'],
    next: ['Archive and trace', 'Paid plans through Gully Pay', 'HyperEVM, X Layer, Ink, Unichain'],
    links: [['Portal', 'https://app.gullyrpc.xyz'], ['Status', 'https://gullyrpc.xyz/status']],
  },
  {
    key: 'holdermaps', name: 'HolderMaps', domain: 'holdermaps.xyz', url: 'https://holdermaps.xyz', page: 'holders', layer: 'data', status: 'live', color: '#FFD52E',
    icon: I + 'holdermaps.png',
    line: 'Who really holds a token? Bubble maps, read live.',
    about: 'Map any token’s holders on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana: top wallets, linked clusters and launch health.',
    live: ['Any-token holder maps on six chains', 'Gully Chain maps', 'Replay, live updates, CSV export'],
    next: [],
    links: [['Open a map', 'https://holdermaps.xyz']],
  },
  {
    key: 'security', name: 'Gully Security', domain: 'gullysecurity.xyz', url: 'https://gullysecurity.xyz', page: 'security', layer: 'data', status: 'live', color: '#F2B232',
    icon: I + 'security.png',
    line: 'Review. Validate. Defend.',
    about: 'AI security scans of smart contracts on seven mainnets and Gully Chain, published reports, contract monitors and human Security Reviews. A scan is not an audit.',
    live: ['AI Security Scan', 'Published reports', 'Gully Score and contract monitors'],
    next: ['Security Review by people: quoted on request'],
    links: [['Scan a contract', 'https://gullysecurity.xyz']],
  },
  {
    key: 'studio', name: 'Gully Studio', domain: 'gullystudio.xyz', url: 'https://gullystudio.xyz', page: 'studio', layer: 'play', status: 'live', color: '#1E8BFF',
    icon: I + 'studio.png',
    line: 'Unity 3D games with Gully ID, Gully Pay and Gully Chain inside.',
    about: 'The Gully Labs game studio: Unity 6 games with Gully ID sign-in, Gully Pay purchases, and scores, quests and prizes on Gully Chain.',
    live: ['Frog Hop (testnet)', 'Open-source Gully Game SDK', 'Developer portal and docs', 'Offerwall contracts on testnet'],
    next: ['More games'],
    links: [['Dev portal', 'https://dev.gullystudio.xyz'], ['Docs', 'https://docs.gullystudio.xyz']],
  },
  {
    key: 'ai', name: 'Gully AI', domain: 'gullyai.xyz', url: 'https://gullyai.xyz', page: 'ai', layer: 'play', status: 'soon', color: '#00F0F2',
    icon: I + 'ai.png',
    line: 'Open-weight LLM API, coming online.',
    about: 'Qwen3.6-27B open weights served by vLLM behind an OpenAI-compatible API, with per-product keys, rate limits and token metering. The site is up; the API comes online when its GPU box does.',
    live: ['Site and docs'],
    next: ['OpenAI-compatible API (GPU box pending)', '131K context, tool calling, reasoning'],
    links: [['Docs', 'https://gullyai.xyz/docs/']],
  },
]
export const productOf = (k: ProductKey) => HUB_PRODUCTS.find((p) => p.key === k) as HubProduct

/** How the products connect: 'live' in production or on testnet today, 'plan' flagged off or not built yet. */
export const EDGES: [ProductKey, ProductKey, 'live' | 'plan', string][] = [
  ['id', 'chain', 'live', 'Faucet sign-in and passkey accounts on Gully Chain'],
  ['id', 'pay', 'plan', 'Sign in with Gully on Gully Pay (built, flagged off)'],
  ['id', 'rpc', 'plan', 'Sign in with Gully on the RPC portal (built, flagged off)'],
  ['id', 'studio', 'live', 'Gully ID sign-in inside Studio games'],
  ['pay', 'chain', 'live', 'x402 and checkout settle on chain 485590 (testnet)'],
  ['pay', 'rpc', 'plan', 'Gully RPC paid plans billed through Gully Pay'],
  ['pay', 'studio', 'live', 'Gully Pay purchases in Studio games'],
  ['rpc', 'chain', 'live', 'Serves Gully Chain on the RPC gateway'],
  ['chain', 'holdermaps', 'live', 'Holder maps of Gully Chain tokens'],
  ['chain', 'security', 'live', 'Security scans of Gully Chain contracts'],
  ['chain', 'studio', 'live', 'Game scores, quests and prizes on chain'],
  ['ai', 'studio', 'plan', 'LLM API for Gully products (coming online)'],
]
export const JOURNEY: Record<'id' | 'pay' | 'chain', ProductKey[]> = { id: ['id'], pay: ['id', 'pay'], chain: ['id', 'pay', 'chain'] }

/** Map layouts: wide (desktop) and tall (phones), in SVG units. Gully Chain sits in the middle. */
export const MAP = {
  wide: { vb: [760, 560] as const, r: 30, rc: 42, at: { id: [128, 118], pay: [380, 64], rpc: [632, 118], holdermaps: [672, 330], security: [530, 488], studio: [230, 488], ai: [88, 330], chain: [380, 282] } as Record<ProductKey, [number, number]> },
  tall: { vb: [360, 580] as const, r: 24, rc: 32, at: { id: [70, 62], pay: [290, 62], rpc: [62, 236], chain: [180, 226], holdermaps: [298, 236], studio: [70, 402], security: [290, 402], ai: [180, 520] } as Record<ProductKey, [number, number]> },
}

/** One curve between two nodes, bent away from the map's centre so lines do not stack. */
export function curve(a: [number, number], b: [number, number], c: [number, number], k = 18) {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = mx - c[0]
  const dy = my - c[1]
  const d = Math.hypot(dx, dy) || 1
  return `M${a[0]} ${a[1]} Q${(mx + (dx / d) * k).toFixed(1)} ${(my + (dy / d) * k).toFixed(1)} ${b[0]} ${b[1]}`
}

export type NewsState = 'live' | 'new' | 'testnet' | 'beta' | 'rolling out' | 'coming soon'
export const NEWS: { d: string; p: ProductKey; t: string; s: NewsState; href: string }[] = [
  { d: '2026-10-28', p: 'pay', t: 'glUSD yield vault: merchants opt in to earn on idle glUSD (Gully Chain testnet, simulated yield)', s: 'testnet', href: 'https://gullypay.xyz' },
  { d: '2026-10-28', p: 'chain', t: 'Gully Offerwall on Gully Chain testnet: advertisers fund quests, players earn glUSD or points, publishers embed the wall', s: 'testnet', href: 'https://offers.gullychain.xyz/' },
  { d: '2026-10-28', p: 'chain', t: 'Gully Sentry: free testnet Sentry Keys and watchers', s: 'testnet', href: 'https://sentry.gullychain.xyz/' },
  { d: '2026-10-27', p: 'id', t: 'Gully ID moves to gullyid.xyz, with a developer console', s: 'live', href: 'https://gullyid.xyz/developers' },
  { d: '2026-10-27', p: 'chain', t: 'Contract verification for Gully Chain: self-hosted Sourcify, 218 contracts verified', s: 'live', href: 'https://verify.gullychain.xyz' },
  { d: '2026-10-27', p: 'rpc', t: 'Keyless Gully Chain endpoint on the gateway: rpc.gullyrpc.xyz/gullychain/evm/485590', s: 'live', href: 'https://gullyrpc.xyz' },
  { d: '2026-10-27', p: 'pay', t: 'Merchant review: KYB application, automated checks and Stripe Connect verification', s: 'live', href: 'https://gullypay.xyz/setup' },
  { d: '2026-10-27', p: 'pay', t: 'Creator tip pages at pay.gullypay.xyz/<username>', s: 'rolling out', href: 'https://gullypay.xyz' },
  { d: '2026-10-27', p: 'chain', t: 'Sentry Node Keys site at sentry.gullychain.xyz; the free testnet mint opens soon', s: 'coming soon', href: 'https://sentry.gullychain.xyz' },
  { d: '2026-10-27', p: 'chain', t: 'Faucet drain protection: Gully ID sign-in, budgets and limits', s: 'live', href: 'https://faucet.gullychain.xyz' },
  { d: '2026-10-27', p: 'chain', t: 'Gully Chain token lists 2.0.1 (default and extended) on gullychain.xyz', s: 'live', href: 'https://gullychain.xyz/tokenlist.json' },
  { d: '2026-10-27', p: 'studio', t: 'Gully Offerwall contracts on Gully Chain testnet', s: 'testnet', href: 'https://docs.gullystudio.xyz' },
  { d: '2026-10-26', p: 'chain', t: 'Gully Quests on testnet: on-chain quests with ETH rewards', s: 'testnet', href: 'https://app.gullychain.xyz/quests' },
  { d: '2026-10-26', p: 'pay', t: 'Magento 2 and OpenCart 4 plugins, Shopify connector (beta), WooCommerce 1.1', s: 'live', href: 'https://gullypay.xyz' },
  { d: '2026-10-26', p: 'holdermaps', t: 'HolderMaps on its own domain, with Gully Chain maps', s: 'live', href: 'https://holdermaps.xyz' },
  { d: '2026-10-26', p: 'rpc', t: 'Gully RPC: open sign-up, free tier, live gateway metrics', s: 'beta', href: 'https://gullyrpc.xyz' },
  { d: '2026-10-25', p: 'rpc', t: 'Gully Chain testnet served on the Gully RPC gateway (alias gully-testnet)', s: 'live', href: 'https://gullyrpc.xyz' },
]

/* ---------------------------------------------------------------- live sources ---- */
export interface HubLive {
  generatedAt: string
  unread: string[]
  id: {
    totals: { users: number | null; passkeys: number | null; wallets: number | null; apps: number | null }
    signins24h: number | null
    appsActive30d: number | null
    hourly: { hour: string; n: number }[]
    methods30d: Record<string, number> | null
    recent: { at: string; method: string }[]
  } | null
  pay: { status: string; services: Record<string, string>; incidents: number } | null
  rpc: { features: { key: string; name: string; status: string }[]; chains: { name: string; chainId: number | null; status: string }[] } | null
  head: { block: number | null; timestamp: number | null } | null
  feed: { items: { id: string; kind: string; block: string; timestamp: string; txHash: string | null }[] } | null
  /** Gully Offerwall public stats (offers.gullychain.xyz/v1/stats); glUSD amounts as numbers */
  offers?: {
    hours: number | null
    series: { t: string; completions: number; paid: number; points: number }[]
    totals: { completions: number | null; paid: number | null; players: number | null }
    liveOffers: number | null
  } | null
  /** Gully Chain copy-trading engine health (copy.gullychain.xyz/health) */
  copy?: { leaders: number | null; activeCopies: number | null; block: number | null; dryRun: boolean } | null
  /** Gully Social: the newest page of posts (30) and of new accounts (50), counts and unix times only */
  social?: { count: number; more: boolean; times: number[] } | null
  people?: { count: number; more: boolean; times: number[] } | null
  /** Gully Sentry (sentry.gullychain.xyz), read server-side: the browser is refused by its CORS. Older servers omit these. */
  sentryNet?: { at: number; epoch: number | null; activeKeys: number | null; operators: number | null; heartbeats24h: number; series: { t: number; keys: number }[] } | null
  sentrySale?: { saleMode: string; totalMinted: number | null; totalBurned: number | null; maxSupply: number | null; available: number | null } | null
  sentryChain?: { verdict: string; summary: string; l3Head: number | null; newestAssertionAgeSec: number | null; checkedAt: number | null } | null
}
export type Load = 'loading' | 'ok' | 'error'
export interface Sources {
  hub: HubBody | null
  products: HubProducts | null
  live: HubLive | null
  liveState: Load
  /** /api/stats totals (venues we built) */
  stats?: { totals: { tvlUsd: number | null; volumeAllUsd: number | null; feesAllUsd: number | null } } | null
}
export interface Row {
  v: number
  x: string
}
export interface Reading {
  /** 'up' | 'down' from the hub monitor; 'coming' for a product still coming online; 'reading' before the first answer */
  state: 'up' | 'down' | 'coming' | 'reading'
  kpi: { v: number; of?: number; label: string; short: string } | null
  /** why there is no KPI: the source is loading, offline, or has nothing yet */
  why: string | null
  series: { name: string; unit: string; kind: 'bars' | 'line'; rows: Row[] } | null
  extra: [string, string | number | null][]
  source: string
}

/** Which /api/hub services make up each product (uptime). */
export const SERVICE_KEYS: Record<ProductKey, string[]> = {
  id: ['gully-id'],
  pay: ['pay', 'x402', 'pay-admin'],
  chain: ['chain-site', 'street', 'explorer', 'faucet', 'bridge', 'indexer', 'rpc-public', 'safe', 'copy', 'social-api', 'docs', 'devportal', 'sentry', 'offerwall'],
  rpc: ['rpc-site', 'rpc-app', 'rpc-gateway'],
  holdermaps: ['holders'],
  security: ['security'],
  studio: ['studio', 'studio-dev', 'studio-docs'],
  ai: ['gullyai', 'ai-api'],
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const hh = (iso: string | number) => {
  const d = new Date(typeof iso === 'number' ? iso * 1000 : iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`
}
const dd = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** Up when every monitored surface that is not still "coming" answers. */
export function upState(hub: HubBody | null, key: ProductKey): Reading['state'] {
  if (!hub) return 'reading'
  const svcs = hub.services.filter((s) => SERVICE_KEYS[key].includes(s.key))
  const real = svcs.filter((s) => s.state !== 'coming')
  if (!real.length) return svcs.length ? 'coming' : 'reading'
  return real.every((s) => s.state === 'up' || (!s.state && s.up)) ? 'up' : 'down'
}

function latency(hub: HubBody | null, key: string): Row[] {
  const s = hub?.services.find((x) => x.key === key)
  return (s?.history ?? []).filter((h) => num(h.ms) != null).map((h) => ({ v: h.ms as number, x: `${new Date(h.t).toISOString().slice(11, 16)} UTC` }))
}

/** One product's live reading. Never invents a figure: missing sources give `why`, not zeros. */
export function reading(src: Sources, key: ProductKey, now = Date.now()): Reading {
  const { hub, products: prod, live } = src
  const wait = src.liveState === 'loading' && !live
  const r: Reading = { state: upState(hub, key), kpi: null, why: null, series: null, extra: [], source: '' }
  if (key === 'id') {
    r.source = 'gullyid.xyz/v1/stats/public'
    const d = live?.id
    if (!d) r.why = wait ? 'Loading…' : 'Gully ID stats unreadable right now'
    else {
      if (num(d.signins24h) != null) r.kpi = { v: d.signins24h as number, label: 'sign-ins, last 24 h', short: 'sign-ins 24h' }
      r.series = { name: 'Gully ID sign-ins per hour (UTC)', unit: 'sign-ins', kind: 'bars', rows: d.hourly.map((h) => ({ v: h.n, x: hh(h.hour) })) }
      r.extra = [['Accounts', d.totals.users], ['Passkeys', d.totals.passkeys], ['Apps signed into, 30 d', d.appsActive30d]]
    }
  } else if (key === 'pay') {
    r.source = 'gullypay.xyz/api/status'
    const p = live?.pay
    if (p) {
      const names = Object.keys(p.services)
      r.kpi = { v: names.filter((n) => p.services[n] === 'operational').length, of: names.length, label: 'services operational', short: 'services ok' }
    } else r.why = wait ? 'Loading…' : 'Gully Pay status unreadable right now'
    r.series = { name: 'gullypay.xyz response time', unit: 'ms', kind: 'line', rows: latency(hub, 'pay') }
    if (hub?.x402) r.extra.push(['x402 networks', hub.x402.networks.length], ['x402 assets', hub.x402.assets.join(' · ')])
    // no public figure for the vault yet (its numbers sit behind the merchant API), so a plain line, not a number
    r.extra.push(['glUSD yield vault', 'Testnet · opt-in'])
  } else if (key === 'chain') {
    r.source = 'indexer.gullychain.xyz + /api/hub/products'
    const head = num(live?.head?.block) ?? num(hub?.chain?.head)
    if (head != null) r.kpi = { v: head, label: 'latest block, chain 485590', short: 'block' }
    else r.why = wait || !hub ? 'Loading…' : 'Indexer unreadable right now'
    if (prod?.chain) r.series = { name: 'Gully Chain transactions per hour (UTC)', unit: 'txs', kind: 'bars', rows: prod.chain.hourly.map((h) => ({ v: h.txs ?? 0, x: hh(h.t) })) }
    if (hub?.quests) r.extra.push(['Quest completions, 24 h', hub.quests.completions24h], ['Active quests', hub.quests.active])
    if (live?.copy) r.extra.push(['Copy trading leaders · active copies', `${fmtNum(live.copy.leaders)} · ${fmtNum(live.copy.activeCopies)}`])
    if (prod?.activity) {
      const a = prod.activity.hourly.reduce((s, h) => ({ l: s.l + (h.launches ?? 0), t: s.t + (h.trades ?? 0), w: s.w + (h.swaps ?? 0) }), { l: 0, t: 0, w: 0 })
      r.extra.push(['Launches · trades · swaps, 24 h', `${a.l} · ${a.t} · ${a.w}`])
    }
  } else if (key === 'rpc') {
    r.source = 'gullylabs.xyz/api/hub (RPC gateway)'
    if (hub?.gateway) r.kpi = { v: hub.gateway.ok, of: hub.gateway.total, label: 'gateway networks OK', short: 'networks ok' }
    else r.why = hub ? 'Gateway unreadable right now' : 'Loading…'
    r.series = { name: 'rpc.gullyrpc.xyz response time', unit: 'ms', kind: 'line', rows: latency(hub, 'rpc-gateway') }
    if (live?.rpc) r.extra.push(['Live features', live.rpc.features.filter((f) => f.status === 'live').map((f) => f.name).join(', ') || '–'])
  } else if (key === 'holdermaps') {
    r.source = 'gullylabs.xyz/api/hub/products'
    if (prod?.holders) {
      r.kpi = { v: prod.holders.today, label: 'holder maps opened today', short: 'maps today' }
      r.series = { name: 'Holder maps opened per day', unit: 'maps', kind: 'bars', rows: prod.holders.daily.map((h) => ({ v: h.maps, x: dd(h.day) })) }
      r.extra.push(['Tokens mapped today', prod.holders.tokens])
    } else r.why = prod ? 'Map counter unreadable right now' : 'Loading…'
  } else if (key === 'security') {
    r.source = 'gullylabs.xyz/api/hub/products'
    if (prod?.security) {
      const tot = prod.security.daily.reduce((s, h) => s + h.scans, 0)
      r.kpi = { v: tot, label: `scans in the last ${prod.security.daily.length} days`, short: `scans ${prod.security.daily.length} d` }
      r.series = { name: 'Security scans per day', unit: 'scans', kind: 'bars', rows: prod.security.daily.map((h) => ({ v: h.scans, x: dd(h.day) })) }
      r.extra.push(['Published reports', prod.security.published])
    } else r.why = prod ? 'Scan counter unreadable right now' : 'Loading…'
  } else if (key === 'studio') {
    r.source = 'gullylabs.xyz/api/hub (Gully Quests)'
    if (hub?.quests) {
      const listed = hub.quests.quests.filter((q) => /frog hop/i.test(q.title))
      const last = hub.quests.recent.find((q) => q.title && /frog hop/i.test(q.title) && q.at)
      if (listed.length) r.kpi = { v: listed.reduce((s, q) => s + (q.completions || 0), 0), label: 'Frog Hop quest completions (testnet)', short: 'Frog Hop runs' }
      else r.why = last?.at ? `Frog Hop win ${ago(last.at, now)}` : 'No Frog Hop quest runs in the feed yet'
    } else r.why = 'Loading…'
    r.series = { name: 'gullystudio.xyz response time', unit: 'ms', kind: 'line', rows: latency(hub, 'studio') }
  } else if (key === 'ai') {
    r.source = 'gullylabs.xyz/api/hub'
    const api = hub?.services.find((s) => s.key === 'ai-api')
    r.state = 'coming'
    r.why = api && (api.state === 'up' || api.up) ? 'API answering' : 'API coming online: GPU box pending'
    r.series = { name: 'gullyai.xyz response time', unit: 'ms', kind: 'line', rows: latency(hub, 'gullyai') }
  }
  return r
}

export function readings(src: Sources, now = Date.now()) {
  return Object.fromEntries(HUB_PRODUCTS.map((p) => [p.key, reading(src, p.key, now)])) as Record<ProductKey, Reading>
}

/** Suite-wide numbers for the hero and the status pill. */
export function suite(src: Sources) {
  const hub = src.hub
  const svcs = (hub?.services ?? []).filter((s) => s.state !== 'coming')
  const up = svcs.filter((s) => s.state === 'up' || (!s.state && s.up)).length
  const t = src.stats?.totals
  return { up: hub ? up : null, total: hub ? svcs.length : null, tvl: num(t?.tvlUsd), volumeAll: num(t?.volumeAllUsd), feesAll: num(t?.feesAllUsd) }
}

export interface LiveEvent {
  at: string
  p: ProductKey
  t: string
  kind: 'quest' | 'signin' | 'chain'
  href?: string
}
const METHOD: Record<string, string> = { passkey: 'a passkey', wallet: 'a wallet', email: 'an email code', social: 'Google / X' }
const KIND: Record<string, string> = { trade: 'Trade', launch: 'Token launch', swap: 'Swap', wrap: 'ETH wrapped', unwrap: 'ETH unwrapped', transfer: 'Transfer' }
/** The newest real events across the suite, newest first. */
export function liveEvents(src: Sources, max = 8): LiveEvent[] {
  const ev: LiveEvent[] = []
  for (const q of src.hub?.quests?.recent ?? []) if (q.at) ev.push({ at: q.at, p: 'chain', kind: 'quest', t: `Quest completed: ${q.title ?? `#${q.questId}`}` })
  for (const s of (src.live?.id?.recent ?? []).slice(0, 5)) ev.push({ at: s.at, p: 'id', kind: 'signin', t: `Gully ID sign-in with ${METHOD[s.method] ?? s.method}` })
  for (const f of (src.live?.feed?.items ?? []).slice(0, 6)) {
    const at = Number(f.timestamp)
    if (!Number.isFinite(at)) continue
    ev.push({ at: new Date(at * 1000).toISOString(), p: 'chain', kind: 'chain', t: `${KIND[f.kind] ?? f.kind} on Gully Chain, block ${f.block}`, href: f.txHash ? `https://testnet-explorer.gullychain.xyz/tx/${f.txHash}` : undefined })
  }
  return ev.filter((e) => Number.isFinite(Date.parse(e.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max)
}

/** What changed between two polls, for toasts: real events only, never on the first reading. */
export interface Seen {
  quest: number | null
  idAt: number | null
  feedId: string | null
  maps: number | null
}
export function seenOf(src: Sources): Seen {
  return {
    quest: num(src.hub?.quests?.completions),
    idAt: src.live?.id?.recent?.[0] ? Date.parse(src.live.id.recent[0].at) : null,
    feedId: src.live?.feed?.items?.[0]?.id ?? null,
    maps: num(src.products?.holders?.today),
  }
}
export function changes(prev: Seen | null, next: Seen, src: Sources): { title: string; text: string; icon: 'activity' | 'blocks' | 'zap' | 'check' }[] {
  if (!prev) return []
  const out: { title: string; text: string; icon: 'activity' | 'blocks' | 'zap' | 'check' }[] = []
  if (next.quest != null && prev.quest != null && next.quest > prev.quest) out.push({ title: 'Quest completed', text: `${next.quest - prev.quest} new on Gully Chain`, icon: 'check' })
  if (next.idAt && prev.idAt && next.idAt > prev.idAt) out.push({ title: 'New Gully ID sign-in', text: `With ${METHOD[src.live?.id?.recent?.[0]?.method ?? ''] ?? 'a passkey or wallet'}`, icon: 'zap' })
  if (next.feedId && prev.feedId && next.feedId !== prev.feedId) out.push({ title: 'New on Gully Chain', text: `A ${src.live?.feed?.items?.[0]?.kind ?? 'transaction'} just landed on chain 485590`, icon: 'blocks' })
  if (next.maps != null && prev.maps != null && next.maps > prev.maps) out.push({ title: 'Holder map opened', text: `${next.maps - prev.maps} new on HolderMaps today`, icon: 'activity' })
  return out
}

export const fmtNum = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : Math.round(v).toLocaleString('en-US'))
export const kpiText = (k: Reading['kpi']) => (!k ? '–' : k.of != null ? `${k.v}/${k.of}` : fmtNum(k.v))
