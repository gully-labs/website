import { useMemo, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { fmtTime, fmtUsd } from '../lib/stats'
import { addressUrl, useOnchain, type OnchainChain, type OnchainContract, type OnchainDoc } from '../lib/peddles'
import { Figure } from './landing/Figure'
import { EChart } from './charts/EChart'
import { ChartBox } from './charts/ChartSkeleton'
import { C } from './charts/chartPresets'
import { esc, type ChartEvent } from './charts/chart-utils'
import { segBtn, segGroup } from './ui/seg'

/* Peddles and PeddleQuest, read from their own contracts (GET /api/peddles/onchain, server/peddles.mjs). Every
   figure names the contract it is read from, linked to that chain's explorer, and every contract in Peddles'
   docs is listed with whether it has code on chain. Nothing here is typed in: a figure the scan has not reached
   yet says so ("so far"), and a contract that could not be checked says that instead of a tick. */

type Venue = 'peddles' | 'peddlequest'
const cardTitle = 'm-0 font-display text-[28px] font-bold uppercase'

function Count({ value }: { value: number }) {
  return (
    <span className="inline-block">
      <span aria-hidden>
        <NumberFlow value={value} format={{ maximumFractionDigits: value < 100 ? 2 : 0 }} locales="en-US" willChange />
      </span>
      <span className="sr-only">{value.toLocaleString('en-US')}</span>
    </span>
  )
}

const SHORT: Record<number, string> = { 8453: 'Base', 4663: 'Robinhood', 5042: 'Arc', 56: 'BNB' }

/** Each contract a figure is read from, with a link to it on every chain where Peddles' docs list it and it has code. */
function Sources({ doc, names }: { doc: OnchainDoc; names: string[] }) {
  const rows = names
    .map((name) => ({ name, links: doc.chains.flatMap((c) => (doc.contracts[c.chainId] ?? []).filter((k) => k.name === name && k.verified).map((k) => ({ c, k }))) }))
    .filter((r) => r.links.length)
  if (!rows.length) return null
  return (
    <span className="flex flex-col gap-[2px] font-mono text-[11px] leading-[1.6] text-faint">
      {rows.map((r) => (
        <span key={r.name} className="flex flex-wrap gap-x-2">
          <span>{r.name}</span>
          {r.links.map(({ c, k }) => (
            <a key={c.chainId} href={addressUrl(c, k.address)} target="_blank" rel="noopener noreferrer" className="text-muted underline decoration-line-strong underline-offset-2 hover:text-ink" title={`${k.name} on ${c.name}: ${k.address}`}>
              {SHORT[c.chainId] ?? c.name}↗
            </a>
          ))}
        </span>
      ))}
    </span>
  )
}

interface Tile {
  label: string
  value: number
  usd: boolean
  sub?: string
  from: string[]
}

function tilesOf(venue: Venue, chains: OnchainChain[]): Tile[] {
  const s = (f: (c: OnchainChain) => number) => chains.reduce((a, c) => a + f(c), 0)
  if (venue === 'peddlequest')
    return [
      { label: 'QUESTS CREATED', value: s((c) => c.quests), usd: false, from: ['PeddlesQuestEscrow'] },
      { label: 'REWARD POOLS FUNDED', value: s((c) => c.questRewardsUsd), usd: true, sub: s((c) => c.questUnpriced) ? `${s((c) => c.questUnpriced)} in assets with no price feed, not valued` : undefined, from: ['PeddlesQuestEscrow'] },
      { label: 'FEES ALL-TIME', value: s((c) => c.questFeesUsd), usd: true, sub: 'quest, promotion and badge fees', from: ['PeddlesQuestEscrow', 'PeddlesPromotionMarket', 'PeddlesQuestBadge'] },
    ]
  const fees = { swap: s((c) => c.feesBy.swap), opening: s((c) => c.feesBy.opening), launch: s((c) => c.feesBy.launch), terminal: s((c) => c.feesBy.terminal) }
  const burned = s((c) => c.pedlBurned)
  const tvls = chains.map((c) => c.tvlQuoteUsd)
  return [
    { label: 'LAUNCHES', value: s((c) => c.launches), usd: false, sub: `${s((c) => c.launches24h)} in the last 24h`, from: ['PeddlesFeeHook'] },
    { label: 'SWAPS', value: s((c) => c.swaps), usd: false, sub: `${s((c) => c.swaps24h)} in the last 24h${s((c) => c.unpricedSwaps) ? ` · ${s((c) => c.unpricedSwaps)} not valued (no price feed)` : ''}`, from: ['PoolManager'] },
    { label: 'VOLUME 7 DAYS', value: s((c) => c.volume7dUsd), usd: true, sub: `30 days ${fmtUsd(s((c) => c.volume30dUsd))}`, from: ['PoolManager'] },
    { label: 'FEES ALL-TIME', value: s((c) => c.feesAllUsd), usd: true, sub: `swaps ${fmtUsd(fees.swap)} · opening ${fmtUsd(fees.opening)} · launches ${fmtUsd(fees.launch)} · Terminal and bot ${fmtUsd(fees.terminal)}`, from: ['PeddlesFeeHook', 'PeddlesStockLaunchpad', 'PeddlesLaunchOrchestratorV20', 'PeddlesFeeForwarder'] },
    { label: 'PAID TO CREATORS', value: s((c) => c.creatorsPaidUsd), usd: true, from: ['PeddlesFeeHook'] },
    { label: 'PAID TO HOLDERS', value: s((c) => c.holdersPaidUsd), usd: true, sub: 'holders of each launched token', from: ['PeddlesFeeHook'] },
    ...(tvls.every((x) => x !== null) ? [{ label: 'PAIRED ASSETS IN POOLS', value: tvls.reduce((a, b) => a + (b ?? 0), 0), usd: true, sub: 'the ETH, BNB, USDC or stock side of every launch pool; launched tokens not valued', from: ['PoolManager'] }] : []),
    { label: 'NFT COLLECTIONS', value: s((c) => c.collections), usd: false, from: ['PeddlesNFTFactory'] },
    ...(burned > 0 ? [{ label: 'PEDL BURNED', value: burned, usd: false, sub: `${fmtUsd(s((c) => c.buybackUsd))} of ETH spent on buybacks`, from: ['PeddlesFlywheel'] }] : []),
  ]
}

type Metric = 'volumeAllUsd' | 'feesAllUsd' | 'launches' | 'swaps' | 'quests' | 'questFeesUsd'
const METRICS: Record<Venue, { id: Metric; label: string; usd: boolean }[]> = {
  peddles: [
    { id: 'volumeAllUsd', label: 'Volume', usd: true },
    { id: 'feesAllUsd', label: 'Fees', usd: true },
    { id: 'launches', label: 'Launches', usd: false },
    { id: 'swaps', label: 'Swaps', usd: false },
  ],
  peddlequest: [
    { id: 'quests', label: 'Quests', usd: false },
    { id: 'questFeesUsd', label: 'Fees', usd: true },
  ],
}
const ROW = 40

/** Each chain's figure as a bar; switching the figure glides the bars to their new lengths. */
function ChainBars({ chains, venue, accent }: { chains: OnchainChain[]; venue: Venue; accent: string }) {
  const [metric, setMetric] = useState<Metric>(METRICS[venue][0].id)
  const m = METRICS[venue].find((x) => x.id === metric) ?? METRICS[venue][0]
  const rows = chains.map((c) => ({ c, v: c[m.id] as number })).sort((a, b) => b.v - a.v)
  const fmt = (v: number) => (m.usd ? fmtUsd(v) : v.toLocaleString('en-US'))
  const key = `${m.id}|${rows.map((r) => `${r.c.key}=${r.v}`).join()}`
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 80, top: 4, bottom: 4, containLabel: false },
      xAxis: { type: 'value', show: false, max: (x: { max: number }) => x.max * 1.08 || 1 },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.c.name), axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      tooltip: { trigger: 'item', confine: true, formatter: (p: ChartEvent) => `<b>${esc(rows[p.dataIndex]?.c.name ?? '')}</b><br/>${esc(m.label)}: ${esc(fmt(Number(p.value)))}` },
      series: [
        {
          type: 'bar',
          barWidth: 18,
          showBackground: true,
          backgroundStyle: { color: C.line, borderRadius: 4 },
          label: { show: true, position: 'right', color: C.ink2, fontSize: 12, formatter: (p: ChartEvent) => fmt(Number(p.value)) },
          data: rows.map((r) => ({ value: r.v, itemStyle: { color: accent, borderRadius: 4 } })),
          animationDelay: (i: number) => i * 90,
        },
      ],
      animationDurationUpdate: 650,
      animationEasingUpdate: 'cubicInOut',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, accent],
  )
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Figure by chain" className={`${segGroup} flex-wrap`}>
        {METRICS[venue].map((x) => (
          <button key={x.id} type="button" aria-pressed={metric === x.id} onClick={() => setMetric(x.id)} className={segBtn(metric === x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <ul className="m-0 flex list-none flex-col p-0 pt-1" aria-hidden>
          {rows.map((r) => (
            <li key={r.c.key} className="flex items-center text-[13px] text-ink-2" style={{ height: ROW }}>
              {r.c.name}
            </li>
          ))}
        </ul>
        <EChart option={option} height={rows.length * ROW + 8} label={`${m.label} by chain, read on chain: ${rows.map((r) => `${r.c.name} ${fmt(r.v)}`).join(', ')}.`} steps={{ count: rows.length }} />
      </div>
    </div>
  )
}

function Contracts({ doc }: { doc: OnchainDoc }) {
  const all = doc.chains.flatMap((c) => (doc.contracts[c.chainId] ?? []).map((k) => ({ c, k })))
  const ok = all.filter((x) => x.k.verified).length
  const bad = all.filter((x) => x.k.verified === false)
  return (
    <details className="group rounded-tile border border-line bg-surface-deep">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-mono text-[12px] text-ink-2">
        <span>
          Every contract in Peddles’ docs · {all.length} on {doc.chains.length} chains · {ok} with code on chain{bad.length ? ` · ${bad.length} without` : ''}
        </span>
        <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {doc.chains.map((c) => (
          <div key={c.chainId} className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse font-mono text-[11px]">
              <caption className="pb-1 text-left text-[12px] text-ink-2">{c.name}</caption>
              <thead>
                <tr className="text-left text-faint">
                  <th className="py-1 pr-3 font-normal">Contract</th>
                  <th className="py-1 pr-3 font-normal">Address</th>
                  <th className="py-1 pr-3 font-normal">On chain</th>
                  <th className="py-1 font-normal">What we read</th>
                </tr>
              </thead>
              <tbody>
                {(doc.contracts[c.chainId] ?? []).map((k: OnchainContract) => (
                  <tr key={k.name} className="border-t border-line align-top">
                    <td className="py-1 pr-3 text-ink-2">{k.name}</td>
                    <td className="py-1 pr-3">
                      {k.verified ? (
                        <a href={addressUrl(c, k.address)} target="_blank" rel="noopener noreferrer" className="text-muted underline decoration-line-strong underline-offset-2 hover:text-ink">
                          {k.address.slice(0, 8)}…{k.address.slice(-6)} ↗
                        </a>
                      ) : (
                        <span className="text-muted">{k.address.slice(0, 8)}…{k.address.slice(-6)}</span>
                      )}
                    </td>
                    <td className={`py-1 pr-3 ${k.verified ? 'text-green' : k.verified === false ? 'text-error' : 'text-faint'}`}>{k.verified ? 'code ✓' : k.verified === false ? 'no code' : 'not checked yet'}</td>
                    <td className="py-1 text-muted">{k.reads.length ? k.reads.join(' · ') : 'listed, not read'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  )
}

export function OnchainPanel({ venue, accent }: { venue: Venue; accent: string }) {
  const st = useOnchain()
  const doc = st.k === 'ok' ? st.data : null
  const chains = doc?.chains ?? []
  const progress = chains.length ? chains.reduce((a, c) => a + c.progress, 0) / chains.length : 0
  const tiles = doc ? tilesOf(venue, chains) : []
  return (
    <section aria-labelledby={`${venue}-onchain`} className="flex flex-col gap-5 rounded-card border border-line bg-surface p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={`${venue}-onchain`} className={cardTitle}>
            On chain
          </h2>
          <span className="font-mono text-[12px] text-faint">Read from the {venue === 'peddles' ? 'Peddles' : 'PeddleQuest'} contracts on {chains.map((c) => c.name).join(', ') || 'four chains'}, by our own server.</span>
        </div>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-2">
          {doc?.live ? (
            <>
              <span aria-hidden className="size-[6px] rounded-full bg-green" style={{ animation: 'gl-pulse-ring 1.8s infinite' }} />
              LIVE · read {fmtTime(doc.at)}
            </>
          ) : doc ? (
            `scanning the chains · ${Math.round(progress * 100)}% · figures so far`
          ) : st.k === 'error' ? (
            'could not be read'
          ) : (
            'reading…'
          )}
        </span>
      </div>

      {!doc ? (
        <ChartBox height={220} state={st.k === 'error' ? 'error' : 'loading'} message="The chain scan could not be read just now. Try again in a minute." />
      ) : (
        <>
          {!doc.live && (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3 p-0" aria-label="Scan progress by chain">
              {chains.map((c) => (
                <li key={c.chainId} className="flex flex-col gap-1 font-mono text-[11px] text-muted">
                  <span>
                    {c.name} · {Math.round(c.progress * 100)}%{c.error ? ' · retrying' : ''}
                  </span>
                  <span className="h-[6px] overflow-hidden rounded-full bg-line" aria-hidden>
                    <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${c.progress * 100}%`, background: accent }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
            {tiles.map((t) => (
              <div key={t.label} className="flex flex-col gap-[6px] bg-surface px-6 py-5">
                <dt className="font-mono text-[11px] tracking-[1px] text-faint">{t.label}</dt>
                <dd className="m-0 flex flex-col gap-2">
                  <b className="font-display text-[34px] leading-none font-bold">{t.usd ? <Figure value={t.value} /> : <Count value={t.value} />}</b>
                  {t.sub && <span className="font-mono text-[11px] leading-[1.5] text-muted">{t.sub}</span>}
                  <Sources doc={doc} names={t.from} />
                </dd>
              </div>
            ))}
          </dl>
          <ChainBars chains={chains} venue={venue} accent={accent} />
          {venue === 'peddles' && <Contracts doc={doc} />}
        </>
      )}
    </section>
  )
}
