import '@rainbow-me/rainbowkit/styles.css'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, Check, Loader2, ShieldCheck, Wallet, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { concat, getContractAddress, keccak256, pad, toHex } from 'viem'
import { useAccount, WagmiProvider } from 'wagmi'
import { queryClient, wagmiConfig, walletTheme } from '../../pages/developers/walletConfig'
import { ChainLogo } from '../logos/ChainLogo'

/* One-click Safe deployment, signed by the user's own wallet (server/safe-deploy.mjs builds the plan).
   Its own lazy chunk (wagmi, viem, RainbowKit), loaded only when a "Deploy Safe on <chain>" button is
   pressed. The flow: plan (the server reads the Safe where it exists, recovers its creation inputs and
   checks the target chain holds Safe's official factory, singleton and fallback handler, then predicts the
   CREATE2 address: it must equal the Safe's) -> the wallet switches chain -> the browser re-asks for the plan
   and recomputes the CREATE2 address itself (two independent checks before anything is sent) -> the wallet
   sends createProxyWithNonce to the factory -> sent, mined, verified by eth_getCode and getOwners through the
   server -> the caller re-runs its own inspection so the chain switches on. The transaction goes from the
   wallet to Safe's factory; nothing passes through Gully Labs. */

export interface SafeCheck {
  id: string
  label: string
  ok: boolean
  detail: string | null
}
export interface SafePlan {
  ok: true
  mode: 'reproduce' | 'new'
  alreadyDeployed: boolean
  kind?: string
  what?: string
  safe: string
  chain: { id: number; hexId: string; key: string; name: string; explorer: string; explorerName: string | null; testnet: boolean; native: { name: string; symbol: string; decimals: number }; rpcs: string[] }
  origin: { chainId: number; chain: string; chainKey: string | null; version: string; singletonName: string; owners: string[]; threshold: number; deployTxUrl: string | null; source: string | null } | null
  setup?: { owners: string[]; threshold: number; fallbackHandler: string }
  version?: string
  factory?: string
  singleton?: string
  singletonName?: string
  initializer?: string
  saltNonce?: string
  proxyCreationCode?: string
  predicted?: string
  tx?: { to: string; data: string; value: string }
  gas?: { estimate: number | null; estimateHex: string | null; gasPriceGwei: number | null; cost: string | null; symbol: string; error: string | null } | null
  warnings?: string[]
  checks: SafeCheck[]
  explorerUrl: string
}
export interface SafeStatus {
  ok: true
  state: 'pending' | 'failed' | 'mined' | 'verified'
  txUrl: string
  explorerUrl: string
  blockNumber?: number
  gasUsed?: number | null
  owners?: string[]
  threshold?: number
  version?: string
  error?: string
}
export type Fetched<T> = { ok: true; data: T } | { ok: false; error: string; body?: unknown }

export interface SafeDeployProps {
  chain: { id: number; name: string; key: string | null }
  /** Asks the server for the plan; `from` is the connected wallet (for the gas estimate), when known. */
  plan: (from: string | null) => Promise<Fetched<SafePlan>>
  /** Asks the server where a sent transaction stands. */
  status: (hash: string) => Promise<Fetched<SafeStatus>>
  /** Called once the Safe is verified on chain: the caller re-runs its own inspection. */
  onVerified: (status: SafeStatus, plan: SafePlan) => void | Promise<void>
  /** The connected wallet, whenever it changes (a new-Safe form prefills its owner with it). */
  onAccount?: (address: string | null) => void
  /** Re-plans when this changes (a new-Safe form's owners and threshold). */
  planKey?: string
  onClose?: () => void
  title?: string
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
type Phase = 'planning' | 'refused' | 'already' | 'ready' | 'switching' | 'confirm' | 'sent' | 'mined' | 'verified' | 'failed'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const wordy = (e: unknown) => String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e)
const friendly = (e: unknown, chain: string): string => {
  const m = wordy(e)
  if (/reject|denied|cancel|4001/i.test(m)) return 'The wallet request was declined. Nothing was sent.'
  if (/insufficient/i.test(m)) return `This wallet does not hold enough coin on ${chain} for the gas.`
  return m.slice(0, 240)
}

/** The CREATE2 address from the plan's own inputs, computed here, independently of the server. */
export function predictLocally(p: SafePlan): string | null {
  if (!p.factory || !p.singleton || !p.initializer || !p.saltNonce || !p.proxyCreationCode) return null
  const salt = keccak256(concat([keccak256(p.initializer as `0x${string}`), pad(toHex(BigInt(p.saltNonce)), { size: 32 })]))
  return getContractAddress({ opcode: 'CREATE2', from: p.factory as `0x${string}`, salt, bytecode: concat([p.proxyCreationCode as `0x${string}`, pad(p.singleton as `0x${string}`, { size: 32 })]) })
}

const STEPS: { id: Phase; label: string }[] = [
  { id: 'sent', label: 'Sent' },
  { id: 'mined', label: 'Mined' },
  { id: 'verified', label: 'Verified on chain' },
]
const ORDER: Phase[] = ['sent', 'mined', 'verified']

function Stepper({ phase, txUrl, explorerUrl }: { phase: Phase; txUrl: string | null; explorerUrl: string | null }) {
  const at = ORDER.indexOf(phase === 'failed' ? 'mined' : phase)
  return (
    <ol className="m-0 flex list-none items-stretch gap-0 p-0" aria-label="Deployment progress">
      {STEPS.map((s, i) => {
        const done = phase !== 'failed' && i < at
        const active = phase !== 'failed' ? i === at : i === 1
        const failed = phase === 'failed' && i === 1
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span className="relative flex size-7 shrink-0 items-center justify-center">
              {active && !failed && <span aria-hidden className="absolute inset-0 rounded-full border border-gold-line animate-[gl-pulse-ring_1.6s_ease-out_infinite]" />}
              <span className={`grid size-7 place-items-center rounded-full border text-bg transition-colors duration-500 ${done || phase === 'verified' ? 'border-success-line bg-green' : failed ? 'border-[#5a2a24] bg-error' : active ? 'border-gold bg-gold' : 'border-line-strong bg-transparent'}`}>
                {done || (phase === 'verified' && i === at) ? <Check size={14} aria-hidden style={{ animation: 'gl-rise .35s ease both' }} /> : failed ? <X size={14} aria-hidden /> : active ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <span className="font-mono text-[11px] text-faint">{i + 1}</span>}
              </span>
            </span>
            <span className={`min-w-0 truncate text-[13px] ${done || active ? 'text-ink' : 'text-faint'}`}>
              {s.label}
              {s.id === 'sent' && txUrl && (
                <a href={txUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-[2px] font-mono text-[11px] text-gold underline-offset-4 hover:underline">
                  tx <ArrowUpRight size={10} aria-hidden />
                </a>
              )}
              {s.id === 'verified' && phase === 'verified' && explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-[2px] font-mono text-[11px] text-gold underline-offset-4 hover:underline">
                  explorer <ArrowUpRight size={10} aria-hidden />
                </a>
              )}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="mx-1 h-px min-w-3 flex-1 overflow-hidden bg-line">
                <span className={`block h-full origin-left bg-green transition-transform duration-700 ${done ? 'scale-x-100' : 'scale-x-0'}`} />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Checks({ checks }: { checks: SafeCheck[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Checks">
      {checks.map((c, i) => (
        <li key={c.id} className="flex items-start gap-2 text-[12.5px] leading-[1.45]" style={{ animation: `gl-rise .35s ${i * 0.05}s ease both` }}>
          <span className={`mt-[2px] grid size-4 shrink-0 place-items-center rounded-full ${c.ok ? 'bg-green text-bg' : 'bg-error text-bg'}`} aria-hidden>
            {c.ok ? <Check size={11} /> : <X size={11} />}
          </span>
          <span className="min-w-0 text-ink-2">
            {c.label}
            {c.detail && <span className="break-words text-faint"> · {c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Inner({ chain, plan, status, onVerified, onAccount, planKey = '', onClose, title }: SafeDeployProps) {
  const { isConnected, address, connector } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [phase, setPhase] = useState<Phase>('planning')
  const [p, setP] = useState<SafePlan | null>(null)
  const [refusal, setRefusal] = useState<{ error: string; checks: SafeCheck[] } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const [st, setSt] = useState<SafeStatus | null>(null)
  const [tries, setTries] = useState(0)
  const alive = useRef(true)
  // The callers hand in fresh closures on every render; refs keep the effects from re-running for that.
  const planRef = useRef(plan)
  const statusRef = useRef(status)
  const verifiedRef = useRef(onVerified)
  const accountRef = useRef(onAccount)
  planRef.current = plan
  statusRef.current = status
  verifiedRef.current = onVerified
  accountRef.current = onAccount
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    accountRef.current?.(address ?? null)
  }, [address])

  // The plan: on mount, when the wallet changes (gas estimate), when the form behind planKey changes, on "Read again".
  useEffect(() => {
    let on = true
    planRef.current(address ?? null).then((r) => {
      if (!on || !alive.current) return
      setMsg(null)
      if (!r.ok) {
        const body = (r.body ?? {}) as { checks?: SafeCheck[] }
        setRefusal({ error: r.error, checks: body.checks ?? [] })
        setPhase('refused')
        return
      }
      setRefusal(null)
      setP(r.data)
      setPhase(r.data.alreadyDeployed ? 'already' : 'ready')
    })
    return () => {
      on = false
    }
  }, [address, planKey, tries])
  const readAgain = () => {
    setPhase('planning')
    setTries((t) => t + 1)
  }

  /** Follows the transaction until the Safe is verified (or the tx failed). */
  const follow = useCallback(
    async (h: string, planUsed: SafePlan) => {
      const started = Date.now()
      while (alive.current && Date.now() - started < 15 * 60_000) {
        const r = await statusRef.current(h)
        if (!alive.current) return
        if (r.ok) {
          setSt(r.data)
          if (r.data.state === 'verified') {
            setPhase('verified')
            await verifiedRef.current(r.data, planUsed)
            return
          }
          if (r.data.state === 'failed') {
            setPhase('failed')
            setMsg(r.data.error ?? 'The transaction reverted.')
            return
          }
          setPhase(r.data.state === 'mined' ? 'mined' : 'sent')
        }
        await new Promise((res) => setTimeout(res, 3_000))
      }
      if (alive.current) setMsg('Still waiting for the chain. Keep this open, or press “Check again” on the wallet row once the explorer shows the transaction mined.')
    },
    [],
  )

  const deploy = async () => {
    setMsg(null)
    if (!isConnected || !address) return openConnectModal?.()
    try {
      const provider = (await connector?.getProvider()) as Eip1193 | undefined
      if (!provider) throw new Error('The connected wallet exposes no provider. Reconnect it and try again.')
      // Fresh plan right before sending: the server re-reads the chains and re-checks the prediction.
      setPhase('switching')
      const fresh = await planRef.current(address)
      if (!fresh.ok) throw new Error(fresh.error)
      const f = fresh.data
      if (f.alreadyDeployed) {
        setP(f)
        setPhase('already')
        return
      }
      if (!f.tx || !f.predicted || !p?.tx) throw new Error('The plan is incomplete; nothing was sent.')
      if (f.tx.data.toLowerCase() !== p.tx.data.toLowerCase() || f.predicted.toLowerCase() !== p.predicted?.toLowerCase()) throw new Error('The plan changed between showing it and sending. Nothing was sent; read it again.')
      // Our own CREATE2 arithmetic, in the browser, must agree with the server's.
      const local = predictLocally(f)
      if (!local || local.toLowerCase() !== f.safe.toLowerCase()) throw new Error(`The address this call would create (${local ?? 'unknown'}) is not ${f.safe}. Nothing was sent.`)
      // The wallet on the target chain.
      const current = (await provider.request({ method: 'eth_chainId' })) as string
      if (Number(BigInt(current)) !== f.chain.id) {
        try {
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: f.chain.hexId }] })
        } catch (e) {
          const code = (e as { code?: number })?.code
          if (code === 4902 || /unrecognized|not added|unknown chain|does not exist/i.test(wordy(e))) {
            await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: f.chain.hexId, chainName: f.chain.name, nativeCurrency: f.chain.native, rpcUrls: f.chain.rpcs, blockExplorerUrls: [f.chain.explorer] }] })
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: f.chain.hexId }] })
          } else throw e
        }
        const now = (await provider.request({ method: 'eth_chainId' })) as string
        if (Number(BigInt(now)) !== f.chain.id) throw new Error(`The wallet is still on chain ${Number(BigInt(now))}, not ${f.chain.name}. Switch it and try again.`)
      }
      setPhase('confirm')
      const gas = f.gas?.estimate ? '0x' + Math.ceil(f.gas.estimate * 1.15).toString(16) : undefined
      const h = (await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: f.tx.to, data: f.tx.data, value: '0x0', ...(gas ? { gas } : {}) }] })) as string
      if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error('The wallet did not return a transaction hash.')
      setHash(h)
      setP(f)
      setPhase('sent')
      void follow(h, f)
    } catch (e) {
      setMsg(friendly(e, chain.name))
      setPhase('ready')
    }
  }

  const heading = title ?? `Deploy Safe on ${chain.name}`
  const txUrl = hash && p ? `${p.chain.explorer}/tx/${hash}` : null
  const busy = phase === 'switching' || phase === 'confirm'
  return (
    <section aria-label={heading} className="flex flex-col gap-3 rounded-[12px] border border-gold-line bg-[rgba(232,192,96,.04)] p-4" style={{ animation: 'gl-rise .3s ease both' }} data-testid="safe-deploy">
      <div className="flex flex-wrap items-center gap-3">
        <ChainLogo chain={chain.key ?? chain.name} size={32} decorative />
        <div className="flex min-w-0 flex-[1_1_200px] flex-col">
          <span className="font-mono text-[10.5px] tracking-[1px] text-faint">SAFE DEPLOYMENT · YOUR WALLET SIGNS</span>
          <h3 className="m-0 text-[15px] font-semibold text-ink">{heading}</h3>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full text-faint hover:bg-surface-hover hover:text-ink" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {phase === 'planning' && (
        <p className="m-0 flex items-center gap-2 text-[13px] text-muted" role="status">
          <Loader2 size={14} className="animate-spin text-gold" aria-hidden /> Reading the Safe and {chain.name}…
        </p>
      )}

      {phase === 'refused' && refusal && (
        <div className="flex flex-col gap-2" role="alert">
          <p className="m-0 flex items-start gap-2 text-[13.5px] leading-[1.5] text-ink">
            <AlertTriangle size={16} className="mt-[2px] shrink-0 text-error" aria-hidden />
            <span>
              <b>Not offered.</b> {refusal.error}
            </span>
          </p>
          {refusal.checks.length > 0 && <Checks checks={refusal.checks} />}
          <button type="button" onClick={readAgain} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold hover:text-ink">
            Read again
          </button>
        </div>
      )}

      {phase === 'already' && p && (
        <p className="m-0 flex items-start gap-2 text-[13.5px] leading-[1.5] text-ink" role="status">
          <ShieldCheck size={16} className="mt-[2px] shrink-0 text-green" aria-hidden />
          <span>
            <b>Already on {chain.name}:</b> {p.what ?? 'there is code at this address'} ·{' '}
            <a href={p.explorerUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-gold underline-offset-4 hover:underline">
              {short(p.safe)}
            </a>
            . Press “Check again” and the chain switches on.
          </span>
        </p>
      )}

      {p && !p.alreadyDeployed && phase !== 'planning' && phase !== 'refused' && (
        <>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-dim">Safe address</dt>
            <dd className="m-0 min-w-0 font-mono break-all text-ink">
              {p.safe}
              {p.predicted && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-success-line px-2 font-mono text-[10.5px] text-green" title="The server's and this page's own CREATE2 arithmetic both give this address">
                  <Check size={10} aria-hidden /> address verified
                </span>
              )}
            </dd>
            {p.origin ? (
              <>
                <dt className="text-dim">Copied from</dt>
                <dd className="m-0 min-w-0 text-ink-2">
                  <span className="inline-flex items-center gap-1">
                    <ChainLogo chain={p.origin.chainKey ?? p.origin.chain} size={14} decorative /> {p.origin.chain}
                  </span>
                  : {p.origin.singletonName} {p.origin.version}, {p.setup?.owners.length ?? p.origin.owners.length} owner{(p.setup?.owners.length ?? p.origin.owners.length) === 1 ? '' : 's'}, threshold {p.setup?.threshold ?? p.origin.threshold}
                  {p.origin.deployTxUrl && (
                    <a href={p.origin.deployTxUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-[2px] font-mono text-[11px] text-gold underline-offset-4 hover:underline">
                      creation tx <ArrowUpRight size={10} aria-hidden />
                    </a>
                  )}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-dim">New Safe</dt>
                <dd className="m-0 min-w-0 text-ink-2">
                  {p.singletonName} {p.version}, {p.setup?.owners.length} owner{p.setup?.owners.length === 1 ? '' : 's'}, threshold {p.setup?.threshold}
                </dd>
              </>
            )}
            {p.setup && (
              <>
                <dt className="text-dim">Owners</dt>
                <dd className="m-0 min-w-0 font-mono text-[12px] break-all text-ink-2">{p.setup.owners.join(', ')}</dd>
              </>
            )}
            <dt className="text-dim">Gas</dt>
            <dd className="m-0 min-w-0 text-ink-2" data-testid="safe-gas">
              {p.gas?.estimate ? (
                <>
                  ≈ <b className="text-ink">{p.gas.cost}</b> <span className="font-mono text-[11.5px] text-faint">({p.gas.estimate.toLocaleString('en-US')} gas at {p.gas.gasPriceGwei?.toLocaleString('en-US', { maximumFractionDigits: 4 })} gwei, paid by your wallet)</span>
                </>
              ) : (
                <span className="text-faint">{p.gas?.error ?? 'Your wallet shows the gas before you confirm.'}</span>
              )}
            </dd>
          </dl>
          {p.warnings && p.warnings.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {p.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-3 py-2 text-[12.5px] leading-[1.5] text-ink-2">
                  <AlertTriangle size={14} className="mt-[2px] shrink-0 text-gold" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          )}
          <Checks checks={p.checks} />
          {(phase === 'sent' || phase === 'mined' || phase === 'verified' || phase === 'failed') && <Stepper phase={phase} txUrl={txUrl} explorerUrl={st?.explorerUrl ?? p.explorerUrl} />}
          {phase === 'verified' && st && (
            <p className="m-0 flex items-start gap-2 text-[13.5px] leading-[1.5] text-ink" role="status" style={{ animation: 'gl-rise .35s ease both' }}>
              <ShieldCheck size={16} className="mt-[2px] shrink-0 text-green" aria-hidden />
              <span>
                <b>Deployed.</b> {chain.name} now holds Safe {st.version} at {short(p.safe)} with {st.owners?.length ?? '?'} owner{st.owners?.length === 1 ? '' : 's'} and threshold {st.threshold}
                {st.gasUsed ? ` (${st.gasUsed.toLocaleString('en-US')} gas)` : ''}.
              </span>
            </p>
          )}
          {(phase === 'ready' || phase === 'switching' || phase === 'confirm') && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={deploy} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gold px-5 text-[14px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-60" data-testid="safe-deploy-button">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Wallet size={15} aria-hidden />}
                {phase === 'switching' ? `Switching the wallet to ${chain.name}…` : phase === 'confirm' ? 'Confirm in your wallet…' : !isConnected ? 'Connect a wallet to deploy' : `Deploy Safe on ${chain.name}`}
              </button>
              {isConnected && address && <span className="font-mono text-[11px] text-faint">signing wallet {short(address)} · pays the gas · the Safe’s owners stay as shown</span>}
            </div>
          )}
          {(phase === 'sent' || phase === 'mined') && <span className="font-mono text-[11px] text-faint">Waiting for {chain.name}… this page checks every few seconds.</span>}
        </>
      )}

      {msg && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {msg}
        </p>
      )}
    </section>
  )
}

export default function SafeDeploy(props: SafeDeployProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme} modalSize="compact">
          <Inner {...props} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
