import { useCallback, useEffect, useState } from 'react'
import type { Checkout, PayAsset, Payment } from './api'
import type { Viewer } from './brand'

/* A Gully Pay invoice as GET /api/pay/:id answers it (server/invoices.mjs). Merchant invoices
   (GET /api/pay/m/i/:id, server/merchants.mjs) extend it with the store, its line items and the viewer. */

export type InvoiceStatus = 'open' | 'paid' | 'expired' | 'cancelled'

export interface Invoice {
  id: string
  number: string
  title: string
  note: string | null
  usd: string
  usdCents: string
  status: InvoiceStatus
  assets: PayAsset[]
  createdAt: string
  expiresAt: string
  paidAt: string | null
  cancelledAt: string | null
  payment: Payment | null
  /** The pay link this invoice was made from, if any. */
  linkId: string | null
  checkout: Checkout
}

export type InvoiceState<T extends Invoice = Invoice> = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; invoice: T; viewer: Viewer | null }

/** Reads `${api}/${id}` (default: our own invoices) and keeps the answer; the setter swaps in a paid invoice. */
export function useInvoice<T extends Invoice = Invoice>(id: string | undefined, api = '/api/pay'): [InvoiceState<T>, () => void, (i: T) => void] {
  const [state, setState] = useState<InvoiceState<T>>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<InvoiceState<T>> = !id
      ? Promise.resolve({ k: 'missing' })
      : fetch(`${api}/${encodeURIComponent(id)}`).then(async (r): Promise<InvoiceState<T>> => {
          if (r.status === 404) return { k: 'missing' }
          const d = await r.json().catch(() => null)
          if (!r.ok || !d?.invoice) return { k: 'error', message: d?.error ?? `The server answered ${r.status}.` }
          return { k: 'ok', invoice: d.invoice, viewer: d.viewer ?? null }
        })
    read.catch((): InvoiceState<T> => ({ k: 'error', message: 'The server could not be reached. Check your connection and try again.' })).then(setState)
  }, [id, api])
  useEffect(() => {
    load()
  }, [load])
  return [state, load, (invoice) => setState((s) => ({ k: 'ok', invoice, viewer: s.k === 'ok' ? s.viewer : null }))]
}

export const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—')
export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }) : '—')
