import { ArrowUpRight, CreditCard, Network, Plus, Rocket, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ExtLink } from './ExtLink'
import { ago, fmtDate } from './api'
import { usePoll } from './poll'
import { ErrorLine, Skeleton } from './parts'
import { ServiceHeader, type Status } from './services/ServiceHeader'
import { ProgressSteps, RefreshChip, type ProgressStep } from './ui'
import { mono, panel, panelTitle, pillGold, pillLine, pillSm, rise } from './styles'
import { StatusPill as KitPill, type PillTone } from '../../components/ui/StatusPill'
import { hasGullySession, TALK_TO_US, usd, type Offer, type Order, type OrderStatus } from '../create-chain/chainApi'
import { api } from './api'

/* Chains (app.gullylabs.xyz/#chains): the chains this account ordered from Gully Labs (Create a chain, /create-chain:
   an Arbitrum Orbit L2/L3 set up by a person at Gully Labs, paid through Gully Pay), each with its status, and the
   offer as the server states it (GET /api/chain-orders/offer: free testnet days, add-ons, whether mainnet is open).
   Orders belong to a Gully ID sign-in (server/chain-orders.mjs): a workspace signed in with a wallet alone sees that
   said plainly, with the way to the order flow (which signs in with Gully ID itself). Nothing here is priced or
   provisioned in the browser. */

const TIER_TONE: Record<Order['tier'], PillTone> = { testnet: 'warn', mainnet: 'live' }
const RANK: Record<OrderStatus, number> = { awaiting_payment: -1, cancelled: -1, paid: 0, setting_up: 1, live: 2 }

function stages(o: Order): ProgressStep[] {
  const at = RANK[o.status]
  const first = o.quote.dueCents === 0 ? 'Received' : 'Paid'
  const def: [string, string][] = [['paid', first], ['setting_up', 'Setting up'], ['live', 'Live']]
  if (o.status === 'cancelled') return def.map(([id, label], i) => ({ id, label, state: i === 0 ? 'failed' : 'todo', after: i === 0 ? <span className="ml-2 font-mono text-[11px] text-error">cancelled</span> : undefined }))
  if (o.status === 'awaiting_payment') return def.map(([id, label], i) => ({ id, label: i === 0 ? 'Payment' : label, state: i === 0 ? 'active' : 'todo' }))
  return def.map(([id, label], i) => ({ id, label, state: i < at ? 'done' : i === at ? (i === 2 ? 'done' : 'active') : 'todo' }))
}

function OrderRow({ o, i }: { o: Order; i: number }) {
  return (
    <li className={`${panel} gap-3`} style={rise(i)} data-order={o.id} data-status={o.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {o.logo ? <img src={o.logo} alt="" width={36} height={36} className="size-9 shrink-0 rounded-[10px] object-contain" /> : <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line text-gold" aria-hidden><Network size={16} /></span>}
        <span className="flex min-w-0 flex-[1_1_200px] flex-col">
          <b className="truncate text-[15px] font-semibold text-ink">{o.name}</b>
          <span className={mono}>
            chain id {o.chainId} · gas {o.gasSymbol} · settles to {o.parent.name}
          </span>
        </span>
        <KitPill tone={TIER_TONE[o.tier]}>{o.tier}</KitPill>
        <span className="font-mono text-[12px] text-muted" title={fmtDate(o.createdAt)}>
          ordered {ago(o.createdAt)}
        </span>
      </div>
      <ProgressSteps steps={stages(o)} label={`Order ${o.name}: ${o.statusLabel}`} testId={`order-progress-${o.id}`} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-[13px] text-muted">
          {o.quote.headline} <span className="text-faint">· {o.quote.dueCents ? `${usd(o.quote.dueCents)} due` : 'nothing due today'}{o.quote.monthlyUsd ? ` · then $${o.quote.monthlyUsd.toLocaleString('en-US')} a month` : ''}</span>
        </span>
        <a href={`/create-chain/orders/${encodeURIComponent(o.id)}`} className={pillSm} data-testid="open-order">
          Open order <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </li>
  )
}

/** The offer in one line, from the server. */
function OfferLine({ offer }: { offer: Offer | null }) {
  if (!offer) return <Skeleton h={18} w="60%" />
  return (
    <span className={mono} data-testid="chains-offer">
      testnet free for {offer.freeDays} days · {offer.addons.length} add-ons · mainnet {offer.flags.mainnetOrders ? 'open' : 'on request'} · {offer.billing.note}
    </span>
  )
}

/** Signed in with a wallet alone: the orders cannot be read, and this says why and what to do. */
function NeedsGullyId() {
  return (
    <section className={`${panel} items-start gap-3`} style={rise(1)} data-testid="chains-needs-gully-id">
      <h2 className={panelTitle}>Your chain orders are tied to your Gully ID</h2>
      <p className="m-0 max-w-[560px] text-[14px] leading-[1.55] text-muted">
        This workspace is signed in with a wallet. Chain orders live under the Gully ID that placed them, so they do not show here. Sign out and sign in with Gully ID to see them, or start a new chain: the order flow signs in with Gully ID itself.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/create-chain" className={`${pillGold} min-h-11`}>
          <Plus size={16} aria-hidden /> Create a chain
        </a>
        <ExtLink href={TALK_TO_US} className={`${pillLine} min-h-11`}>
          <Wrench size={15} aria-hidden /> Talk to us
        </ExtLink>
      </div>
    </section>
  )
}

function NoOrders() {
  return (
    <section className={`${panel} flex-row flex-wrap items-center gap-4`} style={rise(1)} data-testid="chains-empty">
      <img src="/brand/kit/owl/owl-presenting-400.webp" srcSet="/brand/kit/owl/owl-presenting-400.webp 1x, /brand/kit/owl/owl-presenting-800.webp 2x" alt="" width={65} height={120} decoding="async" className="block h-[120px] w-auto shrink-0" />
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
        <h2 className={panelTitle}>No chains yet</h2>
        <p className="m-0 text-[14px] leading-[1.55] text-muted">Order your own Arbitrum Orbit chain: explorer, bridge, faucet, RPC through Gully RPC, Gully Core and Gully Multisig included, set up by a person at Gully Labs. The order shows here the moment it is placed.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/create-chain" className={`${pillGold} min-h-11`} data-testid="create-chain">
            <Rocket size={16} aria-hidden /> Create a chain
          </a>
          <ExtLink href={TALK_TO_US} className={`${pillLine} min-h-11`}>
            Talk to us first
          </ExtLink>
        </div>
      </div>
    </section>
  )
}

export function ChainsTab() {
  // Does this browser hold a Gully ID session? Only then can the orders be read.
  const [gid, setGid] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void hasGullySession().then((ok) => alive && setGid(ok))
    return () => {
      alive = false
    }
  }, [])
  const orders = usePoll<{ orders: Order[] }>(gid ? '/api/chain-orders' : null, 60_000)
  const [offer, setOffer] = useState<Offer | null>(null)
  useEffect(() => {
    let alive = true
    void api<Offer>('/api/chain-orders/offer').then((r) => alive && r.ok && setOffer(r.data))
    return () => {
      alive = false
    }
  }, [])

  const list = orders.data?.orders ?? null
  const live = list?.filter((o) => o.status === 'live').length ?? 0
  const open = list?.filter((o) => o.status === 'paid' || o.status === 'setting_up' || o.status === 'awaiting_payment').length ?? 0
  const status: Status = gid === null ? { tone: 'checking', text: 'checking…' } : gid === false ? { tone: 'idle', text: 'Gully ID needed' } : !list ? (orders.error || orders.timedOut ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading' }) : live ? { tone: 'live', text: `${live} live${open ? ` · ${open} in progress` : ''}` } : open ? { tone: 'idle', text: `${open} in progress` } : { tone: 'idle', text: 'no chains yet' }
  const err = list ? null : (orders.error ?? (orders.timedOut ? 'no answer in time' : null))

  return (
    <div className="flex flex-col gap-2" data-testid="chains-page">
      <ServiceHeader
        icon={Network}
        title="Chains"
        eyebrow="Create a chain · sold by Gully Labs"
        desc="Your own Arbitrum Orbit L2 or L3, ordered here and set up by a person at Gully Labs. Each order's status moves on a verified Gully Pay payment or a Gully admin, never from the browser."
        status={status}
        page={{ href: 'https://gullychain.xyz', label: 'Gully Chain' }}
        actions={
          <a href="/create-chain" className={`${pillGold} min-h-11`} data-testid="chains-create">
            <Plus size={16} aria-hidden /> Create a chain
          </a>
        }
      >
        <RefreshChip error={list ? orders.error : null} onRetry={() => void orders.reload()} />
      </ServiceHeader>
      <OfferLine offer={offer} />
      {gid === null ? (
        <Skeleton h={120} />
      ) : gid === false ? (
        <NeedsGullyId />
      ) : err && !list ? (
        <ErrorLine onRetry={() => void orders.reload()}>Your chain orders could not be read: {err}</ErrorLine>
      ) : !list ? (
        <div className="flex flex-col gap-2" aria-busy>
          <Skeleton h={120} />
          <Skeleton h={120} />
        </div>
      ) : !list.length ? (
        <NoOrders />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="chain-orders">
          {list.map((o, i) => (
            <OrderRow key={o.id} o={o} i={i + 1} />
          ))}
        </ul>
      )}
      <p className={`${mono} flex items-center gap-2`}>
        <CreditCard size={12} aria-hidden /> Paid through Gully Pay · receipts and invoices under Billing
      </p>
    </div>
  )
}
