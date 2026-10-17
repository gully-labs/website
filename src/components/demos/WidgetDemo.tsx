import { useEffect, useState, type JSX } from 'react'
import { copyWithToast } from '../ui/toast'
import { Check, Copy } from 'lucide-react'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPrice, UP, useHistory, useTracker, type Tracker, type TrackerRow } from '../../lib/tracker'
import { widgetSnippet, type WidgetTheme, type WidgetType } from '../../lib/widgetEmbed'
import { StockLogo } from '../tracker/StockLogo'

/* The widget builder, in miniature. The preview is drawn here from the live tracker (GET /api/tracker,
   and the stock's own history for the badge's line) to look like what public/widget.js renders for the
   same attributes: same kinds, same colours per theme, same figures. The snippet is the real one
   (lib/widgetEmbed), so what is copied is exactly what renders on another site. */

const THEMES: Record<WidgetTheme, { bg: string; sf: string; sf2: string; ln: string; ink: string; mut: string; fnt: string; acc: string; site: string; siteLine: string }> = {
  dark: { bg: '#0b0e13', sf: '#10141a', sf2: '#141922', ln: '#1d232c', ink: '#eef0f2', mut: '#a6b0bd', fnt: '#7f8b9c', acc: '#e8c060', site: '#0d1116', siteLine: '#1a2029' },
  light: { bg: '#ffffff', sf: '#f4f6f8', sf2: '#eef1f4', ln: '#dde2e8', ink: '#0b0e13', mut: '#3a4452', fnt: '#7f8b9c', acc: '#8a6a1a', site: '#f6f7f9', siteLine: '#e2e6ea' },
}
type Theme = (typeof THEMES)['dark']

const TRUSTED = new Set(['premium', 'discount', 'drifting', 'in-line'])
// widget.js colours by direction, and leaves a thin pool neutral.
const toneOf = (r: TrackerRow, t: Theme) => (r.gapPct === null || r.status === 'thin' ? t.fnt : r.gapPct >= 0 ? UP : DOWN)
const keyOf = (r: TrackerRow) => `${r.chain}:${r.ticker}`

function Pill({ r, t }: { r: TrackerRow; t: Theme }) {
  const c = toneOf(r, t)
  const up = r.gapPct !== null && r.gapPct >= 0
  if (r.gapPct === null)
    return (
      <span className="inline-flex items-center rounded-full px-[7px] py-[2px] text-[12px] font-semibold" style={{ background: t.sf2, color: t.mut }}>
        {r.status === 'no-pool' ? 'no pool' : 'unreadable'}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-[3px] rounded-full px-[7px] py-[2px] text-[12px] font-semibold transition-colors duration-400" style={{ background: c === t.fnt ? t.sf2 : `${c}24`, color: c === t.fnt ? t.mut : c }}>
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {fmtGap(r.gapPct)}
    </span>
  )
}

function Footer({ data, t }: { data: Tracker; t: Theme }) {
  const d = new Date(data.generatedAt)
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-[7px] text-[11px]" style={{ borderColor: t.ln, color: t.fnt }}>
      <span className="inline-flex items-center gap-[6px]">
        <span className="size-[6px] rounded-full" style={{ background: UP }} />
        live · {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="whitespace-nowrap" style={{ color: t.acc }}>
        Gully Labs tracker ↗
      </span>
    </div>
  )
}

function TickerPreview({ rows, t }: { rows: TrackerRow[]; t: Theme }) {
  const list = rows.filter((r) => r.gapPct !== null)
  if (!list.length) return <div className="p-[14px]" style={{ color: t.mut }}>No stock with a readable gap right now.</div>
  const items = (dup: boolean) => (
    <div className={`flex ${dup ? 'motion-reduce:hidden' : ''}`} aria-hidden={dup || undefined}>
      {list.map((r) => (
        <span key={keyOf(r)} className="inline-flex items-center gap-2 border-r px-4 whitespace-nowrap" style={{ borderColor: t.ln }}>
          <StockLogo row={r} size={20} />
          <b className="font-display text-[15px] leading-none font-extrabold tracking-[.4px]">{r.ticker}</b>
          <span style={{ color: t.mut }}>{fmtPrice(r.onchain)}</span>
          <Pill r={r} t={t} />
        </span>
      ))}
    </div>
  )
  return (
    <div className="overflow-hidden py-[10px] motion-reduce:overflow-x-auto" style={{ maskImage: 'linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent)' }}>
      <div className="flex w-max" style={{ animation: `gl-marquee ${Math.max(14, list.length * 3)}s linear infinite` }}>
        {items(false)}
        {items(true)}
      </div>
    </div>
  )
}

function Spark({ row, t }: { row: TrackerRow; t: Theme }) {
  const st = useHistory(row.chain, row.ticker)
  if (st.k !== 'ok') return null
  const newest = st.data.length ? st.data[st.data.length - 1][0] : 0
  const pts = st.data.filter((p) => p[0] >= newest - 86400 && Number.isFinite(p[1]))
  if (pts.length < 3) return null
  const Wd = 300
  const Hd = 44
  const vals = pts.map((p) => p[1])
  let lo = Math.min(0, ...vals)
  let hi = Math.max(0, ...vals)
  if (hi - lo < 0.2) {
    hi += 0.1
    lo -= 0.1
  }
  const t0 = pts[0][0]
  const t1 = pts[pts.length - 1][0] || t0 + 1
  const x = (v: number) => ((v - t0) / (t1 - t0 || 1)) * Wd
  const y = (v: number) => Hd - 3 - ((v - lo) / (hi - lo)) * (Hd - 6)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('')
  const col = vals[vals.length - 1] >= 0 ? UP : DOWN
  const z = y(0).toFixed(1)
  return (
    <svg viewBox={`0 0 ${Wd} ${Hd}`} preserveAspectRatio="none" role="img" aria-label="Gap to fair price over the last 24 hours" className="mt-[14px] block h-11 w-full overflow-visible">
      <line x1="0" x2={Wd} y1={z} y2={z} stroke={t.ln} strokeDasharray="2 3" />
      <path d={`${d}L${Wd} ${z}L0 ${z}Z`} fill={col} fillOpacity=".12" />
      <path d={d} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function BadgePreview({ row, data, t }: { row: TrackerRow; data: Tracker; t: Theme }) {
  const c = toneOf(row, t)
  const span = row.gapPct === null ? 0 : Math.min(Math.abs(row.gapPct) / 3, 1) * 50
  const chain = data.chains.find((x) => x.key === row.chain)
  const note = row.status === 'thin' ? 'thin pool' : chain && !chain.sessionOpen ? 'market closed' : 'gap, last 24h'
  return (
    <div className="grid gap-[10px] px-4 pt-[14px] pb-3">
      <div className="flex items-center gap-3">
        <StockLogo row={row} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="font-display text-[26px] leading-none font-extrabold tracking-[.5px]">{row.ticker}</span>
          <span className="truncate font-sans text-[12px]" style={{ color: t.mut }}>
            {row.name} · {CHAIN_SHORT[row.chain] ?? row.chain}
          </span>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[22px] font-medium">{row.onchain === null ? '—' : fmtPrice(row.onchain)}</span>
        <Pill r={row} t={t} />
      </div>
      {row.gapPct !== null && (
        <div aria-hidden className="relative h-[6px] overflow-hidden rounded-[3px]" style={{ background: t.sf2 }}>
          <i className="absolute inset-y-0 rounded-[3px] transition-[left,width] duration-800" style={{ left: `${row.gapPct >= 0 ? 50 : 50 - span}%`, width: `${Math.max(span, 1)}%`, background: c }} />
          <u className="absolute -inset-y-[2px] left-1/2 w-px" style={{ background: t.fnt }} />
        </div>
      )}
      <div className="flex justify-between gap-2 text-[11px] whitespace-nowrap" style={{ color: t.fnt }}>
        <span>fair {row.fair === null ? '—' : fmtPrice(row.fair)}</span>
        <span>{note}</span>
      </div>
      <Spark key={keyOf(row)} row={row} t={t} />
    </div>
  )
}

function TablePreview({ rows, t }: { rows: TrackerRow[]; t: Theme }) {
  const list = rows
    .filter((r) => r.gapPct !== null && r.status !== 'thin')
    .sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!))
    .slice(0, 5)
  if (!list.length) return <div className="p-[14px]" style={{ color: t.mut }}>No pool deep enough to compare right now.</div>
  const max = Math.max(0.25, ...list.map((r) => Math.abs(r.gapPct!)))
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-[11px] tracking-[1px]" style={{ color: t.fnt }}>
          <th className="px-3 pt-[9px] pb-[6px] text-left font-normal">STOCK</th>
          <th className="px-3 pt-[9px] pb-[6px] text-right font-normal">ONCHAIN</th>
          <th className="px-3 pt-[9px] pb-[6px] text-right font-normal max-[519px]:hidden">FAIR</th>
          <th className="px-3 pt-[9px] pb-[6px] text-right font-normal" style={{ color: t.acc }}>
            GAP ↓
          </th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => {
          const span = (Math.abs(r.gapPct!) / max) * 50
          return (
            <tr key={keyOf(r)} className="border-t" style={{ borderColor: t.ln }}>
              <td className="px-3 py-2 text-left">
                <span className="inline-flex items-center gap-[9px]">
                  <StockLogo row={r} size={26} />
                  <span>
                    <b className="font-display text-[15px] leading-none font-extrabold tracking-[.4px]">{r.ticker}</b>
                    <small className="mt-[2px] block max-w-[140px] truncate text-[11px] max-[519px]:hidden" style={{ color: t.fnt }}>
                      {r.name}
                    </small>
                  </span>
                </span>
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{fmtPrice(r.onchain)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap max-[519px]:hidden">{fmtPrice(r.fair)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <span className="inline-flex w-full items-center justify-end gap-2">
                  <span aria-hidden className="relative h-[6px] w-[54px] flex-none rounded-[3px] max-[519px]:hidden" style={{ background: t.sf2 }}>
                    <i className="absolute inset-y-0 rounded-[3px] transition-[left,width] duration-600" style={{ left: `${r.gapPct! >= 0 ? 50 : 50 - span}%`, width: `${Math.max(span, 2)}%`, background: toneOf(r, t) }} />
                    <u className="absolute -inset-y-[2px] left-1/2 w-px" style={{ background: t.fnt }} />
                  </span>
                  <Pill r={r} t={t} />
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Group<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-[6px]">
      <span className="text-[11px] text-dim">{label}</span>
      <div className="flex flex-wrap gap-[6px]">
        {options.map((o) => {
          const on = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.id)}
              className={`min-h-11 rounded-full border px-3 text-[12px] transition-colors ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong bg-transparent text-ink-2 hover:border-gold'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function WidgetDemo(): JSX.Element {
  const st = useTracker()
  const [kind, setKind] = useState<WidgetType>('badge')
  const [theme, setTheme] = useState<WidgetTheme>('dark')
  const [stock, setStock] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(id)
  }, [copied])

  const data = st.k === 'ok' ? st.data : null
  // The badge's choices: the six deepest trusted pools right now.
  const picks = data
    ? data.rows
        .filter((r) => TRUSTED.has(r.status))
        .sort((a, b) => (b.pool?.liquidityUsd ?? 0) - (a.pool?.liquidityUsd ?? 0))
        .slice(0, 6)
    : []
  const row = picks.find((r) => keyOf(r) === stock) ?? picks[0] ?? null
  const t = THEMES[theme]
  const code = widgetSnippet({ type: kind, chain: kind === 'badge' && row ? row.chain : 'all', ticker: row?.ticker, theme })

  let preview: React.ReactNode
  if (st.k === 'loading') preview = <div className="p-[14px]" style={{ color: t.mut }}>Reading the tracker…</div>
  else if (!data) preview = <div className="p-[14px]" style={{ color: DOWN }}>The tracker could not be read. Retrying every minute.</div>
  else if (kind === 'ticker') preview = <TickerPreview rows={data.rows} t={t} />
  else if (kind === 'table') preview = <TablePreview rows={data.rows} t={t} />
  else preview = row ? <BadgePreview row={row} data={data} t={t} /> : <div className="p-[14px]" style={{ color: t.mut }}>No trusted pool to show right now.</div>

  return (
    <div className="flex flex-wrap overflow-hidden rounded-card border border-line bg-surface text-[13px] leading-[1.45]">
      {/* Builder */}
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-[14px] border-line p-4 min-[720px]:border-r max-[719px]:border-b">
        <div className="flex flex-col gap-[2px]">
          <span className="font-mono text-[11px] tracking-[1px] text-gold">WIDGET · TRY IT</span>
          <b className="font-display text-[22px] leading-[1.05] font-bold uppercase">One script tag, any site</b>
        </div>
        <Group
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { id: 'ticker', label: 'Ticker' },
            { id: 'badge', label: 'Badge' },
            { id: 'table', label: 'Table' },
          ]}
        />
        <Group
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { id: 'dark', label: 'Dark' },
            { id: 'light', label: 'Light' },
          ]}
        />
        {kind === 'badge' && picks.length > 0 && row && (
          <Group label="Stock (badge)" value={keyOf(row)} onChange={setStock} options={picks.map((r) => ({ id: keyOf(r), label: picks.filter((p) => p.ticker === r.ticker).length > 1 ? `${r.ticker} · ${CHAIN_SHORT[r.chain] ?? r.chain}` : r.ticker }))} />
        )}
        <div className="mt-auto overflow-hidden rounded-[10px] border border-line bg-bg">
          <pre className="m-0 p-3 font-mono text-[11px] leading-[1.6] break-all whitespace-pre-wrap text-ink-2">
            <code>{code}</code>
          </pre>
          <button
            type="button"
            onClick={() => copyWithToast(code, 'Snippet').then((ok) => ok && setCopied(true))}
            aria-live="polite"
            className={`inline-flex min-h-11 w-full items-center justify-center gap-2 border-t border-line text-[12px] font-semibold transition-colors ${copied ? 'bg-success-bg text-green' : 'bg-surface text-gold hover:bg-surface-hover'}`}
          >
            {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
            {copied ? 'Copied' : 'Copy snippet'}
          </button>
        </div>
      </div>

      {/* Preview, inside a stand-in host page */}
      <div className="flex min-w-0 flex-[999_1_520px] bg-bg p-4">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line transition-colors duration-400" style={{ background: t.site }}>
          <div className="flex items-center gap-2 bg-[#161b22] px-3 py-2">
            <span aria-hidden className="flex gap-[5px]">
              <span className="size-[9px] rounded-full bg-line-hover" />
              <span className="size-[9px] rounded-full bg-line-hover" />
              <span className="size-[9px] rounded-full bg-line-hover" />
            </span>
            <span className="flex-1 text-center font-mono text-[11px] text-dim">your-site.com · live preview</span>
          </div>
          <div className="flex flex-1 flex-col gap-[14px] p-5 max-[459px]:p-3">
            <span aria-hidden className="block h-[14px] w-2/5 rounded-[4px]" style={{ background: t.siteLine }} />
            <span aria-hidden className="block h-2 w-4/5 rounded-[4px]" style={{ background: t.siteLine }} />
            <span aria-hidden className="block h-2 w-[65%] rounded-[4px]" style={{ background: t.siteLine }} />
            <div
              className={`min-w-0 overflow-hidden rounded-card border font-mono text-[13px] leading-[1.4] transition-colors duration-400 ${kind === 'badge' ? 'w-full max-w-[360px] min-[400px]:min-w-[280px]' : ''}`}
              style={{ background: t.bg, color: t.ink, borderColor: t.ln }}
            >
              {preview}
              {data && <Footer data={data} t={t} />}
            </div>
            <span aria-hidden className="block h-2 w-[72%] rounded-[4px]" style={{ background: t.siteLine }} />
            <span aria-hidden className="block h-2 w-1/2 rounded-[4px]" style={{ background: t.siteLine }} />
          </div>
        </div>
      </div>
    </div>
  )
}
