import { useMemo } from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Seo } from '../components/Seo'
import { fmtUsd, fmtInt, fmtTime } from '../console/charts'
import { chainHead, coversOf, totalOf, useLive, venueSeries, type Live } from '../console/live'
import { APP_URL } from '../site-host'
import '../terminal/terminal.css'
import { PRODUCTS, SERVICES } from '../terminal/catalog'
import { A, Dot, fmtCompact, fmtEth, hourLabel, Kpi, Panel, S, SecHead, sum, TChart, UptimeGrid, useHubProducts, useReveal, ACCENT, type ChartTab, type HubProducts } from '../terminal/kit'
import { CaseStudies, ContactForm, LogoWall, Process, ServicesList } from '../terminal/sections'

/* The landing, v3 (2026-10-26): Gully Labs as a web3 product studio and development services company, in the Gully
   Terminal style (owner brief: clean, minimal, corporate, terminal). Hero with the kit logo and tagline beside a live
   status panel, the product logo wall (one page each), the live network (venues from /api/stats, Gully Chain from
   /api/hub/products, uptime of every surface and Gully Quests from /api/hub), services, case studies, process and
   the contact intake. Every figure is read live; unreadable sources say so. */

export function venueTabs(live: Live): ChartTab[] {
  const { stats, statsState } = live
  const st = stats ? 'ok' : statsState === 'error' ? 'offline' : 'loading'
  const tab = (m: 'tvl' | 'volume' | 'fees', label: string, title: string, what: string): ChartTab => {
    const vs = stats ? venueSeries(stats, m, 30) : { series: [], labels: [] }
    return {
      id: m,
      label,
      title,
      series: vs.series,
      labels: vs.labels,
      fmt: (v) => fmtUsd(v),
      stacked: true,
      state: st,
      empty: 'venue APIs could not be read · retrying',
      head: stats ? fmtUsd(totalOf(stats, m)) : '—',
      sub: stats ? `${what} · ${coversOf(stats, m).length} of ${stats.venues.length} venues · read ${fmtTime(stats.generatedAt)}` : 'reading venue APIs',
    }
  }
  return [tab('tvl', 'Value locked', 'Value locked by venue, 30 days (USD)', 'USD value locked now'), tab('volume', 'Volume', 'Daily volume by venue, 30 days (USD)', 'USD volume, all-time'), tab('fees', 'Fees', 'Daily fees by venue, 30 days (USD)', 'USD fees, all-time')]
}

export function chainTabs(hp: HubProducts | null, state: string): ChartTab[] {
  const h = hp?.chain?.hourly ?? []
  const a = hp?.activity?.hourly ?? []
  const labels = h.map((x) => hourLabel(x.t))
  const off = state === 'error' || (hp && !hp.chain) ? 'offline' : !hp ? 'loading' : 'ok'
  const offA = state === 'error' || (hp && !hp.activity) ? 'offline' : !hp ? 'loading' : 'ok'
  const idle = (xs: number[]) => (xs.every((v) => v === 0) ? 'quiet: no transactions in the last 24 h' : undefined)
  const t = (id: string, label: string, key: string, color: string, unit: string): ChartTab => ({
    id,
    label,
    title: `Gully Chain testnet, ${label.toLowerCase()} per hour, last 24 h`,
    series: [{ name: label, color, values: h.map((x) => x[key]) }],
    labels,
    fmt: (v) => fmtInt(v),
    state: off,
    empty: 'Gully Chain RPC could not be read from the server · retrying',
    head: hp?.chain ? fmtCompact(sum(h.map((x) => x[key]))) : '—',
    sub: hp?.chain ? `${unit}, last 24 h · head #${hp.chain.head.toLocaleString('en-US')}${idle(h.map((x) => x[key])) ? ` · ${idle(h.map((x) => x[key]))}` : ''}` : hp ? 'chain RPC unreadable from the server right now' : 'reading chain 485590',
  })
  return [
    t('txs', 'Transactions', 'txs', ACCENT, 'user transactions'),
    t('blocks', 'Blocks', 'blocks', S[1], 'blocks'),
    t('gas', 'Gas', 'gas', S[2], 'gas used'),
    {
      id: 'activity',
      label: 'Launches & trades',
      title: 'Gully Chain launches, curve trades and swaps per hour (indexer feed)',
      series: [
        { name: 'Launches', color: ACCENT, values: a.map((x) => x.launches) },
        { name: 'Trades', color: S[1], values: a.map((x) => x.trades) },
        { name: 'Swaps', color: S[2], values: a.map((x) => x.swaps) },
      ],
      labels: a.map((x) => hourLabel(x.t)),
      fmt: (v) => fmtInt(v),
      stacked: true,
      state: offA,
      empty: 'indexer feed could not be read · retrying',
      head: hp?.activity ? fmtInt(sum(a.map((x) => x.launches + x.trades + x.swaps))) : '—',
      sub: hp?.activity ? `launches, trades and swaps, last 24 h · from the newest ${hp.activity.events} indexer events` : hp ? 'indexer unreadable from the server right now' : 'reading the indexer',
    },
  ]
}

function HeroStatus() {
  const live = useLive()
  const { hub, stats } = live
  const up = hub ? hub.services.filter((s) => s.state === 'up' || (!s.state && s.up)).length : null
  const total = hub?.services.length ?? null
  const rows: [string, string, 'up' | 'down' | 'coming' | 'reading'][] = [
    ['surfaces up', up == null ? '—' : `${up}/${total}`, hub ? (up === total ? 'up' : 'coming') : 'reading'],
    ['gully chain block', chainHead(live) == null ? '—' : `#${fmtInt(chainHead(live))}`, chainHead(live) == null ? 'reading' : 'up'],
    ['value locked (usd)', stats ? fmtUsd(stats.totals.tvlUsd) : '—', stats ? 'up' : live.statsState === 'error' ? 'down' : 'reading'],
    ['quests live', hub?.quests ? `${hub.quests.active ?? hub.quests.total}` : '—', hub?.quests ? 'up' : hub ? 'down' : 'reading'],
    ['quest pools', hub?.quests ? fmtEth(hub.quests.poolEth) : '—', hub?.quests ? 'up' : 'reading'],
    ['x402 networks', hub?.x402 ? String(hub.x402.networks.length) : '—', hub?.x402 ? 'up' : hub ? 'down' : 'reading'],
    ['rpc networks ok', hub?.gateway ? `${hub.gateway.ok}/${hub.gateway.total}` : '—', hub?.gateway ? 'up' : hub ? 'down' : 'reading'],
  ]
  return (
    <div className="gt-term rise" aria-label="Live status across Gully Labs">
      <div className="gt-term-bar">
        <span className="gt-k">gully status --live</span>
        <span className="gt-k">{hub ? fmtTime(hub.generatedAt) : 'connecting'}</span>
      </div>
      <dl>
        {rows.map(([k, v, s]) => (
          <div key={k}>
            <dt>
              <Dot s={s} label="" />
              {k}
            </dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="gt-term-foot">
        <span className="gt-k">
          $ every figure read live<span className="gt-caret" aria-hidden />
        </span>
      </div>
    </div>
  )
}

export function Home() {
  const live = useLive()
  const hpq = useHubProducts()
  const hp = hpq.data
  const ref = useReveal<HTMLDivElement>()
  const vTabs = useMemo(() => venueTabs(live), [live])
  const cTabs = useMemo(() => chainTabs(hp, hpq.state), [hp, hpq.state])
  const q = live.hub?.quests
  const qHours = q?.hourly ?? []
  const questTab: ChartTab = {
    id: 'q',
    label: 'Completions',
    title: 'Gully Quests completions per hour, last 48 h',
    series: [{ name: 'Completions', color: ACCENT, values: qHours }],
    labels: qHours.map((_, i) => `${qHours.length - i} h ago`),
    fmt: (v) => fmtInt(v),
    state: q ? 'ok' : live.hub ? 'offline' : 'loading',
    empty: 'quests could not be read · retrying',
  }
  const ok = live.hub?.services.filter((s) => s.state === 'up').length
  return (
    <div className="lcp gt" ref={ref}>
      <Seo
        title="You Think It, We Ship It."
        description="Gully Labs is a web3 product studio and development services company. We run Gully Chain, Gully Pay, Gully RPC, HolderMaps, Gully Security, Gully AI and Gully Studio, and we build chains, contracts, apps, payments, infra and games for other teams. Every figure is read live."
      />
      <section className="gt-hero" aria-labelledby="hero-h">
        <div className="gt-wrap">
          <div className="gt-hero-copy rise">
            <img className="gt-hero-logo" src="/brand/logo/gully-labs-logo.png" srcSet="/brand/logo/gully-labs-logo.png 1x, /brand/logo/gully-labs-logo-2x.png 2x" width={176} height={71} alt="Gully Labs" />
            <span className="gt-k">
              <b>web3</b> product studio · development services
            </span>
            <h1 id="hero-h">
              You Think It,
              <br />
              <span className="gt-acc">We Ship It.</span>
            </h1>
            <p className="gt-lede">
              We build and run our own web3 products: an L3 chain, payments, RPC, security, holder data, AI and games. Then we build the same things for your team.
            </p>
            <div className="gt-ctas">
              <a className="gt-btn pri" href="#contact">
                Start a project
                <ArrowRight className="gt-ic" aria-hidden />
              </a>
              <a className="gt-btn sec" href="#products">
                Explore {PRODUCTS.length} products
              </a>
              <A className="gt-btn ter" href={APP_URL}>
                Launch app
                <ArrowUpRight className="gt-ic" aria-hidden />
              </A>
            </div>
            <ul className="gt-facts" aria-label="At a glance">
              <li>
                <b className="num">{PRODUCTS.length}</b> products live or in testnet
              </li>
              <li>
                <b className="num">{SERVICES.length}</b> services for other teams
              </li>
              <li>
                <b className="num">{live.hub ? `${ok}/${live.hub.services.length}` : '—'}</b> surfaces up now
              </li>
            </ul>
          </div>
          <HeroStatus />
        </div>
      </section>

      <section id="products" className="gt-sec" aria-labelledby="products-h">
        <div className="gt-wrap">
          <SecHead n="01" label="Products" title="What we build and run" id="products-h">
            Each product has its own page with live charts. Every one supports Gully Chain.
          </SecHead>
          <LogoWall />
        </div>
      </section>

      <section id="live" className="gt-sec" aria-labelledby="live-h">
        <div className="gt-wrap">
          <SecHead n="02" label="Live network" title="Read live, every minute" id="live-h">
            Venue figures in USD from each project&apos;s own API, Gully Chain from its RPC and indexer, and a check of every Gully surface each minute.
          </SecHead>
          <div className="gt-grid2">
            <div className="rv">
              <TChart label="Venues · USD" tabs={vTabs} />
            </div>
            <div className="rv">
              <TChart label="Gully Chain · chain 485590" tabs={cTabs} />
            </div>
            <div className="rv">
              <Panel label={`Uptime · ${live.hub?.services.length ?? 27} surfaces · last hour`} right={live.hub ? <Dot s={ok === live.hub.services.length ? 'up' : 'coming'} label={`${ok}/${live.hub.services.length} up`} /> : <Dot s="reading" />}>
                <UptimeGrid hub={live.hub} compact />
              </Panel>
            </div>
            <div className="rv gt-stack">
              <div className="gt-kpis k4">
                <Kpi label="Quests live" value={q ? (q.active ?? q.total) : null} sub={q ? `${q.total} created` : 'reading'} />
                <Kpi label="Completions" value={q?.completions} sub={q ? `${q.completions24h ?? 0} in 24 h` : 'reading'} spark={qHours} />
                <Kpi label="ETH in pools" text={q ? fmtEth(q.poolEth) : '—'} sub="test ETH · no USD value" />
                <Kpi label="ETH paid out" text={q ? fmtEth(q.paidEth) : '—'} sub="claimed rewards" />
              </div>
              <TChart label="Gully Quests" tabs={[questTab]} height={120} />
            </div>
          </div>
        </div>
      </section>

      <section id="services" className="gt-sec" aria-labelledby="services-h">
        <div className="gt-wrap">
          <SecHead n="03" label="Services" title="Hire the team that runs it" id="services-h">
            The same people who run these products build yours: scoped, priced in USD and shipped on a timeline.
          </SecHead>
          <ServicesList />
        </div>
      </section>

      <section id="work" className="gt-sec" aria-labelledby="work-h">
        <div className="gt-wrap">
          <SecHead n="04" label="Case studies" title="Our products are the proof" id="work-h">
            Each one is in production or public testnet, with its live figure.
          </SecHead>
          <CaseStudies />
        </div>
      </section>

      <section id="process" className="gt-sec" aria-labelledby="process-h">
        <div className="gt-wrap">
          <SecHead n="05" label="Process" title="Discover. Build. Launch. Grow." id="process-h" />
          <Process />
        </div>
      </section>

      <section id="contact" className="gt-sec gt-contact" aria-labelledby="contact-h">
        <div className="gt-wrap">
          <div className="gt-contact-copy rv">
            <SecHead n="06" label="Contact" title="Tell us what you are building" id="contact-h">
              A short brief is enough. We answer with questions or a first scope.
            </SecHead>
            <ul className="gt-alt">
              <li>
                <span className="gt-k">Telegram</span>
                <A href="https://t.me/GullyLabsBot?start=contact">@GullyLabsBot</A>
              </li>
              <li>
                <span className="gt-k">News</span>
                <A href="https://t.me/GullyLabsNews">@GullyLabsNews</A>
              </li>
              <li>
                <span className="gt-k">X</span>
                <A href="https://x.com/Gully_Labs">@Gully_Labs</A>
              </li>
            </ul>
          </div>
          <div className="rv">
            <ContactForm />
          </div>
        </div>
      </section>
    </div>
  )
}
