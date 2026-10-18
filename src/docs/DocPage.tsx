import { ArrowLeft, ArrowRight, ArrowUpRight, Hash } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { eyebrow as eyebrowCls } from '../components/ui'
import { canonical, DOC_PAGES, useDocHref, type DocSlug } from './nav'

export interface DocSection {
  id: string
  title: string
}

function setHead(title: string, description: string, slug: DocSlug) {
  const full = `${title} · Gully Labs Docs`
  document.title = full
  const meta = (attr: 'name' | 'property', key: string, content: string) => {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute(attr, key)
      document.head.appendChild(el)
    }
    el.content = content
  }
  meta('name', 'description', description)
  meta('property', 'og:title', full)
  meta('property', 'og:description', description)
  meta('property', 'og:url', canonical(slug))
  meta('name', 'twitter:title', full)
  meta('name', 'twitter:description', description)
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (link) link.href = canonical(slug)
}

/** "On this page": the section nearest the top of the viewport is marked current. */
function OnThisPage({ sections }: { sections: DocSection[] }) {
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e)
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = sections.find((s) => seen.get(s.id))
        if (first) setCurrent(first.id)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [sections])
  return (
    <nav aria-label="On this page" className="sticky top-[88px] flex flex-col gap-3 max-[1199px]:hidden">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">ON THIS PAGE</span>
      <ul className="m-0 flex list-none flex-col gap-[2px] border-l border-line p-0">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={`-ml-px flex items-start gap-2 border-l py-[5px] pl-3 text-[13px] leading-[1.4] transition-colors ${current === s.id ? 'border-gold text-ink' : 'border-transparent text-dim hover:text-ink'}`}
            >
              <Hash className="icon-sm mt-[2px]" aria-hidden />
              <span className="min-w-0">{s.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function PrevNext({ slug }: { slug: DocSlug }) {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug)
  const prev = DOC_PAGES[i - 1]
  const next = DOC_PAGES[i + 1]
  const prevHref = useDocHref(prev?.slug ?? '')
  const nextHref = useDocHref(next?.slug ?? '')
  const cls = 'flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-lg border border-line px-4 py-3 transition-colors hover:border-gold-line hover:bg-surface'
  return (
    <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-3 border-t border-line pt-8">
      {prev ? (
        <Link to={prevHref} className={cls}>
          <span className="flex items-center gap-1 font-mono text-[11px] tracking-[1px] text-faint">
            <ArrowLeft size={12} aria-hidden /> PREVIOUS
          </span>
          <span className="text-[15px] text-ink">{prev.title}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next && (
        <Link to={nextHref} className={`${cls} items-end text-right`}>
          <span className="flex items-center gap-1 font-mono text-[11px] tracking-[1px] text-faint">
            NEXT <ArrowRight size={12} aria-hidden />
          </span>
          <span className="text-[15px] text-ink">{next.title}</span>
        </Link>
      )}
    </nav>
  )
}

/** One docs page: head tags, title block, content column and the "On this page" rail. */
export function DocPage({ slug, eyebrow, title, description, lead, sections, children }: { slug: DocSlug; eyebrow: string; title: string; description: string; lead: ReactNode; sections: DocSection[]; children: ReactNode }) {
  useEffect(() => setHead(title, description, slug), [title, description, slug])
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-12 max-[1199px]:grid-cols-1">
      <article className="flex max-w-[780px] min-w-0 flex-col gap-10" style={{ animation: 'gl-rise .45s ease both' }}>
        <header className="flex flex-col gap-4">
          <span className={eyebrowCls}>{eyebrow}</span>
          <h1 className="heading-1">{title}</h1>
          <p className="m-0 text-[17px] leading-[1.6] text-muted">{lead}</p>
        </header>
        {children}
        <PrevNext slug={slug} />
      </article>
      <aside className="min-w-0">
        <OnThisPage sections={sections} />
      </aside>
    </div>
  )
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h2 id={id} className={`group m-0 scroll-mt-[88px] leading-none ${title.startsWith('GET ') ? 'font-mono text-[24px] font-medium' : 'heading-3'}`}>
        <a href={`#${id}`} className="-my-[10px] inline-block py-[10px] text-ink no-underline">
          {title}
          <span aria-hidden className="ml-2 text-gold opacity-0 transition-opacity group-hover:opacity-100">
            #
          </span>
        </a>
      </h2>
      {children}
    </section>
  )
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="m-0 mt-2 scroll-mt-[88px] font-mono text-[14px] font-medium tracking-[.5px] text-ink">
      {children}
    </h3>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[15.5px] leading-[1.7] text-ink-2">{children}</p>
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-sm border border-line bg-surface-deep px-[5px] py-[1px] font-mono text-[max(11px,.88em)] break-words text-ink">{children}</code>
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[15.5px] leading-[1.65] text-ink-2 marker:text-gold">{children}</ul>
}

export function Callout({ label, children, tone = 'gold' }: { label: string; children: ReactNode; tone?: 'gold' | 'plain' }) {
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-5 ${tone === 'gold' ? 'border-gold-line bg-[rgba(217,181,99,.06)]' : 'border-line bg-surface'}`}>
      <span className="font-mono text-[11px] tracking-[1px] text-gold">{label}</span>
      <div className="text-[14.5px] leading-[1.65] text-ink-2">{children}</div>
    </div>
  )
}

/**
 * A field table that stacks into cards on phones, so nothing scrolls sideways. `routes` is the endpoint-table
 * layout: path, a wide description, then a narrow mono column for limits and caching.
 */
export function Fields({ rows, head = ['Field', 'Type', 'Meaning'], variant = 'fields' }: { rows: [string, ReactNode, ReactNode][]; head?: [string, string, string]; variant?: 'fields' | 'routes' }) {
  const grid = variant === 'routes' ? 'grid-cols-[minmax(0,1.1fr)_minmax(0,2.2fr)_minmax(0,.9fr)]' : 'grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)_minmax(0,2.2fr)]'
  const mono = 'font-mono text-[12px] break-words text-dim'
  const text = 'text-[14px] leading-[1.6] text-ink-2'
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className={`grid ${grid} gap-4 border-b border-line bg-surface px-4 py-2 font-mono text-[11px] tracking-[1px] text-faint max-[640px]:hidden`}>
        {head.map((h) => (
          <span key={h}>{h.toUpperCase()}</span>
        ))}
      </div>
      <div className="divide-y divide-line">
        {rows.map(([f, t, m]) => (
          <div key={f} className={`grid ${grid} gap-4 px-4 py-3 transition-colors hover:bg-surface max-[640px]:grid-cols-1 max-[640px]:gap-1`}>
            <span className="font-mono text-[13px] break-words text-gold">{f}</span>
            <span className={variant === 'routes' ? text : mono}>{t}</span>
            <span className={variant === 'routes' ? mono : text}>{m}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A link to another docs page that works under both mounts. */
export function DocLink({ to, hash, children }: { to: DocSlug; hash?: string; children: ReactNode }) {
  const href = useDocHref(to, hash)
  return (
    <Link to={href} className="text-gold underline decoration-gold-line underline-offset-[3px] transition-colors hover:decoration-gold">
      {children}
    </Link>
  )
}

/** A link to another host: opens in a new tab, marked with ↗ (and said aloud for screen readers). */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-gold underline decoration-gold-line underline-offset-[3px] transition-colors hover:decoration-gold">
      {children}
      <ArrowUpRight size={12} aria-hidden className="ml-[2px] inline-block align-[-1px]" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
