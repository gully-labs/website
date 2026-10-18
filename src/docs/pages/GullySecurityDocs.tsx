import { useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { axisTooltip, barsPreset, C as COL, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import type { SecurityOffer, SecurityStats } from '../../components/security/types'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { LatencySpark } from '../LiveCharts'
import { apiOrigin, SITE } from '../nav'

const sections = [
  { id: 'tiers', title: 'Tiers' },
  { id: 'scan', title: 'Running a scan' },
  { id: 'quota', title: 'Free scans and payment' },
  { id: 'report', title: 'Reading a report' },
  { id: 'publish', title: 'Publishing a report' },
  { id: 'review', title: 'Requesting a review' },
  { id: 'api', title: 'API' },
]

const SCAN_SHAPE = `// GET /api/developer/security/scans/:id   (signed in to the app, your active workspace)
type Scan = {
  id: string                       // sec_… : stable, used in every URL
  status: 'awaiting_payment' | 'queued' | 'fetching' | 'analysing' | 'triaging' | 'done' | 'failed' | 'cancelled'
  input: { kind: 'address' | 'repo' | 'upload' | 'web2', chain?, address?, repo?, commit? }
  progress: { step: string, pct: number } | null
  free: boolean
  priceUsd: number
  payment: { invoiceId, status, usd, payUrl } | null   // set when the scan is beyond the free quota
  published: boolean
  publicUrl: string | null         // /security/reports/<id> while published
  report?: {
    scope, summary, disclaimer,
    tools: { name, version, ran, reason? }[],
    findings: { id, severity, title, location, description, recommendation, poc?, pocExecuted, status }[]
  }
}`

const EVENTS = `// Live progress: Server-Sent Events, one \`scan\` event per change; the stream ends when the scan does.
const es = new EventSource('/api/developer/security/scans/sec_…/events')
es.addEventListener('scan', (e) => {
  const scan = JSON.parse(e.data)
  console.log(scan.status, scan.progress?.pct)
})`

/** Real counts of scans run on Gully Security (GET /api/security/stats), per day for 30 days. */
function ScanCounter() {
  const [s, set] = useState<SecurityStats | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    const go = () =>
      fetch(`${apiOrigin()}/api/security/stats`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: SecurityStats) => alive && set(d))
        .catch(() => alive && set((prev) => (prev && prev !== 'error' ? prev : 'error')))
    go()
    const id = setInterval(go, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  const data = s && s !== 'error' ? s : null
  const option = useMemo(() => {
    const days = data?.days ?? []
    return {
      grid: { left: 4, right: 4, top: 6, bottom: 4 },
      xAxis: { type: 'category', show: false, data: days.map((d) => d.day) },
      yAxis: { type: 'value', show: false, minInterval: 1 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const d = days[ps[0]?.dataIndex ?? 0]
        return d ? tipHtml({ title: d.day, rows: [{ name: 'started', value: String(d.started), color: COL.gold }, { name: 'finished', value: String(d.done), color: '#6fcf6a' }] }) : ''
      }, 'shadow'),
      series: [{ id: 'started', ...barsPreset(), barWidth: '60%', itemStyle: { color: COL.gold }, data: days.map((d) => d.started) }],
    }
  }, [data])
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4" aria-live="polite">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">SCANS RUN, LAST 30 DAYS · LIVE</span>
      {s === 'error' ? (
        <span className="text-[13px] text-error">unreadable right now</span>
      ) : !data ? (
        <span className="text-[13px] text-faint">reading…</span>
      ) : data.totals.started === 0 ? (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <span aria-hidden className="size-2 rounded-full bg-gold" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} /> No scans have run yet.
        </span>
      ) : (
        <>
          <AnimatedNumber value={data.totals.started} countUp className="font-display text-[34px] leading-none font-bold text-gold" />
          <EChart option={option} height={56} label={`Scans started per day over 30 days: ${data.totals.started} in all.`} steps={{ count: 30 }} />
        </>
      )}
    </div>
  )
}

function useSecurityOffer(): SecurityOffer | null {
  const [o, set] = useState<SecurityOffer | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`${apiOrigin()}/api/plans`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && set(d?.security ?? null))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return o
}

export function GullySecurityDocs() {
  const offer = useSecurityOffer()
  return (
    <DocPage
      slug="gully-security"
      eyebrow="PRODUCTS · GULLY SECURITY"
      title="Gully Security"
      description="Gully Security: the AI Security Scan (inputs, steps, quotas and payment), reading a report, publishing it, and requesting a human Security Review."
      lead="Scan contracts and code from the app, read the findings with their locations and draft proofs of concept, and ask people for a Security Review when a scan is not enough."
      sections={sections}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
        <ScanCounter />
        <LatencySpark path="/api/security/stats" label="STATS ENDPOINT, FROM YOUR BROWSER" />
      </div>

      <Section id="tiers" title="Tiers">
        <List>
          <li>
            <b>AI Security Scan</b>: automated and self-serve, in the app. Static analysers and an AI pass look for known vulnerability classes; the findings are de-duplicated and ranked.
          </li>
          <li>
            <b>Security Review</b>: people read your code, check the findings by hand and write up what they find. Quoted per project after a request.
          </li>
          <li>
            <b>Audit</b>: a premium tier planned for later. It is not offered today.
          </li>
        </List>
        <Callout label="Not an audit">A scan can miss issues (business logic, economic and cross-contract attacks, off-chain risks) and can report false positives. Every report says so. Gully Labs has not audited any project.</Callout>
      </Section>

      <Section id="scan" title="Running a scan">
        <P>
          Open the <Ext href="https://app.gullylabs.xyz/#security-new">Security page of the app</Ext> and follow the five steps: choose the input, confirm the scope and the cost, pay if the free quota is used up, watch it run, read the report.
        </P>
        <Fields
          head={['Input', 'What you give', 'Notes']}
          rows={[
            ['Deployed contract', 'address + chain', 'Ethereum, Base, Arbitrum, OP Mainnet, Polygon, BNB Chain or Avalanche; the verified source is read from the chain.'],
            ['Smart contract repo', 'owner/name + commit', 'A public GitHub repository; leave the commit empty for the default branch.'],
            ['Upload', '.zip, .tar.gz, .tgz, .sol, .vy, .rs or .move', offer ? `Up to ${Math.round(offer.scan.maxUploadBytes / 1_000_000)} MB.` : 'Size limit read from the server.'],
            ['Web2 repo', 'owner/name + commit', 'A web app or API on GitHub.'],
          ]}
        />
        <P>
          A scan moves through <C>queued</C>, <C>fetching</C>, <C>analysing</C> and <C>triaging</C> to <C>done</C> (or <C>failed</C>, or <C>cancelled</C> if you stop it). The app shows each step live with an estimate of the time left. You can leave the page; the scan keeps running.
        </P>
      </Section>

      <Section id="quota" title="Free scans and payment">
        {offer ? (
          <P>
            Each workspace gets free scans every calendar month (UTC) by its API plan:{' '}
            {Object.entries(offer.scan.freePerMonth)
              .map(([plan, n]) => `${n} on ${plan[0].toUpperCase()}${plan.slice(1)}`)
              .join(', ')}
            . A scan beyond that costs ${offer.scan.priceUsd}. At most {offer.scan.maxActive} scans run at once per workspace. A scan that fails does not use a free scan.
          </P>
        ) : (
          <P>Each workspace gets free scans every month by its API plan; the numbers and the price are read live from the server.</P>
        )}
        <P>
          A paid scan gets a Gully Pay invoice, payable in the app or at its <C>/pay/…</C> page in USDC, USDT or the chain&apos;s own coin, straight to the Gully Labs treasury. The scan starts by itself once the payment is confirmed. If the price changes between your confirmation and the request (say a teammate used the last free scan), the app asks you to confirm again.
        </P>
      </Section>

      <Section id="report" title="Reading a report">
        <List>
          <li>Findings by severity (critical, high, medium, low, info) as a donut and bars; click one to filter the list.</li>
          <li>Each finding expands to its description, code location (file and line, with the snippet when the engine gives one), recommendation and status.</li>
          <li>A draft proof of concept where the engine could write one, marked executed or not executed. Drafts are visible to your workspace only.</li>
          <li>Every tool that ran, and every tool that did not, with the reason.</li>
          <li>Export PDF opens the browser&apos;s print dialog on a print-styled report.</li>
        </List>
      </Section>

      <Section id="publish" title="Publishing a report">
        <P>
          The workspace owner or an admin can publish a finished report. It then lives at a stable address, <C>{SITE}/security/reports/sec_…</C>, and in the <Ext href={`${SITE}/security/reports`}>list of published reports</Ext>. Search engines are asked not to index it unless you also tick “Let search engines index it”. Unpublishing takes it down at once. Draft proofs of concept and the scan&apos;s cost are never part of a public report.
        </P>
      </Section>

      <Section id="review" title="Requesting a review">
        <P>
          Use the form on <Ext href={`${SITE}/security#request`}>the Security page</Ext> or under Request a review in the app. Tell us the project, what should be reviewed and, if you like, the repository, the contract and your timeline. We reply by email with questions or a quote; nothing is booked or charged by the form.
        </P>
      </Section>

      <Section id="api" title="API">
        <Fields
          head={['Endpoint', 'Who', 'What']}
          rows={[
            ['GET /api/developer/security', 'members', 'Free scans left, the offer, chains, engine state.'],
            ['GET /api/developer/security/scans', 'members', 'The workspace’s scans, newest first.'],
            ['POST /api/developer/security/scans', 'developer, admin, owner', '{ input, upload?, expect: { priceUsd } } → 201 started or 202 with an invoice.'],
            ['GET …/scans/:id, …/scans/:id/events', 'members', 'One scan with its report; live progress as Server-Sent Events.'],
            ['POST …/scans/:id/cancel', 'developer, admin, owner', 'Cancels before payment (and the invoice) or while running.'],
            ['POST …/scans/:id/publish', 'admin, owner', '{ published, indexable? }'],
            ['GET /api/security/reports[/:id]', 'anyone', 'Published reports only.'],
            ['POST /api/security/review-requests', 'anyone', 'A request for a Security Review or an Audit.'],
          ]}
        />
        <CodeBlock code={SCAN_SHAPE} lang="js" />
        <CodeBlock code={EVENTS} lang="js" />
      </Section>
    </DocPage>
  )
}
