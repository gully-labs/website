import { ArrowUpRight, Ban, Clock, Loader2, Mail, PauseCircle, RefreshCw, TriangleAlert, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { btnOutline } from '../../components/ui'
import { GULLY_BRAND, merchantTabUrl, pills, storeName, type Brand, type Viewer } from './brand'
import { CheckoutFrame, PayPanel } from './CheckoutFrame'

/* The checkout's dead ends, each saying what happened and who to ask: unavailable (no receiving wallet,
   store blocked), paused (an unpaid fee statement), expired, cancelled, a closed pay link, a network error
   with retry, loading, and a link that matches nothing. A signed-in member of the store also sees what to
   fix, with a link to the Merchant tab of the Gully Labs App (the server adds `viewer` for them; brand.ts). */

function Contact({ brand }: { brand: Brand }) {
  const who = brand.gully ? 'Gully Labs' : storeName(brand)
  if (!brand.supportEmail) return <>Contact {who} to pay another way.</>
  return (
    <>
      Contact {who}:{' '}
      <a href={`mailto:${brand.supportEmail}`} className="inline-flex items-center gap-1 text-ink underline underline-offset-4 hover:text-gold">
        <Mail size={13} aria-hidden /> {brand.supportEmail}
      </a>
    </>
  )
}

/** What the store's own team sees under a closed checkout: the to-do list, linked to the Merchant tab. */
export function OwnerFixes({ viewer }: { viewer: Viewer | null | undefined }) {
  if (!viewer?.fixes.length) return null
  return (
    <div className="flex flex-col gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-4 text-[14px] leading-[1.55] text-ink-2" data-testid="owner-fixes">
      <span className="inline-flex items-center gap-2 font-semibold text-ink">
        <Wrench size={15} className="text-gold" aria-hidden /> You run this store ({viewer.role}). Payers see the message above; to open the checkout:
      </span>
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5">
        {viewer.fixes.map((f, i) => (
          <li key={i}>
            {f.text}{' '}
            <a href={merchantTabUrl(f.id)} className="inline-flex items-center gap-1 text-gold underline-offset-4 hover:underline">
              Open in the Merchant tab <ArrowUpRight size={12} aria-hidden />
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Notice({ icon, title, children, tone = 'muted' }: { icon?: ReactNode; title?: string; children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div className={`flex items-start gap-3 rounded-input border px-4 py-4 text-[15px] leading-[1.6] ${tone === 'error' ? 'border-[#5a2a24] bg-[rgba(255,138,122,.06)] text-ink-2' : 'border-line-strong bg-bg text-ink-2'}`} role="status">
      {icon}
      <span className="flex min-w-0 flex-col gap-1">
        {title && <b className="text-ink">{title}</b>}
        <span>{children}</span>
      </span>
    </div>
  )
}

/** The checkout is closed by the store's setup (no receiving wallet, store not available). */
export function Unavailable({ brand, reason, viewer }: { brand: Brand; reason?: string | null; viewer?: Viewer | null }) {
  return (
    <div className="flex flex-col gap-4" data-testid="state-unavailable">
      <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />} title="This checkout isn't available right now.">
        <Contact brand={brand} />
        {reason && <span className="mt-1 block font-mono text-[11px] text-faint">{reason}</span>}
      </Notice>
      <OwnerFixes viewer={viewer} />
    </div>
  )
}

/** The store's checkouts are paused (an unpaid fee statement). */
export function Paused({ brand, viewer }: { brand: Brand; viewer?: Viewer | null }) {
  return (
    <div className="flex flex-col gap-4" data-testid="state-paused">
      <Notice icon={<PauseCircle size={18} className="mt-[3px] shrink-0 text-error" aria-hidden />} title="This store's checkout is paused." tone="error">
        Nothing can be paid here right now. <Contact brand={brand} />
      </Notice>
      <OwnerFixes viewer={viewer} />
    </div>
  )
}

export function Expired({ when, brand, fromLink }: { when: string; brand: Brand; fromLink: boolean }) {
  return (
    <Notice icon={<Clock size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />} title={`This invoice expired on ${when} without a payment.`}>
      {fromLink ? 'Open the payment link again to start a new checkout. ' : 'Ask for a new one. '}
      If you paid it in time, send the transaction hash: <Contact brand={brand} />
    </Notice>
  )
}

export function Cancelled({ when, brand }: { when: string; brand: Brand }) {
  return (
    <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />} title={`This invoice was cancelled on ${when} and cannot be paid.`}>
      <Contact brand={brand} />
    </Notice>
  )
}

/** A pay link that is switched off, expired or used up. */
export function LinkClosed({ state, text, brand, viewer }: { state: 'inactive' | 'expired' | 'used-up'; text: string | null; brand: Brand; viewer?: Viewer | null }) {
  const title = { inactive: 'This payment link is switched off.', expired: 'This payment link has expired.', 'used-up': 'This payment link has reached its maximum uses.' }[state]
  return (
    <div className="flex flex-col gap-4" data-testid={`state-link-${state}`}>
      <Notice icon={state === 'expired' ? <Clock size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden /> : <Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />} title={title}>
        {text ? `${text} ` : ''}
        Ask for a new link. <Contact brand={brand} />
      </Notice>
      <OwnerFixes viewer={viewer} />
    </div>
  )
}

/** A failed read of the invoice or link: the message and a retry, in the frame so the page is never blank. */
export function LoadFailed({ what, message, retry }: { what: string; message: string; retry: () => void }) {
  return (
    <CheckoutFrame brand={GULLY_BRAND} single>
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-card border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-6 py-6" role="alert" data-testid="state-error">
        <span className="inline-flex items-center gap-2 text-[16px] font-semibold text-ink">
          <TriangleAlert size={18} className="text-error" aria-hidden /> The {what} could not be read
        </span>
        <span className="text-[14px] leading-[1.6] text-ink-2">{message}</span>
        <button type="button" onClick={retry} className={`${btnOutline} inline-flex min-h-11 w-fit items-center gap-2 px-5 text-[14px]`}>
          <RefreshCw size={14} aria-hidden /> Try again
        </button>
      </div>
    </CheckoutFrame>
  )
}

export function Reading({ what }: { what: string }) {
  return (
    <CheckoutFrame brand={GULLY_BRAND} single>
      <p className="m-0 inline-flex items-center gap-3 font-mono text-[13px] text-faint" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden /> Reading the {what}…
      </p>
    </CheckoutFrame>
  )
}

export function Missing({ what, text }: { what: string; text: string }) {
  return (
    <CheckoutFrame brand={GULLY_BRAND} single>
      <div className="mx-auto w-full max-w-[560px]">
        <PayPanel title={`No such ${what}`} pill={pills.closed}>
          <p className="m-0 text-[15px] leading-[1.6] text-muted">{text}</p>
        </PayPanel>
      </div>
    </CheckoutFrame>
  )
}
