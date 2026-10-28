import { Link } from 'react-router'
import { motion } from 'motion/react'
import { ArrowUpRight, BookOpen, GitFork, Newspaper } from 'lucide-react'
import { processSteps, services } from '../../content/services'
import type { Stats } from '../../lib/stats'
import { DOCS_URL } from '../../site-host'
import { ShareBar } from '../Share'
import { useContact } from '../ContactContext'
import { BLOG_URL, eyebrow, h2 } from './links'

/* The landing's closing sections: the four services in one row with the four-step process inline and
   a "Start a project" call, then a slim strip of the open-source repos, docs, blog and share links. */

const ease = [0.2, 0.8, 0.2, 1] as const

export function ServicesBlock() {
  const { openContact } = useContact()
  return (
    <section id="services" aria-labelledby="services-title" className="scroll-mt-[72px] border-t border-line bg-bg-alt">
      <div className="flex flex-col gap-5 px-page py-12 max-[599px]:py-9">
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.45, ease }} className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>SERVICES</span>
            <h2 id="services-title" className={h2}>
              The same team, on your project
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/services" className="inline-flex min-h-11 items-center text-[14px] font-medium text-muted hover:text-gold">
              All services →
            </Link>
            <button type="button" onClick={() => openContact()} className="inline-flex min-h-11 items-center rounded-btn bg-gold px-[18px] font-semibold text-bg transition-colors hover:bg-gold-hover">
              Start a project
            </button>
          </div>
        </motion.div>
        <ul className="m-0 grid list-none grid-cols-4 gap-px overflow-hidden rounded-card border border-line bg-line p-0 max-[1099px]:grid-cols-2 max-[559px]:grid-cols-1">
          {services.map((s, i) => (
            <motion.li key={s.n} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.06 }} className="flex min-w-0">
              <button type="button" onClick={() => openContact(s.type)} className="group flex w-full flex-col items-start gap-1 bg-surface px-4 py-[14px] text-left text-ink transition-colors hover:bg-surface-hover">
                <span className="flex w-full items-center justify-between">
                  <span className="font-mono text-[11px] text-gold">
                    {s.n} · <span className="text-faint">{s.time}</span>
                  </span>
                  <s.icon aria-hidden size={17} strokeWidth={1.5} className="text-faint transition-[color,transform] duration-200 group-hover:-translate-y-px group-hover:text-gold" />
                </span>
                <b className="font-display text-[20px] font-bold uppercase">{s.name}</b>
                <span className="text-[13px] leading-[1.4] text-muted">{s.description}</span>
                <span className="pt-1 font-mono text-[11px] text-gold opacity-80 transition-opacity group-hover:opacity-100">Ask about this →</span>
              </button>
            </motion.li>
          ))}
        </ul>
        <ol aria-label="How we work" className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-2 p-0 font-mono text-[12px] text-muted">
          {processSteps.map((s, i) => (
            <li key={s.n} className="flex items-center gap-2" title={s.description}>
              <span className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-[5px]">
                <s.icon aria-hidden size={13} className="text-gold" />
                <span className="text-gold">{s.n}</span> {s.name}
              </span>
              <span className="sr-only">: {s.description}</span>
              {i < processSteps.length - 1 && (
                <span aria-hidden className="text-faint">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const OPENS: { t: string; href: string; kind: 'repo' | 'docs' | 'blog' }[] = [
  { t: 'gully-labs/sdk', href: 'https://github.com/gully-labs/sdk', kind: 'repo' },
  { t: 'gully-labs/umami', href: 'https://github.com/gully-labs/umami/tree/gully/analytics', kind: 'repo' },
  { t: 'Docs', href: DOCS_URL, kind: 'docs' },
  { t: 'Blog', href: BLOG_URL, kind: 'blog' },
]

export function OpenStrip({ data }: { data: Stats | null }) {
  return (
    <section id="open" aria-label="Open source, docs, blog and sharing" className="scroll-mt-[72px] border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-page py-6">
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1 p-0">
          <li className={`mr-2 ${eyebrow}`}>OPEN SOURCE</li>
          {OPENS.map((o) => {
            const Icon = o.kind === 'repo' ? GitFork : o.kind === 'docs' ? BookOpen : Newspaper
            return (
              <li key={o.t}>
                <a href={o.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-[6px] rounded-btn px-2 text-[13px] text-ink-2 transition-colors hover:bg-surface hover:text-gold">
                  <Icon aria-hidden size={14} className="text-faint" />
                  {o.t}
                  <ArrowUpRight aria-hidden size={12} className="text-faint" />
                <span className="sr-only"> (opens in a new tab)</span></a>
              </li>
            )
          })}
        </ul>
        <ShareBar data={data} />
      </div>
    </section>
  )
}
