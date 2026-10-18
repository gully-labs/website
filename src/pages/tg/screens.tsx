import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { EChart } from '../../components/charts/EChart'
import { alpha, barsPreset, sparklinePreset } from '../../components/charts/chartPresets'
import { NF } from '../../components/charts/number-formats'
import { StockLogo } from '../../components/tracker/StockLogo'
import { ageText, CHAIN_NAME, CHAIN_SHORT, DOWN, fmtCompactUsd, fmtGap, fmtPrice, gapColor, UP, useHistory, type Load, type Tracker, type TrackerRow, type TrackerStatus } from '../../lib/tracker'
import type { AlertCondition, GapAlert, GapDirection } from '../developers/api'
import { useNow, useTgApi } from './hooks'
import { haptic, tgApi, type WebApp } from './sdk'
import { HolderMap } from '../../components/holders/HolderMap'

/* The Mini App's screens: the gap list across chains, one stock (24h chart and an alert composer driven
   by Telegram's MainButton), DeepCore launches and the linked account's alerts. Colours come from the
   theme tokens TgApp maps from Telegram; charts get concrete colours (ECharts cannot read CSS vars). */

const SITE = 'https://gullylabs.xyz'
/* Plain words for readers who are not traders: the status, the directions and an alert's condition. The
   site's own labels (lib/tracker, developers/api) stay as they are. */
const TG_STATUS: Record<TrackerStatus, string> = {
  premium: 'Well above',
  discount: 'Well below',
  drifting: 'Drifting',
  'in-line': 'Close to the real price',
  thin: 'Not enough trading',
  unverified: 'Not enough trading',
  'no-pool': 'Not trading yet',
  'pool-unreadable': 'No price right now',
  'feed-unreadable': 'No price right now',
}
const statusLabel = (r: TrackerRow) => (r.sessionOpen === false ? 'Market closed' : TG_STATUS[r.status] ?? r.status)
const NOT_ENOUGH = 'Not enough trading to compare right now.'
const TG_DIRECTIONS: { id: GapDirection; label: string }[] = [
  { id: 'above', label: '▲ Above' },
  { id: 'below', label: '▼ Below' },
  { id: 'both', label: '↕ Both' },
]
const LAUNCH_CHAIN_NAMES: Record<number, string> = { 56: 'BNB Chain', 999: 'HyperEVM', 4663: 'Robinhood Chain', 8453: 'Base' }
/** A Holder Map alert (alerts.mjs condition type 'holders'): the top cluster (or top 10) passing a share, or selling. */
export type HolderCondition = { type: 'holders'; chain: string; token: string; symbol: string | null; metric: 'cluster' | 'top10' | 'deployer'; above: number | null; dropPts: number | null; sellPct?: number | null }
const HOLDER_CHAIN_NAMES: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', base: 'Base', hyperevm: 'HyperEVM', solana: 'Solana' }
const shortToken = (t: string) => (t.length > 14 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t)
const holderTarget = (c: HolderCondition) => `${c.symbol ?? shortToken(c.token)} on ${HOLDER_CHAIN_NAMES[c.chain] ?? c.chain}`
/** An alert's condition in plain words, as the bot says it. */
const plainCondition = (cond: AlertCondition | HolderCondition, chains: Record<string, string> = {}) => {
  if (cond.type === 'holders') {
    const who = cond.metric === 'top10' ? 'The top 10 wallets' : cond.metric === 'deployer' ? 'The deployer' : 'The largest connected cluster of wallets'
    if (typeof cond.above === 'number') return `${who} of ${holderTarget(cond)} hold ${cond.above}% or more`
    if (typeof cond.dropPts === 'number') return `${who} of ${holderTarget(cond)} sell ${cond.dropPts} points or more of their share`
    if (typeof cond.sellPct === 'number') return `${who} of ${holderTarget(cond)} sell ${cond.sellPct}% or more of what they hold`
    return `${who} of ${holderTarget(cond)} change`
  }
  const c = cond
  if (c.type === 'deepcore-launch') return `A new token launches on DeepCore (${c.chainId ? (chains[c.chainId] ?? LAUNCH_CHAIN_NAMES[c.chainId] ?? `chain ${c.chainId}`) : 'any chain'})`
  if (c.type === 'gap') return c.direction === 'above' ? `▲ ${c.pct}% or more above the real share price` : c.direction === 'below' ? `▼ ${c.pct}% or more below the real share price` : `↕ ${c.pct}% or more above or below the real share price`
  return c.status === 'either' ? 'Well above or below the real share price' : c.status === 'premium' ? 'Well above the real share price' : c.status === 'discount' ? 'Well below the real share price' : String(c.status)
}
export type Me = { user: { id: string; firstName: string; username: string | null }; gate: { required: boolean; follows: boolean; channel: string | null; url: string | null }; linked: { chatType: string; chatTitle: string; account: string; blocked: boolean } | null; portal: string }

const trusted = (r: TrackerRow) => r.gapPct !== null && ['premium', 'discount', 'drifting', 'in-line'].includes(r.status) && !r.poolStale && r.sessionOpen !== false
const gapHex = (v: number | null | undefined, fallback: string) => (typeof v !== 'number' || Math.round(v * 100) === 0 ? fallback : v > 0 ? UP : DOWN)

/* ---------- small parts ---------- */

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-[6px] overflow-x-auto pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => {
            if (o.id !== value) haptic.select()
            onChange(o.id)
          }}
          className={`min-h-9 flex-none rounded-full border px-[14px] text-[13px] font-medium transition-colors ${value === o.id ? 'border-gold bg-gold text-[var(--tg-btn-text,#0b0e13)]' : 'border-line bg-surface text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Spark({ data, color, height = 30, label, pulse = false, labels, fmt }: { data: number[]; color: string; height?: number; label: string; pulse?: boolean; labels?: string[]; fmt?: (v: number) => string }) {
  const option = useMemo(() => sparklinePreset({ data, color, pulse, labels, fmt }), [data, color, pulse, labels, fmt])
  return <EChart option={option} height={height} label={label} skeleton="line" />
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="m-0 text-[12px] font-semibold tracking-[0.06em] text-[var(--tg-section-head,#a6b0bd)] uppercase">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

const card = 'rounded-[14px] border border-line bg-surface'

export function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={`${card} flex flex-col gap-3 p-4`}>
      <h2 className="m-0 font-display text-[22px] leading-none font-bold">{title}</h2>
      <div className="text-[14px] leading-[1.5] text-muted">{children}</div>
      {action}
    </div>
  )
}

export function Button({ children, onClick, tone = 'main', disabled }: { children: React.ReactNode; onClick: () => void; tone?: 'main' | 'line' | 'danger'; disabled?: boolean }) {
  const cls = tone === 'main' ? 'bg-gold text-[var(--tg-btn-text,#0b0e13)]' : tone === 'danger' ? 'border border-line text-error' : 'border border-line text-ink'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic.tap()
        onClick()
      }}
      className={`min-h-11 rounded-[10px] px-4 text-[14px] font-semibold transition-opacity active:opacity-70 disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  )
}

function ListSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-[62px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[14px] bg-surface" />
      ))}
    </div>
  )
}

/* ---------- gaps ---------- */

type ChainFilter = 'all' | 'robinhood' | 'bsc' | 'solana'
const CHAIN_OPTIONS: { id: ChainFilter; label: string }[] = [
  { id: 'all', label: 'All chains' },
  { id: 'robinhood', label: 'Robinhood' },
  { id: 'bsc', label: 'BNB' },
  { id: 'solana', label: 'Solana' },
]

export function GapsTab({ initData, tracker, onOpen, ink }: { initData: string; tracker: Load<Tracker>; onOpen: (r: TrackerRow) => void; ink: string }) {
  const [chain, setChain] = useState<ChainFilter>('all')
  const { load: sparks } = useTgApi<{ sparks: Record<string, number[]> }>(initData, '/api/tg/sparks', 120_000)
  const now = useNow()
  const rows = useMemo(() => {
    if (tracker.k !== 'ok') return []
    const list = tracker.data.rows.filter((r) => chain === 'all' || r.chain === chain)
    return [...list].sort((a, b) => Number(trusted(b)) - Number(trusted(a)) || Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))
  }, [tracker, chain])
  const flagged = rows.filter((r) => trusted(r) && (r.status === 'premium' || r.status === 'discount')).length

  return (
    <div className="flex flex-col gap-3">
      <Chips value={chain} options={CHAIN_OPTIONS} onChange={setChain} label="Chain" />
      {tracker.k === 'loading' && <ListSkeleton />}
      {tracker.k === 'error' && <Notice title="Prices aren’t available right now">Try again in a minute.</Notice>}
      {tracker.k === 'ok' && (
        <Section title={`${rows.length} stock tokens · ${flagged} flagged`} right={<span className="text-[12px] text-faint">updated {ageText(tracker.data.generatedAt, now)}</span>}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => {
              const key = `${r.chain}:${r.ticker}`
              const spark = sparks.k === 'ok' ? sparks.data.sparks[key] : undefined
              const ok = trusted(r)
              // The site's rule: teal above, vermilion below, the text colour while in line.
              const color = gapColor(r) ?? ink
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic.tap()
                      onOpen(r)
                    }}
                    className={`${card} grid w-full grid-cols-[34px_minmax(0,1fr)_64px_76px] items-center gap-3 px-3 py-[10px] text-left active:opacity-80`}
                    aria-label={`${r.ticker} on ${CHAIN_NAME[r.chain] ?? r.chain}: gap ${fmtGap(r.gapPct)}, ${statusLabel(r)}`}
                  >
                    <StockLogo row={r} size={34} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-[6px]">
                        <span className="font-semibold text-ink">{r.symbol ?? r.ticker}</span>
                        <span className="rounded-[4px] border border-line px-1 font-mono text-[10px] text-faint">{CHAIN_SHORT[r.chain] ?? r.chain}</span>
                      </span>
                      <span className="truncate text-[12px] text-muted">{r.name}</span>
                    </span>
                    <span className="block h-[30px]" aria-hidden>
                      {spark && spark.length > 1 ? <Spark data={spark} color={gapHex(spark.at(-1), ink)} label={`${r.ticker} gap over 24 hours`} /> : <span className="block h-full border-b border-dashed border-line" />}
                    </span>
                    <span className="flex flex-col items-end">
                      <AnimatedNumber value={ok || r.status === 'thin' ? r.gapPct : null} format={NF.signed2} suffix="%" className="font-mono text-[14px] font-semibold" style={{ color: ok ? color : undefined }} />
                      <span className="text-[11px] text-faint">{statusLabel(r)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
      <p className="m-0 px-1 pb-2 text-[11px] leading-[1.5] text-faint">Gap = how far the token trades above or below the real share price. Information only, not advice.</p>
    </div>
  )
}

/* ---------- one stock ---------- */

const PCTS = ['1', '2', '3', '5']

export function StockScreen({ wa, initData, row, me, ink, onAlertsChanged, onHolders }: { wa: WebApp; initData: string; row: TrackerRow | null; me: Me; ink: string; onAlertsChanged: () => void; onHolders?: () => void }) {
  const history = useHistory(row?.chain ?? null, row?.ticker ?? null)
  const now = useNow()
  const [pct, setPct] = useState('2')
  const [custom, setCustom] = useState('')
  const [direction, setDirection] = useState<GapDirection>('both')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const threshold = custom ? Number(custom.replace(',', '.')) : Number(pct)
  const valid = Number.isFinite(threshold) && threshold >= 0.1 && threshold <= 100

  // 24 hours of the gap for the chart.
  const series = useMemo(() => {
    if (history.k !== 'ok' || !history.data.length) return null
    const end = history.data.at(-1)![0]
    const pts = history.data.filter((p) => p[0] >= end - 24 * 3600 && Number.isFinite(p[1]))
    if (pts.length < 2) return null
    return { data: pts.map((p) => Math.round(p[1] * 100) / 100), labels: pts.map((p) => new Date(p[0] * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })) }
  }, [history])

  // Telegram's MainButton creates the alert (or, without a linked wallet, opens the portal).
  const create = useRef<() => void>(() => undefined)
  useEffect(() => {
    create.current = async () => {
      if (!row) return
      if (!me.linked) {
        wa.openLink(me.portal)
        return
      }
      if (!valid || busy) return haptic.warn()
      setBusy(true)
      wa.MainButton.showProgress(false)
      const r = await tgApi<{ alert: GapAlert }>(initData, '/api/tg/alerts', { method: 'POST', body: { chain: row.chain, ticker: row.ticker, pct: threshold, direction } })
      wa.MainButton.hideProgress()
      setBusy(false)
      if (r.ok) {
        haptic.ok()
        setResult({ ok: true, text: `Alert created: ${plainCondition(r.data.alert.condition)}. It arrives in your linked chat.` })
        onAlertsChanged()
      } else {
        haptic.fail()
        setResult({ ok: false, text: r.error })
      }
    }
  })
  useEffect(() => {
    const mb = wa.MainButton
    const click = () => create.current()
    mb.setParams({ text: me.linked ? (valid ? `Create alert · ${TG_DIRECTIONS.find((d) => d.id === direction)!.label} ${threshold}%` : 'Pick a threshold from 0.1 to 100%') : 'Link wallet in the portal', is_visible: !!row, is_active: !me.linked || valid })
    mb.onClick(click)
    return () => {
      mb.offClick(click)
      mb.hide()
    }
  }, [wa, me.linked, valid, direction, threshold, row])

  if (!row) return <Notice title="Not followed yet">This stock token isn’t one we follow yet.</Notice>
  const ok = trusted(row)
  const color = gapColor(row) ?? ink
  const pctText = valid ? String(threshold) : 'X'
  const dirHint = direction === 'above' ? `the token is ${pctText}% or more above the real share price` : direction === 'below' ? `the token is ${pctText}% or more below the real share price` : `the token is ${pctText}% or more above or below the real share price`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <StockLogo row={row} size={46} />
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 font-display text-[30px] leading-none font-bold">{row.symbol ?? row.ticker}</h1>
          <span className="truncate text-[13px] text-muted">
            {row.name} · {CHAIN_NAME[row.chain] ?? row.chain}
          </span>
        </div>
      </div>

      <div className={`${card} flex flex-col gap-3 p-4`}>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[12px] text-faint">Gap to the real share price</span>
            <AnimatedNumber value={ok || row.status === 'thin' ? row.gapPct : null} format={NF.signed2} suffix="%" countUp className="font-mono text-[34px] leading-none font-semibold" style={{ color: ok ? color : undefined }} />
          </div>
          <span className="rounded-full border px-[10px] py-[3px] text-[12px]" style={{ borderColor: ok ? alpha(color.startsWith('#') ? color : '#7f8b9c', 0.5) : undefined, color: ok ? color : undefined }}>
            {statusLabel(row)}
          </span>
        </div>
        <div className="h-[132px]">
          {history.k === 'loading' ? <div className="h-full animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[8px] bg-bg" /> : series ? <Spark data={series.data} labels={series.labels} color={gapHex(series.data.at(-1), ink)} height={132} pulse fmt={(v) => fmtGap(v)} label={`${row.ticker} gap over the last 24 hours`} /> : <p className="m-0 pt-10 text-center text-[13px] text-faint">Not enough readings for a 24-hour chart yet.</p>}
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div>
            <dt className="text-faint">Token price</dt>
            <dd className="m-0 font-mono">{fmtPrice(row.onchain)}</dd>
          </div>
          <div>
            <dt className="text-faint">Real share price</dt>
            <dd className="m-0 font-mono">{fmtPrice(row.fair)}</dd>
          </div>
          <div>
            <dt className="text-faint">Liquidity</dt>
            <dd className="m-0 font-mono">{fmtCompactUsd(row.pool?.liquidityUsd)}</dd>
          </div>
          <div>
            <dt className="text-faint">Updated</dt>
            <dd className="m-0 font-mono">{ageText(row.feedUpdatedAt, now)}</dd>
          </div>
        </dl>
        {row.sessionOpen === false && <p className="m-0 text-[12px] leading-[1.5] text-faint">🌙 Market closed: compared with the last closing price.</p>}
        {!ok && row.sessionOpen !== false && <p className="m-0 text-[12px] leading-[1.5] text-faint">{NOT_ENOUGH}</p>}
        <button type="button" onClick={() => wa.openLink(`${SITE}/tracker/${row.chain}/${row.ticker}`)} className="self-start text-[13px] text-[var(--tg-link,#e8c060)]">
          Open the full page ↗
        </button>
      </div>

      {onHolders && (
        <Button tone="line" onClick={onHolders}>
          👥 Who holds {row.ticker}?
        </Button>
      )}

      <Section title="Alert me">
        <div className={`${card} flex flex-col gap-3 p-4`}>
          <span className="text-[13px] text-muted">Threshold</span>
          <div className="flex flex-wrap gap-[6px]">
            {PCTS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={!custom && pct === p}
                onClick={() => {
                  haptic.select()
                  setPct(p)
                  setCustom('')
                }}
                className={`min-h-9 rounded-full border px-[14px] font-mono text-[13px] ${!custom && pct === p ? 'border-gold bg-gold text-[var(--tg-btn-text,#0b0e13)]' : 'border-line text-muted'}`}
              >
                {p}%
              </button>
            ))}
            <label className="flex min-h-9 items-center gap-1 rounded-full border border-line px-3 text-[13px] text-muted">
              <span className="sr-only">Custom threshold in percent</span>
              <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} inputMode="decimal" placeholder="Custom" className="w-[64px] bg-transparent font-mono text-ink outline-none placeholder:text-faint" />%
            </label>
          </div>
          <span className="text-[13px] text-muted">Direction</span>
          <Chips value={direction} options={TG_DIRECTIONS} onChange={setDirection} label="Direction" />
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
            Fires when {dirHint}. Delivered to {me.linked ? <b>{me.linked.chatTitle}</b> : 'your linked chat'}, at most once every 30 minutes.
          </p>
          {!me.linked && <p className="m-0 text-[12px] leading-[1.5] text-faint">Link this Telegram account to a wallet once: developer portal, Alerts tab, Connect Telegram.</p>}
          {result && (
            <p role="status" className="m-0 text-[13px]" style={{ color: result.ok ? UP : undefined }}>
              <span className={result.ok ? '' : 'text-error'}>{result.text}</span>
            </p>
          )}
        </div>
      </Section>
    </div>
  )
}

/* ---------- DeepCore launches ---------- */

type Launch = { key: string; chainId: number; chainKey: string; chainName: string; token: string; symbol: string | null; createdAt: string; legs: { kind: string | null; quote: string | null; locked: boolean | null }[]; links: { token: string } }
type Launches = { state: 'ok' | 'stale' | 'unreadable'; launches: Launch[]; asOf: string | null; error: string | null; chainNames: Record<string, string> }
const LAUNCH_CHAINS = [
  { id: '0', label: 'All' },
  { id: '56', label: 'BNB' },
  { id: '999', label: 'HyperEVM' },
  { id: '4663', label: 'Robinhood' },
  { id: '8453', label: 'Base' },
]
const CHAIN_COLORS: Record<number, string> = { 56: '#e8c060', 999: '#1f9e89', 4663: '#5aa9e6', 8453: '#c98bdb' }
const CHAIN_LABEL: Record<number, string> = { 56: 'BNB', 999: 'HyperEVM', 4663: 'Robinhood', 8453: 'Base' }

export function LaunchesTab({ wa, initData, ink, onHolders }: { wa: WebApp; initData: string; ink: string; onHolders?: (chain: string, token: string) => void }) {
  const [chain, setChain] = useState('0')
  const { load } = useTgApi<Launches>(initData, `/api/tg/launches${chain === '0' ? '' : `?chain=${chain}`}`, 90_000)
  const now = useNow()
  const counts = useMemo(() => {
    if (load.k !== 'ok') return null
    const m = new Map<number, number>()
    for (const l of load.data.launches) m.set(l.chainId, (m.get(l.chainId) ?? 0) + 1)
    return [...m.entries()].map(([id, n]) => ({ id, n, name: CHAIN_LABEL[id] ?? load.data.chainNames[id] ?? `Chain ${id}` }))
  }, [load])
  const barOption = useMemo(
    () =>
      counts && {
        grid: { left: 4, right: 4, top: 18, bottom: 22 },
        xAxis: { type: 'category', data: counts.map((c) => c.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: ink, fontSize: 11, interval: 0, fontFamily: 'Hanken Grotesk, sans-serif' } },
        yAxis: { type: 'value', show: false },
        tooltip: { show: false },
        series: [{ id: 'launches', ...barsPreset({ radius: [5, 5, 0, 0] }), barMaxWidth: 34, label: { show: true, position: 'top', color: ink, fontSize: 11 }, data: counts.map((c) => ({ value: c.n, itemStyle: { color: CHAIN_COLORS[c.id] ?? '#7f8b9c' } })) }],
      },
    [counts, ink],
  )

  return (
    <div className="flex flex-col gap-3">
      <Chips value={chain} options={LAUNCH_CHAINS} onChange={setChain} label="DeepCore chain" />
      {load.k === 'loading' && <ListSkeleton n={5} />}
      {load.k === 'error' && <Notice title="Launches aren’t available right now">Try again in a minute.</Notice>}
      {load.k === 'ok' && load.data.state === 'unreadable' && <Notice title="DeepCore isn’t answering right now">Try again in a minute.</Notice>}
      {load.k === 'ok' && load.data.state !== 'unreadable' && (
        <>
          {load.data.state === 'stale' && <p className="m-0 px-1 text-[12px] text-faint">DeepCore isn’t answering right now; this list is from {ageText(load.data.asOf, now)}.</p>}
          {barOption && counts!.length > 1 && (
            <div className={`${card} px-2 pt-1`}>
              <EChart option={barOption} height={110} label={`Latest launches per chain: ${counts!.map((c) => `${c.name} ${c.n}`).join(', ')}`} />
            </div>
          )}
          <Section title={`${load.data.launches.length} latest launches`}>
            {!load.data.launches.length && <p className="m-0 px-1 text-[13px] text-muted">No launches on this chain yet.</p>}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {load.data.launches.map((l) => {
                const leg = l.legs[0]
                return (
                  <li key={l.key} className={`${card} flex items-stretch`}>
                    <button
                      type="button"
                      onClick={() => {
                        haptic.tap()
                        wa.openLink(l.links.token)
                      }}
                      aria-label={`${l.symbol ?? 'New token'} on ${l.chainName}: open on DeepCore`}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[14px] px-3 py-[10px] text-left active:opacity-80"
                    >
                      <span className="flex size-[34px] flex-none items-center justify-center rounded-full font-display text-[13px] font-bold text-[#0b0e13]" style={{ background: CHAIN_COLORS[l.chainId] ?? '#7f8b9c' }} aria-hidden>
                        {(l.symbol ?? '?').slice(0, 3)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold">{l.symbol ?? `${l.token.slice(0, 6)}…${l.token.slice(-4)}`}</span>
                        <span className="truncate text-[12px] text-muted">
                          {l.chainName}
                          {leg ? (leg.locked === true ? ' · 🔒 Liquidity locked' : leg.locked === false ? ' · Liquidity not locked' : '') : ''}
                        </span>
                      </span>
                      <span className="flex-none text-[12px] text-faint">{ageText(l.createdAt, now)}</span>
                    </button>
                    {onHolders && (
                      <button
                        type="button"
                        onClick={() => {
                          haptic.tap()
                          onHolders(l.chainKey, l.token.toLowerCase())
                        }}
                        aria-label={`Who holds ${l.symbol ?? 'this token'}?`}
                        className="flex min-h-11 min-w-11 flex-none flex-col items-center justify-center gap-[2px] border-l border-line px-3 text-[11px] text-muted active:opacity-70"
                      >
                        <span aria-hidden className="text-[18px] leading-none">
                          👥
                        </span>
                        Holders
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}

/* ---------- my alerts ---------- */

type AlertsData = { alerts: GapAlert[]; limits: { planName: string; max: number; used: number } }

function alertStateText(a: GapAlert) {
  if (!a.coveredByPlan) return { t: 'Not in your plan', c: '#ff8a7a' }
  if (!a.enabled) return { t: 'Paused', c: '#7f8b9c' }
  if (a.mutedUntil) return { t: 'Muted', c: '#7f8b9c' }
  if (a.waitingToReArm.length) return { t: (a.condition as AlertCondition | HolderCondition).type === 'holders' ? 'Fired · watching again once it falls back' : 'Fired · watching again once the gap closes', c: '#e8c060' }
  return { t: 'Watching', c: '#6fcf6a' }
}

/** `exitsOnly`: shown under the News channel join screen, so someone who left the channel can still pause or
    delete what they set up (the server never gates pause and delete); resume, test and opening a stock wait for the channel. */
export function AlertsTab({ wa, initData, me, version, onOpenStock, exitsOnly = false }: { wa: WebApp; initData: string; me: Me; version: number; onOpenStock: (chain: string, ticker: string) => void; exitsOnly?: boolean }) {
  const { load, reload } = useTgApi<AlertsData>(initData, me.linked ? `/api/tg/alerts?v=${version}` : null, 60_000)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (!me.linked)
    return (
      <Notice title="Link your wallet for alerts" action={<Button onClick={() => wa.openLink(me.portal)}>Open the developer portal ↗</Button>}>
        Alerts belong to a wallet account. Link this Telegram account once: developer portal, Alerts tab, <b>Connect Telegram</b>, then follow the link back to the bot. Your alerts show up here.
      </Notice>
    )

  const act = async (a: GapAlert, op: 'pause' | 'resume' | 'test' | 'delete') => {
    if (op === 'delete') {
      const yes = await new Promise<boolean>((resolve) => (wa.showConfirm ? wa.showConfirm('Delete this alert? Deliveries stop at once.', resolve) : resolve(window.confirm('Delete this alert?'))))
      if (!yes) return
    }
    setBusy(`${a.id}:${op}`)
    const r = await tgApi(initData, `/api/tg/alerts/${a.id}/${op}`, { method: 'POST' })
    setBusy(null)
    if (r.ok) {
      haptic.ok()
      setMsg({ ok: true, text: op === 'test' ? 'Test sent to your linked chat.' : op === 'delete' ? 'Alert deleted.' : op === 'pause' ? 'Alert paused.' : 'Alert resumed.' })
    } else {
      haptic.fail()
      setMsg({ ok: false, text: r.error })
    }
    reload()
  }

  return (
    <div className="flex flex-col gap-3">
      {load.k === 'loading' && <ListSkeleton n={3} />}
      {load.k === 'error' && <Notice title="Your alerts aren’t available right now">Try again in a minute.</Notice>}
      {load.k === 'ok' && (
        <Section title={`${load.data.alerts.length} of ${load.data.limits.max} on ${load.data.limits.planName}`} right={<span className="text-[12px] text-faint">{me.linked.chatTitle}</span>}>
          <div className="h-[6px] overflow-hidden rounded-full bg-surface" aria-hidden>
            <div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${Math.min(100, (load.data.alerts.length / Math.max(1, load.data.limits.max)) * 100)}%` }} />
          </div>
          {msg && (
            <p role="status" className={`m-0 px-1 text-[13px] ${msg.ok ? '' : 'text-error'}`} style={msg.ok ? { color: UP } : undefined}>
              {msg.text}
            </p>
          )}
          {!load.data.alerts.length && <p className="m-0 px-1 text-[13px] text-muted">No alerts yet. Open a stock and set one with the button at the bottom.</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {load.data.alerts.map((a) => {
              const st = alertStateText(a)
              const hc = (a.condition as AlertCondition | HolderCondition).type === 'holders' ? (a.condition as unknown as HolderCondition) : null
              const label = a.name || (hc ? `🫧 ${hc.symbol ?? shortToken(hc.token)} holders · ${HOLDER_CHAIN_NAMES[hc.chain] ?? hc.chain}` : a.condition.type === 'deepcore-launch' ? 'DeepCore launches' : a.ticker ? `${a.ticker} · ${CHAIN_SHORT[a.chain ?? ''] ?? a.chain}` : 'Any stock')
              return (
                <li key={a.id} className={`${card} flex flex-col gap-2 p-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" disabled={exitsOnly || !a.ticker || !a.chain} onClick={() => {
                        if (!a.chain || !a.ticker) return
                        haptic.tap()
                        onOpenStock(a.chain, a.ticker)
                      }} className="min-w-0 text-left">
                      <span className="block truncate font-semibold">{label}</span>
                      <span className="block text-[13px] text-muted">{plainCondition(a.condition)}</span>
                    </button>
                    <span className="flex flex-none items-center gap-1 text-[12px]" style={{ color: st.c }}>
                      <span className="size-[7px] rounded-full" style={{ background: st.c }} aria-hidden />
                      {st.t}
                    </span>
                  </div>
                  <div className={`grid gap-2 ${exitsOnly ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    <Button tone="line" disabled={!!busy || (exitsOnly && !a.enabled)} onClick={() => act(a, a.enabled ? 'pause' : 'resume')}>
                      {a.enabled ? 'Pause' : exitsOnly ? 'Paused' : 'Resume'}
                    </Button>
                    {!exitsOnly && (
                      <Button tone="line" disabled={!!busy || !a.telegram} onClick={() => act(a, 'test')}>
                        Test
                      </Button>
                    )}
                    <Button tone="danger" disabled={!!busy} onClick={() => act(a, 'delete')}>
                      Delete
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
      <Button tone="line" onClick={() => wa.openLink(me.portal)}>
        Manage in the developer portal ↗
      </Button>
    </div>
  )
}

/* ---------- who holds this? (Holder Map) ---------- */

const HOLDER_LINES = ['10', '20', '30']

/**
 * One token's Holder Map, compact for the Mini App: who holds it, how the biggest wallets are connected,
 * and (with a linked wallet) an alert when the largest connected cluster passes a share.
 */
export function HoldersScreen({ wa, initData, me, chain, token, onAlertsChanged }: { wa: WebApp; initData: string; me: Me; chain: string; token: string; onAlertsChanged: () => void }) {
  const [line, setLine] = useState('20')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const name = HOLDER_CHAIN_NAMES[chain] ?? chain
  const create = async () => {
    if (!me.linked) return wa.openLink(me.portal)
    if (busy) return
    setBusy(true)
    const r = await tgApi<{ alert: GapAlert }>(initData, '/api/tg/alerts', { method: 'POST', body: { kind: 'holders', chain, token, metric: 'cluster', above: Number(line) } })
    setBusy(false)
    if (r.ok) {
      haptic.ok()
      setResult({ ok: true, text: `Alert created: ${plainCondition(r.data.alert.condition as AlertCondition | HolderCondition)}. It arrives in your linked chat.` })
      onAlertsChanged()
    } else {
      haptic.fail()
      setResult({ ok: false, text: r.error })
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[30px] leading-none font-bold">👥 Who holds this?</h1>
        <p className="m-0 text-[13px] leading-[1.5] text-muted">
          The biggest wallets on {name}, sized by how much they hold. Wallets that sent tokens to each other are joined, and joined wallets are often one person or team.
        </p>
      </div>
      <HolderMap chain={chain} token={token} compact />
      <Section title="Alert me">
        <div className={`${card} flex flex-col gap-3 p-4`}>
          <span className="text-[13px] text-muted">When the largest connected cluster holds at least</span>
          <Chips value={line} options={HOLDER_LINES.map((p) => ({ id: p, label: `${p}%` }))} onChange={setLine} label="Cluster share" />
          {!me.linked && <p className="m-0 text-[12px] leading-[1.5] text-faint">Link this Telegram account to a wallet once: developer portal, Alerts tab, Connect Telegram.</p>}
          <Button onClick={create} disabled={busy}>
            {me.linked ? `🔔 Alert me at ${line}%` : 'Link wallet in the portal'}
          </Button>
          {result && (
            <p role="status" className="m-0 text-[13px]" style={{ color: result.ok ? UP : undefined }}>
              <span className={result.ok ? '' : 'text-error'}>{result.text}</span>
            </p>
          )}
        </div>
      </Section>
    </div>
  )
}
