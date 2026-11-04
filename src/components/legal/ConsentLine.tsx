import { SITE_URL } from '../../site-host'

/* "By continuing you agree to the Terms and Privacy Policy." (owner rule, 2026-11-03): one line under every sign-in,
   key-creation, checkout and purchase step. Links only: it never gates a button or changes what the step does. The
   links open in a new tab so a half-finished checkout or sign-in is not lost. HolderMaps passes its own /terms and
   /privacy (holdermaps.xyz); everything else names gullylabs.xyz's. */
export function ConsentLine({ terms = `${SITE_URL}/terms`, privacy = `${SITE_URL}/privacy`, className = '' }: { terms?: string; privacy?: string; className?: string }) {
  const a = 'underline underline-offset-2 hover:text-gold focus-visible:text-gold'
  return (
    <p className={`m-0 text-[12px] leading-[1.6] text-muted ${className}`} data-testid="consent-line">
      By continuing you agree to the{' '}
      <a href={terms} target="_blank" rel="noopener noreferrer" className={a}>
        Terms<span className="sr-only"> (opens in a new tab)</span>
      </a>{' '}
      and{' '}
      <a href={privacy} target="_blank" rel="noopener noreferrer" className={a}>
        Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
      </a>
      .
    </p>
  )
}
