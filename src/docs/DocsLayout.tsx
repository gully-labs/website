import { Activity, ArrowLeftRight, Rocket, BadgeCheck, BellRing, BookOpen, Bot, FileCheck, Network, Server, Gamepad2, CircleDollarSign, ChartCandlestick, ChartNoAxesCombined, Code2, Gauge, HardDrive, HeartPulse, History, Home, KeyRound, Lock, type LucideIcon, Menu, MessageCircleQuestion, Milestone, Newspaper, Orbit, Package, Plug, Puzzle, QrCode, ScanSearch, Search, Send, ShieldCheck, Smartphone, Tags, Users, X } from 'lucide-react'
import { securityPrimary } from '../site-host'
import { useContext, useEffect, useId, useMemo, useState } from 'react'
import { NavLink, Outlet, ScrollRestoration, useNavigate, useResolvedPath } from 'react-router'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { Mascot, Wordmark } from '../components/brand'
import { AskLauncher } from '../components/ask/AskLauncher'
import { track } from '../lib/track'
import { apiOrigin, DOC_KEYWORDS, DOC_PAGES, DocsBase, SITE, useDocHref, type DocSlug } from './nav'
import { PoweredByBadge } from '../components/PoweredByBadge'

type Health = 'checking' | 'live' | 'down'

/** A small honest pill: does the public API answer right now? */
function ApiPill() {
  const [h, setH] = useState<Health>('checking')
  useEffect(() => {
    let alive = true
    const check = () =>
      fetch(`${apiOrigin()}/api/tracker`, { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(
          (d: { rows?: unknown }) => alive && setH(Array.isArray(d.rows) ? 'live' : 'down'),
          () => alive && setH('down'),
        )
    check()
    const id = setInterval(check, 120_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  const label = h === 'live' ? 'API live' : h === 'down' ? 'API unreachable' : 'API: checking'
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-[5px] font-mono text-[11px] whitespace-nowrap text-ink-2">
      <span className={`size-[7px] rounded-full ${h === 'live' ? 'bg-green' : h === 'down' ? 'bg-error' : 'bg-faint'}`} style={h === 'live' ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />
      {label}
    </span>
  )
}

const DOC_ICON: Record<DocSlug, LucideIcon> = { '': Home, integrate: Rocket, methodology: BookOpen, api: Code2, widget: Puzzle, 'api-keys': KeyRound, 'plans-alerts': BellRing, sdk: Package, analytics: ChartNoAxesCombined, 'gully-security': ShieldCheck, 'gully-score': Gauge, teams: Users, roadmap: Milestone, changelog: History, 'holder-map': ScanSearch, 'gully-ai': Bot, telegram: Send, 'telegram-mini-app': Smartphone, 'news-gate': Newspaper, 'stock-pages': ChartCandlestick, 'solana-pay': QrCode, swaps: ArrowLeftRight, solana: Orbit, ipfs: HardDrive, status: HeartPulse, contracts: FileCheck, 'holder-map-integrate': Plug, badges: BadgeCheck }

/** Links to the rest of Gully Labs: all on another host, so each opens in a new tab with the ↗ marker. */
const GULLY_LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: 'Live tracker', href: `${SITE}/tracker`, icon: Activity },
  { label: 'Products', href: `${SITE}/products`, icon: Package },
  { label: 'Gully Score', href: `${SITE}/score`, icon: Gauge },
  { label: 'Widget builder', href: `${SITE}/widget`, icon: Puzzle },
  { label: 'Gully AI', href: `${SITE}/ask`, icon: MessageCircleQuestion },
  { label: 'Alerts', href: `${SITE}/#alerts`, icon: BellRing },
  { label: 'Pricing', href: `${SITE}/pricing`, icon: Tags },
  { label: 'Status', href: `${SITE}/status`, icon: HeartPulse },
  { label: 'Telegram bot', href: 'https://t.me/GullyLabsBot', icon: Send },
  { label: 'Blog', href: 'https://blog.gullylabs.xyz', icon: Newspaper },
  { label: 'Privacy', href: `${SITE}/legal/privacy`, icon: Lock },
  { label: 'App dashboard', href: 'https://app.gullylabs.xyz', icon: KeyRound },
]
/** The products on their own domains, each with its own docs or home (2026-10-26). */
const PRODUCT_LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: 'Gully Chain docs', href: 'https://docs.gullychain.xyz/', icon: Network },
  { label: 'Gully Pay docs', href: 'https://gullypay.xyz/docs', icon: CircleDollarSign },
  { label: 'Gully RPC docs', href: 'https://gullyrpc.xyz/docs/', icon: Server },
  { label: 'HolderMaps', href: 'https://holdermaps.xyz/', icon: ScanSearch },
  { label: 'Gully Security', href: 'https://gullysecurity.xyz/', icon: ShieldCheck },
  { label: 'Gully Studio', href: 'https://gullystudio.xyz/', icon: Gamepad2 },
]

type Hit = { slug: DocSlug; title: string; group: string }

/** Pages whose title or keywords contain every word of the query; title matches first. */
function searchDocs(query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { hit: Hit; score: number }[] = []
  for (const p of DOC_PAGES) {
    const title = p.title.toLowerCase()
    const keys = DOC_KEYWORDS[p.slug] ?? []
    let score = 0
    let all = true
    for (const w of words) {
      if (title.includes(w)) score += title.startsWith(w) ? 3 : 2
      else if (keys.some((k) => k.includes(w))) score += 1
      else {
        all = false
        break
      }
    }
    if (all) scored.push({ hit: { slug: p.slug, title: p.title, group: p.group }, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.hit)
}

/** The sidebar search: filters the pages by title and keywords; Enter opens the first match. */
function DocSearch({ onPick }: { onPick: () => void }) {
  const [q, setQ] = useState('')
  const id = useId()
  const navigate = useNavigate()
  const base = useContext(DocsBase).replace(/\/+$/, '')
  const hrefOf = (slug: DocSlug) => `${base}${slug ? `/${slug}` : ''}` || '/'
  const query = q.trim()
  const hits = useMemo(() => searchDocs(query), [query])

  // Analytics: one event once typing has stopped for 800 ms, for queries of two characters or more.
  useEffect(() => {
    if (query.length < 2) return
    const t = setTimeout(() => track('docs-search', { q: query, results: hits.length }), 800)
    return () => clearTimeout(t)
  }, [query, hits.length])

  const open = (slug: DocSlug) => {
    track('docs-search-open', { slug: slug || 'overview' })
    setQ('')
    onPick()
  }

  return (
    <div className="flex flex-col gap-2" role="search">
      <label htmlFor={`${id}-q`} className="sr-only">
        Search the docs
      </label>
      <div className="relative">
        <Search aria-hidden size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <input
          id={`${id}-q`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) {
              e.preventDefault()
              const first = hits[0]
              open(first.slug)
              navigate(hrefOf(first.slug))
            } else if (e.key === 'Escape' && q) {
              e.stopPropagation()
              setQ('')
            }
          }}
          placeholder="Search the docs"
          autoComplete="off"
          spellCheck={false}
          aria-controls={`${id}-results`}
          aria-describedby={`${id}-count`}
          className="min-h-11 w-full rounded-sm border border-line-strong bg-surface-deep pr-3 pl-9 text-[16px] text-ink placeholder:text-faint focus:border-gold focus:outline-none"
        />
      </div>
      <span id={`${id}-count`} role="status" aria-live="polite" className={query ? 'px-1 font-mono text-[11px] text-faint' : 'sr-only'}>
        {query ? (hits.length ? `${hits.length} page${hits.length === 1 ? '' : 's'} · Enter opens the first` : 'No page matches. Try Gully AI (⌘K).') : ''}
      </span>
      {query && hits.length > 0 && (
        <ul id={`${id}-results`} className="m-0 flex list-none flex-col gap-1 p-0" style={{ animation: 'gl-fade .15s ease both' }}>
          {hits.map((h, i) => {
            const Icon = DOC_ICON[h.slug]
            return (
              <li key={h.slug}>
                <NavLink
                  to={hrefOf(h.slug)}
                  end
                  onClick={() => open(h.slug)}
                  className={`group flex min-h-11 items-center gap-3 rounded-sm px-3 text-[14px] transition-colors hover:bg-surface hover:text-ink ${i === 0 ? 'bg-surface text-ink' : 'text-muted'}`}
                >
                  <Icon aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint transition-colors group-hover:text-gold" />
                  <span className="flex-1">{h.title}</span>
                  <span className="font-mono text-[11px] text-faint">{h.group}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SideLink({ slug, title, onPick }: { slug: DocSlug; title: string; onPick: () => void }) {
  const href = useDocHref(slug)
  const Icon = DOC_ICON[slug]
  return (
    <NavLink
      to={href}
      end
      onClick={onPick}
      className={({ isActive }) =>
        `group relative flex min-h-11 items-center gap-3 rounded-sm px-3 text-[14px] transition-colors ${isActive ? 'bg-surface text-ink before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-gold [&_svg]:text-gold' : 'text-muted hover:bg-surface hover:text-ink'}`
      }
    >
      <Icon aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint transition-colors group-hover:text-gold" />
      {title}
    </NavLink>
  )
}

function Sidebar({ onPick }: { onPick: () => void }) {
  const groups = [...new Set(DOC_PAGES.map((p) => p.group))]
  return (
    <nav aria-label="Docs" className="flex flex-col gap-6">
      <DocSearch onPick={onPick} />
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="px-3 pb-1 font-mono text-[11px] tracking-[1px] text-faint">{g.toUpperCase()}</span>
          {DOC_PAGES.filter((p) => p.group === g && !(p.slug === 'gully-security' && securityPrimary())).map((p) => (
            <SideLink key={p.slug} slug={p.slug} title={p.title} onPick={onPick} />
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-1 border-t border-line pt-5">
        <span className="px-3 pb-1 font-mono text-[11px] tracking-[1px] text-faint">GULLY LABS</span>
        {GULLY_LINKS.map((l) => (
          <a key={l.href} href={l.href} {...newTab} className="group flex min-h-11 items-center gap-3 rounded-sm px-3 text-[14px] text-muted transition-colors hover:bg-surface hover:text-ink">
            <l.icon aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint transition-colors group-hover:text-gold" />
            <span className="flex-1">{l.label}</span>
            <NewTabMark size={14} />
          </a>
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-5">
        <span className="px-3 pb-1 font-mono text-[11px] tracking-[1px] text-faint">GULLY PRODUCTS</span>
        {PRODUCT_LINKS.map((l) => (
          <a key={l.href} href={l.href} {...newTab} className="group flex min-h-11 items-center gap-3 rounded-sm px-3 text-[14px] text-muted transition-colors hover:bg-surface hover:text-ink">
            <l.icon aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint transition-colors group-hover:text-gold" />
            <span className="flex-1">{l.label}</span>
            <NewTabMark size={14} />
          </a>
        ))}
      </div>
    </nav>
  )
}

/* The docs chrome: its own top bar, sidebar (a sheet on phones) and content column. It is the same
   bundle as the marketing site, mounted at the root of docs.gullylabs.xyz and under /docs in development. */
export function DocsLayout() {
  const base = useResolvedPath('.').pathname
  const [open, setOpen] = useState(false)
  const home = base.replace(/\/+$/, '') || '/'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <DocsBase.Provider value={home}>
      <ScrollRestoration />
      <a href="#docs-main" className="absolute top-2 left-2 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-sm bg-gold px-3 text-[14px] font-semibold text-bg focus:translate-y-0">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-[rgba(6,5,13,.86)] backdrop-blur-md">
        <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between gap-4 px-6 max-[600px]:gap-2 max-[600px]:px-4">
          <div className="flex min-w-0 items-center gap-3 max-[600px]:gap-2">
            <button
              type="button"
              aria-label={open ? 'Close the docs menu' : 'Open the docs menu'}
              aria-expanded={open}
              aria-controls="docs-sheet"
              onClick={() => setOpen((o) => !o)}
              className="hidden size-11 shrink-0 place-items-center rounded-sm border border-line text-ink-2 transition-colors hover:border-line-hover max-[899px]:grid"
            >
              {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
            <NavLink to={home} end className="flex min-h-11 min-w-0 items-center gap-3 text-ink no-underline max-[359px]:min-w-11 max-[359px]:justify-center" aria-label="Gully Labs Docs, home">
              {/* A smaller wordmark on narrow phones, so the menu, Gully AI and site buttons fit at 390 px. */}
              <span className="flex max-[479px]:hidden">
                <Wordmark height={24} decorative />
              </span>
              <span className="hidden max-[479px]:flex max-[359px]:hidden">
                <Wordmark height={20} decorative />
              </span>
              {/* Under 360px the wordmark would sit under the Gully AI button: the round mark stands in. */}
              <span className="hidden max-[359px]:flex" data-testid="docs-header-mark">
                <Mascot size={32} decorative />
              </span>
              {/* Below 440px the header has no room for the pill beside the menu, Ask and site buttons. */}
              <span className="shrink-0 rounded-full border border-gold-line px-[9px] py-[2px] font-mono text-[11px] tracking-[1px] text-gold max-[439px]:hidden">DOCS</span>
            </NavLink>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AskLauncher />
            <span className="max-[520px]:hidden">
              <ApiPill />
            </span>
            <a href={`${SITE}/tracker`} {...newTab} className="inline-flex min-h-11 items-center gap-1 rounded-sm px-3 text-[14px] text-muted transition-colors hover:text-ink max-[700px]:hidden">
              <ChartCandlestick aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint" />
              Tracker <NewTabMark size={14} className="flex-none" />
            </a>
            <a href={SITE} {...newTab} className="inline-flex min-h-11 items-center gap-1 rounded-sm border border-line-strong px-3 text-[14px] whitespace-nowrap text-ink transition-colors hover:border-gold hover:text-ink max-[479px]:px-2 max-[479px]:text-[13px]">
              <Home aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint max-[359px]:hidden" />
              gullylabs.xyz
              <NewTabMark size={14} className="flex-none" />
            </a>
          </div>
        </div>
      </header>

      {open && (
        <div id="docs-sheet" className="fixed inset-x-0 top-[64px] bottom-0 z-30 overflow-y-auto bg-bg px-4 py-6 min-[900px]:hidden" style={{ animation: 'gl-fade .2s ease both' }}>
          <div className="mb-6">
            <ApiPill />
          </div>
          <Sidebar onPick={() => setOpen(false)} />
        </div>
      )}

      <div className="mx-auto grid max-w-[1440px] grid-cols-[232px_minmax(0,1fr)] gap-12 px-6 max-[899px]:grid-cols-1 max-[600px]:px-4">
        <aside className="sticky top-[64px] h-[calc(100dvh-64px)] overflow-y-auto py-10 max-[899px]:hidden">
          <Sidebar onPick={() => undefined} />
        </aside>
        <main id="docs-main" className="min-w-0 py-12 pb-24 max-[600px]:py-8">
          <Outlet />
        </main>
      </div>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-[12px] text-faint max-[600px]:px-4">
          <span>© Gully Labs · tracker data from Chainlink and DexScreener</span>
          <nav aria-label="Gully Labs" className="flex flex-wrap items-center gap-x-5">
            {[
              { label: 'Status', href: `${SITE}/status`, icon: HeartPulse },
              { label: 'Terms', href: `${SITE}/legal/terms`, icon: FileCheck },
              { label: 'Privacy', href: `${SITE}/legal/privacy`, icon: Lock },
              { label: 'Blog', href: 'https://blog.gullylabs.xyz', icon: Newspaper },
              { label: 'gullylabs.xyz', href: SITE, icon: Home },
            ].map((l) => (
              <a key={l.href} href={l.href} {...newTab} className="inline-flex min-h-11 items-center gap-[6px] text-muted transition-colors hover:text-ink">
                <l.icon aria-hidden size={13} strokeWidth={1.75} className="flex-none" />
                {l.label}
                <NewTabMark size={12} />
              </a>
            ))}
          </nav>
          <PoweredByBadge />
        </div>
      </footer>
    </DocsBase.Provider>
  )
}
