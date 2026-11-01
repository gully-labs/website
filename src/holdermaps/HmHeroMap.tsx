/* The holdermaps.xyz hero: a real map, drawn by the same canvas as the token page (BubbleCanvas, its own lazy chunk, so
   the headline and the search paint first). It shows today's most scanned token; on a day nobody has scanned one yet it
   shows an example, labelled as one, and every figure is still read live (?peek=1, so reading it here never counts as a
   scan). Under it: what the map found, in the server's own words, and the clusters as chips that light their wallets.
   A candidate that cannot be read, or with too few wallets to show a map, gives way to the next one. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, CircleCheck } from 'lucide-react'
import { ChainLogo } from '../components/logos/ChainLogo'
import { useLiveSeries } from '../components/charts/useLiveSeries'
import { useReducedMotion } from '../components/charts/chart-utils'
import type { BLink, BNode, BTip, } from '../components/holders/BubbleCanvas'
import { forceLayout, radiusFor } from '../components/holders/layout'
import { fmtPct as fmtShare, norm } from '../components/holders/format'
import { captionOf, glyphOf } from '../components/holders/motion'
import { clusterHue, KIND_HUE, KIND_WORD, shade, textOn, WALLET_HUE, type KindKey } from '../components/holders/palette'
import { isInfraNode, kindKeyOf } from '../components/holders/supply'
import { K } from '../components/holders/theme'
import { Count } from '../console/ui'
import type { HolderMap, HolderMapOk, TopScanned } from '../lib/holders'
import { ageText } from '../lib/tracker'
import { holderHref } from '../site-host'
import { useBoxWidth, useNow } from './hooks'
import { NotReadable } from './charts'
import { CHAIN_NAMES, fmtInt, fmtPct } from './insights'
import { Mascot } from './Mascot'

const BubbleCanvas = lazy(() => import('../components/holders/BubbleCanvas'))

type Pick = { chain: string; token: string; symbol: string | null; path: string; note: string }
const hop = (chain: string, token: string, symbol: string): Pick => ({ chain, token, symbol, path: `/holders/${chain}/${token}`, note: 'Example' })

/** Examples for a day with no scans, richest first; Gully Chain's is on the testnet and says so. Also the search's "Try". */
export const EXAMPLES: (Pick & { label: string })[] = [
  { ...hop('robinhood', 'AAPL', 'AAPL'), label: 'AAPL' },
  { ...hop('robinhood', 'NVDA', 'NVDA'), label: 'NVDA' },
  { ...hop('gully', '0xf0fd2800d4d6201857c674369411a7536e633008', 'PILLAR'), label: 'PILLAR · testnet' },
]
const MIN_WALLETS = 8
const chainName = (c: string) => (c === 'gully' ? 'Gully Chain testnet' : (CHAIN_NAMES[c] ?? c))

/** Bubbles and links for the canvas, the same rules as the token page's map, at the current shares. */
function toCanvas(m: HolderMapOk, max: number, portrait: boolean) {
  const graph = m.nodes.filter((n) => typeof n.pct === 'number').slice(0, max)
  const top = Math.max(0.0001, ...graph.map((n) => n.pct ?? 0))
  const on = new Set(graph.map((n) => n.id))
  const links = m.links.filter((l) => on.has(norm(l.source)) && on.has(norm(l.target)))
  const placed = new Map(forceLayout(graph.map((n) => ({ id: n.id, r: radiusFor(n.pct, top) })), links.map((l) => ({ source: norm(l.source), target: norm(l.target) }))).map((p) => [p.id, p]))
  const idx = new Map(m.clusters.map((c, i) => [c.id, i]))
  const top10 = new Set(m.nodes.filter((n) => !isInfraNode(n)).slice(0, 10).map((n) => n.id))
  const nodes: BNode[] = graph.map((n) => {
    const p = placed.get(n.id)
    const infra = isInfraNode(n)
    const kind = kindKeyOf(n)
    const hue = kind && (infra || kind === 'deployer') ? KIND_HUE[kind] : n.cluster && idx.has(n.cluster) ? clusterHue(idx.get(n.cluster) ?? 0) : WALLET_HUE
    const bundled = n.flags.includes('bundled')
    const isTop = top10.has(n.id)
    return {
      id: n.id,
      x: (portrait ? p?.y : p?.x) ?? 0,
      y: (portrait ? p?.x : p?.y) ?? 0,
      r: radiusFor(n.pct, top),
      fitR: p?.r,
      hue,
      rim: bundled ? K.warn : isTop ? shade(hue, 0.62) : shade(hue, 0.28),
      rimWidth: bundled ? 2.5 : isTop ? 2.6 : 1.2,
      dashed: bundled,
      glow: !!n.cluster && !infra,
      text: fmtShare(n.pct),
      textColour: textOn(hue),
      glyph: glyphOf(n),
      logo: null,
      caption: captionOf(n),
      kindText: kind ? KIND_WORD[kind] : 'wallet',
      pulse: n.label?.kind === 'pool' || n.label?.kind === 'lock' || n.label?.kind === 'token',
      group: n.cluster && !infra ? `c:${n.cluster}` : null,
    }
  })
  const blinks: BLink[] = links.flatMap((l) => {
    const a = norm(l.source)
    const b = norm(l.target)
    const ca = m.nodes.find((n) => n.id === a)?.cluster
    const inCluster = ca && ca === m.nodes.find((n) => n.id === b)?.cluster && idx.has(ca)
    const via = l.kind === 'via'
    const base = { colour: via ? K.muted : l.kind === 'funding' ? K.pale : inCluster ? clusterHue(idx.get(ca) ?? 0) : K.gold, dashed: via || l.kind === 'funding', width: via ? 1 : Math.min(4, 1 + Math.log2(1 + l.transfers) * 0.6), particles: !via, strength: via ? 0.1 : Math.min(1, Math.log2(1 + l.transfers) / 6) }
    return l.direction === 'backward' ? [{ ...base, a: b, b: a }] : [{ ...base, a, b }]
  })
  return { nodes, links: blinks, shown: new Set(graph.map((n) => n.id)) }
}

function Stage({ pick, onBad, last }: { pick: Pick; onBad: () => void; last: boolean }) {
  const { data, error } = useLiveSeries<HolderMap>(
    (signal) => fetch(`/api/holders/${encodeURIComponent(pick.chain)}/${encodeURIComponent(pick.token)}?peek=1`, { headers: { accept: 'application/json' }, signal }).then((r) => r.json() as Promise<HolderMap>),
    300_000,
    { enabled: true },
  )
  const m = data && data.state === 'ok' ? data : null
  const bad = !!error || (!!data && data.state !== 'ok') || (!!m && m.nodes.length < MIN_WALLETS)
  useEffect(() => {
    if (bad && !last) onBad()
  }, [bad, last, onBad])
  if (m && (last || m.nodes.length >= MIN_WALLETS)) return <Loaded m={m} pick={pick} />
  if (bad && last) return <NotReadable text="This map could not be read just now; it retries every five minutes. Paste a token to read another." height={320} />
  return (
    <div className="hmh-load" role="status" aria-label="Reading the map">
      <Mascot pose="laptop" width={96} />
      <span>Reading the chain…</span>
    </div>
  )
}

function Loaded({ m, pick }: { m: HolderMapOk; pick: Pick }) {
  const reduced = useReducedMotion()
  const now = useNow(30_000)
  const [box, w] = useBoxWidth<HTMLDivElement>(800)
  const phone = w < 600
  const c = useMemo(() => toCanvas(m, phone ? 36 : 72, phone), [m, phone])
  const [selected, setSelected] = useState<string | null>(null)
  const [lit, setLit] = useState<string | null>(null)
  const clusters = useMemo(() => m.clusters.map((x, i) => ({ ...x, i })).filter((x) => x.wallets.some((id) => c.shown.has(norm(id)))).slice(0, 4), [m, c])
  const litSet = useMemo(() => {
    const f = lit ? clusters.find((x) => x.id === lit) : null
    return f ? new Set(f.wallets.map(norm)) : null
  }, [lit, clusters])
  const byId = useMemo(() => new Map(m.nodes.map((n) => [n.id, n])), [m])
  const tip = useCallback(
    (id: string): BTip | null => {
      const n = byId.get(id)
      if (!n) return null
      const kind = kindKeyOf(n)
      return { title: n.label?.name ?? n.short, rows: [['Held', n.pct === null ? 'not readable' : fmtShare(n.pct)], ['Kind', kind ? KIND_WORD[kind as KindKey] : 'wallet'], ['Rank', `#${n.rank}`]] }
    },
    [byId],
  )
  const sym = m.token.symbol ? `$${m.token.symbol}` : 'This token'
  const to = holderHref(pick.path)
  const biggest = m.summary.largestCluster
  return (
    <div className="hmh-panel" data-hero-map>
      <header className="hmh-head">
        <span className="hmh-tok">
          <ChainLogo chain={pick.chain} size={16} decorative />
          <b>{sym}</b>
          <span className="c">{chainName(pick.chain)}</span>
          <em className={pick.note === 'Example' ? 'ex' : ''}>{pick.note}</em>
        </span>
        <span className="hmh-age">
          <i className="hm-dot" aria-hidden /> read {ageText(m.asOf, now)}
        </span>
        <Link className="hm-btn ghost hmh-open" to={to}>
          Open the full map <ArrowRight aria-hidden className="hm-ic" />
        </Link>
      </header>
      <div className="hmh-canvas" ref={box} data-map-stage>
        <Suspense fallback={<div className="hmh-load" role="status" aria-label="Drawing the map" />}>
          <BubbleCanvas nodes={c.nodes} links={c.links} highlight={litSet} ringed={litSet} selected={selected} reduced={reduced} label={`Holder Map of ${m.token.symbol ?? 'this token'} on ${m.chain.name}: ${m.summary.line}`} height="100%" tip={tip} onSelect={(id) => setSelected(id)} padBottom={8} />
        </Suspense>
      </div>
      {clusters.length > 0 && (
        <ul className="hmh-clusters" aria-label="Linked clusters: tap one to light its wallets">
          {clusters.map((x) => (
            <li key={x.id}>
              <button type="button" aria-pressed={lit === x.id} onClick={() => setLit(lit === x.id ? null : x.id)}>
                <i style={{ background: clusterHue(x.i) }} aria-hidden />
                Cluster {x.id.toUpperCase()} · {x.count} wallets{x.pct === null ? '' : ` · ${fmtPct(x.pct)}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="hmh-found">
        <dl className="hmh-facts">
          <div>
            <dt>Top 10 hold</dt>
            <dd>
              <Count value={m.summary.top10Pct} fmt={fmtPct} />
            </dd>
          </div>
          <div>
            <dt>Biggest cluster</dt>
            <dd>{biggest ? <Count value={biggest.pct} fmt={fmtPct} /> : <span className="num">none</span>}</dd>
          </div>
          <div>
            <dt>Holders</dt>
            <dd>
              <Count value={m.holders.count} fmt={fmtInt} />
            </dd>
          </div>
        </dl>
        <div className="hmh-plain">
          <h2>What it found</h2>
          <ul>
            {(m.summary.plain.length ? m.summary.plain : [m.summary.line]).slice(0, 3).map((t) => (
              <li key={t}>
                <CircleCheck aria-hidden className="hm-ic" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** Today's most scanned token if there is one, else the examples in turn. */
export function HmHeroMap({ top }: { top: TopScanned['items'][number] | null }) {
  const list = useMemo<Pick[]>(() => [...(top ? [{ chain: top.chain, token: top.token, symbol: top.symbol, path: top.path, note: 'Most scanned today' }] : []), ...EXAMPLES], [top])
  const [skip, setSkip] = useState(new Set<string>())
  const left = list.filter((p) => !skip.has(`${p.chain}:${p.token}`))
  const pick = left[0] ?? list[list.length - 1]
  const onBad = useCallback(() => setSkip((s) => new Set(s).add(`${pick.chain}:${pick.token}`)), [pick.chain, pick.token])
  return <Stage key={`${pick.chain}:${pick.token}`} pick={pick} onBad={onBad} last={left.length <= 1} />
}
