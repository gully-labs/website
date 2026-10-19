// Holder Map fixtures for the visual checks beyond the harness's own: a Solana token (top holders only, no
// links, one big unlabelled wallet like the owner's screenshot) and a busy 320-wallet map (frame budget).
import { holdersFixture } from './e2e-harness.mjs'

export const SOLANA_TOKEN = 'So1anaTokenMint1111111111111111111111111111'
const bs58ish = (i) => `Hq${(i * 7919).toString(36).padStart(5, '0')}wallet${i}pQrs`

function rebuild(base, nodes, extra) {
  const people = nodes.filter((n) => !n.label && n.contract !== true)
  const top10 = Math.round(people.slice(0, 10).reduce((s, n) => s + n.pct, 0) * 100) / 100
  return {
    ...base,
    nodes,
    links: [],
    clusters: [],
    hidden: [],
    forensics: null,
    health: null,
    deployerHistory: null,
    crossToken: null,
    fair: null,
    live: { supported: false, cursor: null },
    holders: { ...base.holders, shown: nodes.length, graph: nodes.length },
    summary: { ...base.summary, top10Pct: top10, largestCluster: null, line: `Top 10 wallets hold ${Math.round(top10)}%. No wallets are linked on this chain yet.`, plain: [] },
    legend: [{ kind: 'pool', text: 'Trading pool' }, { kind: 'lock', text: 'Liquidity or token lock' }],
    ...extra,
  }
}

/** A Solana token: the biggest wallet holds 86% and is not labelled, a pool and a lock, no links. */
export function solanaFixture() {
  const base = holdersFixture('token')
  const pcts = [86, 4.1, 2.2, 1.4, 0.9, 0.7, 0.55, 0.42, 0.33, 0.27, ...Array.from({ length: 30 }, (_, i) => 0.2 / (1 + i * 0.15))]
  const nodes = pcts.map((pct, i) => ({
    id: bs58ish(i),
    short: `${bs58ish(i).slice(0, 4)}…${bs58ish(i).slice(-4)}`,
    rank: i + 1,
    balance: Math.round(pct * 10_000_000),
    pct,
    label: i === 1 ? { kind: 'pool', name: 'Raydium pool' } : i === 4 ? { kind: 'lock', name: 'Token lock' } : null,
    contract: i === 7 ? true : false,
    cluster: null,
    flags: [],
    url: `https://solscan.io/account/${bs58ish(i)}`,
  }))
  return rebuild(
    { ...base, chain: { key: 'solana', id: 'solana', name: 'Solana' }, token: { address: SOLANA_TOKEN, symbol: 'SOLT', name: 'Sol Token', decimals: 6, supply: 1_000_000_000, url: 'https://solscan.io/token/x' }, coverage: { level: 'top', reason: 'Solana lists only the biggest holders', shown: 40 }, timeline: null },
    nodes,
  )
}

/** 320 wallets on Base with two clusters and a chain of links: the frame budget. */
export function busyFixture() {
  const base = holdersFixture('token')
  const N = 320
  const raw = Array.from({ length: N }, (_, i) => 1000 / (i + 1) ** 1.05)
  const total = raw.reduce((a, b) => a + b, 0)
  const addr = (i) => '0x' + (0xb0b00000 + i * 104729).toString(16).padStart(40, '0')
  const nodes = raw.map((v, i) => ({
    id: addr(i),
    short: `${addr(i).slice(0, 6)}…${addr(i).slice(-4)}`,
    rank: i + 1,
    balance: Math.round(v * 1000),
    pct: Math.round((v / total) * 10000) / 100,
    label: i === 0 ? { kind: 'pool', name: 'Uniswap pool' } : null,
    contract: i === 0,
    cluster: i % 11 === 1 && i < 120 ? 'c1' : i % 13 === 2 && i < 150 ? 'c2' : i % 17 === 3 && i < 200 ? 'c3' : null,
    flags: [],
    url: `https://basescan.org/address/${addr(i)}`,
  }))
  const ofc = (c) => nodes.filter((n) => n.cluster === c)
  const links = []
  for (const c of ['c1', 'c2', 'c3']) {
    const ws = ofc(c)
    ws.forEach((n, k) => k > 0 && links.push({ source: ws[k - 1].id, target: n.id, transfers: 1 + (k % 5), pct: 0.1, kind: 'transfer' }))
  }
  for (let i = 5; i < 200; i += 3) links.push({ source: nodes[i].id, target: nodes[(i * 7) % 200].id, transfers: 1 + (i % 4), pct: 0.05, kind: 'transfer' })
  const clusters = ['c1', 'c2', 'c3'].map((id) => ({ id, wallets: ofc(id).map((n) => n.id), count: ofc(id).length, pct: Math.round(ofc(id).reduce((s, n) => s + n.pct, 0) * 100) / 100, hasDeployer: false })).sort((a, b) => b.pct - a.pct)
  return { ...rebuild(base, nodes, {}), links: links.filter((l) => l.source !== l.target), clusters, coverage: { level: 'top', reason: 'it has a long history', shown: N }, token: { ...base.token, address: '0x000000000000000000000000000000000b0b0b05' } }
}
