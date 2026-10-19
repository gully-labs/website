import { useCallback, useEffect, useRef, useState } from 'react'
import type { Load } from './tracker'

/* The Holder Map Deep check API (server/holders-deep-routes.mjs, header comment) as types and hooks. Nothing here
   computes a finding: every figure, source and confidence on the screens is the server's. */

export type SectionState = 'available' | 'limited' | 'unavailable'
export interface CoverPart {
  state: SectionState
  reason: string | null
}
export interface Coverage {
  chain: string
  funding: CoverPart
  clusters: CoverPart
  deployer: CoverPart
  trading: CoverPart
}
export interface DeepQuota {
  plan: { id: string; name: string }
  freePerMonth: number
  used: number
  left: number
  resetsAt: string
  active: number
  maxActive: number
  credits?: number
}
export interface DeepOffer {
  id: string
  name: string
  priceUsd: number
  freePerMonth: Record<string, number>
  bundleScanDiscountPct: number
  maxActive: number
  maxRunning: number
  budgets: { rpcCalls: number; logSpans: number; explorerCalls: number; ms: number; holders: number; hops: number }
}
export interface DeepOfferDoc {
  offer: DeepOffer
  checkout: { enabled: boolean }
  coverage: Record<string, Coverage>
  signedIn: boolean
  quota: DeepQuota | null
  credits: number
  contact: string
}
export interface DeepQuote {
  chain: { key: string; id: number | string; name: string }
  token: string
  priceUsd: number
  listPriceUsd: number
  free: boolean
  bundle: { applied: boolean; discountPct: number; scanId: string | null }
  bundleNote: string | null
  credit: { available: number; used: boolean }
  quota: DeepQuota | null
  coverage: Coverage
  checkout: { enabled: boolean }
  signedIn: boolean
}

export type DeepStatus = 'awaiting_payment' | 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled'
export type Confidence = 'high' | 'medium' | 'low'
export type PartState = 'ok' | 'partial' | 'unavailable' | 'skipped'

export interface DeepHop {
  hop: number
  from: string
  fromLabel: string | null
  to: string
  kind: 'native' | 'token'
  block: number
  tx: string
  at: string | null
  source: string
  confidence: Confidence
}
export interface DeepTrace {
  address: string
  role: 'holder' | 'deployer'
  rank: number | null
  pctOfSupply: number | null
  hops: DeepHop[]
  origin: { type: 'exchange' | 'labelled' | 'wallet' | 'buy' | 'cycle' | 'unknown'; address?: string; label?: string; note?: string; reason?: string }
}
export interface DeepReport {
  version: number
  chain: { key: string; id: number | string; name: string }
  token: { address: string; symbol: string | null; name: string | null; url: string }
  generatedAt: string
  status: 'done' | 'partial' | 'failed'
  partial: { reasons: { code: string; text: string }[] } | null
  error?: string
  budget?: { limits: Record<string, number>; used: Record<string, number> }
  sections: {
    trading?: {
      state: PartState
      method?: string
      source?: string
      confidence?: Confidence
      launchBlock?: number | null
      firstLiquidityBlock?: number | null
      firstTradeBlock?: number | null
      window?: { blocks: number }
      snipers?: { count: number; pctOfSupply: number | null; wallets: string[] }
      bundled?: { count: number; pctOfSupply: number | null }
      bundles?: { block: number; wallets: string[]; count: number }[]
      reason?: string
    }
    funding?: {
      state: PartState
      reason?: string
      wallets?: number
      hopsMax?: number
      sources?: string[]
      traces?: DeepTrace[]
      sharedFunders?: { address: string; label: string | null; labelled: boolean; exchange: boolean; wallets: string[]; hops: number; confidence: Confidence; note: string | null }[]
    }
    clusters?: {
      state: PartState
      reason?: string
      combined?: { id: string; wallets: string[]; count: number; pctOfSupply: number | null; basis: string; confidence: Confidence }[]
    }
    deployer?: {
      state: PartState
      reason?: string
      address?: string | null
      source?: string | null
      tokens?: { chain: string; address: string; symbol: string | null; outcome: string; source: string; confidence: Confidence }[]
      chains?: { chain: string; name: string; state: string; reason?: string; created: number; tokens: number }[]
    }
  }
  findings: { id: string; section: string; text: string; confidence: Confidence; source: string }[]
  unavailable: { section: string; what: string; reason: string }[]
  notes: string[]
}
export interface DeepCheck {
  id: string
  status: DeepStatus
  chain: { key: string; id: number | string; name: string }
  token: string
  free: boolean
  priceUsd: number
  listPriceUsd: number
  bundled: boolean
  payment: { invoiceId: string; status: string; usd: number; payUrl: string; expiresAt: string | null } | null
  progress: { pct: number; message: string } | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  cancelReason: string | null
  error: string | null
  credit: { usedForThis: boolean; earned: boolean; contact: string } | null
  url: string
  report?: DeepReport | null
}

export const DEEP_PATH = '/api/holders/deep'
export const deepPagePath = (id: string) => `/holders/deep/${id}`

type Reply<T> = { status: number; ok: boolean; data: T & { error?: string; code?: string } }
async function call<T>(path: string, body?: unknown): Promise<Reply<T> | null> {
  try {
    const r = await fetch(path, body === undefined ? { headers: { accept: 'application/json' } } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'gully' }, body: JSON.stringify(body) })
    const data = await r.json().catch(() => ({}))
    return { status: r.status, ok: r.ok, data }
  } catch {
    return null
  }
}

/** GET /api/holders/deep: the offer, per-chain coverage, this visitor's quota and credits. */
export function useDeepOffer(): Load<DeepOfferDoc> & { reload: () => void } {
  const [s, setS] = useState<Load<DeepOfferDoc>>({ k: 'loading' })
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    call<DeepOfferDoc>(DEEP_PATH).then((r) => alive && setS(r?.ok ? { k: 'ok', data: r.data } : { k: 'error' }))
    return () => {
      alive = false
    }
  }, [n])
  return { ...s, reload: useCallback(() => setN((v) => v + 1), []) }
}

export const deepQuote = (chain: string, token: string, scanId?: string) => call<{ quote: DeepQuote }>(DEEP_PATH, { chain, token, ...(scanId ? { bundleWithScan: { scanId } } : {}) })
export const deepConfirm = (chain: string, token: string, priceUsd: number, scanId?: string) => call<{ check: DeepCheck; payment?: DeepCheck['payment']; duplicate?: boolean; quote?: DeepQuote }>(DEEP_PATH, { chain, token, expect: { priceUsd }, ...(scanId ? { bundleWithScan: { scanId } } : {}) })
export const deepCancel = (id: string) => call<{ check: DeepCheck }>(`${DEEP_PATH}/${encodeURIComponent(id)}/cancel`, {})

const ACTIVE: DeepStatus[] = ['awaiting_payment', 'queued', 'running']
export const isActive = (s: DeepStatus) => ACTIVE.includes(s)

/** One check by id, polled every 2.5 s while it is waiting, queued or running (every 8 s awaiting payment). */
export function useDeepCheck(id: string | null): Load<DeepCheck> & { notFound: boolean; reload: () => void } {
  const [state, setState] = useState<{ id: string | null; load: Load<DeepCheck>; notFound: boolean }>({ id: null, load: { k: 'loading' }, notFound: false })
  const [n, setN] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!id) return
    let alive = true
    const tick = async () => {
      const r = await call<{ check: DeepCheck }>(`${DEEP_PATH}/${encodeURIComponent(id)}`)
      if (!alive) return
      if (r?.status === 404) return setState({ id, load: { k: 'error' }, notFound: true })
      if (!r?.ok || !r.data.check) {
        setState((s) => (s.id === id && s.load.k === 'ok' ? s : { id, load: { k: 'error' }, notFound: false }))
        timer.current = setTimeout(tick, 6_000)
        return
      }
      const check = r.data.check
      setState({ id, load: { k: 'ok', data: check }, notFound: false })
      if (isActive(check.status)) timer.current = setTimeout(tick, check.status === 'awaiting_payment' ? 8_000 : 2_500)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer.current)
    }
  }, [id, n])
  const cur = state.id === id ? state : { load: { k: 'loading' } as Load<DeepCheck>, notFound: false }
  return { ...cur.load, notFound: cur.notFound, reload: useCallback(() => setN((v) => v + 1), []) }
}

/** The check ids this browser started, newest first, so the page can offer "Your check is running". */
const KEY = 'gully.holders.deep'
export function rememberCheck(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
    localStorage.setItem(KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 20)))
  } catch {
    /* storage can be blocked */
  }
}
export function rememberedChecks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Plain-words names for the four parts. */
export const PART_NAMES = { funding: 'Funding trace', clusters: 'Shared-funder clusters', deployer: 'Deployer record', trading: 'Snipers and bundles' } as const
export type PartKey = keyof typeof PART_NAMES
export const PART_ORDER: PartKey[] = ['trading', 'funding', 'clusters', 'deployer']
