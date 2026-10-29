import { BookOpen, FileJson } from 'lucide-react'
import { useEffect } from 'react'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { Seo } from '../components/Seo'
import { StatusBoard } from '../components/status/StatusBoard'
import { eyebrow } from '../components/ui'
import { ChainChip } from '../components/ProjectRows'
import { FALLBACK_CHAINS } from '../content/ecosystem'
import { track } from '../lib/track'
import { DOCS_URL } from '../site-host'

/* /status: the public, live status of the Gully Labs stack (GET /api/status, server/status.mjs). Every figure is
   read from the server's own checks; nothing here is typed in. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

export function StatusPage() {
  useEffect(() => {
    track('status-view', { from: document.referrer ? 'link' : 'direct' })
  }, [])
  return (
    <>
      <Seo title="Status" description="Live status of Gully Labs: the API, tracker freshness per chain, the Telegram bot, Gully Pay RPCs, Gully AI, the security scan engine, monitors and Holder Map sources, with 24 h uptime and incidents." />
      {/* A compact hero (D4-14): the live board starts within the first screen, as on /chains. */}
      <section className="relative overflow-hidden px-page pt-10 pb-8 max-[599px]:pt-8">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(0,210,255,.12),transparent_62%)]" />
        <div className="relative flex max-w-[860px] flex-col gap-4">
          <span className={eyebrow} style={rise(0)}>
            STATUS
          </span>
          <h1 className="m-0 font-display text-h2 font-extrabold uppercase" style={rise(1)}>
            System <span className="text-gold">status</span>
          </h1>
          <p className="m-0 max-w-[680px] text-[16px] leading-[1.6] text-muted" style={rise(2)}>
            Every part of the stack we can check from our own server, checked once a minute: the API, how fresh the tracker is on each chain, the Telegram bot, the payment RPCs, Gully AI, the security scan engine, contract monitors and the Holder Map sources. Not configured means the
            feature is switched off on this server, not broken.
          </p>
          <div className="flex flex-wrap gap-2" style={rise(3)} aria-label="Chains the Holder Map covers">
            {FALLBACK_CHAINS.map((c) => (
              <ChainChip key={c.key} chain={c.key} name={c.name} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3" style={rise(3)}>
            <a href={`${DOCS_URL}/status`} {...newTab} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink transition-colors hover:border-gold">
              <BookOpen aria-hidden size={16} strokeWidth={1.75} className="text-gold" /> What each check means <NewTabMark size={13} />
            </a>
            <a href="/api/status" {...newTab} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink transition-colors hover:border-gold">
              <FileJson aria-hidden size={16} strokeWidth={1.75} className="text-gold" /> GET /api/status <NewTabMark size={13} />
            </a>
          </div>
        </div>
      </section>
      <section className="px-page pb-24" aria-label="Live status">
        <StatusBoard />
      </section>
    </>
  )
}
