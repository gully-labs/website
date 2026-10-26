/* Live data for every lab-console surface, read once for the whole site (one provider in Layout):
   /api/stats every 30 s, the Gully Chain testnet RPC every 8 s, /api/status and /api/plans every 60 s.
   Nothing is invented: a source that cannot be read is null and shown as unreadable. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchStats, type Stats, type VenueOk } from '../lib/stats'
import type { StatusBody } from '../lib/status'
import { C, fmtDay, fmtTime, fmtUsd } from './charts'
import { consoleToast } from './toast'

export const GULLY_CHAIN_ID = 485590
export const GULLY_RPC = 'https://testnet-rpc.gullychain.xyz'
export const NAMES: Record<string, string> = { deepcore: 'DeepCore', peddleswap: 'PeddleSwap', peddles: 'Peddles', peddlequest: 'PeddleQuest', gullychain: 'Gully Chain' }

export interface Block {
  number: number
  txs: number
  time: number
  gas: number
}
export interface ChainRead {
  head: number
  blocks: Block[]
}
export interface Live {
  stats: Stats | null
  statsState: 'loading' | 'ok' | 'error'
  status: StatusBody | null
  payChains: number | null
  chain: ChainRead | null
  chainState: 'loading' | 'ok' | 'error'
  rpcMs: number[]
  /** Gully Studio: Frog Hop's latest season on the GullyArcade contract (Gully Chain testnet), and its player counts read so far. */
  arcade: { season: number; players: number; history: number[] } | null
  /** Gully Pay's and Gully RPC's own public status, read by our server (GET /api/products/status). */
  products: ProductsStatus | null
  /** Gully IPFS: pinned CIDs, repo size and gateway health (GET /api/ipfs/stats). */
  ipfs: IpfsStats | null
  /** Everything live across Gully (GET /api/hub): surface probes, Gully Quests, x402 networks, the RPC gateway, the status page. */
  hub: HubBody | null
}
export interface HubService {
  key: string
  group: 'chain' | 'labs'
  name: string
  url: string
  up: boolean
  /** 'coming' is a surface still being set up that has not answered 200 yet (never shown as down). Older answers lack it. */
  state?: 'up' | 'down' | 'coming'
  code?: number | null
  ms: number | null
  history: { t: string; ms: number | null }[]
}
/** A surface's state, for answers from before `state` existed too. */
export const hubState = (s: HubService | undefined): 'up' | 'down' | 'coming' | 'reading' => (!s ? 'reading' : (s.state ?? (s.up ? 'up' : 'down')))
export interface HubQuest {
  id: string
  title: string
  state: string
  kind: string | null
  completions: number
  max: number
  spotsLeft: number | null
  rewardEth: number | null
  endsAt: string | null
}
export interface HubBody {
  generatedAt: string
  services: HubService[]
  chain: { chainId: number; head: number; at: string | null; source: string } | null
  quests: {
    source: 'indexer' | 'chain'
    registry: string
    total: number
    active: number | null
    completions: number | null
    completions24h: number | null
    poolEth: number | null
    paidEth: number | null
    hourly: number[]
    quests: HubQuest[]
    recent: { questId: string; title: string | null; who: string; at: string | null; rewardEth: number | null }[]
  } | null
  x402: { networks: { id: string; name: string; chainId: number | null; testnet: boolean }[]; assets: string[]; schemes: string[]; gullyChain: boolean } | null
  gateway: { networks: { alias: string; chainId: number | null; state: string; blockTimeMs: number | null }[]; ok: number; total: number; gullyChain: boolean } | null
  statusPage: { overall: 'ok' | 'warn' | 'bad' | null; services: { name: string; state: string }[]; up: number; total: number } | null
}
type Hist = { t: string; v: number | null }[]
export interface ProductsStatus {
  pay: { up: number; total: number; status: string | null; history: Hist } | null
  rpc: { served: number; total: number; gullyChain: boolean; history: Hist } | null
}
export interface IpfsStats {
  source: string
  gatewayUp: boolean | null
  gatewayMs: number | null
  pinned: number | null
  repoBytes: number | null
  history: { t: string; pinned: number | null; repoBytes: number | null; up: boolean; ms: number | null }[]
}

const empty: Live = { stats: null, statsState: 'loading', status: null, payChains: null, chain: null, chainState: 'loading', rpcMs: [], arcade: null, products: null, ipfs: null, hub: null }
const Ctx = createContext<Live>(empty)
export const useLive = () => useContext(Ctx)

// /api/status runs on the production server only; the dev server reads the live one (CORS is open).
const STATUS_URL = import.meta.env.DEV ? 'https://gullylabs.xyz/api/status' : '/api/status'

async function rpc(calls: { method: string; params: unknown[] }[]) {
  const r = await fetch(GULLY_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, ...c }))) })
  if (!r.ok) throw new Error(String(r.status))
  const j = (await r.json()) as { id: number; result: unknown }[]
  return [...j].sort((a, b) => a.id - b.id).map((x) => x.result)
}
const hex = (h: string) => parseInt(h, 16)

// GullyArcade on the Gully Chain testnet (the contract gullystudio.xyz reads): latestSeasonOf(uint256), season(uint256).
const ARCADE = '0xe573789b235314661DEdDA08a18Ca261c069c872'
const FROG_HOP = 1
const word = (data: string, i: number) => '0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64)
const arg = (n: number) => n.toString(16).padStart(64, '0')
async function fetchArcade(): Promise<{ season: number; players: number } | null> {
  const [latest] = (await rpc([{ method: 'eth_call', params: [{ to: ARCADE, data: '0x0e48b19a' + arg(FROG_HOP) }, 'latest'] }])) as string[]
  const id = latest ? Number(BigInt(latest)) : 0
  if (!id) return null
  const [s] = (await rpc([{ method: 'eth_call', params: [{ to: ARCADE, data: '0x8371b1c5' + arg(id) }, 'latest'] }])) as string[]
  if (!s || s.length < 2 + 7 * 64) return null
  return { season: id, players: Number(BigInt(word(s, 6))) }
}

/** The newest `n` blocks, oldest first; `known` caches blocks between reads. */
async function fetchBlocks(n: number, known: Map<number, Block>): Promise<ChainRead> {
  const [head] = (await rpc([{ method: 'eth_blockNumber', params: [] }])) as string[]
  const h = hex(head)
  const want: number[] = []
  for (let b = Math.max(0, h - n + 1); b <= h; b++) if (!known.has(b)) want.push(b)
  if (want.length) {
    const res = (await rpc(want.map((b) => ({ method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] })))) as ({ transactions: unknown[]; timestamp: string; gasUsed: string } | null)[]
    res.forEach((blk, i) => blk && known.set(want[i], { number: want[i], txs: blk.transactions.length, time: hex(blk.timestamp), gas: hex(blk.gasUsed) }))
  }
  for (const k of [...known.keys()]) if (k < h - n + 1) known.delete(k)
  return { head: h, blocks: [...known.values()].sort((a, b) => a.number - b.number) }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<Live>(empty)
  const known = useRef(new Map<number, Block>())
  const lastHead = useRef<number | null>(null)
  const lastGen = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    const set = (p: Partial<Live> | ((l: Live) => Partial<Live>)) => alive && setLive((l) => ({ ...l, ...(typeof p === 'function' ? p(l) : p) }))
    const pollStats = async () => {
      try {
        const s = await fetchStats()
        if (lastGen.current && s.generatedAt !== lastGen.current) consoleToast({ title: 'Venue figures refreshed', text: `${s.venues.filter((v) => v.state === 'ok').length} venues read at ${fmtTime(s.generatedAt)}`, icon: 'activity' })
        lastGen.current = s.generatedAt
        set({ stats: s, statsState: 'ok' })
      } catch {
        set((l) => ({ statsState: l.stats ? 'ok' : 'error' }))
      }
    }
    const pollChain = async () => {
      try {
        const t0 = performance.now()
        const r = await fetchBlocks(40, known.current)
        const ms = Math.round(performance.now() - t0)
        const prev = lastHead.current
        if (prev !== null && r.head > prev) {
          const newest = r.blocks[r.blocks.length - 1]
          consoleToast({ title: `Gully Chain block ${r.head.toLocaleString('en-US')}`, text: `${newest?.txs ?? 0} transactions · ${r.head - prev} new block${r.head - prev > 1 ? 's' : ''} since the last read`, icon: 'blocks' })
        }
        lastHead.current = r.head
        set((l) => ({ chain: r, chainState: 'ok', rpcMs: [...l.rpcMs, ms].slice(-30) }))
      } catch {
        set((l) => ({ chainState: l.chain ? 'ok' : 'error' }))
      }
    }
    const pollExtras = async () => {
      try {
        const p = (await (await fetch('/api/plans', { cache: 'no-store' })).json()) as { chains?: unknown[] }
        set({ payChains: Array.isArray(p.chains) ? p.chains.length : null })
      } catch {
        set({ payChains: null })
      }
      try {
        const a = await fetchArcade()
        set((l) => ({ arcade: a ? { ...a, history: [...(l.arcade?.history ?? []), a.players].slice(-20) } : l.arcade }))
      } catch {
        /* the arcade figure stays as last read */
      }
      try {
        const r = await fetch('/api/products/status', { cache: 'no-store' })
        if (r.ok) set({ products: (await r.json()) as ProductsStatus })
      } catch {
        /* stays as last read */
      }
      try {
        const r = await fetch('/api/hub', { cache: 'no-store' })
        if (r.ok) {
          const h = (await r.json()) as HubBody
          if (Array.isArray(h?.services)) set({ hub: h })
        }
      } catch {
        /* stays as last read */
      }
      try {
        const r = await fetch('/api/ipfs/stats', { cache: 'no-store' })
        if (r.ok) set({ ipfs: (await r.json()) as IpfsStats })
      } catch {
        /* stays as last read */
      }
      try {
        const st = (await (await fetch(STATUS_URL, { cache: 'no-store' })).json()) as StatusBody
        if (Array.isArray(st?.components)) set({ status: st })
      } catch {
        /* status stays as last read */
      }
    }
    void pollStats()
    void pollChain()
    void pollExtras()
    const a = setInterval(pollStats, 30_000), b = setInterval(pollChain, 8_000), c = setInterval(pollExtras, 60_000)
    const vis = () => {
      if (!document.hidden) {
        void pollStats()
        void pollChain()
      }
    }
    document.addEventListener('visibilitychange', vis)
    return () => {
      alive = false
      clearInterval(a)
      clearInterval(b)
      clearInterval(c)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  return <Ctx.Provider value={live}>{children}</Ctx.Provider>
}

/** The Gully Chain testnet head: this browser's own RPC read, else the indexer's (via /api/hub) when the RPC cannot be read. */
export const chainHead = (l: Live): number | null => l.chain?.head ?? l.hub?.chain?.head ?? null
export const chainHeadSource = (l: Live) => (l.chain ? 'testnet RPC' : l.hub?.chain ? 'indexer' : null)

/* ---------- derived series ---------- */
export type Metric = 'tvl' | 'volume' | 'fees'
export const okVenues = (s: Stats) => s.venues.filter((v): v is VenueOk => v.state === 'ok')
/** Venues with dollar figures: Gully Chain testnet reports test ETH only, so it is never drawn in a dollar chart. */
const usdVenues = (s: Stats) => okVenues(s).filter((v) => !v.noUsd)

/** Per-venue series of a metric over the last `days`, on one day axis (null where a venue has no point). */
export function venueSeries(stats: Stats, metric: Metric, days = 30) {
  const ok = usdVenues(stats)
  const all = new Set<number>()
  ok.forEach((v) => (v.series?.[metric] || []).forEach((p) => all.add(p.t)))
  const axis = [...all].sort((a, b) => a - b).slice(-days)
  return {
    axis,
    labels: axis.map(fmtDay),
    series: ok.map((v, i) => {
      const m = new Map((v.series?.[metric] || []).map((p) => [p.t, p.v]))
      return { key: v.key, name: NAMES[v.key] || v.key, color: C.s[i % 4], values: axis.map((t) => (m.has(t) ? (m.get(t) as number) : null)) }
    }),
  }
}
export function summed(stats: Stats, metric: Metric, days = 30) {
  const vs = venueSeries(stats, metric, days)
  return vs.axis.map((_, i) => vs.series.reduce((a, se) => a + (se.values[i] ?? 0), 0))
}
export const totalOf = (s: Stats, m: Metric) => (m === 'tvl' ? s.totals.tvlUsd : m === 'volume' ? s.totals.volumeAllUsd : s.totals.feesAllUsd)
export const coversOf = (s: Stats, m: Metric) => s.totals.covers[m === 'tvl' ? 'tvlUsd' : m === 'volume' ? 'volumeAllUsd' : 'feesAllUsd'] || []

/* ---------- ticker items: never blank ---------- */
export interface TapeItem {
  icon: 'coins' | 'activity' | 'blocks' | 'wallet' | 'server'
  k: string
  text: string
  v?: string
}
const TAPE_KEY = 'gl-tape-v1'
/** Before the first read: the last items this browser saw (marked as earlier), else what each source is. */
function seed(): TapeItem[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TAPE_KEY) || 'null') as TapeItem[] | null
    if (Array.isArray(saved) && saved.length) return saved.map((it) => ({ ...it, text: `${it.text} (last visit)` }))
  } catch {
    /* storage blocked */
  }
  return [
    { icon: 'blocks', k: 'Gully Chain', text: `testnet · chain ${GULLY_CHAIN_ID} · reading the newest blocks` },
    { icon: 'coins', k: 'Venues', text: 'DeepCore, PeddleSwap, Peddles, PeddleQuest, Gully Chain · reading value locked' },
    { icon: 'activity', k: 'Gully Quests', text: 'reading quests on chain 485590' },
    { icon: 'server', k: 'Gully RPC', text: 'measuring testnet latency' },
    { icon: 'wallet', k: 'Gully Pay', text: 'reading payment chains' },
  ]
}
export function tapeItems(l: Live): TapeItem[] {
  const items: TapeItem[] = []
  if (l.stats)
    for (const v of l.stats.venues)
      items.push(
        v.state !== 'ok'
          ? { icon: 'activity', k: NAMES[v.key] || v.key, text: 'could not be read' }
          : v.noUsd
            ? { icon: 'coins', k: NAMES[v.key] || v.key, text: 'launches on testnet', v: v.counts?.launches == null ? '—' : String(v.counts.launches) }
            : { icon: 'coins', k: NAMES[v.key] || v.key, text: 'value locked', v: fmtUsd(v.tvlUsd) },
      )
  const q = l.hub?.quests
  if (q) items.push({ icon: 'activity', k: 'Gully Quests', text: `${q.active ?? q.total} live quests · completions`, v: q.completions == null ? '—' : String(q.completions) })
  if (l.hub?.x402) items.push({ icon: 'wallet', k: 'Gully Pay x402', text: 'networks', v: String(l.hub.x402.networks.length) })
  for (const b of (l.chain?.blocks ?? []).slice(-6).reverse()) items.push({ icon: 'blocks', k: 'Gully Chain', text: `block ${b.number.toLocaleString('en-US')}`, v: `${b.txs} tx` })
  if (!l.chain && l.hub?.chain) items.push({ icon: 'blocks', k: 'Gully Chain', text: 'latest block · indexer', v: l.hub.chain.head.toLocaleString('en-US') })
  if (l.stats?.totals?.feesAllUsd != null) items.push({ icon: 'wallet', k: 'Fees', text: 'all-time across venues', v: fmtUsd(l.stats.totals.feesAllUsd) })
  if (l.rpcMs.length) items.push({ icon: 'server', k: 'Gully RPC', text: 'testnet latency', v: `${l.rpcMs[l.rpcMs.length - 1]} ms` })
  if (!items.length) return seed()
  try {
    localStorage.setItem(TAPE_KEY, JSON.stringify(items.slice(0, 12)))
  } catch {
    /* storage blocked */
  }
  return items
}
