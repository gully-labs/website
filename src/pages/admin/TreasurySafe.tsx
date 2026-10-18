import { ArrowUpRight, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ChainLogo } from '../../components/logos/ChainLogo'
import type { Fetched, SafePlan, SafeStatus } from '../../components/pay/SafeDeploy'
import { toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'

/* Admin: the treasury (GULLY_TREASURY_ADDRESS) on every chain Gully Pay takes payments on, plus the chains
   lined up for it (OP Mainnet, Polygon, Avalanche). A Safe exists only where it was deployed: a chain where
   the treasury has no code must not take payments until the Safe is deployed there. "Deploy Safe on <chain>"
   does that from here, signed by the admin's own wallet (server/safe-deploy.mjs plans and verifies; the
   browser recomputes the address before sending). Read from GET /api/admin/safe/treasury. */

const SafeDeploy = lazy(() => import('../../components/pay/SafeDeploy'))

interface Row {
  chainId: number
  chain: string
  chainKey: string
  testnet: boolean
  payments: boolean
  kind: 'safe' | 'contract' | 'eoa' | 'eoa-7702' | 'unreadable'
  error: string | null
  safe: { version: string; singletonName: string; owners: string[]; threshold: number } | null
  explorerUrl: string
  canDeploy: boolean
}
interface View {
  set: boolean
  treasury: string | null
  chains: Row[]
  origin: { chainId: number; chain: string; version: string; owners: string[]; threshold: number } | null
  note: string | null
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const pill = (cls: string) => `inline-flex min-h-[26px] items-center gap-1 rounded-full border px-[10px] font-mono text-[11px] ${cls}`

function kindOf(r: Row) {
  if (r.kind === 'safe' && r.safe) return { text: `Safe ${r.safe.version} · ${r.safe.threshold}/${r.safe.owners.length}`, cls: 'border-success-line text-green', icon: <ShieldCheck size={11} aria-hidden /> }
  if (r.kind === 'eoa') return { text: 'not deployed', cls: 'border-[#5a2a24] text-error', icon: <ShieldAlert size={11} aria-hidden /> }
  if (r.kind === 'eoa-7702') return { text: 'wallet (EIP-7702)', cls: 'border-line-strong text-ink-2', icon: <Wallet size={11} aria-hidden /> }
  if (r.kind === 'contract') return { text: 'contract, not a Safe', cls: 'border-gold-line text-gold', icon: null }
  return { text: 'unreadable', cls: 'border-line-strong text-faint', icon: null }
}

export function TreasurySafe({ token }: { token: string }) {
  const [data, setData] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const load = useCallback(
    async (fresh = false) => {
      setBusy(true)
      const r = await adminCall<View>(token, `/api/admin/safe/treasury${fresh ? '?fresh=1' : ''}`)
      setBusy(false)
      if (r.ok) (setData(r.data), setErr(null))
      else setErr(r.error)
    },
    [token],
  )
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  const plan = (chainId: number) => async (from: string | null): Promise<Fetched<SafePlan>> => {
    const r = await fetch('/api/admin/safe/plan', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ chainId, from }) }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    return r?.ok ? { ok: true, data: d as SafePlan } : { ok: false, error: d?.error ?? 'The server could not be reached.', body: d }
  }
  const status = (chainId: number) => async (hash: string): Promise<Fetched<SafeStatus>> => {
    const r = await adminCall<SafeStatus>(token, '/api/admin/safe/status', { chainId, hash })
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
  }

  const eoaEverywhere = data?.set && !data.origin && data.chains.every((c) => c.kind === 'eoa')
  return (
    <section className={card} aria-labelledby="treasury-safe-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="treasury-safe-h" className={h2}>
          Treasury Safe
        </h2>
        <span className={small}>
          {data?.set ? `GULLY_TREASURY_ADDRESS ${data.treasury}` : 'GULLY_TREASURY_ADDRESS is not set'}
          {data?.origin && ` · Safe ${data.origin.version} on ${data.origin.chain}, ${data.origin.threshold} of ${data.origin.owners.length} owners`}
        </span>
      </div>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">A Safe exists only on the chains where it was deployed. A chain where the treasury has no code must not take payments: a payment sent there would be lost. Deploy the Safe at the same address from here; your own wallet signs and pays the gas, nothing passes through the server.</p>
      {err && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {err}
        </p>
      )}
      {!data && !err && (
        <p className="m-0 flex items-center gap-2 text-[13px] text-muted" role="status">
          <Loader2 size={14} className="animate-spin text-gold" aria-hidden /> Reading the treasury on every chain…
        </p>
      )}
      {data?.note && <p className="m-0 rounded-input border border-line bg-bg px-3 py-2 text-[13px] text-ink-2">{data.note}</p>}
      {data?.set && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Treasury per chain">
          {data.chains.map((r, i) => {
            const k = kindOf(r)
            return (
              <li key={r.chainId} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-bg px-3 py-3 transition-colors hover:border-line-strong" style={{ animation: `gl-rise .4s ${i * 0.04}s ease both` }} data-testid={`treasury-chain-${r.chainId}`}>
                <ChainLogo chain={r.chainKey} size={32} decorative />
                <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
                    {r.chain}
                    <span className={pill(k.cls)}>
                      {k.icon}
                      {k.text}
                    </span>
                    {!r.payments && <span className={pill('border-line-strong text-faint')}>{r.testnet ? 'testnet' : 'ahead of payments'}</span>}
                  </span>
                  <a href={r.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 underline-offset-4 hover:text-gold hover:underline">
                    {r.explorerUrl.replace(/^https?:\/\//, '').split('/')[0]} <ArrowUpRight size={11} aria-hidden />
                  </a>
                  {r.error && <span className="text-[12px] text-faint">{r.error}</span>}
                  {r.kind === 'eoa' && eoaEverywhere && <span className="text-[12px] text-faint">Receives as a normal wallet.</span>}
                </div>
                {r.canDeploy && (
                  <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-gold-line px-4 text-[13px] font-semibold text-gold transition-colors hover:border-gold" aria-expanded={open === r.chainId} onClick={() => setOpen(open === r.chainId ? null : r.chainId)}>
                    <ShieldCheck size={14} aria-hidden /> Deploy Safe on {r.chain}
                  </button>
                )}
                {open === r.chainId && (
                  <div className="basis-full">
                    <Suspense
                      fallback={
                        <p className="m-0 flex items-center gap-2 text-[13px] text-muted" role="status">
                          <Loader2 size={14} className="animate-spin text-gold" aria-hidden /> Loading the wallet tools…
                        </p>
                      }
                    >
                      <SafeDeploy
                        chain={{ id: r.chainId, name: r.chain, key: r.chainKey }}
                        plan={plan(r.chainId)}
                        status={status(r.chainId)}
                        onVerified={async () => {
                          toastSuccess(`Treasury Safe deployed on ${r.chain}`, { detail: 'Checked on chain: code and owners are in place.' })
                          await load(true)
                        }}
                        onClose={() => setOpen(null)}
                      />
                    </Suspense>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void load(true)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Read the chains again
        </button>
        <span className={small}>Only Safe 1.3.0 and 1.4.1 at Safe’s official factory can be reproduced; the copy starts with the Safe’s original owners and threshold. Notes: ops/TREASURY-SAFE.md.</span>
      </div>
    </section>
  )
}
