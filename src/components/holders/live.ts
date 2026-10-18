import { useEffect, useRef, useState } from 'react'
import type { HolderMapOk, LiveUpdate } from '../../lib/holders'
import { holdersPath } from '../../lib/holders'
import { norm } from './format'
import type { RecentFlow } from './motion'

/* Live mode: GET /api/holders/:chain/:token/live?since=<cursor> every 15 s. Each new transfer is handed to
   `onFlows` (the map animates it and the ticker names it); shares (pcts) replace the snapshot's for the
   bubbles they name, and the server's moved top-10 figure feeds the side panel. `beat` counts the answers
   that carried something new, so the LIVE pill can pulse on each. When the plan limits the live view
   (features.liveMinutes), it pauses after that many minutes. The poll rests while the tab is hidden. */

export interface LiveState {
  on: boolean
  paused: boolean
  lastAt: string | null
  pcts: Map<string, number>
  top10Pct: number | null
  beat: number
}

const POLL_MS = 15_000
const OFF: LiveState = { on: false, paused: false, lastAt: null, pcts: new Map(), top10Pct: null, beat: 0 }

export function useLive(m: HolderMapOk, enabled: boolean, onFlows?: (flows: RecentFlow[]) => void): LiveState {
  const supported = !!m.live?.supported && enabled
  const minutes = m.features.liveMinutes ?? null
  const [state, setState] = useState<LiveState>(OFF)
  const cursor = useRef<number | null>(m.live?.cursor ?? null)
  const cb = useRef(onFlows)
  useEffect(() => {
    cb.current = onFlows
  })
  const key = `${m.chain.key}:${m.token.address}`

  useEffect(() => {
    if (!supported) return
    cursor.current = m.live?.cursor ?? null
    let alive = true
    const started = Date.now()
    let id = 0
    const tick = async () => {
      if (document.hidden) return
      if (minutes !== null && Date.now() - started > minutes * 60_000) {
        setState((s) => ({ ...s, on: false, paused: true }))
        clearInterval(id)
        return
      }
      const q = cursor.current === null ? '' : `?since=${cursor.current}`
      const r = await fetch(`${holdersPath(m.chain.key, m.token.address)}/live${q}`, { headers: { accept: 'application/json' } })
        .then((x) => (x.ok ? (x.json() as Promise<LiveUpdate & { top10Pct?: number | null }>) : null))
        .catch(() => null)
      if (!alive || !r) return
      if (r.state === 'unsupported') {
        setState((s) => ({ ...s, on: false }))
        clearInterval(id)
        return
      }
      if (r.state !== 'ok') return
      cursor.current = r.cursor ?? cursor.current
      const fresh = (r.transfers ?? []).slice(-12) as RecentFlow[]
      if (fresh.length) cb.current?.(fresh)
      setState((s) => {
        const pcts = new Map(s.pcts)
        for (const [k, v] of Object.entries(r.pcts ?? {})) pcts.set(norm(k), v)
        return {
          on: true,
          paused: false,
          lastAt: r.asOf ?? new Date().toISOString(),
          pcts,
          top10Pct: typeof r.top10Pct === 'number' ? r.top10Pct : s.top10Pct,
          beat: s.beat + (fresh.length || !s.on ? 1 : 0),
        }
      })
    }
    id = window.setInterval(tick, POLL_MS)
    tick()
    const onVis = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
    // the map's identity is `key`; its live cursor is read when the effect starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, key, minutes])

  return supported ? state : OFF
}
