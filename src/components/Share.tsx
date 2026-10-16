import { useEffect, useState } from 'react'
import type { Project } from '../content/projects'
import { SHARE, SITE_URL } from '../content/site'
import { gullyPost, projectPost, tgShare, xFollow, xPost } from '../lib/share'
import type { Stats } from '../lib/stats'
import { SocialIcon } from './SocialIcon'

/* Sharing controls: the texts and intent links live in lib/share.ts. */

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(id)
  }, [copied])
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined)
  }
  return [copied, copy]
}

const pill =
  'inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-btn border border-line-strong bg-transparent px-[16px] py-[10px] text-[14px] font-medium text-ink transition-colors hover:border-gold hover:text-ink'

/** Hero share bar: follow, post, send, copy. */
export function ShareBar({ data }: { data: Stats | null }) {
  const [copied, copy] = useCopied()
  const text = gullyPost(data)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Follow and share">
      <a href={xFollow(SHARE.handle)} target="_blank" rel="noopener" className={`${pill} border-gold-line text-gold hover:bg-gold hover:text-bg`}>
        <SocialIcon name="X" size={14} />
        Follow {SHARE.handle}
      </a>
      <a href={xPost(text, SITE_URL)} target="_blank" rel="noopener" className={pill}>
        <SocialIcon name="X" size={14} />
        Post about Gully
      </a>
      <a href={tgShare(text, SITE_URL)} target="_blank" rel="noopener" className={pill}>
        <SocialIcon name="Telegram" size={15} />
        Send on Telegram
      </a>
      {canShare ? (
        <button type="button" onClick={() => navigator.share({ title: 'Gully Labs', text, url: SITE_URL }).catch(() => undefined)} className={pill}>
          Share…
        </button>
      ) : (
        <button type="button" onClick={() => copy(SITE_URL)} className={pill} aria-live="polite">
          {copied ? '✓ Link copied' : 'Copy link'}
        </button>
      )}
    </div>
  )
}

/** The composed post, shown as a card so a visitor can see what they are about to share. */
export function ShareStrip({ data }: { data: Stats | null }) {
  const [copied, copy] = useCopied()
  const text = gullyPost(data)
  return (
    <section aria-label="Share Gully Labs" className="border-t border-line px-page py-24">
      <div className="grid grid-cols-[1fr_1fr] items-center gap-[clamp(32px,4cqw,72px)] max-[959px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <span className="font-mono text-[13px] tracking-[1.5px] text-gold">SPREAD THE WORD</span>
          <h2 className="m-0 font-display text-[clamp(40px,4.5cqw,64px)] leading-[.95] font-extrabold uppercase">
            One post. <span className="text-gold">Five venues.</span>
          </h2>
          <p className="m-0 max-w-[480px] text-[17px] leading-[1.55] text-muted">
            The post on the right is written from the figures on this page at this moment, with the source behind them. Post it as it is or make it yours.
          </p>
          <ShareBar data={data} />
        </div>
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-7">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-bg text-ink">
              <SocialIcon name="X" size={16} />
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold">Gully Labs</span>
              <span className="font-mono text-[12px] text-faint">{SHARE.handle}</span>
            </div>
          </div>
          <p className="m-0 text-[17px] leading-[1.55] text-ink-2">
            {text} <span className="text-gold">{SITE_URL.replace('https://', '')}</span>
          </p>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <a href={xPost(text, SITE_URL)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-[18px] py-[10px] text-[14px] font-semibold text-bg transition-colors hover:bg-gold-hover hover:text-bg">
              <SocialIcon name="X" size={14} />
              Post this
            </a>
            <button type="button" onClick={() => copy(`${text} ${SITE_URL}`)} className={pill} aria-live="polite">
              {copied ? '✓ Copied' : 'Copy text'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Per-project share controls for a row or page. */
export function ShareMenu({ project: p, compact = false }: { project: Project; compact?: boolean }) {
  const [copied, copy] = useCopied()
  const text = projectPost(p)
  const btn = compact
    ? 'inline-flex size-9 items-center justify-center rounded-btn border border-line bg-transparent text-muted transition-colors hover:border-gold hover:text-gold'
    : pill
  return (
    <div className={`flex items-center gap-2 ${compact ? 'flex-nowrap gap-1' : 'flex-wrap'}`} aria-label={`Share ${p.name}`}>
      <a href={xPost(text, p.url)} target="_blank" rel="noopener" className={btn} title={`Post about ${p.name} on X`} aria-label={`Post about ${p.name} on X`}>
        <SocialIcon name="X" size={14} />
        {!compact && 'Post on X'}
      </a>
      {p.telegram && (
        <a href={tgShare(text, p.url)} target="_blank" rel="noopener" className={btn} title={`Send ${p.name} on Telegram`} aria-label={`Send ${p.name} on Telegram`}>
          <SocialIcon name="Telegram" size={15} />
          {!compact && 'Send on Telegram'}
        </a>
      )}
      <button type="button" onClick={() => copy(p.url)} className={btn} title="Copy link" aria-label={`Copy the ${p.name} link`} aria-live="polite">
        {copied ? (
          <span className="font-mono text-[12px] text-green">✓</span>
        ) : (
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        )}
        {!compact && (copied ? 'Copied' : 'Copy link')}
      </button>
      {p.x && !compact && (
        <a href={xFollow(p.x)} target="_blank" rel="noopener" className={pill}>
          Follow {p.x}
        </a>
      )}
    </div>
  )
}
