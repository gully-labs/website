import { Activity, ArrowUpRight, BellRing, BookOpen, ChartNoAxesCombined, Code2, History, Home, KeyRound, Layers, Menu, MessageCircleQuestion, Milestone, Package, Puzzle, Store, Tags, Users, Wallet, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, ScrollRestoration, useResolvedPath } from 'react-router'
import { Wordmark } from '../components/brand'
import { AskLauncher } from '../components/ask/AskLauncher'
import { apiOrigin, DOC_PAGES, DocsBase, SITE, useDocHref, type DocSlug } from './nav'

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

const DOC_ICON: Record<DocSlug, LucideIcon> = { '': Home, methodology: BookOpen, api: Code2, widget: Puzzle, 'api-keys': KeyRound, 'plans-alerts': BellRing, sdk: Package, analytics: ChartNoAxesCombined, 'gully-pay': Wallet, 'gully-pay-merchants': Store, teams: Users, roadmap: Milestone, 'roadmap-l3': Layers, changelog: History }

function SideLink({ slug, title, onPick }: { slug: DocSlug; title: string; onPick: () => void }) {
  const href = useDocHref(slug)
  const Icon = DOC_ICON[slug]
  return (
    <NavLink
      to={href}
      end
      onClick={onPick}
      className={({ isActive }) =>
        `group relative flex min-h-10 items-center gap-3 rounded-btn px-3 text-[14px] transition-colors ${isActive ? 'bg-surface text-ink before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-gold [&_svg]:text-gold' : 'text-muted hover:bg-surface hover:text-ink'}`
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
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="px-3 pb-1 font-mono text-[11px] tracking-[1px] text-faint">{g.toUpperCase()}</span>
          {DOC_PAGES.filter((p) => p.group === g).map((p) => (
            <SideLink key={p.slug} slug={p.slug} title={p.title} onPick={onPick} />
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-1 border-t border-line pt-5">
        <span className="px-3 pb-1 font-mono text-[11px] tracking-[1px] text-faint">GULLY LABS</span>
        {[
          { label: 'Live tracker', href: `${SITE}/tracker`, icon: Activity },
          { label: 'Widget builder', href: `${SITE}/widget`, icon: Puzzle },
          { label: 'Gully AI', href: `${SITE}/ask`, icon: MessageCircleQuestion },
          { label: 'Alerts', href: `${SITE}/#alerts`, icon: BellRing },
          { label: 'Pricing', href: `${SITE}/pricing`, icon: Tags },
          { label: 'Developer portal', href: 'https://app.gullylabs.xyz', icon: KeyRound },
        ].map((l) => (
          <a key={l.href} href={l.href} className="group flex min-h-10 items-center gap-3 rounded-btn px-3 text-[14px] text-muted transition-colors hover:bg-surface hover:text-ink">
            <l.icon aria-hidden size={16} strokeWidth={1.75} className="flex-none text-faint transition-colors group-hover:text-gold" />
            <span className="flex-1">{l.label}</span>
            <ArrowUpRight size={14} aria-hidden className="text-faint" />
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
      <a href="#docs-main" className="absolute top-2 left-2 z-50 -translate-y-20 rounded-btn bg-gold px-3 py-2 text-[14px] font-semibold text-bg focus:translate-y-0">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-[rgba(11,14,19,.86)] backdrop-blur-md">
        <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between gap-4 px-6 max-[600px]:gap-2 max-[600px]:px-4">
          <div className="flex min-w-0 items-center gap-3 max-[600px]:gap-2">
            <button
              type="button"
              aria-label={open ? 'Close the docs menu' : 'Open the docs menu'}
              aria-expanded={open}
              aria-controls="docs-sheet"
              onClick={() => setOpen((o) => !o)}
              className="hidden size-11 shrink-0 place-items-center rounded-btn border border-line text-ink-2 transition-colors hover:border-line-hover max-[899px]:grid"
            >
              {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
            <NavLink to={home} end className="flex min-h-11 min-w-0 items-center gap-3 text-ink no-underline" aria-label="Gully Labs Docs, home">
              <Wordmark height={24} />
              {/* Below 440px the header has no room for the pill beside the menu, Ask and site buttons. */}
              <span className="shrink-0 rounded-full border border-gold-line px-[9px] py-[2px] font-mono text-[11px] tracking-[1px] text-gold max-[439px]:hidden">DOCS</span>
            </NavLink>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AskLauncher />
            <span className="max-[520px]:hidden">
              <ApiPill />
            </span>
            <a href={`${SITE}/tracker`} className="inline-flex min-h-11 items-center gap-1 rounded-btn px-3 text-[14px] text-muted transition-colors hover:text-ink max-[700px]:hidden">
              Tracker <ArrowUpRight size={14} aria-hidden />
            </a>
            <a href={SITE} className="inline-flex min-h-11 items-center gap-1 rounded-btn border border-line-strong px-3 text-[14px] text-ink transition-colors hover:border-gold hover:text-ink">
              <span className="max-[389px]:hidden">gullylabs.xyz</span>
              <span className="sr-only min-[390px]:hidden">gullylabs.xyz</span> <ArrowUpRight size={14} aria-hidden />
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
          <a href={SITE} className="text-muted transition-colors hover:text-ink">
            gullylabs.xyz
          </a>
        </div>
      </footer>
    </DocsBase.Provider>
  )
}
