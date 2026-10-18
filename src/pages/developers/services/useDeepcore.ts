import { useEffect, useState } from 'react'

/* GET /api/deepcore/launches (server/deepcore.mjs): the launch poller's cache, the same list the launch
   alerts and the Telegram bot read. Shared by the DeepCore page and the Overview's market band. */

export type Launch = { key: string; chainId: number; chainName: string; token: string; symbol: string | null; createdAt: string; legs: { quote: string | null; locked: boolean | null }[]; links: { token: string; swap: string } }
export type Launches = { state: 'ok' | 'stale' | 'unreadable'; launches: Launch[]; asOf: string | null; chains: { chainId: number; name: string; status: 'ok' | 'unreadable'; total: number | null }[]; error: string | null; pollSeconds: number }
export type LaunchesLoad = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: Launches }

export const DEEPCORE_COLORS: Record<number, string> = { 4663: '#e8c060', 56: '#f3ba2f', 8453: '#6aa6ff', 999: '#4fd1c5' }
export const deepcoreColor = (id: number) => DEEPCORE_COLORS[id] ?? '#a6b0bd'

/** The launch list, re-read every `everyMs` (a minute by default); a failed re-read keeps the last good one. */
export function useLaunches(everyMs = 60_000): LaunchesLoad {
  const [s, setS] = useState<LaunchesLoad>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/api/deepcore/launches', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<Launches>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (data) => alive && setS({ k: 'ok', data }),
          () => alive && setS((p) => (p.k === 'ok' ? p : { k: 'error' })),
        )
    read()
    const id = setInterval(read, everyMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [everyMs])
  return s
}
