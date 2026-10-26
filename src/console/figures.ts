/* One live figure per product card (the same reads on the landing, /products and each product page). */
import { C, fmtPct } from './charts'
import { type Live } from './live'
import type { ProductFigure, ProductKey } from './ui'

export function productFigures(l: Live): Record<ProductKey, ProductFigure> {
  const blocks = l.chain?.blocks ?? []
  const gaps = blocks.slice(1).map((b, i) => b.time - blocks[i].time)
  const sec = (l.status?.components ?? []).filter((c) => /^(security|monitors)$/.test(c.id))
  const holders = (l.status?.components ?? []).filter((c) => c.group === 'holders')
  const hUp = holders.some((c) => c.uptime24h != null) ? Math.round(Math.min(...holders.filter((c) => c.uptime24h != null).map((c) => c.uptime24h as number)) * 1000) / 10 : null
  const pay = l.products?.pay ?? null
  const rpc = l.products?.rpc ?? null
  const ipfs = l.ipfs
  const secUp = sec.some((c) => c.uptime24h != null) ? Math.round(Math.min(...sec.filter((c) => c.uptime24h != null).map((c) => c.uptime24h as number)) * 1000) / 10 : null
  return {
    chain: { value: l.chain?.head, label: 'latest block · testnet', spark: gaps, color: C.s[0] },
    // Gully Pay's own status (gullypay.xyz/api/status): services operational, one point a minute.
    pay: { value: pay?.up ?? null, fmt: pay ? (v) => `${v}/${pay.total}` : undefined, label: pay ? `services operational · Gully Pay${pay.status ? ` · ${pay.status}` : ''}` : 'Gully Pay status · reading', spark: (pay?.history ?? []).map((h) => h.v), color: C.s[1] },
    // Gully RPC's own status.json: networks served (live or beta) out of those listed.
    rpc: { value: rpc?.served ?? null, fmt: rpc ? (v) => `${v}/${rpc.total}` : undefined, label: rpc ? `networks served · Gully RPC${rpc.gullyChain ? ', Gully Chain included' : ''}` : 'Gully RPC status · reading', spark: (rpc?.history ?? []).map((h) => h.v), color: C.s[1] },
    // Gully IPFS: pinned CIDs from the node; when only the gateway answers, its response time.
    ipfs: ipfs?.pinned != null ? { value: ipfs.pinned, label: 'CIDs pinned · Gully IPFS', spark: ipfs.history.map((h) => h.pinned), color: C.s[0] } : { value: ipfs?.gatewayMs ?? null, fmt: (v) => `${Math.round(v)} ms`, label: ipfs?.gatewayUp ? 'gateway response · Gully IPFS' : 'Gully IPFS gateway · not reachable yet', spark: (ipfs?.history ?? []).map((h) => h.ms), color: C.s[0] },
    // HolderMaps' own holder sources (GET /api/status, group holders): the weakest one's 24 h uptime.
    holders: { value: hUp, fmt: fmtPct, label: holders.length ? `uptime 24h · ${holders.length} HolderMaps sources` : 'HolderMaps sources · reading', spark: (holders[0]?.history ?? []).map((_, i) => (holders.every((c) => c.history[i]?.up == null) ? null : Math.round(Math.min(...holders.map((c) => c.history[i]?.up ?? 1)) * 1000) / 10)), color: C.s[2] },
    security: { value: secUp, fmt: fmtPct, label: sec.length ? 'uptime 24h · scan engine + monitors' : 'chains scanned', spark: (sec[0]?.history ?? []).map((h) => h.up), color: C.s[0] },
    studio: { value: l.arcade?.players ?? null, label: l.arcade ? `players · Frog Hop season ${l.arcade.season} · testnet` : 'Frog Hop players · testnet', spark: l.arcade?.history ?? [], color: C.s[3] },
  }
}
