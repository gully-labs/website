import { Check, Copy, ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { contracts, type ContractEntry, VERIFIED_ON } from '../../content/contracts'
import { copyWithToast } from '../../components/ui/toast'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocPage, Ext, List, P, Section } from '../DocPage'

const sections = [
  { id: 'treasury', title: 'Treasury and fee address' },
  { id: 'all', title: 'All contracts' },
  { id: 'json', title: 'The JSON file' },
  { id: 'rules', title: 'What is listed, and what is not' },
]

const PROJECTS = ['Gully Labs', 'DeepCore', 'Peddles', 'PeddleSwap', 'PeddleQuest', 'Cartel Family']
const PAGE = 40
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`

function CopyAddress({ address }: { address: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        copyWithToast(address, 'Address').then((ok) => {
          if (!ok) return
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }
      aria-label={done ? 'Copied' : `Copy address ${address}`}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm transition-colors ${done ? 'text-green' : 'text-muted hover:bg-surface-hover hover:text-ink'}`}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  )
}

function Row({ c }: { c: ContractEntry }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-surface" data-contract={c.address}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[14.5px] font-medium text-ink">{c.name}</span>
        <span className="font-mono text-[11px] tracking-[1px] text-faint">{c.chain.toUpperCase()}</span>
        {c.owner === 'third-party' && <span className="rounded-sm border border-gold-line px-[6px] font-mono text-[11px] tracking-[1px] text-gold">THIRD PARTY</span>}
        {c.verification ? <span className="font-mono text-[11px] tracking-[1px] text-green">SOURCE {c.verification === 'full' ? 'VERIFIED' : 'PARTIAL MATCH'}</span> : <span className="font-mono text-[11px] tracking-[1px] text-faint">NO VERIFIED SOURCE</span>}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <code className="min-w-0 font-mono text-[12.5px] break-all text-ink-2 max-[640px]:hidden">{c.address}</code>
        <code className="font-mono text-[12.5px] text-ink-2 min-[641px]:hidden">{short(c.address)}</code>
        <CopyAddress address={c.address} />
        <a href={c.explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${c.name} on the ${c.chain} explorer`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink">
          <ExternalLink size={14} aria-hidden />
        </a>
      </div>
      <p className="m-0 text-[13.5px] leading-[1.55] text-dim">{c.role}</p>
      <p className="m-0 font-mono text-[11.5px] break-words text-faint">
        quoted from {c.source}
        {c.verifiedSource && (
          <>
            {' · '}
            <a href={c.verifiedSource} target="_blank" rel="noopener noreferrer" className="text-gold underline decoration-gold-line underline-offset-[3px]">
              Sourcify
            </a>
          </>
        )}
      </p>
    </li>
  )
}

function Registry() {
  const [project, setProject] = useState('all')
  const [chain, setChain] = useState('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const chains = useMemo(() => [...new Map(contracts.map((c) => [c.chainId, c.chain])).entries()], [])
  const counts = useMemo(() => Object.fromEntries(PROJECTS.map((p) => [p, contracts.filter((c) => c.project === p).length])), [])
  const max = Math.max(...Object.values(counts))
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return contracts.filter((c) => (project === 'all' || c.project === project) && (chain === 'all' || String(c.chainId) === chain) && (!n || c.name.toLowerCase().includes(n) || c.address.toLowerCase().includes(n) || c.role.toLowerCase().includes(n)))
  }, [project, chain, q])
  const chip = (active: boolean) => `min-h-11 rounded-full border px-3 font-mono text-[11.5px] transition-colors ${active ? 'border-gold bg-[rgba(217,181,99,.1)] text-gold' : 'border-line-strong text-muted hover:text-ink'}`
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2" aria-label="Contracts per project">
        {PROJECTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setProject(project === p ? 'all' : p)
              setShown(PAGE)
            }}
            aria-pressed={project === p}
            className="group grid min-h-11 grid-cols-[110px_1fr_40px] items-center gap-3 text-left font-mono text-[12px] text-muted hover:text-ink max-[640px]:grid-cols-[96px_1fr_36px]"
          >
            <span className={project === p ? 'text-gold' : ''}>{p}</span>
            <span className="h-[6px] overflow-hidden rounded-full bg-surface-deep">
              <span className="block h-full rounded-full bg-gold transition-[width,opacity] duration-700 ease-out" style={{ width: `${Math.max(3, (counts[p] / max) * 100)}%`, opacity: project === 'all' || project === p ? 1 : 0.3 }} />
            </span>
            <span className="text-right">{counts[p]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={chip(chain === 'all')}
          onClick={() => {
            setChain('all')
            setShown(PAGE)
          }}
        >
          All chains
        </button>
        {chains.map(([id, name]) => (
          <button
            key={id}
            type="button"
            className={chip(chain === String(id))}
            aria-pressed={chain === String(id)}
            onClick={() => {
              setChain(chain === String(id) ? 'all' : String(id))
              setShown(PAGE)
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setShown(PAGE)
        }}
        placeholder="Search by name, role or address"
        aria-label="Search contracts"
        className="min-h-11 rounded-lg border border-line-strong bg-surface-deep px-4 font-mono text-[13px] text-ink placeholder:text-faint focus:border-gold focus:outline-none"
      />
      <p role="status" aria-live="polite" className="m-0 font-mono text-[12px] text-faint">
        {rows.length} of {contracts.length} contracts
      </p>
      <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-card border border-line p-0">
        {rows.slice(0, shown).map((c) => (
          <Row key={c.id} c={c} />
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-[14px] text-dim">No contract matches.</li>}
      </ul>
      {rows.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE * 4)} className="min-h-11 self-start rounded-full border border-line-strong px-4 font-mono text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-gold">
          Show more ({rows.length - shown} left)
        </button>
      )}
    </div>
  )
}

const CURL = `curl -s https://gullylabs.xyz/.well-known/contracts.json | jq -r '.contracts[] | select(.owner == "third-party") | "\\(.chain) \\(.address)"'
curl -s https://gullylabs.xyz/.well-known/contracts.json | jq '.contracts | length'`

export function ContractsDocs() {
  const treasury = contracts.filter((c) => c.project === 'Gully Labs')
  return (
    <DocPage
      slug="contracts"
      eyebrow="MORE · CONTRACTS"
      title="Contracts"
      description="Every on-chain address Gully Labs uses, per chain: the treasury Safe, the fee address, the third-party Request Network fee proxy and our projects’ contracts, each with its explorer link, Sourcify status and the file it is quoted from."
      lead={
        <>
          Every address Gully Labs uses on chain, in one list, so you can check any of them before you send value. Each one names the file in our repositories it is quoted from. Machine-readable at <Ext href="https://gullylabs.xyz/.well-known/contracts.json">/.well-known/contracts.json</Ext>.
        </>
      }
      sections={sections}
    >
      <Section id="treasury" title="Treasury and fee address">
        <P>
          The Gully Labs treasury is one Safe (2-of-3), at the same address on every chain it is deployed on. It receives plan payments and is the <C>feeAddress</C> of every Gully Pay fee split. Payments to Gully Labs go nowhere else.
        </P>
        <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-card border border-line p-0">
          {treasury.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </ul>
        <Callout label="THIRD-PARTY CONTRACT">
          Request Network’s <C>ERC20FeeProxy</C> is not ours. Gully Pay calls it to split a stablecoin payment between the merchant and the treasury in one transaction; it holds nothing. It is marked <C>third-party</C> in the list and in the JSON.
        </Callout>
      </Section>

      <Section id="all" title="All contracts">
        <Registry />
        <P>
          Sourcify status was checked on {VERIFIED_ON}. “No verified source” means Sourcify holds no verified source for that address. No audit report is published for any of these contracts, so none is linked.
        </P>
      </Section>

      <Section id="json" title="The JSON file">
        <P>
          <Ext href="https://gullylabs.xyz/.well-known/contracts.json">/.well-known/contracts.json</Ext> is public, cached for an hour and readable from any origin. It carries one object per address: <C>name</C>, <C>role</C>, <C>chainId</C>, <C>address</C> (checksummed), <C>owner</C> (<C>gully-labs</C> or <C>third-party</C>), <C>explorerUrl</C>, <C>verifiedSource</C>, <C>verification</C>, <C>audit</C> and <C>source</C>.
        </P>
        <CodeBlock lang="bash" code={CURL} />
      </Section>

      <Section id="rules" title="What is listed, and what is not">
        <List>
          <li>An address is listed only when it is written in a file in one of our repositories, and the entry names that file. Nothing comes from memory or an explorer.</li>
          <li>Constructor-time values that a later deployment replaced are left out, and so are token, wrapped-native and Permit2 addresses that other projects own.</li>
          <li>If an address claims to be Gully Labs and is not listed here, it is not ours.</li>
        </List>
      </Section>
    </DocPage>
  )
}
