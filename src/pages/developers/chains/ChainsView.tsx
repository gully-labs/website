import { Blocks, ExternalLink, ListChecks, Loader2, Network, Rocket, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MiniBars } from '../../../components/charts/MiniBars'
import { GhostChart } from '../../../components/charts/GhostChart'
import { pillClass } from '../../../components/ui/pill'
import { toastError, toastSuccess } from '../../../components/ui/toast'
import { api, fmtDate, shortAddress } from '../api'
import { ErrorLine, Skeleton } from '../parts'
import { usePoll } from '../poll'
import { useWrite } from '../portal'
import { Section, ServiceHeader, type Status } from '../services/ServiceHeader'
import type { ServiceCtx } from '../services/links'
import { docsPage, sitePage } from '../services/links'
import { pillGold, pillSm } from '../styles'
import { useSubTab } from '../subtab'
import { SubPanel, SubTabs, type SubTabItem } from '../ui'
import { finalize, PARENT } from './chain'
import { LaunchWizard } from './LaunchWizard'
import { CoreContractsTable, DownloadNodeConfig } from './LaunchResult'
import type { ChainsState, LaunchedChain } from './types'

/* Chains, in the app: launch an Arbitrum Orbit TESTNET chain yourself (settling to Arbitrum Sepolia) and keep a list
   of the chains your workspace launched. The wizard is LaunchWizard.tsx; the list is server state
   (GET /api/developer/chains-launch, addresses and configuration only, no keys). Deep links: #chains and
   #chains/launch. Testnet only: there is no mainnet path. */

const TABS = ['launched', 'launch'] as const
type Sub = (typeof TABS)[number]
const ITEMS: SubTabItem<Sub>[] = [
  { id: 'launched', label: 'My chains', icon: <ListChecks size={15} aria-hidden /> },
  { id: 'launch', label: 'Launch a chain', icon: <Rocket size={15} aria-hidden /> },
]

const DAYS = 14
function launchesPerDay(chains: LaunchedChain[]) {
  const out: { label: string; value: number }[] = []
  const now = Date.now()
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ label: new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: chains.filter((c) => c.at.slice(0, 10) === day).length })
  }
  return out
}

function ChainRow({ c, i, onChanged }: { c: LaunchedChain; i: number; onChanged: (s: ChainsState) => void }) {
  const { ok: canWrite, why } = useWrite('chains', 'change launched chains')
  const [busy, setBusy] = useState<'check' | 'remove' | null>(null)
  const [open, setOpen] = useState(false)
  const check = async () => {
    setBusy('check')
    try {
      const f = await finalize(c.txHash)
      if (f.state === 'pending') return toastSuccess('Still waiting for the chain', { detail: 'The transaction has not been mined yet. Try again in a minute.' })
      if (f.state === 'failed') return toastError('Deployment failed', { detail: f.reason })
      const r = await api<{ chains: LaunchedChain[] }>('/api/developer/chains-launch', {
        method: 'POST',
        body: { name: c.name, chainId: c.chainId, type: c.type, parentChainId: c.parentChainId, owner: c.owner, validators: c.validators, batchPosters: c.batchPosters, gasToken: 'ETH', txHash: c.txHash, status: 'deployed', coreContracts: f.coreContracts },
      })
      if (!r.ok) return toastError('Could not save the result', { detail: r.error })
      onChanged({ parent: { id: PARENT.id, name: PARENT.name }, types: ['rollup', 'anytrust'], max: 20, chains: r.data.chains })
      toastSuccess(`${c.name} is deployed`)
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    if (!window.confirm(`Remove ${c.name} from this list? The chain stays on Arbitrum Sepolia; only the list entry goes.`)) return
    setBusy('remove')
    const r = await api<{ chains: LaunchedChain[] }>('/api/developer/chains-launch/remove', { method: 'POST', body: { id: c.id } })
    setBusy(null)
    if (!r.ok) return toastError('Could not remove it', { detail: r.error })
    onChanged({ parent: { id: PARENT.id, name: PARENT.name }, types: ['rollup', 'anytrust'], max: 20, chains: r.data.chains })
  }
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3" style={{ animation: `gl-rise .4s ${Math.min(i, 8) * 0.05}s ease both` }} data-testid="launched-chain" data-status={c.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[14px] font-semibold text-ink">{c.name}</span>
        <span className={pillClass(c.status === 'deployed' ? 'ok' : 'warn')}>{c.status === 'deployed' ? 'deployed' : 'waiting for chain'}</span>
        <span className={pillClass('neutral')}>{c.type === 'rollup' ? 'Rollup' : 'AnyTrust'}</span>
        <span className="font-mono text-[11px] text-faint">id {c.chainId} · {fmtDate(c.at)} · owner {shortAddress(c.owner)}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {c.status === 'submitted' && (
            <button type="button" onClick={check} disabled={busy !== null} className={pillSm} data-testid="check-deployment">
              {busy === 'check' && <Loader2 size={14} className="animate-spin" aria-hidden />} Check deployment
            </button>
          )}
          {c.status === 'deployed' && <DownloadNodeConfig chain={c} className={pillSm} label="Node config" />}
          {c.status === 'deployed' && (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={pillSm}>
              Contracts
            </button>
          )}
          <a href={`${PARENT.explorer}/tx/${c.txHash}`} target="_blank" rel="noopener noreferrer" className={pillSm} aria-label={`${c.name} deployment transaction (opens in a new tab)`}>
            <ExternalLink size={13} aria-hidden /> Tx
          </a>
          <button type="button" onClick={remove} disabled={busy !== null || !canWrite} title={why} aria-label={`Remove ${c.name} from the list`} className={`${pillSm} px-2`}>
            {busy === 'remove' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
          </button>
        </span>
      </div>
      {open && <CoreContractsTable chain={c} />}
    </li>
  )
}

export default function ChainsView({ ctx }: { ctx: ServiceCtx }) {
  const [sub, setSub] = useSubTab<Sub>('chains', TABS, 'launched', { hashOnOpen: false })
  const poll = usePoll<ChainsState>('/api/developer/chains-launch', 60_000)
  const [fresh, setFresh] = useState<ChainsState | null>(null)
  const state = fresh ?? poll.data
  const chains = useMemo(() => state?.chains ?? [], [state])
  const deployed = chains.filter((c) => c.status === 'deployed').length
  const days = useMemo(() => launchesPerDay(chains), [chains])
  const { ok: canLaunch, why } = useWrite('chains', 'launch a chain')
  const status: Status = state ? { tone: 'live', text: `testnet · ${PARENT.name}` } : poll.error ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }
  const unknown = poll.error ? 'unreadable' : '…'

  return (
    <>
      <ServiceHeader
        icon={Network}
        title="Chains"
        desc="Launch an Arbitrum Orbit testnet chain yourself, settling to Arbitrum Sepolia. Your wallet signs; we never hold keys."
        status={status}
        docs={docsPage()}
        page={{ href: sitePage('/chains') }}
        actions={
          <button type="button" onClick={() => setSub('launch')} disabled={!canLaunch} title={why} className={`${pillGold} min-h-11`} data-testid="launch-cta">
            <Rocket size={15} aria-hidden /> Launch a chain
          </button>
        }
        tiles={[
          { label: 'CHAINS LAUNCHED', value: state ? chains.length : null, unknown, note: 'in this workspace' },
          { label: 'DEPLOYED', value: state ? deployed : null, unknown, note: 'core contracts live' },
          { label: 'WAITING', value: state ? chains.length - deployed : null, unknown, note: 'transaction not mined yet' },
        ]}
      />

      <SubTabs items={ITEMS} value={sub} onChange={setSub} label="Chains sections" idBase="chains" />

      <SubPanel idBase="chains" value={sub}>
        {sub === 'launch' ? (
          <LaunchWizard
            onLaunched={setFresh}
            goChainKit={() => ctx.go('chain-kit')}
            onDone={() => {
              setSub('launched')
              void poll.reload()
            }}
          />
        ) : !state && !poll.error && !poll.timedOut ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading your chains">
            <Skeleton h={64} />
            <Skeleton h={64} />
          </div>
        ) : !state ? (
          <ErrorLine onRetry={() => void poll.reload()}>Your launched chains could not be read right now.</ErrorLine>
        ) : (
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
            <Section title="My chains" sub={`${chains.length} of ${state.max} · addresses and configuration only, no keys`}>
              {chains.length === 0 ? (
                <div className="relative" data-testid="chains-empty">
                  <GhostChart label="Your launched chains will be listed here" variant="bars" height={150} />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="text-[13px] text-muted">Pick a type, name it, add your validator and batch poster addresses, and deploy from your wallet.</span>
                    <button type="button" onClick={() => setSub('launch')} disabled={!canLaunch} title={why} className={pillGold}>
                      <Rocket size={15} aria-hidden /> Launch your first chain
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Launched chains">
                  {chains.map((c, i) => (
                    <ChainRow key={c.id} c={c} i={i} onChanged={setFresh} />
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Launches per day" sub="last 14 days · this workspace">
              <MiniBars bars={days} label="Chains launched per day, last 14 days" height={110} emptyLabel="Launches will draw here" />
              <p className="m-0 flex items-start gap-2 text-[12px] leading-[1.5] text-faint">
                <Blocks size={14} className="mt-[2px] shrink-0 text-gold" aria-hidden /> Want an explorer for your chain?{' '}
                <button type="button" onClick={() => ctx.go('chain-kit')} className="min-h-11 text-gold underline">
                  Request Chain Kit
                </button>
              </p>
            </Section>
          </div>
        )}
      </SubPanel>
    </>
  )
}
