import { useEffect, useMemo, useState } from 'react'
import { C as CC, barsPreset, itemTooltip, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import type { Methodology } from '../../pages/score/api'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { apiOrigin } from '../nav'

const sections = [
  { id: 'what', title: 'What it is' },
  { id: 'components', title: 'Components and weights' },
  { id: 'missing', title: 'Missing data' },
  { id: 'no-pay', title: 'Nobody can pay' },
  { id: 'monitoring', title: 'Monitoring' },
  { id: 'embed', title: 'Badge and widget' },
  { id: 'api', title: 'API' },
]

const PAYLOAD = `// POST to your webhook, signed exactly like gap alerts:
//   X-Gully-Timestamp: <unix seconds>
//   X-Gully-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
type MonitorDelivery = {
  id: string                       // "dlv_…"
  type: 'monitor.alert' | 'monitor.test'
  createdAt: string                // ISO 8601, UTC
  monitor: { id: string; name: string | null; chainId: number; chain: string; address: string; score: string }
  events: Array<{                  // empty on monitor.test
    kind: 'owner-changed' | 'owner-transfer-started' | 'admin-changed' | 'role-granted' | 'role-revoked'
        | 'upgraded' | 'beacon-upgraded' | 'code-changed' | 'paused' | 'unpaused'
        | 'safe-owner-added' | 'safe-owner-removed' | 'safe-threshold-changed'
        | 'outflow' | 'native-outflow'
    text: string                   // the plain-language line, e.g. "⚠️ Owner of Vault changed from 0x12…ab to 0x98…cd · Base · <link>"
    txHash: string | null          // null for changes found by reading the contract (no transaction to point at)
    link: string                   // the transaction, or the contract, on the explorer
    blockNumber: number | null
    privileged: boolean            // true for owner, admin, role, code, pause and Safe signer changes
    at: string
  }>
}`

const API = `GET /api/score                          # the listed scores, the chains, the methodology
GET /api/score/methodology              # components, weights, sources and rules
GET /api/score/base/0x…                 # one contract (worked out when missing or older than 6 hours)
GET /score/base/0x…/badge.svg           # the badge (never computes; shows what is stored)`

const EMBED = `<!-- Badge: an image that links back to the score page -->
<a href="https://gullylabs.xyz/score/base/0x…" target="_blank" rel="noopener noreferrer">
  <img src="https://gullylabs.xyz/score/base/0x…/badge.svg" alt="Gully Score" width="260" height="48">
</a>

<!-- Live widget: the score ring, the date and the link, refreshed every 5 minutes -->
<div data-gully-score data-chain="base" data-address="0x…"></div>
<script src="https://gullylabs.xyz/widget.js" async></script>`

function useMethodology() {
  const [m, setM] = useState<Methodology | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    fetch(`${apiOrigin()}/api/score/methodology`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (x: Methodology) => alive && setM(x),
        () => alive && setM('error'),
      )
    return () => {
      alive = false
    }
  }, [])
  return m
}

/** The live weights, as bars that grow in (read from /api/score/methodology). */
function Weights({ m }: { m: Methodology }) {
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 30, top: 6, bottom: 6, containLabel: true },
      tooltip: itemTooltip((p: { dataIndex: number }) => {
        const c = [...m.components].reverse()[p.dataIndex]
        return tipHtml({ title: c.label, rows: [{ name: 'Weight', value: String(c.weight) }], note: c.source })
      }),
      xAxis: { type: 'value', max: Math.max(...m.components.map((c) => c.weight)) + 5 },
      yAxis: { type: 'category', data: [...m.components].reverse().map((c) => c.label), axisLabel: { color: CC.muted } },
      series: [{ ...barsPreset({ horizontal: true, stagger: 60 }), id: 'w', barMaxWidth: 14, color: CC.gold, data: [...m.components].reverse().map((c) => c.weight), label: { show: true, position: 'right', color: CC.faint, fontSize: 11 } }],
    }),
    [m],
  )
  return <EChart option={option} height={m.components.length * 30 + 20} label={`Gully Score weights: ${m.components.map((c) => `${c.label} ${c.weight}`).join(', ')}`} steps={{ count: m.components.length }} />
}

export function GullyScore() {
  const m = useMethodology()
  return (
    <DocPage
      slug="gully-score"
      eyebrow="SECURITY · GULLY SCORE"
      title="Gully Score"
      description="How the Gully Score is worked out: every component, its weight and source, what happens when data is missing, monitoring alerts, the badge and widget, and why nobody can pay to change a score."
      lead="The Gully Score is a 0 to 100 reading of how a contract is controlled and how it has behaved, built only from public evidence. Every part is shown with its weight, its source, a plain reason and a link to the evidence."
      sections={sections}
    >
      <Section id="what" title="What it is">
        <P>
          Each contract has a public page at <C>/score/&lt;chain&gt;/&lt;address&gt;</C> on <Ext href="https://gullylabs.xyz/score">gullylabs.xyz/score</Ext>, with the score, the parts that went into it, its history and a log of every change. A score is read again when it is more than six hours old, and soon after Gully Security monitoring sees a privileged change on the contract.
        </P>
        <Callout label="INFORMATIONAL ONLY">Scores are informational. They are not an endorsement and not investment advice. A high score says the public evidence looks good; it does not say a contract is safe.</Callout>
      </Section>

      <Section id="components" title="Components and weights">
        <P>The weights below are read live from the score service, the same numbers every score page uses. The score is the weighted average of the parts that could be read.</P>
        {m === null && <P>Reading the weights…</P>}
        {m === 'error' && <Callout label="UNAVAILABLE">The weights could not be read just now. They are always at /api/score/methodology.</Callout>}
        {m && m !== 'error' && (
          <>
            <Weights m={m} />
            <Fields head={['Part', 'Weight', 'What it asks, and where the answer comes from']} rows={m.components.map((c) => [c.label, String(c.weight), `${c.what} Source: ${c.source}.`])} />
          </>
        )}
        <List>
          <li>Code verified: an exact Sourcify match scores 100, a partial match 85, no published source 0.</li>
          <li>Who controls it: nobody (ownership given up) or a Safe needing two or more signatures 100, a timelock 80, an unrecognised contract 50, a Safe any one signer can use 40, a single wallet 15.</li>
          <li>Delay on changes: two days or more 100, one day 90, six hours 60, anything shorter 40, none 0.</li>
          <li>Can the code change: fixed code 100, upgradeable 30.</li>
          <li>Recent privileged changes: 100 less 25 for each change in the last 30 days.</li>
          <li>Liquidity locked: the share of the launch pools with a lock record, for DeepCore launches.</li>
          <li>Holder spread: the Holder Map’s Launch Health, or from the top-10 share (20% or less is 100, 90% or more is 0).</li>
          <li>Gully Security review: 100 less 40 per critical, 20 per high, 5 per medium and 1 per low finding (unresolved ones when the report says).</li>
          <li>Age: a year or more 100, six months 85, three months 70, a month 50, a week 30, younger 10.</li>
        </List>
      </Section>

      <Section id="missing" title="Missing data">
        <P>
          When a part cannot be read (the contract is not verified anywhere we can check, nobody watches it with monitoring, it is not a DeepCore launch, the Holder Map does not cover its chain) the page shows the part as <b>not available</b>, says why, and leaves its weight out. It is never scored as zero. With less than {m && m !== 'error' ? m.minCoverage : 40} of the 100 weight points available there is no score at all, only the parts.
        </P>
      </Section>

      <Section id="no-pay" title="Nobody can pay">
        <List>
          <li>The score is worked out from a chain and an address and nothing else. No plan, payment, account or workspace is read, so no plan can move it.</li>
          <li>A Gully Security review counts only once its report is published, and the page links to it with its finding counts. A draft or private report counts for nothing. There is no badge to buy.</li>
          <li>Watching a contract with monitoring, on any plan, adds the “recent privileged changes” part for everyone, good or bad. Choosing whether a watched contract is listed on /score does not change its score.</li>
        </List>
      </Section>

      <Section id="monitoring" title="Monitoring">
        <P>
          In the app’s Security tab, a workspace adds a contract (chain and address). It is read every minute through our RPC failover: owner, admin and role changes, upgrades (ERC-1967 and beacon proxies, and a change of the code address found by reading it directly), pauses, signer and threshold changes on the Safe that controls it, and large outflows of its own tokens or coin over the share or amount you set. Each alert is one plain line with a link, sent to Telegram and/or your webhook, and never twice: an event is marked as sent on disk before it goes out, so a restart resumes where it stopped without repeating anything.
        </P>
        <P>
          How many contracts a workspace can watch is part of its plan (<Ext href="https://gullylabs.xyz/pricing">pricing</Ext>). The load is small: about three RPC calls a minute per chain in use, shared by every contract on it, plus about one call a minute per contract.
        </P>
        <CodeBlock code={PAYLOAD} lang="js" />
      </Section>

      <Section id="embed" title="Badge and widget">
        <P>Every score page has a badge (an SVG with the score and the date it was read, in the Gully Labs kit) and a live widget. Both link back to the score page, where every part and its evidence is shown.</P>
        <CodeBlock code={EMBED} lang="html" />
      </Section>

      <Section id="api" title="API">
        <P>Public, read-only and open to any origin. A contract that has not been scored before is worked out on the first request (a few seconds), within a per-address rate limit.</P>
        <CodeBlock code={API} lang="bash" />
      </Section>
    </DocPage>
  )
}
