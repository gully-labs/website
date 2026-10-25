import { ArrowUpRight, Bot, CircleDollarSign, FileCheck2, FileCode2, FileText, Gauge, ListChecks, Radar, Rocket, ScanSearch, ShieldAlert, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { ScansChart } from './ScansChart'
import { EngineStatus } from '../../components/security/EngineStatus'
import { ReviewRequestForm } from '../../components/security/ReviewRequestForm'
import type { SecurityOffer } from '../../components/security/types'
import { Seo } from '../../components/Seo'
import { btnGold, btnOutline, eyebrow } from '../../components/ui'
import { usePlans } from '../../lib/plans'
import type { Plan } from '../developers/api'
import { isLocalHost, APP_URL, securityHref } from '../../site-host'
import { SCAN_APP_URL } from './shared'

/* /security: the Gully Security product page. Two tiers today and one planned, named honestly: the
   automated AI Security Scan (live, self-serve in the app; an AI review only until the static-tools worker
   runs), the human Security Review (quoted on request) and the full Audit (not offered yet). Nothing here claims that Gully Labs has audited anything or names any customer.
   Live: the counter and the 30-day chart read GET /api/security/stats (real counts of scans run; the
   counter shows only once there is one); prices and quotas read GET /api/plans (server/plans.mjs SECURITY). */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

type TierId = 'scan' | 'review' | 'audit'
const TIERS: { id: TierId; title: string; icon: LucideIcon; who: string; body: string; gets: string[]; limits: string[] }[] = [
  {
    id: 'scan',
    title: 'AI Security Scan',
    icon: Bot,
    who: 'Automated, self-serve',
    body: 'Live today as an AI review only: our static-analysis tools are not running yet, so no Slither, Aderyn or fuzzing runs, and every report’s label says so. Point it at a verified contract on a chain, a GitHub repository at a commit, an upload, or a web2 codebase; the AI reads the code for known vulnerability classes and ranks what it finds.',
    gets: ['Findings by severity with file and line', 'A draft proof of concept where one can be written, marked executed or not', 'Every tool that ran, and every tool that did not with the reason', 'A report you can export to PDF and, if you choose, publish'],
    limits: ['An AI review only for now: static analysers and fuzzing are not run, and the report lists them as not run', 'It can miss issues: business logic, economic and cross-contract attacks, off-chain and key-management risks', 'It can report false positives', 'It is not an audit and is no guarantee of safety'],
  },
  {
    id: 'review',
    title: 'Security Review',
    icon: Users,
    who: 'People, quoted on request',
    body: 'Engineers on our team read your code with the scan’s output as a starting point, check the findings by hand, look at the logic the tools cannot follow, and write up what they find.',
    gets: ['A scope agreed with you before work starts', 'Findings checked by a person, with fixes discussed', 'A written report'],
    limits: ['Quoted after we see the code; no list price', 'A time-boxed review, not a guarantee'],
  },
  {
    id: 'audit',
    title: 'Audit',
    icon: ShieldCheck,
    who: 'Planned, not offered yet',
    body: 'A full audit is planned as a later tier. We do not sell it today and it cannot be requested yet. If you need people on your code now, ask for a Security Review.',
    gets: ['Not available yet'],
    limits: ['Gully Labs has not audited any project, and nothing on this site says otherwise'],
  },
]

const HOW: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: FileCode2, title: 'Choose the input', body: 'A contract address and its chain, a GitHub repo and commit, an upload, or a web2 repo.' },
  { icon: ListChecks, title: 'Confirm scope and cost', body: 'See what will be scanned, your free scans left this month and the price.' },
  { icon: CircleDollarSign, title: 'Pay if needed', body: 'Beyond the free quota a scan is invoiced through Gully Pay, in crypto, with no custody.' },
  { icon: ScanSearch, title: 'Watch it run', body: 'Live progress through fetching, analysing and triaging, with an estimate of the time left.' },
  { icon: FileCheck2, title: 'Read the report', body: 'Charts, filters, code locations and draft PoCs; export it, or publish it at a stable link.' },
]

function priceLine(id: TierId, o: SecurityOffer | null): string {
  if (!o) return '…'
  if (id === 'scan') return o.scan.priceUsd ? `$${o.scan.priceUsd} a scan` : 'Free'
  if (id === 'review') return 'Quoted on request'
  return o.audit.available ? 'Quoted' : 'Not offered yet'
}

function Tiers({ offer }: { offer: SecurityOffer | null }) {
  const [tier, setTier] = useState<TierId>('scan')
  const t = TIERS.find((x) => x.id === tier) ?? TIERS[0]
  const name = (id: TierId) => offer?.[id].name ?? TIERS.find((x) => x.id === id)?.title ?? id
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const i = TIERS.findIndex((x) => x.id === tier)
    const next = TIERS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TIERS.length) % TIERS.length].id
    setTier(next)
    document.getElementById(`tier-tab-${next}`)?.focus()
  }
  return (
    <section className="px-page pb-16" aria-labelledby="tiers-title">
      <div className="mb-6 flex flex-col gap-2">
        <span className={eyebrow}>TWO TODAY · ONE PLANNED</span>
        <h2 id="tiers-title" className="m-0 font-display text-h2 font-extrabold uppercase">
          What you can <span className="text-gold">get today</span>
        </h2>
      </div>
      <div role="tablist" aria-label="Tiers" onKeyDown={onKey} className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-1">
        {TIERS.map((x) => (
          <button key={x.id} id={`tier-tab-${x.id}`} type="button" role="tab" aria-selected={tier === x.id} aria-controls="tier-panel" tabIndex={tier === x.id ? 0 : -1} onClick={() => setTier(x.id)} className={`flex min-h-[72px] items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors ${tier === x.id ? 'border-gold bg-surface' : 'border-line hover:border-line-hover'}`}>
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-btn border ${tier === x.id ? 'border-gold text-gold' : 'border-line-strong text-faint'}`}>
              <x.icon size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="heading-4 leading-none">{name(x.id)}</span>
              <span className="text-[12px] text-muted">{x.who}</span>
            </span>
            <span className="ml-auto font-mono text-[12px] whitespace-nowrap text-gold" data-tier-price={x.id}>
              {priceLine(x.id, offer)}
            </span>
          </button>
        ))}
      </div>
      <div id="tier-panel" role="tabpanel" aria-labelledby={`tier-tab-${tier}`} className="mt-3 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 rounded-card border border-line bg-surface p-6 max-[900px]:grid-cols-1 max-[600px]:p-4" key={tier} style={{ animation: 'gl-fade .25s ease both' }}>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[15px] leading-[1.6] text-ink-2">{t.body}</p>
          {tier === 'scan' && offer && (
            <p className="m-0 font-mono text-[12px] leading-[1.6] text-muted" data-testid="scan-quota">
              Free each month: {Object.entries(offer.scan.freePerMonth)
                .map(([plan, n]) => `${n} on ${plan[0].toUpperCase()}${plan.slice(1)}`)
                .join(', ')}
              . Then ${offer.scan.priceUsd} a scan.
            </p>
          )}
          {tier === 'scan' ? (
            <a href={SCAN_APP_URL} target="_blank" rel="noopener noreferrer" className={`${btnGold} inline-flex w-fit items-center gap-2 px-5 py-3 text-[15px]`}>
              <Rocket size={16} aria-hidden /> Start a scan in the app <ArrowUpRight size={15} aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : tier === 'review' || offer?.audit.available ? (
            <a href="#request" className={`${btnOutline} inline-flex w-fit items-center gap-2 px-5 py-3 text-[15px]`}>
              <Users size={16} aria-hidden /> Ask for a quote
            </a>
          ) : (
            <a href="#request" className={`${btnOutline} inline-flex w-fit items-center gap-2 px-5 py-3 text-[15px]`}>
              <Users size={16} aria-hidden /> Ask for a Security Review instead
            </a>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">WHAT YOU GET</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] leading-[1.5] text-ink-2">
            {t.gets.map((g) => (
              <li key={g} className="flex gap-2">
                <FileCheck2 size={15} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {g}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">HONEST LIMITS</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] leading-[1.5] text-ink-2">
            {t.limits.map((g) => (
              <li key={g} className="flex gap-2">
                <ShieldAlert size={15} className="mt-[3px] shrink-0 text-error" aria-hidden /> {g}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/** Contract monitoring per plan (server/plans.mjs PLANS[].monitors) and the Gully Score: part 3 of Gully Security. */
function Monitoring({ plans }: { plans: Plan[] | null }) {
  const list = (plans ?? []).filter((p) => typeof p.monitors === 'number')
  const app = isLocalHost() ? '/developers#security-monitors' : `${APP_URL}/#security-monitors`
  return (
    <section id="monitoring" className="scroll-mt-24 px-page pb-16" aria-labelledby="monitoring-title" data-testid="monitoring-pricing">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] card card-pad items-center gap-6 max-[860px]:grid-cols-1">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
            <Radar size={14} className="text-gold" aria-hidden /> MONITORING
          </span>
          <h2 id="monitoring-title" className="heading-3">
            Watch your contracts <span className="text-gold">after launch</span>
          </h2>
          <p className="m-0 text-[14px] leading-[1.6] text-muted">Privileged changes and large outflows on the contracts you watch, by Telegram or webhook. Each watched contract can show a public Gully Score, worked out from public evidence only.</p>
        </div>
        <div className="flex flex-col gap-3">
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0" aria-label="Contracts watched by plan">
            {list.length ? (
              list.map((p) => (
                <li key={p.id} className="flex flex-col items-start gap-1 rounded-input border border-line px-3 py-2">
                  <span className="font-display text-[28px] leading-none font-bold text-gold">{p.monitors}</span>
                  <span className="text-[12px] text-muted">
                    contract{p.monitors === 1 ? '' : 's'} on {p.name}
                  </span>
                </li>
              ))
            ) : (
              <li className="col-span-3 text-[13px] text-faint">{plans ? 'Not listed.' : 'Reading the plans…'}</li>
            )}
          </ul>
          <span className="flex flex-wrap gap-3">
            <a href={app} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[14px] text-gold underline-offset-4 hover:underline">
              <Radar size={15} aria-hidden /> Add a monitor <ArrowUpRight size={13} aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <Link to="/score" className="inline-flex min-h-11 items-center gap-2 text-[14px] text-muted hover:text-ink">
              <Gauge size={15} aria-hidden /> Gully Score
            </Link>
          </span>
        </div>
      </div>
    </section>
  )
}

export function SecurityPage() {
  const [plans] = usePlans()
  const offer = plans.k === 'ok' ? (plans.offer.security ?? null) : null
  return (
    <>
      <Seo title="Gully Security" description="Live: the AI Security Scan (an AI review of a contract or codebase), the Gully Score and contract monitors. A human Security Review is quoted on request; a full audit is not offered yet." />
      <section className="relative overflow-hidden px-page pt-[64px] pb-12 max-[600px]:pt-10">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.14),transparent_62%)]" />
        <div className="relative grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-10 max-[960px]:grid-cols-1">
          <div className="flex flex-col gap-5">
            <span className="flex flex-wrap items-center gap-3" style={rise(0)}>
              <span className={eyebrow}>PRODUCT · GULLY SECURITY</span>
              <span className="rounded-full border border-success-line px-3 py-[3px] font-mono text-[11px] tracking-[1px] text-green">LIVE · SCAN · SCORE · MONITORS</span>
            </span>
            <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
              Find the bugs <span className="text-gold">before they ship</span>
            </h1>
            <p className="m-0 max-w-[640px] text-[18px] leading-[1.6] text-muted" style={rise(2)}>
              Run the AI Security Scan on a contract or a codebase from the app: an AI review only for now, labelled as such on every report. Check any contract’s Gully Score and watch your own with monitors. When you need people to read the code, ask us to quote a Security Review. A scan is not an audit, and we do not offer audits yet.
            </p>
            <div className="flex flex-wrap gap-3" style={rise(3)}>
              <a href={SCAN_APP_URL} target="_blank" rel="noopener noreferrer" className={`${btnGold} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}>
                <ScanSearch aria-hidden size={18} strokeWidth={1.75} /> Start a scan <ArrowUpRight aria-hidden size={16} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a href="#request" className={`${btnOutline} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}>
                <Users aria-hidden size={18} strokeWidth={1.75} /> Request a review
              </a>
              <Link to={securityHref('/security/reports')} className="inline-flex min-h-11 items-center gap-2 px-2 font-mono text-[13px] text-muted hover:text-ink">
                <FileText aria-hidden size={16} /> Published reports
              </Link>
            </div>
            <div className="flex max-w-[640px] flex-col gap-2" style={rise(4)}>
              <EngineStatus />
              <span className="flex flex-wrap gap-x-4 font-mono text-[13px]">
                <Link to={securityHref('/security/sample')} className="inline-flex min-h-11 items-center gap-2 text-gold underline-offset-4 hover:underline" data-testid="security-sample-link">
                  <FileCheck2 aria-hidden size={15} /> See a sample report
                </Link>
                <Link to={securityHref('/legal/scan-terms')} className="inline-flex min-h-11 items-center gap-2 text-muted hover:text-ink" data-testid="security-terms-link">
                  <ListChecks aria-hidden size={15} /> Scan terms
                </Link>
              </span>
            </div>
          </div>
          <div style={rise(2)}>
            <ScansChart />
          </div>
        </div>
      </section>

      <Tiers offer={offer} />

      <Monitoring plans={plans.k === 'ok' ? plans.offer.plans : null} />

      <section className="border-y border-line bg-bg-alt px-page py-14" aria-labelledby="how-title">
        <span className={eyebrow}>HOW A SCAN WORKS</span>
        <h2 id="how-title" className="sr-only">
          How a scan works
        </h2>
        <ol className="m-0 mt-5 grid list-none grid-cols-5 gap-px overflow-hidden rounded-card border border-line bg-line p-0 max-[1100px]:grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {HOW.map((h, i) => (
            <li key={h.title} className="relative flex flex-col gap-2 bg-bg-alt p-5">
              <span className="flex items-center gap-3">
                <span className="font-display text-[36px] leading-none font-extrabold text-gold">{i + 1}</span>
                <h.icon size={18} className="text-faint" aria-hidden />
              </span>
              <h3 className="heading-4">{h.title}</h3>
              <span className="text-[14px] leading-[1.5] text-muted">{h.body}</span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gold" style={{ animation: `gl-grow-x .8s ${0.3 + i * 0.15}s cubic-bezier(.2,.8,.2,1) both` }} />
            </li>
          ))}
        </ol>
      </section>

      <section id="request" className="scroll-mt-24 px-page py-14" aria-labelledby="request-title">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-10 max-[960px]:grid-cols-1">
          <div className="flex flex-col gap-3">
            <span className={eyebrow}>REQUEST A REVIEW</span>
            <h2 id="request-title" className="m-0 font-display text-h2 font-extrabold uppercase">
              Want people <span className="text-gold">on your code?</span>
            </h2>
            <p className="m-0 text-[15px] leading-[1.6] text-muted">Tell us what to look at. We reply by email with questions or a quote. Nothing is booked or charged by sending this.</p>
          </div>
          <ReviewRequestForm source="site" auditAvailable={offer?.audit.available ?? false} />
        </div>
      </section>
    </>
  )
}
