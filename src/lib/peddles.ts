/* GET /api/peddles/onchain (server/peddles.mjs), typed: Peddles' and PeddleQuest's figures per chain, read from their
   contracts, and every contract in Peddles' docs with whether it has code on chain and what is read from it. */
import { useEffect, useState } from 'react'

export interface OnchainChain {
  chainId: number
  key: string
  name: string
  explorer: string
  started: boolean
  caughtUp: boolean
  progress: number
  coveredUntil: string | null
  pools: number
  volumeAllUsd: number
  volume24hUsd: number
  volume7dUsd: number
  volume30dUsd: number
  swaps: number
  swaps24h: number
  unpricedSwaps: number
  feesAllUsd: number
  fees24hUsd: number
  feesBy: { swap: number; opening: number; launch: number; terminal: number }
  unpricedFees: number
  creatorsPaidUsd: number
  holdersPaidUsd: number
  launches: number
  launches24h: number
  collections: number
  buybackUsd: number
  pedlBurned: number
  quests: number
  questRewardsUsd: number
  questFeesUsd: number
  questUnpriced: number
  tvlUsd: number | null
  error: string | null
  daily: { t: number; v: number; fees: number; swaps: number; qf: number }[]
}

export interface OnchainContract {
  name: string
  address: string
  /** true: has code; false: no code (flagged, never linked as live); null: could not be checked just now. */
  verified: boolean | null
  codeBytes: number | null
  reads: string[]
}

export interface OnchainDoc {
  at: string
  live: boolean
  chains: OnchainChain[]
  contracts: Record<string, OnchainContract[]>
}

export type OnchainState = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: OnchainDoc }

/** The on-chain document, refreshed every 30 seconds. A failed refresh keeps the last good read. */
export function useOnchain(): OnchainState {
  const [st, setSt] = useState<OnchainState>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const tick = () =>
      fetch('/api/peddles/onchain', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<OnchainDoc>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (data) => alive && setSt({ k: 'ok', data }),
          () => alive && setSt((s) => (s.k === 'ok' ? s : { k: 'error' })),
        )
    tick()
    const id = setInterval(tick, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return st
}

export const addressUrl = (c: { explorer: string }, a: string) => `${c.explorer}/address/${a}`
