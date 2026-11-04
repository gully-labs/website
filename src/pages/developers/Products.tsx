import { ArrowRight, BookOpen, Boxes, ShieldCheck, Store, Wrench } from 'lucide-react'
import { MarkLogo } from '../../components/ProductLogo'
import { LiveProvider, useLive } from '../../console/live'
import { stateOf } from '../../console/Launcher'
import { securityPrimary } from '../../site-host'
import { ExtLink } from './ExtLink'
import { HUB_PRODUCTS, type HubProduct } from './hubProducts'
import { TOOL_TABS, type ToolTab } from './services/nav'
import { Section, ServiceHeader, type Status } from './services/ServiceHeader'
import { pillSm } from './styles'

/* The Products page of the app (2026-11-03): one card per Gully product (its kit mark in a fixed box, never
   stretched; a live status dot from GET /api/hub; one line; "Open" to the product's own app), then the Tools section:
   the HolderMaps / Gully Security features that stay in this app (Tracker, Alerts, Gully Score, Widgets, Telegram,
   Analytics), each opening its page here. A store made from this workspace before Gully Pay moved, and scans made
   before Gully Security moved, stay reachable from their product cards. Every state is read live; a surface the hub
   could not read says so, never "live" by default. */

type GoTab = ToolTab | 'merchant' | 'scans' | 'security'
type LiveState = ReturnType<typeof stateOf>

const WORD: Record<LiveState, string> = { up: 'live', down: 'down', coming: 'coming', reading: 'checking' }
const DOT: Record<LiveState, string> = { up: 'bg-green', down: 'bg-error', coming: 'bg-chart-violet', reading: 'bg-faint animate-pulse' }

/** The live state as a dot and a word (never colour alone). */
function StatusDot({ s }: { s: LiveState }) {
  return (
    <span className={`inline-flex min-h-6 shrink-0 items-center gap-[6px] font-mono text-[11px] tracking-[.5px] uppercase ${s === 'up' ? 'text-ink-2' : s === 'down' ? 'text-error' : 'text-faint'}`} data-state={s}>
      <i className={`size-[7px] rounded-full ${DOT[s]}`} aria-hidden />
      {WORD[s]}
    </span>
  )
}

/** The product's kit mark in a fixed 160 x 40 box (object-fit: contain, left-aligned): the file keeps its own ratio
    at every width, and shrinks with the box on narrow cards instead of distorting. */
function Mark({ p }: { p: HubProduct }) {
  if (!p.mark) return <MarkLogo label={p.name} decorative className="h-10" />
  const m = p.mark
  return (
    <span className="relative block h-10 w-40 max-w-full shrink-0" data-product-logo={p.key}>
      <img src={m.src} srcSet={m.src2x ? `${m.src} 1x, ${m.src2x} 2x` : undefined} width={m.w} height={m.h} alt="" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-contain object-left" />
    </span>
  )
}

function ProductCard({ p, go }: { p: HubProduct; go: (t: GoTab) => void }) {
  const { hub } = useLive()
  const s = stateOf(hub, p.hub)
  const here = p.key === 'pay' ? { label: 'Your store here', icon: Store, to: 'merchant' as GoTab } : p.key === 'security' ? { label: 'Scans made here', icon: ShieldCheck, to: (securityPrimary() ? 'scans' : 'security') as GoTab } : null
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4" data-product={p.key} data-state={s} aria-label={`${p.name}, ${WORD[s]}`}>
      <div className="flex items-center justify-between gap-3">
        <Mark p={p} />
        <StatusDot s={s} />
      </div>
      <h2 className="sr-only">{p.name}</h2>
      <p className="m-0 flex-1 text-[13px] leading-[1.45] text-muted">{p.line}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ExtLink href={p.url} className={`${pillSm} border-gold-line text-gold hover:border-gold`} data-testid={`open-${p.key}`}>
          Open {p.name}
        </ExtLink>
        {p.docs && (
          <ExtLink href={p.docs} className={pillSm} aria-label={`${p.name} docs`}>
            <BookOpen size={14} aria-hidden /> Docs
          </ExtLink>
        )}
        {here && (
          <button type="button" onClick={() => go(here.to)} className="inline-flex min-h-11 items-center gap-1 text-[13px] text-muted hover:text-gold">
            <here.icon size={14} aria-hidden /> {here.label}
          </button>
        )}
      </div>
    </li>
  )
}

function ToolRow({ t, go }: { t: (typeof TOOL_TABS)[number]; go: (t: GoTab) => void }) {
  return (
    <li>
      <button type="button" onClick={() => go(t.id)} className="group/tool flex min-h-11 w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:border-gold" data-tool={t.id}>
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-line-strong text-gold">
          <t.icon size={18} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="flex items-center gap-2">
            <b className="text-[14px] font-semibold text-ink">{t.label}</b>
            <span className="font-mono text-[11px] text-faint">{t.of}</span>
          </span>
          <span className="text-[12px] leading-[1.4] text-muted">{t.line}</span>
        </span>
        <ArrowRight size={16} className="shrink-0 text-faint transition-transform group-hover/tool:translate-x-[2px] group-hover/tool:text-gold" aria-hidden />
      </button>
    </li>
  )
}

function Body({ go }: { go: (t: GoTab) => void }) {
  const { hub } = useLive()
  const states = HUB_PRODUCTS.map((p) => stateOf(hub, p.hub))
  const up = states.filter((s) => s === 'up').length
  const counted = states.filter((s) => s !== 'coming').length
  const status: Status = !hub ? { tone: 'checking', text: 'checking…' } : up === counted ? { tone: 'live', text: `${up} of ${counted} live` } : { tone: states.includes('down') ? 'down' : 'idle', text: `${up} of ${counted} live` }
  return (
    <div className="flex flex-col gap-5">
      <ServiceHeader icon={Boxes} title="Products" desc="Every Gully product runs in its own app. Open one; your sign-in is the same Gully ID there." status={status} />
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3 p-0" data-testid="products">
        {HUB_PRODUCTS.map((p) => (
          <ProductCard key={p.key} p={p} go={go} />
        ))}
      </ul>
      <Section title="Tools" sub="HolderMaps and Gully Security features that stay in this app" aside={<Wrench size={16} className="text-faint" aria-hidden />}>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-2 p-0" data-testid="tools">
          {TOOL_TABS.map((t) => (
            <ToolRow key={t.id} t={t} go={go} />
          ))}
        </ul>
      </Section>
    </div>
  )
}

export function Products({ go }: { go: (t: GoTab) => void }) {
  return (
    <LiveProvider>
      <Body go={go} />
    </LiveProvider>
  )
}
