import { Mail } from 'lucide-react'
import type { ReactNode } from 'react'
import { accentOf, storeName, type Brand } from './brand'

/* The left column of a checkout: what is being paid for, as an order summary in normal type (line items
   with quantity and price, subtotal and total in USD), the description, the dates and the store's contact.
   Every figure is the server's; nothing is summed here. */

export interface OrderItem {
  description: string
  quantity: number
  unitUsd: string
  totalUsd: string
}

export function OrderSummary({
  brand,
  eyebrow,
  title,
  items,
  total,
  totalLabel = 'Total',
  description,
  meta = [],
  children,
}: {
  brand: Brand
  eyebrow: string
  title: string
  items: OrderItem[]
  /** The total as the server formats it ("1,234.50"), or null when the payer chooses the amount. */
  total: string | null
  totalLabel?: string
  description?: string | null
  meta?: [string, ReactNode][]
  children?: ReactNode
}) {
  const accent = accentOf(brand)
  const who = brand.gully ? 'Gully Labs' : storeName(brand)
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Order summary" style={{ animation: 'gl-rise .5s ease both' }}>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[12px] tracking-[1.5px] uppercase" style={{ color: accent.color }}>
          {eyebrow}
        </span>
        <h1 className="m-0 text-[clamp(22px,2.4cqw,28px)] leading-[1.2] font-semibold break-words text-ink" data-testid="order-title">
          {title}
        </h1>
        {description && <p className="m-0 max-w-[560px] text-[15px] leading-[1.6] whitespace-pre-line text-muted">{description}</p>}
      </div>

      <table className="w-full border-collapse text-[14px]" data-testid="order-items">
        <caption className="sr-only">Line items</caption>
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
            <th scope="col" className="py-2 pr-3 font-normal">
              ITEM
            </th>
            <th scope="col" className="w-[52px] py-2 pr-3 text-right font-normal">
              QTY
            </th>
            <th scope="col" className="w-[110px] py-2 pr-3 text-right font-normal max-[420px]:hidden">
              PRICE
            </th>
            <th scope="col" className="w-[110px] py-2 text-right font-normal">
              AMOUNT
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={n} className="border-b border-line text-ink-2">
              <td className="py-2 pr-3 break-words text-ink">{i.description}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{i.quantity}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums max-[420px]:hidden">{i.unitUsd}</td>
              <td className="py-2 text-right font-mono tabular-nums text-ink">{i.totalUsd}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {total && items.length > 1 && (
            <tr className="text-muted">
              <td colSpan={3} className="pt-3 pr-3 text-right max-[420px]:hidden">
                Subtotal
              </td>
              <td className="pt-3 pr-3 text-right min-[421px]:hidden" colSpan={2}>
                Subtotal
              </td>
              <td className="pt-3 text-right font-mono tabular-nums">{total}</td>
            </tr>
          )}
          <tr className="text-ink">
            <td colSpan={3} className="pt-2 pr-3 text-right text-[15px] font-semibold max-[420px]:hidden">
              {totalLabel}
            </td>
            <td className="pt-2 pr-3 text-right text-[15px] font-semibold min-[421px]:hidden" colSpan={2}>
              {totalLabel}
            </td>
            <td className="pt-2 text-right font-mono text-[18px] font-medium tabular-nums" data-testid="order-total">
              {total ? (
                <>
                  {total} <span className="text-[12px] text-faint">USD</span>
                </>
              ) : (
                <span className="text-[13px] font-normal text-muted">you choose</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>

      {meta.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1 font-mono text-[12px]">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint">{k}</dt>
              <dd className="m-0 min-w-0 break-words text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      {(!brand.gully || brand.supportEmail) && (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px] leading-[1.6] text-muted">
        {!brand.gully && <span>Questions about an order or a refund go to {who}.</span>}
        {brand.supportEmail && (
          <a href={`mailto:${brand.supportEmail}`} className="inline-flex min-h-11 w-fit items-center gap-2 text-ink-2 underline-offset-4 hover:text-gold hover:underline" data-testid="store-contact">
            <Mail size={14} aria-hidden /> {brand.supportEmail}
          </a>
        )}
      </div>
      )}
    </section>
  )
}
