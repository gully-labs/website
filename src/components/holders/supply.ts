import { INFRA_KINDS, type HolderLabelKind, type HolderMapOk, type HolderNode } from '../../lib/holders'
import { clusterHue, KIND_HUE, WALLET_HUE, type KindKey } from './palette'

/* The supply split under the map: pure sums of the server's per-wallet shares (see SupplyStrip.tsx). */

const INFRA = new Set<HolderLabelKind>(INFRA_KINDS)
export const isInfraNode = (n: HolderNode) => (!!n.label && INFRA.has(n.label.kind)) || (!n.label && n.contract === true)
export const kindKeyOf = (n: HolderNode): KindKey | null => n.label?.kind ?? (n.contract ? 'contract' : null)

export interface SupplyData {
  segs: {
    key: string
    label: string
    hue: string
    pct: number
    count: number
  }[]
  top10: number
  clustered: number
  infra: number
  rest: number
}

export function supplyOf(m: HolderMapOk, pctAt: (n: HolderNode) => number | null): SupplyData {
  const people = m.nodes.filter((n) => !isInfraNode(n))
  const top = new Set(people.slice(0, 10).map((n) => n.id))
  const cIdx = new Map(m.clusters.map((c, i) => [c.id, i]))
  const v = (n: HolderNode) => Math.max(0, pctAt(n) ?? 0)
  let infra = 0
  let nInfra = 0
  let top10 = 0
  let nTop = 0
  const byCluster = new Map<string, { pct: number; count: number }>()
  for (const n of m.nodes) {
    if (isInfraNode(n)) {
      infra += v(n)
      nInfra++
    } else if (n.cluster && cIdx.has(n.cluster)) {
      const c = byCluster.get(n.cluster) ?? { pct: 0, count: 0 }
      c.pct += v(n)
      c.count++
      byCluster.set(n.cluster, c)
    } else if (top.has(n.id)) {
      top10 += v(n)
      nTop++
    }
  }
  const clustered = [...byCluster.values()].reduce((s, c) => s + c.pct, 0)
  const rest = Math.max(0, 100 - infra - clustered - top10)
  const segs: SupplyData['segs'] = []
  if (infra > 0)
    segs.push({
      key: 'infra',
      label: 'Pools and contracts',
      hue: KIND_HUE.pool,
      pct: infra,
      count: nInfra,
    })
  for (const c of m.clusters) {
    const x = byCluster.get(c.id)
    if (x && x.pct > 0)
      segs.push({
        key: `c:${c.id}`,
        label: `Cluster ${c.id.toUpperCase()}`,
        hue: clusterHue(cIdx.get(c.id) ?? 0),
        pct: x.pct,
        count: x.count,
      })
  }
  if (top10 > 0)
    segs.push({
      key: 'top10',
      label: 'Other top-10 wallets',
      hue: '#b6c2d6',
      pct: top10,
      count: nTop,
    })
  segs.push({
    key: 'rest',
    label: 'The rest',
    hue: WALLET_HUE,
    pct: rest,
    count: Math.max(0, m.nodes.length - nInfra - nTop - [...byCluster.values()].reduce((s, c) => s + c.count, 0)),
  })
  return { segs, top10: m.summary.top10Pct ?? 0, clustered, infra, rest }
}
