import { useEffect, useState } from 'react'
import type { Offer } from '../pages/developers/api'
import { APP_URL, isLocalHost } from '../site-host'

/* GET /api/plans for the pricing page and the product pages (server/plans.mjs is the one source). */

/** Where "Start free trial" for Gully Analytics goes: the Analytics tab of the app dashboard. */
export const ANALYTICS_SIGNUP = isLocalHost() ? '/app#analytics' : `${APP_URL}/#analytics`

export type PlansState = { k: 'loading' } | { k: 'error'; message: string } | { k: 'ok'; offer: Offer }

/** GET /api/plans, with a retry. */
export function usePlans(): [PlansState, () => void] {
  const [state, setState] = useState<PlansState>({ k: 'loading' })
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/plans')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The server answered ${r.status}.`))))
      .then((offer: Offer) => alive && setState({ k: 'ok', offer }))
      .catch((e: unknown) => alive && setState({ k: 'error', message: e instanceof Error ? e.message : 'The plans could not be read.' }))
    return () => {
      alive = false
    }
  }, [n])
  return [state, () => (setState({ k: 'loading' }), setN((x) => x + 1))]
}
