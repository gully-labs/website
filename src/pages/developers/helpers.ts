import { useCallback, useEffect, useState } from 'react'
import { ago, api, conditionText, type AlertsView, type AnalyticsBlock, type AnalyticsSite, type AnalyticsUsage, type ApiKey, type GapAlert, type PayAsset } from './api'
import { keyColor } from './styles'

/* Non-component helpers shared by the console's tabs (kept apart so the component files hot-reload). */

export const CHAIN_NAMES: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain' }
const n = (v: number) => v.toLocaleString('en-US')

/* ---------------------------------------------------------------- alerts --- */

export type Secret = { title: string; secret: string } | null

export function alertName(a: GapAlert) {
  return a.name || (a.ticker ? `${a.ticker} alert` : 'Any-stock alert')
}

export function alertRule(a: GapAlert) {
  return `${a.ticker ? `${a.ticker} · ${CHAIN_NAMES[a.chain ?? ''] ?? a.chain}` : 'Any stock'} · ${conditionText(a.condition)}`
}

export function alertState(a: GapAlert): { t: string; c: string } {
  if (!a.coveredByPlan) return { t: 'not in your plan', c: '#ff8a7a' }
  if (!a.enabled) return { t: 'paused', c: '#6c7888' }
  if (a.mutedUntil) return { t: `muted until ${new Date(a.mutedUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, c: '#6c7888' }
  if (a.waitingToReArm.length) return { t: `fired ${ago(a.lastFiredAt)} · waits to re-arm`, c: '#e8c060' }
  return { t: 'watching', c: '#6fcf6a' }
}

/** GET /api/developer/alerts, refreshed every minute. */
export function useAlertsView() {
  const [view, setView] = useState<AlertsView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api<AlertsView>('/api/developer/alerts').then((r) => {
        if (r.ok) {
          setView(r.data)
          setErr(null)
        } else setErr(r.error)
      }),
    [],
  )
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])
  return { view, err, load }
}

/** POST /api/developer/alerts/:id/:op with the busy flag, errors and the test result line. */
export function useAlertActions(load: () => Promise<unknown>) {
  const [busy, setBusy] = useState<string | null>(null)
  const [actErr, setActErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [secret, setSecret] = useState<Secret>(null)
  const act = async (a: GapAlert, op: string, body?: unknown) => {
    if (op === 'delete' && !window.confirm(`Delete ${a.name || 'this alert'}? Its delivery log goes with it.`)) return
    setBusy(`${a.id}:${op}`)
    setActErr(null)
    setNote(null)
    const r = await api<{ secret?: string; results?: { channel: string; ok: boolean; status: number | null; error: string | null }[] }>(`/api/developer/alerts/${a.id}/${op}`, { method: 'POST', body })
    setBusy(null)
    if (!r.ok) return setActErr(r.error)
    if (op === 'rotate' && r.data.secret) setSecret({ title: 'New signing secret', secret: r.data.secret })
    if (op === 'test' && r.data.results) setNote(r.data.results.map((x) => `${x.channel}: ${x.ok ? `delivered (${x.status})` : `failed (${x.error ?? x.status})`}`).join(' · '))
    load()
  }
  return { act, busy, actErr, note, secret, setSecret }
}

/* ------------------------------------------------------------- analytics --- */

export const BLOCK_TEXT: Record<AnalyticsBlock, string> = {
  'gully-plan-lapsed': 'Not recording: no running plan',
  'gully-site-limit': 'Not recording: beyond your plan’s websites',
  'gully-quota-exceeded': 'Not recording: monthly events used',
}

export type SiteUsage = AnalyticsUsage['sites'][number] | undefined | 'loading'

export function siteMeta(site: AnalyticsSite, usage: SiteUsage) {
  const parts = [`${n(site.eventsThisMonth)} events this month`]
  if (usage && usage !== 'loading' && usage.ok) {
    if (usage.stats.pageviews !== null) parts.push(`${n(usage.stats.pageviews)} views`)
    if (usage.stats.visitors !== null) parts.push(`${n(usage.stats.visitors)} visitors`)
  }
  return parts.join(' · ')
}

/* ------------------------------------------------------------------- pay --- */

/** What a chosen asset costs, without a live quote: stablecoins are the USD price; coins are quoted. */
export function priceText(asset: PayAsset | null, usd: number) {
  if (!asset) return '—'
  return asset.kind === 'token' ? `${usd.toFixed(2)} ${asset.symbol}` : `${usd} USD in ${asset.symbol}`
}

export const defaultAsset = (assets: PayAsset[], wanted?: string | null) => (wanted && assets.some((a) => a.id === wanted) ? wanted : (assets.find((a) => a.id === 'base-usdc')?.id ?? assets[0]?.id ?? null))


/* ------------------------------------------------------------- key colours --- */

/** One stable colour per key: live keys first, oldest first, then revoked ones. */
export function keyColors(keys: ApiKey[]): Record<string, string> {
  const order = [...keys].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || a.createdAt.localeCompare(b.createdAt))
  return Object.fromEntries(order.map((k, i) => [k.id, keyColor(i)]))
}
