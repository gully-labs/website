/* One live figure per product card (the same reads on the landing, /products and each product page). */
import { C, fmtPct } from './charts'
import { okVenues, summed, venueSeries, type Live } from './live'
import type { ProductFigure, ProductKey } from './ui'

export function productFigures(l: Live): Record<ProductKey, ProductFigure> {
  const s = l.stats
  const ok = s ? okVenues(s) : []
  const tvl20 = s ? venueSeries(s, 'tvl', 20).series : []
  const blocks = l.chain?.blocks ?? []
  const gaps = blocks.slice(1).map((b, i) => b.time - blocks[i].time)
  const sec = (l.status?.components ?? []).filter((c) => /^(security|monitors)$/.test(c.id))
  const secUp = sec.length ? Math.round(Math.min(...sec.map((c) => c.uptime24h ?? 0)) * 1000) / 10 : null
  return {
    chain: { value: l.chain?.head, label: 'latest block · testnet', spark: gaps, color: C.s[0] },
    pay: { value: l.payChains, label: 'payment chains · Gully Pay', spark: s ? summed(s, 'fees').slice(-14) : [], color: C.s[1] },
    rpc: { value: l.rpcMs.length ? l.rpcMs[l.rpcMs.length - 1] : null, label: 'ms · testnet RPC latency', spark: l.rpcMs, color: C.s[1] },
    holders: { value: (ok.find((v) => v.key === 'peddles')?.counts?.users as number | null | undefined) ?? null, label: 'users · Peddles venue', spark: tvl20.find((x) => x.key === 'peddles')?.values ?? [], color: C.s[2] },
    security: { value: secUp, fmt: fmtPct, label: sec.length ? 'uptime 24h · scan engine + monitors' : 'chains scanned', spark: (sec[0]?.history ?? []).map((h) => h.up), color: C.s[0] },
    studio: { value: l.arcade?.players ?? null, label: l.arcade ? `players · Frog Hop season ${l.arcade.season} · testnet` : 'Frog Hop players · testnet', spark: l.arcade?.history ?? [], color: C.s[3] },
  }
}
