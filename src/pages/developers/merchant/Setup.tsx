import { ArrowUpRight, CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldPlus, Store, Trash2 } from 'lucide-react'
import { lazy, Suspense, useRef, useState, type FormEvent } from 'react'
import { Mascot } from '../../../components/brand'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import type { Fetched, SafePlan, SafeStatus } from '../../../components/pay/SafeDeploy'
import { toastError, toastSuccess } from '../../../components/ui/toast'
import { isFeeProxy } from '../../../../server/fee-proxy-guard.mjs'
import { api } from '../api'
import { chip, input, pillGold, pillSm } from '../styles'
import { KIND_TEXT, payOrigin, type MerchantView, type MerchantWallet } from './api'
import { Field, Section } from './parts'

/* Store profile (shown on the checkout) and the receiving wallets, one per chain. A Safe that exists on one
   chain but not another can be deployed there from the wallet row ("Deploy Safe on <chain>"), and a store
   without a Safe can create one: server/safe-deploy.mjs plans and verifies, the merchant's wallet signs. */

const SafeDeploy = lazy(() => import('../../../components/pay/SafeDeploy'))

/** The server's Safe plan for this store, as the deploy panel wants it. */
const safePlan = (body: Record<string, unknown>) => async (from: string | null): Promise<Fetched<SafePlan>> => {
  const r = await api<SafePlan>('/api/developer/merchant/safe/plan', { method: 'POST', body: { ...body, from } })
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error, body: r.body }
}
const safeStatus = (chainId: number, address: string) => async (hash: string): Promise<Fetched<SafeStatus>> => {
  const r = await api<SafeStatus>('/api/developer/merchant/safe/status', { method: 'POST', body: { chainId, hash, address } })
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
}
const Loading = () => (
  <p className="m-0 flex items-center gap-2 text-[13px] text-muted" role="status">
    <Loader2 size={14} className="animate-spin text-gold" aria-hidden /> Loading the wallet tools…
  </p>
)

export function ProfileSection({ view, onChange }: { view: MerchantView; onChange: (v: MerchantView) => void }) {
  const p = view.profile
  const [name, setName] = useState(p.name ?? '')
  const [logo, setLogo] = useState(p.logoSource ?? '')
  const [accent, setAccent] = useState(p.accent ?? '#e8c060')
  const [email, setEmail] = useState(p.supportEmail ?? '')
  const [site, setSite] = useState(p.website ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ro = !view.can.manage

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api<MerchantView>('/api/developer/merchant/profile', { method: 'POST', body: { name, logoUrl: logo, accent, supportEmail: email, website: site } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onChange(r.data)
    toastSuccess('Store profile saved', { detail: 'Your checkouts show it from now on.' })
  }

  return (
    <Section id="m-profile" title="Store profile" sub="Shown on every checkout of this store, with a “Powered by Gully Pay” footer.">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <fieldset disabled={ro || busy} className="m-0 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 sm:grid-cols-2">
          <Field label="Store name">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="Acme Coffee" />
          </Field>
          <Field label="Support email">
            <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="help@yourstore.com" />
          </Field>
          <Field label="Logo URL" hint="https, PNG/JPEG/GIF/WebP, 256 KB at most. We fetch it once and serve our copy.">
            <input className={input} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://yourstore.com/logo.png" inputMode="url" />
          </Field>
          <Field label="Website">
            <input className={input} value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://yourstore.com" inputMode="url" />
          </Field>
          <Field label="Accent colour">
            <span className="flex items-center gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#e8c060'} onChange={(e) => setAccent(e.target.value)} className="h-11 w-14 cursor-pointer rounded-input border border-line-strong bg-bg p-1" aria-label="Pick the accent colour" />
              <input className={input} value={accent} onChange={(e) => setAccent(e.target.value)} maxLength={7} aria-label="Accent colour, hex" />
            </span>
          </Field>
          <div className="flex items-end">
            <button type="submit" className={pillGold}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Save profile
            </button>
          </div>
          {err && (
            <p className="m-0 text-[13px] text-error sm:col-span-2" role="alert">
              {err}
            </p>
          )}
          {ro && <p className="m-0 text-[13px] text-faint sm:col-span-2">Your role ({view.role}) can read this store. Owners, admins and billing members change it.</p>}
        </fieldset>
        {/* Live preview of the checkout header. */}
        <div className="flex flex-col gap-2" aria-label="Checkout preview">
          <span className="text-[12px] text-dim">Checkout preview</span>
          <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg p-4" style={{ borderTop: `3px solid ${/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#e8c060'}` }}>
            <span className="flex items-center gap-3">
              {/* The checkout's own marks: the logo, else the neutral store glyph (never a letter tile). */}
              {view.profile.logoUrl ? (
                <img src={view.profile.logoUrl} alt="" className="size-10 rounded-[10px] border border-line object-contain" />
              ) : (
                <span aria-hidden className="grid size-10 place-items-center rounded-[10px] border border-line-strong bg-surface-deep text-muted">
                  <Store size={20} strokeWidth={1.75} />
                </span>
              )}
              <b className="min-w-0 truncate text-[15px] text-ink">{name.trim() || 'Store'}</b>
              {!name.trim() && <span className="shrink-0 rounded-full border border-line-strong px-2 py-[1px] font-mono text-[11px] text-dim">your wallet</span>}
            </span>
            <span className="text-[12px] text-muted">{view.nonCustodial}</span>
            <span className="inline-flex items-center gap-2 font-mono text-[10.5px] tracking-[1px] text-faint">
              POWERED BY <Mascot size={16} decorative /> GULLY PAY
            </span>
          </div>
        </div>
      </form>
    </Section>
  )
}

function WalletRow({ w, can, onChange }: { w: MerchantWallet; can: boolean; onChange: (v: MerchantView) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [deploy, setDeploy] = useState(false)
  const act = async (what: 'check' | 'remove' | 'on' | 'off') => {
    setBusy(what)
    const path = what === 'check' || what === 'remove' ? `/api/developer/merchant/wallets/${w.chainId}/${what}` : `/api/developer/merchant/wallets/${w.chainId}`
    const r = await api<{ merchant: MerchantView }>(path, { method: 'POST', body: what === 'on' ? { enabled: true } : what === 'off' ? { enabled: false } : {} })
    setBusy(null)
    if (!r.ok) return toastError(`${w.chain}: not enabled`, { detail: r.error })
    onChange(r.data.merchant)
    if (what === 'check') toastSuccess(`${w.chain} checked`, { detail: 'Deployed and enabled.' })
  }
  const live = w.enabled && w.status === 'ok'
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-bg px-3 py-3 transition-colors hover:border-line-strong">
      <ChainLogo chain={w.chainKey ?? w.chain} size={32} decorative />
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
          {w.chain}
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 font-mono text-[11px] ${live ? 'border-success-line text-green' : w.status === 'not-deployed' ? 'border-[#5a2a24] text-error' : 'border-line-strong text-faint'}`}>
            {live ? <CheckCircle2 size={11} aria-hidden /> : w.status === 'not-deployed' ? <ShieldAlert size={11} aria-hidden /> : null}
            {live ? 'receiving' : w.status === 'not-deployed' ? 'not deployed' : 'off'}
          </span>
        </span>
        <a href={w.explorerUrl ?? '#'} target="_blank" rel="noopener" className="inline-flex min-w-0 items-center gap-1 font-mono text-[12px] break-all text-ink-2 underline-offset-4 hover:text-gold hover:underline">
          {w.address} <ArrowUpRight size={11} aria-hidden className="shrink-0" />
        </a>
        <span className="text-[12px] text-dim">
          {KIND_TEXT[w.kind]} · checked {new Date(w.checkedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
          {w.status === 'not-deployed' && ` · Deploy your contract on ${w.chain} at this address; we check every hour and it switches on by itself.`}
        </span>
      </div>
      {can && (
        <span className="flex flex-wrap gap-2">
          {w.status === 'not-deployed' ? (
            <>
              <button type="button" className={`${pillSm} !border-gold-line !text-gold hover:!border-gold`} disabled={!!busy} aria-expanded={deploy} onClick={() => setDeploy((v) => !v)}>
                <ShieldCheck size={14} aria-hidden /> Deploy Safe on {w.chain}
              </button>
              <button type="button" className={pillSm} disabled={!!busy} onClick={() => act('check')}>
                {busy === 'check' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Check again
              </button>
            </>
          ) : (
            <button type="button" className={pillSm} disabled={!!busy} onClick={() => act(w.enabled ? 'off' : 'on')} aria-pressed={w.enabled}>
              {busy === 'on' || busy === 'off' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} {w.enabled ? 'Turn off' : 'Turn on'}
            </button>
          )}
          <button type="button" className={`${pillSm} hover:!text-error`} disabled={!!busy} onClick={() => act('remove')} aria-label={`Remove the ${w.chain} wallet`}>
            <Trash2 size={14} aria-hidden />
          </button>
        </span>
      )}
      {deploy && can && (
        <div className="basis-full">
          <Suspense fallback={<Loading />}>
            <SafeDeploy
              chain={{ id: w.chainId, name: w.chain, key: w.chainKey }}
              plan={safePlan({ chainId: w.chainId, address: w.address })}
              status={safeStatus(w.chainId, w.address)}
              onVerified={async () => {
                // The existing inspection runs again (eth_getCode on this chain) and the chain switches on.
                await act('check')
                setDeploy(false)
              }}
              onClose={() => setDeploy(false)}
            />
          </Suspense>
        </div>
      )}
    </li>
  )
}

/** "Create a new Safe": owners, threshold and chain; the plan predicts the address, the wallet deploys it, then
    the Safe is added as the store's wallet on that chain. */
function NewSafe({ view, onChange, agree }: { view: MerchantView; onChange: (v: MerchantView) => void; agree: boolean }) {
  const [open, setOpen] = useState(false)
  const [ownersText, setOwnersText] = useState('')
  const [threshold, setThreshold] = useState(1)
  const [chainId, setChainId] = useState<number>(view.chains[0]?.id ?? 8453)
  const [go, setGo] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const predicted = useRef<string | null>(null)
  const owners = ownersText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  const valid = owners.length >= 1 && owners.length <= 10 && owners.every((o) => /^0x[0-9a-fA-F]{40}$/.test(o)) && threshold >= 1 && threshold <= owners.length
  const chain = view.chains.find((c) => c.id === chainId) ?? view.chains[0]
  const needTerms = !view.terms.accepted
  const planKey = `${chainId}:${owners.map((o) => o.toLowerCase()).sort().join(',')}:${threshold}`
  if (!open)
    return (
      <button type="button" className={`${pillSm} self-start`} onClick={() => setOpen(true)} data-testid="new-safe-open">
        <ShieldPlus size={14} aria-hidden /> No Safe yet? Create one
      </button>
    )
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg p-4" data-testid="new-safe">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-[15px] font-semibold text-ink">Create a new Safe</h3>
          <span className="text-[12.5px] leading-[1.5] text-dim">A Safe 1.4.1 multisig from Safe’s official factory, owned by the wallets you list. Your wallet pays the gas; the address is known before anything is sent, and the same Safe can be deployed at that address on every other chain later.</span>
        </div>
        <button type="button" className={pillSm} onClick={() => (setOpen(false), setGo(false))}>
          Close
        </button>
      </div>
      <fieldset disabled={go && !done} className="m-0 grid grid-cols-1 gap-3 border-0 p-0 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Field label="Owners (one address per line; your connected wallet is filled in when you connect)">
          <textarea className={`${input} h-auto min-h-[88px] py-2 font-mono text-[13px]`} value={ownersText} onChange={(e) => setOwnersText(e.target.value)} placeholder={'0xAbC…\n0xDeF…'} spellCheck={false} />
        </Field>
        <Field label="Threshold">
          <input className={input} type="number" min={1} max={Math.max(1, owners.length)} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Chain to deploy on">
        <span className="text-[12px] text-dim">Chain</span>
        {view.chains.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={chainId === c.id} className={chip(chainId === c.id)} disabled={go && !done} onClick={() => setChainId(c.id)}>
            <ChainLogo chain={c.key} size={16} decorative /> {c.name}
          </button>
        ))}
      </div>
      {needTerms && !agree && <p className="m-0 text-[12.5px] text-faint">Tick the merchant terms above first: the new Safe is added as this store’s wallet.</p>}
      {!go ? (
        <button type="button" className={`${pillGold} self-start`} disabled={!valid || (needTerms && !agree)} onClick={() => setGo(true)} data-testid="new-safe-plan">
          <ShieldPlus size={15} aria-hidden /> Plan and deploy on {chain?.name}
        </button>
      ) : (
        <Suspense fallback={<Loading />}>
          <SafeDeploy
            key={chainId}
            chain={{ id: chainId, name: chain?.name ?? String(chainId), key: chain?.key ?? null }}
            title={`Create the Safe on ${chain?.name}`}
            planKey={planKey}
            plan={async (from) => {
              const r = await safePlan({ chainId, mode: 'new', owners, threshold })(from)
              if (r.ok) predicted.current = r.data.safe
              return r
            }}
            status={(hash) => safeStatus(chainId, done ?? predicted.current ?? '')(hash)}
            onAccount={(a) => {
              if (a && !ownersText.trim()) setOwnersText(a)
            }}
            onVerified={async (_s, plan) => {
              setDone(plan.safe)
              const r = await api<{ merchant: MerchantView; error: string | null }>('/api/developer/merchant/wallets', { method: 'POST', body: { address: plan.safe, type: 'contract', chains: [chainId], ...(needTerms ? { acceptTerms: agree } : {}) } })
              if (!r.ok) return toastError('Safe deployed, but not added as the store wallet', { detail: r.error })
              onChange(r.data.merchant)
              toastSuccess(`Safe created on ${chain?.name}`, { detail: `${plan.safe} now receives this store’s payments there.` })
            }}
            onClose={() => setGo(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

export function WalletsSection({ view, onChange }: { view: MerchantView; onChange: (v: MerchantView) => void }) {
  const [address, setAddress] = useState('')
  const [type, setType] = useState<'eoa' | 'contract'>('eoa')
  const [chains, setChains] = useState<number[]>(() => view.chains.filter((c) => !view.wallets.some((w) => w.chainId === c.id)).map((c) => c.id))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [agree, setAgree] = useState(false)
  const needTerms = !view.terms.accepted

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    // The server refuses it too (merchants.mjs inspectWallet); said here before anything is sent.
    if (isFeeProxy(address)) return setErr("That is Request Network's fee proxy contract, not a wallet. It has no owner, so anything sent to it is lost for good: use a wallet you control.")
    setBusy(true)
    const r = await api<{ results: { chainId: number; ok: boolean; error: string | null }[]; error: string | null; merchant: MerchantView }>('/api/developer/merchant/wallets', { method: 'POST', body: { address: address.trim(), type, chains, ...(needTerms ? { acceptTerms: agree } : {}) } })
    setBusy(false)
    if (!r.ok && !(r.status === 422)) return setErr(r.error)
    // 422 when no chain could be enabled: the wallets are stored (disabled) and listed; reload shows them.
    if (r.ok) {
      onChange(r.data.merchant)
      if (r.data.error) setErr(r.data.error)
      else {
        setAddress('')
        toastSuccess('Wallet added', { detail: `Receiving on ${r.data.results.length} chain${r.data.results.length === 1 ? '' : 's'}.` })
      }
    } else {
      setErr(r.error)
      const v = await api<MerchantView>('/api/developer/merchant')
      if (v.ok) onChange(v.data)
    }
  }

  return (
    <Section id="m-wallets" title="Receiving wallets" sub={view.nonCustodial}>
      {view.wallets.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {view.wallets.map((w) => (
            <WalletRow key={w.chainId} w={w} can={view.can.manage} onChange={onChange} />
          ))}
        </ul>
      ) : (
        <p className="m-0 flex items-center gap-2 rounded-input border border-dashed border-line-strong px-4 py-4 text-[14px] text-muted">
          <span aria-hidden className="size-2 animate-[gl-blink_1.6s_ease-in-out_infinite] rounded-full bg-gold" /> No wallet yet. Add the address that should receive payments: the checkout opens on every chain you enable.
        </p>
      )}
      {view.can.manage && (
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-4">
          <Field label="Wallet address">
            <input className={`${input} font-mono text-[13px]`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0xAbC…" spellCheck={false} autoComplete="off" required />
          </Field>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Wallet type">
            <span className="text-[12px] text-dim">Type</span>
            <button type="button" role="radio" aria-checked={type === 'eoa'} className={chip(type === 'eoa')} onClick={() => setType('eoa')}>
              Normal wallet (EOA)
            </button>
            <button type="button" role="radio" aria-checked={type === 'contract'} className={chip(type === 'contract')} onClick={() => setType('contract')}>
              Safe or smart account
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Chains">
            <span className="text-[12px] text-dim">Chains</span>
            {view.chains.map((c) => {
              const on = chains.includes(c.id)
              return (
                <button key={c.id} type="button" aria-pressed={on} className={chip(on)} title={c.feeSplit ? `${c.name}: the Gully Pay fee is collected inside each stablecoin payment (one transaction).` : `${c.name}: the Gully Pay fee is invoiced on your weekly statement.`} onClick={() => setChains(on ? chains.filter((x) => x !== c.id) : [...chains, c.id])}>
                  <ChainLogo chain={c.key} size={16} decorative /> {c.name}
                </button>
              )
            })}
          </div>
          <p className="m-0 text-[12px] leading-[1.55] text-faint">We read each chain: a contract must be deployed on that chain before it can take payments there (a payment to an undeployed Safe address can be lost). The same address on every chain is fine; a Safe missing on one chain gets a “Deploy Safe on that chain” button, signed by your own wallet.</p>
          <p className="m-0 text-[12px] leading-[1.55] text-faint">
            {view.chains.some((c) => c.feeSplit) ? `On ${view.chains.filter((c) => c.feeSplit).map((c) => c.name).join(', ')} the Gully Pay fee on a stablecoin payment is collected in the same transaction (Request Network's fee proxy; the payer still pays exactly the quoted amount). ` : ''}
            {view.chains.some((c) => !c.feeSplit) ? `On ${view.chains.filter((c) => !c.feeSplit).map((c) => c.name).join(', ')} and for coin payments, the fee is invoiced on your weekly statement.` : ''}
          </p>
          {needTerms ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-3 py-3 text-[14px] leading-[1.55] text-ink-2">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-[3px] size-4 shrink-0 accent-[#e8c060]" required />
              <span>
                I agree to the{' '}
                <a href={`${payOrigin()}${view.terms.path}`} target="_blank" rel="noopener" className="text-gold underline underline-offset-4 hover:text-gold-hover">
                  Gully Pay merchant terms
                </a>{' '}
                for this workspace: a fee per payment only, payments go straight to our wallet, and refunds and taxes are ours.
              </span>
            </label>
          ) : (
            <span className="font-mono text-[11px] text-faint">
              Merchant terms {view.terms.accepted?.version} accepted {new Date(view.terms.accepted!.acceptedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ·{' '}
              <a href={`${payOrigin()}${view.terms.path}`} target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-gold">
                read them
              </a>
            </span>
          )}
          {err && (
            <p className="m-0 text-[13px] text-error" role="alert">
              {err}
            </p>
          )}
          <button type="submit" className={`${pillGold} self-start`} disabled={busy || !chains.length || !address.trim() || (needTerms && !agree)}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Check and add
          </button>
          <NewSafe view={view} onChange={onChange} agree={agree} />
        </form>
      )}
    </Section>
  )
}
