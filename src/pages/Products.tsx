import { Boxes, ChartNoAxesCombined, Cpu, Eye, Fingerprint, GitBranch, Layers, Link2, Palette, Rocket, ServerCog, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react'
import { AnalyticsPlanCards } from '../components/AnalyticsPlans'
import { ANALYTICS_SIGNUP, usePlans } from '../lib/plans'
import { useContact } from '../components/ContactContext'
import { Seo } from '../components/Seo'
import { btnGold, btnOutline, eyebrow } from '../components/ui'
import { AnalyticsExample, ChainKitExample } from '../components/charts/ProductExamples'
import { useMemo } from 'react'
import { projects } from '../content/projects'
import { useStats } from '../hooks/useStats'
import { fmtDay, fmtUsd, type VenueOk } from '../lib/stats'
import { CHAIN_NAME, STATUS_LABEL, useTracker, type TrackerStatus } from '../lib/tracker'
import { track } from '../lib/track'
import { BlinkDot } from '../components/ui'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { ChainLogo } from '../components/logos/ChainLogo'
import { VenueLogo } from '../components/logos/VenueLogo'
import { EChart } from '../components/charts/EChart'
import { ChartBox } from '../components/charts/ChartSkeleton'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { NF } from '../components/charts/number-formats'
import { axisTooltip, barsPreset, C, CHART_H, linePreset, tipHtml } from '../components/charts/chartPresets'

/* Product pages for the two open-source-based products. Copy states what exists today; nothing
   numeric about customers or usage is claimed. The "What it draws" charts are illustrations with
   example data, badged EXAMPLE DATA on screen and in their accessible labels. Each page also carries
   one LIVE chart read from our own API (Analytics: GET /api/stats, Chain Kit: GET /api/tracker),
   badged LIVE; a figure that could not be read is said to be so, never drawn as 0. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

type Feature = { icon: LucideIcon; title: string; body: string }
type Product = {
  seo: { title: string; description: string }
  eyebrow: string
  title: [string, string]
  lead: string
  status: string
  cta: string
  ctaType: 'Infrastructure' | 'dApp / frontend' | 'Other'
  /** When set, the main button links here instead of opening the contact form. */
  ctaHref?: string
  /** Shows the plans read from GET /api/plans. */
  pricing?: boolean
  source: { label: string; href: string } | null
  features: Feature[]
  how: { title: string; body: string }[]
  code?: string
  licence: string
  /** An interactive illustration of what the product draws (example data, labelled as such). */
  figure?: { title: string; body: string; node: React.ReactNode }
  /** A live chart from our own API, relevant to the product (badged LIVE). */
  live: { title: string; body: string; node: React.ReactNode }
}

const ANALYTICS: Product = {
  seo: {
    title: 'Gully Analytics',
    description: 'Privacy-friendly web analytics for dapps: page views plus wallet connects, chains and transactions, with a visit to wallet to transaction funnel.',
  },
  eyebrow: 'PRODUCT · GULLY ANALYTICS',
  title: ['Analytics that see', 'the wallet'],
  lead: 'Page views alone don’t tell a dapp what worked. Gully Analytics adds what happens next: which visits connected a wallet, on which chain, with which wallet app, and which went on to send a transaction.',
  status: 'Free trial',
  cta: 'Start free trial',
  ctaType: 'dApp / frontend',
  ctaHref: ANALYTICS_SIGNUP,
  pricing: true,
  source: { label: 'gully-labs/umami', href: 'https://github.com/gully-labs/umami/tree/gully/analytics' },
  features: [
    { icon: Wallet, title: 'Wallet connects', body: 'Detected through EIP-6963 and window.ethereum, by observing the wallet, never by prompting it.' },
    { icon: Link2, title: 'Chains and switches', body: 'Every connect, chain switch and transaction carries its chain, named for Ethereum, Base, BNB Chain, Robinhood Chain, Arc and more.' },
    { icon: ChartNoAxesCombined, title: 'Visit → wallet → transaction', body: 'A funnel from session to connected wallet to sent transaction, plus top pages by connects and wallet apps used.' },
    { icon: Fingerprint, title: 'Addresses hashed by default', body: 'Unique wallets are counted from a one-way hash of the address. Full addresses or none are one attribute away.' },
    { icon: Eye, title: 'Everything Umami does', body: 'Page views, referrers, countries, devices, events and goals, cookie-free, on a dashboard you own.' },
    { icon: ShieldCheck, title: 'Opt-in, small, open', body: 'Web3 tracking turns on with one attribute; the whole script stays a few kilobytes. The source is public.' },
  ],
  how: [
    { title: 'Sign in and add your site', body: 'Connect a wallet in the app dashboard, start the free trial and add your domain.' },
    { title: 'Add the script', body: 'One tag on your dapp, with data-web3="true".' },
    { title: 'Use your dapp as usual', body: 'Connects, chain switches and transactions are recorded as they happen.' },
    { title: 'Read the Web3 tab', body: 'Wallets, connect rate, transactions, chains and the funnel for any date range.' },
  ],
  code: '<script defer src="https://analytics.gullylabs.xyz/script.js"\n  data-website-id="YOUR-SITE-ID" data-web3="true"></script>',
  licence: 'Built on Umami, MIT licensed. Our changes are MIT too.',
  live: {
    title: 'Our own dapps, on chain',
    body: 'The onchain activity the Web3 tab is built to follow, read live from the venues Gully Labs runs: the daily volume each one publishes, refreshed every minute.',
    node: <VenueVolumeLive />,
  },
  figure: { title: 'What the Web3 tab draws', body: 'The charts below use made-up example figures to show the views; your dashboard draws your own site.', node: <AnalyticsExample /> },
}

const CHAIN_KIT: Product = {
  seo: {
    title: 'Chain Kit',
    description: 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.',
  },
  eyebrow: 'PRODUCT · CHAIN KIT',
  title: ['An explorer for', 'your chain'],
  lead: 'A new chain needs a block explorer on day one. Chain Kit is Blockscout, set up for your chain, in your brand, and run by the team that builds on these chains every day. Chain Kit: join the waitlist. We’re finalising the explorer licence before taking orders.',
  status: 'Waitlist',
  cta: 'Join the waitlist',
  ctaType: 'Infrastructure',
  ctaHref: '/chains#waitlist',
  source: null, // gully-labs/blockscout is private
  features: [
    { icon: Boxes, title: 'Full explorer', body: 'Blocks, transactions, addresses, tokens, NFTs, contract verification, APIs and charts, from Blockscout.' },
    { icon: Palette, title: 'Your brand', body: 'Your name, logos, colours and links across the explorer, configured rather than forked, so upgrades stay simple.' },
    { icon: Layers, title: 'Rollups included', body: 'Profiles for Arbitrum Nitro and Orbit chains like Robinhood Chain, and for chains like Arc with a stablecoin as gas.' },
    { icon: ServerCog, title: 'Operated for you', body: 'Provisioning, TLS, backups, upgrades and monitoring, with a runbook for every common failure.' },
    { icon: Cpu, title: 'Sized honestly', body: 'A busy rollup needs terabytes; a young chain needs far less. We size the server and the RPC to your chain before anything is promised.' },
    { icon: GitBranch, title: 'No lock-in', body: 'Your chain, your data and your domain stay yours. You are never locked in.' },
  ],
  how: [
    { title: 'Join the waitlist', body: 'Tell us your chain id, RPC, settlement layer and how much history you need.' },
    { title: 'We size and deploy', body: 'A dedicated server, your branding and the indexer, on a domain of your choice.' },
    { title: 'Launch and run', body: 'We keep it indexed, upgraded and backed up while you build the chain.' },
  ],
  licence: 'Built on Blockscout.',
  live: {
    title: 'Chains we read right now',
    body: 'Gully Labs already reads these chains around the clock for the Stock tracker. Each bar is the stock tokens on that chain and how they read this minute.',
    node: <ChainsLive />,
  },
  figure: { title: 'Charts on day one', body: 'Blockscout charts your chain from its first block. The figures below are made-up examples of what it draws.', node: <ChainKitExample /> },
}

function ProductPage({ p }: { p: Product }) {
  const { openContact } = useContact()
  return (
    <>
      <Seo title={p.seo.title} description={p.seo.description} />
      <section className="relative overflow-hidden px-page pt-[72px] pb-16">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.14),transparent_62%)]" />
        <div className="relative flex max-w-[900px] flex-col gap-6">
          <span className="flex flex-wrap items-center gap-3" style={rise(0)}>
            <span className={eyebrow}>{p.eyebrow}</span>
            <span className="rounded-full border border-gold-line px-3 py-[3px] font-mono text-[11px] tracking-[1px] text-gold">{p.status.toUpperCase()}</span>
          </span>
          <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
            {p.title[0]} <span className="text-gold whitespace-nowrap">{p.title[1]}</span>
          </h1>
          <p className="m-0 max-w-[700px] text-[18px] leading-[1.6] text-muted" style={rise(2)}>
            {p.lead}
          </p>
          <div className="flex flex-wrap gap-3" style={rise(3)}>
            {p.ctaHref ? (
              <a
                href={p.ctaHref}
                {...(/^https?:/.test(p.ctaHref) ? newTab : {})}
                onClick={() => {
                  track('cta-click', { cta: p.seo.title, page: location.pathname })
                  track('launch-app', { from: `product-${p.seo.title}` })
                }}
                className={`${btnGold} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}
              >
                <Rocket aria-hidden size={18} strokeWidth={1.75} />
                {p.cta}
                {/^https?:/.test(p.ctaHref) && <NewTabMark size={16} className="flex-none" />}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  track('cta-click', { cta: p.seo.title, page: location.pathname })
                  openContact(p.ctaType)
                }}
                className={`${btnGold} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}>
                <Rocket aria-hidden size={18} strokeWidth={1.75} />
                {p.cta}
              </button>
            )}
            {p.source && (
              <a href={p.source.href} {...newTab} className={`${btnOutline} inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-[26px] py-4 text-[16px] max-[479px]:px-4 max-[479px]:text-[15px]`}>
                <GitBranch aria-hidden size={18} strokeWidth={1.75} />
                <span className="min-w-0 break-words">Source: {p.source.label}</span>
                <NewTabMark size={16} className="flex-none" />
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="px-page pb-20">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
          {p.features.map((f, i) => (
            <div key={f.title} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-7 transition-[border-color,transform] duration-200 hover:-translate-y-1 hover:border-gold" style={rise(i)}>
              <span className="flex size-11 items-center justify-center rounded-btn border border-gold-line text-gold">
                <f.icon aria-hidden size={20} strokeWidth={1.75} />
              </span>
              <h2 className="m-0 font-display text-h4 font-bold uppercase">{f.title}</h2>
              <p className="m-0 text-[15px] leading-[1.55] text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-page pb-20" aria-labelledby="live-title">
        <div className="mb-8 flex flex-col gap-3">
          <span className={eyebrow}>LIVE FROM GULLY LABS</span>
          <h2 id="live-title" className="m-0 font-display text-h2 font-extrabold uppercase">
            {p.live.title}
          </h2>
          <p className="m-0 max-w-[680px] text-[15px] leading-[1.6] text-muted">{p.live.body}</p>
        </div>
        {p.live.node}
      </section>

      {p.figure && (
        <section className="px-page pb-20" aria-labelledby="figure-title">
          <div className="mb-8 flex flex-col gap-3">
            <span className={eyebrow}>IN THE PRODUCT</span>
            <h2 id="figure-title" className="m-0 font-display text-h2 font-extrabold uppercase">
              {p.figure.title}
            </h2>
            <p className="m-0 max-w-[680px] text-[15px] leading-[1.6] text-muted">{p.figure.body}</p>
          </div>
          {p.figure.node}
        </section>
      )}

      {p.pricing && <Plans />}

      <section className="border-t border-line bg-bg-alt px-page py-20">
        <span className={eyebrow}>HOW IT WORKS</span>
        <ol className="m-0 mt-6 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line p-0">
          {p.how.map((h, i) => (
            <li key={h.title} className="relative flex flex-col gap-3 bg-bg-alt p-7">
              <span className="font-display text-[44px] leading-none font-extrabold text-gold">{i + 1}</span>
              <h3 className="m-0 font-display text-h4 font-bold uppercase">{h.title}</h3>
              <span className="text-[15px] leading-[1.55] text-muted">{h.body}</span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gold" style={{ animation: `gl-grow-x .8s ${0.3 + i * 0.15}s cubic-bezier(.2,.8,.2,1) both` }} />
            </li>
          ))}
        </ol>
        {p.code && (
          <pre className="m-0 mt-8 overflow-x-auto rounded-card border border-line bg-bg p-6 font-mono text-[14px] leading-[1.6] text-ink-2">
            <code>{p.code}</code>
          </pre>
        )}
        <p className="m-0 mt-8 font-mono text-[12px] text-faint">{p.licence}</p>
      </section>
    </>
  )
}

function Plans() {
  const [state, retry] = usePlans()
  return (
    <section className="px-page pb-20" aria-labelledby="plans-title" aria-live="polite">
      <div className="mb-8 flex flex-col gap-3">
        <span className={eyebrow}>PLANS</span>
        <h2 id="plans-title" className="m-0 font-display text-h2 font-extrabold uppercase">
          Start free, <span className="text-gold">pay in crypto</span>
        </h2>
      </div>
      <AnalyticsPlanCards state={state} retry={retry} />
    </section>
  )
}

/* ---------- live charts ---------- */

function LiveFrame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card-token p-card">
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[20px] leading-none font-bold uppercase">{title}</span>
          <span className="font-mono text-[11px] text-faint">{sub}</span>
        </span>
        <span className="flex items-center gap-2 rounded-full border border-line-strong px-2 py-[2px] font-mono text-[11px] tracking-[1px] text-green">
          <BlinkDot color="green" />
          LIVE
        </span>
      </figcaption>
      {children}
    </figure>
  )
}

const DAY = 86_400
const LIVE_DAYS = 30
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Daily volume each Gully venue publishes (GET /api/stats), one line per venue over the last 30 days.
    A day a venue did not publish is a gap in its line, never a 0; a venue with no series is named below. */
function VenueVolumeLive() {
  const st = useStats()
  const model = useMemo(() => {
    if (st.k !== 'ok') return null
    const ok = st.data.venues.filter((v): v is VenueOk => v.state === 'ok' && v.daily.length > 0)
    const newest = Math.max(0, ...ok.flatMap((v) => v.daily.map((d) => d.t)))
    const from = newest - (LIVE_DAYS - 1) * DAY
    const days = [...new Set(ok.flatMap((v) => v.daily.filter((d) => d.t >= from).map((d) => d.t)))].sort((a, b) => a - b)
    const series = projects.flatMap((p) => {
      const v = ok.find((x) => x.key === p.key)
      if (!v) return []
      const by = new Map(v.daily.map((d) => [d.t, d.v]))
      const data = days.map((t) => by.get(t) ?? null)
      return data.some((d) => d !== null) ? [{ p, data }] : []
    })
    const unread = projects.filter((p) => !series.some((s) => s.p.key === p.key)).map((p) => p.name)
    const latest = series.reduce<number | null>((sum, s) => {
      const v = s.data[s.data.length - 1]
      return v === null ? sum : (sum ?? 0) + v
    }, null)
    return { days, series, unread, latest, at: st.data.generatedAt }
  }, [st])
  const option = useMemo(() => {
    if (!model) return {}
    const labels = model.days.map(fmtDay)
    return {
      grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: labels, axisLabel: { color: C.faint, fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', axisLabel: { color: C.faint, fontSize: 11, formatter: (v: number) => fmtUsd(v) }, splitLine: { lineStyle: { color: C.grid } } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        if (i < 0) return ''
        return tipHtml({
          title: labels[i],
          rows: model.series.map((s) => ({ name: s.p.name, value: s.data[i] === null ? 'not published' : fmtUsd(s.data[i]), color: s.p.accent })),
          note: 'Daily volume as each venue publishes it on its own API.',
        })
      }),
      series: model.series.map((s) => ({ id: s.p.key, name: s.p.name, ...linePreset({ color: s.p.accent, width: 2 }), connectNulls: false, data: s.data })),
    }
  }, [model])
  const sub = model ? `Updated ${clock(model.at)} · GET /api/stats` : 'GET /api/stats · refreshed every minute'
  const empty = st.k === 'ok' && !model?.series.length
  return (
    <LiveFrame title="Daily volume, last 30 days" sub={sub}>
      {model && model.series.length ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <AnimatedNumber value={model.latest} format={NF.compactUsd} fallback="not tracked yet" className="font-display text-[32px] leading-none font-extrabold" />
            <span className="font-mono text-[12px] text-faint">newest day, across the venues that published it</span>
          </div>
          <EChart option={option} height={CHART_H.lg} label={`Live daily volume of ${model.series.map((s) => s.p.name).join(', ')} over the last ${model.days.length} days`} skeleton="line" steps={{ count: model.days.length }} />
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[12px] text-muted">
            {model.series.map((s) => (
              <li key={s.p.key} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: s.p.accent }} />
                <VenueLogo venue={s.p.key} name={s.p.name} size={16} decorative />
                {s.p.name}
              </li>
            ))}
            {model.unread.map((n) => (
              <li key={n} className="text-faint">
                {n}: not tracked yet
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ChartBox
          height={CHART_H.lg}
          state={st.k === 'loading' ? 'loading' : 'error'}
          variant="line"
          message={empty ? 'No venue published a daily series just now. Retrying every minute.' : 'The live venue figures could not be read just now. Retrying every minute.'}
        />
      )}
    </LiveFrame>
  )
}

type ReadKind = 'trusted' | 'caution' | 'unreadable'
const KIND: Record<ReadKind, { label: string; color: string }> = {
  trusted: { label: 'Read and trusted', color: C.green },
  caution: { label: 'Thin pool or unverified', color: C.gold },
  unreadable: { label: 'No pool or unreadable', color: C.error },
}
const KINDS = Object.keys(KIND) as ReadKind[]
const kindOf = (s: TrackerStatus): ReadKind =>
  s === 'thin' || s === 'unverified' ? 'caution' : s === 'no-pool' || s === 'pool-unreadable' || s === 'feed-unreadable' ? 'unreadable' : 'trusted'

/** Per chain, the stock tokens the Stock tracker reads this minute (GET /api/tracker), split by how they read. */
function ChainsLive() {
  const st = useTracker()
  const model = useMemo(() => {
    if (st.k !== 'ok') return null
    const chains = st.data.chains.map((c) => {
      const rows = st.data.rows.filter((r) => r.chain === c.key)
      const counts: Record<ReadKind, number> = { trusted: 0, caution: 0, unreadable: 0 }
      const statuses: Partial<Record<TrackerStatus, number>> = {}
      for (const r of rows) {
        counts[kindOf(r.status)]++
        statuses[r.status] = (statuses[r.status] ?? 0) + 1
      }
      return { key: c.key, name: CHAIN_NAME[c.key] ?? c.name, total: rows.length, counts, statuses, poolsAsOf: c.poolsAsOf, stale: c.poolsStale }
    })
    return { chains, total: st.data.rows.length, at: st.data.generatedAt }
  }, [st])
  const option = useMemo(() => {
    if (!model) return {}
    return {
      grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { color: C.faint, fontSize: 11 }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: model.chains.map((c) => c.name), inverse: true, axisLabel: { color: C.muted, fontSize: 12 }, axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const c = model.chains[ps[0]?.dataIndex ?? -1]
        if (!c) return ''
        return tipHtml({
          title: `${c.name} · ${c.total} tokens`,
          rows: (Object.entries(c.statuses) as [TrackerStatus, number][]).map(([s, n]) => ({ name: STATUS_LABEL[s], value: String(n), color: KIND[kindOf(s)].color })),
          note: c.poolsAsOf ? `Pools read at ${clock(c.poolsAsOf)}${c.stale ? ' (last good read)' : ''}` : 'Pools not read yet',
        })
      }, 'shadow'),
      series: KINDS.map((k) => ({
        id: k,
        name: KIND[k].label,
        ...barsPreset({ horizontal: true, radius: 0, focus: 'series' }),
        stack: 'rows',
        barMaxWidth: 26,
        color: KIND[k].color,
        data: model.chains.map((c) => c.counts[k]),
      })),
    }
  }, [model])
  const sub = model ? `Updated ${clock(model.at)} · GET /api/tracker` : 'GET /api/tracker · refreshed every minute'
  const height = Math.max(CHART_H.sm, (model?.chains.length ?? 3) * 48 + 32)
  return (
    <LiveFrame title="Stock tokens read, per chain" sub={sub}>
      {model && model.chains.length ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <AnimatedNumber value={model.total} className="font-display text-[32px] leading-none font-extrabold" />
            <span className="font-mono text-[12px] text-faint">stock tokens on {model.chains.length} chains, re-read every minute</span>
          </div>
          <EChart option={option} height={height} label={`Live: stock tokens read per chain, ${model.chains.map((c) => `${c.name} ${c.total}`).join(', ')}`} steps={{ count: model.chains.length }} />
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[12px] text-muted">
            {model.chains.map((c) => (
              <li key={c.key} className="flex items-center gap-1.5 text-ink-2">
                <ChainLogo chain={c.key} size={16} decorative />
                {c.name}
              </li>
            ))}
          </ul>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[12px] text-muted">
            {KINDS.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: KIND[k].color }} />
                {KIND[k].label}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ChartBox height={CHART_H.sm} state={st.k === 'loading' ? 'loading' : 'error'} message="The Stock tracker could not be read just now. Retrying every minute." />
      )}
    </LiveFrame>
  )
}

export const Analytics = () => <ProductPage p={ANALYTICS} />
export const ChainKit = () => <ProductPage p={CHAIN_KIT} />
