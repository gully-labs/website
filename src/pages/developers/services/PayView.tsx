import { ArrowRight, CircleDollarSign, CreditCard, Link2, Receipt, Store } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NF } from '../../../components/charts/number-formats'
import { TokenLogo } from '../../../components/logos/TokenLogo'
import { ChainConfirmations, PriceChart } from '../../pay/PayCharts'
import { fmtDate, type BillingView } from '../api'
import { ErrorLine, Skeleton } from '../parts'
import { chip, pillGold, pillSm } from '../styles'
import { LiveMarker, StackedDays } from '../vcharts'
import { docsPage, sitePage, type ServiceCtx } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'
import { useLoad } from './useLoad'

/* Gully Pay, in the app: what this workspace has paid through Gully Pay (GET /api/developer/billing,
   every minute), the assets and chains it accepts (the same offer the checkout uses), each native
   coin's live Chainlink price (the pay pages' PriceChart) and the confirmations each chain needs
   (ChainConfirmations). Paying for a plan is the Billing page; pay links, invoices and stores for
   your own customers are the Merchants page, next to this one in the sidebar. */

export default function PayView({ ctx }: { ctx: ServiceCtx }) {
  const s = useLoad<BillingView>('/api/developer/billing')
  const v = s.k === 'ok' ? s.data : null
  const offer = v?.offer ?? null
  const natives = useMemo(() => (offer ? offer.assets.filter((a) => a.kind === 'native' && a.feed) : []), [offer])
  const [coin, setCoin] = useState<string | null>(null)
  const asset = natives.find((a) => a.id === coin) ?? natives[0] ?? null
  const usd = v ? v.payments.reduce((t, p) => t + Number(p.usd ?? 0), 0) : null
  const days = useMemo(() => (v ? [...v.payments].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ label: fmtDate(p.at), values: { usd: Math.round(Number(p.usd ?? 0)) } })) : []), [v])
  const pending = s.k === 'error' ? 'unreadable' : '…'
  const status: Status = !v ? (s.k === 'error' ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }) : offer?.checkout.enabled ? { tone: 'live', text: 'checkout open' } : { tone: 'idle', text: 'checkout closed here' }

  return (
    <>
      <ServiceHeader
        icon={CircleDollarSign}
        title="Gully Pay"
        desc="Crypto payments straight to a wallet: ETH, BNB, USDC and USDT on Base, Ethereum, BNB Chain and Arbitrum, checked on chain."
        status={status}
        docs={docsPage('gully-pay')}
        page={{ href: sitePage('/#pay') }}
        actions={
          <button type="button" onClick={() => ctx.go('merchant')} className={pillSm}>
            <Store size={14} aria-hidden /> Merchants
          </button>
        }
        tiles={[
          { label: 'PAYMENTS', value: v?.payments.length, unknown: pending, note: 'to Gully, this workspace' },
          { label: 'PAID', value: usd === null ? null : Math.round(usd), format: NF.compactUsd, unknown: pending, note: 'in USD at quote time' },
          { label: 'ASSETS', value: offer?.assets.length, unknown: pending, note: offer ? `${offer.chains.length} chains` : 'accepted' },
          { label: 'OPEN QUOTES', value: v?.intents.length, unknown: pending, note: '20 minutes each' },
        ]}
      />

      {s.k === 'error' && <ErrorLine>Gully Pay could not be read just now: {s.message}</ErrorLine>}

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section title="Payments" sub="every payment this workspace made through Gully Pay, in USD" aside={<button type="button" onClick={() => ctx.go('billing')} className={pillSm}><CreditCard size={14} aria-hidden /> Billing and receipts</button>}>
          {!v ? (
            <Skeleton h={170} />
          ) : days.length ? (
            <StackedDays height={170} days={days} kinds={[{ id: 'usd', name: 'USD', color: '#6fcf6a' }]} label={`Payments over time: ${v.payments.length}.`} />
          ) : (
            <LiveMarker text="No payments yet: pay for a plan from Billing and it charts here" height={170} />
          )}
        </Section>

        <Section title="Pay links, invoices and stores" sub="take crypto from your own customers">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] text-muted">
            <li className="flex items-start gap-2"><Link2 size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden /> Reusable pay links, fixed or open amounts, each payer gets a quote.</li>
            <li className="flex items-start gap-2"><Receipt size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden /> Invoices with printable receipts and signed webhooks.</li>
            <li className="flex items-start gap-2"><Store size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden /> Stores and wallets, run from this workspace.</li>
          </ul>
          <button type="button" onClick={() => ctx.go('merchant')} className={`${pillGold} w-fit`}>
            Open Merchants <ArrowRight size={14} aria-hidden />
          </button>
        </Section>
      </div>

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section
          title="Live coin prices"
          sub="Chainlink USD feed, read every 30 seconds while open"
          aside={
            natives.length > 1 ? (
              <div role="group" aria-label="Coin" className="flex flex-wrap gap-1">
                {natives.map((a) => (
                  <button key={a.id} type="button" aria-pressed={asset?.id === a.id} onClick={() => setCoin(a.id)} className={chip(asset?.id === a.id, true)}>
                    <TokenLogo symbol={a.symbol} size={14} /> {a.symbol} · {a.chain}
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          {!v ? <Skeleton h={190} /> : asset ? <PriceChart key={asset.id} asset={asset} /> : <LiveMarker text="No native coin with a price feed is accepted here" height={150} />}
        </Section>
        <Section title="Confirmations" sub="what each accepted chain needs before a payment counts">
          {!offer ? <Skeleton h={150} /> : offer.assets.length ? <ChainConfirmations assets={offer.assets} /> : <LiveMarker text="No assets accepted on this server" height={120} />}
        </Section>
      </div>
    </>
  )
}
