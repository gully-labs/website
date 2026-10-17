import { useCallback, useEffect, useState } from 'react'
import type { Checkout, PayAsset, Payment } from './api'

/* A Gully Pay invoice as GET /api/pay/:id answers it (server/invoices.mjs). */

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

export type InvoiceState = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; invoice: Invoice }

export function useInvoice(id: string | undefined): [InvoiceState, () => void, (i: Invoice) => void] {
  const [state, setState] = useState<InvoiceState>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<InvoiceState> = !id
      ? Promise.resolve({ k: 'missing' })
      : fetch(`/api/pay/${encodeURIComponent(id)}`).then(async (r): Promise<InvoiceState> => {
          if (r.status === 404) return { k: 'missing' }
          const d = await r.json().catch(() => null)
          if (!r.ok || !d?.invoice) return { k: 'error', message: d?.error ?? `The server answered ${r.status}.` }
          return { k: 'ok', invoice: d.invoice }
        })
    read.catch((): InvoiceState => ({ k: 'error', message: 'The server could not be reached. Check your connection and try again.' })).then(setState)
  }, [id])
  useEffect(() => {
    load()
  }, [load])
  return [state, load, (invoice) => setState({ k: 'ok', invoice })]
}

export const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—')
export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }) : '—')
