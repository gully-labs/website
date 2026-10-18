import { useEffect, useState } from 'react'
import { isDocsHost } from '../site-host'

/* The public status (GET /api/status, server/status.mjs): every component's state now, its last 24 h of uptime in
   30-minute buckets, and the incident history. Read by /status, the docs' Status page and anywhere a health chip
   is shown. Nothing is guessed here: a component the server could not read is `unknown`, one not configured on
   the server is `off`, and both are left out of uptime. */

export type StatusState = 'up' | 'degraded' | 'down' | 'off' | 'unknown'
export type StatusGroup = 'platform' | 'tracker' | 'deepcore' | 'telegram' | 'payments' | 'ai' | 'security' | 'holders'

export interface StatusBucket {
  /** Start of the 30-minute bucket (ISO). */
  t: string
  /** Share of checks that were up, 0..1 (degraded counts half); null when nothing was checked then. */
  up: number | null
  /** Mean latency of the checks in the bucket, ms; null when the check has no latency. */
  ms: number | null
}

export interface StatusComponent {
  id: string
  group: StatusGroup
  name: string
  state: StatusState
  detail: string
  checkedAt: string | null
  latencyMs: number | null
  uptime24h: number | null
  history: StatusBucket[]
}

export interface StatusIncident {
  id: string
  component: string
  name: string
  state: 'down' | 'degraded'
  startedAt: string
  endedAt: string | null
  detail: string
}

export interface StatusBody {
  generatedAt: string
  overall: 'operational' | 'degraded' | 'major'
  intervalSeconds: number
  since: string | null
  components: StatusComponent[]
  incidents: StatusIncident[]
}

/** Groups in display order, with their headings. */
export const STATUS_GROUPS: { id: StatusGroup; label: string }[] = [
  { id: 'platform', label: 'Platform' },
  { id: 'tracker', label: 'Tracker freshness' },
  { id: 'deepcore', label: 'DeepCore' },
  { id: 'telegram', label: 'Telegram bot' },
  { id: 'payments', label: 'Gully Pay RPC' },
  { id: 'ai', label: 'Gully AI' },
  { id: 'security', label: 'Gully Security' },
  { id: 'holders', label: 'Holder Map sources' },
]

export const STATE_WORDS: Record<StatusState, string> = { up: 'Operational', degraded: 'Degraded', down: 'Down', off: 'Not configured', unknown: 'Not checked yet' }
export const OVERALL_WORDS: Record<StatusBody['overall'], string> = { operational: 'All systems operational', degraded: 'Some systems degraded', major: 'Major outage' }

/** The main host serves the API; the docs host reads it from there. */
const origin = () => (isDocsHost() ? 'https://gullylabs.xyz' : '')

export function isStatusBody(b: unknown): b is StatusBody {
  const s = b as StatusBody | null
  return !!s && typeof s === 'object' && Array.isArray(s.components) && Array.isArray(s.incidents) && typeof s.overall === 'string'
}

/** Polls GET /api/status every `pollMs` while the tab is visible. */
export function useStatus(pollMs = 30_000): { data: StatusBody | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<StatusBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, pollMs)
        return
      }
      try {
        const r = await fetch(`${origin()}/api/status`, { headers: { accept: 'application/json' }, cache: 'no-store' })
        const j: unknown = r.ok ? await r.json() : null
        if (!alive) return
        if (isStatusBody(j)) {
          setData(j)
          setError(null)
        } else setError(r.ok ? 'The status answer could not be read.' : `The status could not be read (HTTP ${r.status}).`)
      } catch {
        if (alive) setError('The status could not be reached.')
      }
      if (alive) timer = setTimeout(tick, pollMs)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [pollMs, nonce])
  return { data, error, loading: !data && !error, refresh: () => setNonce((n) => n + 1) }
}
