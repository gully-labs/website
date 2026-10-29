import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, H3, List, P, Section } from '../DocPage'
import { WorkspaceLimitsChart } from '../LiveCharts'

const sections = [
  { id: 'workspaces', title: 'Workspaces' },
  { id: 'roles', title: 'Roles' },
  { id: 'invites', title: 'Invites' },
  { id: 'switching', title: 'Switching and leaving' },
  { id: 'activity', title: 'Activity log' },
  { id: 'exports', title: 'CSV exports' },
]

const ACTIVITY = `// GET /api/developer/activity            the newest 50 events
// GET /api/developer/activity?cursor=…   the 50 before that (nextCursor from the previous page)
type ActivityPage = {
  workspace: { id: string }      // the owner's wallet address
  events: Array<{
    id: string
    at: string                   // ISO 8601, UTC
    actor: string                // the wallet that acted (lower-case), or 'system'
    action: string               // e.g. 'key.created', 'team.role_changed', 'usage.threshold'
    target: string | null        // what it acted on: a key, a wallet, an alert…
    detail: object | null        // a few plain fields; never a secret
  }>
  nextCursor: string | null      // empty on the last page
}`

const CSV = `# Signed in to the portal (the session cookie), in your active workspace:
GET /api/developer/export/usage.csv?range=24h     # or 7d, 30d
GET /api/developer/export/payments.csv

# usage.csv
time,key,total,ok,client_err,limited,server_err

# payments.csv
date,kind,plan,usd,amount,asset,chain,tx_hash,from,period_start,expires_at,explorer_url`

export function Teams() {
  return (
    <DocPage
      slug="teams"
      eyebrow="BUILD · TEAMS"
      title="Teams & workspaces"
      description="Share one Gully Labs developer account with a team: workspaces, roles and what each may change, invites by wallet or by link, the activity log and CSV exports of usage and payments."
      lead="Every wallet account is a workspace. Invite teammates by wallet or by link, give each a role, and see who changed what."
      sections={sections}
    >
      <Section id="workspaces" title="Workspaces">
        <P>
          When a wallet first signs in to the <Ext href="https://app.gullylabs.xyz">app dashboard</Ext>, it gets its own workspace and is its <b>owner</b>. Everything in the portal belongs to the workspace: API keys, gap and holder alerts, the linked Telegram chat, Gully Analytics, the plan and its payments. Members share all of it; nothing is copied per person.
        </P>
        <List>
          <li>The workspace is named after its owner (<C>0x1234…abcd’s workspace</C>) until an admin or the owner renames it.</li>
          <li>A workspace holds at most 25 people, the owner included, and 20 open invites at a time.</li>
          <li>Membership is checked on every request. A member who is removed is moved back to their own workspace on their next request.</li>
          <li>If the owner’s wallet is blocked, the workspace is unavailable to every member.</li>
        </List>
      </Section>

      <Section id="roles" title="Roles">
        <P>Every member can see everything in the workspace. A role decides what they may change:</P>
        <Fields
          head={['Role', 'May change', 'Notes']}
          rows={[
            ['owner', 'everything', 'The wallet that owns the workspace. Cannot be removed or demoted, and is the only one who can add, change or remove admins.'],
            ['admin', 'keys, alerts, Telegram, Gully Analytics, billing, company details, the team', 'Invites and manages developers, billing members and viewers, and renames the workspace.'],
            ['developer', 'keys, alerts, Telegram, Gully Analytics', <>Creates, renames, rotates and revokes keys; manages alerts and analytics websites; can open Gully Analytics in one click (see <DocLink to="analytics" hash="sign-in">single sign-on</DocLink>). Cannot pay or manage the team.</>],
            ['billing', 'billing, company details', 'Buys and renews plans (tracker API and Gully Analytics) and keeps the invoice details current.'],
            ['viewer', 'nothing', 'Read-only: keys (prefixes only), usage, alerts, billing and the activity log.'],
          ]}
        />
        <P>
          Your own profile, your sign-in sessions, switching workspace, leaving one and accepting an invite are open to every role. A request beyond your role answers <C>403</C> with <C>{'{"code":"forbidden-role"}'}</C>.
        </P>
      </Section>

      <Section id="invites" title="Invites">
        <P>Owners and admins invite from the Team tab, in two ways:</P>
        <List>
          <li>
            <b>By wallet.</b> Enter the teammate’s address. The invite waits for that wallet: they sign in to the portal and accept it there. Nobody else can use it.
          </li>
          <li>
            <b>By link.</b> The portal makes a link (<C>https://app.gullylabs.xyz/#invite=…</C>) that anyone who signs in with a wallet can accept, once. The link is shown <b>once</b>; only a hash of it is kept, so it cannot be shown again. Send it privately.
          </li>
        </List>
        <List>
          <li>Every invite carries the role it grants and expires after 7 days. Accepted, revoked and expired invites stop working at once.</li>
          <li>Open invites can be revoked from the Team tab. Only the owner can invite, or revoke the invite of, an admin.</li>
          <li>Opening a link shows the workspace name, the role and who invited you before you accept.</li>
          <li>Unknown links and repeated attempts are rate limited per address.</li>
        </List>
        <P>
          Owners and admins change a member’s role or remove them from the Team tab. Removing someone moves their sessions back to their own workspace, which is untouched.
        </P>
      </Section>

      <Section id="switching" title="Switching and leaving">
        <P>
          If you belong to more than one workspace, the portal’s workspace switcher lists yours first, then the others by name. The choice is kept for that sign-in session only, so two browsers can work in two workspaces. Members can leave a workspace from the Team tab; the owner cannot leave their own.
        </P>
      </Section>

      <Section id="activity" title="Activity log">
        <P>The Activity tab lists who did what in the workspace, newest first, 50 at a time. It records:</P>
        <List>
          <li>
            <b>Keys:</b> <C>key.created</C>, <C>key.renamed</C>, <C>key.rotated</C>, <C>key.revoked</C>, <C>key.linked</C>.
          </li>
          <li>
            <b>Alerts and Telegram:</b> <C>alert.created</C>, <C>alert.updated</C>, <C>alert.tested</C>, <C>alert.deleted</C>, <C>telegram.linked</C>, <C>telegram.unlinked</C>.
          </li>
          <li>
            <b>Billing and analytics:</b> <C>billing.quote</C>, <C>billing.paid</C>, <C>analytics.trial</C>, <C>analytics.site_added</C>, <C>analytics.site_removed</C>, <C>analytics.password_reset</C>, <C>analytics.quote</C>, <C>analytics.plan</C>.
          </li>
          <li>
            <b>Team and account:</b> <C>team.invited</C>, <C>team.invite_revoked</C>, <C>team.joined</C>, <C>team.role_changed</C>, <C>team.removed</C>, <C>team.left</C>, <C>workspace.renamed</C>, <C>company.updated</C>, <C>profile.updated</C>, <C>sessions.revoked</C>.
          </li>
          <li>
            <b>Usage:</b> <C>usage.threshold</C>, by <C>system</C>, when the workspace’s busiest key passes 80% or 100% of the plan’s per-minute limit (at most once a day per threshold). The owner can also have it sent to Telegram from their profile.
          </li>
        </List>
        <P>Only successful changes are logged, and never a secret. A workspace keeps its newest 1,000 events and nothing older than 180 days.</P>
        <P>Where <C>usage.threshold</C> fires on each plan, and how many keys a workspace may hold, read live from <C>GET /api/plans</C>:</P>
        <WorkspaceLimitsChart />
        <H3>Reading it from code</H3>
        <CodeBlock lang="js" code={ACTIVITY} caption="TypeScript · an activity page" />
        <P>
          Page backwards by passing the previous page’s <C>nextCursor</C> as <C>?cursor=</C>. A cursor that has aged out answers <C>400</C>: start again from the first page.
        </P>
      </Section>

      <Section id="exports" title="CSV exports">
        <P>Two downloads from the portal, for whatever workspace is active. Any member, viewers included, can download them.</P>
        <CodeBlock lang="text" code={CSV} caption="ENDPOINTS AND COLUMNS" />
        <Fields
          head={['File', 'Rows', 'Notes']}
          rows={[
            ['usage.csv', 'one per time bucket and key', <>Requests made with the workspace’s keys: hourly buckets for <C>24h</C> and <C>7d</C>, daily (UTC) for <C>30d</C>. <C>client_err</C> is 4xx other than 429, <C>limited</C> is 429, <C>server_err</C> is 5xx.</>],
            ['payments.csv', 'one per payment, oldest first', 'Every payment for the workspace’s plans (tracker API and Gully Analytics), with the asset, chain, transaction hash and an explorer link.'],
          ]}
        />
        <Callout label="SAFE IN A SPREADSHEET" tone="plain">
          Every text cell that starts with <C>=</C>, <C>+</C>, <C>-</C>, <C>@</C>, a tab or a carriage return gets a leading <C>&apos;</C>, so a spreadsheet shows it as text instead of running it as a formula. Cells with commas, quotes or line breaks are quoted. Files are UTF-8 with <C>CRLF</C> line ends.
        </Callout>
      </Section>
    </DocPage>
  )
}
