import { fmtTime, nameOf, type Stats } from '../../lib/stats'
import { Figure } from './Figure'
import { LedgerChart } from './LedgerChart'

/* The hero's ledger card: three combined figures that count up, then the venues' daily value locked,
   volume or fees (LedgerChart). Everything is read from /api/stats (useStats, polled every minute);
   nothing here is sample data. */

type State = 'loading' | 'error' | 'ok'

/** What the figure adds up, in words: the venues it sums and why each other one is left out. */
function coverage(data: Stats | null, cover: string[] | undefined): string {
  if (!data || !cover) return ''
  const left = data.venues.filter((v) => !cover.includes(v.key)).map((v) => `${nameOf(v.key)} (${v.state === 'error' ? 'could not be read' : 'does not publish it'})`)
  return `Adds up ${cover.map(nameOf).join(', ') || 'no venue'}.${left.length ? ` Left out: ${left.join('; ')}.` : ''}`
}

function Kpi({ label, short, span, value, cover, of, hint, state }: { label: string; short?: string; span?: string; value: number | null | undefined; cover?: string[]; of: number; hint?: string; state: State }) {
  const shown = state === 'ok' && value !== null && value !== undefined
  return (
    <div className="flex min-w-0 flex-col gap-[2px] border-r border-line px-4 py-3 last:border-r-0 max-[459px]:px-3">
      <span className="truncate font-mono text-[11px] tracking-[1px] text-faint">
        {short ? (
          <>
            <span className="max-[459px]:hidden">{label}</span>
            <abbr title={label} className="no-underline min-[460px]:hidden">
              {short}
            </abbr>
          </>
        ) : (
          label
        )}
      </span>
      <b className={`font-display text-[30px] leading-none font-bold max-[459px]:text-[22px] ${shown ? 'text-ink' : 'text-dim'}`}>
        {shown ? <Figure value={value} /> : state === 'error' ? 'unreadable' : '—'}
      </b>
      <span className="truncate font-mono text-[11px] text-faint" title={hint || undefined}>
        {state === 'loading' ? 'reading…' : state === 'error' ? 'could not be read' : cover?.length ? (
          <>
            {span && <span className="max-[459px]:hidden">{span} · </span>}
            {cover.length}/{of} venues
          </>
        ) : (
          'not published'
        )}
      </span>
    </div>
  )
}

export function HeroLedger({ data, state }: { data: Stats | null; state: State }) {
  const T = data?.totals
  // The denominator is the venues in the document, so a fraction always counts the same venues as the sum.
  const N = data?.venues.length ?? 0
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-line bg-surface transition-[border-color] duration-300 hover:border-line-strong">
      {/* Provenance first: where these figures come from, and when they were read. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2 font-mono text-[11px] text-faint">
        <span className="inline-flex items-center gap-2 text-ink-2">
          <span aria-hidden className="size-[6px] flex-none rounded-full bg-green" style={{ animation: 'gl-pulse-ring 1.8s infinite' }} />
          LIVE LEDGER · VENUE APIS + DEFILLAMA
        </span>
        <span>{data ? `read ${fmtTime(data.generatedAt)}` : state === 'error' ? 'could not be read' : 'reading…'}</span>
      </div>
      <div className="grid grid-cols-3 border-b border-line">
        <Kpi label="VALUE LOCKED" short="TVL" value={T?.tvlUsd} cover={T?.covers.tvlUsd} of={N} hint={coverage(data, T?.covers.tvlUsd)} state={state} />
        <Kpi label="VOLUME" span="all-time" value={T?.volumeAllUsd} cover={T?.covers.volumeAllUsd} of={N} hint={coverage(data, T?.covers.volumeAllUsd)} state={state} />
        <Kpi label="FEES" span="all-time" value={T?.feesAllUsd} cover={T?.covers.feesAllUsd} of={N} hint={coverage(data, T?.covers.feesAllUsd)} state={state} />
      </div>
      <LedgerChart data={data} state={state} />
    </div>
  )
}
