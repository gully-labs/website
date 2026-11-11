import { ArrowLeft, ArrowRight, Bell, Check, CircleAlert, CircleCheck, CreditCard, ImagePlus, Layers, Loader2, Shuffle, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { api } from '../developers/api'
import { GullyIdButton, gullyIdAccessToken, gullyIdRedirectToken, isGullyIdReturn } from '../developers/gullyId'
import { checkChainId, deliveryLabel, getOffer, getQuote, gullyExchange, hasGullySession, notifyMainnet, startCheckout, type Offer, type Order, type Quote, type Tier } from './chainApi'
import { ADDON_ICONS, ChainDiagram, ChainShell, GullyIdChip, PriceSummary, quoteServices, SESSION_EVENT } from './parts'

/* Create a chain (app.gullylabs.xyz/create-chain): five steps ending in Gully Pay's hosted checkout, or in a recorded order
   when nothing is due. The server prices everything (GET /api/chain-orders/quote); this page only shows it. Our own code,
   written clean: nothing here comes from the Orbit deployment UI fork, which has no upstream licence. Each line says
   whether it is automatic or set up by our team (the bundle's `delivery`, server/chains-plans.mjs); no price shows
   after the free days until the owner confirms it. The site's header and footer come from the Layout the route sits in; the form is saved in
   this browser (localStorage) so a reload keeps it. */

const STEPS = [
  { label: 'Chain', note: 'Name and id' },
  { label: 'Plan', note: 'Testnet and add-ons' },
  { label: 'Review', note: 'Check the request' },
  { label: 'Sign in', note: 'With Gully ID' },
  { label: 'Confirm', note: 'Send the request' },
]
const DRAFT = 'gl-chain-draft'
const MAX_LOGO = 96 * 1024
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{2,39}$/u
const SYMBOL_RE = /^[A-Z][A-Z0-9]{1,7}$/

interface Draft {
  name: string
  chainId: string
  gasToken: string
  gasSymbol: string
  logo: string | null
  tier: Tier
  addons: string[]
  parent: number | null
  email: string
  step: number
}
const EMPTY: Draft = { name: '', chainId: '', gasToken: 'eth', gasSymbol: '', logo: null, tier: 'testnet', addons: [], parent: null, email: '', step: 0 }

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Draft) } : null
  } catch {
    return null
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT, JSON.stringify(d))
    else localStorage.removeItem(DRAFT)
  } catch {
    /* the page works without it */
  }
}

const parentOf = (offer: Offer, d: Draft) => offer.parents[d.tier].find((p) => p.id === d.parent) ?? offer.parents[d.tier][0]
const label = 'text-[13px] font-medium text-ink-2'
const help = 'm-0 text-[12px] leading-[1.45] text-faint'
const field = 'h-10 w-full rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-gold'
const btnPri = 'btn pri disabled:cursor-not-allowed disabled:opacity-50'
const unitCard = (on: boolean) => `flex w-full min-h-11 cursor-pointer items-start gap-3 rounded-input border p-3 text-left transition-colors ${on ? 'border-gold bg-surface-hover' : 'border-line hover:border-line-hover'}`

function Stepper({ step, go }: { step: number; go: (n: number) => void }) {
  return (
    <nav aria-label="Steps" className="min-w-0">
      <ol className="m-0 flex list-none items-start gap-1 p-0 min-[1100px]:flex-col min-[1100px]:gap-0">
        {STEPS.map((s, i) => {
          const done = i < step
          const cur = i === step
          return (
            <li key={s.label} className="relative flex min-w-0 flex-1 flex-col items-center gap-1 min-[1100px]:w-full min-[1100px]:flex-none min-[1100px]:flex-row min-[1100px]:items-start min-[1100px]:gap-3 min-[1100px]:pb-6 min-[1100px]:last:pb-0">
              {i < STEPS.length - 1 && <span aria-hidden className={`absolute top-4 left-[calc(50%+20px)] h-px w-[calc(100%-40px)] min-[1100px]:top-9 min-[1100px]:left-4 min-[1100px]:h-[calc(100%-36px)] min-[1100px]:w-px ${done ? 'bg-gold' : 'bg-line-strong'}`} />}
              <button type="button" disabled={!done} onClick={() => go(i)} aria-current={cur ? 'step' : undefined} aria-label={`Step ${i + 1}, ${s.label}${done ? ', done' : cur ? ', current' : ''}`} data-testid={`step-${i + 1}`} className="group flex min-w-0 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-center disabled:cursor-default min-[1100px]:flex-row min-[1100px]:items-start min-[1100px]:gap-3 min-[1100px]:text-left">
                <span className={`z-[1] inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold transition-colors ${cur ? 'border-gold bg-gold text-bg shadow-[0_0_0_4px_rgba(111,141,223,.25)]' : done ? 'border-gold bg-surface text-gold group-hover:bg-surface-hover' : 'border-line-strong bg-bg text-faint'}`}>
                  {done ? <Check size={15} aria-hidden /> : i + 1}
                </span>
                <span className={`flex min-w-0 flex-col leading-tight min-[1100px]:pt-1 ${cur ? '' : 'max-[639px]:hidden'}`}>
                  <span className={`text-[13px] font-semibold ${cur ? 'text-ink' : done ? 'text-ink-2' : 'text-faint'}`}>{s.label}</span>
                  <span className="hidden text-[11px] text-faint min-[1100px]:block">{s.note}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function Card({ n, title, intro, id, children }: { n: number; title: string; intro: string; id: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5 max-[639px]:p-4" aria-labelledby={id}>
      <header className="flex flex-col gap-1">
        <p className="m-0 text-[12px] font-semibold tracking-[.04em] text-gold uppercase">
          Step {n} of {STEPS.length}
        </p>
        <h2 id={id} className="m-0 text-[20px] leading-tight font-semibold text-ink">
          {title}
        </h2>
        <p className="m-0 text-[14px] leading-[1.45] text-muted">{intro}</p>
      </header>
      {children}
    </section>
  )
}

function Seg<T extends string>({ value, options, onChange, name }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; name: string }) {
  return (
    <div role="group" aria-label={name} className="inline-flex w-fit max-w-full rounded-full border border-line-strong bg-bg p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={`min-h-9 cursor-pointer rounded-full border-0 px-4 text-[13px] font-semibold transition-colors ${value === o.id ? 'bg-gold text-bg' : 'bg-transparent text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

type IdState = { state: string; reason?: string }

function ChainStep({ offer, d, set, id }: { offer: Offer; d: Draft; set: (p: Partial<Draft>) => void; id: IdState }) {
  const file = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const name = d.name.trim()
  const nameErr = !name ? '' : name.length > 40 ? 'Too long: keep it to 40 characters or fewer.' : name.length < 3 ? 'At least 3 characters.' : !NAME_RE.test(name) ? 'Use letters, numbers, spaces, dots or dashes.' : ''
  const tooLong = nameErr.startsWith('Too long')
  const toasted = useRef(false)
  useEffect(() => {
    if (tooLong && !toasted.current) toastError('That name is too long', { detail: 'A chain name is 3 to 40 characters.' })
    toasted.current = tooLong
  }, [tooLong])
  const idToasted = useRef('')
  useEffect(() => {
    if (id.state === 'taken' && idToasted.current !== d.chainId) {
      idToasted.current = d.chainId
      toastError('That chain id is taken', { detail: id.reason })
    }
  }, [id.state, id.reason, d.chainId])
  const pick = (f: File | undefined) => {
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toastError('That logo will not work', { detail: 'Use a PNG, JPEG or WebP image.' })
    if (f.size > MAX_LOGO) return toastError('That logo is too big', { detail: 'Keep it under 96 KB.' })
    const r = new FileReader()
    r.onload = () => set({ logo: String(r.result) })
    r.readAsDataURL(f)
  }
  return (
    <Card n={1} id="step-chain" title="Name your chain" intro="An Arbitrum Orbit chain that we set up and run for you: your own explorer, bridge, faucet and RPC.">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="chain-name" className={label}>
          Chain name
        </label>
        <input id="chain-name" className={`${field} ${nameErr ? 'border-error' : ''}`} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Acme Chain" autoComplete="off" aria-invalid={!!nameErr} aria-describedby="chain-name-help" data-testid="chain-name" />
        <p id="chain-name-help" className={`${help} flex justify-between gap-3 ${nameErr ? '!text-error' : ''}`}>
          <span>{nameErr || 'Shown in your explorer and in wallets. 3 to 40 letters, numbers, spaces, dots or dashes.'}</span>
          <span aria-hidden>{name.length}/40</span>
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="chain-id" className={label}>
          Chain id
        </label>
        <div className="relative">
          <input id="chain-id" className={`${field} pr-32 ${id.state === 'taken' ? 'border-error' : ''}`} inputMode="numeric" value={d.chainId} onChange={(e) => set({ chainId: e.target.value.replace(/[^0-9]/g, '') })} placeholder="7084123" autoComplete="off" aria-invalid={id.state === 'taken'} aria-describedby="chain-id-check" data-testid="chain-id" />
          <button type="button" className="absolute top-1/2 right-1.5 inline-flex h-7 -translate-y-1/2 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-[12px] font-semibold text-gold hover:bg-surface-hover" onClick={() => set({ chainId: String(1_000_000 + Math.floor(Math.random() * 4_000_000_000)) })}>
            <Shuffle size={13} aria-hidden />
            Suggest one
          </button>
        </div>
        <p id="chain-id-check" className={`${help} flex min-h-5 items-start gap-1.5 ${id.state === 'taken' ? '!text-error' : id.state === 'free' ? '!text-green' : ''}`} role="status" data-testid="chain-id-check">
          {id.state === 'taken' ? <CircleAlert size={14} className="mt-px shrink-0" aria-hidden /> : id.state === 'free' ? <CircleCheck size={14} className="mt-px shrink-0" aria-hidden /> : null}
          <span>{id.state === 'checking' ? 'Checking…' : id.state === 'free' ? 'This id is free.' : id.state === 'taken' ? id.reason : 'The number wallets use to tell chains apart. We check it against Chainlist, the chains we run and other orders.'}</span>
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={label}>Gas token</span>
        <Seg name="Gas token" value={d.gasToken} options={offer.gasTokens.map((g) => ({ id: g.id, label: g.name }))} onChange={(v) => set({ gasToken: v })} />
        <p className={help}>The coin your users pay fees with. ETH needs nothing more; with your own token you name a symbol.</p>
      </div>
      {d.gasToken === 'custom' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gas-symbol" className={label}>
            Token symbol
          </label>
          <input id="gas-symbol" className={`${field} max-w-[200px]`} value={d.gasSymbol} maxLength={8} onChange={(e) => set({ gasSymbol: e.target.value.toUpperCase() })} placeholder="ACME" autoComplete="off" data-testid="gas-symbol" />
          <p className={`${help} ${d.gasSymbol && !SYMBOL_RE.test(d.gasSymbol) ? '!text-error' : ''}`}>2 to 8 capital letters or digits, starting with a letter.</p>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className={label}>Logo (optional)</span>
        <div
          role="button"
          tabIndex={0}
          aria-label={d.logo ? 'Change the logo' : 'Add a logo'}
          onClick={() => file.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              file.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            pick(e.dataTransfer.files[0])
          }}
          className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-input border border-dashed px-3 py-2 transition-colors ${drag ? 'border-gold bg-surface-hover' : 'border-line-strong hover:border-gold'}`}
        >
          {d.logo ? (
            <img src={d.logo} alt="Your chain's logo" width={44} height={44} className="size-11 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-bg text-faint">
              <ImagePlus size={20} aria-hidden />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-[13px] font-medium text-ink">{d.logo ? 'Logo added' : 'Drop a logo here, or click to choose'}</span>
            <span className="text-[12px] text-faint">PNG, JPEG or WebP, under 96 KB. Shown on your explorer and order page.</span>
          </span>
          {d.logo && (
            <button
              type="button"
              aria-label="Remove the logo"
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-faint hover:bg-surface-hover hover:text-ink"
              onClick={(e) => {
                e.stopPropagation()
                set({ logo: null })
              }}
            >
              <X size={16} aria-hidden />
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label="Logo file"
            data-testid="chain-logo"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>
    </Card>
  )
}

function MainnetSoon() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const send = async () => {
    setBusy(true)
    const r = await notifyMainnet(email.trim())
    setBusy(false)
    if (!r.ok) return toastError('Could not save your email', { detail: r.error })
    setDone(true)
    toastSuccess('You are on the list', { detail: 'We will tell you when mainnet chains open.' })
  }
  return (
    <div className="flex flex-col gap-3 rounded-input border border-line p-4" data-testid="mainnet-soon">
      <h3 className="m-0 text-[16px] font-semibold text-ink">Mainnet chains: coming soon</h3>
      <p className="m-0 text-[14px] leading-[1.45] text-muted">Managed mainnet chains open once pricing and hosting terms are set. Leave your email and we will tell you when they do.</p>
      {done ? (
        <p className="m-0 flex items-center gap-2 text-[14px] text-ink" data-testid="mainnet-notified">
          <CircleCheck size={18} className="text-green" aria-hidden />
          Saved. We will tell you when mainnet chains open.
        </p>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label htmlFor="mainnet-email" className="sr-only">
            Email
          </label>
          <input id="mainnet-email" className={`${field} min-w-0 flex-[1_1_220px]`} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="mainnet-email" />
          <button type="submit" className={btnPri} disabled={busy || !email.trim()} data-testid="mainnet-notify">
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Bell size={18} aria-hidden />}
            Notify me
          </button>
        </form>
      )}
    </div>
  )
}

function PlanStep({ offer, d, set, tab, setTab }: { offer: Offer; d: Draft; set: (p: Partial<Draft>) => void; tab: Tier; setTab: (t: Tier) => void }) {
  const toggle = (id: string) => set({ addons: d.addons.includes(id) ? d.addons.filter((a) => a !== id) : [...d.addons, id] })
  const included = offer.included.filter((a) => d.tier === 'testnet' || !a.testnetOnly)
  const par = parentOf(offer, d)
  const pickTab = (t: Tier) => {
    setTab(t)
    if (t === 'testnet' && d.tier !== 'testnet') set({ tier: 'testnet', parent: null })
    if (t === 'mainnet' && offer.flags.mainnetOrders && d.tier !== 'mainnet') set({ tier: 'mainnet', parent: null })
  }
  const tabBtn = (t: Tier, text: string) => (
    <button type="button" role="tab" aria-selected={tab === t} onClick={() => pickTab(t)} data-testid={`tier-${t}`} className={`min-h-9 cursor-pointer rounded-full border-0 px-4 text-[13px] font-semibold transition-colors ${tab === t ? 'bg-gold text-bg' : 'bg-transparent text-ink-2 hover:text-ink'}`}>
      {text}
    </button>
  )
  return (
    <Card n={2} id="step-plan" title="Pick a plan" intro={`Start on a free testnet. Our team sets it up within ${offer.setupDays} business days.`}>
      <div role="tablist" aria-label="Network" className="inline-flex w-fit max-w-full rounded-full border border-line-strong bg-bg p-0.5">
        {tabBtn('testnet', 'Testnet')}
        {tabBtn('mainnet', 'Mainnet')}
      </div>
      {tab === 'mainnet' && !offer.flags.mainnetOrders ? (
        <MainnetSoon />
      ) : (
        <>
          <p className="m-0 text-[14px] text-muted" data-testid="tier-note">
            {d.tier === 'testnet' ? `Free for ${offer.freeDays} days. Settles to Arbitrum Sepolia.` : 'We run it for you. Settles to Arbitrum One or Nova.'}
          </p>
          {offer.parents[d.tier].length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className={label}>Settles to</span>
              <Seg name="Settles to" value={String(par.id)} options={offer.parents[d.tier].map((p) => ({ id: String(p.id), label: p.name }))} onChange={(v) => set({ parent: Number(v) })} />
            </div>
          )}
          <p className={help} data-testid="licence-note">
            {offer.licenceNote}
          </p>
          <h3 className="m-0 text-[14px] font-semibold text-ink">Included on every chain</h3>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 max-[600px]:grid-cols-1" data-testid="bundle-included">
            {included.map((a) => {
              const Icon = ADDON_ICONS[a.id] ?? Layers
              return (
                <li key={a.id} className="flex min-w-0 items-start gap-3 rounded-input border border-line p-3" data-testid={`included-${a.id}`}>
                  <Icon size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px] text-ink">{a.name}</span>
                    <span className="text-[12px] text-muted">{a.body}</span>
                    <span className={`text-[12px] ${a.delivery === 'automatic' ? 'text-green' : 'text-faint'}`}>{deliveryLabel(a.delivery)}</span>
                  </span>
                  <Check size={14} className="mt-1 shrink-0 text-gold" aria-hidden />
                </li>
              )
            })}
          </ul>
          <h3 className="m-0 text-[14px] font-semibold text-ink">Add-ons</h3>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 max-[600px]:grid-cols-1">
            {offer.addons.map((a) => {
              const Icon = ADDON_ICONS[a.id] ?? Layers
              const planned = a.status !== 'available'
              const on = !planned && d.addons.includes(a.id)
              const terms = [a.fee, a.billing].filter(Boolean).join(' · ')
              return (
                <li key={a.id}>
                  <button type="button" aria-pressed={on} disabled={planned} onClick={() => toggle(a.id)} data-testid={`addon-${a.id}`} className={`${unitCard(on)} disabled:cursor-not-allowed disabled:opacity-60`}>
                    <Icon size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[14px] text-ink">{a.name}</span>
                      <span className="text-[12px] text-muted">{a.body}</span>
                      {!planned && terms && <span className="text-[12px] text-ink-2">{terms}</span>}
                      <span className={`text-[12px] ${a.delivery === 'automatic' ? 'text-green' : 'text-faint'}`}>{planned ? 'Planned: not orderable yet' : deliveryLabel(a.delivery)}</span>
                    </span>
                    {!planned && (
                      <span aria-hidden className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong'}`}>
                        {on && <Check size={11} />}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Card>
  )
}

function ReviewStep({ offer, d, free }: { offer: Offer; d: Draft; free: boolean }) {
  const rows: [string, string][] = [
    ['Name', d.name.trim()],
    ['Chain id', d.chainId],
    ['Gas token', d.gasToken === 'eth' ? 'ETH' : d.gasSymbol],
    ['Plan', d.tier === 'testnet' ? 'Testnet' : 'Managed mainnet'],
    ['Settles to', parentOf(offer, d).name],
  ]
  return (
    <Card n={3} id="step-price" title="Check your request" intro="This is what you are asking for. Nothing is charged on this step.">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 text-right font-medium break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className={help}>
        {offer.billing.note} Our team sets up your chain within {offer.setupDays} business days {free ? 'of your request' : 'of payment'}. Updates appear on your order page.
      </p>
    </Card>
  )
}

export function CreateChainPage() {
  const nav = useNavigate()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [d, setD] = useState<Draft>(() => readDraft() ?? EMPTY)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [id, setId] = useState<IdState>({ state: '' })
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tier>(() => readDraft()?.tier ?? 'testnet')
  const set = useCallback((p: Partial<Draft>) => setD((x) => ({ ...x, ...p })), [])

  useEffect(() => {
    document.title = 'Request a testnet chain · Gully Labs'
    void getOffer().then((r) => {
      if (!r.ok) return setLoadError(r.error)
      setOffer(r.data)
      // The bundle is always included; a draft keeps only add-ons that can be ordered now (and no mainnet while it is shut).
      const orderable = new Set(r.data.addons.filter((a) => a.status === 'available').map((a) => a.id))
      setD((x) => ({ ...x, tier: x.tier === 'mainnet' && !r.data.flags.mainnetOrders ? 'testnet' : x.tier, addons: x.addons.filter((a) => orderable.has(a)) }))
    })
    void hasGullySession().then(setSignedIn)
    const on = (e: Event) => setSignedIn((e as CustomEvent<boolean>).detail)
    window.addEventListener(SESSION_EVENT, on)
    return () => window.removeEventListener(SESSION_EVENT, on)
  }, [])
  // Not before the offer: the first save would hide that the add-on defaults still have to be set.
  useEffect(() => {
    if (offer) writeDraft(d)
  }, [d, offer])

  useEffect(() => {
    let live = true
    void getQuote(d.tier, d.addons).then((r) => live && r.ok && setQuote(r.data.quote))
    return () => {
      live = false
    }
  }, [d.tier, d.addons])

  useEffect(() => {
    if (!d.chainId) return setId({ state: '' })
    setId({ state: 'checking' })
    const t = setTimeout(() => {
      void checkChainId(d.chainId).then((r) => setId(r.ok ? (r.data.free ? { state: 'free' } : { state: 'taken', reason: r.data.reason }) : { state: 'taken', reason: r.error }))
    }, 350)
    return () => clearTimeout(t)
  }, [d.chainId])

  const finishSignIn = useCallback(async (token: string) => {
    const r = await gullyExchange(token)
    if (!r.ok) return toastError('Could not sign in', { detail: r.error })
    setSignedIn(true)
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: true }))
    toastSuccess('Signed in with Gully ID')
  }, [])
  useEffect(() => {
    if (!isGullyIdReturn(window.location.search)) return
    gullyIdRedirectToken()
      .then((t) => (t ? finishSignIn(t) : undefined))
      .catch((e) => toastError('Could not sign in', { detail: e instanceof Error ? e.message : undefined }))
  }, [finishSignIn])
  const signIn = async () => {
    setBusy(true)
    try {
      await finishSignIn(await gullyIdAccessToken())
    } catch (e) {
      toastError('Could not sign in', { detail: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const canNext = useMemo(() => {
    if (d.step === 0) return NAME_RE.test(d.name.trim()) && id.state === 'free' && (d.gasToken === 'eth' || SYMBOL_RE.test(d.gasSymbol))
    if (d.step === 1) return !(tab === 'mainnet' && !offer?.flags.mainnetOrders)
    if (d.step === 2) return !!quote
    if (d.step === 3) return signedIn
    return true
  }, [d, id.state, quote, signedIn, tab, offer])

  const free = quote?.dueCents === 0
  const pay = async () => {
    if (!offer || !quote) return
    setBusy(true)
    const r = await api<{ order: Order; duplicate?: boolean }>('/api/chain-orders', { method: 'POST', body: { tier: d.tier, name: d.name.trim(), chainId: Number(d.chainId), gasToken: d.gasToken, gasSymbol: d.gasSymbol, parentChainId: parentOf(offer, d).id, addons: d.addons, logo: d.logo, email: d.email.trim(), expect: { dueCents: quote.dueCents } } })
    if (!r.ok) {
      setBusy(false)
      if (r.code === 'price-changed') void getQuote(d.tier, d.addons).then((q) => q.ok && setQuote(q.data.quote))
      if (r.status === 401) setSignedIn(false)
      return toastError('Could not place the order', { detail: r.error })
    }
    const order = r.data.order
    writeDraft(null)
    if (r.data.duplicate) toastSuccess('You already have this order', { detail: 'Opening it.' })
    if (order.status !== 'awaiting_payment') return nav(`/create-chain/orders/${order.id}`)
    const c = await startCheckout(order.id)
    if (c.ok) return window.location.assign(c.data.payUrl)
    setBusy(false)
    toastError('Could not open checkout', { detail: c.error })
    nav(`/create-chain/orders/${order.id}`)
  }

  if (loadError || !offer) {
    return (
      <ChainShell>
        <GullyIdChip />
        <p className={`m-0 text-[13px] ${loadError ? 'text-error' : 'text-faint'}`}>{loadError ?? 'Loading…'}</p>
      </ChainShell>
    )
  }

  const par = parentOf(offer, d)
  const services = quoteServices(quote)
  const named = d.name.trim().length > 0

  return (
    <ChainShell>
      <GullyIdChip />
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[26px] leading-tight font-semibold text-ink max-[639px]:text-[22px]">{offer.flags.mainnetOrders ? 'Request a chain' : 'Request a testnet chain'}</h1>
        <p className="m-0 text-[14px] text-muted" data-testid="setup-promise">
          Our team sets it up within {offer.setupDays} business days. Each line in Your chain says whether it is automatic or set up by our team.
        </p>
      </div>
      <div className="grid grid-cols-1 items-start gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_330px] min-[1100px]:grid-cols-[190px_minmax(0,1fr)_340px]">
        <div className="min-[900px]:col-span-2 min-[1100px]:col-span-1">
          <Stepper step={d.step} go={(step) => set({ step })} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {d.step === 0 && <ChainStep offer={offer} d={d} set={set} id={id} />}
          {d.step === 1 && <PlanStep offer={offer} d={d} set={set} tab={tab} setTab={setTab} />}
          {d.step === 2 && <ReviewStep offer={offer} d={d} free={free} />}
          {d.step === 3 && (
            <Card n={4} id="step-signin" title="Sign in with Gully ID" intro="Your request and its status stay with your Gully ID. Sign in with a passkey, a wallet or email.">
              {signedIn ? (
                <p className="m-0 flex items-center gap-2 text-[14px] text-ink" data-testid="signed-in">
                  <CircleCheck size={18} className="text-green" aria-hidden />
                  Signed in
                </p>
              ) : (
                <div className="max-w-[240px]">
                  <GullyIdButton onClick={() => void signIn()} busy={busy} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="chain-email" className={label}>
                  Email to reach you (optional)
                </label>
                <input id="chain-email" className={field} type="email" autoComplete="email" value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@example.com" data-testid="chain-email" />
                <p className={help}>Updates appear on your order page. We use this address only to reach you about this chain.</p>
              </div>
            </Card>
          )}
          {d.step === 4 && (
            <Card n={5} id="step-pay" title={free ? 'Send your request' : 'Pay with Gully Pay'} intro={free ? 'The review is done. One click records your request; nothing is charged.' : 'You pay on the secure Gully Pay checkout.'}>
              {free ? (
                <p className="m-0 text-[14px] text-muted" data-testid="nothing-due">
                  Nothing to pay. We record your request and our team sets up your chain within {offer.setupDays} business days. Updates appear on your order page.
                </p>
              ) : offer.checkout.enabled ? (
                <p className="m-0 text-[14px] text-muted">You pay on Gully Pay's secure checkout, then come back here to follow your order.</p>
              ) : (
                <p className="m-0 text-[14px] text-muted" data-testid="checkout-off">
                  Payments are not open yet, so this request cannot be sent. Nothing is charged.
                </p>
              )}
              <div>
                <button type="button" className={btnPri} disabled={busy || !quote || (!free && !offer.checkout.enabled)} onClick={() => void pay()} data-testid="pay">
                  {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : free ? <Check size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}
                  {free ? (busy ? 'Sending your request…' : 'Send request') : busy ? 'Opening checkout…' : 'Go to checkout'}
                </button>
              </div>
            </Card>
          )}
          <div className="flex items-center justify-between gap-3">
            {d.step > 0 ? (
              <button type="button" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-[14px] font-semibold text-muted hover:text-ink" onClick={() => set({ step: d.step - 1 })} data-testid="back">
                <ArrowLeft size={16} aria-hidden />
                Back
              </button>
            ) : (
              <span />
            )}
            {d.step < 4 && (
              <button type="button" className={btnPri} disabled={!canNext} onClick={() => set({ step: d.step + 1 })} data-testid="next">
                Next
                <ArrowRight className="ar" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div className="min-[900px]:sticky min-[900px]:top-20">
          <PriceSummary quote={quote}>
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-[13px] font-semibold text-muted">Your chain</h2>
              {named ? (
                <ChainDiagram name={d.name} chainId={d.chainId} logo={d.logo} parent={par.name} services={services} />
              ) : (
                <div className="flex flex-col items-center gap-2 py-2 text-center" data-testid="chain-empty">
                  <img src="/brand/kit/owl/owl-presenting-400.webp" width={112} height={112} alt="" className="size-28 object-contain" />
                  <p className="m-0 text-[13px] text-muted">Name your chain and it takes shape here, with the services it gets and who sets each one up.</p>
                </div>
              )}
            </div>
          </PriceSummary>
        </div>
      </div>
    </ChainShell>
  )
}
