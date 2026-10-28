/* The venue and Gully Chain chart tabs shared by the product pages (moved from the landing v3 Home when the
   "Constellation" landing replaced it, 2026-10-27). */
import { fmtInt, fmtTime, fmtUsd } from '../console/charts'
import { coversOf, totalOf, venueSeries, type Live } from '../console/live'
import { ACCENT, fmtCompact, hourLabel, S, sum, type ChartTab, type HubProducts } from './kit'

export function venueTabs(live: Live): ChartTab[] {
  const { stats, statsState } = live
  const st = stats ? 'ok' : statsState === 'error' ? 'offline' : 'loading'
  const tab = (m: 'tvl' | 'volume' | 'fees', label: string, title: string, what: string): ChartTab => {
    const vs = stats ? venueSeries(stats, m, 30) : { series: [], labels: [] }
    return {
      id: m,
      label,
      title,
      series: vs.series,
      labels: vs.labels,
      fmt: (v) => fmtUsd(v),
      stacked: true,
      state: st,
      empty: 'venue APIs could not be read · retrying',
      head: stats ? fmtUsd(totalOf(stats, m)) : '—',
      sub: stats ? `${what} · ${coversOf(stats, m).length} of ${stats.venues.length} venues · read ${fmtTime(stats.generatedAt)}` : 'reading venue APIs',
    }
  }
  return [tab('tvl', 'Value locked', 'Value locked by venue, 30 days (USD)', 'USD value locked now'), tab('volume', 'Volume', 'Daily volume by venue, 30 days (USD)', 'USD volume, all-time'), tab('fees', 'Fees', 'Daily fees by venue, 30 days (USD)', 'USD fees, all-time')]
}

export function chainTabs(hp: HubProducts | null, state: string): ChartTab[] {
  const h = hp?.chain?.hourly ?? []
  const a = hp?.activity?.hourly ?? []
  const labels = h.map((x) => hourLabel(x.t))
  const off = state === 'error' || (hp && !hp.chain) ? 'offline' : !hp ? 'loading' : 'ok'
  const offA = state === 'error' || (hp && !hp.activity) ? 'offline' : !hp ? 'loading' : 'ok'
  const idle = (xs: number[]) => (xs.every((v) => v === 0) ? 'quiet: no transactions in the last 24 h' : undefined)
  const t = (id: string, label: string, key: string, color: string, unit: string): ChartTab => ({
    id,
    label,
    title: `Gully Chain testnet, ${label.toLowerCase()} per hour, last 24 h`,
    series: [{ name: label, color, values: h.map((x) => x[key]) }],
    labels,
    fmt: (v) => fmtInt(v),
    state: off,
    empty: 'Gully Chain RPC could not be read from the server · retrying',
    head: hp?.chain ? fmtCompact(sum(h.map((x) => x[key]))) : '—',
    sub: hp?.chain ? `${unit}, last 24 h · head #${hp.chain.head.toLocaleString('en-US')}${idle(h.map((x) => x[key])) ? ` · ${idle(h.map((x) => x[key]))}` : ''}` : hp ? 'chain RPC unreadable from the server right now' : 'reading chain 485590',
  })
  return [
    t('txs', 'Transactions', 'txs', ACCENT, 'user transactions'),
    t('blocks', 'Blocks', 'blocks', S[1], 'blocks'),
    t('gas', 'Gas', 'gas', S[2], 'gas used'),
    {
      id: 'activity',
      label: 'Launches & trades',
      title: 'Gully Chain launches, curve trades and swaps per hour (indexer feed)',
      series: [
        { name: 'Launches', color: ACCENT, values: a.map((x) => x.launches) },
        { name: 'Trades', color: S[1], values: a.map((x) => x.trades) },
        { name: 'Swaps', color: S[2], values: a.map((x) => x.swaps) },
      ],
      labels: a.map((x) => hourLabel(x.t)),
      fmt: (v) => fmtInt(v),
      stacked: true,
      state: offA,
      empty: 'indexer feed could not be read · retrying',
      head: hp?.activity ? fmtInt(sum(a.map((x) => x.launches + x.trades + x.swaps))) : '—',
      sub: hp?.activity ? `launches, trades and swaps, last 24 h · from the newest ${hp.activity.events} indexer events` : hp ? 'indexer unreadable from the server right now' : 'reading the indexer',
    },
  ]
}
