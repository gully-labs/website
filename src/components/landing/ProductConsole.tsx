import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Activity, ArrowUpRight, BellRing, Boxes, ChartNoAxesCombined, CircleDollarSign, Code2, GitFork, Layers, Puzzle, Sparkles, type LucideIcon } from 'lucide-react'
import { askStatus } from '../ask/askApi'
import { useContact } from '../ContactContext'
import { ANALYTICS_SIGNUP, type PlansState } from '../../lib/plans'
import { PORTAL, PORTAL_ALERTS } from './links'
import { h2 } from './links'

/* One product console in place of a section per product: a rail of tabs on the left (a scrolling chip
   row on a phone) and, on the right, the chosen product's one-line pitch, its call to action and its
   live demo. Each demo is its own chunk, fetched only when the console nears the viewport and only for
   the open tab; it is unmounted again when the console is far off-screen, so a demo's timers never run
   unseen. /#tracker, /#alerts … open their tab (the Layout scrolls to the anchors at the console's top);
   choosing a tab rewrites the hash in place, without a jump. */

const TrackerDemo = lazy(() => import('../demos/TrackerDemo'))
const AlertsDemo = lazy(() => import('../demos/AlertsDemo'))
const AnalyticsDemo = lazy(() => import('../demos/AnalyticsDemo'))
const ChainKitDemo = lazy(() => import('../demos/ChainKitDemo'))
const ApiDemo = lazy(() => import('../demos/ApiDemo'))
const WidgetDemo = lazy(() => import('../demos/WidgetDemo'))
const PayDemo = lazy(() => import('../demos/PayDemo'))
const AskPanel = lazy(() => import('../ask/AskPanel').then((mod) => ({ default: () => <mod.AskPanel variant="panel" /> })))

type Cta = { label: string; to?: string; href?: string; contact?: boolean }
interface Tab {
  id: string
  name: string
  icon: LucideIcon
  status: string
  live: boolean
  pitch: string
  cta: Cta
  /** The demo's height on a wide screen, held by its skeleton while it loads. */
  height: number
  Demo?: LazyExoticComponent<ComponentType>
}

function tabsFor(plans: PlansState, ask: boolean | null): Tab[] {
  const offer = plans.k === 'ok' ? plans.offer : null
  const trial = offer?.analytics.trialDays
  const anon = offer?.anonymous.perMin
  const free = offer?.plans.find((p) => p.id === 'free')
  return [
    { id: 'tracker', name: 'Tracker + Swap', icon: Activity, status: 'LIVE', live: true, pitch: 'Every tokenised stock on Robinhood Chain and BNB Chain against its Chainlink fair price, every minute, with a swap on each stock page.', cta: { label: 'Launch app', to: '/tracker' }, height: 560, Demo: TrackerDemo },
    { id: 'alerts', name: 'Alerts', icon: BellRing, status: 'LIVE', live: true, pitch: 'Set a gap rule once; get a Telegram message with Open and Mute buttons, a signed webhook, or both.', cta: { label: 'Set an alert', href: PORTAL_ALERTS }, height: 560, Demo: AlertsDemo },
    { id: 'analytics', name: 'Gully Analytics', icon: ChartNoAxesCombined, status: 'FREE TRIAL', live: true, pitch: `Page views next to wallet connects, chains and transactions. Cookie-free, built on Umami, sign up with your wallet${trial ? `, ${trial} days free` : ''}.`, cta: { label: 'Start free trial', href: ANALYTICS_SIGNUP }, height: 600, Demo: AnalyticsDemo },
    { id: 'chainkit', name: 'Chain Kit', icon: Boxes, status: 'ON REQUEST', live: false, pitch: 'A Blockscout explorer with your domain, colours, token list and API, run by us. Change the brand below and watch it update.', cta: { label: 'Explore Chain Kit', to: '/chain-kit' }, height: 620, Demo: ChainKitDemo },
    { id: 'chains', name: 'Gully Chains', icon: Layers, status: 'SOON', live: false, pitch: 'Arbitrum Orbit L3 chains, launched and operated by Gully Labs. In development: none of it is live yet.', cta: { label: 'Ask about a chain', contact: true }, height: 360 },
    { id: 'api', name: 'API + SDK', icon: Code2, status: 'LIVE', live: true, pitch: `Every tracker row as JSON: ${anon ? `${anon} calls a minute` : 'free calls'} with no key, a free key${free ? ` (${free.perMin.toLocaleString('en-US')} a minute)` : ''} with wallet sign-in, and a typed SDK (MIT).`, cta: { label: 'Get a key', href: PORTAL }, height: 560, Demo: ApiDemo },
    { id: 'widget', name: 'Widget', icon: Puzzle, status: 'LIVE', live: true, pitch: 'One script tag puts a live ticker, a one-stock badge or a table of the widest gaps on any site.', cta: { label: 'Build a widget', to: '/widget' }, height: 520, Demo: WidgetDemo },
    { id: 'pay', name: 'Gully Pay', icon: CircleDollarSign, status: 'LIVE', live: true, pitch: 'Plans paid from your wallet straight to ours in ETH, BNB, USDC or USDT on four chains, checked on chain. No custody.', cta: { label: 'See plans', to: '/#pricing' }, height: 540, Demo: PayDemo },
    { id: 'ask', name: 'Gully AI', icon: Sparkles, status: ask ? 'LIVE' : 'SOON', live: !!ask, pitch: 'Questions about any Gully product, answered from our docs with the sources cited.', cta: { label: 'Open Gully AI', to: '/ask' }, height: ask ? 560 : 200 },
  ]
}

const CONSOLE_TABS = ['tracker', 'alerts', 'analytics', 'chainkit', 'chains', 'api', 'widget', 'pay', 'ask']

const NEAR = '400px 0px'
const FAR = '1400px 0px'

/** true once the element is within NEAR of the viewport, false again once it is beyond FAR. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const enter = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: NEAR })
    const leave = new IntersectionObserver((es) => es.every((e) => !e.isIntersecting) && setNear(false), { rootMargin: FAR })
    enter.observe(el)
    leave.observe(el)
    return () => {
      enter.disconnect()
      leave.disconnect()
    }
  }, [ref])
  return near
}

function CtaButton({ cta }: { cta: Cta }) {
  const { openContact } = useContact()
  const cls = 'inline-flex min-h-11 flex-none items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold whitespace-nowrap text-bg transition-colors hover:bg-gold-hover hover:text-bg'
  const inner = (
    <>
      {cta.label}
      <ArrowUpRight aria-hidden size={15} />
    </>
  )
  if (cta.contact)
    return (
      <button type="button" onClick={() => openContact('Infrastructure')} className={cls}>
        {inner}
      </button>
    )
  if (cta.to)
    return (
      <Link to={cta.to} className={cls}>
        {inner}
      </Link>
    )
  return (
    <a href={cta.href} className={cls}>
      {inner}
    </a>
  )
}

/* ----------------------------------------------------------- gully chains --- */

/* Not live: a preview of the Orbit L3 work. The repos are public forks in the gully-labs org; nothing
   here claims a running chain. Gully Labs is not affiliated with Offchain Labs or the Arbitrum
   Foundation, so no Arbitrum marks. */
const CHAIN_REPOS: { repo: string; role: string }[] = [
  { repo: 'arbitrum-orbit-deployment-ui', role: 'Launch' },
  { repo: 'orbit-setup-script', role: 'Bootstrap' },
  { repo: 'orbit-monitoring-tools', role: 'Monitor' },
  { repo: 'arbitrum-token-bridge', role: 'Gully Bridge' },
  { repo: 'arbitrum-token-lists', role: 'Tokens' },
  { repo: 'stylus-sdk-rs', role: 'Stylus SDK' },
  { repo: 'stylus-hello-world', role: 'Stylus starter' },
]
const CHAIN_STEPS: { name: string; when: string; d: string }[] = [
  { name: 'Gully Devnet', when: 'NEXT', d: 'A public test L3 on Arbitrum Sepolia, with a Chain Kit explorer, a faucet and a bridge.' },
  { name: 'Client chains', when: 'LATER', d: 'Managed Orbit L3s for clients, settling to Arbitrum One.' },
  { name: 'Our own L3', when: 'LATER', d: 'A chain for the Gully venues.' },
]

function ChainsPane() {
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 grid list-none grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-line bg-line p-0 max-[699px]:grid-cols-1">
        {CHAIN_STEPS.map((s, i) => (
          <li key={s.name} className="flex flex-col gap-1 bg-surface px-4 py-3">
            <span className="font-mono text-[11px] text-gold">
              {String(i + 1).padStart(2, '0')} · <span className="text-dim">{s.when}</span>
            </span>
            <b className="font-semibold">{s.name}</b>
            <span className="text-[13px] leading-[1.45] text-muted">{s.d}</span>
          </li>
        ))}
      </ol>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))] gap-2 p-0">
        {CHAIN_REPOS.map((r) => (
          <li key={r.repo} className="min-w-0">
            <a
              href={`https://github.com/gully-labs/${r.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-full min-h-11 flex-col gap-[2px] rounded-[10px] border border-line bg-surface px-3 py-[10px] text-ink transition-[border-color,background-color] duration-200 hover:border-gold-line hover:bg-surface-hover hover:text-ink"
            >
              <span className="flex items-center justify-between gap-2 font-mono text-[11px] tracking-[1px] text-gold">
                {r.role.toUpperCase()}
                <GitFork aria-hidden size={12} />
              </span>
              <b className="font-mono text-[12px] leading-[1.35] font-medium [overflow-wrap:anywhere]">gully-labs/{r.repo}</b>
            <span className="sr-only"> (opens in a new tab)</span></a>
          </li>
        ))}
      </ul>
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">Forks of open-source Offchain Labs repositories. Gully Labs is not affiliated with Offchain Labs or the Arbitrum Foundation.</p>
    </div>
  )
}

function AskPane({ configured }: { configured: boolean | null }) {
  if (configured)
    return (
      <Suspense fallback={<div aria-hidden className="h-[420px] animate-pulse rounded-card border border-line bg-surface" />}>
        <AskPanel />
      </Suspense>
    )
  return (
    <div className="flex min-h-[200px] flex-col items-start justify-center gap-3 rounded-card border border-dashed border-line-strong bg-surface p-6">
      <span className="font-mono text-[11px] tracking-[1px] text-gold">{configured === null ? 'CHECKING…' : 'COMING ONLINE SOON'}</span>
      <p className="m-0 max-w-[520px] text-[14px] leading-[1.5] text-muted">
        Gully AI answers questions about the tracker, the API, Analytics, Chain Kit and Gully Pay from our own docs, and cites where each answer came from.
        {configured === false ? ' It is not switched on here yet; the docs are open meanwhile.' : ''}
      </p>
      <Link to="/ask" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-medium text-gold hover:text-gold-hover">
        Go to Gully AI <ArrowUpRight aria-hidden size={14} />
      </Link>
    </div>
  )
}

/* ------------------------------------------------------------------ console --- */

export function ProductConsole({ plans }: { plans: PlansState }) {
  const location = useLocation()
  const [tab, setTab] = useState(() => {
    const id = location.hash.slice(1)
    return CONSOLE_TABS.includes(id) ? id : 'tracker'
  })
  const [ask, setAsk] = useState<boolean | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const near = useNearViewport(box)
  const btns = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    let alive = true
    askStatus().then((s) => alive && setAsk(!!s?.configured))
    return () => {
      alive = false
    }
  }, [])

  // A link to /#alerts (header, footer, another page) opens that tab; the Layout does the scrolling.
  const [seenKey, setSeenKey] = useState(location.key)
  if (seenKey !== location.key) {
    setSeenKey(location.key)
    const id = location.hash.slice(1)
    if (CONSOLE_TABS.includes(id)) setTab(id)
  }

  const choose = (id: string, focus = false) => {
    setTab(id)
    // Rewrite the hash in place: shareable, but no navigation, so nothing scrolls.
    if (window.location.hash !== `#${id}`) window.history.replaceState(window.history.state, '', `#${id}`)
    if (focus) btns.current[id]?.focus()
    // On a phone the chip row scrolls the chosen tab into view.
    btns.current[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }

  const tabs = tabsFor(plans, ask)
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0]
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === tab)
    const n = tabs.length
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    choose(tabs[(next + n) % n].id, true)
  }

  // The pane's height follows its content with a short ease, so a tab change never jumps the page.
  const inner = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | 'auto'>('auto')
  const [moving, setMoving] = useState(false)
  const reduce = useReducedMotion()
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const skeleton = (height: number) => <div aria-hidden className="animate-pulse rounded-card border border-line bg-surface" style={{ height, maxHeight: 'calc(100vh - 120px)' }} />
  let body: ReactNode
  if (cur.id === 'chains') body = <ChainsPane />
  else if (cur.id === 'ask') body = <AskPane configured={ask} />
  else if (cur.Demo && near)
    body = (
      <Suspense fallback={skeleton(cur.height)}>
        <cur.Demo />
      </Suspense>
    )
  else body = skeleton(cur.height)

  return (
    <section id="products" aria-labelledby="products-title" className="relative scroll-mt-[72px] border-t border-line">
      {/* The deep-link anchors: /#alerts and friends land on the console. */}
      {CONSOLE_TABS.map((id) => (
        <span key={id} id={id} aria-hidden className="pointer-events-none absolute top-0 left-0" />
      ))}
      <div className="flex flex-col gap-5 px-page py-12 max-[599px]:py-9">
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }} className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[1.5px] text-gold">PRODUCTS · TRY EACH ONE HERE</span>
            <h2 id="products-title" className={h2}>
              Everything we ship
            </h2>
          </div>
          <p className="m-0 max-w-[420px] text-[14px] leading-[1.5] text-muted">Pick a product: its live demo opens beside the list. Demos read the real tracker and API unless they say otherwise.</p>
        </motion.div>
        <div ref={box} className="grid grid-cols-[250px_minmax(0,1fr)] items-start gap-4 max-[899px]:grid-cols-1">
          <div
            role="tablist"
            aria-label="Products"
            aria-orientation="vertical"
            onKeyDown={onKey}
            className="sticky top-20 flex flex-col gap-1 max-[899px]:static max-[899px]:-mx-page max-[899px]:flex-row max-[899px]:gap-[6px] max-[899px]:overflow-x-auto max-[899px]:px-page max-[899px]:pb-1 max-[899px]:[scrollbar-width:none]"
          >
            {tabs.map((t) => {
              const on = t.id === cur.id
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    btns.current[t.id] = el
                  }}
                  id={`console-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="console-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => choose(t.id)}
                  className={`group relative flex min-h-12 flex-none items-center gap-3 rounded-[10px] border px-3 py-2 text-left transition-[border-color,background-color,color] duration-200 max-[899px]:min-h-11 max-[899px]:rounded-full max-[899px]:py-1 ${on ? 'border-gold-line bg-grid text-ink' : 'border-transparent bg-transparent text-muted hover:bg-surface-hover hover:text-ink max-[899px]:border-line'}`}
                >
                  {on && <motion.span layoutId="console-rail" aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gold max-[899px]:hidden" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span className={`grid size-8 flex-none place-items-center rounded-[8px] transition-colors max-[899px]:size-6 max-[899px]:bg-transparent ${on ? 'bg-bg text-gold' : 'bg-surface text-dim group-hover:text-gold'}`}>
                    <t.icon aria-hidden size={16} strokeWidth={2} />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2 max-[899px]:flex-none">
                    <b className="text-[14px] font-semibold whitespace-nowrap">{t.name}</b>
                    <span className={`font-mono text-[11px] tracking-[.5px] whitespace-nowrap max-[899px]:hidden ${t.live ? 'text-green' : 'text-dim'}`}>{t.status}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <motion.div
            animate={{ height: h }}
            initial={false}
            transition={{ duration: reduce ? 0 : 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            onAnimationStart={() => setMoving(true)}
            onAnimationComplete={() => setMoving(false)}
            // Clipped only while the height eases, so a demo's own menus and tooltips are never cut.
            style={{ overflow: moving ? 'hidden' : 'visible' }}
            // From 900 px up the pane holds the tallest demo's height, so switching tabs never moves the page.
            className="min-w-0 min-[900px]:min-h-[880px]"
          >
            <div ref={inner} id="console-panel" role="tabpanel" aria-labelledby={`console-tab-${cur.id}`} className="min-w-0">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={cur.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
                    <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-[2px]">
                      <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-gold">
                        {cur.name.toUpperCase()}
                        <span className={`rounded-full border px-[7px] py-px text-[11px] ${cur.live ? 'border-success-line text-green' : 'border-line-strong text-dim'}`}>{cur.status}</span>
                      </span>
                      <p className="m-0 text-[14px] leading-[1.45] text-ink-2">{cur.pitch}</p>
                    </div>
                    <CtaButton cta={cur.cta} />
                  </div>
                  <div className="min-w-0">{body}</div>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
