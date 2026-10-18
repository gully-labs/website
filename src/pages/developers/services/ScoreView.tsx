import { BarChart3, Gauge, ListOrdered, Search } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { NF } from '../../../components/charts/number-formats'
import { bandColor, shortAddr, useJson, type ScoreIndex } from '../../score/api'
import { BandBars } from '../../score/charts'
import { ExtLink } from '../ExtLink'
import { ErrorLine, Skeleton } from '../parts'
import { input, pillGold } from '../styles'
import { useSubTab } from '../subtab'
import { SubPanel, SubTabs, type SubTabItem } from '../ui'
import { EmptyChart, HBars } from '../vcharts'
import { docsPage, sitePage } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'

/* Gully Score, in the app: every listed score (GET /api/score, every minute; the same public index the
   /score page reads), their spread by band, the methodology's weights, and a lookup that opens a
   contract's public score page in a new tab. Monitors (Security → Monitors) are what list a contract.
   A score the server could not compute is "not enough data", never 0. Two sub-tabs (charts, scores and
   lookup) keep the page inside the 900 px budget. */

const TABS = ['charts', 'scores'] as const
type Sub = (typeof TABS)[number]

export default function ScoreView() {
  const [s, retry] = useJson<ScoreIndex>('/api/score', 60_000)
  const [sub, setSub] = useSubTab<Sub>('score', TABS, 'charts', { hashOnOpen: false })
  const d = s.state === 'ok' ? s.data : null
  const pending = s.state === 'error' ? 'unreadable' : '…'
  const scored = useMemo(() => (d ? d.scores.filter((r) => r.score !== null) : []), [d])
  const avg = scored.length ? scored.reduce((a, r) => a + (r.score as number), 0) / scored.length : null
  const best = scored.length ? Math.max(...scored.map((r) => r.score as number)) : null
  const [chain, setChain] = useState('base')
  const [addr, setAddr] = useState('')
  const [bad, setBad] = useState(false)
  const lookup = (e: FormEvent) => {
    e.preventDefault()
    const a = addr.trim().toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(a)) return setBad(true)
    setBad(false)
    window.open(sitePage(`/score/${chain}/${a}`), '_blank', 'noopener,noreferrer')
  }
  const status: Status = d ? { tone: 'live', text: `${d.scores.length} listed` } : s.state === 'error' ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }

  const items: SubTabItem<Sub>[] = [
    { id: 'charts', label: 'Bands and weights', icon: <BarChart3 size={15} aria-hidden /> },
    { id: 'scores', label: 'Scores and lookup', icon: <ListOrdered size={15} aria-hidden />, count: d ? d.scores.length : null },
  ]

  return (
    <>
      <ServiceHeader
        icon={Gauge}
        title="Gully Score"
        desc="A 0 to 100 reading of how a contract is controlled and how it has behaved, from public evidence only. Missing data is left out, never counted as zero."
        status={status}
        docs={docsPage('gully-score')}
        page={{ href: sitePage('/score') }}
        tiles={[
          { label: 'LISTED', value: d?.scores.length, unknown: pending, note: 'contracts with a public score' },
          { label: 'AVERAGE', value: avg, format: NF.int, unknown: d ? 'none scored yet' : pending, note: d ? `${scored.length} with enough data` : 'of scored contracts' },
          { label: 'HIGHEST', value: best, format: NF.int, unknown: d ? 'none scored yet' : pending, tone: best === null ? undefined : bandColor(best), note: 'out of 100' },
          { label: 'CHAINS', value: d?.chains.length, unknown: pending, note: d ? d.chains.map((c) => c.name).join(', ') : 'scored' },
        ]}
      />

      <SubTabs items={items} value={sub} onChange={setSub} label="Gully Score sections" idBase="score" />

      {s.state === 'error' && <ErrorLine onRetry={retry}>Gully Score could not be read just now: {s.error}</ErrorLine>}

      <SubPanel idBase="score" value={sub}>
      {sub === 'charts' ? (
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section title="Listed contracts by band" sub="live from /api/score, every minute">
          {!d ? (
            <Skeleton h={200} />
          ) : d.scores.length ? (
            <BandBars rows={d.scores} />
          ) : (
            <EmptyChart height={200} title="No listed score yet">
              Watch a contract in Security → Monitors (listing on) and its score charts here.
            </EmptyChart>
          )}
        </Section>
        <Section title="What a score weighs" sub="the methodology's weights, live">
          {!d ? <Skeleton h={200} /> : <HBars rows={d.methodology.components.map((c) => ({ name: c.label, value: c.weight, note: c.source }))} unit="%" rowH={24} label={`Score weights: ${d.methodology.components.map((c) => `${c.label} ${c.weight}%`).join(', ')}.`} />}
        </Section>
      </div>
      ) : (
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section title="Listed scores" sub="each opens its public score page in a new tab">
          {!d ? (
            <Skeleton h={120} />
          ) : d.scores.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {d.scores.slice(0, 8).map((r) => (
                <li key={`${r.chainKey}:${r.address}`}>
                  <ExtLink href={sitePage(`/score/${r.chainKey}/${r.address}`)} className="flex min-h-11 items-center gap-3 rounded-[10px] px-2 text-[13px] text-ink-2 hover:bg-surface-hover">
                    <span className="w-10 font-display text-[20px] font-bold" style={{ color: bandColor(r.score) }}>
                      {r.score ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.name ?? r.symbol ?? shortAddr(r.address)}</span>
                    <span className="font-mono text-[11px] text-faint">{r.chainName}</span>
                  </ExtLink>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyChart height={120} title="Nothing listed yet" />
          )}
        </Section>
        <Section title="Look up a contract" sub="any contract on a scored chain">
          <form onSubmit={lookup} className="flex flex-col gap-2" aria-label="Look up a contract's Gully Score">
            <select value={chain} onChange={(e) => setChain(e.target.value)} className={`${input} h-11`} aria-label="Chain">
              {(d?.chains ?? [{ key: 'base', name: 'Base', id: 8453 }]).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} className={`${input} h-11`} placeholder="0x… contract address" aria-label="Contract address" aria-invalid={bad} spellCheck={false} />
            {bad && <span className="text-[12px] text-error">That is not a contract address (0x and 40 hex characters).</span>}
            <button type="submit" className={`${pillGold} min-h-11 w-fit`}>
              <Search size={14} aria-hidden /> Open its score <span className="sr-only">(opens in a new tab)</span>
            </button>
          </form>
        </Section>
      </div>
      )}
      </SubPanel>
    </>
  )
}
