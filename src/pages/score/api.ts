import { useCallback, useEffect, useState } from 'react'

/* The Gully Score's public API (server/gully-score.mjs). Every figure on the score pages comes from here. */

export interface ScoreEvidence {
  label: string
  url: string
}

export interface ScoreComponent {
  id: string
  label: string
  weight: number
  source: string
  what: string
  available: boolean
  /** 0 to 100, or null when not available (never scored as 0). */
  score: number | null
  value: string
  reason: string
  evidence: ScoreEvidence[]
  severities?: Record<string, number>
}

export interface ScoreChange {
  at: string
  id: string | null
  label: string
  from: number | null
  to: number | null
  note: string
}

export interface Methodology {
  version: number
  minCoverage: number
  ttlHours: number
  components: { id: string; label: string; weight: number; source: string; what: string }[]
  rules: string[]
}

export interface ScoreResult {
  chainId: number
  chainKey: string
  chainName: string
  chain: { id: number; key: string; name: string; explorer: string | null }
  address: string
  name: string | null
  symbol: string | null
  score: number | null
  grade: string | null
  coverage: { weight: number; components: number; of: number }
  computedAt: string
  components: ScoreComponent[]
  history: { at: string; score: number | null }[]
  changes: ScoreChange[]
  listed: boolean
  stale: boolean
  links: { page: string; badge: string; explorer: string }
  methodology: Methodology
}

export interface ScoreRow {
  chainId: number
  chainKey: string
  chainName: string
  address: string
  name: string | null
  symbol: string | null
  score: number | null
  grade: string | null
  coverage: { weight: number; components: number; of: number }
  computedAt: string
  change: number | null
}

export interface ScoreIndex {
  scores: ScoreRow[]
  chains: { id: number; key: string; name: string }[]
  methodology: Methodology
}

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; error: string }

/** GET a JSON document; `everyMs` re-reads it in place (charts animate between values). */
export function useJson<T>(url: string | null, everyMs = 0) {
  const [s, setS] = useState<Load<T>>({ state: 'loading' })
  const [n, setN] = useState(0)
  const retry = useCallback(() => setN((x) => x + 1), [])
  useEffect(() => {
    if (!url) return
    let alive = true
    const read = () =>
      fetch(url)
        .then(async (r) => {
          const body = await r.json().catch(() => null)
          if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `The server answered ${r.status}.`)
          return body as T
        })
        .then(
          (data) => alive && setS({ state: 'ok', data }),
          (e: Error) => alive && setS((prev) => (prev.state === 'ok' ? prev : { state: 'error', error: e.message || 'The score could not be read.' })),
        )
    read()
    const t = everyMs ? setInterval(read, everyMs) : null
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [url, everyMs, n])
  return [s, retry] as const
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** The brand's band colours for a score (kit tokens only). */
export const bandColor = (s: number | null) => (s === null ? '#7f8b9c' : s >= 80 ? '#6fcf6a' : s >= 60 ? '#e8c060' : s >= 40 ? '#f49b5a' : '#ff8a7a')

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
