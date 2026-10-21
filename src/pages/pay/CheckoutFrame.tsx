import { Lockup, Mascot } from '../../components/brand'
import { Check, Copy, ExternalLink, ShieldCheck, Store } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { SecuredBy } from '../../components/pay/SecuredBy'
import { copyWithToast } from '../../components/ui/toast'
import { Outlet } from 'react-router'
import { SITE_URL } from '../../site-host'
import { accentOf, storeName, type Brand } from './brand'

/* The standalone checkout (every /pay page): no site header, nav or footer. A slim top bar with the
   store's logo and name (or the Gully Labs kit lockup on our own invoices) and a non-custodial badge; the
   order summary on the left and the payment panel on the right at desktop width, one column on a phone
   with a sticky Pay bar; "Secured by Gully Pay" with the shield and the kit mark at the foot. The logo
   (the lockup, or the store's) is 36 px tall, 40 px from 1440 up; the header also carries the small seal.

   Branding: the store's uploaded logo, else a neutral store glyph (never a letter tile). A store that has
   not set a name is "Store" with its owner's short address. The accent is only used where it keeps
   WCAG contrast against the page (accentOf); otherwise the kit gold.

   Brand assets come from public/brand/kit (the kit's transparent PNGs at the size shown, 1x and 2x) and
   public/brand/gully-mark-96.png. TODO(feat/brand-kit): switch to src/components/brand once it lands. */

/* -------------------------------------------------------------- marks --- */

/** The store's logo, or the neutral store glyph. */
export function StoreMark({ brand, size = 40 }: { brand: Brand; size?: number }) {
  const radius = Math.round(size * 0.25)
  if (brand.logoUrl)
    return <img src={brand.logoUrl} alt={`${storeName(brand)} logo`} width={size} height={size} className="shrink-0 border border-line bg-surface object-contain" style={{ width: size, height: size, borderRadius: radius }} />
  return (
    <span aria-hidden className="grid shrink-0 place-items-center border border-line-strong bg-surface-deep text-muted" style={{ width: size, height: size, borderRadius: radius }} data-testid="store-glyph">
      <Store size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  )
}

/** The kit's horizontal lockup (mascot + wordmark), on dark or on light, from public/brand/kit. */
export function GullyLockup({ height = 34, light = false, className = '' }: { height?: number; light?: boolean; className?: string }) {
  return <Lockup height={height} theme={light ? 'light' : 'dark'} className={className} />
}

/** The kit mark (the mascot bust on its disc), as in the site's logo registry. */
export function GullyMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return <Mascot size={size} className={className} decorative />
}

/* --------------------------------------------------------------- root --- */

/** The route layout of every /pay page: the page colours and a skip link, nothing of the site around it. */
export function CheckoutRoot() {
  return (
    <div className="min-h-[100svh] bg-bg font-sans text-ink [container-type:inline-size]">
      <a href="#main" className="sr-only z-60 rounded-btn bg-gold px-4 py-2 text-bg focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Outlet />
    </div>
  )
}

/** What a /pay page shows while its code or data loads: the frame's outline, pulsing. */
export function CheckoutSkeleton() {
  const bar = 'animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-card bg-surface'
  return (
    <div role="status" aria-label="Loading the checkout" className="flex min-h-[100svh] flex-col">
      <div className="flex h-16 items-center justify-between border-b border-line px-4 sm:px-6">
        <span className={`${bar} h-9 w-[160px]`} />
        <span className={`${bar} h-7 w-[140px] rounded-full`} />
      </div>
      <div className="mx-auto grid w-full max-w-[1120px] flex-1 grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-12 lg:py-12">
        <div className="flex flex-col gap-4">
          <span className={`${bar} h-[14px] w-[120px] rounded-full`} />
          <span className={`${bar} h-[28px] w-[min(420px,100%)]`} />
          <span className={`${bar} h-[120px] w-full`} />
        </div>
        <span className={`${bar} h-[420px] w-full`} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- frame --- */

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The logo height: 36 px, 40 px on a wide screen. */
function useLogoSize() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1440px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1440px)')
    const sync = () => setWide(mq.matches)
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return wide ? 40 : 36
}

function TopBar({ brand }: { brand: Brand }) {
  const logo = useLogoSize()
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex min-h-16 w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        {brand.gully ? (
          <a href="https://gullylabs.xyz" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-btn" aria-label="Gully Labs (opens in a new tab)">
            <GullyLockup height={logo} />
          </a>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <StoreMark brand={brand} size={logo} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="flex min-w-0 items-center gap-2">
                <b className="truncate text-[16px] font-semibold text-ink" data-testid="store-name">
                  {storeName(brand)}
                </b>
                {!brand.named && (
                  <span className="shrink-0 rounded-full border border-line-strong px-2 py-[1px] font-mono text-[11px] text-dim" title="The wallet that runs this store" data-testid="store-owner">
                    {brand.ownerShort}
                  </span>
                )}
              </span>
              {brand.website && (
                <a href={brand.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[12px] text-dim underline-offset-4 hover:text-ink hover:underline">
                  {hostOf(brand.website)} <ExternalLink size={11} aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span></a>
              )}
            </span>
          </div>
        )}
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SecuredBy variant="small" />
          <span className="inline-flex items-center gap-2 rounded-full border border-success-line bg-success-bg px-3 py-[6px] text-[12px] font-medium text-green max-[559px]:hidden" title="Your transfer goes straight to the recipient's wallet; nobody holds it in between.">
            <ShieldCheck size={14} aria-hidden /> Non-custodial
          </span>
        </span>
      </div>
    </header>
  )
}

function Foot({ brand }: { brand: Brand }) {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 text-[12px] text-faint max-lg:pb-24 sm:px-6">
        <a href="https://gullylabs.xyz" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-mono tracking-[1px] text-faint hover:text-ink" aria-label="Secured by Gully Pay (opens in a new tab)">
          SECURED BY <ShieldCheck size={15} className="text-gold" aria-hidden /> <GullyMark size={20} /> <span className="text-gold">GULLY PAY</span>
        </a>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5">
          <a href={`${SITE_URL}/legal/merchant-terms`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:text-ink hover:underline">
            Merchant terms <ExternalLink size={11} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span></a>
          <a href={`${SITE_URL}/legal/privacy`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:text-ink hover:underline">
            Privacy <ExternalLink size={11} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span></a>
          {!brand.gully && brand.supportEmail && (
            <a href={`mailto:${brand.supportEmail}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-ink hover:underline">
              Contact {storeName(brand)}
            </a>
          )}
        </nav>
      </div>
    </footer>
  )
}

/**
 * The checkout page around its two columns. `summary` is the order (left), `children` the payment panel
 * (right). `bar` is true when the panel shows a sticky bottom bar on phones (MobilePayBar), so the page
 * leaves room for it.
 */
export function CheckoutFrame({ brand, summary, children, bar = false, single = false }: { brand: Brand; summary?: ReactNode; children: ReactNode; bar?: boolean; single?: boolean }) {
  const accent = accentOf(brand)
  return (
    <div className="flex min-h-[100svh] flex-col" style={{ borderTop: `3px solid ${accent.color}` }}>
      <TopBar brand={brand} />
      <main id="main" tabIndex={-1} className={`mx-auto grid w-full max-w-[1120px] items-start gap-6 px-4 py-6 outline-none sm:px-6 lg:gap-10 lg:py-8 ${single ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]'} ${bar ? 'pb-28 lg:pb-8' : ''}`} aria-live="polite">
        {summary}
        {children}
      </main>
      <Foot brand={brand} />
    </div>
  )
}

/** The payment panel: a card with a header (title and status pill) and its body. */
/** The pay link as a "copy link" button (never the raw URL printed under the title). `path` is host + path. */
function CopyLink({ path }: { path: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        copyWithToast(`${window.location.protocol}//${path}`, 'Link').then((ok) => {
          if (!ok) return
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        })
      }
      // A 44 px hit area round the small label, without growing the header row (D4-15).
      className={`relative inline-flex w-fit items-center gap-1 font-mono text-[11px] transition-colors before:absolute before:-inset-x-2 before:-inset-y-[15px] before:content-[''] ${done ? 'text-green' : 'text-faint hover:text-ink'}`}
      aria-label={done ? 'Link copied' : 'Copy link'}
      data-testid="copy-link"
    >
      {done ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />} {done ? 'Link copied' : 'Copy link'}
    </button>
  )
}

export function PayPanel({ title, copyLink, pill, children, label = 'Payment' }: { title: string; copyLink?: string; pill?: { text: string; cls: string }; children: ReactNode; label?: string }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface lg:sticky lg:top-6" aria-label={label} style={{ animation: 'gl-rise .5s .07s ease both' }}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <span className="flex min-w-0 flex-col leading-[1.25]">
          <b className="truncate text-[15px] font-semibold text-ink">{title}</b>
          {copyLink && <CopyLink path={copyLink} />}
        </span>
        {pill && (
          <span className={`shrink-0 rounded-full border px-3 py-[3px] text-[12px] font-semibold transition-colors duration-300 ${pill.cls}`} data-testid="status-pill">
            {pill.text}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-4 p-4 sm:p-5">{children}</div>
    </section>
  )
}

/** The sticky bottom bar on phones: the total and one action. Hidden from lg up, where the panel is beside the order. */
export function MobilePayBar({ total, children }: { total: string; children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[rgba(13,20,28,.94)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden" role="region" aria-label="Pay">
      <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">TOTAL</span>
          <b className="truncate text-[17px] font-semibold text-ink">{total}</b>
        </span>
        {children}
      </div>
    </div>
  )
}
