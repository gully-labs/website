/* The gullylabs.xyz landing, "Constellation" (owner pick, 2026-10-27; replaces landing v3). Gully Labs as the studio
   behind one connected suite: the eight products as a live map around Gully Chain (solid links are live integrations,
   dashed ones flagged or planned), a live reading on every node and a drawer per product; below, one tabbed board
   (live board, what's new, all products, work with us, contact) so the page stays near 1.5 screens.
   Every figure is read live (src/pages/hub/hubData.ts adapters): /api/hub, /api/hub/products, /api/stats and
   /api/hub/live. A source that cannot be read says so. Toasts only on real events seen between two polls. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Activity, ArrowRight, ArrowUpRight, Blocks, Briefcase, ChartSpline, ChevronRight, CircleCheck, CircleDot, CreditCard, ExternalLink, FingerprintPattern, Hammer, Info, MessageSquare, Newspaper, Orbit, Send, Table2, Trophy, X, type LucideIcon } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { useLive } from '../../console/live'
import { consoleToast } from '../../console/toast'
import { Spark } from '../../console/ui'
import '../../terminal/terminal.css'
import { A, TChart, UptimeGrid, useHubProducts, type ChartTab } from '../../terminal/kit'
import { ContactForm, Process, ServicesList } from '../../terminal/sections'
import './constellation.css'
import { useHubLive } from './useHubLive'
import { changes, curve, EDGES, fmtNum, HUB_PRODUCTS, JOURNEY, kpiText, LAYERS, liveEvents, MAP, NEWS, productOf, readings, seenOf, STATUS_LABEL, suite, ago,  type ProductKey, type Reading, type Seen, type Sources } from './hubData'

const fmtUsd = (v: number | null) => (v == null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
const tagOf = (s: string) => (s === 'live' ? 'live' : s === 'soon' || s === 'rolling out' || s === 'coming soon' ? 'soon' : 'new')

/* ---------------------------------------------------------------- the map ---- */
/** A node's one-line reading when it has no KPI: the short note, never a sentence cut mid-word (the full `why` stays
    in the node's aria-label, its title and the drawer). Nodes sit about 300 map units apart, so 22 characters is the cap. */
function mapNote(rd: Reading) {
  const t = rd.note ?? (rd.why && /unreadable/i.test(rd.why) ? 'source unreadable' : rd.why) ?? '…'
  if (t.length <= 22) return t
  const cut = t.slice(0, 22)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).replace(/[\s,:·]+$/, '')}…`
}

function ConstellationMap({ R, onOpen, hot, setHot }: { R: Record<ProductKey, Reading>; onOpen: (k: ProductKey, from: Element) => void; hot: { keys: ProductKey[]; nb: boolean } | null; setHot: (h: { keys: ProductKey[]; nb: boolean } | null) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTall(el.clientWidth < 520))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const L = tall ? MAP.tall : MAP.wide
  const c = L.at.chain
  // which nodes and links are lit: a journey path, or one product and its neighbours
  const lit = useMemo(() => {
    if (!hot) return null
    const on = new Set<ProductKey>(hot.keys)
    const edges = new Set<number>()
    EDGES.forEach(([a, b], i) => {
      const path = !hot.nb && hot.keys.includes(a) && hot.keys.includes(b)
      const nb = hot.nb && (hot.keys.includes(a) || hot.keys.includes(b))
      if (path || nb) {
        edges.add(i)
        if (nb) on.add(a).add(b)
      }
    })
    return { on, edges }
  }, [hot])
  return (
    <div className="cst-map" ref={box}>
      <img className="cst-field" src="/brand/hub/art/hero-field.svg" alt="" width={1200} height={760} />
      <svg viewBox={`0 0 ${L.vb[0]} ${L.vb[1]}`} role="group" aria-label="The eight Gully products as a connected map. Each product is a button that opens its live details.">
        <defs>
          {HUB_PRODUCTS.map((p) => (
            <clipPath key={p.key} id={`cst-cp-${p.key}`}>
              <circle r={(p.key === 'chain' ? L.rc : L.r) - 5} />
            </clipPath>
          ))}
        </defs>
        <g>
          {EDGES.map(([a, b, kind, label], i) => (
            <path key={`${a}-${b}`} id={`cst-e${i}`} className={`edge ${kind}${lit ? (lit.edges.has(i) ? ' hot' : ' dim') : ''}`} d={curve(L.at[a], L.at[b], c)}>
              <title>{`${productOf(a).name} → ${productOf(b).name}: ${label}`}</title>
            </path>
          ))}
          {EDGES.map(([, , kind], i) =>
            kind === 'live' ? (
              <circle key={`s${i}`} className="spark" r={2.4}>
                <animateMotion dur={`${3 + (i % 4) * 0.7}s`} repeatCount="indefinite" begin={`${(i * 0.37).toFixed(2)}s`}>
                  <mpath href={`#cst-e${i}`} />
                </animateMotion>
              </circle>
            ) : null,
          )}
        </g>
        {HUB_PRODUCTS.map((p) => {
          const r = p.key === 'chain' ? L.rc : L.r
          const at = L.at[p.key]
          const rd = R[p.key]
          const metric = p.key === 'chain' && rd.kpi ? `block ${fmtNum(rd.kpi.v)}` : rd.kpi ? `${kpiText(rd.kpi)} ${rd.kpi.short}` : mapNote(rd)
          const cls = ['node', p.status === 'soon' ? 'is-soon' : rd.state === 'up' ? 'is-up' : '', lit ? (lit.on.has(p.key) ? 'hot' : 'dim') : ''].join(' ')
          return (
            <g
              key={p.key}
              className={cls}
              role="button"
              tabIndex={0}
              style={{ ['--c' as string]: p.color }}
              transform={`translate(${at[0]} ${at[1]})`}
              aria-label={`${p.name}, ${STATUS_LABEL[p.status]}. ${rd.kpi ? `${kpiText(rd.kpi)} ${rd.kpi.label}` : (rd.why ?? '')}. Open details.`}
              onClick={(e) => onOpen(p.key, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(p.key, e.currentTarget)
                }
              }}
              onPointerEnter={() => setHot({ keys: [p.key], nb: true })}
              onPointerLeave={() => setHot(null)}
              onFocus={() => setHot({ keys: [p.key], nb: true })}
              onBlur={() => setHot(null)}
            >
              <title>{`${p.name}: ${rd.kpi ? `${kpiText(rd.kpi)} ${rd.kpi.label}` : (rd.why ?? '')}`}</title>
              <circle className="ring" r={r + 2} />
              <circle className="halo" r={r} />
              <image href={p.icon} x={-(r - 5)} y={-(r - 5)} width={2 * (r - 5)} height={2 * (r - 5)} clipPath={`url(#cst-cp-${p.key})`} preserveAspectRatio="xMidYMid slice" />
              <text className={`st ${p.status}`} y={-r - 8} textAnchor="middle">
                {STATUS_LABEL[p.status]}
              </text>
              <text className="nm" y={r + 17} textAnchor="middle">
                {p.name}
              </text>
              <text className="mt" y={r + 32} textAnchor="middle">
                {metric}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="cst-legend">
        <span>
          <i className="lg" />
          live link
        </span>
        <span>
          <i className="lg plan" />
          planned or flagged
        </span>
        <span className="hint">
          <CircleDot className="gt-ic" aria-hidden />
          Click a product
        </span>
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- the drawer ---- */
function Drawer({ k, R, onClose }: { k: ProductKey | null; R: Record<ProductKey, Reading>; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!k) return
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.cst-x')?.focus(), 60)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !ref.current) return
      const f = ref.current.querySelectorAll<HTMLElement>('a,button')
      if (!f.length) return
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault()
        f[f.length - 1].focus()
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault()
        f[0].focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [k, onClose])
  const p = k ? productOf(k) : null
  const r = k ? R[k] : null
  const conns = k ? EDGES.filter(([a, b]) => a === k || b === k) : []
  const tab: ChartTab | null =
    r?.series && p
      ? { id: 'd', label: r.series.name, title: r.series.name, series: [{ name: r.series.unit, color: '#00D2FF', values: r.series.rows.map((x) => x.v) }], labels: r.series.rows.map((x) => x.x), fmt: (v) => (v == null ? '—' : `${fmtNum(v)} ${r.series?.unit}`), integer: r.series.unit !== 'ms', empty: 'no data points yet' }
      : null
  return (
    <>
      {k && <div className="cst-scrim" onClick={onClose} aria-hidden />}
      <aside ref={ref} className={`cst-drawer${k ? ' on' : ''}`} role="dialog" aria-modal="true" aria-hidden={!k} aria-labelledby="cst-d-name">
        {p && r && (
          <div className="cst-d">
            <div className="cst-d-top">
              <img src={p.icon} alt="" width={44} height={44} />
              <div>
                <h2 id="cst-d-name">{p.name}</h2>
                <small>
                  {p.domain}
                  {p.iconNote ? ` · ${p.iconNote}` : ''}
                </small>
              </div>
              <button type="button" className="gt-btn sec sm cst-x" aria-label="Close" onClick={onClose}>
                <X className="gt-ic" aria-hidden />
              </button>
            </div>
            <div>
              <span className={`cst-tag ${tagOf(p.status)}`}>{STATUS_LABEL[p.status]}</span>
            </div>
            <p className="cst-d-line">{p.line}</p>
            <p className="cst-d-about">{p.about}</p>
            {r.kpi ? (
              <div className="cst-d-kpi">
                <b className="num">{kpiText(r.kpi)}</b>
                <span>{r.kpi.label}</span>
              </div>
            ) : (
              <p className="cst-d-why">
                <Info className="gt-ic" aria-hidden /> {r.why ?? 'No live reading yet'}
              </p>
            )}
            {tab && <TChart label={r.series?.name} tabs={[tab]} height={130} />}
            {r.source && <p className="cst-src">Source: {r.source}</p>}
            {r.extra.length > 0 && (
              <dl className="cst-d-extra">
                {r.extra.map(([a, b]) => (
                  <div key={a}>
                    <dt>{a}</dt>
                    <dd className="num">{b == null ? '–' : typeof b === 'number' ? fmtNum(b) : b}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div>
              <p className="gt-k">Live now</p>
              <ul className="cst-d-list ok">
                {p.live.map((x) => (
                  <li key={x}>
                    <CircleCheck className="gt-ic" aria-hidden />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
            {p.next.length > 0 && (
              <div>
                <p className="gt-k">Building</p>
                <ul className="cst-d-list next">
                  {p.next.map((x) => (
                    <li key={x}>
                      <Hammer className="gt-ic" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="gt-k">Connects to</p>
              <div className="cst-d-conn">
                {conns.map(([a, b, kind, label]) => (
                  <span key={`${a}-${b}`}>
                    <b>{productOf(a === k ? b : a).name}</b> · {label}
                    {kind === 'plan' && <span className="cst-tag soon">planned</span>}
                  </span>
                ))}
              </div>
            </div>
            <div className="cst-d-links">
              <A href={p.url} className="gt-btn pri sm">
                Open {p.domain}
                <ArrowUpRight className="gt-ic" aria-hidden />
              </A>
              <Link to={`/products/${p.page}`} className="gt-btn sec sm" onClick={onClose}>
                Product page
                <ArrowRight className="gt-ic" aria-hidden />
              </Link>
              {p.pages?.map(([l, slug]) => (
                <Link key={slug} to={`/products/${slug}`} className="gt-btn sec sm" onClick={onClose}>
                  {l}
                  <ArrowRight className="gt-ic" aria-hidden />
                </Link>
              ))}
              {p.links.map(([l, h]) => (
                <A key={h} href={h} className="gt-btn sec sm">
                  {l}
                  <ExternalLink className="gt-ic" aria-hidden />
                </A>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

/* ---------------------------------------------------------------- the board ---- */
type TabId = 'live' | 'news' | 'products' | 'work' | 'contact'
const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'live', label: 'Live board', icon: Activity },
  { id: 'news', label: "What's new", icon: Newspaper },
  { id: 'products', label: 'All products', icon: Table2 },
  { id: 'work', label: 'Work with us', icon: Briefcase },
  { id: 'contact', label: 'Contact', icon: MessageSquare },
]
const HASH: Record<string, TabId> = { '#live': 'live', '#news': 'news', '#products': 'products', '#work': 'work', '#services': 'work', '#contact': 'contact' }

function LiveBoard({ src, R }: { src: Sources; R: Record<ProductKey, Reading> }) {
  const ev = liveEvents(src)
  const chainRows = R.chain.series?.rows ?? []
  const idRows = R.id.series?.rows ?? []
  const tabs: ChartTab[] = [
    { id: 'chain', label: 'Chain txs', title: 'Gully Chain transactions per hour (UTC)', series: [{ name: 'Transactions', color: '#00D2FF', values: chainRows.map((r) => r.v) }], labels: chainRows.map((r) => r.x), fmt: (v) => fmtNum(v), integer: true, state: src.products ? 'ok' : 'loading', empty: 'indexer unreadable right now', sub: 'source: /api/hub/products (Gully Chain RPC and indexer)', legendTotal: chainRows.length ? `${chainRows.length} h total` : undefined },
    { id: 'id', label: 'ID sign-ins', title: 'Gully ID sign-ins per hour (UTC)', series: [{ name: 'Sign-ins', color: '#00D2FF', values: idRows.map((r) => r.v) }], labels: idRows.map((r) => r.x), fmt: (v) => fmtNum(v), integer: true, state: src.live?.id ? 'ok' : src.live ? 'offline' : 'loading', empty: 'Gully ID stats unreadable right now', sub: 'source: gullyid.xyz/v1/stats/public', legendTotal: idRows.length ? `${idRows.length} h total` : undefined },
  ]
  const s = suite(src)
  return (
    <div className="cst-live">
      <section className="cst-cell">
        <header>
          <span className="gt-k">Uptime · last checks</span>
          <span className="gt-k">{s.up == null ? '—' : `${s.up}/${s.total} up`}</span>
        </header>
        <UptimeGrid hub={src.hub} keys={['gully-id', 'chain-site', 'pay', 'rpc-gateway', 'holders', 'security', 'studio', 'gullyai']} compact />
      </section>
      <div className="cst-cell-chart">
        <TChart label="Live across the suite" tabs={tabs} height={190} />
      </div>
      <section className="cst-cell">
        <header>
          <span className="gt-k">Happening now</span>
          <span className="gt-k">real events only</span>
        </header>
        {ev.length ? (
          <ol className="cst-events">
            {ev.map((e) => (
              <li key={`${e.at}${e.t}`}>
                {e.kind === 'signin' ? <FingerprintPattern className="gt-ic" aria-hidden /> : e.kind === 'quest' ? <Trophy className="gt-ic" aria-hidden /> : <Blocks className="gt-ic" aria-hidden />}
                <div>
                  {e.href ? <A href={e.href}>{e.t}</A> : e.t}
                  <time dateTime={e.at}>
                    {productOf(e.p).name} · {ago(e.at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="cst-empty">{src.hub || src.live ? 'No events in the sources yet' : 'Reading the sources…'}</p>
        )}
      </section>
    </div>
  )
}

function News() {
  const [f, setF] = useState<ProductKey | 'all'>('all')
  const keys = HUB_PRODUCTS.filter((p) => NEWS.some((n) => n.p === p.key))
  return (
    <div className="cst-news">
      <div className="cst-news-side">
        <img src="/brand/hub/art/news.svg" alt="" width={560} height={120} />
        <p className="gt-k">Filter</p>
        <div className="cst-seg" role="group" aria-label="Filter news by product">
          <button type="button" aria-pressed={f === 'all'} onClick={() => setF('all')}>
            All
          </button>
          {keys.map((p) => (
            <button key={p.key} type="button" aria-pressed={f === p.key} onClick={() => setF(p.key)}>
              {p.name.replace('Gully ', '')}
            </button>
          ))}
        </div>
        <p className="cst-note">Every item is live or shipped this week. Dates are UTC.</p>
      </div>
      <ol className="cst-news-list">
        {NEWS.filter((n) => f === 'all' || n.p === f).map((n) => {
          const p = productOf(n.p)
          return (
            <li key={n.t}>
              <time dateTime={n.d}>{new Date(`${n.d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>
              <img src={p.icon} alt="" width={24} height={24} />
              <div>
                <A href={n.href}>{n.t}</A>
                <span className="pn">{p.name}</span>
              </div>
              <span className={`cst-tag ${tagOf(n.s)}`}>{n.s}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ProductTable({ R, open }: { R: Record<ProductKey, Reading>; open: (k: ProductKey, from: Element) => void }) {
  const LN = Object.fromEntries(LAYERS.map((l) => [l.key, l.name]))
  return (
    <div className="cst-table-wrap">
      <table className="cst-table">
        <caption className="sr-only">Every Gully product with its live reading</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" className="hide-s">
              Layer
            </th>
            <th scope="col">Status</th>
            <th scope="col">Live reading</th>
            <th scope="col" className="hide-s">
              Trend
            </th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {HUB_PRODUCTS.map((p) => {
            const r = R[p.key]
            const vals = r.series?.rows.map((x) => x.v) ?? []
            return (
              <tr key={p.key}>
                <td>
                  <Link className="cst-pn" to={`/products/${p.page}`}>
                    <img src={p.icon} alt="" width={26} height={26} />
                    <span>
                      {p.name}
                      <small>{p.domain}</small>
                    </span>
                  </Link>
                </td>
                <td className="hide-s">{LN[p.layer]}</td>
                <td>
                  <span className={`cst-tag ${tagOf(p.status)}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td className="cst-rd">
                  {r.kpi ? (
                    <>
                      <b className="num">{kpiText(r.kpi)}</b>
                      <span>{r.kpi.label}</span>
                    </>
                  ) : (
                    <span>{r.why ?? 'No data yet'}</span>
                  )}
                </td>
                <td className="hide-s cst-trend">
                  {vals.length >= 2 ? (
                    <>
                      <Spark values={vals} color="#00D2FF" h={26} />
                      <span>{r.series?.unit === 'ms' ? 'site response time' : `${r.series?.unit} per ${r.series?.name.includes('day') ? 'day' : 'hour'}`}</span>
                    </>
                  ) : (
                    <span>–</span>
                  )}
                </td>
                <td>
                  <button type="button" className="gt-btn sec sm" onClick={(e) => open(p.key, e.currentTarget)}>
                    <ChevronRight className="gt-ic" aria-hidden />
                    Details
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// The venues line: Peddles, PeddleSwap and PeddleQuest only. /api/stats still reads a `deepcore` venue, but that is
// DeepCore's own cross-chain API (deepcore.fun), not Gully Core, and the partnership ended 2026-10-29, so it is left
// out of the sum and the names rather than relabelled.
const BUILT = ['peddles', 'peddleswap', 'peddlequest'] as const
function builtVenues(src: Sources) {
  const vs = (src.stats?.venues ?? []).filter((v) => (BUILT as readonly string[]).includes(v.key) && v.state === 'ok') as { tvlUsd?: number | null; volumeAllUsd?: number | null; feesAllUsd?: number | null }[]
  const add = (k: 'tvlUsd' | 'volumeAllUsd' | 'feesAllUsd') => (vs.some((v) => typeof v[k] === 'number') ? vs.reduce((n, v) => n + (typeof v[k] === 'number' ? (v[k] as number) : 0), 0) : null)
  return vs.length ? { tvl: add('tvlUsd'), volumeAll: add('volumeAllUsd'), feesAll: add('feesAllUsd') } : null
}

function Work({ src }: { src: Sources }) {
  const s = builtVenues(src)
  return (
    <div className="cst-work">
      <div>
        <h2 className="cst-h2">We build with you, on the same stack we run.</h2>
        <ServicesList compact />
        <p className="cst-track">
          <ChartSpline className="gt-ic" aria-hidden />{' '}
          {s && s.tvl != null ? (
            <>
              Venues we built hold <b className="num">{fmtUsd(s.tvl)}</b> in TVL, with <b className="num">{fmtUsd(s.volumeAll)}</b> all-time volume and <b className="num">{fmtUsd(s.feesAll)}</b> in fees (Peddles, PeddleSwap, PeddleQuest; source /api/stats).
            </>
          ) : src.stats ? (
            'The venue figures could not be read right now.'
          ) : (
            'Reading the venues we built…'
          )}
        </p>
      </div>
      <div className="cst-work-r">
        <Process />
        <p className="gt-more">
          <Link className="gt-btn ter" to="/services">
            Every service with its deliverables
            <ArrowRight className="gt-ic" aria-hidden />
          </Link>
        </p>
      </div>
    </div>
  )
}

function Contact() {
  return (
    <div className="cst-contact" id="contact-form">
      <div>
        <h2 className="cst-h2">Tell us what you are building.</h2>
        <p className="cst-muted">A short brief is enough. We answer with questions or a first scope, usually within one working day.</p>
        <ul className="gt-alt">
          <li>
            <span className="gt-k">Telegram</span>
            <A href="https://t.me/GullyLabsBot?start=contact">@GullyLabsBot</A>
          </li>
          <li>
            <span className="gt-k">News</span>
            <A href="https://t.me/GullyChain">t.me/GullyChain</A>
          </li>
          <li>
            <span className="gt-k">X</span>
            <A href="https://x.com/Gully_Labs">@Gully_Labs</A>
          </li>
        </ul>
      </div>
      <ContactForm />
    </div>
  )
}

/* ---------------------------------------------------------------- the page ---- */
const FLOW: { k: 'id' | 'pay' | 'chain'; icon: LucideIcon; pre: string; name: string }[] = [
  { k: 'id', icon: FingerprintPattern, pre: 'Sign in with', name: 'Gully ID' },
  { k: 'pay', icon: CreditCard, pre: 'pay with', name: 'Gully Pay' },
  { k: 'chain', icon: Blocks, pre: 'built on', name: 'Gully Chain' },
]

export function Constellation() {
  const live = useLive()
  const hp = useHubProducts()
  const hl = useHubLive()
  const src: Sources = useMemo(() => ({ hub: live.hub, products: hp.data, live: hl.data, liveState: hl.state, stats: live.stats }), [live.hub, live.stats, hp.data, hl.data, hl.state])
  const R = useMemo(() => readings(src), [src])
  const s = suite(src)
  const [hot, setHot] = useState<{ keys: ProductKey[]; nb: boolean } | null>(null)
  const [open, setOpen] = useState<ProductKey | null>(null)
  const back = useRef<Element | null>(null)
  const [tab, setTab] = useState<TabId>(() => (typeof location !== 'undefined' && HASH[location.hash]) || 'live')
  const board = useRef<HTMLElement>(null)

  // toasts: only for real changes between two polls
  const seen = useRef<Seen | null>(null)
  useEffect(() => {
    if (!src.hub || !src.live) return
    const next = seenOf(src)
    for (const c of changes(seen.current, next, src)) consoleToast({ title: c.title, text: c.text, icon: c.icon })
    seen.current = next
  }, [src])

  // the header and footer links (#contact, #services ...) open their tab
  useEffect(() => {
    const f = () => {
      const t = HASH[location.hash]
      if (t) setTab(t)
    }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  const openDrawer = (k: ProductKey, from: Element) => {
    back.current = from
    setOpen(k)
  }
  const close = useCallback(() => {
    setOpen(null)
    const b = back.current as HTMLElement | null
    if (b?.focus) b.focus()
  }, [])
  const go = (t: TabId) => {
    setTab(t)
    board.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tabBody: Record<TabId, ReactNode> = {
    live: <LiveBoard src={src} R={R} />,
    news: <News />,
    products: <ProductTable R={R} open={openDrawer} />,
    work: <Work src={src} />,
    contact: <Contact />,
  }

  return (
    <div className="lcp gt cst">
      <Seo
        title="Eight connected products: identity, payments, chain, data, games"
        description="Gully Labs builds a connected product suite: sign in with Gully ID, pay with Gully Pay, build on Gully Chain, see it with HolderMaps and Gully Security, play with Gully Studio. Live status and metrics from every product."
      />
      <section className="cst-hero" aria-labelledby="cst-h1">
        <div className="gt-wrap cst-hero-in">
          <div className="cst-copy">
            <p className="gt-k cst-eyebrow">
              <span className="cst-dash" />
              Gully Labs · product studio
            </p>
            <h1 id="cst-h1">
              One studio.
              <br />
              <em>Eight products</em> that work as one.
            </h1>
            <p className="cst-lede">We build the whole path a user takes on chain, and every piece plugs into the next.</p>
            <ol className="cst-flow" aria-label="How the products connect">
              {FLOW.map((f) => (
                <li key={f.k}>
                  <button
                    type="button"
                    className={hot && !hot.nb && hot.keys.join() === JOURNEY[f.k].join() ? 'on' : ''}
                    onPointerEnter={() => setHot({ keys: JOURNEY[f.k], nb: false })}
                    onPointerLeave={() => setHot(null)}
                    onFocus={() => setHot({ keys: JOURNEY[f.k], nb: false })}
                    onBlur={() => setHot(null)}
                    onClick={(e) => openDrawer(f.k, e.currentTarget)}
                  >
                    <f.icon className="gt-ic" aria-hidden />
                    <span>
                      {f.pre} <b>{f.name}</b>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="cst-kpis" aria-live="polite">
              <div>
                <span className="gt-k">Services up</span>
                <b className="num">{s.up == null ? '—' : `${s.up}/${s.total}`}</b>
                <small>/api/hub</small>
              </div>
              <div>
                <span className="gt-k">ID sign-ins · 24 h</span>
                <b className="num">{kpiText(R.id.kpi)}</b>
                <small>gullyid.xyz</small>
              </div>
              <div>
                <span className="gt-k">Gully Chain block</span>
                <b className="num">{kpiText(R.chain.kpi)}</b>
                <small>gullychain.xyz</small>
              </div>
            </div>
            <div className="cst-ctas">
              <button type="button" className="gt-btn pri" onClick={() => go('work')}>
                <Briefcase className="gt-ic" aria-hidden />
                Work with us
              </button>
              <button type="button" className="gt-btn sec" onClick={(e) => openDrawer('id', e.currentTarget)}>
                <Orbit className="gt-ic" aria-hidden />
                Explore the suite
              </button>
            </div>
          </div>
          <ConstellationMap R={R} onOpen={openDrawer} hot={hot} setHot={setHot} />
        </div>
      </section>

      <section className="cst-board" id="board" ref={board} aria-label="Live board, news, products, services and contact">
        <div className="gt-wrap">
          <div className="cst-tabs" role="tablist" aria-label="Board">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`cst-t-${t.id}`}
                aria-controls={`cst-p-${t.id}`}
                aria-selected={tab === t.id}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                  if (!d) return
                  e.preventDefault()
                  const i = (TABS.findIndex((x) => x.id === tab) + d + TABS.length) % TABS.length
                  setTab(TABS[i].id)
                  document.getElementById(`cst-t-${TABS[i].id}`)?.focus()
                }}
              >
                <t.icon className="gt-ic" aria-hidden />
                {t.label}
              </button>
            ))}
            <span className="cst-fresh gt-k">{hl.data ? `live · ${new Date(hl.data.generatedAt).toISOString().slice(11, 19)} UTC` : 'reading live sources…'}</span>
          </div>
          {/* anchors the header links land on */}
          <span id="live" />
          <span id="services" />
          <span id="contact" />
          <div className="cst-pane" id={`cst-p-${tab}`} role="tabpanel" aria-labelledby={`cst-t-${tab}`} tabIndex={0}>
            {tabBody[tab]}
          </div>
          <p className="cst-sendline">
            <Send className="gt-ic" aria-hidden /> Building something? <button type="button" className="cst-linkbtn" onClick={() => go('contact')}>Send us a brief</button> or <Link to="/products">see every product page</Link>.
          </p>
        </div>
      </section>
      <Drawer k={open} R={R} onClose={close} />
    </div>
  )
}
