import { Blocks, Check, Copy, Download, Loader2, Network, Plus, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { copyWithToast, toastError, toastSuccess } from '../../../components/ui/toast'
import { api } from '../api'
import { ExtLink } from '../ExtLink'
import { usePortal } from '../portal'
import { input, pillGold, pillLine, pillSm } from '../styles'
import { PARENT, nodeConfigFor } from './chain'
import type { LaunchedChain } from './types'

/* The Result step and the list's detail: core contract addresses, the node config the SDK's helper writes (no keys),
   and the next steps. */

const CONTRACTS: [keyof NonNullable<LaunchedChain['coreContracts']>, string][] = [
  ['rollup', 'Rollup'],
  ['inbox', 'Inbox'],
  ['outbox', 'Outbox'],
  ['bridge', 'Bridge'],
  ['sequencerInbox', 'Sequencer inbox'],
  ['rollupEventInbox', 'Rollup event inbox'],
  ['challengeManager', 'Challenge manager'],
  ['upgradeExecutor', 'Upgrade executor'],
  ['adminProxy', 'Admin proxy'],
  ['validatorWalletCreator', 'Validator wallet creator'],
]

export function CoreContractsTable({ chain }: { chain: LaunchedChain }) {
  const core = chain.coreContracts
  if (!core) return null
  return (
    <div className="overflow-hidden rounded-card border border-line" data-testid="core-contracts">
      {CONTRACTS.filter(([k]) => typeof core[k] === 'string').map(([k, name], i) => (
        <div key={k} className="flex min-h-11 items-center gap-3 border-t border-line px-3 py-1 first:border-t-0" style={{ animation: `gl-rise .35s ${i * 0.03}s ease both` }} data-contract={k}>
          <span className="w-[150px] shrink-0 text-[13px] text-dim max-[600px]:w-[110px]">{name}</span>
          <ExtLink href={`${PARENT.explorer}/address/${core[k]}`} className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2 hover:text-gold" arrow={false}>
            {core[k] as string}
          </ExtLink>
          <button type="button" onClick={() => void copyWithToast(core[k] as string, name)} aria-label={`Copy the ${name} address`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-gold">
            <Copy size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Builds the node config with the SDK helper and hands it to the browser as a file. */
export function DownloadNodeConfig({ chain, className = pillGold, label = 'Download node config' }: { chain: LaunchedChain; className?: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const cfg = await nodeConfigFor(chain)
      const url = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2) + '\n'], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${chain.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chain'}-${chain.chainId}-node-config.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch (e) {
      toastError('Could not build the node config', { detail: String((e as Error)?.message ?? e).slice(0, 200) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={go} disabled={busy || !chain.coreContracts} className={className} data-testid="download-node-config">
      {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />} {label}
    </button>
  )
}

function Waitlist() {
  const { me } = usePortal()
  const [email, setEmail] = useState(me?.profile.email ?? '')
  const [busy, setBusy] = useState(false)
  const [joined, setJoined] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const r = await api('/api/developer/chains-waitlist', { method: 'POST', body: { email: email.trim() } })
    setBusy(false)
    if (!r.ok) return toastError('Could not join the waitlist', { detail: r.status === 400 ? 'Check the email address.' : r.error })
    setJoined(true)
    toastSuccess('You are on the Gully Chains waitlist')
  }
  return joined ? (
    <p className="m-0 flex items-center gap-2 text-[13px] text-ink-2" data-testid="waitlist-joined">
      <Check size={15} className="text-green" aria-hidden /> You are on the list. We write to you when managed hosting opens.
    </p>
  ) : (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input className={`${input} min-w-0 flex-[1_1_200px]`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email to reach you" aria-label="Email for the Gully Chains waitlist" name="waitlist-email" />
      <button type="submit" disabled={busy} className={pillLine}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Join the waitlist
      </button>
    </form>
  )
}

export function LaunchResult({ chain, goChainKit, onDone, onAnother }: { chain: LaunchedChain; goChainKit: () => void; onDone: () => void; onAnother: () => void }) {
  return (
    <div className="flex flex-col gap-4" data-testid="launch-result">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-green text-bg" aria-hidden>
          <Check size={18} strokeWidth={3} style={{ animation: 'gl-check-pop .5s cubic-bezier(.2,1.4,.4,1) both' }} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[16px] font-semibold text-ink">{chain.name} is deployed on {PARENT.name}</span>
          <span className="font-mono text-[11px] text-faint">chain id {chain.chainId} · {chain.type === 'rollup' ? 'Rollup' : 'AnyTrust'} · ETH gas</span>
        </div>
        <span className="ml-auto flex flex-wrap gap-2">
          <DownloadNodeConfig chain={chain} />
          <button type="button" onClick={onDone} className={pillLine}>
            See my chains
          </button>
        </span>
      </div>

      <CoreContractsTable chain={chain} />

      <p className="m-0 text-[12px] leading-[1.5] text-faint" data-testid="node-config-note">
        The node config holds no keys, so its batch poster and validator are switched off. On the machine that runs your node, add the private keys of the addresses you gave (they never leave that machine) and enable them, then start the Nitro node with this file.
      </p>

      <section aria-label="Next steps" className="flex flex-col gap-2" data-testid="next-steps">
        <h3 className="m-0 text-[14px] font-semibold text-ink">Next steps</h3>
        <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 max-[800px]:grid-cols-1">
          <li className="flex flex-col gap-2 rounded-card border border-line p-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Blocks size={15} className="text-gold" aria-hidden /> 1. Request a Chain Kit explorer
            </span>
            <span className="text-[12px] text-muted">A branded Blockscout explorer, faucet and status page for this chain, run by Gully Labs.</span>
            <button type="button" onClick={goChainKit} className={`${pillSm} self-start`}>
              Open Chain Kit
            </button>
          </li>
          <li className="flex flex-col gap-2 rounded-card border border-line p-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Network size={15} className="text-gold" aria-hidden /> 2. Run the node and bridge funds
            </span>
            <span className="text-[12px] text-muted">Start the node with your config, then deploy the token bridge so users can move ETH and tokens in.</span>
            <ExtLink href='https://docs.arbitrum.io/launch-arbitrum-chain/a-gentle-introduction' className={`${pillSm} self-start`}>
              Arbitrum chain docs
            </ExtLink>
          </li>
          <li className="flex flex-col gap-2 rounded-card border border-line p-3 col-span-2 max-[800px]:col-span-1">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Send size={15} className="text-gold" aria-hidden /> 3. Want us to run it? Join the Gully Chains waitlist
            </span>
            <span className="text-[12px] text-muted">Managed hosting: sequencer, batch poster, validators, explorer and monitoring, run for you.</span>
            <Waitlist />
          </li>
        </ol>
      </section>
      <button type="button" onClick={onAnother} className={`${pillSm} self-start`}>
        <Plus size={14} aria-hidden /> Launch another
      </button>
    </div>
  )
}
