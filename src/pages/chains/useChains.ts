import { useEffect, useState } from 'react'

/* GET /api/chains/plans (server/chains-plans.mjs is the one source of the offer: prices, services, the form's choices). */

export type ServiceStatus = 'testnet' | 'with-testnet' | 'planned'
export interface ChainsService {
  id: string
  name: string
  kind: 'included' | 'addon'
  status: ServiceStatus
  body: string
}
export interface ChainsAddon {
  id: string
  name: string
  model: string
  usd: number | null
  status: ServiceStatus
}
export type Choice = [value: string, label: string]
export interface ChainsConfig {
  live: boolean
  stack: { id: string; name: string; role: string }[]
  services: ChainsService[]
  testnet: { freeDays: number; monthlyUsd: number | null }
  mainnet: { fromUsdPerMonth: number; sequencerProfitPct: number; daAtCost: boolean }
  addons: ChainsAddon[]
  note: string
  choices: { useCase: Choice[]; scale: Choice[]; gasToken: Choice[]; da: Choice[] }
}

export type ChainsState = { k: 'loading' } | { k: 'error' } | { k: 'ok'; cfg: ChainsConfig }

export function useChains(): [ChainsState, () => void] {
  const [state, setState] = useState<ChainsState>({ k: 'loading' })
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/chains/plans')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((cfg: ChainsConfig) => alive && setState({ k: 'ok', cfg }))
      .catch(() => alive && setState({ k: 'error' }))
    return () => {
      alive = false
    }
  }, [n])
  return [state, () => (setState({ k: 'loading' }), setN((x) => x + 1))]
}

/** "TBA" until the owner sets a price. */
export const usd0 = (v: number | null) => (v === null ? 'TBA' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v))

export const STATUS_LABEL: Record<ServiceStatus, string | null> = { testnet: null, 'with-testnet': 'Coming with testnet', planned: 'Planned' }
