import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, BellRing, Boxes, Check, History, Layers, Network, Send, ShieldCheck, Zap } from 'lucide-react'
import { useContact } from '../components/ContactContext'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { NF } from '../components/charts/number-formats'
import { AnalyticsPlanCards, PlanSkeleton } from '../components/AnalyticsPlans'
import { usePlans } from '../lib/plans'
import { Seo } from '../components/Seo'
import { btnGold, btnOutline, eyebrow } from '../components/ui'
import { DEVELOPERS_URL, DOCS_URL, isLocalHost } from '../site-host'
import type { AlertChannels, Offer } from './developers/api'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { PlanLimits } from '../components/charts/PlanLimits'

/* The paid tiers of the tracker API and the Gully Analytics plans, in two sections. Every price and limit
   is read from GET /api/plans (server/plans.mjs); nothing numeric is typed into this page. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })
const DASHBOARD = isLocalHost() ? '/developers#billing' : `${DEVELOPERS_URL}/#billing`

/** Telegram delivery as the server reports it (GET /api/alerts/channels): null while unknown. */
function useTelegramChannel(): AlertChannels['telegram'] | null {
  const [tg, setTg] = useState<AlertChannels['telegram'] | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/alerts/channels')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (c: AlertChannels) => alive && setTg(c.telegram),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [])
  return tg
}

const telegramAnswer = (tg: AlertChannels['telegram'] | null) =>
  tg === null
    ? 'Alerts can also go to a Telegram chat when the server has its bot configured; the Alerts tab of the developer dashboard shows whether it is. Webhooks always work.'
    : tg.enabled
      ? `Yes. In the Alerts tab of the developer dashboard, press Connect Telegram: it opens ${tg.bot ? `@${tg.bot}` : 'the bot'} with a one-time code that links the chat (or a group) to your wallet, with no chat id to copy. Then tick Telegram on any alert. Messages carry the gap, on-chain and fair prices, a link to the stock and a Mute 24h button.`
      : 'Not yet. Telegram delivery works only once the bot is configured on the server, and it is not configured yet; the dashboard will offer it when it is. Webhooks work today.'

const chainList = (o: Offer | null) => (o ? o.chains.map((c) => c.name).join(', ').replace(/, ([^,]*)$/, ' or $1') : 'Base, Ethereum, BNB Chain, Arbitrum, OP Mainnet, Polygon or Avalanche')
/** Which chains collect a merchant's Gully Pay fee inside the payment (server: feeSplit = verified proxy + deployed treasury). */
const feeSplitList = (o: Offer | null) => {
  const on = o?.chains.filter((c) => c.feeSplit).map((c) => c.name) ?? []
  const off = o?.chains.filter((c) => !c.feeSplit).map((c) => c.name) ?? []
  if (!o) return 'On the chains where Request Network\'s fee proxy is verified and the treasury is deployed, a stablecoin payment to a Gully Pay merchant pays the merchant and the fee in one transaction; elsewhere the fee is invoiced to the merchant weekly.'
  return `${on.length ? `On ${on.join(', ')}: a stablecoin payment to a Gully Pay merchant pays the merchant and the Gully Pay fee in one transaction (Request Network’s fee proxy, verified on each chain). ` : ''}${off.length ? `On ${off.join(', ')} and for coin payments the fee is invoiced to the merchant weekly. ` : ''}Paying Gully Labs itself, as for these plans, is always one plain transfer.`
}
const assetList = (o: Offer | null) =>
  o
    ? o.chains
        .map((c) => `On ${c.name}: ${o.assets.filter((a) => a.chainId === c.id).map((a) => a.symbol).join(', ')}.`)
        .join(' ')
    : ''
const confirmationList = (o: Offer | null) => (o ? o.chains.map((c) => `${c.name} ${c.confirmations}`).join(', ') : 'a few, depending on the chain')

const FAQ = (o: Offer | null, tg: AlertChannels['telegram'] | null): { q: string; a: string }[] => [
  { q: 'How do I pay?', a: `In USDC, USDT or the chain's own coin on ${chainList(o)}. Pick a plan in the developer dashboard, then a chain and an asset; it gives a quote with the exact amount and the Gully Labs treasury address, valid for 20 minutes. Pay with one click from a connected wallet, or send it from any wallet or exchange and paste the transaction hash.` },
  { q: 'What do I pay in?', a: `Prices are in US dollars. ${assetList(o)} Stablecoins are counted one to one with the dollar. The chains' own coins (ETH, BNB, POL, AVAX) are priced by the Chainlink USD feed on the same chain when you ask for the quote, rounded up; if that feed has not updated for two hours, no quote is given in that coin.` },
  { q: 'Do you hold my funds?', a: 'No. Your coin or stablecoin goes straight to the Gully Labs treasury wallet in one transfer, the same as paying any address. There is no deposit, balance or card on file, and nothing is ever taken from your wallet without you signing it.' },
  { q: 'How is a payment checked?', a: `The server reads the transaction from a public node of its chain: it must have succeeded, paid the treasury at least the plan’s price in the quoted asset, and have enough blocks on top (${confirmationList(o)}). Each transaction counts once, on any chain. The plan starts the moment it is confirmed.` },
  { q: 'Which chains collect the merchant fee in one transaction?', a: feeSplitList(o) },
  { q: 'How do I cancel?', a: `Just don’t renew. A payment buys ${o?.periodDays ?? 30} days and nothing renews by itself; when the days run out the account returns to Free with its keys still working at the Free limit.` },
  { q: 'Can I extend or switch?', a: 'Paying again for the same plan adds days to the end of the current period. A different plan starts the day you pay for it; the days left on the old one are not carried over.' },
  { q: 'When does Gully Analytics stop recording?', a: `At the monthly event limit of your plan, until the month turns (UTC) or you upgrade; and when a trial or plan ends without being extended. Your dashboard stays readable for ${o?.analytics?.graceDays ?? 30} days after a plan ends; after that the account may be deleted. Plans are bought in the Analytics tab of the developer dashboard.` },
  { q: 'Can alerts come to Telegram?', a: telegramAnswer(tg) },
  { q: 'What does Free include?', a: 'Keys, usage charts and the request log, as today, with the limits shown above. Calling the API without any key keeps working too, at the anonymous limit.' },
]

function SectionHead({ id, eyebrow: label, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div className="mb-8 flex flex-col gap-3">
      <span className={eyebrow}>{label}</span>
      <h2 id={id} className="m-0 font-display text-h2 font-extrabold uppercase">
        {title}
      </h2>
    </div>
  )
}

const USD0 = { ...NF.usd, minimumFractionDigits: 0, maximumFractionDigits: 0 }

/** Chain Kit and services have no list price: one short block so /pricing covers every product. */
function OnRequest() {
  const { openContact } = useContact()
  const items = [
    { icon: Boxes, name: 'Chain Kit', body: 'A branded Blockscout explorer for your chain, run by us. Priced to your chain’s size and history.', to: '/chain-kit', type: 'Infrastructure' as const },
    { icon: Layers, name: 'Services', body: 'Smart contracts, dApps, infrastructure and security testing. Quoted per project after a first call.', to: '/services', type: 'Other' as const },
  ]
  return (
    <section id="on-request" className="scroll-mt-24 border-t border-line px-page pt-16 pb-16" aria-labelledby="on-request-title">
      <SectionHead id="on-request-title" eyebrow="CHAIN KIT & SERVICES" title="On request" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
        {items.map((it) => (
          <div key={it.name} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-7">
            <span className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-btn border border-gold-line text-gold">
                <it.icon aria-hidden size={20} strokeWidth={1.75} />
              </span>
              <h3 className="m-0 font-display text-h4 font-bold uppercase">{it.name}</h3>
              <span className="ml-auto rounded-full border border-gold-line px-3 py-[3px] font-mono text-[11px] tracking-[1px] text-gold">ON REQUEST</span>
            </span>
            <p className="m-0 text-[15px] leading-[1.55] text-muted">{it.body}</p>
            <div className="mt-auto flex flex-wrap gap-3">
              <button type="button" onClick={() => openContact(it.type)} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                <Send aria-hidden size={16} /> Start a project
              </button>
              <Link to={it.to} className="inline-flex min-h-11 items-center gap-1 text-[15px] text-gold hover:text-gold-hover">
                {it.name} <ArrowUpRight aria-hidden size={15} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** One plan's Holder Map line, from GET /api/plans (holderMap). While the map is not gated every plan has all of it. */
function holderMapLine(hm: NonNullable<Offer['holderMap']>, id: string) {
  if (!hm.gated) return 'Holder Map: every holder view, the replay, CSV and cluster alerts'
  const t = hm.tiers[id as 'free' | 'pro' | 'business'] ?? hm.tiers.free
  return `Holder Map: top ${t.holders} holders${t.replay ? ', the replay' : ''}${t.csv ? ', CSV' : ''}${t.alerts ? ', cluster alerts' : ''}`
}

export function Pricing() {
  const [state, retry] = usePlans()
  const offer = state.k === 'ok' ? state.offer : null
  const tg = useTelegramChannel()
  return (
    <>
      <Seo title="Pricing" description="Plans for the Gully Labs tracker API and for Gully Analytics, paid in USDC, USDT or the chain's own coin on Base, Ethereum, BNB Chain, Arbitrum, OP Mainnet, Polygon or Avalanche, with no custody." />

      <section className="relative overflow-hidden px-page pt-[72px] pb-12">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.14),transparent_62%)]" />
        <div className="relative flex max-w-[860px] flex-col gap-6">
          <span className={eyebrow} style={rise(0)}>
            PRICING
          </span>
          <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
            Tracker API and <span className="text-gold whitespace-nowrap">Gully Analytics</span>
          </h1>
          <p className="m-0 max-w-[680px] text-[18px] leading-[1.6] text-muted" style={rise(2)}>
            Two products, priced separately. The tracker API stays free and open; paid plans raise the per-key limit, add gap alerts by webhook and keep a longer gap history. Gully Analytics starts with a free trial. You pay in ETH, BNB, USDC or USDT from your own wallet, straight to ours: no card, no custody, nothing that renews behind your back.
          </p>
        </div>
      </section>

      <section id="api" className="scroll-mt-24 px-page pb-16" aria-live="polite" aria-labelledby="api-title">
        <SectionHead id="api-title" eyebrow="TRACKER API" title="More calls, alerts and history" />
        {state.k === 'loading' && <PlanSkeleton />}
        {state.k === 'error' && (
          <div className="flex flex-wrap items-center gap-4 rounded-card border border-error-line bg-error/6 px-6 py-5 text-[15px] text-error" role="alert">
            The plans could not be read: {state.message}
            <button type="button" onClick={retry} className={`${btnOutline} min-h-11 px-5 text-[14px]`}>
              Try again
            </button>
          </div>
        )}
        {offer && (
          <div className="flex flex-col gap-5">
            {!offer.checkout.enabled && (
              <p className="m-0 rounded-input border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-2" role="status">
                {offer.checkout.reason} The limits below are what each plan will include; Free works today.
              </p>
            )}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
              {offer.plans.map((p, i) => {
                const featured = p.id === 'pro'
                return (
                  <div key={p.id} className={`relative flex flex-col gap-6 overflow-hidden rounded-card border bg-surface p-7 ${featured ? 'border-gold-line' : 'border-line'}`} style={rise(3 + i)}>
                    {featured && <span aria-hidden className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(217,181,99,.06)_50%,transparent_70%)] bg-[length:200%_100%]" />}
                    <div className="relative flex flex-col gap-2">
                      <span className="font-mono text-[12px] tracking-[1.5px] text-faint">{p.name.toUpperCase()}</span>
                      <span className="flex items-baseline gap-2">
                        <AnimatedNumber className={`font-display text-[64px] leading-[.9] font-extrabold ${featured ? 'text-gold' : 'text-ink'}`} value={p.priceUsdc} format={USD0} countUp />
                        <span className="font-mono text-[13px] text-muted">{p.priceUsdc ? `/ ${offer.periodDays} days` : 'free, no time limit'}</span>
                      </span>
                    </div>
                    <ul className="relative m-0 flex list-none flex-col gap-3 p-0 text-[15px] text-ink-2">
                      <li className="flex items-start gap-3">
                        <Zap size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {p.perMin.toLocaleString('en-US')} requests a minute per key, up to {p.maxKeys} keys
                      </li>
                      <li className="flex items-start gap-3">
                        <BellRing size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {p.alerts} gap alert{p.alerts === 1 ? '' : 's'} by webhook{tg?.enabled ? ' or Telegram' : ''}
                      </li>
                      <li className="flex items-start gap-3">
                        <History size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {p.historyDays} days of gap history per stock
                      </li>
                      {offer.holderMap && (
                        <li className="flex items-start gap-3">
                          <Network size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {holderMapLine(offer.holderMap, p.id)}
                        </li>
                      )}
                      <li className="flex items-start gap-3">
                        <Check size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> Usage charts and request log
                      </li>
                    </ul>
                    <a href={DASHBOARD} className={`${featured ? btnGold : btnOutline} relative mt-auto inline-flex min-h-12 items-center justify-center gap-2 px-6 text-[16px]`}>
                      {p.priceUsdc ? (offer.checkout.enabled ? `Get ${p.name}` : 'Open the dashboard') : 'Get a key'} <ArrowUpRight size={16} aria-hidden />
                    </a>
                  </div>
                )
              })}
            </div>
            <PlanLimits
              tiers={[
                { name: 'No key', perMin: offer.anonymous.perMin, historyDays: offer.anonymous.historyDays, alerts: null, maxKeys: null },
                ...offer.plans.map((p) => ({ name: p.name, perMin: p.perMin, historyDays: p.historyDays, alerts: p.alerts, maxKeys: p.maxKeys })),
              ]}
            />
            <p className="m-0 font-mono text-[12px] leading-[1.7] text-faint">
              Without a key: {offer.anonymous.perMin} requests a minute per IP address and {offer.anonymous.historyDays} days of history. Prices in US dollars, paid in USDC, USDT or the chain's own coin on {chainList(offer)}. Limits protect our servers; answers served from the edge cache do not count against them.
            </p>
          </div>
        )}
      </section>

      <section id="analytics" className="scroll-mt-24 border-t border-line px-page pt-16 pb-16" aria-live="polite" aria-labelledby="analytics-title">
        <SectionHead id="analytics-title" eyebrow="GULLY ANALYTICS" title="Web analytics that see the wallet" />
        <AnalyticsPlanCards state={state} retry={retry} delay={3} />
      </section>

      <OnRequest />

      <section className="px-page pb-24">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-10 rounded-card border border-line bg-surface-deep p-8 max-[900px]:grid-cols-1 max-[600px]:p-5">
          <div className="flex flex-col gap-4">
            <h2 className="m-0 font-display text-h2 font-bold uppercase">Questions</h2>
            <p className="m-0 flex items-start gap-2 text-[14px] leading-[1.6] text-muted">
              <ShieldCheck size={16} className="mt-[3px] shrink-0 text-gold" aria-hidden /> Paid in USDC, USDT or the chain's own coin on {offer ? offer.chains.length : 'seven'} chains, checked on chain, no custody.
            </p>
            <a href={`${DOCS_URL}/plans-alerts`} {...newTab} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
              Plans &amp; alerts docs <NewTabMark size={13} />
            </a>
          </div>
          <dl className="m-0 flex flex-col gap-6">
            {FAQ(offer, tg).map((f) => (
              <div key={f.q} className="flex flex-col gap-2 border-b border-line pb-5 last:border-b-0 last:pb-0">
                <dt className="font-display text-[22px] leading-none font-bold uppercase">{f.q}</dt>
                <dd className="m-0 text-[15px] leading-[1.65] text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  )
}
