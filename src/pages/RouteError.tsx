import { useState } from 'react'
import { useRouteError } from 'react-router'
import { Wordmark } from '../components/brand'
import { isChunkError, reloadForNewBuild } from '../lib/staleBuild'

/** Shown instead of React Router's default error screen. A page left open across a deploy reloads
    itself onto the new build; anything else gets a branded message with a way out. */
export function RouteError() {
  const error = useRouteError()
  const stale = isChunkError(error)
  // Decided once, on first render: reload onto the new build unless this page already did in the last minute.
  const [reloading] = useState(() => stale && reloadForNewBuild())

  return (
    <main className="flex min-h-[70vh] flex-col items-start justify-center gap-5 bg-bg px-page py-24 text-ink">
      <a href="/" aria-label="Gully Labs home" className="mb-4 inline-flex min-h-11 items-center rounded-btn">
        <Wordmark height={28} decorative />
      </a>
      <span className="font-mono text-[13px] tracking-[1.5px] text-gold">{reloading ? 'UPDATING' : 'SOMETHING WENT WRONG'}</span>
      <h1 className="m-0 font-display text-[clamp(40px,6cqw,72px)] leading-[.95] font-extrabold uppercase">
        {reloading ? 'Loading the latest version…' : stale ? 'A new version is out' : 'This page could not load'}
      </h1>
      <p className="m-0 max-w-[560px] text-[17px] leading-[1.6] text-muted">
        {reloading
          ? 'The site was updated while this page was open.'
          : stale
            ? 'The site was updated while this page was open. Reload to get the latest version.'
            : 'Try again, or go back to the home page.'}
      </p>
      {!reloading && (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-btn bg-gold px-6 text-[15px] font-semibold text-bg hover:bg-gold-hover">
            Reload
          </button>
          <a href="/" className="inline-flex min-h-11 items-center rounded-btn border border-line-strong px-6 text-[15px] font-semibold text-ink hover:border-gold hover:text-ink">
            Home
          </a>
        </div>
      )}
    </main>
  )
}
