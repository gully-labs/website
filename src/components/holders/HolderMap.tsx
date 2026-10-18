import { useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { BellRing, Check, Copy, Download, ExternalLink, Lock, Pause, Play, Search, Share2 } from 'lucide-react'
import { Link } from 'react-router'
import { EChart } from '../charts/EChart'
import { useReducedMotion, type ChartEvent } from '../charts/chart-utils'
import { alpha, tipHtml } from '../charts/chartPresets'
import { Mascot } from '../brand'
import { copyWithToast } from '../ui/toast'
import { newTab } from '../LayoutNav'
import { feeText, jupiterFeeText } from '../swap/swapConfig'
import { xPost } from '../../lib/share'
import { ageText } from '../../lib/tracker'
import { getJson, holdersCardUrl, holdersCsvUrl, holdersPagePath, holdersPath, INFRA_KINDS, useHolderMap, type HealthPartId, type HolderFrame, type HolderLabelKind, type HolderMapOk, type HolderNode, type WalletDetail } from '../../lib/holders'
import { APP_URL, isLocalHost } from '../../site-host'
import { useLive } from './live'
import { AskExplain, CrossTokenCard, DeployerHistoryCard, HealthCard, LivePill } from './parts'
import { extentOf, forceLayout, radiusFor, type Placed } from './layout'
import { fmtPct, norm } from './format'
import { K } from './theme'

/* The Holder Map (Gully Labs): who holds a token, drawn as bubbles sized by share, with the wallets that
   sent each other tokens linked and their clusters lit in kit gold. Every figure is the server's
   (server/holders.mjs); nothing here computes a share, a cluster or a warning.

   Motion: bubbles grow out of the centre, where the token sits, and settle into a force layout; links
   carry particles; the replay grows and shrinks bubbles frame by frame. Under reduced motion the map
   fades in where it lands, links are still lines and the replay steps with short fades. */

const INFRA = new Set<HolderLabelKind>(INFRA_KINDS)
const isInfra = (n: HolderNode) => !!n.label && INFRA.has(n.label.kind)
const FLAG_TEXT = {
  bundled: 'Bundled at launch',
  deployer: 'Deployer',
  'funded-by-deployer': 'Funded by deployer',
} as const

const fmtUsd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const fmtUnits = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString('en-US', { maximumFractionDigits: 4 }))

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
  /** The map's own page: live mode runs, the side column holds the score and the deployer's record. */
  page?: boolean
}

export function HolderMap({ chain, token, compact = false, embed = false, tradeHref, onTrade, page = false }: HolderMapProps) {
  const load = useHolderMap(chain, token)
  if (load.k === 'loading') return <MapSkeleton compact={compact} />
  if (load.k === 'error') return <MapEmpty title="The Holder Map could not be read" text="The map did not answer just now. It retries every few minutes." />
  const m = load.data
  if (m.state !== 'ok')
    return (
      <MapEmpty
        title={m.state === 'not-found' ? 'No Holder Map for this token' : m.state === 'unavailable' ? 'Holder data is not available here yet' : 'The Holder Map is busy'}
        text={`${m.reason}${m.needs ? ' (It needs a data key on our side; nothing is shown until it is set.)' : ''}`}
      />
    )
  return <MapView m={m} compact={compact} embed={embed} tradeHref={tradeHref} onTrade={onTrade} page={page} />
}

/* ---------- loading and empty states (animated, never dead) ---------- */

function MapSkeleton({ compact }: { compact: boolean }) {
  return (
    <div role="status" aria-label="Reading who holds this token" className="flex flex-col gap-3 rounded-card border border-line p-4" style={{ background: K.night }}>
      <div className="h-[14px] w-[160px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-full bg-surface" />
      <div className="relative grid place-items-center overflow-hidden rounded-[10px] bg-surface-deep" style={{ height: compact ? 300 : 420 }}>
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

function MapEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line p-5" style={{ background: K.night }} data-holder-map="empty">
      <div className="flex items-center gap-3">
        <span className="relative inline-flex size-3 flex-none">
          <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
          <span className="relative size-3 rounded-full bg-gold" />
        </span>
        <h3 className="m-0 font-display text-[22px] font-bold uppercase text-ink">{title}</h3>
      </div>
      <p className="m-0 max-w-[640px] text-[14px] leading-[1.6] text-muted">{text}</p>
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

function MapView({ m, compact, embed, tradeHref, onTrade, page }: { m: HolderMapOk; compact: boolean; embed: boolean; tradeHref?: string | null; onTrade?: () => void; page: boolean }) {
  const reduced = useReducedMotion()
  const now = useNow()
  const [boxRef, width] = useWidth<HTMLDivElement>()
  const [rootRef, rootWidth] = useWidth<HTMLDivElement>()
  const introRef = useRef<HTMLDivElement>(null)
  const [peopleOnly, setPeopleOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 4>(1)
  const [query, setQuery] = useState('')
  const [searchMiss, setSearchMiss] = useState(false)
  const narrow = useNarrow()
  const [view, setView] = useState<'map' | 'list' | null>(null)
  const shownView = view ?? (narrow ? 'list' : 'map')
  const chart = useRef<EChartsType | null>(null)
  const [zoom, setZoom] = useState({ x: [0, 100], y: [0, 100] })
  const [highlight, setHighlight] = useState<{
    id: HealthPartId
    wallets: Set<string>
  } | null>(null)
  const live = useLive(m, page && !embed)

  const graphAll = useMemo(() => m.nodes.slice(0, m.holders.graph), [m])
  const graph = useMemo(() => (peopleOnly ? graphAll.filter((n) => !isInfra(n)) : graphAll), [graphAll, peopleOnly])
  const byId = useMemo(() => new Map(m.nodes.map((n) => [n.id, n])), [m])
  const frames = useMemo(() => m.timeline?.frames ?? [], [m])
  const idxOf = useMemo(() => new Map(graphAll.map((n, i) => [n.id, i])), [graphAll])
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

  // Height and the axis window: the layout's extent stretched to the box's aspect, so circles stay round.
  const height = compact ? 340 : width < 600 ? 400 : page ? 640 : 540
  const fit = useMemo(() => {
    const e = extentOf(placed)
    const w = Math.max(1, width || 600)
    const scale = Math.min(w / (e.x1 - e.x0), height / (e.y1 - e.y0))
    const cx = (e.x0 + e.x1) / 2
    const cy = (e.y0 + e.y1) / 2
    return {
      scale,
      x: [cx - w / scale / 2, cx + w / scale / 2],
      y: [cy - height / scale / 2, cy + height / scale / 2],
    }
  }, [placed, width, height])

  // Intro: everything starts at the centre at size zero, then grows out and settles (not under reduced motion).
  const [intro, setIntro] = useState(true)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (reduced || !ready) return
    const el = introRef.current
    if (!el) return
    let timer = 0
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          timer = window.setTimeout(() => setIntro(false), 420)
          io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      clearTimeout(timer)
    }
  }, [reduced, shownView, ready])
  const growing = intro && !reduced

  // Replay: play steps through the frames (1 s a frame, or 4x), stopping on the last.
  useEffect(() => {
    if (!playing || !frames.length) return
    const id = window.setInterval(
      () =>
        setFrame((f) => {
          const next = f === null ? 0 : f + 1
          if (next >= frames.length) {
            setPlaying(false)
            return null
          }
          return next
        }),
      speed === 4 ? 250 : 1000,
    )
    return () => clearInterval(id)
  }, [playing, speed, frames.length])

  const sel = selected ? (byId.get(selected) ?? null) : null
  const focusCluster = hover ?? (sel?.cluster ? `c:${sel.cluster}` : null)
  const lit = (n: HolderNode) => {
    if (highlight) return highlight.wallets.has(n.id)
    if (!focusCluster) return true
    if (focusCluster.startsWith('c:')) return n.cluster === focusCluster.slice(2)
    return n.id === focusCluster.slice(2)
  }
  const biggest = m.clusters[0]?.id ?? null

  const colourOf = (n: HolderNode) => (isInfra(n) ? K.slate : n.cluster ? (n.cluster === biggest ? K.gold : K.pale) : n.label?.kind === 'deployer' ? K.moss : K.midnight)
  const option = useMemo(() => {
    const nodeData = graph.map((n) => {
      const p = pos.get(n.id) as Placed
      const r = radiusFor(pctAt(n), maxPct)
      const on = lit(n)
      const bundled = n.flags.includes('bundled')
      return {
        id: n.id,
        name: n.short,
        value: growing ? [0, 0] : [p.x, p.y],
        symbolSize: growing ? 0 : Math.max(4, 2 * r * fit.scale),
        itemStyle: {
          color: colourOf(n),
          opacity: on ? (n.cluster && !isInfra(n) ? 0.92 : 1) : 0.16,
          borderColor: bundled ? K.warn : n.id === selected ? K.bone : isInfra(n) ? K.dim : n.cluster ? K.pale : K.muted,
          borderWidth: n.id === selected ? 3 : bundled ? 2.5 : 1.2,
          borderType: bundled ? 'dashed' : 'solid',
        },
        label: {
          show: !growing && r * fit.scale >= 22,
          formatter: fmtPct(pctAt(n)),
          color: n.cluster && !isInfra(n) ? K.night : K.bone,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: Math.min(15, Math.max(10, Math.round(r * fit.scale * 0.32))),
        },
      }
    })
    const lineData = growing
      ? []
      : links.flatMap((l) => {
          const a = pos.get(norm(l.source))
          const b = pos.get(norm(l.target))
          if (!a || !b) return []
          const ends = [byId.get(l.source), byId.get(l.target)].filter(Boolean) as HolderNode[]
          const on = ends.every(lit)
          const via = l.kind === 'via'
          const style = {
            lineStyle: {
              color: via ? K.muted : l.kind === 'funding' ? K.pale : K.gold,
              opacity: on ? (via ? 0.45 : 0.55) : 0.08,
              width: via ? 1 : Math.min(4, 1 + Math.log2(1 + l.transfers) * 0.6),
              type: via || l.kind === 'funding' ? 'dashed' : 'solid',
            },
          }
          const fwd = {
            coords: [
              [a.x, a.y],
              [b.x, b.y],
            ],
            ...style,
          }
          const back = {
            coords: [
              [b.x, b.y],
              [a.x, a.y],
            ],
            ...style,
          }
          return l.direction === 'backward' ? [back] : l.direction === 'both' ? [fwd, back] : [fwd]
        })
    // Live transfers: a particle from the sender to the receiver; addresses off the map come in from (or leave to) the edge.
    const edge = (id: string) => {
      let h = 0
      for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      const a = (h % 360) * (Math.PI / 180)
      const cx = (fit.x[0] + fit.x[1]) / 2
      const cy = (fit.y[0] + fit.y[1]) / 2
      return [cx + Math.cos(a) * (fit.x[1] - fit.x[0]) * 0.48, cy + Math.sin(a) * (fit.y[1] - fit.y[0]) * 0.48]
    }
    const liveData = growing
      ? []
      : live.events.map((e) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          return {
            coords: [a ? [a.x, a.y] : edge(e.from), b ? [b.x, b.y] : edge(e.to)],
            lineStyle: {
              color: K.pale,
              opacity: reduced ? 0.6 : 0.25,
              width: 1,
              type: 'dotted',
            },
          }
        })
    const viaData = vias.map((v) => {
      const p = pos.get(norm(v.via))
      const on = !highlight && !focusCluster ? true : [byId.get(v.connects[0]), byId.get(v.connects[1])].some((n) => n && lit(n))
      return {
        id: norm(v.via),
        name: v.short,
        value: growing || !p ? [0, 0] : [p.x, p.y],
        symbolSize: growing ? 0 : 9,
        itemStyle: {
          color: 'rgba(0,0,0,0)',
          borderColor: K.muted,
          borderWidth: 1.2,
          borderType: 'dashed',
          opacity: on ? 1 : 0.2,
        },
        via: v,
      }
    })
    return {
      animationDurationUpdate: 1100,
      animationEasingUpdate: 'cubicOut',
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: 'value', show: false, min: fit.x[0], max: fit.x[1] },
      yAxis: { type: 'value', show: false, min: fit.y[0], max: fit.y[1] },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
        {
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
      ],
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: ChartEvent) => {
          if (p.seriesId === 'via') {
            const v = p.data.via as {
              short: string
              transfers: number
              connects: string[]
            }
            return tipHtml({
              title: `Linked via ${v.short}`,
              rows: [
                {
                  name: 'Joins',
                  value: v.connects.map((c) => byId.get(c)?.short ?? c.slice(0, 8)).join(' + '),
                },
                { name: 'Transfers', value: String(v.transfers) },
              ],
              note: 'An address that is not on the map passed tokens between these wallets.',
            })
          }
          if (p.seriesId !== 'holders') return ''
          const n = byId.get(p.data.id)
          if (!n) return ''
          return tipHtml({
            title: n.label?.name ?? n.short,
            rows: [{ name: 'Held', value: fmtPct(pctAt(n)) }, { name: 'Rank', value: `#${n.rank}` }, ...(n.label ? [{ name: 'Wallet', value: n.short }] : []), ...(n.cluster ? [{ name: 'Cluster', value: n.cluster.toUpperCase() }] : [])],
            note: n.flags.length ? n.flags.map((f) => FLAG_TEXT[f]).join(' · ') : undefined,
          })
        },
      },
      series: [
        {
          id: 'links',
          type: 'lines',
          coordinateSystem: 'cartesian2d',
          z: 1,
          silent: true,
          effect: {
            show: !reduced,
            period: 2.6,
            trailLength: 0.25,
            symbol: 'circle',
            symbolSize: 3,
            color: K.pale,
          },
          data: lineData,
        },
        {
          id: 'live',
          type: 'lines',
          coordinateSystem: 'cartesian2d',
          z: 3,
          silent: true,
          effect: {
            show: !reduced,
            period: 1.6,
            trailLength: 0.4,
            symbol: 'circle',
            symbolSize: 5,
            color: K.bone,
            loop: false,
          },
          data: liveData,
        },
        {
          id: 'via',
          type: 'scatter',
          z: 2,
          data: viaData,
        },
        {
          id: 'holders',
          type: 'scatter',
          z: 2,
          animationDuration: 700,
          animationEasing: 'cubicOut',
          emphasis: {
            scale: 1.06,
            itemStyle: { shadowBlur: 16, shadowColor: alpha(K.gold, 0.45) },
          },
          data: nodeData,
        },
      ],
    }
    // pctAt/lit/colourOf read state listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, pos, fit, growing, links, frame, focusCluster, selected, reduced, maxPct, highlight, vias, live.events, live.pcts])

  const onEvents = useMemo(
    () => ({
      click: (p: ChartEvent) => p.seriesId === 'holders' && setSelected(p.data.id),
      mouseover: (p: ChartEvent) => {
        if (p.seriesId !== 'holders') return
        const n = byId.get(p.data.id)
        setHover(n?.cluster && !isInfra(n) ? `c:${n.cluster}` : `n:${p.data.id}`)
      },
      mouseout: () => setHover(null),
      globalout: () => setHover(null),
    }),
    [byId],
  )

  // The minimap follows the zoom window.
  const onChart = (c: EChartsType | null) => {
    chart.current = c
    setReady(!!c)
    if (!c) return
    c.on('datazoom', () => {
      const dz = (c.getOption() as { dataZoom?: { start?: number; end?: number }[] }).dataZoom ?? []
      setZoom({
        x: [dz[0]?.start ?? 0, dz[0]?.end ?? 100],
        y: [dz[1]?.start ?? 0, dz[1]?.end ?? 100],
      })
    })
  }
  const zoomTo = (id: string) => {
    const c = chart.current
    const p = pos.get(id)
    if (!c || !p) return
    const span = (v: number[]) => v[1] - v[0]
    const wx = Math.max(span(fit.x) / 4, p.r * 6)
    const wy = Math.max(span(fit.y) / 4, p.r * 6)
    c.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 0,
      startValue: p.x - wx / 2,
      endValue: p.x + wx / 2,
    })
    c.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 1,
      startValue: p.y - wy / 2,
      endValue: p.y + wy / 2,
    })
  }
  const resetZoom = () => {
    const c = chart.current
    if (!c) return
    c.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 0,
      start: 0,
      end: 100,
    })
    c.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 1,
      start: 0,
      end: 100,
    })
  }
  const search = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim().toLowerCase().replace(/…/g, '')
    if (!q) return
    const hit = m.nodes.find((n) => n.id.toLowerCase() === q) ?? m.nodes.find((n) => n.id.toLowerCase().startsWith(q) || n.short.toLowerCase().replace(/…/g, '').startsWith(q) || (n.label?.name ?? '').toLowerCase().includes(q))
    setSearchMiss(!hit)
    if (!hit) return
    if (peopleOnly && isInfra(hit)) setPeopleOnly(false)
    setSelected(hit.id)
    if (shownView === 'map') setTimeout(() => zoomTo(hit.id), 60)
  }

  const cards = !!(m.health || m.deployerHistory || m.crossToken || (!compact && !embed))
  const side = !compact && rootWidth >= 1100 && (!!sel || cards)
  const alertHref = `${isLocalHost() ? '/app' : APP_URL}/?alert=${encodeURIComponent(`holders:${m.chain.key}:${m.token.address}`)}#alerts`
  const label = `Holder Map of ${m.token.symbol ?? 'this token'} on ${m.chain.name}: ${m.summary.line} ${m.forensics?.riskLine ?? ''}`.trim()
  const pageUrl = `https://gullylabs.xyz${holdersPagePath(m.chain.key, m.token.address)}`
  const frameAt = frame !== null ? frames[frame] : null

  return (
    <div ref={rootRef} className="flex flex-col gap-4 rounded-card border border-line p-[clamp(14px,2.2cqw,22px)] text-kit-bone" style={{ background: K.night }} data-holder-map="ok">
      {/* Header: what this is, how fresh, where from */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[12px] tracking-[1.5px] text-kit-lab-gold">HOLDER MAP · {m.kind === 'deepcore-launch' ? 'DEEPCORE LAUNCH' : 'STOCK TOKEN'}</span>
          <h3 className="m-0 font-display text-[clamp(26px,3cqw,36px)] leading-none font-extrabold uppercase">
            Who holds {m.token.symbol ?? 'this token'}
            <span className="text-kit-text-muted"> · {m.chain.name}</span>
          </h3>
          <span className="font-mono text-[12px] text-kit-text-dim">
            Updated {ageText(m.asOf, now)}
            {m.holders.count !== null ? ` · ${m.holders.count.toLocaleString('en-US')} holders` : ''} · {m.holders.shown} listed
            {m.stale ? ' · showing the last good read' : ''}
          </span>
        </div>
        <span className="flex items-center gap-2">
          <LivePill on={live.on} paused={live.paused} lastAt={live.lastAt} gated={m.features.gated} now={now} />
          <Mascot size={compact ? 32 : 44} label="Gully Labs" />
        </span>
      </div>

      {/* The summary and the safety warning: always free */}
      <div className="flex flex-col gap-2" data-holder-summary>
        <p className="m-0 font-display text-[clamp(20px,2.2cqw,26px)] leading-[1.15] font-bold text-kit-pale-gold">{m.summary.line}</p>
        {m.forensics && (
          <p
            className="m-0 rounded-[10px] border px-3 py-2 text-[14px] leading-[1.5]"
            style={{
              borderColor: m.forensics.bundled.wallets ? K.warn : K.slate,
              color: K.bone,
              background: K.midnight,
            }}
            data-risk-line
          >
            <b className="font-semibold">{m.forensics.bundled.wallets ? '⚠ ' : ''}Launch check:</b> {m.forensics.riskLine}
            {m.forensics.snipers && m.forensics.snipers.wallets > 0 && (
              <span className="text-kit-text-muted">
                {' '}
                {m.forensics.snipers.wallets} wallet
                {m.forensics.snipers.wallets === 1 ? '' : 's'} bought in the first {m.forensics.snipers.blocks} blocks
                {m.forensics.snipers.pct !== null ? ` and hold ${fmtPct(m.forensics.snipers.pct)}` : ''}.
              </span>
            )}
          </p>
        )}
        {!compact && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-[1.55] text-kit-text-muted">
            {m.summary.plain.map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden className="text-kit-lab-gold">
                  +
                </span>
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} role="search" className="flex min-w-0 flex-[1_1_220px] items-center gap-2 rounded-btn border border-line-strong px-3" style={{ background: K.midnight }}>
          <Search size={14} aria-hidden className="flex-none text-kit-text-dim" />
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
            className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-kit-bone outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="min-h-11 px-1 font-mono text-[12px] text-kit-lab-gold">
            Find
          </button>
        </form>
        <button type="button" aria-pressed={peopleOnly} onClick={() => setPeopleOnly((v) => !v)} className={chip(peopleOnly)}>
          {peopleOnly ? 'People only' : 'Showing contracts and pools'}
        </button>
        <div role="group" aria-label="View" className="flex gap-1">
          <button type="button" aria-pressed={shownView === 'map'} onClick={() => setView('map')} className={chip(shownView === 'map')}>
            Map
          </button>
          <button type="button" aria-pressed={shownView === 'list'} onClick={() => setView('list')} className={chip(shownView === 'list')}>
            List
          </button>
        </div>
      </div>
      {highlight && (
        <p role="status" className="m-0 flex flex-wrap items-center gap-2 font-mono text-[12px] text-kit-pale-gold">
          Showing the {highlight.wallets.size} wallet
          {highlight.wallets.size === 1 ? '' : 's'} behind “{m.health?.parts.find((p) => p.id === highlight.id)?.label}”.
          <button type="button" onClick={() => setHighlight(null)} className="min-h-11 px-1 text-kit-text-muted underline-offset-4 hover:underline">
            Show all
          </button>
        </p>
      )}
      {searchMiss && (
        <p role="status" className="m-0 font-mono text-[12px] text-error">
          No mapped wallet matches that.
        </p>
      )}

      <div className={`grid gap-4 ${side ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'}`}>
        <div ref={boxRef} className="flex min-w-0 flex-col gap-3">
          {/* The chart is unmounted in list view: a zero-size canvas breaks ECharts' particle trails. */}
          {shownView === 'map' && (
            <div ref={introRef} className="relative">
              <EChart option={option} height={height} label={label} renderer="canvas" replaceMerge={['series']} onEvents={onEvents} onChart={onChart} skeleton="line" className="touch-none" />
              {width > 0 && width < 600 && <Minimap placed={placed} graph={graph} colourOf={colourOf} zoom={zoom} fit={fit} onReset={resetZoom} />}
              <span className="pointer-events-none absolute top-2 left-2 font-mono text-[11px] tracking-[1px] text-kit-text-dim">{width < 600 ? 'PINCH OR DRAG TO ZOOM' : 'SCROLL TO ZOOM · DRAG TO PAN'}</span>
            </div>
          )}
          {shownView === 'list' ? <RankedList m={m} selected={selected} onSelect={setSelected} /> : <RankedList m={m} selected={selected} onSelect={setSelected} srOnly />}
          <Legend m={m} />
          <Replay m={m} frame={frame} frameAt={frameAt} setFrame={setFrame} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} />
        </div>
        {(sel || cards) && (
          <div className="flex min-w-0 flex-col gap-3" data-side>
            {sel && <Panel n={sel} m={m} onClose={() => setSelected(null)} onPick={(id) => (setSelected(id), shownView === 'map' && zoomTo(id))} />}
            {m.health && (
              <HealthCard
                h={m.health}
                active={highlight?.id ?? null}
                onPart={(id, wallets) => {
                  setHighlight(id ? { id, wallets: new Set(wallets.map(norm)) } : null)
                  if (id && peopleOnly) setPeopleOnly(false)
                }}
              />
            )}
            {m.deployerHistory && <DeployerHistoryCard d={m.deployerHistory} now={now} />}
            {m.crossToken && <CrossTokenCard x={m.crossToken} />}
            {!compact && !embed && (
              <div className="flex flex-col gap-2">
                <AskExplain m={m} />
                <a
                  href={alertHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 self-start rounded-btn border border-line-strong px-4 font-mono text-[12px] text-kit-text-muted hover:border-kit-lab-gold hover:text-kit-bone"
                  data-alert-me
                >
                  <BellRing size={14} aria-hidden /> Alert me if the top cluster moves ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {m.fair && !compact && <FairBlock m={m} />}

      {/* Trade, with the warning directly above it */}
      <Trade m={m} embed={embed} tradeHref={tradeHref} onTrade={onTrade} pageUrl={pageUrl} />

      <Share m={m} pageUrl={pageUrl} embed={embed} />
      <p className="m-0 font-mono text-[11px] leading-[1.6] text-kit-text-dim">
        Sources: {[m.sources.holders, m.sources.links, m.sources.note].filter(Boolean).join(' · ')}. Shares are of the {m.holders.sharesOf}
        {m.holders.partial ? ` (${m.holders.partial})` : ''}. Information only, not advice.
      </p>
    </div>
  )
}

const chip = (on: boolean) =>
  `inline-flex min-h-11 items-center gap-1 rounded-btn border px-3 font-mono text-[12px] transition-colors ${on ? 'border-kit-lab-gold text-kit-pale-gold' : 'border-line-strong text-kit-text-muted hover:border-kit-lab-gold'}`

/* ---------- minimap (small screens) ---------- */

function Minimap({ placed, graph, colourOf, zoom, fit, onReset }: { placed: Placed[]; graph: HolderNode[]; colourOf: (n: HolderNode) => string; zoom: { x: number[]; y: number[] }; fit: { x: number[]; y: number[] }; onReset: () => void }) {
  const S = 84
  const sx = (v: number) => ((v - fit.x[0]) / (fit.x[1] - fit.x[0])) * S
  const sy = (v: number) => S - ((v - fit.y[0]) / (fit.y[1] - fit.y[0])) * S
  const scale = S / (fit.x[1] - fit.x[0])
  const byId = new Map(graph.map((n) => [n.id, n]))
  const zoomed = zoom.x[0] > 0.5 || zoom.x[1] < 99.5 || zoom.y[0] > 0.5 || zoom.y[1] < 99.5
  return (
    <button
      type="button"
      onClick={onReset}
      aria-label={zoomed ? 'Overview of the map; tap to zoom back out' : 'Overview of the map'}
      className="absolute right-2 bottom-2 rounded-[8px] border border-line-strong p-1"
      style={{ background: alpha(K.night, 0.88) }}
    >
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} aria-hidden>
        {placed.map((p) => (
          <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={Math.max(0.8, p.r * scale)} fill={byId.get(p.id) ? colourOf(byId.get(p.id) as HolderNode) : K.slate} opacity={0.9} />
        ))}
        <rect x={(zoom.x[0] / 100) * S} y={S - (zoom.y[1] / 100) * S} width={((zoom.x[1] - zoom.x[0]) / 100) * S} height={((zoom.y[1] - zoom.y[0]) / 100) * S} fill="none" stroke={K.pale} strokeWidth={1.2} />
      </svg>
    </button>
  )
}

/* ---------- legend ---------- */

function Legend({ m }: { m: HolderMapOk }) {
  const sw = (bg: string, border: string, dashed = false) => (
    <span
      aria-hidden
      className="inline-block size-3 flex-none rounded-full"
      style={{
        background: bg,
        border: `1.5px ${dashed ? 'dashed' : 'solid'} ${border}`,
      }}
    />
  )
  const anyBundled = m.nodes.some((n) => n.flags.includes('bundled'))
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-kit-text-muted" aria-label="Legend">
      {m.clusters.length > 0 && <li className="flex items-center gap-1.5">{sw(K.gold, K.pale)} Largest cluster</li>}
      {m.clusters.length > 1 && <li className="flex items-center gap-1.5">{sw(K.pale, K.pale)} Other clusters</li>}
      <li className="flex items-center gap-1.5">{sw(K.midnight, K.muted)} Wallet</li>
      {anyBundled && <li className="flex items-center gap-1.5">{sw(K.midnight, K.warn, true)} Bundled at launch</li>}
      {m.legend.map((l) => (
        <li key={l.kind} className="flex items-center gap-1.5">
          {sw(l.kind === 'deployer' ? K.moss : INFRA.has(l.kind) ? K.slate : K.midnight, INFRA.has(l.kind) ? K.dim : K.muted)} {l.text}
        </li>
      ))}
      {m.links.length > 0 && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-[2px] w-4" style={{ background: K.gold }} /> Sent tokens to each other
        </li>
      )}
    </ul>
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
}: {
  m: HolderMapOk
  frame: number | null
  frameAt: HolderFrame | null
  setFrame: (f: number | null) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  speed: 1 | 4
  setSpeed: (s: 1 | 4) => void
}) {
  const frames = m.timeline?.frames ?? []
  if (!m.timeline || frames.length < 2) {
    const locked = m.locked.includes('replay') && m.features.gated
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line px-3 py-2 font-mono text-[12px] text-kit-text-dim" data-replay="off">
        {locked ? <Lock size={13} aria-hidden /> : null}
        {locked ? (
          <>
            The history replay comes with Pro.{' '}
            <Link to="/pricing" className="text-kit-lab-gold underline-offset-4 hover:underline">
              See plans
            </Link>
          </>
        ) : (
          'History replay: not enough transfers yet to replay.'
        )}
      </div>
    )
  }
  const last = frames.length // the slider's last stop is "now"
  const value = frame === null ? last : frame
  const when = frameAt ? (frameAt.at ? new Date(frameAt.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : `block ${frameAt.block.toLocaleString('en-US')}`) : 'now'
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line px-3 py-2" data-replay="on">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!playing && frame === null) setFrame(0)
            setPlaying(!playing)
          }}
          aria-label={playing ? 'Pause the replay' : 'Play the replay'}
          className="inline-flex size-11 flex-none items-center justify-center rounded-btn border border-kit-lab-gold text-kit-pale-gold"
        >
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <div role="group" aria-label="Replay speed" className="flex gap-1">
          {([1, 4] as const).map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={chip(speed === s)}>
              {s}×
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 font-mono text-[12px] text-kit-text-muted" aria-live="polite">
          {frameAt ? `${when} · top 10 held ${fmtPct(frameAt.top10Pct)}${frameAt.holders !== null ? ` · ${frameAt.holders} holders` : ''}` : `Now · top 10 hold ${fmtPct(m.summary.top10Pct)}`}
        </span>
      </div>
      <label className="flex items-center gap-3 font-mono text-[11px] text-kit-text-dim">
        <span className="flex-none">Replay</span>
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
      <span className="font-mono text-[11px] text-kit-text-dim">Replayed from {m.timeline.basis}.</span>
    </div>
  )
}

/* ---------- side panel ---------- */

function Panel({ n, m, onClose, onPick }: { n: HolderNode; m: HolderMapOk; onClose: () => void; onPick: (id: string) => void }) {
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
    <aside aria-label={`Wallet ${n.short}`} className="flex flex-col gap-3 self-start rounded-[12px] border border-line-strong p-4 animate-[gl-fade_.25s_ease_both]" style={{ background: K.midnight }} data-holder-panel>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-kit-text-dim">WALLET #{n.rank}</span>
          <code className="truncate font-mono text-[14px] text-kit-bone" title={n.id}>
            {n.short}
          </code>
          {n.label && <span className="text-[13px] text-kit-text-muted">{n.label.name}</span>}
        </div>
        <button type="button" onClick={onClose} className="min-h-11 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-kit-text-muted hover:border-kit-lab-gold">
          Close
        </button>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[40px] leading-none font-extrabold text-kit-pale-gold">{fmtPct(n.pct)}</span>
        <span className="font-mono text-[12px] text-kit-text-muted">
          held · {fmtUnits(n.balance)} {m.token.symbol ?? ''}
        </span>
      </div>
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
              {FLAG_TEXT[f]}
            </span>
          ))}
          {n.contract !== null && <span className="rounded-full border border-line-strong px-2 py-[1px] font-mono text-[11px] text-kit-text-muted">{n.contract ? 'Contract' : 'Plain wallet'}</span>}
        </div>
      )}
      {wantDetail && <WalletFacts d={wd} symbol={m.token.symbol} />}
      {cluster && (
        <p className="m-0 text-[13px] leading-[1.5] text-kit-text-muted">
          In cluster {cluster.id.toUpperCase()}: {cluster.count} wallets that sent tokens to each other
          {cluster.hasDeployer ? ', the deployer among them' : ''}, holding {fmtPct(cluster.pct)} together.
        </p>
      )}
      {typeof n.valueAtFairUsd === 'number' && (
        <dl className="m-0 grid grid-cols-2 gap-2 font-mono text-[12px]">
          <dt className="text-kit-text-dim">At the real share price</dt>
          <dd className="m-0 text-right text-kit-bone">{fmtUsd(n.valueAtFairUsd)}</dd>
          {typeof n.premiumUsd === 'number' && (
            <>
              <dt className="text-kit-text-dim">{n.premiumUsd >= 0 ? 'Premium over it' : 'Discount to it'}</dt>
              <dd className="m-0 text-right text-kit-bone">{fmtUsd(n.premiumUsd)}</dd>
            </>
          )}
          {typeof n.boughtGapPct === 'number' && (
            <>
              <dt className="text-kit-text-dim">Paid vs real price</dt>
              <dd className="m-0 text-right text-kit-bone">
                {n.boughtGapPct >= 0 ? '+' : ''}
                {n.boughtGapPct.toFixed(2)}%
              </dd>
            </>
          )}
        </dl>
      )}
      {mine.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-kit-text-dim">LINKS ({mine.length})</span>
          <ul className="m-0 flex max-h-[180px] list-none flex-col gap-1 overflow-y-auto p-0">
            {mine.map((l) => {
              const other = l.source === n.id ? l.target : l.source
              const o = m.nodes.find((x) => x.id === other)
              return (
                <li key={`${l.source}-${l.target}`}>
                  <button
                    type="button"
                    onClick={() => onPick(other)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-left font-mono text-[12px] text-kit-text-muted hover:border-kit-lab-gold"
                  >
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
          className="inline-flex min-h-11 items-center gap-1.5 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-kit-text-muted hover:border-kit-lab-gold"
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} Copy address
        </button>
        <a href={n.url} {...newTab} className="inline-flex min-h-11 items-center gap-1.5 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-kit-text-muted hover:border-kit-lab-gold hover:text-kit-bone">
          <ExternalLink size={13} aria-hidden /> Explorer ↗
        </a>
      </div>
    </aside>
  )
}

/** First buy and P&L vs entry, as the server states them (undefined while reading, null when unreadable). */
function WalletFacts({ d, symbol }: { d: WalletDetail | null | undefined; symbol: string | null }) {
  if (d === undefined) return <div className="h-[52px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[8px]" style={{ background: K.slate }} aria-label="Reading this wallet's trades" role="status" />
  if (!d || d.state !== 'ok') return <p className="m-0 font-mono text-[11px] text-kit-text-dim">This wallet’s trades could not be read just now.</p>
  const fb = d.firstBuy
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[12px]" data-wallet-facts>
      <dt className="text-kit-text-dim">First buy</dt>
      <dd className="m-0 text-right text-kit-bone">{fb ? `${fb.at ? new Date(fb.at).toISOString().slice(0, 16).replace('T', ' ') : `block ${fb.block.toLocaleString('en-US')}`}` : 'never bought from the pool'}</dd>
      {fb && (
        <>
          <dt className="text-kit-text-dim">Bought</dt>
          <dd className="m-0 text-right text-kit-bone">
            {fmtUnits(fb.tokens)} {symbol ?? ''}
            {fb.paid ? ` for ${fb.paid.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${fb.paid.symbol}` : ''}
          </dd>
        </>
      )}
      <dt className="text-kit-text-dim">Buys / sells</dt>
      <dd className="m-0 text-right text-kit-bone">
        {d.buys} / {d.sells}
      </dd>
      <dt className="text-kit-text-dim">P&amp;L vs entry</dt>
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
          <dt className="col-span-2 mt-1 text-kit-text-dim">Also holds launches</dt>
          <dd className="col-span-2 m-0 flex flex-wrap gap-1">
            {d.otherLaunches.slice(0, 6).map((o) => (
              <Link key={`${o.chainKey}:${o.token}`} to={o.path} className="inline-flex min-h-8 items-center rounded-full border border-line-strong px-2 text-[11px] text-kit-pale-gold hover:border-kit-lab-gold">
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
                <td>{n.flags.map((f) => FLAG_TEXT[f]).join(', ')}</td>
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
          <button
            type="button"
            onClick={() => onSelect(n.id)}
            aria-pressed={selected === n.id}
            className={`flex min-h-11 w-full items-center gap-2 rounded-[8px] border px-2 text-left font-mono text-[12px] ${selected === n.id ? 'border-kit-lab-gold' : 'border-line'} animate-[gl-fade_.3s_ease_both]`}
          >
            <span className="w-7 flex-none text-kit-text-dim">{n.rank}</span>
            <span
              aria-hidden
              className="inline-block size-2.5 flex-none rounded-full"
              style={{
                background: isInfra(n) ? K.slate : n.cluster ? K.gold : n.label?.kind === 'deployer' ? K.moss : K.muted,
              }}
            />
            <span className="min-w-0 flex-1 truncate text-kit-bone">{n.label?.name ?? n.short}</span>
            {n.flags.includes('bundled') && <span className="flex-none text-[11px] text-error">BUNDLED</span>}
            <span className="w-16 flex-none text-right text-kit-pale-gold">{fmtPct(n.pct)}</span>
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
        <div key={c.k} className="flex flex-col gap-1 px-4 py-3" style={{ background: K.midnight }}>
          <dt className="font-mono text-[11px] tracking-[1px] text-kit-text-dim">{c.k}</dt>
          <dd className="m-0 font-display text-[24px] leading-none font-bold text-kit-bone">{c.v}</dd>
          {c.n && <span className="font-mono text-[11px] text-kit-text-dim">{c.n}</span>}
        </div>
      ))}
    </dl>
  )
}

/* ---------- trade ---------- */

function Trade({ m, embed, tradeHref, onTrade, pageUrl }: { m: HolderMapOk; embed: boolean; tradeHref?: string | null; onTrade?: () => void; pageUrl: string }) {
  if (tradeHref === null) return null
  const sym = m.token.symbol ?? 'this token'
  const launch = m.kind === 'deepcore-launch'
  const net = { robinhood: 'robinhood', bsc: 'bsc', base: 'base', hyperevm: 'hyperevm' }[m.chain.key] ?? m.chain.key
  const href = embed ? pageUrl : (tradeHref ?? (launch ? `https://deepcore.fun/app/swap?net=${net}&in=0x0000000000000000000000000000000000000000&out=${m.token.address}` : `/tracker/${m.chain.key}/${sym}#swap`))
  const external = embed || /^https?:/.test(href)
  const note = launch ? `Opens DeepCore’s own swap; Gully Labs takes no fee there.` : m.chain.key === 'solana' ? jupiterFeeText() : feeText()
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line-strong p-4" style={{ background: K.midnight }} data-holder-trade>
      <p className="m-0 text-[14px] leading-[1.5] text-kit-bone">
        <b className="font-semibold">Before you trade:</b> {m.forensics?.riskLine ? `${m.forensics.riskLine} ` : ''}
        {m.summary.line}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={href}
          {...(external ? newTab : {})}
          onClick={() => onTrade?.()}
          className="inline-flex min-h-11 items-center gap-2 rounded-btn px-5 font-semibold text-kit-lab-night transition-[filter] hover:brightness-110"
          style={{ background: K.gold }}
        >
          Buy or sell {sym}
          {external ? ' ↗' : ''}
        </a>
        <span className="font-mono text-[11px] text-kit-text-dim">{embed ? 'Opens Gully Labs.' : note}</span>
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
