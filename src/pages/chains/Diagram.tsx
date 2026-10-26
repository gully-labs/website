import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Boxes, CircleDollarSign, CreditCard, Droplets, Fuel, LineChart, Plug, Sparkles, UserRoundCheck } from 'lucide-react'
import { useReducedMotion } from '../../components/charts/chart-utils'
import { useInView } from '../../components/charts/useMiniChart'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { IntegrationLogo } from '../../components/logos/IntegrationLogo'
import { VenueLogo } from '../../components/logos/VenueLogo'
import { BlinkDot } from '../../components/ui'
import { STATUS_LABEL, type ChainsConfig, type ChainsService } from './useChains'

/* "Your chain" as one picture: a flow (your chain, Arbitrum, Ethereum) with packets travelling up it and each node
   lighting in turn, the layers of the stack as chips under it, and the services as icon chips. Names, roles and
   service text come from the config (server/chains-plans.mjs); only the icons and short labels are chosen here. */

const ICON = 'flex-none'
const stackMark = (id: string, name: string): ReactNode => {
  switch (id) {
    case 'orbit':
      return <IntegrationLogo id="offchain-labs" name="Arbitrum Orbit" size={24} decorative />
    case 'settle':
      return <ChainLogo chain="arbitrum" size={24} decorative />
    case 'hyperlane':
      return <IntegrationLogo id="hyperlane" name="Hyperlane" size={24} decorative />
    case 'explorer':
      return <IntegrationLogo id="blockscout" name="Blockscout" size={24} decorative />
    case 'bridge':
      return <ArrowLeftRight aria-hidden size={20} className={`${ICON} text-gold`} />
    case 'faucet':
      return <Droplets aria-hidden size={20} className={`${ICON} text-gold`} />
    case 'rpc':
      return <Plug aria-hidden size={20} className={`${ICON} text-gold`} />
    default:
      return <Sparkles aria-hidden size={20} className={`${ICON} text-gold`} aria-label={name} />
  }
}

const SHORT: Record<string, string> = {
  chainkit: 'Explorer, bridge, faucet',
  insight: 'Analytics and monitors',
  aa: 'Account abstraction',
  paymaster: 'Gas paymaster',
  'usdc-gas': 'Pay gas in USDC',
  pay: 'Gully Pay',
  hyperlane: 'Hyperlane setup',
  deepcore: 'DeepCore launchpad',
}
const serviceMark = (id: string): ReactNode => {
  switch (id) {
    case 'chainkit':
      return <IntegrationLogo id="blockscout" name="Blockscout" size={20} decorative />
    case 'insight':
      return <LineChart aria-hidden size={17} className={`${ICON} text-gold`} />
    case 'aa':
      return <UserRoundCheck aria-hidden size={17} className={`${ICON} text-gold`} />
    case 'paymaster':
      return <Fuel aria-hidden size={17} className={`${ICON} text-gold`} />
    case 'usdc-gas':
      return <CircleDollarSign aria-hidden size={17} className={`${ICON} text-gold`} />
    case 'pay':
      return <CreditCard aria-hidden size={17} className={`${ICON} text-gold`} />
    case 'hyperlane':
      return <IntegrationLogo id="hyperlane" name="Hyperlane" size={20} decorative />
    case 'deepcore':
      return <VenueLogo venue="deepcore" name="DeepCore" size={20} decorative />
    default:
      return <Boxes aria-hidden size={17} className={`${ICON} text-gold`} />
  }
}

/** A counter that steps by itself while the diagram is on screen, until a visitor picks something. */
function useStepper(n: number, ms: number, paused: boolean) {
  const [i, setI] = useState(0)
  const [manual, setManual] = useState(false)
  useEffect(() => {
    if (manual || paused || n < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % n), ms)
    return () => clearInterval(t)
  }, [manual, paused, n, ms])
  return [i, (k: number) => (setManual(true), setI(k))] as const
}

const NODES = [
  { key: 'chain', name: 'Your chain', cap: 'Orbit, run by Gully Labs', mark: <IntegrationLogo id="offchain-labs" name="Arbitrum Orbit" size={32} decorative /> },
  { key: 'arb', name: 'Arbitrum', cap: 'It settles here', mark: <ChainLogo chain="arbitrum" size={32} decorative /> },
  { key: 'eth', name: 'Ethereum', cap: 'Final settlement', mark: <ChainLogo chain="ethereum" size={32} decorative /> },
]

function Flow({ lit, onPick }: { lit: number; onPick: (k: number) => void }) {
  return (
    <div className="flex items-center gap-1" data-testid="chains-flow">
      {NODES.map((n, k) => (
        <div key={n.key} className="flex min-w-0 flex-1 items-center gap-1 last:flex-none">
          <button
            type="button"
            onClick={() => onPick(k)}
            aria-pressed={lit === k}
            aria-label={n.name}
            className={`flex min-w-0 flex-none items-center gap-2 rounded-btn border px-3 py-2 text-left max-[600px]:gap-1 max-[600px]:px-2 max-[600px]:[&:not([aria-pressed=true])_b]:hidden transition-[border-color,background-color,box-shadow] duration-300 ${lit === k ? 'border-gold bg-[rgba(0,210,255,.1)] shadow-[0_0_18px_rgba(0,210,255,.18)]' : 'border-line bg-surface-deep'}`}
          >
            {n.mark}
            <span className="flex min-w-0 flex-col">
              <b className="text-[14px] leading-[1.2] font-semibold">{n.name}</b>
              <span className="truncate text-[12px] leading-[1.3] text-faint max-[600px]:hidden">{n.cap}</span>
            </span>
          </button>
          {k < NODES.length - 1 && (
            <span aria-hidden className="chains-pipe relative h-[2px] min-w-2 flex-1 rounded-full bg-line-strong">
              <i className="chains-packet" style={{ animationDelay: `${k * 0.5}s` }} />
              <i className="chains-packet" style={{ animationDelay: `${k * 0.5 + 0.9}s` }} />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function ServiceChips({ services }: { services: ChainsService[] }) {
  const [sel, setSel] = useState(0)
  const cur = services[sel] ?? services[0]
  if (!cur) return null
  const status = STATUS_LABEL[cur.status]
  return (
    <div className="flex flex-col gap-3" data-testid="chains-services">
      <div className="flex flex-wrap items-center gap-2">
        {services.map((s, k) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={k === sel}
            onClick={() => setSel(k)}
            title={s.name}
            className={`inline-flex min-h-9 items-center gap-2 rounded-full max-[699px]:min-h-11 border px-3 text-[13px] transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px ${k === sel ? 'border-gold bg-[rgba(0,210,255,.1)] text-ink' : s.kind === 'included' ? 'border-gold-line text-ink-2 hover:border-gold' : 'border-line-strong text-muted hover:border-gold'}`}
          >
            {serviceMark(s.id)}
            {SHORT[s.id] ?? s.name}
            <span className={`font-mono text-[11px] tracking-[1px] ${s.kind === 'included' ? 'text-gold' : 'text-faint'}`}>{s.kind === 'included' ? 'INCLUDED' : 'ADD-ON'}</span>
          </button>
        ))}
      </div>
      <p className="m-0 flex min-h-[44px] flex-wrap items-baseline gap-x-2 text-[14px] leading-[1.5] text-muted" aria-live="polite">
        <b className="text-ink">{cur.name}.</b> {cur.body}
        {status && <span className="font-mono text-[11px] tracking-[1px] text-faint">{status.toUpperCase()}</span>}
      </p>
    </div>
  )
}

export function Diagram({ cfg }: { cfg: ChainsConfig }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reduced = useReducedMotion()
  const paused = !inView || reduced
  const [node, pickNode] = useStepper(NODES.length, 1500, paused)
  const [layer, pickLayer] = useStepper(cfg.stack.length, 1900, paused)
  const cur = cfg.stack[layer]
  return (
    <div ref={ref} data-live={inView ? 'on' : 'paused'} data-testid="chains-diagram" className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card-token p-5 max-[600px]:p-4">
      <style>{`.chains-packet{position:absolute;top:-2px;left:0;width:6px;height:6px;border-radius:50%;background:var(--color-gold);box-shadow:0 0 8px var(--color-gold);opacity:0;animation:chains-packet 1.8s linear infinite}
@keyframes chains-packet{0%{left:0;opacity:0}15%{opacity:1}85%{opacity:1}100%{left:calc(100% - 6px);opacity:0}}
[data-live="paused"] .chains-packet{animation-play-state:paused}`}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[20px] leading-none font-bold uppercase">Your chain, layer by layer</span>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
          <BlinkDot color="gold" /> TRANSACTIONS FLOW UP TO ETHEREUM
        </span>
      </div>
      <Flow lit={node} onPick={pickNode} />
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {cfg.stack.map((s, k) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={k === layer}
              onClick={() => pickLayer(k)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-btn max-[699px]:min-h-11 border px-3 text-[13px] transition-[border-color,background-color,transform] duration-300 ${k === layer ? '-translate-y-px border-gold bg-[rgba(0,210,255,.1)] text-ink' : 'border-line text-muted hover:border-line-hover'}`}
            >
              {stackMark(s.id, s.name)}
              {s.name}
            </button>
          </li>
        ))}
      </ol>
      <p className="m-0 min-h-[22px] text-[14px] text-muted" aria-live="polite">
        <span className="font-mono text-[11px] tracking-[1px] text-gold">LAYER {layer + 1} OF {cfg.stack.length}</span> · {cur?.role}.
      </p>
      <div className="border-t border-line pt-4">
        <ServiceChips services={cfg.services} />
      </div>
    </div>
  )
}
