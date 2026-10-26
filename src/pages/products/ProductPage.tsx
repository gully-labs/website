/* One page per Gully product (/products/:key), compact (about 1.5 screens at 1440): hero copy with the product's
   kit logo beside a live chart card, four live tiles, a three-step stepper and a link out to the product's own
   domain. Every figure is read live; nothing here is typed in. */
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowUpRight, BookOpen, Code2, KeyRound, LayoutGrid, Link2, Map as MapIcon, Gamepad2, HardDrive, Network, Pin, Rocket, ScanSearch, ShieldCheck, Wallet, Zap } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { BlockBars, ChartCard, type ChartTab } from '../../console/ChartCard'
import { C, fmtInt, fmtPct, fmtUsd, type Series } from '../../console/charts'
import { chainHead, okVenues, summed, useLive, venueSeries, type Live } from '../../console/live'
import { ProductLive } from '../../console/Suite'
import { Btn, Count, PRODUCTS, ProductLogo, SectionHead, Stepper, Tile, TrustBand, type ProductDef, type ProductKey, type Step } from '../../console/ui'
import { APP_URL, DOCS_URL } from '../../site-host'
import { NotFound } from '../NotFound'

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
const ms = (v: number | null) => (v == null ? '—' : `${Math.round(v)} ms`)
const int = (v: number | null) => fmtInt(v)
const usd = (v: number | null) => fmtUsd(v)

interface TileDef {
  label: string
  value: number | null | undefined
  fmt?: (v: number) => string
  spark: (number | null)[]
  color: string
  sub: ReactNode
}
interface PageDef {
  label: string
  h1: ReactNode
  promise: ReactNode
  chartLabel: string
  tabs: ChartTab[]
  bars?: boolean
  tiles: TileDef[]
  stepsTitle: string
  steps: Step[]
}

const statusOf = (l: Live, test: (id: string, group: string) => boolean) => (l.status?.components ?? []).filter((c) => test(c.id, c.group))
const minUptime = (cs: { uptime24h: number | null }[]) => (cs.some((c) => c.uptime24h != null) ? Math.round(Math.min(...cs.filter((c) => c.uptime24h != null).map((c) => c.uptime24h as number)) * 1000) / 10 : null)
const histUp = (cs: { history: { t: string; up: number | null }[] }[]) => (cs[0]?.history ?? []).map((_, i) => (cs.every((c) => c.history[i]?.up == null) ? null : Math.round(Math.min(...cs.map((c) => c.history[i]?.up ?? 1)) * 1000) / 10))
const histLabels = (cs: { history: { t: string }[] }[]) => (cs[0]?.history ?? []).map((h) => new Date(h.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))

function defFor(key: ProductKey, l: Live): PageDef {
  const s = l.stats
  const blocks = l.chain?.blocks ?? []
  const gaps = blocks.slice(1).map((b, i) => b.time - blocks[i].time)
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null
  const txs40 = blocks.reduce((a, b) => a + b.txs, 0)
  const lastMs = l.rpcMs.length ? l.rpcMs[l.rpcMs.length - 1] : null
  const ok = s ? okVenues(s) : []
  const one = (name: string, color: string, values: (number | null)[]): Series[] => [{ name, color, values }]
  const blockLabels = blocks.map((b) => `#${b.number}`)
  const chainTabs: ChartTab[] = [
    { id: 'txs', label: 'Txs / block', title: 'Gully Chain testnet, transactions per block', series: one('Transactions', C.cyan, blocks.map((b) => b.txs)), labels: blockLabels, fmt: int, head: <Count value={chainHead(l)} />, sub: `latest block · chain 485590 · ${txs40} tx in the last ${blocks.length} blocks` },
    { id: 'time', label: 'Block time', title: 'Seconds between Gully Chain blocks', series: one('Seconds', C.s[2], gaps), labels: blockLabels.slice(1), fmt: (v) => (v == null ? '—' : `${Math.round(v)} s`), head: avgGap == null ? '—' : `~${Math.round(avgGap)} s`, sub: 'average time between the last blocks' },
  ]
  const venueTab = (m: 'tvl' | 'volume' | 'fees', label: string, title: string, head: number | null | undefined, sub: string): ChartTab => {
    const vs = s ? venueSeries(s, m, 30) : { series: [], labels: [] }
    return { id: m, label, title, series: vs.series, labels: vs.labels, fmt: usd, stacked: true, head: <Count value={head} fmt={fmtUsd} />, sub }
  }
  const pay = statusOf(l, (_, g) => g === 'payments')
  const holders = statusOf(l, (id, g) => g === 'holders' && id !== 'holders-bsc')
  const sec = statusOf(l, (id) => id === 'security' || id === 'monitors')
  const api = statusOf(l, (id) => id === 'api')
  const dc = ok.find((v) => v.key === 'deepcore')
  const peddles = ok.find((v) => v.key === 'peddles')
  const tvl30 = s ? venueSeries(s, 'tvl', 30) : null
  const dcTvl = tvl30?.series.find((x) => x.key === 'deepcore')?.values ?? []
  const chainTiles: TileDef[] = [
    { label: 'Latest block', value: chainHead(l), spark: blocks.map((b) => b.txs), color: C.cyan, sub: l.chain || !l.hub?.chain ? 'Gully Chain testnet · 485590' : 'Gully Chain testnet · via the indexer' },
    { label: 'Block time', value: avgGap, fmt: (v) => `${Math.round(v)} s`, spark: gaps, color: C.s[2], sub: `average over ${blocks.length} blocks` },
    { label: `Txs · last ${blocks.length || 40} blocks`, value: blocks.length ? txs40 : null, spark: blocks.map((b) => b.txs), color: C.s[1], sub: 'read from the public RPC' },
    { label: 'RPC latency', value: lastMs, fmt: (v) => `${Math.round(v)} ms`, spark: l.rpcMs, color: C.s[0], sub: 'from this browser, every 8 s' },
  ]
  switch (key) {
    case 'chain':
      return {
        label: 'Gully Chain · L3 on Arbitrum',
        h1: <>Launch and trade on <span className="grad">your own chain.</span></>,
        promise: <>An L3 chain for launches and trading with <b>DeepCore built in</b> as its launchpad. Testnet chain 485590 is live, served through Gully RPC.</>,
        chartLabel: 'Gully Chain testnet · live',
        tabs: chainTabs,
        bars: true,
        tiles: chainTiles,
        stepsTitle: 'From wallet to launch',
        steps: [
          { icon: Wallet, title: 'Add the network', body: <>Chain <b>485590</b>, the public testnet RPC or your Gully RPC key, and the explorer.</> },
          { icon: Rocket, title: 'Launch on DeepCore', body: <>DeepCore is the built-in launchpad: <b>a token and its pool in one step</b>.</> },
          { icon: Network, title: 'Run your own L3', body: <>Gully Chains: your own Arbitrum chain, <b>run by us</b>, on the same stack.</> },
        ],
      }
    case 'pay':
      return {
        label: 'Gully Pay · x402 payments',
        h1: <>Get paid on chain, <span className="grad">in one link.</span></>,
        promise: <>x402 payments, checkout and a merchant OS. <b>Every Gully product bills through Gully Pay</b>, settled straight to the merchant's wallet.</>,
        chartLabel: 'Fees and volume · live',
        tabs: [venueTab('fees', 'Fees', 'Daily fees by venue, 30 days', s?.totals.feesAllUsd, 'fees, all-time across our venues'), venueTab('volume', 'Volume', 'Daily volume by venue, 30 days', s?.totals.volumeAllUsd, 'volume, all-time across our venues')],
        tiles: [
          { label: 'Gully Pay services', value: l.products?.pay?.up ?? null, fmt: l.products?.pay ? (v) => `${v}/${l.products!.pay!.total}` : undefined, spark: (l.products?.pay?.history ?? []).map((h) => h.v), color: C.s[1], sub: l.products?.pay ? `operational · gullypay.xyz/api/status` : 'reading gullypay.xyz status' },
          { label: 'Checkout uptime · 24h', value: minUptime(pay), fmt: fmtPct, spark: histUp(pay), color: C.s[0], sub: `${pay.length} payment checks` },
          { label: 'Fees · all-time', value: s?.totals.feesAllUsd, fmt: fmtUsd, spark: s ? summed(s, 'fees') : [], color: C.s[2], sub: 'USD, venue APIs + DefiLlama' },
          { label: 'Gully Chain block', value: chainHead(l), spark: blocks.map((b) => b.txs), color: C.cyan, sub: 'settlement chain 485590 (testnet)' },
        ],
        stepsTitle: 'Take your first payment',
        steps: [
          { icon: KeyRound, title: 'Open a store', body: <>Sign in to the Gully App and <b>name your store</b>; payouts go to your own wallet.</> },
          { icon: Link2, title: 'Share a pay link', body: <>A pay link or invoice per order, <b>x402 for APIs and agents</b>.</> },
          { icon: Zap, title: 'Get the webhook', body: <>Paid, confirmed, settled: <b>one webhook per step</b>, with receipts.</> },
        ],
      }
    case 'rpc':
      return {
        label: 'Gully RPC · node gateway',
        h1: <>Every Gully chain, <span className="grad">one RPC key.</span></>,
        promise: <>The node control plane and RPC gateway behind every Gully chain. <b>Gully Chain testnet is served at</b> rpc.gullyrpc.xyz/&lt;project&gt;/evm/485590.</>,
        chartLabel: 'Testnet latency · live',
        tabs: [
          { id: 'ms', label: 'Latency', title: 'Gully Chain RPC latency from this browser', series: one('Latency', C.s[1], l.rpcMs), labels: l.rpcMs.map((_, i) => `read ${i + 1}`), fmt: ms, head: lastMs == null ? '—' : <><Count value={lastMs} /> ms</>, sub: 'latest read, every 8 s' },
          { id: 'api', label: 'API checks', title: 'Public API latency, 30-minute buckets', series: one('API', C.s[0], (api[0]?.history ?? []).map((h) => h.ms)), labels: histLabels(api), fmt: ms, head: <Count value={minUptime(api)} fmt={fmtPct} />, sub: 'public API uptime, 24 h' },
        ],
        tiles: ([] as TileDef[]).concat([
          { label: 'Networks served', value: l.products?.rpc?.served ?? null, fmt: l.products?.rpc ? (v) => `${v}/${l.products!.rpc!.total}` : undefined, spark: (l.products?.rpc?.history ?? []).map((h) => h.v), color: C.s[0], sub: 'live or beta · gullyrpc.xyz/status.json' },
          { label: 'Latency · now', value: lastMs, fmt: (v) => `${Math.round(v)} ms`, spark: l.rpcMs, color: C.s[1], sub: 'eth_blockNumber + blocks' },
          { label: 'Latency · average', value: l.rpcMs.length ? l.rpcMs.reduce((a, b) => a + b, 0) / l.rpcMs.length : null, fmt: (v) => `${Math.round(v)} ms`, spark: l.rpcMs, color: C.s[2], sub: `${l.rpcMs.length} reads this visit` },
          { label: 'API uptime · 24h', value: minUptime(api), fmt: fmtPct, spark: histUp(api), color: C.s[3], sub: 'status checks every minute' },
        ]),
        stepsTitle: 'Point your app at Gully RPC',
        steps: [
          { icon: KeyRound, title: 'Get a key', body: <>One key from the Gully App, <b>free tier included</b>.</> },
          { icon: Code2, title: 'Swap the URL', body: <>Use <b>rpc.gullyrpc.xyz/&lt;project&gt;/evm/&lt;chainId&gt;</b> in viem, ethers or wagmi.</> },
          { icon: LayoutGrid, title: 'Watch usage', body: <>Requests, errors and latency <b>per project</b>, billed through Gully Pay.</> },
        ],
      }
    case 'holders':
      return {
        label: 'HolderMaps · holder bubble maps',
        h1: <>See who <span className="grad">really holds it.</span></>,
        promise: <>Bubble maps, wallet clusters and deep checks for any token, <b>Gully Chain tokens included</b>.</>,
        chartLabel: 'Venue value locked · live',
        tabs: [venueTab('tvl', 'Value locked', 'Value locked by venue, 30 days', s?.totals.tvlUsd, 'value locked across our venues')],
        tiles: [
          { label: 'Peddles users', value: (peddles?.counts?.users as number | null | undefined) ?? null, spark: tvl30?.series.find((x) => x.key === 'peddles')?.values ?? [], color: C.s[2], sub: 'read from the Peddles venue' },
          { label: 'Holder chains up · 24h', value: minUptime(holders), fmt: fmtPct, spark: histUp(holders), color: C.s[0], sub: `${holders.length} holder sources checked` },
          { label: 'Venues read', value: s ? ok.length : null, spark: s ? summed(s, 'tvl') : [], color: C.s[1], sub: s ? `of ${s.venues.length} venues` : 'reading venues' },
          { label: 'Gully Chain block', value: chainHead(l), spark: blocks.map((b) => b.txs), color: C.cyan, sub: 'Gully Chain tokens mapped too' },
        ],
        stepsTitle: 'Map a token',
        steps: [
          { icon: ScanSearch, title: 'Paste a token', body: <>Any contract on a supported chain, <b>Gully Chain included</b>.</> },
          { icon: MapIcon, title: 'Read the map', body: <>Bubbles are holders; links are <b>shared funding and transfers</b>.</> },
          { icon: ShieldCheck, title: 'Run a deep check', body: <>Clusters, insiders and snipers <b>in one report</b>.</> },
        ],
      }
    case 'security':
      return {
        label: 'Gully Security · scans and monitors',
        h1: <>Review. Validate. <span className="grad">Defend.</span></>,
        promise: <>AI security scans, contract monitors and the <b>Gully Score</b> for any contract, Gully Chain contracts included.</>,
        chartLabel: 'Scan engine uptime · live',
        tabs: [
          { id: 'up', label: 'Uptime', title: 'Scan engine and monitors uptime, 30-minute buckets', series: one('Uptime %', C.s[0], histUp(sec)), labels: histLabels(sec), fmt: pct, head: <Count value={minUptime(sec)} fmt={fmtPct} />, sub: 'uptime 24h · scan engine + monitors' },
          { id: 'ms', label: 'Latency', title: 'Scan engine check latency', series: one('Latency', C.s[1], (sec[0]?.history ?? []).map((h) => h.ms)), labels: histLabels(sec), fmt: ms, head: sec[0]?.latencyMs == null ? '—' : `${sec[0].latencyMs} ms`, sub: 'latest check' },
        ],
        tiles: [
          { label: 'Uptime · 24h', value: minUptime(sec), fmt: fmtPct, spark: histUp(sec), color: C.s[0], sub: 'scan engine + monitors' },
          { label: 'Checks · 24h', value: sec.length ? sec.reduce((a, c) => a + c.history.length, 0) : null, spark: histUp(sec), color: C.s[1], sub: '30-minute buckets' },
          { label: 'Services up', value: l.status ? l.status.components.filter((c) => c.state === 'up').length : null, spark: histUp(api), color: C.s[2], sub: l.status ? `overall ${l.status.overall}` : 'reading status' },
          { label: 'Gully Chain block', value: chainHead(l), spark: blocks.map((b) => b.txs), color: C.cyan, sub: 'Gully Chain contracts scanned too' },
        ],
        stepsTitle: 'Secure a contract',
        steps: [
          { icon: ScanSearch, title: 'Scan it', body: <>Paste an address or upload code: <b>an AI scan in minutes</b>.</> },
          { icon: ShieldCheck, title: 'Get a Gully Score', body: <>A public score page and <b>a "Secured by" badge</b>.</> },
          { icon: Zap, title: 'Turn on monitors', body: <>Alerts on risky changes <b>by Telegram or webhook</b>.</> },
        ],
      }
    case 'ipfs': {
      const ip = l.ipfs
      const h = ip?.history ?? []
      const labels = h.map((x) => new Date(x.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
      const gb = (v: number | null) => (v == null ? '—' : `${(v / 1e9).toFixed(2)} GB`)
      return {
        label: 'Gully IPFS · Gully Labs service',
        h1: <>Gully content, <span className="grad">pinned for good.</span></>,
        promise: <>Our own IPFS node with a read-only gateway at <b>ipfs.gullylabs.xyz/ipfs/&lt;CID&gt;</b>. It serves only what we pin: token art, metadata, NFT art and .gully sites.</>,
        chartLabel: 'Gully IPFS node · live',
        tabs: [
          { id: 'pins', label: 'Pinned', title: 'CIDs pinned on the Gully IPFS node', series: one('Pinned', C.s[0], h.map((x) => x.pinned)), labels, fmt: int, head: <Count value={ip?.pinned} />, sub: ip?.pinned != null ? 'recursive pins, read from the node' : 'node not readable from this server yet' },
          { id: 'gw', label: 'Gateway', title: 'Gateway response time', series: one('Gateway', C.s[1], h.map((x) => x.ms)), labels, fmt: ms, head: ip?.gatewayMs == null ? '—' : `${ip.gatewayMs} ms`, sub: ip?.gatewayUp ? 'gateway answering' : 'gateway not reachable yet' },
        ],
        tiles: [
          { label: 'CIDs pinned', value: ip?.pinned ?? null, spark: h.map((x) => x.pinned), color: C.s[0], sub: 'GET /api/ipfs/stats' },
          { label: 'Repo size', value: ip?.repoBytes ?? null, fmt: (v) => gb(v), spark: h.map((x) => x.repoBytes), color: C.s[2], sub: 'pinned content is never collected' },
          { label: 'Gateway', value: ip?.gatewayMs ?? null, fmt: (v) => `${Math.round(v)} ms`, spark: h.map((x) => x.ms), color: C.s[1], sub: ip?.gatewayUp ? 'answering' : 'not reachable yet' },
          chainTiles[0],
        ],
        stepsTitle: 'Serve a file from Gully IPFS',
        steps: [
          { icon: Pin, title: 'We pin it', body: <>Gully content only: <b>token images, metadata, NFT art</b>, docs snapshots.</> },
          { icon: HardDrive, title: 'Link the CID', body: <>Use <b>ipfs.gullylabs.xyz/ipfs/&lt;CID&gt;</b>, or any IPFS gateway.</> },
          { icon: Network, title: 'Name it', body: <>Point a <b>.gully name</b>&apos;s contenthash at the CID for a site on IPFS.</> },
        ],
      }
    }
    case 'studio':
      return {
        label: 'Gully Studio · game studio',
        h1: <>Games that <span className="grad">live on chain.</span></>,
        promise: <>Our game studio: <b>Unity 3D titles on Gully Chain</b> with the Gully Game SDK, paid through Gully Pay.</>,
        chartLabel: 'Gully Chain and DeepCore · live',
        tabs: [chainTabs[0], { id: 'dc', label: 'DeepCore', title: 'DeepCore value locked, 30 days', series: one('DeepCore', C.s[3], dcTvl), labels: tvl30?.labels ?? [], fmt: usd, head: <Count value={dc?.tvlUsd} fmt={fmtUsd} />, sub: 'DeepCore value locked' }],
        bars: true,
        tiles: [
          { label: 'DeepCore launches', value: (dc?.counts?.launches as number | null | undefined) ?? null, spark: dcTvl, color: C.s[3], sub: 'on chain, read live' },
          chainTiles[0],
          chainTiles[1],
          chainTiles[3],
        ],
        stepsTitle: 'Build a game on Gully',
        steps: [
          { icon: Gamepad2, title: 'Build in Unity', body: <>Unity 3D with the <b>Gully Game SDK</b> for wallets and items.</> },
          { icon: Network, title: 'Ship on Gully Chain', body: <>Items and scores <b>on chain 485590</b>, served by Gully RPC.</> },
          { icon: Wallet, title: 'Sell with Gully Pay', body: <>In-game purchases <b>settled through Gully Pay</b>.</> },
        ],
      }
  }
}

const LIVE_TITLE: Record<string, string> = { chain: 'Everything on Gully Chain', pay: 'Where Gully Pay settles', rpc: 'Networks behind one key' }
const LIVE_LINE: Record<string, string> = {
  chain: 'Gully Street, the explorer, faucet, bridge, docs and developer portal, each checked every minute, plus Gully Quests read on chain.',
  pay: "x402 networks from Gully Pay's own facilitator, Gully Chain included, and the Gully RPC networks it reads them through.",
  rpc: "The gateway's networks and their state right now, Gully Chain testnet first, plus the networks Gully Pay settles on.",
}

export function ProductView({ p }: { p: ProductDef }) {
  const live = useLive()
  const d = defFor(p.key, live)
  const blocks = live.chain?.blocks ?? []
  return (
    <div className="lcp">
      <Seo title={`${p.name}: ${p.blurb.replace(/\.$/, '')}`} description={`${p.name} by Gully Labs: ${p.blurb} Live figures on this page; the product lives at ${p.url.replace('https://', '')}.`} />
      <section className="hero">
        <div className="wrap">
          <div className="copy rise">
            <span className="plogo">
              <ProductLogo p={p} />
            </span>
            <span className="lab cy">{d.label}</span>
            <h1>{d.h1}</h1>
            <p className="promise">{d.promise}</p>
            <div className="ctas">
              <Btn icon={ArrowUpRight} href={p.url} arrow>
                Open {p.url.replace('https://', '')}
              </Btn>
              <Btn kind="sec" icon={Zap} href={p.app ?? APP_URL}>
                Launch app
              </Btn>
              <Btn kind="ter" icon={BookOpen} href={p.docs ?? (p.key === 'ipfs' ? `${DOCS_URL}/ipfs` : DOCS_URL)}>
                Docs
              </Btn>
            </div>
          </div>
          <ChartCard label={d.chartLabel} tabs={d.tabs}>
            {d.bars && (
              <BlockBars
                blocks={blocks}
                meta={
                  <>
                    <span className="lab">Gully Chain · txs / block</span>
                    <Count as="b" value={live.chain?.head} />
                    <span>{live.chainState === 'error' ? 'RPC could not be read' : `${blocks.reduce((a, b) => a + b.txs, 0)} tx in ${blocks.length} blocks`}</span>
                  </>
                }
              />
            )}
          </ChartCard>
        </div>
      </section>
      <section className="statsec" aria-label="Live figures">
        <div className="wrap">
          <div className="stats stats4">
            {d.tiles.map((t) => (
              <Tile key={t.label} {...t} />
            ))}
          </div>
        </div>
      </section>
      {(p.key === 'chain' || p.key === 'pay' || p.key === 'rpc') && (
        <section aria-labelledby="live-h" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <SectionHead label="Live now" title={LIVE_TITLE[p.key]} id="live-h">
              {LIVE_LINE[p.key]}
            </SectionHead>
            <ProductLive k={p.key} />
          </div>
        </section>
      )}
      <section aria-labelledby="steps-h">
        <div className="wrap">
          <SectionHead label="How it works" title={d.stepsTitle} id="steps-h">
            Three steps. Every Gully product has a free tier, and billing runs through Gully Pay.
          </SectionHead>
          <Stepper
            steps={d.steps}
            cta={
              <Btn size="sm" icon={ArrowUpRight} href={p.url} arrow>
                Open {p.name}
              </Btn>
            }
          />
          <div className="pnav" aria-label="Other products">
            {PRODUCTS.filter((x) => x.key !== p.key).map((x) => (
              <Link key={x.key} to={`/products/${x.key}`} className="btn ter xs">
                {x.name}
              </Link>
            ))}
            <Link to="/products" className="btn ter xs">
              All products
            </Link>
          </div>
        </div>
      </section>
      <section style={{ paddingTop: 0 }} aria-label="Trust">
        <TrustBand mascot={false} />
      </section>
    </div>
  )
}

export function ProductPage() {
  const { key } = useParams()
  const p = PRODUCTS.find((x) => x.key === key)
  if (!p) return <NotFound />
  return <ProductView key={p.key} p={p} />
}
