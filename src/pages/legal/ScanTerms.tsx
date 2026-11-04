import { useMemo } from 'react'
import { Link } from 'react-router'
import { Seo } from '../../components/Seo'
import { EChart } from '../../components/charts/EChart'
import { GhostChart } from '../../components/charts/GhostChart'
import { axisTooltip, barsPreset, C, PALETTE, tipHtml } from '../../components/charts/chartPresets'
import { EngineStatus } from '../../components/security/EngineStatus'
import { usePlans } from '../../lib/plans'
import { SCAN_APP_URL } from '../security/shared'
import { securityHref } from '../../site-host'
import { Intro, L, LEGAL, LegalPage, link as a, Mail, P, S } from './kit'

/* gullylabs.xyz/legal/scan-terms (also /security/terms): the terms for the AI Security Scan that the Gully Labs App runs
   (the scan engine is server/security-routes.mjs on this server), in plain words, laid out on the Basecamp template
   (src/pages/legal/kit.tsx; LICENSES/POLICIES.md). Every rule here is
   what the code does today, checked on 2026-11-03 against server/security-routes.mjs (quota, price check, invoice,
   re-run credits, the unpaid-upload sweep), server/security/config.mjs (the 30-minute scan limit), server/security/
   index.mjs (the 180-day prune), server/plans.mjs SECURITY and the privacy policy's Gully Security section.
   The price and the free scans per plan are read live from GET /api/plans; nothing numeric about them is typed here.
   When one of those rules changes, change this page. Section ids s1…s10 (Gully AI cites them). */

export const SCAN_TERMS_VERSION = LEGAL.updatedIso
const SECTIONS = ['What a scan is', 'What it is not', 'Prices and free scans', 'How long it takes', 'Refunds and re-run credits', 'Your code', 'Your part', 'Publishing a report', 'Disclaimer and liability', 'Changes and contact']



const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Free scans a month on each plan, as the server grants them (GET /api/plans, SECURITY.scan.freePerMonth). */
function FreeScansChart({ perPlan }: { perPlan: [string, number][] }) {
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 40, top: 6, bottom: 6, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const [plan, n] = perPlan[ps[0]?.dataIndex ?? 0]
        return tipHtml({ title: `${cap(plan)} plan`, rows: [{ name: 'Free scans a month', value: String(n) }] })
      }, 'shadow'),
      xAxis: { type: 'value', min: 0, minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.faint, fontSize: 11 } },
      yAxis: { type: 'category', data: perPlan.map(([p]) => cap(p)), axisLabel: { color: C.muted, fontSize: 12 } },
      series: [
        {
          ...barsPreset({ horizontal: true, stagger: 90 }),
          id: 'free',
          barMaxWidth: 16,
          data: perPlan.map(([, n], i) => ({ value: n, itemStyle: { color: [PALETTE[2], PALETTE[0], C.gold][i] ?? C.gold } })),
          label: { show: true, position: 'right', color: C.faint, fontSize: 11 },
        },
      ],
    }),
    [perPlan],
  )
  return <EChart option={option} height={perPlan.length * 34 + 16} label={`Free scans a month: ${perPlan.map(([p, n]) => `${n} on ${cap(p)}`).join(', ')}`} steps={{ count: perPlan.length }} skeleton="bars" />
}

export function ScanTermsPage() {
  const [plans] = usePlans()
  const offer = plans.k === 'ok' ? (plans.offer.security ?? null) : null
  const price = offer ? `$${offer.scan.priceUsd}` : 'the price shown at checkout'
  const perPlan: [string, number][] = offer ? Object.entries(offer.scan.freePerMonth) : []
  const maxActive = offer?.scan.maxActive ?? 2
  const maxMb = offer ? Math.round(offer.scan.maxUploadBytes / 1_000_000) : 2
  return (
    <>
      <Seo title="AI Security Scan terms" description="The terms for the AI Security Scan: what an automated scan is and is not, free scans and prices, re-run credits instead of refunds, how long your code is kept, and the limits of our liability." />
      <LegalPage
        kicker="Legal · Gully Security"
        title="Scan terms"
        product="Gully Labs"
        sections={SECTIONS}
        testId="scan-terms"
        related={[
          { href: SCAN_APP_URL, label: 'Start a scan in the app' },
          { href: securityHref('/security/sample'), label: 'Sample report' },
          { href: '/terms', label: 'Terms of Service' },
          { href: '/privacy', label: 'Privacy Policy' },
          { href: '/legal', label: 'All Gully legal pages' },
        ]}
        intro={
          <Intro>
            <P>
              These terms cover the AI Security Scan (“<b>a scan</b>”) that Gully Labs LLC, Oregon, USA (“<b>Gully Labs</b>”, “<b>we</b>”) runs from the Gully Labs App. You accept them when you start a scan. The short version: a scan is automated software, not an audit; it can miss things; a paid scan that fails gives you a free re-run, not a refund; and we delete your code within 180 days.
            </P>
          </Intro>
        }
      >

          <S n={1} title="What a scan is">
            <P>
              A scan is an automated, point-in-time review of the code you name: a verified contract at an address on a chain, a public GitHub repository at a commit, a file you upload, or a web2 codebase (a checklist review). Software runs it from start to finish. Depending on what is running on our servers it uses static-analysis tools, an AI review by Anthropic’s Claude models, or both. The report names the mode, every tool that ran and every tool that did not, with the reason.
            </P>
            <EngineStatus />
            <P>
              The status above is read live from the scanner. Today the static-analysis worker is not deployed, so scans are an AI review only, and every report’s label says so. See a{' '}
              <Link to={securityHref('/security/sample')} className={a}>
                sample report
              </Link>{' '}
              to know exactly what you get.
            </P>
          </S>

          <S n={2} title="What it is not">
            <L>
              <li>It is not an audit and not a security review by people. No person at Gully Labs reads your code for a scan, and no finding is verified by a human.</li>
              <li>It can miss issues: business logic, economic and cross-contract attacks, upgrade and key-management risks, and anything off-chain.</li>
              <li>It can report false positives. A draft proof of concept is marked “draft, not executed” unless our worker ran it.</li>
              <li>It is no guarantee that code is safe, and no endorsement. A report with no findings is not evidence that the code is safe.</li>
            </L>
            <P>
              If you need people on your code, ask us for a{' '}
              <Link to={securityHref('/security#request')} className={a}>
                Security Review
              </Link>
              , quoted per project under its own agreement.
            </P>
          </S>

          <S n={3} title="Prices and free scans">
            <P>Each workspace gets free scans every calendar month (UTC), by plan. After that a scan costs {price}. Unused free scans do not roll over. A scan that failed does not use a free scan.</P>
            <figure className="m-0 flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3" data-testid="free-scans-chart">
              <figcaption className="font-mono text-[11px] tracking-[1px] text-faint">FREE SCANS A MONTH, BY PLAN · LIVE FROM THE PRICE LIST</figcaption>
              {perPlan.length ? <FreeScansChart perPlan={perPlan} /> : <GhostChart variant="bars" height={118} badge={false} label={plans.k === 'error' ? 'The price list could not be read just now' : 'Reading the price list…'} framed={false} />}
            </figure>
            <L>
              <li>The checkout shows the price before you confirm. If it changed meanwhile (your free scans ran out in another tab), the scan is not started and you are asked to confirm again. Nothing is charged silently.</li>
              <li>A paid scan is paid with a Gully Pay invoice in crypto (USDC, USDT or the chain’s coin), straight to the Gully Labs treasury. The scan starts when the payment confirms. An unpaid invoice expires after 7 days.</li>
              <li>Prices exclude any taxes you owe where you are.</li>
            </L>
          </S>

          <S n={4} title="How long it takes">
            <P>
              Most scans finish in minutes. The server runs one scan at a time, so a scan can wait in the queue; you see its place and its progress live. A scan is stopped if it runs for more than 30 minutes. A workspace can have at most {maxActive} scans running or waiting at once. These are targets, not promises: a busy queue, a slow block explorer or an outside service being down can delay a scan.
            </P>
          </S>

          <S n={5} title="Refunds and re-run credits">
            <P>Payments on a blockchain are final, so we do not refund scans. Instead:</P>
            <L>
              <li>
                <b>A paid scan that fails</b> (it ends “failed” for any reason, ours or the input’s) gives your workspace one <b>re-run credit</b>. A credit pays for one scan in full.
              </li>
              <li>Credits are used automatically after your free scans for the month and before any price. The checkout says when a scan uses one.</li>
              <li>A scan paid with a credit that fails again gives the credit back.</li>
              <li>Credits belong to the workspace, have no cash value and cannot be transferred. They do not expire today; if that changes we will say so here with at least 30 days’ notice.</li>
              <li>A scan you cancel before paying costs nothing. Once a paid scan has started, cancelling it does not earn a credit.</li>
              <li>A scan that finishes is delivered, whatever it finds. If you think a scan went wrong in a way these rules do not cover, write to us: we decide case by case.</li>
            </L>
          </S>

          <S n={6} title="Your code">
            <L>
              <li>Repositories must be public. An upload can be a .zip of Solidity files or a single .sol file of up to {maxMb} MB.</li>
              <li>To review the code, the files in scope are sent to Anthropic (Claude), after common secret patterns are replaced. That check works by pattern and can miss a secret: do not upload secrets.</li>
              <li>The code, the fetched sources, the tools’ output and the report are deleted within a day of the scan being 180 days old. Code uploaded for a scan you leave unpaid for 24 hours is deleted and its invoice cancelled.</li>
              <li>Your reports are private to your workspace unless an owner or admin publishes one.</li>
            </L>
            <P>
              The{' '}
              <Link to="/privacy#s6" className={a}>
                privacy policy
              </Link>{' '}
              says in full what is stored, who sees it and for how long.
            </P>
          </S>

          <S n={7} title="Your part">
            <L>
              <li>Scan only code you own or have the right to have reviewed. Contracts verified on a public explorer and public repositories are fine to scan.</li>
              <li>Do not use scans or reports to attack anyone’s contracts or users, or to help others do so.</li>
              <li>Do not try to steer the AI with instructions hidden in the code. The scan flags such comments, removes them before review and lists them in the report.</li>
              <li>Do not try to get around the free-scan limits, for example with many workspaces.</li>
            </L>
          </S>

          <S n={8} title="Publishing a report">
            <P>
              A workspace owner or admin can publish a finished report at a public link, and take it down again at any time. A published report shows the target and the findings; draft proof-of-concept code and the workspace are left out. It is labelled as an automated scan, not an audit. Do not present a scan report, published or not, as an audit or as an endorsement by Gully Labs.
            </P>
          </S>

          <S n={9} title="Disclaimer and liability">
            <P>Scans and reports are provided “as is”, without any warranty, express or implied, including fitness for a purpose and that they find every issue. You decide what to do with a report, and you remain responsible for your code and for deploying it.</P>
            <P>
              To the extent the law allows, Gully Labs is not liable for any loss of funds, profits, data or reputation, or for any indirect or consequential loss, arising from a scan, a report or an issue a scan did not find. Our total liability for any claim about a scan is limited to the amount you paid for that scan. Nothing in these terms limits liability that cannot be limited by law.
            </P>
          </S>

          <S n={10} title="Changes, law and contact">
            <P>
              We may change these terms; the “Last updated” date above changes with them, and a change applies to scans started after it is published. These terms sit alongside the Gully Labs <Link to="/terms" className={a}>Terms of Service</Link>, which cover everything else about the app. They are governed by the laws of the State of Oregon, USA, and any dispute goes to the state and federal courts located in Oregon, except where consumer law gives you the right to bring a claim where you live. You must be at least 18 years old to run a scan.
            </P>
            <P>
              Questions: Gully Labs LLC, Oregon, USA, <Mail />.
            </P>
          </S>

      </LegalPage>
    </>
  )
}
