import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, CircleSlash, Clock3, Copy, ExternalLink, Loader2, Mail, Receipt } from 'lucide-react'
import { EChart } from '../charts/EChart'
import type { ChartEvent } from '../charts/chart-utils'
import { axisTooltip, barsPreset, C, PALETTE, tipHtml } from '../charts/chartPresets'
import { deepCancel, PART_NAMES, type Confidence, type DeepCheck, type DeepReport, type DeepTrace, type PartKey, type PartState } from '../../lib/holdersDeep'
import { btnGold, btnOutline } from '../ui'
import { StatusPill, type PillTone } from '../ui/StatusPill'
import { copyWithToast } from '../ui/toast'
import { useCountUp } from './count'
import { K } from './theme'

/* The Deep check screens: the live status of a check that is waiting, queued or running, and its report (funding
   trace, shared-funder clusters, deployer record, snipers and bundles). Every figure, finding, source and
   confidence is the server's (GET /api/holders/deep/:id); a part that could not run says why. */

const CONF: Record<Confidence, { tone: PillTone; text: string }> = { high: { tone: 'ok', text: 'High confidence' }, medium: { tone: 'neutral', text: 'Medium confidence' }, low: { tone: 'warn', text: 'Low confidence' } }
export const ConfPill = ({ c }: { c: Confidence }) => <StatusPill tone={CONF[c]?.tone ?? 'neutral'}>{CONF[c]?.text ?? c}</StatusPill>

const pct = (n: number | null | undefined) => (typeof n === 'number' ? `${n < 0.1 && n > 0 ? '<0.1' : n >= 10 ? Math.round(n) : n.toFixed(1)}%` : 'not known')
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '')

/** The explorer's own address and transaction URLs, derived from the token's explorer link. */
function explorer(tokenUrl: string, chainKey: string) {
  try {
    const o = new URL(tokenUrl).origin
    return { addr: (a: string) => `${o}/${chainKey === 'solana' ? 'account' : 'address'}/${a}`, tx: (t: string) => `${o}/tx/${t}` }
  } catch {
    return { addr: () => '', tx: () => '' }
  }
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const
const chip = (on: boolean) => `inline-flex min-h-11 items-center gap-1 rounded-btn border px-3 font-mono text-[12px] transition-colors ${on ? 'border-gold text-gold-hover' : 'border-line-strong text-muted hover:border-gold'}`

/* ------------------------------------------------------------------ status --- */

const STAGES = ['Awaiting payment', 'Queued', 'Running', 'Report']
export function DeepStatusPanel({ check, onChange }: { check: DeepCheck; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const stage = check.status === 'awaiting_payment' ? 0 : check.status === 'queued' ? 1 : check.status === 'running' ? 2 : 3
  const pctNow = check.status === 'running' ? Math.max(3, Math.min(99, check.progress?.pct ?? 3)) : check.status === 'queued' ? 2 : 0
  const shown = useCountUp(check.status === 'running' ? pctNow : null, 600)
  const pay = check.payment
  return (
    <section aria-label="Check status" className="card card-pad flex flex-col gap-3" data-deep-status={check.status} aria-live="polite">
      <ol className="m-0 grid list-none grid-cols-4 gap-1 p-0" aria-label="Progress">
        {STAGES.map((s, i) => (
          <li key={s} className="flex flex-col gap-1">
            <span aria-hidden className="block h-[4px] overflow-hidden rounded-full" style={{ background: K.slate }}>
              <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: i < stage ? '100%' : i === stage ? (i === 2 ? `${pctNow}%` : '100%') : '0%', background: i === stage ? K.pale : K.gold, animation: i === stage && i !== 2 ? 'gl-blink 1.6s ease-in-out infinite' : undefined }} />
            </span>
            <span className={`font-mono text-[11px] ${i === stage ? 'text-ink' : 'text-dim'}`}>{s}</span>
          </li>
        ))}
      </ol>
      {check.status === 'awaiting_payment' && pay && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[14px] leading-[1.55] text-muted">
            Pay <b className="text-ink">${pay.usd}</b> to start the check. It runs the moment the invoice is paid, and this page updates by itself.
            {pay.expiresAt && <> The invoice is open until {when(pay.expiresAt)}; an unpaid check is cancelled then.</>}
          </p>
          <span className="flex flex-wrap items-center gap-2">
            <a href={pay.payUrl} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[14px]`} data-deep-pay>
              <Receipt className="icon-md" aria-hidden /> Open the invoice · ${pay.usd}
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await deepCancel(check.id)
                setBusy(false)
                onChange()
              }}
              className={`${btnOutline} inline-flex min-h-11 items-center px-4 text-[13px]`}
            >
              Cancel the check
            </button>
          </span>
        </div>
      )}
      {check.status === 'queued' && (
        <p className="m-0 flex items-center gap-2 text-[14px] text-muted">
          <Clock3 className="icon-md text-gold" aria-hidden /> {check.free ? 'Your check is in the queue.' : 'Payment received. Your check is in the queue and starts as soon as a worker is free.'}
        </p>
      )}
      {check.status === 'running' && (
        <div className="flex flex-col gap-1">
          <span className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[14px] text-ink">
              <Loader2 className="icon-md animate-spin text-gold" aria-hidden /> {check.progress?.message ?? 'Reading the chain'}
            </span>
            <span className="font-display text-[26px] leading-none font-extrabold text-gold">{shown === null ? '…' : `${Math.round(shown)}%`}</span>
          </span>
          <span className="font-mono text-[11px] text-dim">A check usually takes a minute or two. You can close this page: the link keeps the report.</span>
        </div>
      )}
    </section>
  )
}

/** A check that ended without a report: failed (credit and refund contact), or cancelled. */
export function DeepEnded({ check, mapHref }: { check: DeepCheck; mapHref: string }) {
  if (check.status === 'cancelled')
    return (
      <section className="card card-pad flex flex-col gap-2" data-deep-status="cancelled">
        <h2 className="heading-4">Check cancelled</h2>
        <p className="m-0 text-[14px] leading-[1.55] text-muted">{check.cancelReason === 'unpaid-expired' ? 'The invoice expired before it was paid, so nothing was charged and nothing ran.' : 'This check was cancelled before it ran. Nothing was charged.'}</p>
        <a href={mapHref} className={`${btnOutline} inline-flex min-h-11 w-fit items-center px-4 text-[13px]`}>
          Back to the Holder Map
        </a>
      </section>
    )
  const paid = !check.free && check.priceUsd > 0
  return (
    <section className="card card-pad flex flex-col gap-3" data-deep-status="failed" role="alert">
      <h2 className="heading-4 flex items-center gap-2 text-error">
        <AlertTriangle className="icon-md" aria-hidden /> This check could not be completed
      </h2>
      <p className="m-0 text-[14px] leading-[1.55] text-muted">{check.error ?? 'None of its parts could be computed for this token.'}</p>
      {check.credit?.earned ? (
        <p className="m-0 rounded-[8px] border border-gold/40 bg-surface-deep px-3 py-2 text-[14px] leading-[1.55] text-ink" data-deep-credit>
          {paid ? 'We added a credit to your account: your next Deep check on any token is free.' : 'The credit you used on this re-run was given back: your next Deep check is free.'} It is a credit for a free re-run, not an on-chain refund.
        </p>
      ) : null}
      <span className="flex flex-wrap items-center gap-2">
        <a href={mapHref} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[14px]`}>
          {check.credit?.earned ? 'Re-run it free from the Holder Map' : 'Back to the Holder Map'}
        </a>
        <a href={`mailto:${check.credit?.contact ?? 'hello@gullylabs.xyz'}?subject=${encodeURIComponent(`Deep check refund ${check.id}`)}`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[13px]`} data-deep-contact>
          <Mail className="icon-md" aria-hidden /> Contact us for a refund
        </a>
      </span>
      <span className="font-mono text-[11px] text-dim">Quote check id {check.id} when you write.</span>
    </section>
  )
}

/* ------------------------------------------------------------------ report --- */

function Card({ id, title, state, source, confidence, children }: { id: string; title: string; state?: PartState; source?: string | null; confidence?: Confidence; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="card card-pad flex scroll-mt-20 flex-col gap-3" data-deep-section={id.replace('deep-', '')} data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-h`} className="heading-4">
          {title}
        </h3>
        <span className="flex flex-wrap items-center gap-2">
          {state && state !== 'ok' && <StatusPill tone={state === 'partial' ? 'warn' : 'off'}>{state === 'partial' ? 'Partial' : state === 'skipped' ? 'Skipped' : 'Unavailable'}</StatusPill>}
          {confidence && <ConfPill c={confidence} />}
        </span>
      </div>
      {source && <span className="font-mono text-[11px] leading-[1.5] text-dim">Source: {source}</span>}
      {children}
    </section>
  )
}

const Unavailable = ({ reason }: { reason?: string }) => (
  <p className="m-0 flex items-start gap-2 text-[13px] leading-[1.55] text-muted" data-deep-unavailable>
    <CircleSlash className="icon-md mt-[1px] flex-none text-dim" aria-hidden /> {reason ?? 'This part could not be computed.'}
  </p>
)

function Tile({ k, v, sub, tone = 'gold' }: { k: string; v: string; sub?: string; tone?: 'gold' | 'warn' | 'dim' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-3 py-2.5">
      <span className="font-mono text-[11px] tracking-[1px] text-dim">{k}</span>
      <span className="font-display text-[26px] leading-none font-extrabold" style={{ color: tone === 'warn' ? K.warn : tone === 'dim' ? K.muted : K.gold }}>
        {v}
      </span>
      {sub && <span className="truncate text-[12px] text-muted">{sub}</span>}
    </div>
  )
}

function Wallets({ list, ex }: { list: string[]; ex: ReturnType<typeof explorer> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((w) => (
        <a key={w} href={ex.addr(w)} {...ext} className="rounded-[6px] border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-gold hover:text-ink">
          {short(w)}
        </a>
      ))}
    </span>
  )
}

function Trading({ r, ex }: { r: DeepReport; ex: ReturnType<typeof explorer> }) {
  const t = r.sections.trading
  const [open, setOpen] = useState<number | null>(null)
  const bundles = useMemo(() => t?.bundles ?? [], [t])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 12, top: 18, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: bundles.map((b) => `#${b.block}`), axisLabel: { color: C.axis, fontSize: 10 } },
      yAxis: { type: 'value', minInterval: 1, name: 'wallets', nameTextStyle: { color: C.faint, fontSize: 10, align: 'left' } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const b = bundles[ps[0]?.dataIndex]
        return b ? tipHtml({ title: `Block ${b.block}`, rows: [{ name: 'wallets that bought together', value: String(b.count), color: C.gold }], note: 'Click the bar to list the wallets.' }) : ''
      }, 'shadow'),
      series: [{ id: 'bundles', ...barsPreset({ stagger: 60 }), barMaxWidth: 28, data: bundles.map((b, i) => ({ value: b.count, itemStyle: { color: open === i ? C.goldHover : C.gold, borderRadius: [3, 3, 0, 0] } })) }],
    }),
    [bundles, open],
  )
  const share = useMemo(
    () => ({
      grid: { left: 4, right: 54, top: 2, bottom: 2, containLabel: true },
      xAxis: { type: 'value', show: false, max: (v: { max: number }) => Math.max(5, v.max * 1.15) },
      yAxis: { type: 'category', inverse: true, data: ['Snipers', 'Bundled buyers'], axisLine: { show: false }, axisLabel: { color: C.ink2, fontSize: 12 } },
      tooltip: axisTooltip((ps: ChartEvent[]) => tipHtml({ title: ps[0]?.name, rows: [{ name: 'share of supply', value: pct(ps[0]?.value) }] }), 'shadow'),
      series: [{ id: 'share', ...barsPreset({ horizontal: true, stagger: 100 }), barWidth: 16, showBackground: true, backgroundStyle: { color: C.line, borderRadius: 4 }, label: { show: true, position: 'right', color: C.ink2, fontSize: 12, formatter: (p: ChartEvent) => pct(p.value) }, data: [{ value: t?.snipers?.pctOfSupply ?? 0, itemStyle: { color: C.orange, borderRadius: 4 } }, { value: t?.bundled?.pctOfSupply ?? 0, itemStyle: { color: C.gold, borderRadius: 4 } }] }],
    }),
    [t],
  )
  if (!t || t.state === 'unavailable' || t.state === 'skipped') return <Card id="deep-trading" title={PART_NAMES.trading} state={t?.state ?? 'unavailable'}><Unavailable reason={t?.reason ?? r.unavailable.find((u) => u.section === 'trading')?.reason} /></Card>
  return (
    <Card id="deep-trading" title={PART_NAMES.trading} state={t.state} source={t.source} confidence={t.confidence}>
      {t.method && <span className="font-mono text-[11px] text-dim">Method: {t.method === 'deepcore-launch-forensics' ? 'DeepCore launch forensics' : 'inferred from the token’s transfers'}{t.window ? ` · first ${t.window.blocks} blocks` : ''}</span>}
      {t.reason && <p className="m-0 text-[12px] text-muted">{t.reason}</p>}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-line bg-line">
        <Tile k="SNIPERS" v={t.snipers ? `${t.snipers.count}` : '—'} sub={t.snipers ? `${pct(t.snipers.pctOfSupply)} of supply` : undefined} tone="warn" />
        <Tile k="BUNDLED BUYERS" v={t.bundled ? `${t.bundled.count}` : '—'} sub={t.bundled ? `${pct(t.bundled.pctOfSupply)} of supply` : undefined} />
      </div>
      <EChart option={share} height={86} label="Share of supply held by snipers and bundled buyers" skeleton="bars" empty={!t.snipers && !t.bundled} emptyLabel="No launch buyers found" />
      {bundles.length > 0 && (
        <>
          <span className="font-mono text-[11px] tracking-[1px] text-dim">BUNDLES BY BLOCK · CLICK A BAR</span>
          <EChart option={option} height={150} label="Wallets that bought together, per block" onEvents={{ click: (p: ChartEvent) => setOpen((o) => (o === p.dataIndex ? null : p.dataIndex)) }} steps={{ count: bundles.length }} />
          {open !== null && bundles[open] && (
            <div className="flex animate-[gl-fade_.25s_ease_both] flex-col gap-1" data-deep-bundle>
              <span className="text-[12px] text-muted">Block {bundles[open].block}: {bundles[open].count} wallets bought in the same block.</span>
              <Wallets list={bundles[open].wallets} ex={ex} />
            </div>
          )}
        </>
      )}
      {t.snipers && t.snipers.wallets.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-mono text-[12px] text-muted hover:text-ink">
            <ChevronDown className="icon-sm transition-transform group-open:rotate-180" aria-hidden /> {t.snipers.wallets.length} sniper wallets
          </summary>
          <Wallets list={t.snipers.wallets} ex={ex} />
        </details>
      )}
    </Card>
  )
}

const ORIGIN: Record<DeepTrace['origin']['type'], string> = { exchange: 'Exchange', labelled: 'Known source', wallet: 'Unlabelled wallet', buy: 'Bought on a pool', cycle: 'Loop', unknown: 'Unknown' }

function Funding({ r, ex }: { r: DeepReport; ex: ReturnType<typeof explorer> }) {
  const f = r.sections.funding
  const traces = useMemo(() => f?.traces ?? [], [f])
  const [kind, setKind] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of traces) m.set(t.origin.type, (m.get(t.origin.type) ?? 0) + (t.pctOfSupply ?? 0))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [traces])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 58, top: 2, bottom: 2, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', inverse: true, data: groups.map((g) => ORIGIN[g[0] as DeepTrace['origin']['type']] ?? g[0]), axisLine: { show: false }, axisLabel: { color: C.ink2, fontSize: 12 } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const g = groups[ps[0]?.dataIndex]
        return g ? tipHtml({ title: ORIGIN[g[0] as DeepTrace['origin']['type']] ?? g[0], rows: [{ name: 'traced wallets', value: String(traces.filter((t) => t.origin.type === g[0]).length) }, { name: 'their share of supply', value: pct(g[1]) }], note: 'Click to list them.' }) : ''
      }, 'shadow'),
      series: [{ id: 'origins', ...barsPreset({ horizontal: true, stagger: 80 }), barWidth: 16, showBackground: true, backgroundStyle: { color: C.line, borderRadius: 4 }, label: { show: true, position: 'right', color: C.ink2, fontSize: 12, formatter: (p: ChartEvent) => pct(p.value) }, data: groups.map((g, i) => ({ value: g[1], itemStyle: { color: kind === g[0] ? C.goldHover : PALETTE[i % PALETTE.length], borderRadius: 4 } })) }],
    }),
    [groups, traces, kind],
  )
  if (!f || f.state === 'unavailable' || f.state === 'skipped') return <Card id="deep-funding" title={PART_NAMES.funding} state={f?.state ?? 'unavailable'}><Unavailable reason={f?.reason ?? r.unavailable.find((u) => u.section === 'funding')?.reason} /></Card>
  const shownTraces = kind ? traces.filter((t) => t.origin.type === kind) : traces
  return (
    <Card id="deep-funding" title={PART_NAMES.funding} state={f.state} source={f.sources?.join(' · ')} confidence={undefined}>
      {f.reason && <p className="m-0 text-[12px] text-muted">{f.reason}</p>}
      <span className="font-mono text-[11px] text-dim">
        {f.wallets ?? traces.length} wallets traced · up to {f.hopsMax ?? 3} hops each
      </span>
      {groups.length > 0 && (
        <>
          <span className="font-mono text-[11px] tracking-[1px] text-dim">WHERE THE FUNDS CAME FROM · CLICK A BAR</span>
          <EChart option={option} height={Math.max(70, groups.length * 30 + 10)} label="Where traced wallets were funded from, by share of supply" onEvents={{ click: (p: ChartEvent) => setKind((k) => (k === groups[p.dataIndex]?.[0] ? null : (groups[p.dataIndex]?.[0] ?? null))) }} steps={{ count: groups.length }} />
        </>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Traced wallets">
        {shownTraces.map((t) => {
          const on = open === t.address
          return (
            <li key={t.address} className="rounded-[8px] border border-line bg-surface-deep" data-deep-trace>
              <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : t.address)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-left">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-[12px] text-ink">
                    {t.role === 'deployer' ? 'Deployer ' : t.rank ? `#${t.rank} ` : ''}
                    {short(t.address)} {t.pctOfSupply !== null && <span className="text-muted">· {pct(t.pctOfSupply)}</span>}
                  </span>
                  <span className="truncate text-[12px] text-muted">
                    {ORIGIN[t.origin.type]}
                    {t.origin.label ? `: ${t.origin.label}` : t.origin.address ? `: ${short(t.origin.address)}` : ''} · {t.hops.length} hop{t.hops.length === 1 ? '' : 's'}
                  </span>
                </span>
                <ChevronDown className={`icon-md flex-none text-dim transition-transform ${on ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {on && (
                <ol className="m-0 flex animate-[gl-fade_.25s_ease_both] list-none flex-col gap-2 border-t border-line p-3" aria-label="Hops, newest funder last">
                  {t.hops.length === 0 && <li className="text-[12px] text-muted">{t.origin.reason ?? t.origin.note ?? 'No funding was found for this wallet.'}</li>}
                  {t.hops.map((h) => (
                    <li key={h.hop + h.tx} className="relative flex flex-col gap-1 border-l-2 pl-3" style={{ borderColor: K.gold }}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink">
                        <b className="font-mono text-gold">Hop {h.hop}</b>
                        <a href={ex.addr(h.from)} {...ext} className="font-mono text-muted hover:text-gold-hover">
                          {h.fromLabel ?? short(h.from)}
                        </a>
                        <span aria-hidden>→</span>
                        <a href={ex.addr(h.to)} {...ext} className="font-mono text-muted hover:text-gold-hover">
                          {short(h.to)}
                        </a>
                        <ConfPill c={h.confidence} />
                      </span>
                      <span className="font-mono text-[11px] text-dim">
                        {h.kind === 'native' ? 'native coin' : 'token'} · block {h.block}
                        {h.at ? ` · ${when(h.at)}` : ''} ·{' '}
                        <a href={ex.tx(h.tx)} {...ext} className="hover:text-gold-hover">
                          tx {short(h.tx)}
                        </a>{' '}
                        · source {h.source}
                      </span>
                    </li>
                  ))}
                  {t.origin.note && t.hops.length > 0 && <li className="text-[12px] text-muted">{t.origin.note}</li>}
                </ol>
              )}
            </li>
          )
        })}
      </ul>
      {(f.sharedFunders?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-dim">SHARED FUNDERS</span>
          {f.sharedFunders!.map((s) => (
            <div key={s.address} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-line px-3 py-2" data-deep-funder>
              <span className="flex min-w-0 flex-col">
                <a href={ex.addr(s.address)} {...ext} className="font-mono text-[12px] text-ink hover:text-gold-hover">
                  {s.label ?? short(s.address)} {s.exchange && <span className="text-dim">(exchange)</span>}
                </a>
                <span className="text-[12px] text-muted">funded {s.wallets.length} of the traced wallets{s.note ? ` · ${s.note}` : ''}</span>
              </span>
              <ConfPill c={s.confidence} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Clusters({ r, ex }: { r: DeepReport; ex: ReturnType<typeof explorer> }) {
  const c = r.sections.clusters
  const list = useMemo(() => c?.combined ?? [], [c])
  const [sel, setSel] = useState<number | null>(null)
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 58, top: 2, bottom: 2, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', inverse: true, data: list.map((_x, i) => `Cluster ${i + 1}`), axisLine: { show: false }, axisLabel: { color: C.ink2, fontSize: 12 } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const x = list[ps[0]?.dataIndex]
        return x ? tipHtml({ title: `Cluster ${ps[0].dataIndex + 1}`, rows: [{ name: 'wallets', value: String(x.count) }, { name: 'share of supply', value: pct(x.pctOfSupply) }, { name: 'confidence', value: x.confidence }], note: 'Click to list the wallets.' }) : ''
      }, 'shadow'),
      series: [{ id: 'clusters', ...barsPreset({ horizontal: true, stagger: 80 }), barWidth: 16, showBackground: true, backgroundStyle: { color: C.line, borderRadius: 4 }, label: { show: true, position: 'right', color: C.ink2, fontSize: 12, formatter: (p: ChartEvent) => pct(p.value) }, data: list.map((x, i) => ({ value: x.pctOfSupply ?? 0, itemStyle: { color: sel === i ? C.goldHover : C.gold, borderRadius: 4 } })) }],
    }),
    [list, sel],
  )
  if (!c || c.state === 'unavailable' || c.state === 'skipped') return <Card id="deep-clusters" title={PART_NAMES.clusters} state={c?.state ?? 'unavailable'}><Unavailable reason={c?.reason ?? r.unavailable.find((u) => u.section === 'clusters')?.reason} /></Card>
  const BASIS: Record<string, string> = { 'direct-transfers': 'wallets that sent the token to each other', 'shared-funder': 'wallets first funded by the same address', 'direct-transfers+shared-funder': 'sent each other the token and share a funder' }
  return (
    <Card id="deep-clusters" title={PART_NAMES.clusters} state={c.state}>
      {c.reason && <p className="m-0 text-[12px] text-muted">{c.reason}</p>}
      {list.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">No wallet clusters were found among the wallets checked.</p>
      ) : (
        <>
          <EChart option={option} height={Math.max(70, list.length * 30 + 10)} label="Share of supply per cluster" onEvents={{ click: (p: ChartEvent) => setSel((s) => (s === p.dataIndex ? null : p.dataIndex)) }} steps={{ count: list.length }} />
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {list.map((x, i) => (
              <li key={x.id} className={`rounded-[8px] border bg-surface-deep ${sel === i ? 'border-gold' : 'border-line'}`} data-deep-cluster>
                <button type="button" aria-expanded={sel === i} onClick={() => setSel(sel === i ? null : i)} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-left">
                  <span className="flex flex-col">
                    <span className="text-[13px] font-semibold text-ink">
                      Cluster {i + 1} · {x.count} wallets · {pct(x.pctOfSupply)}
                    </span>
                    <span className="text-[12px] text-muted">{BASIS[x.basis] ?? x.basis}</span>
                  </span>
                  <ConfPill c={x.confidence} />
                </button>
                {sel === i && (
                  <div className="animate-[gl-fade_.25s_ease_both] border-t border-line p-3">
                    <Wallets list={x.wallets} ex={ex} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

const OUT: Record<string, { tone: PillTone; text: string }> = { trading: { tone: 'ok', text: 'Still trading' }, 'liquidity-pulled': { tone: 'error', text: 'Liquidity pulled' }, 'deployer-sold': { tone: 'warn', text: 'Deployer sold' }, unknown: { tone: 'off', text: 'Unknown outcome' } }
function Deployer({ r, ex }: { r: DeepReport; ex: ReturnType<typeof explorer> }) {
  const d = r.sections.deployer
  if (!d || d.state === 'unavailable' || d.state === 'skipped') return <Card id="deep-deployer" title={PART_NAMES.deployer} state={d?.state ?? 'unavailable'}><Unavailable reason={d?.reason ?? r.unavailable.find((u) => u.section === 'deployer')?.reason} /></Card>
  const tokens = d.tokens ?? []
  return (
    <Card id="deep-deployer" title={PART_NAMES.deployer} state={d.state} source={d.source}>
      {d.reason && <p className="m-0 text-[12px] text-muted">{d.reason}</p>}
      {d.address && (
        <span className="text-[13px] text-muted">
          Deployer{' '}
          <a href={ex.addr(d.address)} {...ext} className="font-mono text-ink hover:text-gold-hover">
            {short(d.address)}
          </a>{' '}
          · {tokens.length} other token{tokens.length === 1 ? '' : 's'} found
        </span>
      )}
      {tokens.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="The deployer's other tokens">
          {tokens.map((t) => (
            <li key={t.chain + t.address} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-line bg-surface-deep px-3 py-2" data-deep-token>
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[12px] text-ink">
                  {t.symbol ? `$${t.symbol}` : short(t.address)} <span className="text-dim">on {t.chain}</span>
                </span>
                <span className="text-[11px] text-dim">source {t.source}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusPill tone={OUT[t.outcome]?.tone ?? 'off'}>{OUT[t.outcome]?.text ?? t.outcome}</StatusPill>
                <ConfPill c={t.confidence} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {(d.chains?.length ?? 0) > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Chains searched for the deployer's other tokens">
          {d.chains!.map((c) => (
            <li key={c.chain}>
              <StatusPill tone={c.state === 'ok' ? 'ok' : c.state === 'partial' ? 'warn' : 'off'} title={c.reason}>
                {c.name}: {c.state === 'ok' || c.state === 'partial' ? `${c.tokens} tokens` : 'not read'}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Findings({ r }: { r: DeepReport }) {
  const [sec, setSec] = useState<string | null>(null)
  const secs = [...new Set(r.findings.map((f) => f.section))]
  const list = sec ? r.findings.filter((f) => f.section === sec) : r.findings
  if (r.findings.length === 0) return null
  return (
    <section aria-labelledby="deep-findings-h" className="card card-pad flex flex-col gap-3" data-deep-findings>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="deep-findings-h" className="heading-4">
          Findings · {r.findings.length}
        </h3>
        <span className="flex flex-wrap gap-1" role="group" aria-label="Filter by part">
          <button type="button" aria-pressed={!sec} onClick={() => setSec(null)} className={chip(!sec)}>
            All
          </button>
          {secs.map((s) => (
            <button key={s} type="button" aria-pressed={sec === s} onClick={() => setSec(sec === s ? null : s)} className={chip(sec === s)}>
              {PART_NAMES[s as PartKey] ?? s}
            </button>
          ))}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {list.map((f, i) => (
          <li key={f.id} className="flex animate-[gl-fade_.3s_ease_both] flex-col gap-1 rounded-[8px] border border-line bg-surface-deep px-3 py-2" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} data-deep-finding>
            <span className="text-[14px] leading-[1.5] text-ink">{f.text}</span>
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill tone="neutral">{PART_NAMES[f.section as PartKey] ?? f.section}</StatusPill>
              <ConfPill c={f.confidence} />
              <span className="font-mono text-[11px] text-dim">Source: {f.source}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DeepReportView({ check, report }: { check: DeepCheck; report: DeepReport }) {
  const ex = useMemo(() => explorer(report.token.url, report.chain.key), [report])
  const t = report.sections.trading
  const cl = report.sections.clusters?.combined ?? []
  const dep = report.sections.deployer
  const used = report.budget?.used
  const lim = report.budget?.limits
  const pageUrl = typeof window !== 'undefined' ? window.location.href : check.url
  return (
    <div className="flex flex-col gap-3" data-deep-report={report.status}>
      {report.status === 'partial' && report.partial && (
        <section className="rounded-[12px] border border-gold/40 bg-surface px-4 py-3" data-deep-partial role="status">
          <b className="flex items-center gap-2 text-[14px] text-gold">
            <AlertTriangle className="icon-md" aria-hidden /> Partial result: some parts stopped early
          </b>
          <ul className="m-0 mt-1 list-disc pl-5 text-[13px] leading-[1.55] text-muted">
            {report.partial.reasons.map((x) => (
              <li key={x.code}>{x.text}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line min-[760px]:grid-cols-4" data-deep-summary>
        <Tile k="SNIPERS" v={t?.snipers ? pct(t.snipers.pctOfSupply) : 'n/a'} sub={t?.snipers ? `${t.snipers.count} wallets` : 'not read'} tone={t?.snipers && (t.snipers.pctOfSupply ?? 0) >= 10 ? 'warn' : 'gold'} />
        <Tile k="BUNDLED" v={t?.bundled ? pct(t.bundled.pctOfSupply) : 'n/a'} sub={t?.bundled ? `${t.bundled.count} wallets` : 'not read'} tone={t?.bundled && (t.bundled.pctOfSupply ?? 0) >= 5 ? 'warn' : 'gold'} />
        <Tile k="CLUSTERS" v={report.sections.clusters && report.sections.clusters.state !== 'unavailable' ? String(cl.length) : 'n/a'} sub={cl[0] ? `largest ${pct(cl[0].pctOfSupply)}` : 'none found'} tone={cl.length ? 'warn' : 'gold'} />
        <Tile k="DEPLOYER" v={dep && dep.state !== 'unavailable' ? String(dep.tokens?.length ?? 0) : 'n/a'} sub={dep && dep.state !== 'unavailable' ? 'other tokens' : 'not read'} tone="dim" />
      </div>
      <Findings r={report} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-3">
        <Trading r={report} ex={ex} />
        <Funding r={report} ex={ex} />
        <Clusters r={report} ex={ex} />
        <Deployer r={report} ex={ex} />
      </div>
      {report.unavailable.length > 0 && (
        <section className="card card-pad flex flex-col gap-2" data-deep-unavailable-list>
          <h3 className="heading-4">What could not be read, and why</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {report.unavailable.map((u, i) => (
              <li key={i} className="text-[13px] leading-[1.5] text-muted">
                <b className="text-ink">{u.what}</b> ({PART_NAMES[u.section as PartKey] ?? u.section}): {u.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => copyWithToast(pageUrl, 'Report link')} className={chip(false)}>
          <Copy className="icon-sm" aria-hidden /> Copy report link
        </button>
        <a href={report.token.url} {...ext} className={chip(false)}>
          <ExternalLink className="icon-sm" aria-hidden /> Token on the explorer
        </a>
        <span className="font-mono text-[11px] text-dim">Computed {when(report.generatedAt)}. Anyone with this link can read this report.</span>
      </div>
      {report.notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-[11px] leading-[1.5] text-dim">
          {report.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {used && lim && (
        <p className="m-0 font-mono text-[11px] leading-[1.5] text-dim" data-deep-budget>
          Work done: {used.rpcCalls ?? 0} of {lim.rpcCalls} chain reads, {used.explorerCalls ?? 0} of {lim.explorerCalls} explorer reads, {Math.round((used.ms ?? 0) / 1000)} s of {Math.round((lim.ms ?? 0) / 1000)} s. A check that reaches a limit ends partial and says so. Information only, not advice.
        </p>
      )}
    </div>
  )
}
