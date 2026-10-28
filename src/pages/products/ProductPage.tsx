/* One page per Gully product (/products/<slug>), landing v3 (2026-10-26), Gully Terminal style: hero with the kit logo,
   one line and the CTAs (open the product, docs, start a project like it); live KPIs and charts specific to the
   product; features, how it works, pricing (read live from /api/plans where we publish prices), FAQ and links.
   Every figure is read live: GET /api/hub, /api/hub/products, /api/stats, /api/products/status, /api/ipfs/stats and the
   Gully Chain RPC. A source that cannot be read says so; nothing is invented. */
import { useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRight, ArrowUpRight, BookOpen, Check } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { fmtInt, fmtPct, fmtUsd } from '../../console/charts'
import { chainHead, useLive, venueSeries, type Live } from '../../console/live'
import '../../terminal/terminal.css'
import { PRODUCTS, productBySlug, SERVICES, type ProductDef } from '../../terminal/catalog'
import { A, ACCENT, BlockStrip, Dot, Empty, fmtCompact, fmtEth, fmtMs, HBars, hourLabel, Kpi, latencySeries, Logo, minLabel, Panel, S, SecHead, stateOf, sum, TChart, UptimeGrid, useHubProducts, usePlans, useReveal, type ChartTab, type HubProducts, type Plans } from '../../terminal/kit'
import { chainTabs } from '../../terminal/liveTabs'
import type { HubLive } from '../hub/hubData'
import { useHubLive } from '../hub/useHubLive'
import { NotFound } from '../NotFound'

interface KpiDef {
  label: string
  value?: number | null
  fmt?: (v: number) => string
  text?: ReactNode
  sub?: ReactNode
  spark?: (number | null)[]
  color?: string
}
interface LiveDef {
  kpis: KpiDef[]
  main: ReactNode
  side?: ReactNode
  extra?: ReactNode
}

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number')
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function latencyTab(live: Live, keys: string[], label = 'Latency'): ChartTab {
  const { labels, series } = latencySeries(live.hub, keys)
  const last = series.map((s) => s.values[s.values.length - 1]).filter((v): v is number => v != null)
  return {
    id: 'lat',
    label,
    title: 'Response time per check, last hour (ms)',
    series,
    labels,
    fmt: (v) => fmtMs(v),
    state: live.hub ? 'ok' : 'loading',
    empty: 'collecting checks: one a minute',
    head: last.length ? fmtMs(avg(last)) : '—',
    sub: `mean response now · ${series.length} surface${series.length === 1 ? '' : 's'} checked every minute`,
  }
}

function surfaceKpis(live: Live, keys: string[]): KpiDef[] {
  const svc = (live.hub?.services ?? []).filter((s) => keys.includes(s.key))
  const st = stateOf(live.hub, keys)
  const hist = svc[0]?.history ?? []
  const answered = svc.flatMap((s) => s.history).filter((h) => h.ms != null).length
  const checks = svc.flatMap((s) => s.history).length
  return [
    { label: 'State', text: <Dot s={st} />, sub: `${svc.filter((s) => s.state === 'up').length}/${svc.length || keys.length} surfaces answering` },
    { label: 'Response now', value: avg(svc.map((s) => s.ms)), fmt: (v) => fmtMs(v), spark: hist.map((h) => h.ms), sub: 'mean of the latest checks' },
    { label: 'Answered · last hour', value: checks ? (answered / checks) * 100 : null, fmt: fmtPct, sub: `${answered} of ${checks} checks` },
    { label: 'Mean · last hour', value: avg(svc.flatMap((s) => s.history.map((h) => h.ms))), fmt: (v) => fmtMs(v), sub: 'all answered checks' },
  ]
}

const chainState = (hp: HubProducts | null, st: string, part: 'chain' | 'activity' | 'bridge' | 'holders' | 'security') => (st === 'error' || (hp && !hp[part]) ? 'offline' : !hp ? 'loading' : 'ok')

function liveFor(p: ProductDef, live: Live, hp: HubProducts | null, hpState: string, hl: HubLive | null, hlState: string): LiveDef {
  const hub = live.hub
  const lat = <TChart label="Response time · last hour" tabs={[latencyTab(live, p.hub)]} height={150} />
  const ct = chainTabs(hp, hpState)
  const h = hp?.chain?.hourly ?? []
  const a = hp?.activity?.hourly ?? []
  switch (p.slug) {
    case 'gully-id': {
      // Gully ID's own aggregate stats (gullyid.xyz/v1/stats/public via /api/hub/live): counts only, no personal data.
      const id = hl?.id ?? null
      const idSt = id ? 'ok' : hlState === 'loading' ? 'loading' : 'offline'
      const hours = id?.hourly ?? []
      const signTab: ChartTab = {
        id: 'signins',
        label: 'Sign-ins',
        title: 'Gully ID sign-ins per hour, last 25 h (UTC)',
        series: [{ name: 'Sign-ins', color: ACCENT, values: hours.map((h) => h.n) }],
        labels: hours.map((h) => `${new Date(h.hour).toISOString().slice(11, 13)}:00`),
        fmt: (v) => fmtInt(v),
        integer: true,
        state: idSt,
        empty: 'Gully ID stats unreadable right now · retrying',
        head: id?.signins24h != null ? fmtInt(id.signins24h) : '—',
        sub: 'sign-ins in the last 24 h · gullyid.xyz/v1/stats/public',
      }
      const m = id?.methods30d ?? null
      const ML: Record<string, string> = { passkey: 'Passkey', wallet: 'Wallet (SIWE)', email: 'Email code', social: 'Google / X', other: 'Other' }
      return {
        kpis: [
          { label: 'Sign-ins · 24 h', value: id?.signins24h ?? null, spark: hours.map((h) => h.n), sub: 'all apps' },
          { label: 'Accounts', value: id?.totals.users ?? null, sub: 'Gully ID accounts' },
          { label: 'Passkeys', value: id?.totals.passkeys ?? null, sub: 'registered' },
          { label: 'Apps · 30 d', value: id?.appsActive30d ?? null, sub: 'apps signed into' },
        ],
        main: <TChart label="Gully ID · sign-ins" tabs={[signTab]} height={150} />,
        side: (
          <Panel label="Sign-in methods · 30 days">
            {m ? <HBars rows={Object.entries(m).map(([k, v]) => ({ label: ML[k] ?? k, value: v }))} fmt={(v) => fmtInt(v)} /> : <Empty state={idSt === 'loading' ? 'loading' : 'offline'} />}
          </Panel>
        ),
      }
    }
    case 'gully-sentry': {
      // Gully Sentry's own public figures (sentry.gullychain.xyz/api/v1/{network,sale}/stats and /chain/health), read
      // server-side through /api/hub/live: its CORS refuses gullylabs.xyz in the browser.
      const net = hl?.sentryNet ?? null
      const sale = hl?.sentrySale ?? null
      const ch = hl?.sentryChain ?? null
      const why = (x: unknown) => (x ? undefined : hlState === 'loading' ? 'reading sentry.gullychain.xyz' : 'sentry.gullychain.xyz unreadable right now · retrying')
      const netSt = net ? 'ok' : hlState === 'loading' ? 'loading' : 'offline'
      const slots = net?.series ?? []
      const watchTab: ChartTab = {
        id: 'watchers',
        label: 'Watchers',
        title: 'Sentry Keys heard per 10-minute slot, last 24 h (UTC)',
        series: [{ name: 'Keys heard', color: '#00B2FA', values: slots.map((x) => x.keys) }],
        labels: slots.map((x) => `${new Date(x.t * 1000).toISOString().slice(11, 16)} UTC`),
        fmt: (v) => fmtInt(v),
        integer: true,
        state: netSt,
        empty: 'Gully Sentry network stats unreadable right now · retrying',
        head: net ? fmtInt(net.heartbeats24h) : '—',
        sub: 'signed heartbeats in the last 24 h · sentry.gullychain.xyz/api/v1/network/stats',
      }
      const verdict = ch ? <Dot s={ch.verdict === 'ok' ? 'up' : 'down'} label={ch.verdict === 'ok' ? 'assertions match' : ch.verdict} /> : '—'
      const age = (sec: number | null) => (sec == null ? '—' : sec < 3600 ? `${Math.round(sec / 60)} min ago` : `${(sec / 3600).toFixed(1)} h ago`)
      const KEY = '0xa24bF9f0eA1AE5F5226d8F7e714cEa3537aa30Ac'
      return {
        kpis: [
          { label: 'Keys minted', value: sale?.totalMinted ?? null, sub: sale ? `${sale.maxSupply != null ? `of ${fmtInt(sale.maxSupply)} · ` : ''}free on testnet` : why(sale) },
          { label: 'Active watchers', value: net?.activeKeys ?? null, sub: net ? `${fmtInt(net.operators)} operator${net.operators === 1 ? '' : 's'} · heard this epoch` : why(net) },
          { label: 'Heartbeats · 24 h', value: net?.heartbeats24h ?? null, spark: slots.map((x) => x.keys), color: '#46FB04', sub: net ? 'EIP-712, one per key every 10 min' : why(net) },
          { label: 'Chain verdict', text: verdict, sub: ch ? ch.summary || 'from the sentry’s own node' : why(ch) },
        ],
        main: <TChart label="Gully Sentry · watchers per 10 minutes" tabs={[watchTab]} height={150} />,
        side: (
          <Panel label="Gully Chain assertions · Sentry check" right={ch ? verdict : <Dot s={hlState === 'loading' ? 'reading' : 'down'} />}>
            {ch ? (
              <table className="gt-table">
                <tbody>
                  <tr>
                    <td>Verdict</td>
                    <td>{ch.summary || ch.verdict}</td>
                  </tr>
                  <tr>
                    <td>Gully Chain head (sentry node)</td>
                    <td>{ch.l3Head != null ? `#${fmtInt(ch.l3Head)}` : '—'}</td>
                  </tr>
                  <tr>
                    <td>Newest assertion on Arbitrum Sepolia</td>
                    <td>{age(ch.newestAssertionAgeSec)}</td>
                  </tr>
                  <tr>
                    <td>Checked</td>
                    <td>{ch.checkedAt != null ? minLabel(new Date(ch.checkedAt * 1000).toISOString()) : '—'}</td>
                  </tr>
                  <tr>
                    <td>Keys available</td>
                    <td>{sale?.available != null ? fmtInt(sale.available) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <Empty state={hlState === 'loading' ? 'loading' : 'offline'} text="sentry.gullychain.xyz/api/v1/chain/health unreadable right now · retrying" />
            )}
            <p className="gt-note">
              Sentry Key (ERC-721, testnet) <A href={`https://testnet-explorer.gullychain.xyz/address/${KEY}`}><code>{KEY.slice(0, 6)}…{KEY.slice(-4)}</code></A> · testnet keys have no value and do not convert to mainnet keys · not offered to US persons or sanctioned regions (<A href="https://sentry.gullychain.xyz/risk/">risk</A>, <A href="https://sentry.gullychain.xyz/terms/">terms</A>)
            </p>
          </Panel>
        ),
      }
    }
    case 'chain': {
      const recent = hp?.chain?.recent?.length ? hp.chain.recent : (live.chain?.blocks ?? [])
      return {
        kpis: [
          { label: 'Latest block', value: chainHead(live), fmt: (v) => `#${fmtInt(v)}`, sub: 'chain 485590 · testnet', spark: recent.map((b) => b.txs) },
          { label: 'Transactions · 24 h', value: hp?.chain ? sum(h.map((x) => x.txs)) : null, spark: h.map((x) => x.txs), sub: 'user transactions, by hour' },
          { label: 'Gas used · 24 h', value: hp?.chain ? sum(h.map((x) => x.gas)) : null, fmt: fmtCompact, spark: h.map((x) => x.gas), color: S[2], sub: 'gas units' },
          { label: 'Launches · 24 h', value: hp?.activity ? sum(a.map((x) => x.launches)) : null, spark: a.map((x) => x.launches), color: S[1], sub: 'DeepCore, from the indexer' },
        ],
        main: <TChart label="Gully Chain · by hour" tabs={ct} />,
        side: (
          <Panel label="Newest blocks · txs per block" right={<Dot s={recent.length ? 'up' : chainState(hp, hpState, 'chain') === 'offline' ? 'down' : 'reading'} label={recent.length ? `#${fmtInt(recent[recent.length - 1].number)}` : undefined} />}>
            {recent.length ? (
              <>
                <BlockStrip blocks={recent} h={72} />
                <table className="gt-table">
                  <thead>
                    <tr>
                      <th>Block</th>
                      <th>Txs</th>
                      <th>Gas</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent
                      .slice(-6)
                      .reverse()
                      .map((b) => (
                        <tr key={b.number}>
                          <td>#{fmtInt(b.number)}</td>
                          <td>{b.txs}</td>
                          <td>{fmtCompact(b.gas)}</td>
                          <td>{minLabel(new Date(b.time * 1000).toISOString())}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : (
              <Empty state={chainState(hp, hpState, 'chain') === 'offline' ? 'offline' : 'loading'} text="chain RPC could not be read · retrying" />
            )}
          </Panel>
        ),
      }
    }
    case 'street':
      return {
        kpis: [
          { label: 'Launches · 24 h', value: hp?.activity ? sum(a.map((x) => x.launches)) : null, spark: a.map((x) => x.launches), sub: 'from the indexer feed' },
          { label: 'Curve trades · 24 h', value: hp?.activity ? sum(a.map((x) => x.trades)) : null, spark: a.map((x) => x.trades), color: S[1], sub: 'bonding-curve buys and sells' },
          { label: 'Swaps · 24 h', value: hp?.activity ? sum(a.map((x) => x.swaps)) : null, spark: a.map((x) => x.swaps), color: S[2], sub: 'Gully Swap router' },
          { label: 'App state', text: <Dot s={stateOf(hub, ['street'])} />, sub: 'app.gullychain.xyz, checked each minute' },
        ],
        main: <TChart label="Gully Street · activity by hour" tabs={[ct[3], ct[0]]} />,
        side: lat,
      }
    case 'bridge': {
      const b = hp?.bridge
      const st = chainState(hp, hpState, 'bridge')
      const fast = b?.fast ?? []
      const can = b?.canonical ?? []
      const axis = (fast.length ? fast : can).map((x) => hourLabel(x.t))
      const ratio = b?.gethSupply != null && b.gethBacking != null && b.gethSupply > 0 ? (b.gethBacking / b.gethSupply) * 100 : null
      const tabs: ChartTab[] = [
        { id: 'both', label: 'Fast vs Canonical', title: 'Bridge transfers per hour, both directions', series: [{ name: 'Fast (gETH)', color: ACCENT, values: fast.map((x) => x.in + x.out) }, { name: 'Canonical', color: S[2], values: can.map((x) => x.in + x.out) }], labels: axis, fmt: (v) => fmtInt(v), stacked: true, state: st, head: b ? fmtInt(sum(fast.map((x) => x.in + x.out)) + sum(can.map((x) => x.in + x.out))) : '—', sub: 'transfers in the last 24 h, both lanes' },
        { id: 'fast', label: 'Fast lane', title: 'Hyperlane gETH: bridged in (mint) and out (burn) per hour', series: [{ name: 'In', color: ACCENT, values: fast.map((x) => x.in) }, { name: 'Out', color: S[1], values: fast.map((x) => x.out) }], labels: axis, fmt: (v) => fmtInt(v), state: b?.fast ? st : 'offline', head: b?.fastAllIn != null ? `${fmtInt(b.fastAllIn)} in · ${fmtInt(b.fastAllOut)} out` : '—', sub: 'all-time gETH mints and burns' },
        { id: 'can', label: 'Canonical', title: 'Arbitrum canonical bridge: deposits and withdrawals per hour', series: [{ name: 'Deposits', color: S[2], values: can.map((x) => x.in) }, { name: 'Withdrawals', color: S[3], values: can.map((x) => x.out) }], labels: axis, fmt: (v) => fmtInt(v), state: b?.canonical ? st : 'offline', head: b?.canonical ? fmtInt(sum(can.map((x) => x.in + x.out))) : '—', sub: 'deposits and withdrawals, last 24 h' },
      ]
      return {
        kpis: [
          { label: 'gETH supply', text: fmtEth(b?.gethSupply), sub: 'minted on Gully Chain · test ETH' },
          { label: 'ETH backing', text: fmtEth(b?.gethBacking), sub: 'held by the route on Arbitrum Sepolia' },
          { label: 'Backing ratio', value: ratio, fmt: fmtPct, sub: ratio == null ? 'needs both readings' : ratio >= 100 ? 'fully backed' : 'below 100%: being checked' },
          { label: 'Transfers · 24 h', value: b ? sum(fast.map((x) => x.in + x.out)) + sum(can.map((x) => x.in + x.out)) : null, spark: fast.map((x, i) => x.in + x.out + (can[i]?.in ?? 0) + (can[i]?.out ?? 0)), sub: 'fast + canonical' },
        ],
        main: <TChart label="Gully Bridge · transfers per hour" tabs={tabs} />,
        side: (
          <Panel label="gETH backing · test ETH, no USD value">
            {b && (b.gethSupply != null || b.gethBacking != null) ? (
              <HBars rows={[{ label: 'ETH locked (Arbitrum Sepolia)', value: b.gethBacking ?? 0 }, { label: 'gETH minted (Gully Chain)', value: b.gethSupply ?? 0 }]} fmt={(v) => fmtEth(v)} />
            ) : (
              <Empty state={st === 'loading' ? 'loading' : 'offline'} text="backing could not be read · retrying" />
            )}
            <p className="gt-note">
              gETH <code>{(b?.token ?? '0x7Dd1…b702').slice(0, 10)}…</code> · router <code>{(b?.router ?? '0x3Aa7…bad0').slice(0, 10)}…</code>
            </p>
          </Panel>
        ),
        extra: lat,
      }
    }
    case 'pay': {
      const x = hub?.x402
      const pay = live.products?.pay
      return {
        kpis: [
          { label: 'Services operational', value: pay?.up ?? null, fmt: pay ? (v) => `${v}/${pay.total}` : undefined, spark: (pay?.history ?? []).map((h) => h.v), sub: pay ? 'gullypay.xyz/api/status' : 'reading status' },
          { label: 'x402 networks', value: x ? x.networks.length : null, sub: x ? `${x.networks.filter((n) => !n.testnet).length} mainnet · ${x.networks.filter((n) => n.testnet).length} testnet` : 'reading the facilitator' },
          { label: 'Gully Chain', text: x ? <Dot s={x.gullyChain ? 'up' : 'coming'} label={x.gullyChain ? 'supported' : 'not yet'} /> : '—', sub: 'settlement on chain 485590' },
          { label: 'Payments processed', text: <span className="gt-zero">no payments yet</span>, sub: 'sign-up is open · no volume to show' },
        ],
        main: <TChart label="Gully Pay · response time" tabs={[latencyTab(live, ['pay', 'x402', 'pay-admin'])]} />,
        side: (
          <Panel label="x402 facilitator · networks and assets" right={x ? <Dot s="up" label={`${x.networks.length} networks`} /> : <Dot s={hub ? 'down' : 'reading'} />}>
            {x ? (
              <>
                <table className="gt-table">
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>Chain id</th>
                      <th>Kind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.networks.map((n) => (
                      <tr key={n.id}>
                        <td>{n.name}</td>
                        <td>{n.chainId ?? '—'}</td>
                        <td>{n.testnet ? 'testnet' : 'mainnet'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="gt-note">Assets: {x.assets.join(', ') || '—'} · schemes: {x.schemes.join(', ') || '—'}</p>
              </>
            ) : (
              <Empty state={hub ? 'offline' : 'loading'} text="facilitator could not be read · retrying" />
            )}
          </Panel>
        ),
      }
    }
    case 'rpc': {
      const g = hub?.gateway
      const r = live.products?.rpc
      return {
        kpis: [
          { label: 'Gateway networks OK', value: g?.ok ?? null, fmt: g ? (v) => `${v}/${g.total}` : undefined, sub: 'rpc.gullyrpc.xyz, read now' },
          { label: 'Networks served', value: r?.served ?? null, fmt: r ? (v) => `${v}/${r.total}` : undefined, spark: (r?.history ?? []).map((h) => h.v), sub: 'live or beta · gullyrpc.xyz' },
          { label: 'Gully Chain', text: g ? <Dot s={g.gullyChain ? 'up' : 'coming'} label={g.gullyChain ? 'served' : 'not yet'} /> : '—', sub: '/evm/485590, alias gully-testnet' },
          { label: 'Gateway response', value: hub?.services.find((s) => s.key === 'rpc-gateway')?.ms ?? null, fmt: (v) => fmtMs(v), spark: (hub?.services.find((s) => s.key === 'rpc-gateway')?.history ?? []).map((h) => h.ms), sub: 'checked every minute' },
        ],
        main: <TChart label="Gully RPC · response time" tabs={[latencyTab(live, ['rpc-gateway', 'rpc-site', 'rpc-app'])]} />,
        side: (
          <Panel label="Gateway networks · live state">
            {g ? (
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>Alias</th>
                    <th>Chain id</th>
                    <th>State</th>
                    <th>Block time</th>
                  </tr>
                </thead>
                <tbody>
                  {[...g.networks]
                    .sort((x, y) => (x.chainId === 485590 ? -1 : y.chainId === 485590 ? 1 : 0))
                    .map((n) => (
                      <tr key={`${n.alias}${n.chainId}`}>
                        <td>{n.alias}</td>
                        <td>{n.chainId ?? '—'}</td>
                        <td>
                          <Dot s={n.state === 'OK' ? 'up' : n.state ? 'down' : 'reading'} label={n.state.toLowerCase() || '—'} />
                        </td>
                        <td>{n.blockTimeMs != null ? `${(n.blockTimeMs / 1000).toFixed(1)} s` : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <Empty state={hub ? 'offline' : 'loading'} text="gateway could not be read · retrying" />
            )}
          </Panel>
        ),
      }
    }
    case 'holders': {
      const hd = hp?.holders
      const st = chainState(hp, hpState, 'holders')
      return {
        kpis: [
          { label: 'Maps opened today', value: hd?.today ?? null, spark: (hd?.daily ?? []).map((d) => d.maps), sub: 'UTC day, this server' },
          { label: 'Tokens mapped today', value: hd?.tokens ?? null, sub: 'distinct tokens' },
          { label: 'Chains today', value: hd ? hd.byChain.length : null, sub: 'of six supported' },
          { label: 'Site state', text: <Dot s={stateOf(hub, ['holders'])} />, sub: 'holdermaps.xyz' },
        ],
        main: (
          <TChart
            label="HolderMaps · maps per day"
            tabs={[{ id: 'd', label: 'Maps', title: 'Holder maps opened per day', series: [{ name: 'Maps', color: ACCENT, values: (hd?.daily ?? []).map((d) => d.maps) }], labels: (hd?.daily ?? []).map((d) => d.day.slice(5)), fmt: (v) => fmtInt(v), state: st, empty: (hd?.daily.length ?? 0) < 2 ? 'the daily series starts today: a point is added each day' : undefined, head: hd ? fmtInt(hd.today) : '—', sub: 'maps opened today' }]}
          />
        ),
        side: (
          <Panel label="Most scanned today">
            {hd ? <HBars rows={hd.top.map((t) => ({ label: `${t.symbol ? `$${t.symbol}` : `${t.token.slice(0, 8)}…`} · ${t.chain}`, value: t.scans, href: `https://holdermaps.xyz/${t.chain}/${t.token}` }))} empty="no maps opened yet today" /> : <Empty state={st === 'loading' ? 'loading' : 'offline'} />}
          </Panel>
        ),
        extra: (
          <Panel label="Maps by chain today">
            {hd ? <HBars rows={hd.byChain.map((c) => ({ label: c.chain === 'gully' ? 'Gully Chain' : c.chain, value: c.maps }))} empty="no maps opened yet today" /> : <Empty state={st === 'loading' ? 'loading' : 'offline'} />}
          </Panel>
        ),
      }
    }
    case 'security': {
      const sc = hp?.security
      const st = chainState(hp, hpState, 'security')
      return {
        kpis: [
          { label: 'Scans · 14 days', value: sc ? sum(sc.daily.map((d) => d.scans)) : null, spark: (sc?.daily ?? []).map((d) => d.scans), sub: 'requested on Gully Security' },
          { label: 'Scans · all time', value: sc?.total ?? null, sub: 'jobs recorded' },
          { label: 'Reports published', value: sc?.published ?? null, sub: 'by their owners' },
          { label: 'Scan engine', text: <Dot s={stateOf(hub, ['security'])} />, sub: 'gullysecurity.xyz' },
        ],
        main: (
          <TChart
            label="Gully Security · scans run"
            tabs={[{ id: 's', label: 'Scans', title: 'Security scans requested per day, 14 days', series: [{ name: 'Scans', color: ACCENT, values: (sc?.daily ?? []).map((d) => d.scans) }], labels: (sc?.daily ?? []).map((d) => d.day.slice(5)), fmt: (v) => fmtInt(v), state: st, head: sc ? fmtInt(sum(sc.daily.map((d) => d.scans))) : '—', sub: sc && sum(sc.daily.map((d) => d.scans)) === 0 ? 'no scans in the last 14 days' : 'scans in the last 14 days' }, latencyTab(live, ['security'])]}
          />
        ),
        side: (
          <Panel label="Scan states · all time">
            {sc ? <HBars rows={Object.entries(sc.states).map(([k, v]) => ({ label: k, value: v }))} fmt={(v) => fmtInt(v)} /> : <Empty state={st === 'loading' ? 'loading' : 'offline'} />}
          </Panel>
        ),
      }
    }
    case 'studio': {
      const ar = live.arcade
      return {
        kpis: [
          { label: 'Frog Hop season', value: ar?.season ?? null, fmt: (v) => `#${v}`, sub: 'GullyArcade on Gully Chain' },
          { label: 'Players this season', value: ar?.players ?? null, spark: ar?.history ?? [], sub: 'read on chain' },
          ...surfaceKpis(live, p.hub).slice(0, 2),
        ],
        main: lat,
        side: (
          <Panel label="Studio portals">
            <UptimeGrid hub={hub} keys={p.hub} compact />
          </Panel>
        ),
      }
    }
    case 'ipfs': {
      const ip = live.ipfs
      const hh = ip?.history ?? []
      return {
        kpis: [
          { label: 'CIDs pinned', value: ip?.pinned ?? null, spark: hh.map((x) => x.pinned), sub: 'recursive pins' },
          { label: 'Repo size', text: ip?.repoBytes != null ? `${(ip.repoBytes / 1e9).toFixed(2)} GB` : '—', sub: 'never garbage-collected' },
          { label: 'Gateway', value: ip?.gatewayMs ?? null, fmt: (v) => fmtMs(v), spark: hh.map((x) => x.ms), sub: ip?.gatewayUp ? 'answering' : ip ? 'not reachable' : 'reading' },
          { label: 'State', text: <Dot s={stateOf(hub, ['ipfs'])} />, sub: 'ipfs.gullylabs.xyz' },
        ],
        main: (
          <TChart
            label="Gully IPFS node"
            tabs={[
              { id: 'pins', label: 'Pinned', title: 'CIDs pinned', series: [{ name: 'Pinned', color: ACCENT, values: hh.map((x) => x.pinned) }], labels: hh.map((x) => minLabel(x.t)), fmt: (v) => fmtInt(v), state: ip ? 'ok' : 'loading', head: fmtInt(ip?.pinned), sub: 'pins on the node' },
              { id: 'gw', label: 'Gateway', title: 'Gateway response time', series: [{ name: 'Gateway', color: S[1], values: hh.map((x) => x.ms) }], labels: hh.map((x) => minLabel(x.t)), fmt: (v) => fmtMs(v), state: ip ? 'ok' : 'loading', head: fmtMs(ip?.gatewayMs), sub: 'latest check' },
            ]}
          />
        ),
        side: lat,
      }
    }
    case 'quests': {
      const q = hub?.quests
      const hours = q?.hourly ?? []
      return {
        kpis: [
          { label: 'Live quests', value: q ? (q.active ?? q.total) : null, sub: q ? `${q.total} created on chain` : 'reading' },
          { label: 'Completions', value: q?.completions ?? null, spark: hours, sub: q ? `${q.completions24h ?? 0} in the last 24 h` : 'reading' },
          { label: 'ETH in pools', text: fmtEth(q?.poolEth), sub: 'test ETH · no USD value' },
          { label: 'ETH paid out', text: fmtEth(q?.paidEth), sub: 'claimed rewards' },
        ],
        main: <TChart label="Gully Quests · completions" tabs={[{ id: 'c', label: 'Per hour', title: 'Quest completions per hour, last 48 h', series: [{ name: 'Completions', color: ACCENT, values: hours }], labels: hours.map((_, i) => `${hours.length - i} h ago`), fmt: (v) => fmtInt(v), state: q ? 'ok' : hub ? 'offline' : 'loading', head: fmtInt(q?.completions24h), sub: 'completions, last 24 h' }]} />,
        side: (
          <Panel label="Recent completions">
            {q?.recent.length ? (
              <table className="gt-table">
                <tbody>
                  {q.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{r.title ?? `Quest #${r.questId}`}</td>
                      <td>{r.who}</td>
                      <td>{fmtEth(r.rewardEth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty state={q ? 'empty' : hub ? 'offline' : 'loading'} text={q ? 'no completions yet' : undefined} />
            )}
          </Panel>
        ),
        extra: (
          <Panel label={`Quests on chain · registry ${q?.registry ? `${q.registry.slice(0, 6)}…${q.registry.slice(-4)}` : ''}`}>
            {q?.quests.length ? (
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>Quest</th>
                    <th>Verifier</th>
                    <th>Done</th>
                    <th>Reward</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {q.quests.map((x) => (
                    <tr key={x.id}>
                      <td>{x.title}</td>
                      <td>{x.kind ?? '—'}</td>
                      <td>
                        {x.completions}/{x.max || '∞'}
                      </td>
                      <td>{fmtEth(x.rewardEth)}</td>
                      <td>
                        <Dot s={x.state === 'active' ? 'up' : x.state === 'upcoming' ? 'coming' : 'reading'} label={x.state || '—'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty state={q ? 'empty' : hub ? 'offline' : 'loading'} text={q ? 'no quests listed' : undefined} />
            )}
          </Panel>
        ),
      }
    }
    case 'deepcore': {
      const s = live.stats
      const dc = s?.venues.find((v) => v.key === 'deepcore')
      const ok = dc && dc.state === 'ok' ? dc : null
      const st = s ? (ok ? 'ok' : 'offline') : live.statsState === 'error' ? 'offline' : 'loading'
      const one = (m: 'tvl' | 'volume' | 'fees') => {
        const vs = s ? venueSeries(s, m, 30) : null
        return { values: vs?.series.find((x) => x.key === 'deepcore')?.values ?? [], labels: vs?.labels ?? [] }
      }
      const tab = (m: 'tvl' | 'volume' | 'fees', label: string, head: number | null | undefined): ChartTab => {
        const o = one(m)
        return { id: m, label, title: `DeepCore ${label.toLowerCase()}, 30 days (USD)`, series: [{ name: 'DeepCore', color: ACCENT, values: o.values }], labels: o.labels, fmt: (v) => fmtUsd(v), state: st, empty: 'DeepCore API could not be read · retrying', head: fmtUsd(head), sub: 'USD · deepcore.fun/v1/overview, all chains' }
      }
      const o = ok as unknown as { tvlUsd?: number | null; volume24hUsd?: number | null; volumeAllUsd?: number | null; feesAllUsd?: number | null; counts?: Record<string, number | null> } | null
      return {
        kpis: [
          { label: 'Value locked (USD)', value: o?.tvlUsd ?? null, fmt: (v) => fmtUsd(v), spark: one('tvl').values, sub: 'all chains' },
          { label: 'Volume · all time (USD)', value: o?.volumeAllUsd ?? null, fmt: (v) => fmtUsd(v), spark: one('volume').values, color: S[1], sub: 'all chains' },
          { label: 'Fees · all time (USD)', value: o?.feesAllUsd ?? null, fmt: (v) => fmtUsd(v), spark: one('fees').values, color: S[2], sub: 'all chains' },
          { label: 'Launches · 24 h', value: hp?.activity ? sum(a.map((x) => x.launches)) : null, spark: a.map((x) => x.launches), sub: 'on Gully Chain, indexer' },
        ],
        main: <TChart label="DeepCore · 30 days" tabs={[tab('tvl', 'Value locked', o?.tvlUsd), tab('volume', 'Volume', o?.volumeAllUsd), tab('fees', 'Fees', o?.feesAllUsd)]} />,
        side: <TChart label="On Gully Chain · launches & trades" tabs={[ct[3]]} height={150} />,
      }
    }
    default:
      // Gully Safe and Gully AI: their surfaces' uptime and response time, from /api/hub.
      return { kpis: surfaceKpis(live, p.hub), main: lat, side: <Panel label="Surfaces · last hour">{<UptimeGrid hub={hub} keys={p.hub} compact />}</Panel> }
  }
}

function Pricing({ p, plans }: { p: ProductDef; plans: Plans | null }) {
  const days = plans?.periodDays ?? 30
  if (p.pricing === 'security') {
    const sc = plans?.security?.scan
    return (
      <table className="gt-table gt-price">
        <tbody>
          <tr>
            <td>{sc?.name ?? 'AI Security Scan'}</td>
            <td className="num">{sc ? `${fmtUsd(sc.priceUsd)} per scan` : '—'}</td>
            <td>{sc?.freePerMonth ? `${sc.freePerMonth.free ?? 0} free a month on the Free plan` : 'reading /api/plans'}</td>
          </tr>
          <tr>
            <td>{plans?.security?.review?.name ?? 'Security Review'}</td>
            <td>quoted per project</td>
            <td>people read the code</td>
          </tr>
        </tbody>
      </table>
    )
  }
  if (p.pricing === 'holders') {
    return (
      <table className="gt-table gt-price">
        <tbody>
          {(plans?.plans ?? []).map((x) => (
            <tr key={x.id}>
              <td>{x.name}</td>
              <td className="num">{x.priceUsdc === 0 ? 'Free' : `${fmtUsd(x.priceUsdc)} / ${days} days`}</td>
              <td>{x.historyDays ? `${x.historyDays} days of history` : ''}</td>
            </tr>
          ))}
          {!plans?.plans && (
            <tr>
              <td colSpan={3}>reading /api/plans…</td>
            </tr>
          )}
        </tbody>
      </table>
    )
  }
  const text = p.pricing === 'free-testnet' ? 'Free on testnet. Mainnet pricing is published when mainnet opens.' : p.pricing === 'quoted' ? 'Quoted per project. Tell us what you need below.' : `Plans and fees are published on ${p.urlLabel}, in USD.`
  return <p className="gt-p">{text}</p>
}

const SERVICE_FOR: Partial<Record<string, string>> = { 'gully-sentry': 'security', chain: 'chain', street: 'apps', bridge: 'chain', safe: 'contracts', pay: 'payments', rpc: 'infra', holders: 'apps', security: 'security', ai: 'ai', studio: 'games', ipfs: 'infra', quests: 'launch', deepcore: 'launch' }

export function ProductView({ p }: { p: ProductDef }) {
  const live = useLive()
  const hpq = useHubProducts()
  const plans = usePlans().data
  const ref = useReveal<HTMLDivElement>()
  const hlq = useHubLive()
  const d = useMemo(() => liveFor(p, live, hpq.data, hpq.state, hlq.data, hlq.state), [p, live, hpq.data, hpq.state, hlq.data, hlq.state])
  const st = stateOf(live.hub, p.hub)
  const svc = SERVICES.find((s) => s.key === SERVICE_FOR[p.slug])
  const idx = PRODUCTS.findIndex((x) => x.slug === p.slug)
  return (
    <div className="lcp gt" ref={ref}>
      <Seo title={p.name} description={`${p.line} Live charts on this page.`} />
      <section className="gt-hero gt-phero" aria-labelledby="p-h">
        <div className="gt-wrap">
          <div className="gt-hero-copy rise">
            <nav className="gt-crumb gt-k" aria-label="Breadcrumb">
              <Link to="/">gully labs</Link> / <Link to="/products">products</Link> / <span aria-current="page">{p.slug}</span>
            </nav>
            <Logo def={p.logo} name={p.name} scale={1.35} />
            <h1 id="p-h" className="gt-sr-h">
              {p.name}
            </h1>
            <p className="gt-lede">{p.line}</p>
            <div className="gt-ctas">
              <A className="gt-btn pri" href={p.url}>
                {p.cta ?? `Open ${p.urlLabel}`}
                <ArrowUpRight className="gt-ic" aria-hidden />
              </A>
              {p.cta2 && (
                <A className="gt-btn sec" href={p.cta2[1]}>
                  {p.cta2[0]}
                  <ArrowUpRight className="gt-ic" aria-hidden />
                </A>
              )}
              {p.docs && (
                <A className="gt-btn sec" href={p.docs}>
                  <BookOpen className="gt-ic" aria-hidden />
                  Docs
                </A>
              )}
              <Link className="gt-btn ter" to={`/services${svc ? `?service=${svc.key}` : ''}#contact`}>
                Build one like it
                <ArrowRight className="gt-ic" aria-hidden />
              </Link>
            </div>
            <ul className="gt-facts">
              <li>
                <Dot s={st} /> {p.urlLabel}
              </li>
              <li>{p.group === 'chain' ? 'Runs on Gully Chain' : 'Supports Gully Chain'}</li>
            </ul>
          </div>
          <div className="gt-kpis k2 rise">
            {d.kpis.map((k) => (
              <Kpi key={k.label} {...k} />
            ))}
          </div>
        </div>
      </section>

      <section className="gt-sec" aria-labelledby="live-h">
        <div className="gt-wrap">
          <SecHead n="01" label="Live" title={`${p.name}, read live`} id="live-h" />
          <div className="gt-grid2">
            <div className="rv">{d.main}</div>
            <div className="rv">{d.side ?? <Panel label="Surfaces">{<UptimeGrid hub={live.hub} keys={p.hub} compact />}</Panel>}</div>
            {d.extra && <div className="rv gt-span2">{d.extra}</div>}
            <div className="rv gt-span2">
              <Panel label={`Uptime · ${p.name} surfaces · last hour`} right={<Dot s={st} />}>
                <UptimeGrid hub={live.hub} keys={p.hub} />
              </Panel>
            </div>
          </div>
        </div>
      </section>

      <section className="gt-sec" aria-labelledby="feat-h">
        <div className="gt-wrap">
          <SecHead n="02" label="Features" title="What it does" id="feat-h" />
          <ul className="gt-feats">
            {p.features.map((f, i) => (
              <li key={f.t} className="rv" style={{ transitionDelay: `${(i % 3) * 50}ms` }}>
                <span className="gt-n num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="gt-sec" aria-labelledby="how-h">
        <div className="gt-wrap gt-cols">
          <div>
            <SecHead n="03" label="How it works" title="Three steps" id="how-h" />
            <ol className="gt-steps">
              {p.how.map(([t, x], i) => (
                <li key={t} className="rv">
                  <span className="gt-n num">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{t}</h3>
                    <p>{x}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <SecHead n="04" label="Pricing" title="Prices in USD" />
            <div className="rv">
              <Pricing p={p} plans={plans} />
            </div>
          </div>
        </div>
      </section>

      <section className="gt-sec" aria-labelledby="faq-h">
        <div className="gt-wrap gt-cols">
          <div>
            <SecHead n="05" label="FAQ" title="Questions" id="faq-h" />
            <div className="gt-faq">
              {p.faq.map(([q, a]) => (
                <details key={q} className="rv">
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
              <details className="rv">
                <summary>Does {p.name} support Gully Chain?</summary>
                <p>Yes. Every Gully product supports Gully Chain (chain 485590 on testnet today).</p>
              </details>
            </div>
          </div>
          <div>
            <SecHead n="06" label="Links" title="Go further" />
            <ul className="gt-links rv">
              <li>
                <A href={p.url}>
                  {p.urlLabel}
                  <ArrowUpRight className="gt-ic" aria-hidden />
                </A>
              </li>
              {p.docs && (
                <li>
                  <A href={p.docs}>
                    Docs
                    <ArrowUpRight className="gt-ic" aria-hidden />
                  </A>
                </li>
              )}
              <li>
                <Link to="/status">Status of every Gully service</Link>
              </li>
              {svc && (
                <li>
                  <Link to={`/services?service=${svc.key}#contact`}>
                    <Check className="gt-ic" aria-hidden />
                    Service: {svc.title}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      </section>

      <nav className="gt-sec gt-pnav" aria-label="Other products">
        <div className="gt-wrap">
          <Link to={`/products/${PRODUCTS[(idx + PRODUCTS.length - 1) % PRODUCTS.length].slug}`} className="gt-btn ter sm">
            ← {PRODUCTS[(idx + PRODUCTS.length - 1) % PRODUCTS.length].name}
          </Link>
          <Link to="/products" className="gt-btn ter sm">
            All products
          </Link>
          <Link to={`/products/${PRODUCTS[(idx + 1) % PRODUCTS.length].slug}`} className="gt-btn ter sm">
            {PRODUCTS[(idx + 1) % PRODUCTS.length].name} →
          </Link>
        </div>
      </nav>
    </div>
  )
}

export function ProductPage() {
  const { key } = useParams()
  const p = productBySlug(key)
  if (!p) return <NotFound />
  return <ProductView key={p.slug} p={p} />
}
