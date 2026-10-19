import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Check, ChevronDown, Copy, Download, ExternalLink, Info, Lock, Maximize2, Minus, Pause, Play, Plus, Search, Share2, SkipForward } from 'lucide-react'
import { Link } from 'react-router'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { useReducedMotion } from '../charts/chart-utils'
import { alpha } from '../charts/chartPresets'
import { ChartEmpty } from '../charts/GhostChart'
import { MiniSpark } from '../charts/MiniSpark'
import { Segmented, type SegOption } from '../ui/Segmented'
import { Mascot } from '../brand'
import { TokenLogo } from '../logos/TokenLogo'
import { copyWithToast } from '../ui/toast'
import { newTab } from '../LayoutNav'
import { feeText, jupiterFeeText } from '../swap/swapConfig'
import { xPost } from '../../lib/share'
import { ageText } from '../../lib/tracker'
import { getJson, holdersCardUrl, holdersCsvUrl, holdersPagePath, holdersPath, INFRA_KINDS, useHolderMap, type HealthPartId, type HolderFrame, type HolderLabelKind, type HolderMapOk, type HolderNode, type WalletDetail } from '../../lib/holders'
import { APP_URL, isLocalHost } from '../../site-host'
import { useLive } from './live'
import { AskExplain, CrossTokenCard, DeployerHistoryCard, HealthCard, LivePill } from './parts'
import { extentOf, forceLayout, radiusFor } from './layout'
import { fmtPct, norm } from './format'
import { K } from './theme'
import { bandOf, BAND_HUES, BAND_STEPS, clusterHue, KIND_HUE, KIND_WORD, shade, textOn, WALLET_HUE, type KindKey } from './palette'
import { Sphere, SupplyStrip } from './SupplyStrip'
import { isInfraNode, kindKeyOf } from './supply'
import { agoText, captionOf, flowText, glyphOf, sideColour, toFlow, type FlowEvent, type MotionMap, type RecentFlow } from './motion'
import type { BLink, BNode, BTip, BubbleHandle } from './BubbleCanvas'
import './holders.css'

/* The Holder Map (Gully Labs): who holds a token, drawn as bubbles sized by share, with the wallets that
   sent each other tokens linked and their clusters lit in kit gold. Every figure is the server's
   (server/holders.mjs); nothing here computes a share, a cluster or a warning.

   Layout: the map comes first. On a wide screen it takes about 70% of the first screen with a compact side
   panel (score ring, verdict, live figures, the wallet you picked); on a phone it comes first at about 60%
   of the screen height with the details below.

   Motion (BubbleCanvas, its own lazy chunk): bubbles grow out of the centre, where the token sits, and
   settle; then they breathe and drift, pools and locks pulse, and links carry particles, so the map is never
   frozen. On first view the replay plays from launch to now (skippable) and the latest real transfers
   stream across as particles (gold buys, red sells) with a ticker naming each; the live poll does the same
   for every new transfer. Under reduced motion all of it falls back to fades with the same information. */

const BubbleCanvas = lazy(() => import('./BubbleCanvas'))

const INFRA = new Set<HolderLabelKind>(INFRA_KINDS)
const isInfra = (n: HolderNode) => !!n.label && INFRA.has(n.label.kind)
const FLAG_TEXT: Record<string, string> = {
  bundled: 'Bundled at launch',
  deployer: 'Deployer',
  'funded-by-deployer': 'Funded by deployer',
  sniper: 'Sniper (first blocks)',
}
const flagText = (f: string) => FLAG_TEXT[f] ?? f

const fmtUsd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const fmtUnits = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString('en-US', { maximumFractionDigits: 4 }))
const PCT = { maximumFractionDigits: 2 } as const
const VIEWS: SegOption<'map' | 'list'>[] = [
  { id: 'map', label: 'Map' },
  { id: 'list', label: 'List' },
]
const SPEEDS: SegOption<'1' | '4'>[] = [
  { id: '1', label: '1×' },
  { id: '4', label: '4×' },
]
/** Replayed transfers on load: at most this many, so a busy token's intro stays short. */
const REPLAY_MAX = 12
const TOAST_MS = 4_600

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Below 390 px wide the ranked list is the default view (the map stays one tap away). */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 389px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 389px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** True once the element has been on screen (the intro waits for it). */
function useSeen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

export interface HolderMapProps {
  chain: string
  token: string
  /** Shorter box and fewer words (Telegram Mini App, side columns). */
  compact?: boolean
  /** Embedded on another site: trades and shares open gullylabs.xyz. */
  embed?: boolean
  /** Where Buy / Sell goes: '#swap' on a stock page; null hides it. Launches go to DeepCore's swap by default. */
  tradeHref?: string | null
  onTrade?: () => void
  /** The map's own page: the title is the page's h1, live mode runs, the map takes the first screen. */
  page?: boolean
}

export function HolderMap({ chain, token, compact = false, embed = false, tradeHref, onTrade, page = false }: HolderMapProps) {
  const load = useHolderMap(chain, token)
  if (load.k === 'loading') return <MapSkeleton compact={compact} page={page} />
  if (load.k === 'error') return <MapEmpty title="The Holder Map could not be read" text="The map did not answer just now. It retries every few minutes." />
  const m = load.data
  if (m.state !== 'ok') {
    const chainName = m.chain?.name ?? 'this chain'
    return (
      <MapEmpty
        title={
          m.state === 'not-found'
            ? 'This address is not a token we can map'
            : m.state === 'unavailable'
              ? m.comingSoon
                ? `Token maps on ${chainName} are coming soon`
                : typeof m.progress === 'number'
                  ? 'Reading this token’s history'
                  : 'This token cannot be mapped right now'
              : m.state === 'error'
                ? 'The Holder Map could not check this token'
                : 'The Holder Map is busy'
        }
        text={m.comingSoon ? `Maps for tokens on ${chainName} are on the way. DeepCore launches already have live maps you can open now.` : m.reason}
        action={
          m.state === 'busy'
            ? undefined
            : {
                label: 'See tokens with a live map',
                href: '/holders',
                external: embed,
              }
        }
      />
    )
  }
  return <MapView m={m} compact={compact} embed={embed} tradeHref={tradeHref} onTrade={onTrade} page={page} />
}

/* ---------- loading and empty states (animated, never dead) ---------- */

const mapHeight = (page: boolean, compact: boolean, wide: boolean) => (compact ? 340 : page ? (wide ? 'clamp(440px, calc(100svh - 236px), 780px)' : 'clamp(360px, 60svh, 620px)') : wide ? 540 : 'clamp(340px, 60svh, 520px)')

function MapSkeleton({ compact, page = false }: { compact: boolean; page?: boolean }) {
  return (
    <div role="status" aria-label="Reading who holds this token" className="card card-pad flex flex-col gap-3">
      <div className="h-[14px] w-[160px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-full bg-surface" />
      <div
        className="relative grid place-items-center overflow-hidden rounded-[10px] bg-surface-deep"
        style={{
          height: mapHeight(page, compact, typeof window !== 'undefined' && window.innerWidth >= 1000),
        }}
      >
        {[64, 40, 28, 22, 16].map((s, i) => (
          <span
            key={s}
            className="absolute animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-full border border-line-strong"
            style={{
              width: s * 2,
              height: s * 2,
              left: `${[46, 30, 62, 38, 58][i]}%`,
              top: `${[40, 58, 30, 26, 64][i]}%`,
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function MapEmpty({ title, text, action }: { title: string; text: string; action?: { label: string; href: string; external?: boolean } }) {
  return (
    <div className="card card-pad flex flex-col gap-3" data-holder-map="empty">
      <div className="flex items-center gap-3">
        <span className="relative inline-flex size-3 flex-none">
          <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
          <span className="relative size-3 rounded-full bg-gold" />
        </span>
        <h3 className="heading-4 text-ink">{title}</h3>
      </div>
      <p className="m-0 max-w-[640px] text-[14px] leading-[1.6] text-muted">{text}</p>
      <ChartEmpty height={140} label="Bubbles will draw here once holder data can be read" testId="holder-map-ghost" />
      {action &&
        (action.external ? (
          <a href={`https://gullylabs.xyz${action.href}`} {...newTab} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-btn border border-line-strong px-4 font-mono text-[13px] text-ink transition-colors hover:border-gold">
            {action.label} <ExternalLink aria-hidden size={14} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <Link to={action.href} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-btn border border-line-strong px-4 font-mono text-[13px] text-ink transition-colors hover:border-gold">
            <Search aria-hidden size={14} /> {action.label} →
          </Link>
        ))}
      <BrandFoot />
    </div>
  )
}

function BrandFoot() {
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
      <Mascot size={18} decorative /> HOLDER MAP · GULLY LABS
    </span>
  )
}

/* ---------- the map ---------- */

interface Toast {
  key: string
  text: string
  side: FlowEvent['side']
  at: string | null
  origin: FlowEvent['origin']
}

function MapView({ m: m0, compact, embed, tradeHref, onTrade, page }: { m: HolderMapOk; compact: boolean; embed: boolean; tradeHref?: string | null; onTrade?: () => void; page: boolean }) {
  const m = m0 as MotionMap
  const reduced = useReducedMotion()
  const now = useNow(page ? 5_000 : 30_000)
  const [rootRef, rootWidth] = useWidth<HTMLDivElement>()
  const [stageRef, seen] = useSeen<HTMLDivElement>()
  const canvas = useRef<BubbleHandle | null>(null)
  const [peopleOnly, setPeopleOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 4>(1)
  const [query, setQuery] = useState('')
  const [searchMiss, setSearchMiss] = useState(false)
  const narrow = useNarrow()
  const [view, setView] = useState<'map' | 'list' | null>(null)
  const shownView = view ?? (narrow ? 'list' : 'map')
  const [zoomed, setZoomed] = useState(false)
  const [highlight, setHighlight] = useState<{
    id: HealthPartId
    wallets: Set<string>
  } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  // The intro: 'wait' until the map is on screen, 'play' while the replay and the latest transfers run, then 'done'.
  const [intro, setIntro] = useState<'wait' | 'play' | 'done'>('wait')
  const introTimers = useRef<number[]>([])
  const wide = !compact && rootWidth >= 1000

  const graphAll = useMemo(() => m.nodes.slice(0, m.holders.graph), [m])
  const graph = useMemo(() => (peopleOnly ? graphAll.filter((n) => !isInfra(n)) : graphAll), [graphAll, peopleOnly])
  const byId = useMemo(() => new Map(m.nodes.map((n) => [n.id, n])), [m])
  const frames = useMemo(() => m.timeline?.frames ?? [], [m])
  const idxOf = useMemo(() => new Map(graphAll.map((n, i) => [n.id, i])), [graphAll])
  const recent = useMemo(() => (m.recentFlows ?? []).slice(-REPLAY_MAX), [m])

  // Flows: to the canvas (particles) and to the ticker (a line each, newest on top, three at most).
  const flowSeq = useRef(0)
  const emit = useCallback(
    (list: RecentFlow[], origin: FlowEvent['origin'], gap = 260) => {
      list.forEach((f, i) => {
        const e = toFlow(f, byId, origin, `${origin}-${flowSeq.current++}`)
        canvas.current?.flow(e, i * gap)
        const t = window.setTimeout(
          () => {
            setToasts((ts) =>
              [
                {
                  key: e.key,
                  text: flowText(e, m.token.symbol, byId),
                  side: e.side,
                  at: e.at,
                  origin,
                },
                ...ts,
              ].slice(0, 3),
            )
            window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== e.key)), TOAST_MS)
          },
          i * gap + 120,
        )
        introTimers.current.push(t)
      })
    },
    [byId, m.token.symbol],
  )
  const live = useLive(m, page && !embed, (fl) => emit(fl, 'live', 320))
  const pctAt = (n: HolderNode) => (frame === null ? (live.pcts.get(n.id) ?? n.pct) : (frames[frame]?.pcts[idxOf.get(n.id) ?? -1] ?? 0))
  const maxPct = useMemo(() => Math.max(0.0001, ...graphAll.map((n) => n.pct ?? 0), ...frames.flatMap((f) => f.pcts)), [graphAll, frames])

  // Hidden links: two mapped wallets joined through an address that is not on the map, drawn as a small hollow node.
  const vias = useMemo(() => {
    const on = new Set(graph.map((n) => n.id))
    return (m.hidden ?? []).filter((h) => on.has(h.connects[0]) && on.has(h.connects[1]))
  }, [m, graph])
  const viaSet = useMemo(() => new Set(vias.map((v) => norm(v.via))), [vias])
  const links = useMemo(() => {
    const on = new Set([...graph.map((n) => n.id), ...viaSet])
    return m.links.filter((l) => on.has(norm(l.source)) && on.has(norm(l.target)))
  }, [m, graph, viaSet])
  const placed = useMemo(
    () =>
      forceLayout(
        [...graph.map((n) => ({ id: n.id, r: radiusFor(n.pct, maxPct) })), ...vias.map((v) => ({ id: norm(v.via), r: 3 }))],
        links.map((l) => ({ source: norm(l.source), target: norm(l.target) })),
      ),
    [graph, vias, links, maxPct],
  )
  const pos = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed])

  // Colour with meaning (palette.ts): a hue per cluster (gold for the biggest), a family per kind of
  // infrastructure, slate for people in no cluster; maps without links colour people by size band instead.
  const noLinks = m.links.length === 0
  const clusterIdx = useMemo(() => new Map(m.clusters.map((c, i) => [c.id, i])), [m])
  const top10 = useMemo(
    () =>
      new Set(
        m.nodes
          .filter((n) => !isInfraNode(n))
          .slice(0, 10)
          .map((n) => n.id),
      ),
    [m],
  )
  const hueOf = useCallback(
    (n: HolderNode, pct: number | null) => {
      const kind = kindKeyOf(n)
      if (kind && (isInfraNode(n) || kind === 'deployer')) return KIND_HUE[kind]
      if (n.cluster && clusterIdx.has(n.cluster)) return clusterHue(clusterIdx.get(n.cluster) ?? 0)
      return noLinks ? BAND_HUES[bandOf(pct)] : WALLET_HUE
    },
    [clusterIdx, noLinks],
  )

  // The canvas's bubbles: positions from the layout, sizes from the share now (or at the replay frame).
  // A phone's box is taller than wide, so the (wide) layout is turned on its side there.
  const portrait = !wide && rootWidth > 0 && rootWidth < 600
  // A wide strip (the embed's 1,400 x 340): stretch the layout sideways to the box's shape so the bubbles fill it.
  // Only x grows, so no two bubbles can end up closer than the layout left them.
  const stripH = compact ? 340 : 0
  const stretch = useMemo(() => {
    if (!stripH || portrait || rootWidth <= 0 || placed.length < 2) return 1
    const e = extentOf(placed)
    const layoutAspect = (e.x1 - e.x0) / Math.max(1, e.y1 - e.y0)
    return Math.max(1, Math.min(3.2, rootWidth / stripH / layoutAspect))
  }, [stripH, portrait, rootWidth, placed])
  const bnodes = useMemo<BNode[]>(() => {
    const out: BNode[] = graph.map((n) => {
      const p = pos.get(n.id)
      const bundled = n.flags.includes('bundled')
      const infra = isInfra(n)
      const pct = pctAt(n)
      const hue = hueOf(n, pct)
      const kind = kindKeyOf(n)
      const top = top10.has(n.id)
      return {
        id: n.id,
        x: (portrait ? p?.y : (p?.x ?? 0) * stretch) ?? 0,
        y: (portrait ? p?.x : p?.y) ?? 0,
        r: radiusFor(pct, maxPct),
        fitR: p?.r,
        hue,
        rim: bundled ? K.warn : top ? shade(hue, 0.62) : shade(hue, 0.28),
        rimWidth: bundled ? 2.5 : top ? 2.6 : 1.2,
        dashed: bundled,
        glow: !!n.cluster && !infra,
        text: fmtPct(pct),
        textColour: textOn(hue),
        glyph: glyphOf(n),
        logo: n.label?.kind === 'token' && m.token.symbol ? `/api/logo/${m.chain.key}/${m.token.address}.png?s=64` : null,
        caption: captionOf(n),
        kindText: kind ? KIND_WORD[kind] : 'wallet',
        pulse: n.label?.kind === 'pool' || n.label?.kind === 'lock' || n.label?.kind === 'token',
        group: n.cluster && !infra ? `c:${n.cluster}` : null,
      }
    })
    for (const v of vias) {
      const p = pos.get(norm(v.via))
      out.push({
        id: norm(v.via),
        x: (portrait ? p?.y : (p?.x ?? 0) * stretch) ?? 0,
        y: (portrait ? p?.x : p?.y) ?? 0,
        r: 3,
        hue: K.night,
        rim: K.muted,
        rimWidth: 1.2,
        dashed: true,
        glow: false,
        text: null,
        textColour: K.bone,
        glyph: null,
        caption: null,
        kindText: 'link',
        pulse: false,
        group: null,
      })
    }
    return out
    // pctAt reads frame and live.pcts, listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, vias, pos, maxPct, frame, live.pcts, hueOf, top10, portrait, stretch, m.token, m.chain.key])
  const maxTransfers = useMemo(() => Math.max(1, ...links.map((x) => x.transfers)), [links])
  const blinks = useMemo<BLink[]>(
    () =>
      links.flatMap((l) => {
        const via = l.kind === 'via'
        const a = norm(l.source)
        const b = norm(l.target)
        const ca = byId.get(a)?.cluster
        const cb = byId.get(b)?.cluster
        const inCluster = ca && ca === cb && clusterIdx.has(ca)
        const base = {
          colour: via ? K.muted : l.kind === 'funding' ? K.pale : inCluster ? clusterHue(clusterIdx.get(ca) ?? 0) : K.gold,
          dashed: via || l.kind === 'funding',
          width: via ? 1 : Math.min(4, 1 + Math.log2(1 + l.transfers) * 0.6),
          particles: !via,
          strength: via ? 0.1 : Math.min(1, Math.log2(1 + l.transfers) / Math.log2(1 + maxTransfers)),
        }
        return l.direction === 'backward' ? [{ ...base, a: b, b: a }] : [{ ...base, a, b }]
      }),
    [links, byId, clusterIdx, maxTransfers],
  )
  const tip = useCallback(
    (id: string): BTip | null => {
      const v = vias.find((x) => norm(x.via) === id)
      if (v)
        return {
          title: `Linked via ${v.short}`,
          rows: [
            ['Joins', v.connects.map((c) => byId.get(c)?.short ?? c.slice(0, 8)).join(' + ')],
            ['Transfers', String(v.transfers)],
          ],
          note: 'An address that is not on the map passed tokens between these wallets.',
        }
      const n = byId.get(id)
      if (!n) return null
      return {
        title: n.label?.name ?? n.short,
        rows: [['Held', fmtPct(pctAt(n))], ['Kind', kindKeyOf(n) ? KIND_WORD[kindKeyOf(n) as KindKey] : 'wallet'], ['Rank', `#${n.rank}`], ...(n.label ? ([['Wallet', n.short]] as [string, string][]) : []), ...(n.cluster ? ([['Cluster', n.cluster.toUpperCase()]] as [string, string][]) : [])],
        note: n.flags.length ? n.flags.map(flagText).join(' · ') : undefined,
      }
    },
    // pctAt reads frame and live.pcts
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vias, byId, frame, live.pcts],
  )

  // ---- the intro: replay from launch to now, then (or instead) the latest transfers, once ----
  const stopIntro = useCallback(() => {
    if (intro === 'done') return
    for (const t of introTimers.current) clearTimeout(t)
    introTimers.current = []
    setIntro('done')
    setPlaying(false)
    setFrame(null)
  }, [intro])
  useEffect(() => {
    if (intro !== 'wait' || !seen || shownView !== 'map') return
    const start = window.setTimeout(() => {
      setIntro('play')
      // Under reduced motion the replay waits for play; the latest transfers still fade in, once.
      if (frames.length >= 2 && !reduced) {
        setFrame(0)
        setPlaying(true)
      } else {
        emit(recent, 'replay', 700)
        const end = window.setTimeout(() => setIntro('done'), recent.length * 700 + 1500)
        introTimers.current.push(end)
      }
    }, 1100)
    introTimers.current.push(start)
  }, [intro, seen, shownView, frames.length, recent, emit, reduced])
  useEffect(() => () => introTimers.current.forEach((t) => clearTimeout(t)), [])

  // Replay: play steps through the frames (1 s a frame, 4x, or the intro's quick pass), stopping on the last.
  useEffect(() => {
    if (!playing || !frames.length) return
    const id = window.setInterval(
      () =>
        setFrame((f) => {
          const next = f === null ? 0 : f + 1
          if (next >= frames.length) {
            setPlaying(false)
            if (intro === 'play') setIntro('done')
            return null
          }
          return next
        }),
      intro === 'play' ? 300 : speed === 4 ? 250 : 1000,
    )
    return () => clearInterval(id)
  }, [playing, speed, frames.length, intro])
  // While the replay runs, the transfers that happened in each step stream across the map.
  const lastFrame = useRef<number | null>(null)
  useEffect(() => {
    const prev = lastFrame.current
    lastFrame.current = frame
    if (!playing && intro !== 'play') return
    if (!recent.length) return
    const lo = frame === null ? (frames.at(-1)?.block ?? Infinity) : prev === null || frame === 0 ? -Infinity : (frames[prev]?.block ?? -Infinity)
    const hi = frame === null ? Infinity : (frames[frame]?.block ?? -Infinity)
    const step = recent.filter((f) => f.block > lo && f.block <= hi).slice(-4)
    if (step.length) emit(step, 'replay', 140)
    // emit only when the frame moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame])

  const sel = selected ? (byId.get(selected) ?? null) : null
  const ringed = useMemo(() => highlight?.wallets ?? null, [highlight])

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim().toLowerCase().replace(/…/g, '')
    if (!q) return
    stopIntro()
    const hit = m.nodes.find((n) => n.id.toLowerCase() === q) ?? m.nodes.find((n) => n.id.toLowerCase().startsWith(q) || n.short.toLowerCase().replace(/…/g, '').startsWith(q) || (n.label?.name ?? '').toLowerCase().includes(q))
    setSearchMiss(!hit)
    if (!hit) return
    if (peopleOnly && isInfra(hit)) setPeopleOnly(false)
    setSelected(hit.id)
    if (shownView === 'map') setTimeout(() => canvas.current?.flyTo(hit.id), 60)
  }

  const alertHref = `${isLocalHost() ? '/app' : APP_URL}/?alert=${encodeURIComponent(`holders:${m.chain.key}:${m.token.address}`)}#alerts`
  const label = `Holder Map of ${m.token.symbol ?? 'this token'} on ${m.chain.name}: ${m.summary.line} ${m.forensics?.riskLine ?? ''}`.trim()
  const pageUrl = `https://gullylabs.xyz${holdersPagePath(m.chain.key, m.token.address)}`
  const frameAt = frame !== null ? frames[frame] : null
  const Title = page ? 'h1' : 'h3'
  const top10Pct = live.top10Pct ?? m.summary.top10Pct
  const height = mapHeight(page, compact, wide)

  const onPart = (id: HealthPartId | null, wallets: string[]) => {
    stopIntro()
    setHighlight(id ? { id, wallets: new Set(wallets.map(norm)) } : null)
    if (id && peopleOnly) setPeopleOnly(false)
  }

  const controls = (
    <div className={`flex flex-wrap items-center gap-2 ${wide ? 'pointer-events-auto' : ''}`} data-map-controls>
      <form onSubmit={search} role="search" className="flex min-w-0 flex-[1_1_220px] items-center gap-2 rounded-btn border border-line-strong px-3" style={{ background: alpha(K.night, 0.92) }}>
        <Search size={14} aria-hidden className="flex-none text-dim" />
        <label className="sr-only" htmlFor={`hm-search-${m.token.address}`}>
          Find a wallet by address
        </label>
        <input
          id={`hm-search-${m.token.address}`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSearchMiss(false)
          }}
          placeholder="Find a wallet (0x…)"
          className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="min-h-11 px-1 font-mono text-[12px] text-gold">
          Find
        </button>
      </form>
      <button
        type="button"
        aria-pressed={peopleOnly}
        onClick={() => {
          stopIntro()
          setPeopleOnly((v) => !v)
        }}
        className={chip(peopleOnly)}
        style={{ background: alpha(K.night, 0.92) }}
      >
        {peopleOnly ? 'People only' : 'Showing contracts and pools'}
      </button>
      <Segmented
        label="View"
        value={shownView}
        options={VIEWS}
        onChange={(v) => {
          if (v === 'list') stopIntro()
          setView(v)
        }}
      />
    </div>
  )
  const notes = (
    <>
      {highlight && (
        <p role="status" className="pointer-events-auto m-0 flex w-fit flex-wrap items-center gap-2 rounded-btn border border-gold px-3 font-mono text-[12px] text-gold-hover" style={{ background: alpha(K.night, 0.92) }}>
          Showing the {highlight.wallets.size} wallet
          {highlight.wallets.size === 1 ? '' : 's'} behind “{m.health?.parts.find((p) => p.id === highlight.id)?.label}”.
          <button type="button" onClick={() => setHighlight(null)} className="min-h-11 px-1 text-muted underline-offset-4 hover:underline">
            Show all
          </button>
        </p>
      )}
      {searchMiss && (
        <p role="status" className="pointer-events-auto m-0 w-fit rounded-btn px-2 py-1 font-mono text-[12px] text-error" style={{ background: alpha(K.night, 0.92) }}>
          No mapped wallet matches that.
        </p>
      )}
    </>
  )
  const stopIntroKeep = () => {
    // A manual play or pause ends the intro but keeps the replay where it is.
    if (intro === 'done') return
    for (const t of introTimers.current) clearTimeout(t)
    introTimers.current = []
    setIntro('done')
  }
  const replay = <Replay m={m} frame={frame} frameAt={frameAt} setFrame={setFrame} playing={playing} setPlaying={(p) => (stopIntroKeep(), setPlaying(p))} speed={speed} setSpeed={setSpeed} intro={intro === 'play'} onSkip={stopIntro} recentCount={recent.length} overlay={wide && shownView === 'map'} />

  const stage =
    shownView === 'map' ? (
      <div ref={stageRef} className="relative overflow-hidden rounded-[12px] border border-line" style={{ background: K.night }} data-map-stage>
        <Suspense fallback={<div className="animate-[gl-skeleton_1.4s_ease-in-out_infinite] bg-surface-deep" style={{ height }} role="status" aria-label="Drawing the map" />}>
          <BubbleCanvas
            ref={canvas}
            nodes={bnodes}
            links={blinks}
            highlight={highlight?.wallets ?? null}
            ringed={ringed}
            selected={selected}
            reduced={reduced}
            label={label}
            height={height}
            tip={tip}
            onSelect={(id) => setSelected(id && byId.has(id) ? id : null)}
            onZoomed={setZoomed}
            padBottom={frames.length >= 2 ? undefined : 64}
            onInteract={stopIntro}
          />
        </Suspense>
        {wide && (
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
            {controls}
            {notes}
          </div>
        )}
        <div className={`absolute right-3 flex flex-col gap-1 ${wide ? 'top-[70px]' : 'top-3'}`} role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" onClick={() => canvas.current?.zoomBy(1.4)} className={zoomBtn} style={{ background: alpha(K.night, 0.92) }}>
            <Plus size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => canvas.current?.zoomBy(1 / 1.4)} className={zoomBtn} style={{ background: alpha(K.night, 0.92) }}>
            <Minus size={15} aria-hidden />
          </button>
          {zoomed && (
            <button type="button" aria-label="Fit the whole map" onClick={() => canvas.current?.fit()} className={`${zoomBtn} animate-[gl-fade_.2s_ease_both]`} style={{ background: alpha(K.night, 0.92) }}>
              <Maximize2 size={14} aria-hidden />
            </button>
          )}
        </div>
        <Ticker toasts={toasts} now={now} wide={wide} />
        {wide && <div className="absolute inset-x-3 bottom-3">{replay}</div>}
        <span className={`pointer-events-none absolute right-3 font-mono text-[11px] tracking-[1px] text-dim ${wide ? 'bottom-[136px]' : 'bottom-2'}`}>{rootWidth < 600 ? 'PINCH OR DRAG' : 'CTRL + SCROLL TO ZOOM · DRAG TO PAN'}</span>
      </div>
    ) : (
      <RankedList m={m} selected={selected} onSelect={setSelected} />
    )

  const strip = <SupplyStrip m={m} pctAt={pctAt} selected={selected} onSelect={(id) => (setSelected(id), shownView === 'map' && canvas.current?.flyTo(id))} compact={compact} />

  const stats = (
    <div className="flex flex-col gap-3" data-live-stats>
      <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
        <Stat k="HOLDERS" v={<AnimatedNumber value={m.holders.count} countUp className="font-display text-[26px] leading-none font-bold text-ink" fallback="—" />} />
        <Stat k="TOP 10 HOLD" v={<AnimatedNumber value={top10Pct} countUp format={PCT} suffix="%" className="font-display text-[26px] leading-none font-bold text-ink" fallback="—" />} />
        <Stat
          k="TOP CLUSTER"
          v={
            m.summary.largestCluster ? <AnimatedNumber value={m.summary.largestCluster.pct} countUp format={PCT} suffix="%" className="font-display text-[26px] leading-none font-bold text-ink" fallback="—" /> : <span className="font-display text-[22px] leading-none font-bold text-muted">None</span>
          }
        />
      </dl>
      <div className="flex flex-col gap-2" data-holder-summary>
        <p className="m-0 font-display text-[19px] leading-[1.15] font-bold text-gold-hover">{m.summary.line}</p>
        {m.forensics && (
          <p
            className="m-0 rounded-[10px] border px-3 py-2 text-[13px] leading-[1.5]"
            style={{
              borderColor: m.forensics.bundled.wallets ? K.warn : K.slate,
              color: K.bone,
              background: K.night,
            }}
            data-risk-line
          >
            <b className="font-semibold">{m.forensics.bundled.wallets ? '⚠ ' : ''}Launch check:</b> {m.forensics.riskLine}
            {m.forensics.snipers && m.forensics.snipers.wallets > 0 && (
              <span className="text-muted">
                {' '}
                {m.forensics.snipers.wallets} wallet
                {m.forensics.snipers.wallets === 1 ? '' : 's'} bought in the first {m.forensics.snipers.blocks} blocks
                {m.forensics.snipers.pct !== null ? ` and hold ${fmtPct(m.forensics.snipers.pct)}` : ''}.
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  )
  const why = !compact && m.summary.plain.length > 0 && (
    <details className="group rounded-[12px] border border-line-strong" style={{ background: K.night }} data-why>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 font-mono text-[12px] tracking-[1px] text-muted hover:text-ink">
        WHY THIS SCORE · IN PLAIN WORDS
        <ChevronDown size={15} aria-hidden className="transition-transform group-open:rotate-180" />
      </summary>
      <ul className="m-0 flex list-none flex-col gap-1 px-4 pt-1 pb-4 text-[14px] leading-[1.55] text-muted">
        {m.summary.plain.map((t) => (
          <li key={t} className="flex gap-2 animate-[gl-fade_.3s_ease_both]">
            <span aria-hidden className="text-gold">
              +
            </span>
            {t}
          </li>
        ))}
      </ul>
    </details>
  )
  const side = (
    <div className="flex min-w-0 flex-col gap-3" data-side>
      {m.health ? (
        <HealthCard h={m.health} active={highlight?.id ?? null} onPart={onPart} compact>
          {stats}
        </HealthCard>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-line-strong p-4" style={{ background: K.night }}>
          {stats}
        </div>
      )}
      {sel && <Panel key={sel.id} n={sel} m={m} pct={pctAt(sel)} frames={frames} idx={idxOf.get(sel.id) ?? null} recent={m.recentFlows ?? []} onClose={() => setSelected(null)} onPick={(id) => (setSelected(id), shownView === 'map' && canvas.current?.flyTo(id))} />}
      {why}
      {m.deployerHistory && <DeployerHistoryCard d={m.deployerHistory} now={now} />}
      {m.crossToken && <CrossTokenCard x={m.crossToken} />}
      {!compact && !embed && (
        <div className="flex flex-col gap-2">
          <AskExplain m={m} />
          <a href={alertHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 self-start rounded-btn border border-line-strong px-4 font-mono text-[12px] text-muted hover:border-gold hover:text-ink" data-alert-me>
            <BellRing size={14} aria-hidden /> Alert me if the top cluster moves ↗
          </a>
        </div>
      )}
    </div>
  )

  return (
    <div ref={rootRef} className="card card-pad flex flex-col gap-3 text-ink max-[599px]:p-3" data-holder-map="ok">
      {/* One line: what this is, how fresh, live; the explainer sits behind (i). */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <Title className={`flex min-w-0 items-center gap-2 ${page ? 'heading-3 min-[600px]:heading-2' : 'heading-3'}`}>
            {m.token.symbol && <TokenLogo symbol={m.token.symbol} chain={m.chain.key} address={m.token.address} size={32} decorative className="max-[599px]:hidden" />}
            <span className="min-w-0">
              Who holds {m.token.symbol ?? 'this token'}
              <span className="text-muted max-[599px]:sr-only"> · {m.chain.name}</span>
            </span>
          </Title>
          <span className="flex flex-none items-center gap-2">
            <LivePill on={live.on} paused={live.paused} lastAt={live.lastAt} gated={m.features.gated} now={now} beat={live.beat} />
            <span className="max-[599px]:hidden">
              <Mascot size={compact ? 28 : 36} label="Gully Labs" />
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-mono text-[12px] text-dim">
            <span className="min-[600px]:hidden">{m.chain.name} · </span>
            {kindLabel(m)} · updated {ageText(m.asOf, now)}
            {m.holders.count !== null ? ` · ${m.holders.count.toLocaleString('en-US')} holders` : ''}
            <span className="max-[599px]:hidden"> · {m.holders.shown} listed</span>
            {m.stale ? ' · showing the last good read' : ''}
          </span>
          <InfoPop />
        </div>
        {m.coverage?.level === 'top' && (
          <p role="note" data-coverage="top" className="m-0 flex items-start gap-2 rounded-btn border border-line-strong px-3 py-2 text-[13px] leading-[1.5] text-muted" style={{ background: alpha(K.night, 0.92) }}>
            <Info size={14} aria-hidden className="mt-[3px] flex-none text-gold" />
            <span>
              <b className="font-semibold text-ink">
                Top holders only
                {m.coverage.shown ? ` (the biggest ${m.coverage.shown.toLocaleString('en-US')})` : ''}.
              </b>{' '}
              {m.coverage.reason ? `${m.coverage.reason[0].toUpperCase()}${m.coverage.reason.slice(1)}. ` : ''}
              Smaller wallets, and links between wallets outside the listed ones, are not shown. Shares are of {m.holders.sharesOf}.
            </span>
          </p>
        )}
      </div>

      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,30%)] items-start gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            {stage}
            {shownView === 'list' && (
              <>
                {controls}
                {notes}
                {replay}
              </>
            )}
            <Legend m={m} noLinks={noLinks} clusterIdx={clusterIdx} />
            {strip}
            <RankedList m={m} selected={selected} onSelect={setSelected} srOnly />
          </div>
          {side}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stage}
          {controls}
          {notes}
          {replay}
          <Legend m={m} noLinks={noLinks} clusterIdx={clusterIdx} />
          {strip}
          <RankedList m={m} selected={selected} onSelect={setSelected} srOnly />
          {side}
        </div>
      )}

      {m.fair && !compact && <FairBlock m={m} />}

      {/* Trade, with the warning directly above it */}
      <Trade m={m} embed={embed} tradeHref={tradeHref} onTrade={onTrade} pageUrl={pageUrl} />

      <Share m={m} pageUrl={pageUrl} embed={embed} />
      <p className="m-0 font-mono text-[11px] leading-[1.6] text-dim">
        Sources: {[m.sources.holders, m.sources.links, m.sources.note].filter(Boolean).join(' · ')}. Shares are of the {m.holders.sharesOf}
        {m.holders.partial ? ` (${m.holders.partial})` : ''}. Information only, not advice.
      </p>
    </div>
  )
}

const chip = (on: boolean) => `inline-flex min-h-11 items-center gap-1 rounded-btn border px-3 font-mono text-[12px] transition-colors ${on ? 'border-gold text-gold-hover' : 'border-line-strong text-muted hover:border-gold'}`
const zoomBtn = 'inline-flex size-11 items-center justify-center rounded-btn border border-line-strong text-muted transition-colors hover:border-gold hover:text-ink'

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-2 py-2.5 min-[600px]:px-3">
      <dt className="font-mono text-[11px] leading-[1.25] tracking-[0.5px] break-words text-dim">{k}</dt>
      <dd className="m-0">{v}</dd>
    </div>
  )
}

/** The page's explainer, one tap away instead of a paragraph above the map. */
function InfoPop() {
  const [open, setOpen] = useState<{ left: number; width: number } | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const toggle = () => {
    if (open) return setOpen(null)
    // Kept inside the viewport: shifted left when the button sits near the right edge.
    const r = box.current?.getBoundingClientRect()
    const width = Math.min(360, window.innerWidth - 32)
    setOpen({
      width,
      left: r ? Math.min(0, window.innerWidth - 16 - width - r.left) : 0,
    })
  }
  return (
    <span ref={box} className="relative -my-2.5 inline-flex">
      <button type="button" aria-expanded={!!open} aria-label="How to read the Holder Map" onClick={toggle} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-gold-hover">
        <Info size={17} aria-hidden />
      </button>
      {open && (
        <span
          role="dialog"
          aria-label="How to read the Holder Map"
          className="absolute top-full z-30 flex animate-[gl-fade_.2s_ease_both] flex-col gap-2 rounded-[10px] border border-line-strong p-3 text-[13px] leading-[1.55] text-muted"
          style={{ background: K.night, left: open.left, width: open.width }}
        >
          <span>
            Every bubble is a wallet, sized by how much of the token it holds. Wallets that sent the token to each other share a colour (gold for the biggest group), which often means one person or team behind many wallets. Grey-blue bubbles belong to no group; a bright rim marks the top 10.
          </span>
          <span>Pools, exchanges, locks, burn, contracts and the deployer have their own colour and icon. Moving dots are real transfers: gold for buys, red for sells. Read live; nothing on this page is typed in.</span>
        </span>
      )}
    </span>
  )
}

/** The flow ticker: one line per transfer as it streams across the map, newest on top. */
function Ticker({ toasts, now, wide }: { toasts: Toast[]; now: number; wide: boolean }) {
  return (
    <ol className={`pointer-events-none absolute left-3 m-0 flex max-w-[min(420px,calc(100%-80px))] list-none flex-col-reverse gap-1.5 p-0 ${wide ? 'bottom-[136px]' : 'bottom-8'}`} aria-live="polite" aria-label="Latest transfers" data-flow-ticker>
      {toasts.map((t) => (
        <li
          key={t.key}
          className="flex animate-[gl-toast-in_.3s_ease-out_both] items-center gap-2 rounded-[16px] border px-3 py-1 font-mono text-[12px] text-ink"
          style={{
            borderColor: sideColour(t.side),
            background: alpha(K.night, 0.94),
          }}
        >
          <span aria-hidden className="inline-block size-2 flex-none rounded-full" style={{ background: sideColour(t.side) }} />
          <span className="min-w-0 break-words">{t.text}</span>
          <span className="flex-none text-dim">· {t.origin === 'live' && !t.at ? 'just now' : agoText(t.at, now)}</span>
        </li>
      ))}
    </ol>
  )
}

/* ---------- legend ---------- */

function Legend({ m, noLinks, clusterIdx }: { m: HolderMapOk; noLinks: boolean; clusterIdx: Map<string, number> }) {
  const anyBundled = m.nodes.some((n) => n.flags.includes('bundled'))
  const anyContract = m.nodes.some((n) => !n.label && n.contract === true)
  const shown = m.clusters.slice(0, 4)
  const note = noLinks && (m.chain.key === 'solana' || m.coverage?.level === 'top')
  const li = 'flex items-center gap-1.5'
  return (
    <div className="flex flex-col gap-1.5" data-legend>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-muted" aria-label="Legend">
        {shown.map((c, i) => (
          <li key={c.id} className={li}>
            <Sphere hue={clusterHue(clusterIdx.get(c.id) ?? i)} size={12} /> {i === 0 ? 'Largest cluster' : `Cluster ${c.id.toUpperCase()}`}
          </li>
        ))}
        {m.clusters.length > shown.length && <li className={li}>+{m.clusters.length - shown.length} more clusters</li>}
        {noLinks ? (
          BAND_HUES.map((h, i) => (
            <li key={h + i} className={li}>
              <Sphere hue={h} size={12} /> {i === 0 ? `Over ${BAND_STEPS[0]}%` : i === 3 ? `Under ${BAND_STEPS[2]}%` : `${BAND_STEPS[i]}–${BAND_STEPS[i - 1]}%`}
            </li>
          ))
        ) : (
          <li className={li}>
            <Sphere hue={WALLET_HUE} size={12} /> Wallet, in no cluster
          </li>
        )}
        <li className={li}>
          <Sphere hue={WALLET_HUE} size={12} ring={shade(WALLET_HUE, 0.62)} /> Top-10 holder (bright rim)
        </li>
        {anyBundled && (
          <li className={li}>
            <span aria-hidden className="inline-block size-3 flex-none rounded-full" style={{ border: `1.5px dashed ${K.warn}` }} /> Bundled at launch
          </li>
        )}
        {m.legend.map((l) => (
          <li key={l.kind} className={li}>
            <Sphere hue={KIND_HUE[l.kind]} size={12} /> {l.text}
          </li>
        ))}
        {anyContract && (
          <li className={li}>
            <Sphere hue={KIND_HUE.contract} size={12} /> Contract
          </li>
        )}
        {m.links.length > 0 && (
          <li className={li}>
            <span aria-hidden className="inline-block h-[2px] w-4" style={{ background: K.gold }} /> Sent tokens to each other (stronger line, more transfers)
          </li>
        )}
      </ul>
      {note && (
        <p role="note" data-no-links className="m-0 font-mono text-[11px] leading-[1.5] text-dim">
          Links between wallets are not drawn on {m.chain.name} yet. Bubbles are coloured by what they are and sized by share; the colour bands show how big each holder is.
        </p>
      )}
    </div>
  )
}

/* ---------- replay ---------- */

function Replay({
  m,
  frame,
  frameAt,
  setFrame,
  playing,
  setPlaying,
  speed,
  setSpeed,
  intro,
  onSkip,
  recentCount,
  overlay,
}: {
  m: HolderMapOk
  frame: number | null
  frameAt: HolderFrame | null
  setFrame: (f: number | null) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  speed: 1 | 4
  setSpeed: (s: 1 | 4) => void
  /** The first-view pass is running: offer to skip it. */
  intro: boolean
  onSkip: () => void
  recentCount: number
  /** Drawn over the bottom of the map (wide screens). */
  overlay: boolean
}) {
  const frames = m.timeline?.frames ?? []
  const boxCls = `flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2 ${overlay ? 'backdrop-blur-[2px]' : ''}`
  const boxStyle = { background: alpha(K.night, overlay ? 0.9 : 1) }
  const skip = intro && (
    <button type="button" onClick={onSkip} className="inline-flex min-h-11 flex-none items-center gap-1.5 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-muted hover:border-gold hover:text-ink" data-skip-intro>
      <SkipForward size={13} aria-hidden /> Skip intro
    </button>
  )
  if (!m.timeline || frames.length < 2) {
    const locked = m.locked.includes('replay') && m.features.gated
    return (
      <div className={`${boxCls} flex-row flex-wrap items-center font-mono text-[12px] text-dim`} style={boxStyle} data-replay="off">
        {locked ? <Lock size={13} aria-hidden /> : null}
        <span className="min-w-0 flex-1">
          {intro && recentCount > 0 ? (
            <span className="text-gold-hover">
              Replaying the last {recentCount} transfer
              {recentCount === 1 ? '' : 's'}…
            </span>
          ) : locked ? (
            <>
              The history replay comes with Pro.{' '}
              <Link to="/pricing" className="text-gold underline-offset-4 hover:underline">
                See plans
              </Link>
            </>
          ) : (
            'History replay: not enough transfers yet to replay.'
          )}
        </span>
        {skip}
      </div>
    )
  }
  const last = frames.length // the slider's last stop is "now"
  const value = frame === null ? last : frame
  const when = frameAt ? (frameAt.at ? new Date(frameAt.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : `block ${frameAt.block.toLocaleString('en-US')}`) : 'now'
  return (
    <div className={boxCls} style={boxStyle} data-replay="on">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!playing && frame === null) setFrame(0)
            setPlaying(!playing)
          }}
          aria-label={playing ? 'Pause the replay' : 'Play the replay'}
          className="inline-flex size-11 flex-none items-center justify-center rounded-btn border border-gold text-gold-hover"
        >
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <Segmented label="Replay speed" value={speed === 4 ? '4' : '1'} options={SPEEDS} onChange={(v) => setSpeed(v === '4' ? 4 : 1)} />
        <span className="min-w-[190px] flex-1 font-mono text-[12px] text-muted" aria-live="polite">
          {frameAt ? `${when} · top 10 held ${fmtPct(frameAt.top10Pct)}${frameAt.holders !== null ? ` · ${frameAt.holders} holders` : ''}` : `Now · top 10 hold ${fmtPct(m.summary.top10Pct)}`}
        </span>
        {skip}
      </div>
      <label className="flex items-center gap-3 font-mono text-[11px] text-dim">
        <span className="flex-none">{intro ? 'Launch' : 'Replay'}</span>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={value}
          onChange={(e) => {
            setPlaying(false)
            const v = Number(e.target.value)
            setFrame(v >= last ? null : v)
          }}
          aria-valuetext={frameAt ? when : 'now'}
          className="min-h-11 min-w-0 flex-1 accent-gold"
        />
        <span className="flex-none">now</span>
      </label>
      {!overlay && <span className="font-mono text-[11px] text-dim">Replayed from {m.timeline.basis}.</span>}
    </div>
  )
}

/* ---------- side panel ---------- */

/** A wallet's share over time: the replay's frames when the map has them, else rolled back through the
    latest transfers from its share now. Fewer than two points is not a series. */
function balanceSeries(n: HolderNode, pct: number | null, frames: HolderFrame[], idx: number | null, recent: RecentFlow[]) {
  if (frames.length >= 2 && idx !== null) {
    const pts = frames.map((f) => ({
      v: f.pcts[idx] ?? 0,
      at: f.at,
      block: f.block,
    }))
    pts.push({ v: pct ?? 0, at: null, block: Infinity })
    return pts
  }
  const mine = recent.filter((f) => (norm(f.to) === n.id || norm(f.from) === n.id) && typeof f.pct === 'number')
  if (!mine.length || pct === null) return []
  const pts: { v: number; at: string | null; block: number }[] = [{ v: pct, at: null, block: Infinity }]
  let cur = pct
  // Newest first: the share right after each transfer, then undo it.
  for (const f of [...mine].reverse()) {
    pts.unshift({ v: Math.max(0, cur), at: f.at, block: f.block })
    const into = norm(f.to) === n.id
    const out = norm(f.from) === n.id
    if (into !== out) cur += into ? -(f.pct as number) : (f.pct as number)
  }
  pts.unshift({ v: Math.max(0, cur), at: null, block: -Infinity })
  return pts
}

function Spark({ n, pct, frames, idx, recent }: { n: HolderNode; pct: number | null; frames: HolderFrame[]; idx: number | null; recent: RecentFlow[] }) {
  const pts = useMemo(() => balanceSeries(n, pct, frames, idx, recent), [n, pct, frames, idx, recent])
  const data = pts.map((p) => Math.round(p.v * 10_000) / 10_000)
  const labels = pts.map((p) => (p.block === Infinity ? 'now' : p.at ? new Date(p.at).toISOString().slice(0, 16).replace('T', ' ') : p.block === -Infinity ? 'before' : `block ${p.block.toLocaleString('en-US')}`))
  return (
    <figure className="m-0 flex flex-col gap-1" data-wallet-spark>
      <MiniSpark data={data} labels={labels} fmt={(v) => fmtPct(v)} height={44} label={`Share of supply held by ${n.short} over time`} />
      <figcaption className="font-mono text-[11px] text-dim">{data.length >= 2 ? `Share over time · ${frames.length >= 2 && idx !== null ? 'since launch' : 'over its latest transfers'}` : 'Share over time: not enough for a series yet.'}</figcaption>
    </figure>
  )
}

function Panel({ n, m, pct, frames, idx, recent, onClose, onPick }: { n: HolderNode; m: HolderMapOk; pct: number | null; frames: HolderFrame[]; idx: number | null; recent: RecentFlow[]; onClose: () => void; onPick: (id: string) => void }) {
  const [copied, setCopied] = useState(false)
  const mine = m.links.filter((l) => l.source === n.id || l.target === n.id)
  const cluster = n.cluster ? m.clusters.find((c) => c.id === n.cluster) : null
  // Launches: the wallet's first buy, its buys and sells, and P&L against its entry price (server side).
  const [detail, setDetail] = useState<{
    id: string
    d: WalletDetail | null
  } | null>(null)
  const wantDetail = m.kind === 'deepcore-launch' && !(n.label && INFRA.has(n.label.kind))
  useEffect(() => {
    if (!wantDetail) return
    let alive = true
    getJson<WalletDetail>(`${holdersPath(m.chain.key, m.token.address)}/wallet/${encodeURIComponent(n.id)}`).then((d) => alive && setDetail({ id: n.id, d }))
    return () => {
      alive = false
    }
  }, [wantDetail, m.chain.key, m.token.address, n.id])
  const wd = detail?.id === n.id ? detail.d : undefined
  return (
    <aside aria-label={`Wallet ${n.short}`} className="flex animate-[gl-panel-in_.32s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-3 self-stretch rounded-[12px] border border-gold p-4" style={{ background: K.night }} data-holder-panel>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-dim">WALLET #{n.rank}</span>
          <code className="truncate font-mono text-[14px] text-ink" title={n.id}>
            {n.short}
          </code>
          {n.label && <span className="text-[13px] text-muted">{n.label.name}</span>}
        </div>
        <button type="button" onClick={onClose} className="min-h-11 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-muted hover:border-gold">
          Close
        </button>
      </div>
      <div className="flex items-baseline gap-2">
        <AnimatedNumber value={pct} countUp format={PCT} suffix="%" className="font-display text-[40px] leading-none font-extrabold text-gold-hover" />
        <span className="font-mono text-[12px] text-muted">
          held · {fmtUnits(n.balance)} {m.token.symbol ?? ''}
        </span>
      </div>
      <Spark n={n} pct={pct} frames={frames} idx={idx} recent={recent} />
      {(n.flags.length > 0 || n.contract !== null) && (
        <div className="flex flex-wrap gap-1.5">
          {n.flags.map((f) => (
            <span
              key={f}
              className="rounded-full border px-2 py-[1px] font-mono text-[11px]"
              style={{
                borderColor: f === 'bundled' ? K.warn : K.gold,
                color: f === 'bundled' ? K.warn : K.pale,
              }}
            >
              {flagText(f)}
            </span>
          ))}
          {n.contract !== null && <span className="rounded-full border border-line-strong px-2 py-[1px] font-mono text-[11px] text-muted">{n.contract ? 'Contract' : 'Plain wallet'}</span>}
        </div>
      )}
      {wantDetail && <WalletFacts d={wd} symbol={m.token.symbol} />}
      {cluster && (
        <p className="m-0 text-[13px] leading-[1.5] text-muted">
          In cluster {cluster.id.toUpperCase()}: {cluster.count} wallets that sent tokens to each other
          {cluster.hasDeployer ? ', the deployer among them' : ''}, holding {fmtPct(cluster.pct)} together.
        </p>
      )}
      {typeof n.valueAtFairUsd === 'number' && (
        <dl className="m-0 grid grid-cols-2 gap-2 font-mono text-[12px]">
          <dt className="text-dim">At the real share price</dt>
          <dd className="m-0 text-right text-ink">{fmtUsd(n.valueAtFairUsd)}</dd>
          {typeof n.premiumUsd === 'number' && (
            <>
              <dt className="text-dim">{n.premiumUsd >= 0 ? 'Premium over it' : 'Discount to it'}</dt>
              <dd className="m-0 text-right text-ink">{fmtUsd(n.premiumUsd)}</dd>
            </>
          )}
          {typeof n.boughtGapPct === 'number' && (
            <>
              <dt className="text-dim">Paid vs real price</dt>
              <dd className="m-0 text-right text-ink">
                {n.boughtGapPct >= 0 ? '+' : ''}
                {n.boughtGapPct.toFixed(2)}%
              </dd>
            </>
          )}
        </dl>
      )}
      {mine.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-dim">LINKS ({mine.length})</span>
          <ul className="m-0 flex max-h-[180px] list-none flex-col gap-1 overflow-y-auto p-0">
            {mine.map((l) => {
              const other = l.source === n.id ? l.target : l.source
              const o = m.nodes.find((x) => x.id === other)
              return (
                <li key={`${l.source}-${l.target}`}>
                  <button type="button" onClick={() => onPick(other)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-left font-mono text-[12px] text-muted hover:border-gold">
                    <span>{o?.short ?? other.slice(0, 10)}</span>
                    <span>{l.kind === 'funding' ? 'funded' : `${l.transfers} transfer${l.transfers === 1 ? '' : 's'}`}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copyWithToast(n.id, 'Address').then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-muted hover:border-gold"
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} Copy address
        </button>
        <a href={n.url} {...newTab} className="inline-flex min-h-11 items-center gap-1.5 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-muted hover:border-gold hover:text-ink">
          <ExternalLink size={13} aria-hidden /> Explorer ↗
        </a>
      </div>
    </aside>
  )
}

/** First buy and P&L vs entry, as the server states them (undefined while reading, null when unreadable). */
function WalletFacts({ d, symbol }: { d: WalletDetail | null | undefined; symbol: string | null }) {
  if (d === undefined) return <div className="h-[52px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[8px]" style={{ background: K.slate }} aria-label="Reading this wallet's trades" role="status" />
  if (!d || d.state !== 'ok') return <p className="m-0 font-mono text-[11px] text-dim">This wallet’s trades could not be read just now.</p>
  const fb = d.firstBuy
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[12px]" data-wallet-facts>
      <dt className="text-dim">First buy</dt>
      <dd className="m-0 text-right text-ink">{fb ? `${fb.at ? new Date(fb.at).toISOString().slice(0, 16).replace('T', ' ') : `block ${fb.block.toLocaleString('en-US')}`}` : 'never bought from the pool'}</dd>
      {fb && (
        <>
          <dt className="text-dim">Bought</dt>
          <dd className="m-0 text-right text-ink">
            {fmtUnits(fb.tokens)} {symbol ?? ''}
            {fb.paid ? ` for ${fb.paid.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${fb.paid.symbol}` : ''}
          </dd>
        </>
      )}
      <dt className="text-dim">Buys / sells</dt>
      <dd className="m-0 text-right text-ink">
        {d.buys} / {d.sells}
      </dd>
      <dt className="text-dim">P&amp;L vs entry</dt>
      <dd
        className="m-0 text-right"
        style={{
          color: d.pnlPct === null ? K.muted : d.pnlPct >= 0 ? K.pale : K.warn,
        }}
      >
        {d.pnlPct === null ? 'not known' : `${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(1)}%${d.quote ? ` in ${d.quote} terms` : ''}`}
      </dd>
      {d.otherLaunches.length > 0 && (
        <>
          <dt className="col-span-2 mt-1 text-dim">Also holds launches</dt>
          <dd className="col-span-2 m-0 flex flex-wrap gap-1">
            {d.otherLaunches.slice(0, 6).map((o) => (
              <Link key={`${o.chainKey}:${o.token}`} to={o.path} className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-2 text-[11px] text-gold-hover hover:border-gold">
                {o.symbol ?? `${o.token.slice(0, 6)}…`}
              </Link>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
}

/* ---------- ranked list (narrow screens, and always for screen readers) ---------- */

function RankedList({ m, selected, onSelect, srOnly = false }: { m: HolderMapOk; selected: string | null; onSelect: (id: string) => void; srOnly?: boolean }) {
  const rows = m.nodes.slice(0, srOnly ? 50 : 100)
  if (srOnly)
    return (
      // A table ignores a 1 px width (it grows to its content), so the sr-only box is a wrapper around it.
      <div className="sr-only">
        <table>
          <caption>Largest holders of {m.token.symbol ?? 'this token'}, ranked</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Wallet</th>
              <th scope="col">Held</th>
              <th scope="col">Label</th>
              <th scope="col">Cluster</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td>{n.rank}</td>
                <td>{n.id}</td>
                <td>{fmtPct(n.pct)}</td>
                <td>{n.label?.name ?? ''}</td>
                <td>{n.cluster ?? ''}</td>
                <td>{n.flags.map((f) => flagText(f)).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  return (
    <ol className="m-0 flex max-h-[460px] list-none flex-col gap-1 overflow-y-auto p-0" aria-label={`Largest holders of ${m.token.symbol ?? 'this token'}`} data-holder-list>
      {rows.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onSelect(n.id)} aria-pressed={selected === n.id} className={`flex min-h-11 w-full items-center gap-2 rounded-[8px] border px-2 text-left font-mono text-[12px] ${selected === n.id ? 'border-gold' : 'border-line'} animate-[gl-fade_.3s_ease_both]`}>
            <span className="w-7 flex-none text-dim">{n.rank}</span>
            <span
              aria-hidden
              className="inline-block size-2.5 flex-none rounded-full"
              style={{
                background: isInfra(n) || n.label?.kind === 'deployer' ? KIND_HUE[kindKeyOf(n) as KindKey] : n.cluster ? K.gold : K.muted,
              }}
            />
            <span className="min-w-0 flex-1 break-words text-ink">{n.label?.name ?? n.short}</span>
            {n.flags.includes('bundled') && <span className="flex-none text-[11px] text-error">BUNDLED</span>}
            <span className="w-16 flex-none text-right text-gold-hover">{fmtPct(n.pct)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/* ---------- fair-price overlay (stocks) ---------- */

function FairBlock({ m }: { m: HolderMapOk }) {
  const f = m.fair!
  const cells: { k: string; v: string; n?: string }[] = [
    {
      k: 'TOP 10 AT REAL PRICE',
      v: fmtUsd(f.top10ValueAtFairUsd),
      n: `real share price $${f.fair.toFixed(2)}`,
    },
    {
      k: f.top10PremiumUsd !== null && f.top10PremiumUsd < 0 ? 'THEIR DISCOUNT' : 'THEIR PREMIUM',
      v: f.top10PremiumUsd === null ? 'not trusted now' : fmtUsd(f.top10PremiumUsd),
      n: f.gapPct === null ? 'the gap is not trusted right now' : `token ${f.gapPct >= 0 ? '+' : ''}${f.gapPct.toFixed(2)}% vs real price`,
    },
    {
      k: 'BUYERS PAID',
      v: f.buyersAvgGapPct === null ? 'not priced' : `${f.buyersAvgGapPct >= 0 ? '+' : ''}${f.buyersAvgGapPct.toFixed(2)}%`,
      n: f.buyers ? `${f.buyers} mapped wallets bought in the window` : 'no priced buys in the window',
    },
  ]
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line" data-holder-fair>
      {cells.map((c) => (
        <div key={c.k} className="flex flex-col gap-1 px-4 py-3" style={{ background: K.night }}>
          <dt className="font-mono text-[11px] tracking-[1px] text-dim">{c.k}</dt>
          <dd className="m-0 font-display text-[24px] leading-none font-bold text-ink">{c.v}</dd>
          {c.n && <span className="font-mono text-[11px] text-dim">{c.n}</span>}
        </div>
      ))}
    </dl>
  )
}

/* ---------- trade ---------- */

/** The line under the title: what kind of token this map is of. */
function kindLabel(m: HolderMapOk) {
  return m.kind === 'deepcore-launch' ? 'DeepCore launch' : m.kind === 'launch' ? `${m.venue ?? 'Launchpad'} launch` : m.kind === 'token' ? 'Token' : 'Stock token'
}

function Trade({ m, embed, tradeHref, onTrade, pageUrl }: { m: HolderMapOk; embed: boolean; tradeHref?: string | null; onTrade?: () => void; pageUrl: string }) {
  if (tradeHref === null) return null
  const sym = m.token.symbol ?? 'this token'
  const launch = m.kind === 'deepcore-launch'
  const generic = m.kind === 'token' || m.kind === 'launch'
  const net = { robinhood: 'robinhood', bsc: 'bsc', base: 'base', hyperevm: 'hyperevm' }[m.chain.key] ?? m.chain.key
  const href = embed ? pageUrl : (tradeHref ?? (generic ? m.token.url : launch ? `https://deepcore.fun/app/swap?net=${net}&in=0x0000000000000000000000000000000000000000&out=${m.token.address}` : `/tracker/${m.chain.key}/${sym}#swap`))
  const external = embed || /^https?:/.test(href)
  const note = generic ? 'Opens the block explorer; Gully Labs has no swap for this token.' : launch ? `Opens DeepCore’s own swap; Gully Labs takes no fee there.` : m.chain.key === 'solana' ? jupiterFeeText() : feeText()
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line-strong p-4" style={{ background: K.night }} data-holder-trade>
      <p className="m-0 text-[14px] leading-[1.5] text-ink">
        <b className="font-semibold">Before you trade:</b> {m.forensics?.riskLine ? `${m.forensics.riskLine} ` : ''}
        {m.summary.line}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a href={href} {...(external ? newTab : {})} onClick={() => onTrade?.()} className="inline-flex min-h-11 items-center gap-2 rounded-btn px-5 font-semibold text-bg transition-[filter] hover:brightness-110" style={{ background: K.gold }}>
          {generic && !embed ? `View ${sym} on the explorer` : `Buy or sell ${sym}`}
          {external ? ' ↗' : ''}
        </a>
        <span className="font-mono text-[11px] text-dim">{embed ? 'Opens Gully Labs.' : note}</span>
      </div>
    </div>
  )
}

/* ---------- share and export ---------- */

function Share({ m, pageUrl, embed }: { m: HolderMapOk; pageUrl: string; embed: boolean }) {
  const card = holdersCardUrl(m.chain.key, m.token.address)
  const text = `Who holds ${m.token.symbol ?? 'this token'} on ${m.chain.name}? ${m.summary.line}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={card} {...newTab} className={chip(false)}>
        <Share2 size={13} aria-hidden /> Share card ↗
      </a>
      {!embed && (
        <button type="button" onClick={() => copyWithToast(pageUrl, 'Link')} className={chip(false)}>
          <Copy size={13} aria-hidden /> Copy link
        </button>
      )}
      <a href={xPost(text, pageUrl)} {...newTab} className={chip(false)}>
        Post on X ↗
      </a>
      {m.features.csv ? (
        <a href={holdersCsvUrl(m.chain.key, m.token.address)} download className={chip(false)}>
          <Download size={13} aria-hidden /> CSV
        </a>
      ) : m.features.gated ? (
        <Link to="/pricing" className={chip(false)}>
          <Lock size={13} aria-hidden /> CSV with Pro
        </Link>
      ) : null}
    </div>
  )
}
