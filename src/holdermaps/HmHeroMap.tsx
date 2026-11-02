/* The holdermaps.xyz hero: a real map, drawn by the same canvas as the token page (BubbleCanvas, its own lazy chunk, so
   the headline and the search paint first). GET /api/holders/hero answers at once with a kept copy of an example's map,
   labelled as an example with the time it was read; when a token has been scanned today its map replaces it as soon as
   it answers (?peek=1, so reading it here never counts as a scan). Under it: what the map found, in the server's own
   words, and the clusters as chips that light their wallets. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, CircleCheck } from 'lucide-react'
import { ChainLogo } from '../components/logos/ChainLogo'
import { useLiveSeries } from '../components/charts/useLiveSeries'
import { useReducedMotion } from '../components/charts/chart-utils'
import type { BLink, BNode, BTip } from '../components/holders/BubbleCanvas'
import { forceLayout, radiusFor } from '../components/holders/layout'
import { fmtPct as fmtShare, norm } from '../components/holders/format'
import { captionOf, glyphOf } from '../components/holders/motion'
import { clusterHue, KIND_HUE, KIND_WORD, shade, textOn, WALLET_HUE, type KindKey } from '../components/holders/palette'
import { isInfraNode, kindKeyOf } from '../components/holders/supply'
import { K } from '../components/holders/theme'
import { Count, Spark } from '../console/ui'
import type { HolderMap, HolderMapOk, TopScanned } from '../lib/holders'
import { ageText } from '../lib/tracker'
import { holderHref } from '../site-host'
import { useBoxWidth, useNow } from './hooks'
import { NotReadable } from './charts'
import { CHAIN_NAMES, fmtInt, fmtPct, timelineSeries } from './insights'
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
  const tl = useMemo(() => timelineSeries(m), [m])
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
              {tl.top10 && (
                <span className="sp" aria-hidden>
                  <Spark values={tl.top10} color="#FFD52E" h={24} />
                </span>
              )}
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
              {tl.holders && (
                <span className="sp" aria-hidden>
                  <Spark values={tl.holders} color="#FFD52E" h={24} />
                </span>
              )}
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

type Hero = (HolderMapOk & { pick: { chain: string; token: string } }) | { state: 'reading' }

const getJson = <T,>(url: string, signal: AbortSignal) => fetch(url, { headers: { accept: 'application/json' }, signal }).then((r) => r.json() as Promise<T>)

/** Today's most scanned token once it answers; until then, and on a day without scans, the kept example. */
export function HmHeroMap({ top }: { top: TopScanned['items'][number] | null }) {
  const [waiting, setWaiting] = useState(true)
  const hero = useLiveSeries<Hero>((signal) => getJson<Hero>('/api/holders/hero', signal), waiting ? 8_000 : 300_000)
  const scanned = useLiveSeries<HolderMap>((signal) => getJson<HolderMap>(`/api/holders/${encodeURIComponent(top?.chain ?? '')}/${encodeURIComponent(top?.token ?? '')}?peek=1`, signal), 300_000, { enabled: !!top })
  const example = hero.data && hero.data.state === 'ok' ? hero.data : null
  useEffect(() => {
    if (example) setWaiting(false)
  }, [example])
  const best = top && scanned.data && scanned.data.state === 'ok' && scanned.data.nodes.length >= MIN_WALLETS ? scanned.data : null
  if (best && top) return <Loaded key={`${top.chain}:${top.token}`} m={best} pick={{ chain: top.chain, token: top.token, symbol: top.symbol, path: top.path, note: 'Most scanned today' }} />
  if (example) {
    const { chain, token } = example.pick
    return <Loaded key={`${chain}:${token}`} m={example} pick={hop(chain, token, example.token.symbol ?? '')} />
  }
  if (hero.error) return <div className="hmh-panel"><NotReadable text="The map could not be read just now; it retries by itself. Paste a token to read another." height={320} /></div>
  return (
    <div className="hmh-panel">
      <div className="hmh-load" role="status" aria-label="Reading the map">
        <Mascot pose="laptop" width={96} />
        <span>Reading the chain. The first read of a big token can take a minute.</span>
      </div>
    </div>
  )
}
