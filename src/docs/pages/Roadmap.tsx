import { Layers, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { StatusRing } from '../LiveCharts'
import { Callout, DocLink, DocPage, Ext, H3, List, P, Section } from '../DocPage'
import { useDocHref, type DocSlug } from '../nav'

/* The general roadmap: every planned track with its status, so nothing planned reads as shipped.
   Status words are fixed: LIVE (in production), IN PROGRESS (being built), PLANNED (not started). */

type Status = 'live' | 'progress' | 'planned'
const PILL: Record<Status, [string, string]> = {
  live: ['LIVE', 'border-success-line text-green'],
  progress: ['IN PROGRESS', 'border-gold-line text-gold'],
  planned: ['PLANNED', 'border-line-strong text-dim'],
}

function Pill({ s }: { s: Status }) {
  const [label, cls] = PILL[s]
  return <span className={`inline-flex items-center rounded-full border px-[8px] py-[2px] font-mono text-[11px] tracking-[.5px] whitespace-nowrap ${cls}`}>{label}</span>
}

function Track({ icon: Icon, title, status, to, hash, children }: { icon: LucideIcon; title: string; status: Status; to: DocSlug; hash?: string; children: ReactNode }) {
  const href = useDocHref(to, hash)
  return (
    <Link to={href} className="flex min-h-11 min-w-0 items-start gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 text-ink no-underline transition-colors hover:border-gold-line hover:bg-surface-hover hover:text-ink">
      <span aria-hidden className="grid size-9 flex-none place-items-center rounded-[8px] border border-line bg-bg text-gold">
        <Icon size={17} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {title} <Pill s={status} />
        </span>
        <span className="text-[14px] leading-[1.55] text-muted">{children}</span>
      </span>
    </Link>
  )
}

function Stage({ n, status, children }: { n: string; status: Status; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-gold">{n}</span>
      {children}
      <Pill s={status} />
    </span>
  )
}

const sections = [
  { id: 'status', title: 'Status' },
  { id: 'l3', title: 'Gully L3' },
  { id: 'security', title: 'Audits & Security' },
  { id: 'stages', title: 'The stages' },
  { id: 'score', title: 'Gully Score: the rules' },
  { id: 'today', title: 'What you can buy today' },
]

export function Roadmap() {
  return (
    <DocPage
      slug="roadmap"
      eyebrow="MORE · ROADMAP"
      title="Roadmap"
      description="What Gully Labs plans to build next, with an honest status for each track: the Gully L3, and Audits & Security (AI security scans, security reviews, smart-contract and code audits, Gully Score and monitoring). Planned work is labelled planned."
      lead="What we plan to build next and where each track stands. Planned means planned: nothing on this page marked PLANNED exists yet, and the changelog says when something ships."
      sections={sections}
    >
      <Section id="status" title="Status">
        <div className="flex flex-col gap-2">
          <Track icon={Layers} title="Gully L3" status="planned" to="roadmap-l3">
            An Arbitrum chain settling to Arbitrum One, with Chain Kit, Gully Pay and Hyperlane. Spec written, devnet prepared, nothing running.
          </Track>
          <Track icon={ShieldCheck} title="Audits & Security" status="progress" to="roadmap" hash="security">
            The AI Security Scan is in the app (AI review only until the static-tools worker runs); Security Review requests are taken and quoted. Audits are planned and not offered.
          </Track>
        </div>
        <P>
          Status as of 18 October 2026. The <DocLink to="changelog">changelog</DocLink> records every change of status.
        </P>
      </Section>

      <Section id="l3" title="Gully L3">
        <P>
          The full spec, its stages and its open decisions live on <DocLink to="roadmap-l3">Roadmap: Gully L3</DocLink>: settlement to Arbitrum One, data availability, the gas token, Chain Kit as the
          explorer, Gully Pay native on the chain and Hyperlane as the interop layer. Today the spec is written and a light devnet is prepared; no chain is running.
        </P>
      </Section>

      <Section id="security" title="Audits & Security">
        <Callout label="SCAN LIVE · AUDITS NOT OFFERED">
          <strong className="text-ink">Gully Labs does not audit anything today and has published no audit reports.</strong> The automated{' '}
          <Ext href="https://gullylabs.xyz/security">AI Security Scan</Ext> is live; the other stages open only when the people, the process and the public record behind them exist, and
          the changelog will say when one does.
        </Callout>
        <P>
          Security work on both halves of a Web3 product: the smart contracts, and the code around them. Contract audits cover Solidity on the EVM chains we already work with. Code audits
          cover what usually goes wrong next to the contracts: dApp frontends, backends and APIs, key management, wallet-connect and signing flows, infrastructure and CI.
        </P>
        <P>
          It follows what the established security firms offer (audits, public reports, a public project score and on-chain monitoring), and the rules below are written against what
          their critics point out: scores whose weights are not published, badges that read as endorsements, and reports that do not say which code they covered.
        </P>
      </Section>

      <Section id="stages" title="The stages">
        <H3>
          <Stage n="01" status="live">
            AI Security Scan
          </Stage>
        </H3>
        <P>
          A self-serve scan of a deployed contract, a Solidity repository or an upload: Slither and Aderyn static analysis on the scanner worker, and an AI pass that removes false
          positives and ranks what is left. Free scans each month by plan, then paid with Gully Pay. The result is labelled an automated scan, never a review or an audit. Until the
          static-tools worker runs on our server, reports are labelled “AI review only — static tools unavailable”. Start one on <Ext href="https://gullylabs.xyz/security">gullylabs.xyz/security</Ext>.
        </P>
        <H3>
          <Stage n="02" status="planned">
            Security Review
          </Stage>
        </H3>
        <P>
          Two human reviewers read every line in scope, run the tools, and prove each finding with a failing test. The client fixes, we review every fix, and the report is published
          with the client’s consent, pinned to the exact commit hash that was reviewed.
        </P>
        <H3>
          <Stage n="03" status="planned">
            Smart-contract audits and code audits
          </Stage>
        </H3>
        <List>
          <li>
            <strong className="text-ink">Smart-contract audit</strong>: a security review plus formal checks of the core maths and accounting, a full fix review and a public report. We will
            use the word audit for our own work only once there is a public record of reviews and contest results to point to.
          </li>
          <li>
            <strong className="text-ink">Code audit</strong> for the non-contract parts: dApp frontends, backends and APIs, key and secret management, wallet-connect and signing flows,
            infrastructure and CI, checked against a checklist based on the{' '}
            <Ext href="https://owasp.org/www-project-application-security-verification-standard/">OWASP Application Security Verification Standard</Ext> (ASVS).
          </li>
        </List>
        <H3>
          <Stage n="04" status="planned">
            Gully Score and monitoring
          </Stage>
        </H3>
        <List>
          <li>
            <strong className="text-ink">Gully Score</strong>: a public page per project that shows its security signals, built from data we already read (the tracker, DeepCore launch and
            lock data, and holder data as it ships), with every component, weight and source shown. The rules are below.
          </li>
          <li>
            <strong className="text-ink">Monitoring</strong>: alerts when a watched contract changes its admin key, transfers ownership, moves a large amount out, pauses or upgrades,
            delivered by Telegram and signed webhooks, the way <DocLink to="plans-alerts">gap alerts</DocLink> are delivered today.
          </li>
        </List>
        <H3>
          <Stage n="05" status="planned">
            Bug bounty hosting
          </Stage>
        </H3>
        <P>Later: hosting bug bounty programmes for projects we have reviewed.</P>
      </Section>

      <Section id="score" title="Gully Score: the rules">
        <P>Written now, before any score exists, so they cannot be bent later.</P>
        <List>
          <li>Every component, its weight and its data source is shown on the page, and the method is published with a changelog. No hidden formula.</li>
          <li>No pay-to-rank. Paying Gully Labs for anything never changes a score or a position. If a scored project is also a client, its page says so.</li>
          <li>Audit status is only ever a link to a public report, with the auditor, the date, the commit hash and the contracts in scope. If the deployed code differs from that commit, the page says so.</li>
          <li>Admin powers (minting, upgrades, pausing, privileged withdrawals) count as risks, not as out of scope.</li>
          <li>A value we cannot read shows as unreadable, never as a pass and never as zero.</li>
          <li>After an incident the earlier score stays visible, marked, next to what happened.</li>
          <li>A score is information, not an endorsement and not investment advice. Identity checks, if we ever do them, are shown as identity only, never as a safety signal.</li>
        </List>
        <P>One of the inputs is already live: the tracker, read below from the public API in your browser.</P>
        <StatusRing />
      </Section>

      <Section id="today" title="What you can buy today">
        <P>
          Our current service is <strong className="text-ink">Security & Testing</strong>: code review, fuzzing and invariant tests, and post-launch monitoring, scoped and quoted per
          project. Ask through the contact form on the <Ext href="https://gullylabs.xyz/services">services page</Ext>.
        </P>
      </Section>
    </DocPage>
  )
}
