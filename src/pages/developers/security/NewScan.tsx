import { ArrowLeft, ArrowRight, CircleDollarSign, FileCheck2, FileCode2, FileUp, GitBranch, Globe, Info, ListChecks, Play, ScanSearch, ShieldAlert, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import { ScanProgress } from '../../../components/security/ScanProgress'
import { fmtWhen, KIND_LABEL, type InputKind, type ScanInput, type ScanView, type SecurityOverview } from '../../../components/security/types'
import { api } from '../api'
import { ErrorLine } from '../parts'
import { Can } from '../RoleGate'
import { input, panel, pillGold, pillLine } from '../styles'
import { PayStep, ScanDetail } from './ScanDetail'
import { fileToBase64, useScan } from './useSecurity'

/* "New scan": a five-step stepper.
     1 Input     what to scan: a deployed contract (address + chain, with the chains' marks), a smart contract
                 repo on GitHub (+ commit), an upload (.zip/.tar.gz/.sol…), or a web2 repo
     2 Scope     what will be scanned, what the scan checks and cannot, free scans left, the price
     3 Pay       Gully Pay, only when the free quota is used up (skipped otherwise)
     4 Running   live progress per engine step, with an estimate of the time left
     5 Report    the report viewer (ScanDetail)
   The server re-checks everything (security-routes.mjs) and refuses a price that changed since step 2. */

type Step = 1 | 2 | 3 | 4 | 5
const STEPS: { n: Step; label: string; icon: ReactNode }[] = [
  { n: 1, label: 'Input', icon: <FileCode2 size={15} aria-hidden /> },
  { n: 2, label: 'Scope & cost', icon: <ListChecks size={15} aria-hidden /> },
  { n: 3, label: 'Pay', icon: <CircleDollarSign size={15} aria-hidden /> },
  { n: 4, label: 'Running', icon: <ScanSearch size={15} aria-hidden /> },
  { n: 5, label: 'Report', icon: <FileCheck2 size={15} aria-hidden /> },
]

const KINDS: { id: InputKind; icon: ReactNode; text: string }[] = [
  { id: 'address', icon: <FileCode2 size={18} aria-hidden />, text: 'A verified contract on a chain' },
  { id: 'repo', icon: <GitBranch size={18} aria-hidden />, text: 'Solidity or Vyper on GitHub' },
  { id: 'upload', icon: <Upload size={18} aria-hidden />, text: 'A .zip, .tar.gz or source file' },
  { id: 'web2', icon: <Globe size={18} aria-hidden />, text: 'A web app or API on GitHub' },
]

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const REPO_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/)?[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}?(?:\.git)?\/?$/
const COMMIT_RE = /^[0-9a-fA-F]{7,40}$/

function Stepper({ step, free }: { step: Step; free: boolean | null }) {
  return (
    <ol className="m-0 flex list-none gap-1 overflow-x-auto p-0 [scrollbar-width:none]" aria-label="New scan steps" data-testid="stepper">
      {STEPS.map((s) => {
        const on = s.n === step
        const done = s.n < step
        const skipped = s.n === 3 && free === true
        return (
          <li key={s.n} aria-current={on ? 'step' : undefined} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors ${on ? 'border-gold bg-[rgba(232,192,96,.08)] text-ink' : done ? 'border-success-line text-ink-2' : 'border-line text-faint'}`} data-step={s.n}>
            <span className={on ? 'text-gold' : done ? 'text-green' : ''}>{s.icon}</span>
            <span className="font-mono text-[11px]">{s.n}</span>
            <span className={skipped ? 'line-through' : ''}>{s.label}</span>
            {skipped && <span className="font-mono text-[11px] text-green">free</span>}
          </li>
        )
      })}
    </ol>
  )
}

function Running({ id, onDone }: { id: string; onDone: () => void }) {
  const [s] = useScan(id)
  const done = s.k === 'ok' && s.data.status === 'done'
  useEffect(() => {
    if (!done) return
    const t = setTimeout(onDone, 600)
    return () => clearTimeout(t)
  }, [done, onDone])
  if (s.k !== 'ok') return <ScanProgress status="queued" pct={0} startedAt={null} />
  const v = s.data
  return (
    <div className="flex flex-col gap-4">
      <ScanProgress status={v.status === 'awaiting_payment' ? 'queued' : v.status} pct={v.progress?.pct ?? null} startedAt={v.startedAt} failure={v.failure} />
      <p className="m-0 text-[13px] text-faint">You can leave this page: the scan keeps running and appears under Scans. {v.title}</p>
    </div>
  )
}

export function NewScan({ ov, onOpen }: { ov: SecurityOverview; onOpen: (id: string) => void }) {
  const [step, setStep] = useState<Step>(1)
  const [kind, setKind] = useState<InputKind>('address')
  const [chain, setChain] = useState(ov.chains[0]?.key ?? 'ethereum')
  const [address, setAddress] = useState('')
  const [repo, setRepo] = useState('')
  const [commit, setCommit] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<ScanView | null>(null)
  const q = ov.quota
  const free = q.left > 0
  const price = free ? 0 : ov.offer.scan.priceUsd
  const maxMb = Math.round(ov.offer.scan.maxUploadBytes / 1_000_000)

  const target: ScanInput = kind === 'address' ? { kind, chain, address: address.trim() } : kind === 'upload' ? { kind } : { kind, repo: repo.trim(), commit: commit.trim() || null }
  const check = (): string | null => {
    if (kind === 'address') return ADDRESS_RE.test(address.trim()) ? null : 'Enter the contract address: 0x followed by 40 hex characters.'
    if (kind === 'upload') return !file ? 'Pick a file to scan.' : file.size > ov.offer.scan.maxUploadBytes ? `The file is larger than ${maxMb} MB. Scan the repository instead.` : null
    if (!REPO_RE.test(repo.trim())) return 'Enter a public GitHub repository as owner/name or its URL.'
    if (commit.trim() && !COMMIT_RE.test(commit.trim())) return 'The commit must be a hash (7 to 40 hex characters), or empty for the default branch.'
    return null
  }
  const describe = kind === 'address' ? `${address.trim()} on ${ov.chains.find((c) => c.key === chain)?.name ?? chain}` : kind === 'upload' ? (file?.name ?? '') : `${repo.trim()}${commit.trim() ? ` @ ${commit.trim().slice(0, 12)}` : ' (default branch)'}`

  const next = () => {
    const e = check()
    setErr(e)
    if (!e) setStep(2)
  }
  const confirm = async () => {
    setBusy(true)
    setErr(null)
    let upload: { name: string; data: string } | undefined
    try {
      if (kind === 'upload' && file) upload = { name: file.name, data: await fileToBase64(file) }
    } catch (e) {
      setBusy(false)
      return setErr(e instanceof Error ? e.message : 'The file could not be read.')
    }
    const r = await api<{ scan: ScanView }>('/api/developer/security/scans', { method: 'POST', body: { input: target, upload, expect: { priceUsd: price } } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setScan(r.data.scan)
    setStep(r.status === 202 ? 3 : 4)
  }

  return (
    <div className="flex flex-col gap-4" data-testid="new-scan">
      <Stepper step={step} free={step >= 2 ? free : null} />

      {step === 1 && (
        <section className={panel} aria-labelledby="ns-input">
          <h3 id="ns-input" className="m-0 text-[15px] font-semibold">
            What should we scan?
          </h3>
          <div role="radiogroup" aria-label="Input" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => (setKind(k.id), setErr(null))} className={`flex min-h-[64px] items-start gap-3 rounded-[12px] border px-3 py-[10px] text-left transition-colors ${kind === k.id ? 'border-gold bg-[rgba(232,192,96,.07)]' : 'border-line-strong hover:border-line-hover'}`}>
                <span className={kind === k.id ? 'text-gold' : 'text-faint'}>{k.icon}</span>
                <span className="flex flex-col">
                  <span className="text-[14px] font-semibold text-ink">{KIND_LABEL[k.id]}</span>
                  <span className="text-[12px] text-muted">{k.text}</span>
                </span>
              </button>
            ))}
          </div>
          {kind === 'address' && (
            <div className="flex flex-col gap-3">
              <div role="radiogroup" aria-label="Chain" className="flex flex-wrap gap-[6px]">
                {ov.chains.map((c) => (
                  <button key={c.key} type="button" role="radio" aria-checked={chain === c.key} onClick={() => setChain(c.key)} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors ${chain === c.key ? 'border-gold bg-gold text-bg' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}>
                    <ChainLogo chain={c.key} size={20} decorative />
                    {c.name}
                  </button>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-[12px] text-dim">
                Contract address (verified source is read from the chain's explorer)
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} className={`${input} font-mono`} />
              </label>
            </div>
          )}
          {(kind === 'repo' || kind === 'web2') && (
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 max-[600px]:grid-cols-1">
              <label className="flex flex-col gap-1 text-[12px] text-dim">
                Public GitHub repository
                <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or https://github.com/owner/name" spellCheck={false} className={`${input} font-mono`} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-dim">
                Commit (optional)
                <input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="default branch" spellCheck={false} className={`${input} font-mono`} />
              </label>
            </div>
          )}
          {kind === 'upload' && (
            <label className="flex min-h-[84px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong px-4 py-4 text-center text-[13px] text-muted hover:border-gold">
              <FileUp size={20} className="text-gold" aria-hidden />
              {file ? (
                <span className="font-mono text-ink">
                  {file.name} · {(file.size / 1000).toFixed(0)} kB
                </span>
              ) : (
                <span>Choose a .zip, .tar.gz, .tgz, .sol, .vy, .rs or .move file, up to {maxMb} MB</span>
              )}
              <input type="file" accept=".zip,.tar,.gz,.tgz,.sol,.vy,.rs,.move" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" data-testid="upload-input" />
            </label>
          )}
          {err && <ErrorLine>{err}</ErrorLine>}
          <div className="flex justify-end">
            <button type="button" onClick={next} className={pillGold}>
              Next: scope and cost <ArrowRight size={15} aria-hidden />
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className={panel} aria-labelledby="ns-scope">
          <h3 id="ns-scope" className="m-0 text-[15px] font-semibold">
            Confirm the scope and the cost
          </h3>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 max-[800px]:grid-cols-1">
            <div className="flex flex-col gap-3">
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
                <dt className="text-dim">Input</dt>
                <dd className="m-0 text-ink">{KIND_LABEL[kind]}</dd>
                <dt className="text-dim">Target</dt>
                <dd className="m-0 flex min-w-0 items-center gap-2 font-mono text-[12px] break-all text-ink" data-testid="scope-target">
                  {kind === 'address' && <ChainLogo chain={chain} size={16} decorative />}
                  {describe}
                </dd>
              </dl>
              <ul className="m-0 flex list-none flex-col gap-[6px] p-0 text-[13px] leading-[1.55] text-ink-2">
                <li className="flex gap-2">
                  <ScanSearch size={15} className="mt-[3px] shrink-0 text-gold" aria-hidden /> Static analysers and an AI pass look for known vulnerability classes; findings are ranked and de-duplicated.
                </li>
                <li className="flex gap-2">
                  <ShieldAlert size={15} className="mt-[3px] shrink-0 text-gold" aria-hidden /> It can miss issues (business logic, economics, cross-contract and off-chain risks) and can report false positives. It is not an audit.
                </li>
                <li className="flex gap-2">
                  <Info size={15} className="mt-[3px] shrink-0 text-gold" aria-hidden /> The report lists every tool that ran and those that did not, with the reason.
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-deep p-4" data-testid="cost">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">{q.plan.name.toUpperCase()} PLAN · THIS MONTH</span>
              <span className="text-[13px] text-ink-2">
                {q.left} of {q.freePerMonth} free scan{q.freePerMonth === 1 ? '' : 's'} left · resets {fmtWhen(q.resetsAt).replace(/,\s*\d{1,2}:\d{2}.*$/, '')}
              </span>
              <span className="font-display text-[36px] leading-none font-bold" data-testid="price">
                {free ? 'Free' : `$${price}`}
              </span>
              <span className="text-[12px] text-faint">{free ? 'Uses one free scan.' : 'Paid with Gully Pay in USDC, USDT or the chain’s coin, straight to the treasury. The scan starts once the payment confirms.'}</span>
              {!free && !ov.checkout.enabled && <span className="text-[12px] text-error">Paid scans cannot be bought yet: checkout is off on this server.</span>}
              {q.active >= q.maxActive && <span className="text-[12px] text-error">{q.active} scans are already running; wait for one to finish.</span>}
            </div>
          </div>
          {!ov.engine.installed && <ErrorLine>The scan engine is not installed on this server yet, so scans cannot start. Nothing will be charged.</ErrorLine>}
          {err && <ErrorLine>{err}</ErrorLine>}
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => (setStep(1), setErr(null))} className={pillLine}>
              <ArrowLeft size={15} aria-hidden /> Back
            </button>
            <Can cat="security" what="start scans">
              <button type="button" onClick={confirm} disabled={busy || !ov.engine.installed || (!free && !ov.checkout.enabled)} className={pillGold} data-testid="confirm-scan">
                <Play size={15} aria-hidden /> {busy ? 'Starting…' : free ? 'Start the free scan' : `Confirm and pay $${price}`}
              </button>
            </Can>
          </div>
        </section>
      )}

      {step === 3 && scan && (
        <section className={panel} aria-label="Pay">
          <PayStep scan={scan} onPaid={() => setStep(4)} />
          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
            <span className="text-[12px] text-faint">Not ready to pay? The scan waits under Scans until its invoice expires.</span>
            <button type="button" onClick={() => onOpen(scan.id)} className={pillLine}>
              Open under Scans
            </button>
          </div>
        </section>
      )}

      {step === 4 && scan && (
        <section className={panel} aria-label="Running">
          <Running id={scan.id} onDone={() => setStep(5)} />
        </section>
      )}

      {step === 5 && scan && <ScanDetail id={scan.id} canPublish={ov.canPublish} />}
    </div>
  )
}
