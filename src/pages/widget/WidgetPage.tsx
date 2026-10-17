import { History } from 'lucide-react'
import { NewTabMark } from '../../components/LayoutLinks'
import { newTab } from '../../components/LayoutNav'
import { GapHistory } from '../../components/tracker/GapHistory'
import { useMemo, useState, type ReactNode } from 'react'
import { Seo } from '../../components/Seo'
import { eyebrow } from '../../components/ui'
import { CodeBlock } from '../../docs/CodeBlock'
import { CHAIN_NAME, CHAIN_SHORT, useTracker } from '../../lib/tracker'
import { widgetSnippet, type WidgetOptions, type WidgetTheme, type WidgetType } from '../../lib/widgetEmbed'
import { LiveWidget } from './LiveWidget'

const DOCS = 'https://docs.gullylabs.xyz/widget'
const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.06}s ease both` })
const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-7 max-[600px]:p-5'

const TYPES: { key: WidgetType; name: string; note: string }[] = [
  { key: 'ticker', name: 'Ticker', note: 'A scrolling strip: ticker, price, gap. Pauses on hover.' },
  { key: 'badge', name: 'Badge', note: 'One stock against its fair price.' },
  { key: 'table', name: 'Table', note: 'The widest gaps, pools deep enough to trust only.' },
]
const LIMITS: Record<Exclude<WidgetType, 'badge'>, number[]> = { ticker: [0, 5, 10, 20], table: [3, 5, 10, 15, 20] }

function Field({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  const cls = 'font-mono text-[11px] tracking-[1px] text-faint'
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {id ? (
        <label htmlFor={id} className={cls}>
          {label}
        </label>
      ) : (
        <span className={cls}>{label}</span>
      )}
      {children}
    </div>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full flex-wrap gap-1 rounded-input border border-line bg-surface-deep p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`min-h-10 flex-1 rounded-btn px-3 font-mono text-[12px] whitespace-nowrap transition-colors ${value === o.key ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

const select =
  'min-h-11 w-full rounded-input border border-line-strong bg-surface-deep px-3 font-mono text-[13px] text-ink transition-colors hover:border-line-hover focus:border-gold disabled:opacity-60'

/* The embed builder: every option the script reads, a live preview running the real widget.js against
   this site's API, and the snippet to paste. */
export function WidgetPage() {
  const st = useTracker()
  const data = st.k === 'ok' ? st.data : null
  const [type, setType] = useState<WidgetType>('ticker')
  const [chain, setChain] = useState('all')
  const [ticker, setTicker] = useState<string | null>(null)
  const [theme, setTheme] = useState<WidgetTheme>('dark')
  const [limits, setLimits] = useState({ ticker: 0, table: 5 })

  const chains = data?.chains ?? []
  // A badge names one stock, so it names its chain; the other two may span every chain.
  const chainOptions = [...(type === 'badge' ? [] : [{ key: 'all', name: 'All chains' }]), ...chains.map((c) => ({ key: c.key, name: CHAIN_SHORT[c.key] ?? c.name }))]
  const effChain = type === 'badge' && chain === 'all' ? (chains[0]?.key ?? 'robinhood') : chain
  const stocks = useMemo(() => (data ? data.rows.filter((r) => r.chain === effChain).sort((a, b) => a.ticker.localeCompare(b.ticker)) : []), [data, effChain])
  // Default stock: the deepest pool on the chain, so the first preview shows a real, liquid token.
  const deepest = [...stocks].sort((a, b) => (b.pool?.liquidityUsd ?? 0) - (a.pool?.liquidityUsd ?? 0))[0]
  const effTicker = ticker && stocks.some((s) => s.ticker === ticker) ? ticker : (deepest?.ticker ?? null)

  const options: WidgetOptions = {
    type,
    chain: effChain,
    ticker: type === 'badge' ? (effTicker ?? undefined) : undefined,
    theme,
    limit: type === 'badge' ? undefined : limits[type],
  }
  const snippet = widgetSnippet(options)
  // The chart follows the badge's stock, or the deepest pool on the chain for the ticker and table.
  const chartPool = data ? (effChain === 'all' ? data.rows : data.rows.filter((r) => r.chain === effChain)) : []
  const chartRow = type === 'badge' ? stocks.find((s) => s.ticker === effTicker) : [...chartPool].sort((a, b) => (b.pool?.liquidityUsd ?? 0) - (a.pool?.liquidityUsd ?? 0))[0]
  const ready = type !== 'badge' || !!effTicker

  return (
    <>
      <Seo title="Tracker widget" description="Embed the Gully Labs stock token tracker on any page: a live ticker, a one-stock badge or a table of the widest gaps, read from Chainlink and the pools themselves." />

      <section className="flex flex-col gap-5 px-page pt-[64px] pb-10">
        <span className={eyebrow} style={rise(0)}>
          WIDGET · EMBED THE TRACKER
        </span>
        <h1 className="m-0 max-w-[900px] font-display text-h1 font-extrabold uppercase" style={rise(1)}>
          Put the live gap <span className="text-gold">on your page</span>
        </h1>
        <p className="m-0 max-w-[720px] text-[18px] leading-[1.55] text-muted" style={rise(2)}>
          One script tag and one element. Every figure is read live from the tracker, refreshed every minute, and drawn inside its own shadow root so it never clashes with your styles.
        </p>
      </section>

      <section className="grid grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start gap-5 px-page pb-[96px] max-[960px]:grid-cols-1">
        <div className={card} style={rise(3)}>
          <h2 className="m-0 font-display text-h4 font-bold uppercase">Build it</h2>

          <Field label="TYPE">
            <Segmented label="Widget type" value={type} options={TYPES} onChange={setType} />
            <span className="text-[13px] text-muted">{TYPES.find((t) => t.key === type)?.note}</span>
          </Field>

          <Field label="CHAIN">
            {st.k === 'ok' ? (
              <Segmented label="Chain" value={effChain} options={chainOptions} onChange={setChain} />
            ) : (
              <span className={`font-mono text-[12px] ${st.k === 'error' ? 'text-error' : 'text-faint'}`}>{st.k === 'error' ? 'The tracker could not be read; the chains appear when it answers.' : 'Reading the tracker…'}</span>
            )}
          </Field>

          {type === 'badge' && (
            <Field label="STOCK" id="widget-stock">
              <select id="widget-stock" className={select} value={effTicker ?? ''} disabled={!stocks.length} onChange={(e) => setTicker(e.target.value)}>
                {!stocks.length && <option value="">{st.k === 'error' ? 'Unavailable' : 'Loading…'}</option>}
                {stocks.map((s) => (
                  <option key={s.ticker} value={s.ticker}>
                    {s.ticker} · {s.name}
                  </option>
                ))}
              </select>
              {data && (
                <span className="text-[13px] text-muted">
                  {stocks.length} stocks tracked on {CHAIN_NAME[effChain] ?? effChain}.
                </span>
              )}
            </Field>
          )}

          <Field label="THEME">
            <Segmented
              label="Theme"
              value={theme}
              options={[
                { key: 'dark', name: 'Dark' },
                { key: 'light', name: 'Light' },
              ]}
              onChange={setTheme}
            />
          </Field>

          {type !== 'badge' && (
            <Field label={type === 'ticker' ? 'STOCKS IN THE STRIP' : 'ROWS'}>
              <Segmented
                label={type === 'ticker' ? 'Stocks in the strip' : 'Rows'}
                value={String(limits[type])}
                options={LIMITS[type].map((n) => ({ key: String(n), name: n === 0 ? 'All' : String(n) }))}
                onChange={(v) => setLimits((l) => ({ ...l, [type]: Number(v) }))}
              />
            </Field>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5" style={rise(4)}>
          <div className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="m-0 font-display text-h4 font-bold uppercase">Live preview</h2>
              <span className="font-mono text-[12px] text-faint">the real widget.js, live data</span>
            </div>
            <div className={`grid min-h-[140px] place-items-center rounded-[10px] border border-line p-6 transition-colors duration-300 max-[600px]:p-3 ${theme === 'light' ? 'bg-ink' : 'bg-bg'}`}>
              <div className={`w-full min-w-0 ${type === 'badge' ? 'max-w-[340px]' : ''}`}>
                {ready ? (
                  <LiveWidget options={options} />
                ) : (
                  <p className={`m-0 text-center font-mono text-[12px] ${st.k === 'error' ? 'text-error' : 'text-faint'}`}>{st.k === 'error' ? 'No stock list: the tracker could not be read.' : 'Waiting for the stock list…'}</p>
                )}
              </div>
            </div>
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="m-0 inline-flex items-center gap-2 font-display text-h4 font-bold uppercase">
                <History aria-hidden size={18} className="text-gold" />
                {chartRow ? `${chartRow.ticker} gap history` : 'Gap history'}
              </h2>
              <span className="font-mono text-[12px] text-faint">{chartRow ? `${CHAIN_NAME[chartRow.chain] ?? chartRow.chain} · live from /api/tracker/history` : 'live from /api/tracker/history'}</span>
            </div>
            {chartRow && data ? (
              <GapHistory chain={chartRow.chain} ticker={chartRow.ticker} inLinePct={data.rules.inLinePct} />
            ) : (
              <div aria-hidden className="h-[260px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[10px] bg-surface-deep" />
            )}
            <span className="text-[13px] leading-[1.5] text-muted">{type === 'badge' ? 'The stock in your badge, over time.' : 'The deepest pool on the chosen chain, over time. Pick Badge to chart any stock.'}</span>
          </div>

          <div className={card}>
            <div className="flex flex-col gap-1">
              <h2 className="m-0 font-display text-h4 font-bold uppercase">Paste it</h2>
              <span className="text-[14px] leading-[1.5] text-muted">Anywhere in your page’s HTML. The script tag goes once per page, however many widgets you add.</span>
            </div>
            <CodeBlock code={snippet} lang="html" caption="YOUR PAGE · HTML" wrap />
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-4 p-0 text-[14px] leading-[1.5] text-muted">
              <li>
                <span className="block font-mono text-[11px] tracking-[1px] text-gold">LIVE</span>
                Chainlink fair price against the deepest pool, refreshed every minute.
              </li>
              <li>
                <span className="block font-mono text-[11px] tracking-[1px] text-gold">LIGHT</span>
                No dependencies. One request per page, however many widgets.
              </li>
              <li>
                <span className="block font-mono text-[11px] tracking-[1px] text-gold">FREE</span>
                Free to embed. The small link back to the tracker stays.
              </li>
            </ul>
            <a href={DOCS} {...newTab} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] font-medium text-ink transition-colors hover:border-gold hover:text-ink">
              Every option in the docs <NewTabMark size={15} />
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
