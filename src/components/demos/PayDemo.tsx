import { useEffect, useRef, useState, type JSX } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Info } from 'lucide-react'
import { useReducedMotion } from '../charts/chart-utils'
import { usePlans } from '../../lib/plans'
import type { Offer, PayAsset } from '../../pages/developers/api'

/* Landing demo: a Gully Pay checkout. The plans, prices, chains, assets and the confirmations each chain
   needs are the real GET /api/plans answer. Nothing is paid: there is no address on it, the payment
   is simulated, and it says so. Native coins show no made-up amount: the real quote fixes it from the
   chain's Chainlink feed when it opens. */

type Phase = 'open' | 'sent' | 'active'
type PlanOpt = { key: string; label: string; price: number }

const hash = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647
  return h || 1
}

function planOptions(o: Offer): PlanOpt[] {
  return [
    ...o.plans.filter((p) => p.priceUsdc > 0).map((p) => ({ key: `api:${p.id}`, label: `API ${p.name}`, price: p.priceUsdc })),
    ...o.analytics.plans.filter((p) => p.priceUsdc > 0).map((p) => ({ key: `analytics:${p.id}`, label: `Analytics ${p.name}`, price: p.priceUsdc })),
  ]
}

/** A decorative QR-like pattern (aria-hidden): it encodes nothing. */
function FakeQr({ seed }: { seed: string }) {
  const N = 21
  let h = hash(seed)
  let d = ''
  const finder = (x: number, y: number) => {
    const inBox = (bx: number, by: number) => x >= bx && x < bx + 7 && y >= by && y < by + 7
    for (const [bx, by] of [
      [0, 0],
      [N - 7, 0],
      [0, N - 7],
    ]) {
      if (inBox(bx, by)) {
        const dx = x - bx
        const dy = y - by
        const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        return ring || core ? 1 : 0
      }
      if (x >= bx - 1 && x <= bx + 7 && y >= by - 1 && y <= by + 7) return 0
    }
    return -1
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      h = (h * 16807) % 2147483647
      const f = finder(x, y)
      if (f === 1 || (f === -1 && h % 3 === 0)) d += `M${x} ${y}h1v1h-1z`
    }
  return (
    <svg aria-hidden viewBox={`-1 -1 ${N + 2} ${N + 2}`} className="size-[116px] flex-none rounded-[8px] bg-[#fff]" shapeRendering="crispEdges">
      <path d={d} fill="#0b0e13" />
    </svg>
  )
}

export default function PayDemo(): JSX.Element {
  const [plans, retry] = usePlans()
  return (
    <div className="flex w-full flex-wrap overflow-hidden lg:flex-nowrap rounded-card border border-line bg-surface text-[13px] leading-[1.45] text-ink lg:h-[540px]">
      {plans.k === 'ok' ? (
        <Checkout offer={plans.offer} />
      ) : (
        <div className="flex min-h-[320px] w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="font-mono text-[11px] tracking-[1px] text-gold">GULLY PAY · TRY IT</span>
          {plans.k === 'loading' ? (
            <span role="status" className="text-muted">
              Reading the plans…
            </span>
          ) : (
            <>
              <span role="alert" className="text-muted">
                The plans could not be read: {plans.message}
              </span>
              <button type="button" onClick={retry} className="min-h-11 rounded-[8px] border border-line-strong px-4 text-ink hover:border-gold">
                Try again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Checkout({ offer }: { offer: Offer }) {
  const reduced = useReducedMotion()
  const opts = planOptions(offer)
  const [planKey, setPlanKey] = useState(opts[0]?.key ?? '')
  const [chainId, setChainId] = useState(offer.chains[0]?.id ?? 0)
  const [assetId, setAssetId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('open')
  const [conf, setConf] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => {
    const t = timer
    return () => {
      if (t.current) clearInterval(t.current)
    }
  }, [])

  const plan = opts.find((p) => p.key === planKey) ?? opts[0]
  const chain = offer.chains.find((c) => c.id === chainId) ?? offer.chains[0]
  const assets: PayAsset[] = offer.assets.filter((a) => a.chainId === chain?.id)
  const asset = assets.find((a) => a.id === assetId) ?? assets[0]

  if (!plan || !chain || !asset) return <p className="m-0 p-6 text-muted">No plan can be shown right now.</p>

  const need = Math.max(1, asset.confirmations || chain.confirmations)
  const native = asset.kind === 'native'
  const reset = () => {
    stop()
    setPhase('open')
    setConf(0)
  }
  const pick = (fn: () => void) => () => {
    reset()
    fn()
  }

  const simulate = () => {
    stop()
    if (reduced) {
      setConf(need)
      setPhase('active')
      return
    }
    setPhase('sent')
    setConf(0)
    let c = 0
    timer.current = setInterval(() => {
      c += 1
      if (c >= need) {
        stop()
        setConf(need)
        setPhase('active')
      } else setConf(c)
    }, 320)
  }

  const idx = phase === 'open' ? 0 : phase === 'active' ? 3 : conf > 0 ? 2 : 1
  const st = { open: { label: 'Awaiting payment', cls: 'bg-grid text-ink-2' }, sent: { label: 'Confirming', cls: 'bg-[rgba(232,192,96,.15)] text-gold' }, active: { label: 'Plan active', cls: 'bg-success-bg text-green' } }[phase]
  const inv = `demo-${(hash(planKey + asset.id) % 1e8).toString(36)}`

  const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-[12px] transition-colors ${on ? 'border-gold bg-gold font-semibold text-bg' : 'border-line-strong text-ink-2 hover:border-line-hover hover:text-ink'}`
  const group = (label: string, items: { key: string; label: string; on: boolean; pick: () => void }[]) => (
    <div className="flex flex-col gap-1.5">
      <span id={`pay-${label}`} className="text-[11px] text-dim">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`pay-${label}`} className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button key={it.key} type="button" role="radio" aria-checked={it.on} onClick={it.pick} className={chip(it.on)}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <>
      {/* Left: pickers */}
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 border-line p-4 max-lg:border-b lg:overflow-y-auto lg:border-r">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[11px] tracking-[1px] text-gold">GULLY PAY · TRY IT</span>
          <b className="font-display text-[22px] leading-[1.05] font-bold uppercase">Wallet to wallet, no custody</b>
        </div>
        {group(
          'Plan',
          opts.map((p) => ({ key: p.key, label: p.label, on: p.key === plan.key, pick: pick(() => setPlanKey(p.key)) })),
        )}
        {group(
          'Chain',
          offer.chains.map((c) => ({ key: String(c.id), label: c.name, on: c.id === chain.id, pick: pick(() => (setChainId(c.id), setAssetId(null))) })),
        )}
        {group(
          'Pay with',
          assets.map((a) => ({ key: a.id, label: a.symbol, on: a.id === asset.id, pick: pick(() => setAssetId(a.id)) })),
        )}
        {!offer.checkout.enabled && (
          <p role="status" className="m-0 flex gap-2 rounded-[8px] border border-line-strong bg-surface-deep px-3 py-2 text-[12px] text-muted">
            <Info size={14} className="mt-0.5 flex-none text-gold" aria-hidden />
            <span>Checkout is closed right now. {offer.checkout.reason}</span>
          </p>
        )}
      </div>

      {/* Right: the invoice */}
      <div className="flex min-w-0 flex-[999_1_480px] flex-col items-center gap-3 bg-bg p-4">
        <div className="w-full max-w-[560px] overflow-hidden rounded-modal border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <span className="flex min-w-0 flex-col leading-[1.25]">
              <b className="font-semibold">
                {plan.label} · {offer.periodDays} days
              </b>
              <span className="font-mono text-[11px] text-gold">Demo checkout · no payment is made</span>
              <span className="font-mono text-[11px] text-faint">{inv}</span>
            </span>
            <span role="status" className={`flex-none rounded-full px-2.5 py-[3px] text-[12px] font-semibold transition-colors duration-300 ${st.cls}`}>
              {st.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 p-4">
            <div className="relative">
              <FakeQr seed={inv} />
              <span aria-hidden className="absolute inset-x-0 bottom-1 mx-auto w-fit rounded-[3px] bg-bg px-1.5 font-mono text-[11px] tracking-[1px] text-gold">
                DEMO
              </span>
            </div>
            <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
              <span className="text-[11px] text-dim">{native ? 'Send the quoted amount of' : 'Send exactly'}</span>
              <b className="font-display text-[34px] leading-none font-bold">{native ? `$${plan.price.toFixed(2)} in ${asset.symbol}` : `${plan.price.toFixed(2)} ${asset.symbol}`}</b>
              <span className="font-mono text-[11px] text-dim">
                {native ? `The ${asset.symbol} amount is fixed from Chainlink ${asset.feed?.description ?? `${asset.symbol} / USD`} when the quote opens.` : `$${plan.price} · stablecoin, 1:1, exact`}
              </span>
              <span className="text-[12px] text-muted">
                To the Gully Labs treasury on {chain.name}, from your own wallet.
              </span>
            </div>
          </div>
          <ol className="m-0 grid list-none grid-cols-4 gap-1.5 px-4 pb-3.5" aria-label="Payment steps">
            {['Quote', 'Send', 'Confirm', 'Active'].map((l, i) => (
              <li key={l} aria-current={i === idx ? 'step' : undefined} className="flex flex-col gap-1.5">
                <span className={`h-1 rounded-[2px] transition-colors duration-300 ${i <= idx ? 'bg-gold' : 'bg-grid'}`} />
                <span className={`text-[11px] ${i <= idx ? 'text-ink' : 'text-faint'}`}>{l}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2 px-4 pb-4">
            <span className="flex justify-between font-mono text-[11px] text-dim">
              <span>Confirmations on {chain.name}</span>
              <span>
                {conf} / {need}
              </span>
            </span>
            <span
              role="progressbar"
              aria-label="Confirmations"
              aria-valuemin={0}
              aria-valuemax={need}
              aria-valuenow={conf}
              className="h-2 overflow-hidden rounded-[4px] bg-grid"
            >
              <span className={`block h-full rounded-[4px] transition-[width,background-color] duration-300 ease-linear ${phase === 'active' ? 'bg-green' : 'bg-gold'}`} style={{ width: `${(conf / need) * 100}%` }} />
            </span>
            {phase === 'active' ? (
              <button type="button" onClick={reset} className="min-h-11 rounded-[10px] bg-grid font-semibold text-ink hover:bg-line">
                Start again
              </button>
            ) : phase === 'sent' ? (
              <button type="button" disabled className="min-h-11 rounded-[10px] bg-grid font-semibold text-muted">
                Waiting for blocks…
              </button>
            ) : (
              <button type="button" onClick={simulate} className="min-h-11 rounded-[10px] bg-gold font-semibold text-bg transition-colors hover:bg-gold-hover">
                Simulate payment
              </button>
            )}
          </div>
        </div>
        <div className="flex w-full max-w-[560px] flex-wrap items-center justify-between gap-x-4">
          <span className="text-[12px] text-muted">
            Native coins are priced from Chainlink when the quote opens. Nothing renews by itself; paying again adds {offer.periodDays} days.
          </span>
          <Link to="/pricing" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[12px] text-ink-2 underline-offset-4 hover:text-gold hover:underline">
            See every plan <ArrowRight size={12} aria-hidden />
          </Link>
        </div>
      </div>
    </>
  )
}
