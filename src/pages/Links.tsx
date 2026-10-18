import { useEffect, useState, type ReactNode } from 'react'
import { Activity, BookOpen, Bot, Boxes, ChartNoAxesCombined, CircleDollarSign, Globe, LayoutDashboard, Megaphone, Network, Orbit, Newspaper, Sparkles, Tag, type LucideIcon } from 'lucide-react'
import { Lockup } from '../components/brand'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { Seo } from '../components/Seo'
import { SocialIcon } from '../components/SocialIcon'
import { MoversRow } from '../components/tracker/MoversRow'
import type { SocialLabel } from '../content/site'

/* /links: the link hub for bios and KOL posts (linktree-style). One column of every Gully Labs
   destination, each opening in a new tab. Web links carry the KOL campaign's UTM tags so Gully
   Analytics can attribute the visit; t.me, x.com and GitHub links carry none. The background is the
   brand kit's treatment (radial night gradient, 1 px bone grid, gold glow behind the lockup): the grid
   drifts and the glow pulses, and both rest still under reduced motion (src/index.css). The movers row
   is the page's live element: the biggest 24h gap moves from the tracker. */

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
        { label: 'Gully AI', desc: 'Ask anything about Gully Labs, with sources', href: utm('https://gullylabs.xyz/ask'), icon: Sparkles },
        { label: 'Gully Analytics', desc: 'Web analytics that see the wallet', href: utm('https://gullylabs.xyz/analytics'), icon: ChartNoAxesCombined },
        {
          label: 'Gully Pay',
          desc: pay ? `Crypto checkout and pay links: ${pay.feePct}% after the first $${pay.freeUsd.toLocaleString('en-US')}, non-custodial` : 'Crypto checkout and pay links, non-custodial',
          href: utm('https://docs.gullylabs.xyz/gully-pay-merchants'),
          icon: CircleDollarSign,
        },
        { label: 'Chain Kit', desc: 'Branded block explorers', href: utm('https://gullylabs.xyz/chain-kit'), icon: Boxes },
        { label: 'Pricing', desc: 'API, alerts and analytics plans', href: utm('https://gullylabs.xyz/pricing'), icon: Tag },
      ],
    },
    {
      title: 'Read',
      items: [
        { label: 'Docs', desc: 'Methodology, API, widget and products', href: utm('https://docs.gullylabs.xyz/'), icon: BookOpen },
        { label: 'Blog', desc: 'Releases and write-ups', href: utm('https://blog.gullylabs.xyz/'), icon: Newspaper },
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

export function LinksPage() {
  const pay = usePayConfig()
  let n = 0
  return (
    <>
      <Seo title="Links" description="Every Gully Labs link in one place: the site, the app, the stock tracker, Gully AI, Gully Analytics, Gully Pay, Chain Kit, docs, the Telegram bot and the news channel." />
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
              {g.title === 'Products' && (
                <div className={`${row} text-ink`} aria-label="Holder Map, coming soon">
                  <span className="grid size-9 flex-none place-items-center rounded-[9px] border border-kit-slate bg-kit-midnight text-kit-text-dim">
                    <Orbit aria-hidden size={18} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[16px] font-semibold leading-[1.25] text-ink-2">Holder Map</span>
                    <span className="text-[13px] leading-[1.4] text-muted">Coming soon</span>
                  </span>
                  <span className="flex-none rounded-full border border-gold-line px-2 py-0.5 font-mono text-[10px] tracking-[1px] text-gold">SOON</span>
                </div>
              )}
            </nav>
          ))}

          <div className="flex flex-col gap-2.5">
            <h2 className="m-0 font-mono text-[11px] font-medium tracking-[1.5px] text-faint uppercase">Moving now · live gap change, 24h</h2>
            <MoversRow limit={4} />
          </div>

          <p className="m-0 text-center font-mono text-[11px] leading-[1.6] text-faint">Information only, not financial advice.</p>
        </div>
      </section>
    </>
  )
}
