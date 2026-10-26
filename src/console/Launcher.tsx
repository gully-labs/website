/* The compact launcher (compact refresh, 2026-10-26), shared by the landing, /products and the Gully Labs App:
   - LaunchGrid: one small card per Gully product (icon, one line, live status dot, opens the product in a new tab);
   - HubBoard:   the live board in one card (Gully Chain head, surfaces up, Gully Quests, status page, the networks
                 Gully Pay settles on and Gully RPC serves), every figure from GET /api/hub or the chain RPC;
   - WhatsNew:   what shipped since the hub update, each row with its live state where the hub checks it.
   A state is read from /api/hub (server/hub.mjs). "coming" is a surface still being set up that has not answered
   200 yet; nothing is shown as up that was not checked, and no figure is typed in. */
import type { ComponentType, ReactNode } from 'react'
import { Activity, ArrowLeftRight, ArrowUpRight, Bot, CircleDollarSign, Gamepad2, HardDrive, Network, Rocket, ScanSearch, Server, ShieldCheck, Vault, type LucideProps } from 'lucide-react'
import './console.css'
import { C, fmtInt } from './charts'
import { chainHead, hubState, LiveProvider, useLive, type HubBody, type Live } from './live'
import { Count, ic, Spark } from './ui'

type Icon = ComponentType<LucideProps>
type State = 'up' | 'down' | 'coming' | 'reading'

export interface LaunchItem {
  key: string
  name: string
  url: string
  icon: Icon
  line: string
  /** The /api/hub surfaces that make up its state: up when one answers, coming when all are still being set up. */
  hub: string[]
}

/** Every Gully product, one card each, in the order a newcomer meets them. Each supports Gully Chain. */
export const LAUNCH: LaunchItem[] = [
  { key: 'chain', name: 'Gully Chain', url: 'https://gullychain.xyz', icon: Network, line: 'L3 testnet 485590 with a live network board.', hub: ['chain-site', 'rpc-public'] },
  { key: 'street', name: 'Gully Street', url: 'https://app.gullychain.xyz', icon: Rocket, line: 'Social feed, 5 wallets per passkey, copy trading, Quests.', hub: ['street'] },
  { key: 'bridge', name: 'Gully Bridge', url: 'https://testnet-bridge.gullychain.xyz', icon: ArrowLeftRight, line: 'Hyperlane fast lane (gETH) plus the canonical bridge.', hub: ['bridge'] },
  { key: 'safe', name: 'Gully Safe', url: 'https://safe.gullychain.xyz', icon: Vault, line: 'Multisig wallets on Gully Chain.', hub: ['safe'] },
  { key: 'pay', name: 'Gully Pay', url: 'https://gullypay.xyz', icon: CircleDollarSign, line: 'Open sign-up, hosted checkout, x402 on five chains.', hub: ['pay', 'x402'] },
  { key: 'rpc', name: 'Gully RPC', url: 'https://gullyrpc.xyz', icon: Server, line: 'One key for every network, Gully Chain included.', hub: ['rpc-site', 'rpc-gateway'] },
  { key: 'holders', name: 'HolderMaps', url: 'https://holdermaps.xyz', icon: ScanSearch, line: 'Who holds a token: bubble maps and deep checks.', hub: ['holders'] },
  { key: 'security', name: 'Gully Security', url: 'https://gullysecurity.xyz', icon: ShieldCheck, line: 'AI contract scans, monitors and reports.', hub: ['security'] },
  { key: 'ai', name: 'Gully AI', url: 'https://gullyai.xyz', icon: Bot, line: 'Site and docs live; the API opens with the GPU box.', hub: ['gullyai'] },
  { key: 'studio', name: 'Gully Studio', url: 'https://gullystudio.xyz', icon: Gamepad2, line: 'Unity 3D games on Gully Chain, with dev and docs portals.', hub: ['studio'] },
  { key: 'ipfs', name: 'Gully IPFS', url: 'https://docs.gullylabs.xyz/ipfs', icon: HardDrive, line: 'Token art, metadata and .gully sites, pinned for good.', hub: ['ipfs'] },
  { key: 'status', name: 'Status', url: 'https://status.gullylabs.xyz', icon: Activity, line: 'Every Gully service, checked each minute.', hub: ['status'] },
]

/** The combined state of some hub surfaces. */
export function stateOf(hub: HubBody | null, keys: string[]): State {
  if (!hub) return 'reading'
  const st = keys.map((k) => hubState(hub.services.find((s) => s.key === k)))
  if (st.includes('up')) return 'up'
  if (st.every((s) => s === 'coming')) return 'coming'
  if (st.every((s) => s === 'reading')) return 'reading'
  return st.includes('down') ? 'down' : 'coming'
}
const WORD: Record<State, string> = { up: 'live', down: 'down', coming: 'coming', reading: 'checking' }

/** A status dot with its word (the word is visually small, never colour alone). */
export function Dot({ s }: { s: State }) {
  return (
    <span className={`lxs ${s}`}>
      <i aria-hidden />
      {WORD[s]}
    </span>
  )
}

/** One compact card per product. `cols` caps the columns (the app's narrower main area uses 3). */
export function LaunchGrid({ items = LAUNCH, cols = 4 }: { items?: LaunchItem[]; cols?: 3 | 4 }) {
  const { hub } = useLive()
  return (
    <ul className={`lxg c${cols}`} data-testid="launch-grid">
      {items.map((p) => {
        const s = stateOf(hub, p.hub)
        return (
          <li key={p.key}>
            <a className="lx card" href={p.url} target="_blank" rel="noopener noreferrer" data-launch={p.key} data-state={s} aria-label={`${p.name}, ${WORD[s]}: ${p.line} (opens in a new tab)`}>
              <span className="lxi">{ic(p.icon)}</span>
              <span className="lxt">
                <b>{p.name}</b>
                <span>{p.line}</span>
              </span>
              <Dot s={s} />
              <span className="lxgo">{ic(ArrowUpRight)}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

const ethFmt = (v: number) => `${v < 0.01 ? v.toFixed(4) : v.toFixed(3)} ETH`
const NET: Record<string, string> = { 'gully-testnet': 'Gully Chain', 'gully-chain-testnet': 'Gully Chain', 'gully-chain': 'Gully Chain', ethereum: 'Ethereum', base: 'Base', 'base-sepolia': 'Base Sepolia', bsc: 'BNB Chain', solana: 'Solana', arbitrum: 'Arbitrum', robinhood: 'Robinhood' }

/** The mean response time of every answering surface, per minute of the last hour (one point a minute). */
function meanMs(hub: HubBody | null): (number | null)[] {
  if (!hub) return []
  const n = Math.max(0, ...hub.services.map((s) => s.history.length))
  return Array.from({ length: n }, (_, i) => {
    const v = hub.services.map((s) => s.history[s.history.length - n + i]?.ms).filter((x): x is number => typeof x === 'number')
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
  })
}

function Cell({ label, value, fmt, sub, spark, color }: { label: string; value: number | null | undefined; fmt?: (v: number) => string; sub: ReactNode; spark: (number | null)[]; color: string }) {
  return (
    <div className="hbc">
      <span className="lab">{label}</span>
      <Count as="b" value={value} fmt={fmt} />
      <span className="hbs">{sub}</span>
      {spark.filter((v) => v != null).length > 1 ? (
        <Spark values={spark} color={color} h={26} />
      ) : (
        <span className="spkwait" style={{ height: 26 }}>
          <i />
          collecting readings
        </span>
      )}
    </div>
  )
}

function chainGaps(l: Live) {
  const b = l.chain?.blocks ?? []
  return b.slice(1).map((x, i) => x.time - b[i].time)
}

/** The live board: Gully Chain, every surface, Gully Quests and the status page in one row, then the networks. */
export function HubBoard() {
  const live = useLive()
  const { hub } = live
  const svc = hub?.services ?? []
  const counted = svc.filter((s) => hubState(s) !== 'coming')
  const up = hub ? counted.filter((s) => s.up).length : null
  const coming = svc.filter((s) => hubState(s) === 'coming').length
  const q = hub?.quests ?? null
  const sp = hub?.statusPage ?? null
  const x = hub?.x402 ?? null
  const g = hub?.gateway ?? null
  const gNets = g ? [...g.networks].sort((a, b) => Number(b.chainId === 485590) - Number(a.chainId === 485590)) : []
  return (
    <div className="hb card" data-testid="hub-board">
      <div className="ch">
        <span className="lab cy">{ic(Activity)}Live board</span>
        <span className="r">{hub ? `checked ${new Date(hub.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · each minute` : 'checking…'}</span>
      </div>
      <div className="hbg">
        <Cell label="Gully Chain block" value={chainHead(live)} sub={live.chain ? 'testnet 485590 · RPC' : hub?.chain ? 'testnet 485590 · indexer' : 'testnet 485590'} spark={chainGaps(live)} color={C.s[0]} />
        <Cell label="Surfaces up" value={up} fmt={(v) => `${fmtInt(v)}/${counted.length}`} sub={hub ? `${coming ? `${coming} coming · ` : ''}mean response, last hour` : 'checking every surface'} spark={meanMs(hub)} color={C.s[1]} />
        <Cell label="Live quests" value={q ? (q.active ?? q.total) : null} sub={q ? `${fmtInt(q.completions ?? 0)} done${q.poolEth != null ? ` · ${ethFmt(q.poolEth)} in pools` : ''}` : hub ? 'quests unreadable' : 'reading quests'} spark={q?.hourly ?? []} color={C.s[2]} />
        <Cell label="Status page" value={sp ? sp.up : null} fmt={(v) => `${v}/${sp?.total ?? 0}`} sub={sp ? (sp.overall === 'ok' || !sp.overall ? 'all operational' : sp.overall === 'warn' ? 'degraded' : 'outage') : hub ? 'status page unreadable' : 'reading'} spark={live.rpcMs} color={C.s[3]} />
      </div>
      <div className="hbn">
        <span className="lab">Gully Pay x402</span>
        <ul className="chips">{x ? x.networks.map((n) => <li key={n.id} className={`chip${/gully/.test(n.id) ? ' gc' : ''}`}>{NET[n.id] ?? n.name}</li>) : <li className="chip dim">{hub ? 'unreadable' : 'reading…'}</li>}</ul>
      </div>
      <div className="hbn">
        <span className="lab">Gully RPC</span>
        <ul className="chips">{g ? gNets.map((n) => <li key={n.alias} className={`chip${n.chainId === 485590 ? ' gc' : ''}${n.state === 'OK' ? '' : ' bad'}`}>{NET[n.alias] ?? n.alias}</li>) : <li className="chip dim">{hub ? 'unreadable' : 'reading…'}</li>}</ul>
      </div>
    </div>
  )
}

interface NewItem {
  product: string
  text: string
  url: string
  /** A hub surface whose live state the row shows; otherwise the fixed tag. */
  hub?: string[]
  tag?: 'in progress' | 'coming'
}

/** What shipped since the hub update (2026-10-26). Rows the hub checks show their live state. */
export function whatsNew(hub: HubBody | null): NewItem[] {
  const q = hub?.quests
  return [
    { product: 'Gully Chain', text: 'New landing with a live network board', url: 'https://gullychain.xyz', hub: ['chain-site'] },
    { product: 'Gully Street', text: 'Social feed, profiles, invites and a verified badge', url: 'https://app.gullychain.xyz', hub: ['street'] },
    { product: 'Gully Street', text: 'Multi-wallet: up to 5 wallets per passkey', url: 'https://app.gullychain.xyz', hub: ['street'] },
    { product: 'Gully Street', text: 'Copy trading on the copy.gullychain.xyz engine', url: 'https://app.gullychain.xyz/copy', hub: ['copy'] },
    { product: 'Gully Quests', text: q?.active != null ? `${q.active} live quests, rewards paid on chain` : 'Quests on chain, rewards paid on chain', url: 'https://app.gullychain.xyz/quests', hub: ['street'] },
    { product: 'Gully Bridge', text: 'Hyperlane fast lane (gETH, Gully Bridged ETH) and the canonical bridge', url: 'https://testnet-bridge.gullychain.xyz', hub: ['bridge'] },
    { product: 'Gully Bridge', text: 'Bridge SDK: integrators earn a fee on every bridge', url: 'https://docs.gullychain.xyz', tag: 'in progress' },
    { product: 'Gully Safe', text: 'Multisig wallets on Gully Chain', url: 'https://safe.gullychain.xyz', hub: ['safe'] },
    { product: 'Gully Pay', text: 'Open sign-up and hosted checkout; x402 on Base, Ethereum, BNB Chain, Solana and Gully Chain', url: 'https://gullypay.xyz', hub: ['pay', 'x402'] },
    { product: 'Gully Pay', text: 'Admin at admin.gullypay.xyz; mobile apps', url: 'https://gullypay.xyz', tag: 'in progress' },
    { product: 'HolderMaps', text: 'Standalone app with the new design', url: 'https://holdermaps.xyz', hub: ['holders'] },
    { product: 'Gully AI', text: 'gullyai.xyz with docs; the API at ai.gullylabs.xyz/v1 opens with the GPU box', url: 'https://gullyai.xyz', hub: ['gullyai'] },
    { product: 'Gully Studio', text: 'gullystudio.xyz, plus dev, docs and admin portals', url: 'https://gullystudio.xyz', hub: ['studio'] },
  ]
}

export function WhatsNew() {
  const { hub } = useLive()
  return (
    <div className="wn card" data-testid="whats-new">
      <div className="ch">
        <span className="lab cy">New since the last update</span>
      </div>
      <ul>
        {whatsNew(hub).map((n) => (
          <li key={n.text}>
            <a href={n.url} target="_blank" rel="noopener noreferrer">
              <b>{n.product}</b>
              <span>{n.text}</span>
              {n.hub ? <Dot s={stateOf(hub, n.hub)} /> : <span className="lxs coming">{n.tag}</span>}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The Gully Labs App's launcher: the grid and the live board, with its own live provider (the app has no site Layout). */
export function AppLauncher({ cols = 3 }: { cols?: 3 | 4 }) {
  return (
    <LiveProvider>
      <div className="lc lxapp">
        <LaunchGrid cols={cols} />
        <HubBoard />
      </div>
    </LiveProvider>
  )
}
