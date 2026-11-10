import { Activity, ArrowLeftRight, BadgeCheck, Coins, CreditCard, Droplets, Fuel, KeyRound, Layers, Search, Server, Shield, Shuffle, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toastError } from '../../components/ui/toast'
import { gullyIdAccessToken } from '../developers/gullyId'
import { deliveryLabel, gullyExchange, hasGullySession, usd, type Quote, type QuoteLine } from './chainApi'

/* The pieces the wizard and the order page share. The site's own header and footer come from the Layout the routes sit in
   (src/router.tsx); this file adds the Gully ID chip to that header, the page frame, the chain diagram and the price card. */

/** The page body: one column of cards under the site header. */
export function ChainShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-4 pt-6 pb-10 min-[900px]:px-7">{children}</div>
}

export const SESSION_EVENT = 'gl-gid-session'

/** Gully ID session state for this browser; it follows a sign-in made anywhere on the page. */
export function useGullySession(): boolean | null {
  const [state, setState] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void hasGullySession().then((v) => live && setState(v))
    const on = (e: Event) => setState((e as CustomEvent<boolean>).detail)
    window.addEventListener(SESSION_EVENT, on)
    return () => {
      live = false
      window.removeEventListener(SESSION_EVENT, on)
    }
  }, [])
  return state
}

/** The Gully ID account chip, placed in the site header's right-hand group. Signed out it starts the sign-in. */
export function GullyIdChip() {
  const state = useGullySession()
  const [busy, setBusy] = useState(false)
  const [host, setHost] = useState<Element | null>(null)
  useEffect(() => {
    setHost(document.querySelector('header.nav .navr'))
  }, [])
  if (!host || state === null) return null
  const signIn = async () => {
    setBusy(true)
    try {
      const r = await gullyExchange(await gullyIdAccessToken())
      if (!r.ok) return toastError('Could not sign in', { detail: r.error })
      window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: true }))
    } catch (e) {
      toastError('Could not sign in', { detail: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }
  const cls = 'inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] font-semibold text-ink-2'
  return createPortal(
    state ? (
      <span className={cls} data-testid="gully-id-chip" aria-label="Signed in with Gully ID">
        <span className="size-2 rounded-full bg-green" aria-hidden />
        <KeyRound size={15} aria-hidden />
        <span className="max-[639px]:sr-only">Gully ID</span>
      </span>
    ) : (
      <button type="button" className={`${cls} cursor-pointer transition-colors hover:border-gold hover:text-ink disabled:opacity-60`} disabled={busy} onClick={() => void signIn()} data-testid="gully-id-chip" aria-label="Sign in with Gully ID">
        <KeyRound size={15} aria-hidden />
        <span className="max-[639px]:sr-only">Sign in</span>
      </button>
    ),
    host,
    'gully-id-chip',
  )
}

export const ADDON_ICONS: Record<string, LucideIcon> = { explorer: Search, bridge: ArrowLeftRight, faucet: Droplets, rpc: Server, verify: BadgeCheck, monitoring: Activity, multisig: Shield, aa: Wallet, 'gully-core': Layers, paymaster: Fuel, pay: CreditCard, hyperlane: Shuffle, 'usdc-gas': Coins }

/** The lines of a quote as the chain diagram lists them: the bundle, then the add-ons, each with how it is delivered. */
export const quoteServices = (q: Quote | null) => [...(q?.included ?? []), ...(q?.addons ?? [])].map((a) => ({ id: a.id, label: a.name, note: deliveryLabel(a.delivery), delivery: a.delivery ?? 'team' }))

/** An add-on's terms in the price card. */
export const termsOf = (a: QuoteLine) => [a.fee, a.billing].filter(Boolean).join(' · ') || (a.usd === null ? 'Priced with you' : a.usd === 0 ? 'Included' : `$${a.usd}/month`)

/** One chain, drawn: it settles to its parent chain (batches flow up), and the services it gets sit under it as tiles. */
export function ChainDiagram({ name, chainId, logo, parent, services }: { name: string; chainId: string; logo: string | null; parent: string; services: { id: string; label: string; note: string; delivery?: string }[] }) {
  const title = name.trim() || 'Your chain'
  return (
    <figure className="m-0 flex flex-col gap-3" aria-label={`${title} settles to ${parent}`} data-testid="chain-diagram">
      <style>{`@keyframes gl-flow{to{stroke-dashoffset:-16}}@keyframes gl-tile{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.gl-flow{animation:gl-flow 1.1s linear infinite}.gl-tile{animation:gl-tile .3s ease both}@media (prefers-reduced-motion:reduce){.gl-flow,.gl-tile{animation:none}}`}</style>
      <svg viewBox="0 0 320 170" role="img" aria-hidden className="h-auto w-full">
        <rect x="70" y="4" width="180" height="38" rx="10" className="fill-surface-hover stroke-line-strong" />
        <text x="160" y="20" textAnchor="middle" className="fill-faint text-[10px]">
          Settles to
        </text>
        <text x="160" y="34" textAnchor="middle" className="fill-ink text-[12px] font-semibold">
          {parent}
        </text>
        <line x1="160" y1="42" x2="160" y2="108" className="stroke-line-strong" strokeWidth="2" />
        <line x1="160" y1="108" x2="160" y2="42" className="gl-flow stroke-gold" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 12" />
        <text x="172" y="80" className="fill-faint text-[10px]">
          batches
        </text>
        <rect x="30" y="108" width="260" height="56" rx="12" className="fill-surface-hover stroke-gold" strokeWidth="1.5" />
        {logo ? <image href={logo} x="44" y="120" width="32" height="32" preserveAspectRatio="xMidYMid slice" clipPath="inset(0 round 8px)" /> : <rect x="44" y="120" width="32" height="32" rx="8" className="fill-line-strong" />}
        <text x="86" y="133" className="fill-ink text-[13px] font-semibold">
          {title.length > 24 ? `${title.slice(0, 23)}…` : title}
        </text>
        <text x="86" y="150" className="fill-faint text-[11px]">
          {chainId ? `Chain id ${chainId}` : 'Chain id not set'}
        </text>
      </svg>
      <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0" aria-label="Services on your chain">
        {services.map((s) => {
          const Icon = ADDON_ICONS[s.id] ?? Layers
          return (
            <li key={s.id} className="gl-tile flex min-w-0 items-center gap-2 rounded-input border border-line bg-bg px-2.5 py-2" data-testid={`tile-${s.id}`} data-delivery={s.delivery}>
              <Icon size={16} className="shrink-0 text-gold" aria-hidden />
              <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 leading-tight">
                <span className="min-w-0 text-[13px] font-medium text-ink">{s.label}</span>
                <span className={`shrink-0 text-[11px] ${s.note === 'Automatic' ? 'text-green' : 'text-faint'}`}>{s.note}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

/** The live price summary: every figure is the server's own quote. */
export function PriceSummary({ quote, children }: { quote: Quote | null; children?: ReactNode }) {
  return (
    <aside className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4" aria-label="Price summary" data-testid="price-summary">
      {children}
      <div className="flex flex-col gap-1 border-t border-line pt-4 first:border-t-0 first:pt-0">
        <h2 className="m-0 text-[13px] font-semibold text-muted">Plan and price</h2>
        {!quote ? (
          <p className="m-0 text-[13px] text-faint">Working it out…</p>
        ) : (
          <>
            <p className="m-0 text-[20px] leading-tight font-semibold text-ink" data-testid="price-headline">
              {quote.headline}
            </p>
            <p className="m-0 text-[13px] text-muted" data-testid="price-after">
              {quote.after}
            </p>
          </>
        )}
      </div>
      {quote && (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {!!quote.included?.length && (
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-muted">Standard bundle, {quote.included.length} services</span>
                <span className="text-right text-ink-2">Included</span>
              </li>
            )}
            {quote.addons.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3">
                <span className="text-muted">{a.name}</span>
                <span className="text-right text-ink-2">{termsOf(a)}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[13px]">
            <span className="text-muted">{quote.testCharge ? 'Test payment today' : 'Due today'}</span>
            <span className="text-[16px] font-semibold text-ink" data-testid="due-today">
              {usd(quote.dueCents)}
            </span>
          </p>
          {quote.testCharge && <p className="m-0 text-[12px] leading-[1.4] text-faint">Paid in testnet USDC.e, which has no value. No real money moves.</p>}
        </>
      )}
    </aside>
  )
}
