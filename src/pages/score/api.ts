import { C, PALETTE } from '../../components/charts/chartPresets'
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
export const bandColor = (s: number | null) => (s === null ? C.faint : s >= 80 ? C.green : s >= 60 ? C.gold : s >= 40 ? PALETTE[4] : C.error)

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** A part's tone: a low part is a weakness to read, not an alarm, so it is amber, never the error red. */
export const partColor = (s: number | null) => (s === null ? C.faint : s >= 80 ? C.green : s >= 40 ? C.gold : PALETTE[4])

/** Where each part is read from, in plain words. The exact calls stay in the tooltip (`source` from the API). */
const SOURCE_WORDS: Record<string, string> = {
  verified: 'Read from the public source-code registries',
  control: 'Read from the contract and its owner or signers on the chain',
  timelock: 'Read from the contract that delays changes, on the chain',
  upgradeability: 'Read from the contract’s upgrade settings on the chain',
  changes: 'Read from Gully Security monitoring of the last 30 days',
  liquidity: 'Read from DeepCore’s launch records (DeepCore launches only)',
  holders: 'Read from the Gully Holder Map',
  review: 'Read from published Gully Security reports',
  age: 'Read from the contract’s deployment on the chain',
}
export const sourceWords = (c: { id: string }) => SOURCE_WORDS[c.id] ?? 'Read from public records'
