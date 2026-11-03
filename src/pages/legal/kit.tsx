import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

/* The legal pages' shared layout (2026-11-03): one readable long-form page for gullylabs.xyz (/terms, /privacy, /legal,
   /legal/merchant-terms, /legal/scan-terms) and holdermaps.xyz (/terms, /privacy). The site's Tailwind tokens are
   re-pointed to the HolderMaps kit under the .hm root (src/holdermaps/hm.css), so the same classes wear each product's
   own kit. A ~70ch measure, 17 px body, a table of contents (sticky beside the text from 1024 px, a collapsible list
   above it on phones), "Last updated", 44 px tap targets, and the licence footer each adapted text needs.
   Section ids are s1…sN: Gully AI's index (scripts/build-ask-index.mjs) reads every <S n title> and the <Intro>. */

/** Facts every legal page states the same way (owner, 2026-11-03). */
export const LEGAL = {
  entity: 'Gully Labs LLC',
  place: 'Oregon, USA',
  law: 'the State of Oregon, USA',
  email: 'team@gullylabs.xyz',
  updated: 'November 3, 2026',
  updatedIso: '2026-11-03',
} as const

/** The canonical addresses of Gully Labs' own policies (gullylabs.xyz). */
export const SITE_LEGAL = {
  terms: 'https://gullylabs.xyz/terms',
  privacy: 'https://gullylabs.xyz/privacy',
  index: 'https://gullylabs.xyz/legal',
} as const

export const BASECAMP_URL = 'https://github.com/basecamp/policies'
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/'
export const COMMON_PAPER_URL = 'https://commonpaper.com/standards/cloud-service-agreement/2.1/'

export const link = 'text-gold underline decoration-gold-line underline-offset-2 hover:text-gold-hover'
const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

/** One numbered section; its id (s<n>) is what the table of contents and Gully AI's sources link to. */
export function S({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section id={`s${n}`} aria-labelledby={`s${n}-h`} className="flex scroll-mt-24 flex-col gap-4">
      <h2 id={`s${n}-h`} className="m-0 font-display text-[clamp(22px,3vw,28px)] leading-[1.1] font-bold text-ink uppercase">
        <span className="mr-2 font-mono text-[15px] font-normal text-gold">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  )
}
export const P = ({ children }: { children: ReactNode }) => <p className="m-0 text-[17px] leading-[1.7] text-ink-2 max-[600px]:text-[16px]">{children}</p>
export const L = ({ children }: { children: ReactNode }) => <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[17px] leading-[1.65] text-ink-2 marker:text-gold max-[600px]:text-[16px]">{children}</ul>
/** The page's opening prose (Gully AI indexes it as the page's introduction). */
export const Intro = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-4">{children}</div>
export const Mail = () => (
  <a href={`mailto:${LEGAL.email}`} className={link}>
    {LEGAL.email}
  </a>
)

/** An outside link: a new tab, said out loud for screen readers. */
export function Ext({ href, children, className = link }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} {...ext} className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** A link to another page of the same site (same tab), or to another domain (new tab). */
export function To({ href, children, className = link }: { href: string; children: ReactNode; className?: string }) {
  return /^https?:/.test(href) ? (
    <Ext href={href} className={className}>
      {children}
    </Ext>
  ) : (
    <Link to={href} className={className}>
      {children}
    </Link>
  )
}

/** "The page at a glance": a few facts, each linking to its section. */
export function Glance({ items, label }: { items: { icon: LucideIcon; t: string; d: string; s: number }[]; label: string }) {
  return (
    <ul aria-label={label} data-testid="legal-glance" className="m-0 grid list-none grid-cols-3 gap-2 p-0 max-[900px]:grid-cols-2 max-[480px]:grid-cols-1">
      {items.map(({ icon: Icon, t, d, s }, i) => (
        <li key={t} style={{ animation: `gl-rise .5s ${(0.1 + i * 0.06).toFixed(2)}s cubic-bezier(.2,.8,.2,1) both` }}>
          <a href={`#s${s}`} className="flex h-full min-h-11 items-start gap-3 rounded-card border border-line bg-surface px-3 py-3 transition-colors hover:border-gold-line focus-visible:border-gold-line">
            <span className="grid size-8 flex-none place-items-center rounded-[8px] border border-gold-line text-gold">
              <Icon size={16} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-[14px] leading-[1.3] font-semibold text-ink">{t}</span>
              <span className="text-[13px] leading-[1.45] text-muted">{d}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function TocList({ sections }: { sections: readonly string[] }) {
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {sections.map((t, i) => (
        <li key={t}>
          <a href={`#s${i + 1}`} className="flex min-h-11 items-center gap-2 rounded-[6px] px-2 text-[14px] leading-[1.3] text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:text-ink">
            <span className="w-6 flex-none font-mono text-[12px] text-gold">{i + 1}.</span>
            <span className="min-w-0">{t}</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

/** What the page's licence footer says: adapted from Basecamp's policies, from Common Paper's standard terms, or both. */
export type Adapted = 'basecamp' | 'common-paper'

/** The licence note under the content, in the exact words the CC BY licence and our policy rule ask for. */
export function Attribution({ product, adapted = 'basecamp' }: { product: string; adapted?: Adapted }) {
  const url = 'break-all text-muted underline underline-offset-4 hover:text-gold'
  if (adapted === 'common-paper')
    return (
      <p className="m-0" data-testid="legal-attribution">
        Adapted from the Common Paper Cloud Service Agreement Standard Terms Version 2.1 (
        <Ext href={COMMON_PAPER_URL} className={url}>
          {COMMON_PAPER_URL}
        </Ext>
        ), CC BY 4.0 (
        <Ext href={CC_BY_URL} className={url}>
          {CC_BY_URL}
        </Ext>
        ). Changed by {LEGAL.entity} for {product}. This page is also available under CC BY 4.0.
      </p>
    )
  return (
    <p className="m-0" data-testid="legal-attribution">
      Adapted from the Basecamp open-source policies (
      <Ext href={BASECAMP_URL} className={url}>
        {BASECAMP_URL}
      </Ext>
      ), CC BY 4.0 (
      <Ext href={CC_BY_URL} className={url}>
        {CC_BY_URL}
      </Ext>
      ). Changed by {LEGAL.entity} for {product}. This page is also available under CC BY 4.0.
    </p>
  )
}

export interface LegalPageProps {
  /** The small label above the title, e.g. "Legal · Terms". */
  kicker: string
  title: string
  /** The product the page is for, named in the licence footer. */
  product: string
  sections: readonly string[]
  intro: ReactNode
  glance?: ReactNode
  /** The links under the page: the product's other policies and the index of every product's. */
  related: { href: string; label: string }[]
  adapted?: Adapted
  /** Extra line under the date (a version the product records, for example). */
  version?: string
  testId?: string
  children: ReactNode
}

/** One legal page: title, last updated, the introduction, a table of contents and the numbered sections. */
export function LegalPage({ kicker, title, product, sections, intro, glance, related, adapted = 'basecamp', version, testId, children }: LegalPageProps) {
  return (
    <article className="relative px-page pt-[56px] pb-24 max-[600px]:pt-8" data-legal-page data-testid={testId}>
      <div className="mx-auto grid max-w-[1080px] gap-x-12 gap-y-8 min-[1024px]:grid-cols-[220px_minmax(0,70ch)] min-[1024px]:justify-center">
        <header className="flex min-w-0 flex-col gap-4 min-[1024px]:col-start-2" style={{ animation: 'gl-rise .5s ease both' }}>
          <span className="font-mono text-[12px] tracking-[1.5px] text-gold uppercase">{kicker}</span>
          <h1 className="m-0 font-display text-[clamp(38px,6.5vw,64px)] leading-[.95] font-extrabold text-ink uppercase">{title}</h1>
          <p className="m-0 font-mono text-[13px] text-muted">
            Last updated <time dateTime={LEGAL.updatedIso}>{LEGAL.updated}</time>
            {version ? ` · ${version}` : ''}
          </p>
          {intro}
          {glance}
        </header>

        {/* Phones and tablets: a collapsible list above the text. */}
        <details className="group min-w-0 rounded-card border border-line bg-surface min-[1024px]:hidden" data-testid="legal-toc-mobile">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 font-mono text-[13px] tracking-[1px] text-ink uppercase [&::-webkit-details-marker]:hidden">
            Contents · {sections.length} sections
            <ChevronDown size={16} aria-hidden className="text-gold transition-transform group-open:rotate-180" />
          </summary>
          <nav aria-label="Contents" className="border-t border-line px-2 py-2">
            <TocList sections={sections} />
          </nav>
        </details>

        {/* Desktop: sticky beside the text. */}
        <aside className="hidden min-[1024px]:col-start-1 min-[1024px]:row-start-1 min-[1024px]:row-span-2 min-[1024px]:block">
          <nav aria-label="Contents" className="sticky top-24 flex max-h-[calc(100vh-120px)] flex-col gap-2 overflow-y-auto pb-4" data-testid="legal-toc">
            <span className="px-2 font-mono text-[12px] tracking-[1.5px] text-muted uppercase">Contents</span>
            <TocList sections={sections} />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-12 min-[1024px]:col-start-2">
          {children}
          <footer className="flex flex-col gap-3 border-t border-line pt-6 text-[13px] leading-[1.7] text-muted" data-testid="legal-footer">
            <nav aria-label="Policies" className="flex flex-wrap gap-x-5 font-mono text-[13px]">
              {related.map((r) => (
                <To key={r.href} href={r.href} className="inline-flex min-h-11 items-center text-ink-2 underline-offset-4 hover:text-gold hover:underline">
                  {r.label}
                </To>
              ))}
            </nav>
            <p className="m-0">
              {LEGAL.entity}, {LEGAL.place}. Questions about this page: <Mail />.
            </p>
            <Attribution product={product} adapted={adapted} />
          </footer>
        </div>
      </div>
    </article>
  )
}
