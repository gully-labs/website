import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, BookOpen, Bot, Boxes, ChartNoAxesCombined, CircleDollarSign, Gauge, Globe, LayoutDashboard, Map as MapIcon, Megaphone, Network, Orbit, Newspaper, ShieldCheck, Sparkles, Tag, type LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Lockup } from '../components/brand'
import { EChart } from '../components/charts/EChart'
import { axisTooltip, barsPreset, C, tipHtml } from '../components/charts/chartPresets'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { Seo } from '../components/Seo'
import { SocialIcon } from '../components/SocialIcon'
import { MoversEmpty } from '../components/tracker/MoversRow'
import type { SocialLabel } from '../content/site'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPp, stockPath, UP, useMovers } from '../lib/tracker'

/* /links: the link hub for bios and KOL posts (linktree-style). One column of every Gully Labs
   destination, each opening in a new tab. Web links carry the KOL campaign's UTM tags so Gully
   Analytics can attribute the visit; t.me, x.com and GitHub links carry none. The background is the
   brand kit's treatment (radial night gradient, 1 px bone grid, gold glow behind the lockup): the grid
   drifts and the glow pulses, and both rest still under reduced motion (src/index.css). The live element is
   the movers chart (the kit's EChart): the biggest 24h gap moves from the tracker, read every minute. */

const UTM = 'utm_source=kol&utm_medium=links&utm_campaign=launch'
const utm = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM}`

type Item = { label: string; desc: ReactNode; href: string; icon?: LucideIcon; social?: SocialLabel }
type Group = { title: string; items: Item[] }

type PayCfg = { feePct: number; freeUsd: number }

/** Gully Pay's merchant fee as the server states it (GET /api/pay/m/config), or null until read. */
function usePayConfig() {
  const [cfg, setCfg] = useState<PayCfg | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    fetch('/api/pay/m/config', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.feePct === 'number' && typeof j.freeUsd === 'number') setCfg({ feePct: j.feePct, freeUsd: j.freeUsd })
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  return cfg
}

function groups(pay: PayCfg | null): Group[] {
  return [
    {
      title: 'Start here',
      items: [
        { label: 'Gully Labs', desc: 'The site: every project and product', href: utm('https://gullylabs.xyz/'), icon: Globe },
        { label: 'Gully Labs App', desc: 'Keys, alerts, analytics and payments', href: utm('https://app.gullylabs.xyz/'), icon: LayoutDashboard },
        { label: 'Stock tracker', desc: 'Stock tokens against their fair price', href: utm('https://gullylabs.xyz/tracker'), icon: Activity },
        { label: 'Telegram bot + Mini App', desc: 'The tracker, DeepCore launches and gap alerts in Telegram', href: 'https://t.me/GullyLabsBot', icon: Bot },
      ],
    },
    {
      title: 'Products',
      items: [
        { label: 'Holder Map', desc: 'Who really holds a DeepCore launch: clusters, bundled buys, a health score', href: utm('https://gullylabs.xyz/holders'), icon: Orbit },
        { label: 'Gully Security', desc: 'AI Security Scan of a contract or codebase; reviews quoted on request', href: utm('https://gullylabs.xyz/security'), icon: ShieldCheck },
        { label: 'Gully Score', desc: 'A 0 to 100 contract score from public evidence, every weight shown', href: utm('https://gullylabs.xyz/score'), icon: Gauge },
        { label: 'Gully AI', desc: 'Ask anything about Gully Labs, with sources', href: utm('https://gullylabs.xyz/ask'), icon: Sparkles },
        { label: 'Gully Analytics', desc: 'Web analytics that see the wallet', href: utm('https://gullylabs.xyz/analytics'), icon: ChartNoAxesCombined },
        {
          label: 'Gully Pay',
          desc: pay ? `Crypto checkout and pay links: ${pay.feePct}% after the first $${pay.freeUsd.toLocaleString('en-US')}, non-custodial` : 'Crypto checkout and pay links, non-custodial',
          href: utm('https://docs.gullylabs.xyz/gully-pay-merchants'),
          icon: CircleDollarSign,
        },
        { label: 'Chain Kit', desc: 'Branded block explorers · waitlist', href: utm('https://gullylabs.xyz/chain-kit'), icon: Boxes },
        { label: 'Pricing', desc: 'API, alerts and analytics plans', href: utm('https://gullylabs.xyz/pricing'), icon: Tag },
      ],
    },
    {
      title: 'Read',
      items: [
        { label: 'Docs', desc: 'Methodology, API, widget and products', href: utm('https://docs.gullylabs.xyz/'), icon: BookOpen },
        { label: 'Blog', desc: 'Releases and write-ups', href: utm('https://blog.gullylabs.xyz/'), icon: Newspaper },
        { label: 'Roadmap', desc: 'What is live, on request and planned, track by track', href: utm('https://docs.gullylabs.xyz/roadmap'), icon: MapIcon },
        { label: 'L3 roadmap', desc: 'The plan for the Gully L3. In development', href: utm('https://docs.gullylabs.xyz/roadmap-l3'), icon: Network },
      ],
    },
    {
      title: 'Follow',
      items: [
        { label: 'Gully Labs News', desc: 'The Telegram channel: releases first', href: 'https://t.me/GullyLabsNews', icon: Megaphone },
        { label: 'X', desc: '@Gully_Labs', href: 'https://x.com/Gully_Labs', social: 'X' },
        { label: 'GitHub', desc: 'gully-labs: SDK and open source', href: 'https://github.com/gully-labs', social: 'GitHub' },
      ],
    },
  ]
}

const row = 'flex min-h-[60px] items-center gap-3.5 rounded-[12px] border border-line bg-surface/85 px-4 py-3'

function LinkRow({ item, i }: { item: Item; i: number }) {
  const Icon = item.icon
  return (
    <a
      href={item.href}
      {...newTab}
      className={`${row} group animate-[gl-rise_.5s_ease-out_both] text-ink no-underline transition-colors hover:border-kit-lab-gold hover:bg-surface-hover`}
      style={{ animationDelay: `${Math.min(i, 14) * 40}ms` }}
    >
      <span className="grid size-9 flex-none place-items-center rounded-[9px] border border-kit-slate bg-kit-midnight text-kit-lab-gold transition-colors group-hover:text-kit-pale-gold">
        {Icon ? <Icon aria-hidden size={18} /> : item.social ? <SocialIcon name={item.social} size={16} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-semibold leading-[1.25]">{item.label}</span>
        <span className="text-[13px] leading-[1.4] text-muted">{item.desc}</span>
      </span>
      <NewTabMark size={16} className="flex-none text-faint transition-colors group-hover:text-kit-lab-gold" />
    </a>
  )
}

/** The biggest 24h gap moves (GET /api/tracker/movers, every minute) as the kit's bar chart; each bar and
    each ticker below opens that stock's page. Unknown history says so; nothing is drawn as zero. */
function LiveMovers() {
  const st = useMovers('24h', { limit: 6 })
  const navigate = useNavigate()
  const list = useMemo(() => (st.k === 'ok' ? st.data.byGap.slice(0, 6) : []), [st])
  const option = useMemo(() => {
    const rows = [...list].reverse()
    return {
      grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const m = rows[ps[0]?.dataIndex ?? 0]
        return m ? tipHtml({ title: `${m.ticker} · ${CHAIN_SHORT[m.chain] ?? m.chain}`, rows: [{ name: 'Gap 24h ago', value: fmtGap(m.gapThen) }, { name: 'Gap now', value: fmtGap(m.gapNow) }, { name: 'Change', value: fmtPp(m.gapChangePp), valueColor: m.gapChangePp > 0 ? UP : m.gapChangePp < 0 ? DOWN : C.muted }] }) : ''
      }, 'shadow'),
      xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: { type: 'category', data: rows.map((m) => m.ticker), axisLabel: { color: C.muted, fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [
        {
          ...barsPreset({ horizontal: true, stagger: 60 }),
          id: 'moves',
          barMaxWidth: 16,
          data: rows.map((m) => ({ value: m.gapChangePp, itemStyle: { color: m.gapChangePp > 0 ? UP : m.gapChangePp < 0 ? DOWN : C.muted } })),
          label: { show: true, position: 'right', color: C.muted, fontSize: 11, formatter: (x: { dataIndex: number }) => fmtPp(rows[x.dataIndex].gapChangePp) },
        },
      ],
    }
  }, [list])
  if (st.k === 'loading') return <div aria-hidden className="h-[180px] gl-skeleton rounded-[12px] bg-surface" />
  if (st.k === 'error') return <p className="m-0 font-mono text-[12px] text-muted">The live movers could not be read just now; they retry every minute.</p>
  if (!list.length) return <MoversEmpty height={180} note={st.data.note ?? 'Not tracked yet: the tracker needs 24h of snapshots.'} />
  const rows = [...list].reverse()
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface/85 p-3">
      <EChart
        option={option}
        height={Math.max(150, list.length * 30)}
        label={`Biggest 24h gap moves: ${list.map((m) => `${m.ticker} ${fmtPp(m.gapChangePp)}`).join(', ')}`}
        steps={{ count: list.length }}
        onEvents={{ click: (p) => { const m = rows[(p as { dataIndex?: number }).dataIndex ?? -1]; if (m) navigate(stockPath(m)) } }}
      />
      <ul aria-label="Open a mover" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {list.map((m) => (
          <li key={`${m.chain}:${m.ticker}`}>
            <Link to={stockPath(m)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 font-mono text-[12px] text-ink hover:border-gold">
              <Activity aria-hidden size={13} className="text-gold" /> {m.ticker} <span className="text-faint">{CHAIN_SHORT[m.chain] ?? m.chain}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LinksPage() {
  const pay = usePayConfig()
  let n = 0
  return (
    <>
      <Seo title="Links" description="Every Gully Labs link in one place: the site, the app, the stock tracker, the Holder Map, Gully Security, Gully Score, Gully AI, Gully Analytics, Gully Pay, Chain Kit, docs, the roadmap, the Telegram bot and the news channel." />
      <section className="relative isolate overflow-hidden bg-kit-lab-night">
        {/* The kit's background treatment: night gradient, 1 px bone grid (drifting), gold glow (pulsing). */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_40%,#1D2836_0%,#111923_50%,#0B1118_100%)]" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 animate-[gl-grid-drift_24s_linear_infinite] bg-[linear-gradient(rgba(244,242,236,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(244,242,236,.035)_1px,transparent_1px)] bg-[size:64px_64px]"
        />
        <div aria-hidden className="absolute top-[-60px] left-1/2 -z-10 size-[460px] -translate-x-1/2">
          <div className="size-full animate-[gl-glow_6s_ease-in-out_infinite] rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.16)_0%,rgba(217,181,99,0)_65%)]" />
        </div>

        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-8 px-4 pt-14 pb-20 max-[600px]:pt-10">
          <header className="flex animate-[gl-fade_.6s_ease-out_both] flex-col items-center gap-4 text-center">
            <h1 className="m-0">
              <Lockup height={88} label="Gully Labs" />
            </h1>
            <p className="m-0 max-w-[440px] text-[15px] leading-[1.55] text-kit-text-muted">Building the next gen multi-chain dApps and tools. Every link, in one place.</p>
          </header>

          {groups(pay).map((g) => (
            <nav key={g.title} aria-label={g.title} className="flex flex-col gap-2.5">
              <h2 className="m-0 font-mono text-[11px] font-medium tracking-[1.5px] text-faint uppercase">{g.title}</h2>
              {g.items.map((it) => (
                <LinkRow key={it.label} item={it} i={n++} />
              ))}
            </nav>
          ))}

          <div className="flex flex-col gap-2.5">
            <h2 className="m-0 font-mono text-[11px] font-medium tracking-[1.5px] text-faint uppercase">Moving now · live gap change, 24h</h2>
            <LiveMovers />
          </div>

          <p className="m-0 text-center font-mono text-[11px] leading-[1.6] text-faint">Information only, not financial advice.</p>
        </div>
      </section>
    </>
  )
}
