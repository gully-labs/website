import { useEffect, useRef, useState } from 'react'
import type { HolderMapOk, LiveUpdate } from '../../lib/holders'
import { holdersPath } from '../../lib/holders'
import { norm } from './format'

/* Live mode: GET /api/holders/:chain/:token/live?since=<cursor> every 15 s. New transfers become particles
   on the map for a few seconds; shares (pcts) replace the snapshot's for the bubbles they name. When the
   plan limits the live view (features.liveMinutes), it pauses after that many minutes. */

export interface LiveEvent {
  key: string
  from: string
  to: string
  pct: number | null
  at: number
}

export interface LiveState {
  on: boolean
  paused: boolean
  lastAt: string | null
  pcts: Map<string, number>
  events: LiveEvent[]
}

const POLL_MS = 15_000
const EVENT_MS = 4_500

export function useLive(m: HolderMapOk, enabled: boolean): LiveState {
  const supported = !!m.live?.supported && enabled
  const minutes = m.features.liveMinutes ?? null
  const [state, setState] = useState<LiveState>({
    on: false,
    paused: false,
    lastAt: null,
    pcts: new Map(),
    events: [],
  })
  const cursor = useRef<number | null>(m.live?.cursor ?? null)
  const key = `${m.chain.key}:${m.token.address}`

  useEffect(() => {
    if (!supported) return
    cursor.current = m.live?.cursor ?? null
    let alive = true
    let n = 0
    const started = Date.now()
    const tick = async () => {
      if (minutes !== null && Date.now() - started > minutes * 60_000) {
        setState((s) => ({ ...s, on: false, paused: true }))
        clearInterval(id)
        return
      }
      const q = cursor.current === null ? '' : `?since=${cursor.current}`
      const r = await fetch(`${holdersPath(m.chain.key, m.token.address)}/live${q}`, { headers: { accept: 'application/json' } })
        .then((x) => (x.ok ? (x.json() as Promise<LiveUpdate>) : null))
        .catch(() => null)
      if (!alive || !r) return
      if (r.state === 'unsupported') {
        setState((s) => ({ ...s, on: false }))
        clearInterval(id)
        return
      }
      if (r.state !== 'ok') return
      cursor.current = r.cursor ?? cursor.current
      const now = Date.now()
      const fresh = (r.transfers ?? []).slice(-12).map((t, i) => ({
        key: `${now}-${n++}-${i}`,
        from: norm(t.from),
        to: norm(t.to),
        pct: t.pct,
        at: now + i * 250,
      }))
      setState((s) => {
        const pcts = new Map(s.pcts)
        for (const [k, v] of Object.entries(r.pcts ?? {})) pcts.set(norm(k), v)
        return {
          on: true,
          paused: false,
          lastAt: r.asOf ?? new Date().toISOString(),
          pcts,
          events: [...s.events.filter((e) => now - e.at < EVENT_MS), ...fresh],
        }
      })
    }
    const id = setInterval(tick, POLL_MS)
    tick()
    // Expire particles between polls.
    const sweep = setInterval(
      () =>
        setState((s) =>
          s.events.length
            ? {
                ...s,
                events: s.events.filter((e) => Date.now() - e.at < EVENT_MS),
              }
            : s,
        ),
      1_000,
    )
    return () => {
      alive = false
      clearInterval(id)
      clearInterval(sweep)
    }
    // the map's identity is `key`; its live cursor is read when the effect starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, key, minutes])

  return supported ? state : { on: false, paused: false, lastAt: null, pcts: new Map(), events: [] }
}
