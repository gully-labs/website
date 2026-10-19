import { BookOpen, Globe, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { NF, type NumberFormat } from '../../../components/charts/number-formats'
import { StatusPill as KitPill, type PillTone } from '../../../components/ui/StatusPill'
import { ExtLink } from '../ExtLink'
import { pageTitle, pillSm } from '../styles'

/* The compact header every service page opens with: icon, name, one line on what it is, a live status
   pill, "Docs ↗" and "Public page ↗" (new tabs), and a band of live KPI tiles. A tile whose figure could
   not be read shows its `unknown` text ("not tracked yet", "unreadable"), never 0. */

export type Status = { tone: 'live' | 'down' | 'checking' | 'idle'; text: string }

export type Tile = {
  label: string
  value: number | null | undefined
  format?: NumberFormat
  prefix?: string
  suffix?: string
  /** Shown instead of the number while it is unknown. */
  unknown?: string
  note?: ReactNode
  tone?: string
  /** A hover/focus explanation, e.g. why a total is partial. */
  title?: string
}

/* One status pill everywhere (G51): the header's status is the kit's StatusPill (components/ui), tinted by tone. */
const PILL_TONE: Record<Status['tone'], PillTone> = { live: 'live', down: 'error', checking: 'neutral', idle: 'warn' }

export function StatusPill({ s }: { s: Status }) {
  return (
    <span data-testid="service-status" data-tone={s.tone} className="inline-flex">
      <KitPill tone={PILL_TONE[s.tone]} dot>
        {s.text}
      </KitPill>
    </span>
  )
}

export function KpiTile({ t, i }: { t: Tile; i: number }) {
  const known = typeof t.value === 'number' && Number.isFinite(t.value)
  return (
    <div className="group relative flex min-w-0 flex-col gap-1 bg-surface px-4 py-3 shadow-[1px_0_0_var(--color-line),0_1px_0_var(--color-line)]" style={{ animation: `gl-rise .4s ${i * 0.04}s ease both` }} data-tile={t.label} title={t.title} tabIndex={t.title ? 0 : undefined}>
      <span className="font-mono text-[11px] tracking-[1px] [overflow-wrap:anywhere] text-faint">{t.label}</span>
      {known ? (
        <AnimatedNumber className="font-display text-[26px] leading-none font-bold" style={{ color: t.tone }} value={t.value} format={t.format ?? NF.int} prefix={t.prefix} suffix={t.suffix} countUp />
      ) : (
        <span className="flex h-[26px] items-center font-mono text-[12px] text-faint">{t.unknown ?? 'not tracked yet'}</span>
      )}
      {t.note && <span className="text-[12px] [overflow-wrap:anywhere] text-muted">{t.note}</span>}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}

/** The one page header of every app page (G48/X8): icon (or a `logo`), a 20 px title, one line, a status pill,
    Docs / Public page links and an optional band of live KPI tiles. Everything but icon, title and desc is
    optional, so Merchant, Keys, Alerts, Billing and Security use the same header; `eyebrow` is a small caps line
    above the title, `accent` a coloured top edge (a store's brand colour), `children` extra chips after the
    status pill. */
export function ServiceHeader({ icon: Icon, logo, title, eyebrow, desc, status, tiles, docs, page, actions, accent, children }: { icon: LucideIcon; logo?: ReactNode; title: string; eyebrow?: string; desc?: ReactNode; status?: Status; tiles?: Tile[]; docs?: string; page?: { href: string; label?: string }; actions?: ReactNode; accent?: string | null; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4" data-testid="service-header" style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {logo ?? (
          <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] text-gold" aria-hidden>
            <Icon size={18} />
          </span>
        )}
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-[2px]">
          {eyebrow && <span className="font-mono text-[11px] tracking-[1px] text-faint">{eyebrow}</span>}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={pageTitle}>{title}</h1>
            {status && <StatusPill s={status} />}
            {children}
          </span>
          {desc && <p className="m-0 text-[13px] leading-[1.45] text-muted">{desc}</p>}
        </div>
        {(docs || page || actions) && (
          <nav aria-label={`${title} links`} className="flex flex-wrap items-center gap-2 max-[600px]:w-full">
            {actions}
            {docs && (
              <ExtLink href={docs} className={pillSm}>
                <BookOpen size={14} aria-hidden /> Docs
              </ExtLink>
            )}
            {page && (
              <ExtLink href={page.href} className={pillSm}>
                <Globe size={14} aria-hidden /> {page.label ?? 'Public page'}
              </ExtLink>
            )}
          </nav>
        )}
      </div>
      {tiles && tiles.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] overflow-hidden rounded-card border border-line bg-surface" aria-label={`${title}, live figures`} role="group">
          {tiles.map((t, i) => (
            <KpiTile key={t.label} t={t} i={i} />
          ))}
        </div>
      )}
    </header>
  )
}

/** A titled panel for a service page's body. */
export function Section({ title, sub, children, className = '', aside }: { title: string; sub?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 ${className}`} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-[2px]">
          <h2 className="m-0 text-[15px] leading-tight font-semibold text-ink">{title}</h2>
          {sub && <span className="font-mono text-[11px] text-faint">{sub}</span>}
        </span>
        {aside}
      </div>
      {children}
    </section>
  )
}
