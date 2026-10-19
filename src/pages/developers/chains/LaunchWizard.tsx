import { ArrowLeft, ArrowRight, Check, Coins, KeyRound, Layers, Loader2, Rocket, ScrollText, Settings2, ShieldCheck, Wallet } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatEther, type Address, type Hex } from 'viem'
import { pillClass } from '../../../components/ui/pill'
import { toastError } from '../../../components/ui/toast'
import { api } from '../api'
import { Skeleton } from '../parts'
import { usePortal, useWrite } from '../portal'
import { input, label as labelCls, mono, pillGold, pillSm } from '../styles'
import { ProgressSteps, Stepper, type Step } from '../ui'
import { finalize, PARENT, prepareLaunch, stubbed } from './chain'
import { LaunchResult } from './LaunchResult'
import type { ChainsState, ChainType, LaunchedChain, LaunchInput, Prepared } from './types'
import { addressError, addressListOf, chainIdError, nameError } from './validate'
import type { WalletApi } from './ChainWallet'

const ChainWallet = lazy(() => import('./ChainWallet'))

/* The chain launch wizard: Chain type, Configure, Validators and batch poster, Review, Deploy, Result.
   Testnet only (Arbitrum Sepolia). The Arbitrum chain SDK builds the rollup-creation transaction (sdk.ts, a lazy
   chunk); the user's wallet signs it in the browser; the server only stores addresses and configuration
   (server/chains-launch.mjs). Nothing here generates, asks for or stores a private key. Editing a step clears the
   steps after it, so what is reviewed is always what is sent. */

type Draft = { type: ChainType | null; name: string; chainId: string; owner: string; validators: string; posters: string }
const EMPTY: Draft = { type: null, name: '', chainId: '', owner: '', validators: '', posters: '' }
const STEP_IDS = ['type', 'configure', 'operators', 'review', 'deploy', 'result'] as const
type StepId = (typeof STEP_IDS)[number]

const TYPES: { id: ChainType; title: string; desc: string; points: string[] }[] = [
  { id: 'rollup', title: 'Rollup', desc: 'Posts every batch to Arbitrum Sepolia as calldata or blobs.', points: ['Inherits the parent chain’s security', 'No committee to trust', 'Pays for data posting'] },
  { id: 'anytrust', title: 'AnyTrust', desc: 'A data availability committee holds the data; the parent chain only gets a certificate.', points: ['Much lower fees', 'Trusts the committee to stay honest', 'You run or pick the committee'] },
]

const Field = ({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={id} className={`${labelCls} font-medium`}>
      {label}
    </label>
    {children}
    {error ? (
      <span role="alert" className="text-[12px] text-error" data-testid={`${id}-error`}>
        {error}
      </span>
    ) : (
      hint && <span className="text-[12px] text-faint">{hint}</span>
    )}
  </div>
)

const Fixed = ({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className={`${labelCls} font-medium`}>{label}</span>
    <span className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-surface-deep px-3 text-[14px] text-ink-2">
      <span className="text-gold" aria-hidden>
        {icon}
      </span>
      <span className="truncate">{value}</span>
      <span className="ml-auto font-mono text-[11px] whitespace-nowrap text-faint">{note}</span>
    </span>
  </div>
)

type IdCheck = { state: 'idle' } | { state: 'checking' } | { state: 'free'; listChecked: boolean } | { state: 'taken'; reason: string } | { state: 'unknown' }

/** The chain id's uniqueness against chainlist data and chains launched here (server). Debounced; never blocks on a network failure. */
function useIdCheck(value: string): IdCheck {
  const [res, setRes] = useState<{ v: string; r: IdCheck } | null>(null)
  const valid = chainIdError(value) === null
  useEffect(() => {
    if (!valid) return
    let alive = true
    const id = setTimeout(async () => {
      const r = await api<{ free: boolean; reason?: string; checkedChainlist?: boolean }>(`/api/developer/chains-launch/check?chainId=${encodeURIComponent(value.trim())}`)
      if (!alive) return
      setRes({ v: value, r: !r.ok ? { state: 'unknown' } : r.data.free ? { state: 'free', listChecked: !!r.data.checkedChainlist } : { state: 'taken', reason: r.data.reason ?? 'This chain id is taken.' } })
    }, 450)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [value, valid])
  if (!valid) return { state: 'idle' }
  return res && res.v === value ? res.r : { state: 'checking' }
}

function IdStatus({ c }: { c: IdCheck }) {
  if (c.state === 'idle') return null
  const tone = c.state === 'free' ? 'text-green' : c.state === 'taken' ? 'text-error' : 'text-faint'
  return (
    <span className={`flex items-center gap-1 text-[12px] ${tone}`} role="status" data-testid="chain-id-status" data-state={c.state} style={{ animation: 'gl-fade .25s ease both' }}>
      {c.state === 'checking' && <Loader2 size={12} className="animate-spin" aria-hidden />}
      {c.state === 'free' && <Check size={12} aria-hidden />}
      {c.state === 'checking' ? 'Checking chainlist and chains launched here…' : c.state === 'free' ? (c.listChecked ? 'Not on chainlist and not used by a chain launched here.' : 'Not used by a chain launched here (chainlist could not be read right now).') : c.state === 'taken' ? c.reason : 'Could not check uniqueness right now; the server checks again when you deploy.'}
    </span>
  )
}

const Nav = ({ back, onBack, next, nextLabel = 'Continue', disabled, busy }: { back?: boolean; onBack?: () => void; next: () => void; nextLabel?: string; disabled?: boolean; busy?: boolean }) => (
  <div className="mt-1 flex flex-wrap items-center gap-2">
    {back && (
      <button type="button" onClick={onBack} className={pillSm}>
        <ArrowLeft size={14} aria-hidden /> Back
      </button>
    )}
    <button type="button" onClick={next} disabled={disabled || busy} className={`${pillGold} ml-auto max-[480px]:w-full`} data-testid="wizard-next">
      {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {nextLabel} {!busy && <ArrowRight size={15} aria-hidden />}
    </button>
  </div>
)

/* ------------------------------------------------------------------ review --- */

const ROW = 'grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line py-[6px] text-[13px] first:border-t-0 max-[480px]:grid-cols-1'
const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className={ROW}>
    <span className="text-dim">{k}</span>
    <span className="min-w-0 font-mono text-[12px] break-all text-ink-2">{children}</span>
  </div>
)

function Review({ input: inp, w, prepared, setPrepared, onConfirm, onBack }: { input: LaunchInput; w: WalletApi; prepared: Prepared | null; setPrepared: (p: Prepared | null) => void; onConfirm: () => void; onBack: () => void }) {
  const account = (stubbed() ? (w.address ?? inp.owner) : w.address) as Address | null
  const key = account ? `${account}|${JSON.stringify(inp)}` : ''
  const [tries, setTries] = useState(0)
  const tag = `${key}#${tries}`
  const [state, setState] = useState<{ tag: string; error: string | null }>({ tag: '', error: null })
  useEffect(() => {
    if (!account) return
    let alive = true
    prepareLaunch(inp, account)
      .then((p) => {
        if (!alive) return
        setPrepared(p)
        setState({ tag, error: null })
      })
      .catch((e) => {
        if (!alive) return
        setPrepared(null)
        const m = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
        setState({ tag, error: /exceeds the balance|insufficient funds/i.test(m) ? `this wallet does not hold enough ${PARENT.name} test ETH to deploy (the deployment sends ETH for the chain’s retryable fees, plus gas). Fund it from an Arbitrum Sepolia faucet, then try again.` : m.slice(0, 300) })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already captures account and input
  }, [key, tries])
  const resolved = state.tag === tag
  const error = resolved ? state.error : null
  const p = resolved && !error && prepared && prepared.from === account ? prepared : null
  const busy = !!account && !resolved
  return (
    <div className="flex flex-col gap-3" data-testid="review">
      <div className="grid grid-cols-2 gap-x-6 max-[700px]:grid-cols-1">
        <div>
          <Row k="Chain">{inp.name}</Row>
          <Row k="Chain id">{inp.chainId}</Row>
          <Row k="Type">{inp.type === 'rollup' ? 'Rollup' : 'AnyTrust'}</Row>
          <Row k="Parent chain">
            {PARENT.name} ({PARENT.id}), testnet
          </Row>
          <Row k="Gas token">ETH</Row>
        </div>
        <div>
          <Row k="Owner">{inp.owner}</Row>
          <Row k="Validators">{inp.validators.join('\n')}</Row>
          <Row k="Batch posters">{inp.batchPosters.join('\n')}</Row>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-deep p-3" aria-live="polite" data-testid="tx-preview">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <ScrollText size={15} className="text-gold" aria-hidden /> The transaction the SDK will create
          <span className={`${pillClass('neutral')} ml-auto`}>1 transaction</span>
        </span>
        {!account ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted">Connect the wallet that will pay for and sign the deployment, so the SDK can price it for that account.</span>
            <button type="button" onClick={w.connect} className={pillGold} data-testid="connect-wallet">
              <Wallet size={15} aria-hidden /> Connect wallet
            </button>
          </div>
        ) : busy ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Preparing the transaction">
            <Skeleton h={18} w="60%" />
            <Skeleton h={18} />
            <Skeleton h={18} w="80%" />
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-error" role="alert">
            <span className="min-w-0 flex-1">The SDK could not prepare the transaction: {error}</span>
            <button type="button" onClick={() => setTries((n) => n + 1)} className={pillSm}>
              Try again
            </button>
          </div>
        ) : p ? (
          <div style={{ animation: 'gl-fade .3s ease both' }}>
            <Row k="Network">
              {PARENT.name} ({p.chainId})
            </Row>
            <Row k="From">{p.from}</Row>
            <Row k="To">{p.to} (the Arbitrum RollupCreator)</Row>
            <Row k="Function">createRollup(deployParams): creates the rollup, bridge, inbox, outbox, sequencer inbox and upgrade executor in one call</Row>
            <Row k="Value">{formatEther(p.value)} ETH</Row>
            <Row k="Gas estimate">{p.gas ? p.gas.toLocaleString('en-US') : 'estimated by your wallet'}</Row>
            <Row k="Call data">{Math.max(0, (p.data.length - 2) / 2).toLocaleString('en-US')} bytes, from {p.data.slice(0, 10)}</Row>
            <Row k="Stake token">{p.stakeToken} (WETH on the parent chain)</Row>
            <details className="mt-1 text-[12px] text-muted">
              <summary className="min-h-11 cursor-pointer py-3">Chain config the SDK built</summary>
              <pre className="m-0 max-h-[220px] overflow-auto rounded-[10px] bg-bg p-3 font-mono text-[11px] text-ink-2" tabIndex={0}>
                {JSON.stringify(p.chainConfig, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
      <p className="m-0 flex items-start gap-2 text-[12px] leading-[1.5] text-faint">
        <ShieldCheck size={14} className="mt-[2px] shrink-0 text-green" aria-hidden /> Read-only: the SDK asks Arbitrum Sepolia for fees and gas to build this. Nothing is signed or sent until the next step, and only your wallet can sign it.
      </p>
      <Nav back onBack={onBack} next={onConfirm} nextLabel="This is right, continue" disabled={!p} />
    </div>
  )
}

/* ------------------------------------------------------------------ deploy --- */

type Phase = 'idle' | 'signing' | 'mining' | 'recording' | 'done' | 'failed'

function Deploy({ input: inp, w, prepared, onBackToReview, onLaunched }: { input: LaunchInput; w: WalletApi; prepared: Prepared | null; onBackToReview: () => void; onLaunched: (c: LaunchedChain) => void }) {
  const { ok: canWrite, why } = useWrite('chains', 'launch a chain')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState<Hex | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  const stale = !prepared || (w.address !== null && w.address !== prepared.from)

  const record = async (txHash: Hex, status: 'submitted' | 'deployed', coreContracts?: unknown) => {
    const body = { name: inp.name, chainId: inp.chainId, type: inp.type, parentChainId: PARENT.id, owner: inp.owner, validators: inp.validators, batchPosters: inp.batchPosters, gasToken: 'ETH', txHash, status, coreContracts }
    return api<{ chain: LaunchedChain }>('/api/developer/chains-launch', { method: 'POST', body })
  }

  const run = async () => {
    if (!prepared) return
    setError(null)
    try {
      setPhase('signing')
      const txHash = await w.send(prepared)
      setHash(txHash)
      const r1 = await record(txHash, 'submitted')
      if (!r1.ok) throw new Error(`The transaction was sent (${txHash}) but could not be saved to your workspace: ${r1.error}`)
      setPhase('mining')
      for (let i = 0; i < 150 && alive.current; i++) {
        const f = await finalize(txHash)
        if (f.state === 'failed') throw new Error(f.reason)
        if (f.state === 'deployed') {
          setPhase('recording')
          const r2 = await record(txHash, 'deployed', f.coreContracts)
          if (!r2.ok) throw new Error(r2.error)
          setPhase('done')
          onLaunched(r2.data.chain)
          return
        }
        await new Promise((r) => setTimeout(r, 4_000))
      }
      if (alive.current) throw new Error('Still waiting for the transaction. It is saved in your workspace: open Chains and press Check deployment later.')
    } catch (e) {
      if (!alive.current) return
      const m = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
      setPhase('failed')
      setError(/reject|denied|cancel/i.test(m) ? 'The wallet request was declined. Nothing was sent.' : /insufficient/i.test(m) ? 'This wallet does not hold enough Arbitrum Sepolia ETH for the deployment and gas.' : m.slice(0, 300))
    }
  }

  const busy = phase === 'signing' || phase === 'mining' || phase === 'recording'
  const steps = [
    { id: 'sign', label: 'Sign in your wallet', state: phase === 'signing' ? 'active' : phase === 'idle' ? 'todo' : phase === 'failed' && !hash ? 'failed' : 'done' },
    { id: 'mine', label: 'Mined on Arbitrum Sepolia', state: phase === 'mining' ? 'active' : phase === 'recording' || phase === 'done' ? 'done' : phase === 'failed' && hash ? 'failed' : 'todo' },
    { id: 'save', label: 'Saved to workspace', state: phase === 'recording' ? 'active' : phase === 'done' ? 'done' : 'todo' },
  ] as const
  return (
    <div className="flex flex-col gap-3" data-testid="deploy">
      <p className="m-0 text-[13px] leading-[1.5] text-muted">Your wallet signs the one transaction you reviewed and pays for it with Arbitrum Sepolia test ETH. Gully Labs never sees a key and signs nothing for you.</p>
      {stale && (
        <p role="alert" className="m-0 text-[13px] text-error">
          The reviewed transaction no longer matches the connected wallet.{' '}
          <button type="button" onClick={onBackToReview} className="min-h-11 text-gold underline">
            Review it again
          </button>
        </p>
      )}
      <ProgressSteps steps={steps.map((s) => ({ ...s }))} label="Deployment progress" testId="deploy-progress" />
      {hash && (
        <a href={`${PARENT.explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] break-all text-gold underline">
          {hash}
        </a>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-error" data-testid="deploy-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!w.address ? (
          <button type="button" onClick={w.connect} className={pillGold} data-testid="connect-wallet">
            <Wallet size={15} aria-hidden /> Connect wallet
          </button>
        ) : !w.onParent ? (
          <button type="button" onClick={() => void w.switchToParent().catch(() => toastError('Could not switch network', { detail: `Switch your wallet to ${PARENT.name} by hand.` }))} className={pillGold}>
            Switch to {PARENT.name}
          </button>
        ) : (
          <button type="button" onClick={run} disabled={busy || stale || !canWrite || phase === 'done'} title={why} className={pillGold} data-testid="deploy-send">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Rocket size={15} aria-hidden />}
            {phase === 'signing' ? 'Confirm in your wallet…' : phase === 'mining' ? 'Waiting for the chain…' : phase === 'recording' ? 'Saving…' : 'Sign and deploy'}
          </button>
        )}
        {w.address && <span className={mono}>from {w.address.slice(0, 6)}…{w.address.slice(-4)}</span>}
        {!busy && (
          <button type="button" onClick={onBackToReview} className={`${pillSm} ml-auto`}>
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
        )}
      </div>
      {!canWrite && <span className="text-[12px] text-faint">{why}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ wizard --- */

export function LaunchWizard({ onLaunched, goChainKit, onDone }: { onLaunched: (state: ChainsState) => void; goChainKit: () => void; onDone: () => void }) {
  const { me } = usePortal()
  const [d, setD] = useState<Draft>(EMPTY)
  const [done, setDone] = useState<ReadonlySet<StepId>>(new Set())
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [launched, setLaunched] = useState<LaunchedChain | null>(null)
  const idCheck = useIdCheck(d.chainId)

  /** Editing a step clears it and every step after it, so what was reviewed is always what is sent. */
  const edit = (step: StepId, patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }))
    const at = STEP_IDS.indexOf(step)
    setDone((s) => new Set([...s].filter((id) => STEP_IDS.indexOf(id) < at)))
  }
  const finish = (id: StepId) => setDone((s) => new Set([...s, id]))
  const touch = (f: string) => setTouched((s) => new Set([...s, f]))

  const errors = {
    name: nameError(d.name),
    chainId: chainIdError(d.chainId) ?? (idCheck.state === 'taken' ? idCheck.reason : null),
    owner: addressError(d.owner),
  }
  const val = useMemo(() => addressListOf(d.validators, 'validator'), [d.validators])
  const pos = useMemo(() => addressListOf(d.posters, 'batch poster'), [d.posters])
  const show = (f: keyof typeof errors) => (touched.has(f) ? errors[f] : null)
  const configureOk = !errors.name && !errors.chainId && !errors.owner && idCheck.state !== 'checking'
  const input_: LaunchInput | null = d.type && configureOk && val.list && pos.list ? { name: d.name.trim(), chainId: Number(d.chainId.trim()), type: d.type, owner: d.owner.trim() as Address, validators: val.list, batchPosters: pos.list } : null

  const steps: Step[] = [
    { id: 'type', label: 'Chain type', icon: <Layers size={14} aria-hidden />, done: done.has('type') },
    { id: 'configure', label: 'Configure', icon: <Settings2 size={14} aria-hidden />, done: done.has('configure') },
    { id: 'operators', label: 'Validators and poster', icon: <KeyRound size={14} aria-hidden />, done: done.has('operators') },
    { id: 'review', label: 'Review', icon: <ScrollText size={14} aria-hidden />, done: done.has('review') },
    { id: 'deploy', label: 'Deploy', icon: <Rocket size={14} aria-hidden />, done: done.has('deploy') },
    { id: 'result', label: 'Result', icon: <Check size={14} aria-hidden />, done: false },
  ]

  const walletStep = (render: (w: WalletApi) => ReactNode) => (
    <Suspense fallback={<Skeleton h={160} />}>
      <ChainWallet key="wallet">{render}</ChainWallet>
    </Suspense>
  )

  const body = (id: string): ReactNode => {
    switch (id as StepId) {
      case 'type':
        return (
          <div className="flex flex-col gap-3" data-testid="step-type">
            <div role="radiogroup" aria-label="Chain type" className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
              {TYPES.map((t) => {
                const on = d.type === t.id
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => edit('type', { type: t.id })} data-type={t.id} className={`flex min-h-11 flex-col gap-2 rounded-card border p-3 text-left transition-colors ${on ? 'border-gold bg-[rgba(217,181,99,.06)]' : 'border-line-strong hover:border-line-hover'}`}>
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                      <span className={`grid size-5 place-items-center rounded-full border ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong'}`}>{on && <Check size={12} strokeWidth={3} aria-hidden style={{ animation: 'gl-check-pop .35s cubic-bezier(.2,1.4,.4,1) both' }} />}</span>
                      {t.title}
                    </span>
                    <span className="text-[13px] leading-[1.45] text-muted">{t.desc}</span>
                    <ul className="m-0 flex list-none flex-col gap-[2px] p-0 text-[12px] text-faint">
                      {t.points.map((p) => (
                        <li key={p}>+ {p}</li>
                      ))}
                    </ul>
                  </button>
                )
              })}
            </div>
            <Nav next={() => finish('type')} disabled={!d.type} />
          </div>
        )
      case 'configure':
        return (
          <div className="flex flex-col gap-3" data-testid="step-configure">
            <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
              <Field id="chain-name" label="Chain name" error={show('name')} hint="Shown in your list and the node config.">
                <input id="chain-name" className={input} value={d.name} maxLength={40} onChange={(e) => edit('configure', { name: e.target.value })} onBlur={() => touch('name')} placeholder="My Testnet Chain" autoComplete="off" aria-invalid={!!show('name')} />
              </Field>
              <Field id="chain-id" label="Chain id" error={show('chainId')} hint={<IdStatus c={idCheck} />}>
                <input id="chain-id" className={`${input} font-mono`} value={d.chainId} inputMode="numeric" maxLength={16} onChange={(e) => edit('configure', { chainId: e.target.value.replace(/\s/g, '') })} onBlur={() => touch('chainId')} placeholder="412346" autoComplete="off" aria-invalid={!!show('chainId')} />
              </Field>
              <Field id="chain-owner" label="Owner address" error={show('owner')} hint="Controls upgrades and settings through the upgrade executor.">
                <div className="flex gap-2">
                  <input id="chain-owner" className={`${input} min-w-0 font-mono text-[13px]`} value={d.owner} onChange={(e) => edit('configure', { owner: e.target.value.trim() })} onBlur={() => touch('owner')} placeholder="0x…" autoComplete="off" spellCheck={false} aria-invalid={!!show('owner')} />
                  {me && (
                    <button type="button" className={`${pillSm} shrink-0`} onClick={() => { edit('configure', { owner: me.address }); touch('owner') }} title="Use the wallet you signed in with">
                      My wallet
                    </button>
                  )}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
                <Fixed icon={<Coins size={15} />} label="Gas token" value="ETH" note="custom token later" />
                <Fixed icon={<Layers size={15} />} label="Parent chain" value={PARENT.name} note="testnet only" />
              </div>
            </div>
            <Nav back onBack={() => edit('type', {})} next={() => { setTouched(new Set(['name', 'chainId', 'owner'])); if (configureOk) finish('configure') }} disabled={idCheck.state === 'checking'} />
          </div>
        )
      case 'operators':
        return (
          <div className="flex flex-col gap-3" data-testid="step-operators">
            <p className="m-0 flex items-start gap-2 rounded-[10px] border border-success-line px-3 py-2 text-[13px] leading-[1.5] text-ink-2" data-testid="no-keys-note">
              <ShieldCheck size={16} className="mt-[2px] shrink-0 text-green" aria-hidden />
              <span>
                Give addresses only. Gully Labs never generates, receives or holds a private key: each key stays on the machine that runs your node, and this page and our server refuse anything that looks like a key.
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
              <Field id="validators" label="Validator addresses" error={touched.has('validators') ? val.error : null} hint="One per line. These accounts may post assertions (validate the chain).">
                <textarea id="validators" className={`${input} h-24 resize-y py-2 font-mono text-[12px]`} value={d.validators} onChange={(e) => edit('operators', { validators: e.target.value })} onBlur={() => touch('validators')} placeholder="0x…" spellCheck={false} aria-invalid={!!(touched.has('validators') && val.error)} />
              </Field>
              <Field id="posters" label="Batch poster addresses" error={touched.has('posters') ? pos.error : null} hint="One per line. These accounts post transaction batches to Arbitrum Sepolia.">
                <textarea id="posters" className={`${input} h-24 resize-y py-2 font-mono text-[12px]`} value={d.posters} onChange={(e) => edit('operators', { posters: e.target.value })} onBlur={() => touch('posters')} placeholder="0x…" spellCheck={false} aria-invalid={!!(touched.has('posters') && pos.error)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={pillSm} onClick={() => { edit('operators', { validators: d.owner.trim(), posters: d.owner.trim() }); setTouched((s) => new Set([...s, 'validators', 'posters'])) }} disabled={!d.owner.trim()}>
                Use the owner address for both
              </button>
              <span className="text-[12px] text-faint">Fine for a testnet; use separate keys for anything you keep.</span>
            </div>
            <Nav back onBack={() => edit('configure', {})} next={() => { setTouched((s) => new Set([...s, 'validators', 'posters'])); if (val.list && pos.list) finish('operators') }} />
          </div>
        )
      case 'review':
        return !input_ ? (
          <p className="m-0 text-[13px] text-error">Some earlier details are missing or invalid. Go back and finish them.</p>
        ) : (
          walletStep((w) => <Review input={input_} w={w} prepared={prepared} setPrepared={setPrepared} onConfirm={() => finish('review')} onBack={() => edit('operators', {})} />)
        )
      case 'deploy':
        return !input_ ? null : walletStep((w) => (
          <Deploy
            input={input_}
            w={w}
            prepared={prepared}
            onBackToReview={() => edit('review', {})}
            onLaunched={(c) => {
              setLaunched(c)
              finish('deploy')
              void api<ChainsState>('/api/developer/chains-launch').then((r) => r.ok && onLaunched(r.data))
            }}
          />
        ))
      case 'result':
        return launched ? <LaunchResult chain={launched} goChainKit={goChainKit} onDone={onDone} onAnother={() => { setD(EMPTY); setDone(new Set()); setTouched(new Set()); setPrepared(null); setLaunched(null) }} /> : null
    }
  }

  return (
    <Stepper title="Launch a testnet chain" steps={steps} testId="launch-stepper" foldWhenDone={false}>
      {body}
    </Stepper>
  )
}

