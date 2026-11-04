import { Ban, Clock, Cookie, Eye, KeyRound, UserCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Seo } from '../../components/Seo'
import { EChart } from '../../components/charts/EChart'
import { axisTooltip, barsPreset, C, PALETTE, tipHtml } from '../../components/charts/chartPresets'
import { Ext, Glance, Intro, L, LEGAL, LegalPage, link, Mail, P, S } from './kit'

/* gullylabs.xyz/privacy (/legal/privacy 301s here): the Gully Labs privacy policy, adapted from Basecamp's open-source
   policies (github.com/basecamp/policies, CC BY 4.0; the licence note is at the foot of the page and in
   LICENSES/POLICIES.md). Every statement about what is collected and how long it is kept was checked against the code
   (server/store.mjs, workspaces.mjs, activity.mjs, access.mjs, ask.mjs, telegram*.mjs, billing.mjs, merchants.mjs,
   analytics.mjs, security-routes.mjs, security-store.mjs, security/*.mjs, sec-monitor.mjs, gully-score.mjs, holders*.mjs,
   holders-deep-routes.mjs, holders-partners.mjs, chains-waitlist.mjs, chains-launch.mjs, developer.mjs, ecosystem.mjs,
   intake-notify.mjs, telegram-relay.mjs, pwa.mjs, index.html (the analytics script), compose.yaml and ops/backup.sh),
   last on 2026-11-03. When one of those changes what it stores or how long it keeps it, change this page.
   Section ids are s1…s15: Gully AI's index (scripts/build-ask-index.mjs) cites them; the RETENTION table is s11. */

export const PRIVACY_VERSION = LEGAL.updatedIso
export const SECTIONS = [
  'Who we are',
  'What we collect and why',
  'Website interactions and analytics',
  'Gully AI',
  'Telegram',
  'Gully Security',
  'Holder Map and Gully Score',
  'Billing: Gully Pay and public chains',
  'Cookies and browser storage',
  'When we share your information',
  'How long we keep it',
  'How we secure your data',
  'Your rights',
  'Where your data is',
  'Changes and questions',
] as const

/** What is kept and for how long, exactly as the code enforces it today. */
const RETENTION: [string, string][] = [
  ['Sign-in sessions', '30 days from sign-in (at most 20 per wallet), or until you sign out or revoke them'],
  ['Team invites', '7 days to accept; closed invites are deleted 30 days after they close'],
  ['Workspace activity log', 'The newest 1,000 events, none older than 180 days'],
  ['API usage counts per key', 'Hourly counts 31 days; the last 50 requests and daily totals until the key or account is deleted'],
  ['Gully AI questions and ratings', '90 days'],
  ['Telegram link codes', '10 minutes to use; deleted a day after they expire'],
  ['Unpaid payment quotes', 'Deleted 7 days after they expire'],
  ['Webhook deliveries', 'The newest 1,000 for Gully Pay; the newest 50 per gap alert'],
  ['Contact form messages', 'The newest 5,000 messages'],
  ['Security scans: the code, the fetched sources, tool output and the report', 'Deleted within a day of the scan being finished and 180 days old (a daily clean-up); the scan’s entry in your list (without the code) is not deleted automatically'],
  ['Code uploaded for a scan', 'Moved into the scan when it starts; deleted at once if a free scan cannot start or you cancel an unpaid scan; a paid scan left unpaid for 24 hours has its uploaded code deleted and its invoice cancelled'],
  ['Published scan reports', 'Public until unpublished; after that the copy stays on our server, not shown, and is not deleted automatically'],
  ['Security Review requests', 'The newest 5,000 requests'],
  ['Gully Chains waitlist', 'The newest 5,000 sign-ups'],
  ['Ecosystem and launchpad submissions', 'The newest 1,000 submissions'],
  ['Holder Map Deep checks and their reports', 'Cancelled checks are deleted after 30 days; others are not deleted automatically'],
  ['Partner launches and webhook deliveries', 'The newest 1,000 launches and the newest 500 deliveries'],
  ['Telegram /contact relay (which operator message belongs to which chat)', '30 days, the newest 5,000; the messages themselves stay in Telegram'],
  ['Chains launched from the app (testnet)', 'Until you remove them'],
  ['Security monitors', 'Until you delete the monitor; each keeps its last 100 events and last 50 alert deliveries'],
  ['Gully Score results and history', 'Not deleted automatically (who looked a score up is not recorded)'],
  ['Holder Map view counts', 'Reset every UTC day; the key that hashes visitors is never written down'],
  ['Telegram announcements: deliveries and opened links', 'The newest 200 announcements'],
  ['Telegram bot records (first and last seen, language, opt-out)', 'Not deleted automatically today'],
  ['Server and edge logs', 'As long as needed to run and secure the services, then deleted'],
  ['Backups of all of the above (on the same server)', '7 days'],
  ['Accounts, workspaces, keys, payments, invoices, stores, Telegram links, waitlists, analytics data', 'Not deleted automatically today; ask us and we delete what the law lets us'],
]

/* The fixed retention periods above, in days, as the server enforces them (the same figures as the table; rows
   kept "until deleted" or "the newest N" have no fixed period and are not drawn). Shown as an animated chart so
   the longest-kept data stands out at a glance. */
const RETENTION_DAYS: [string, number][] = [
  ['Telegram link codes', 1],
  ['Team invites (to accept)', 7],
  ['Unpaid payment quotes', 7],
  ['Backups', 7],
  ['Sign-in sessions', 30],
  ['Hourly API usage counts', 31],
  ['Gully AI questions and ratings', 90],
  ['Workspace activity log', 180],
  ['Security scan code and output', 180],
]

function RetentionChart() {
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 52, top: 6, bottom: 6, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const [what, days] = RETENTION_DAYS[ps[0]?.dataIndex ?? 0]
        return tipHtml({ title: what, rows: [{ name: 'Kept for', value: days === 1 ? 'about a day' : `${days} days` }] })
      }, 'shadow'),
      xAxis: { type: 'value', min: 0, max: 180, splitNumber: 6 },
      yAxis: { type: 'category', data: RETENTION_DAYS.map(([w]) => w), axisLabel: { color: C.muted, fontSize: 11 } },
      series: [
        {
          ...barsPreset({ horizontal: true, stagger: 60 }),
          id: 'days',
          barMaxWidth: 14,
          data: RETENTION_DAYS.map(([, d]) => ({ value: d, itemStyle: { color: d >= 180 ? PALETTE[4] : d >= 30 ? PALETTE[0] : PALETTE[2] } })),
          label: { show: true, position: 'right', color: C.faint, fontSize: 11, formatter: (x: { value: number }) => `${x.value} d` },
        },
      ],
    }),
    [],
  )
  return (
    <figure className="m-0 flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3" data-testid="retention-chart">
      <figcaption className="font-mono text-[11px] tracking-[1px] text-faint">FIXED RETENTION PERIODS, IN DAYS</figcaption>
      <EChart option={option} height={RETENTION_DAYS.length * 28 + 20} label={`Days each kind of data is kept: ${RETENTION_DAYS.map(([w, d]) => `${w} ${d} days`).join(', ')}`} steps={{ count: RETENTION_DAYS.length }} skeleton="bars" />
    </figure>
  )
}

const GLANCE = [
  { icon: Ban, t: 'Not sold, no ads', d: 'We do not sell your data or use it for advertising.', s: 1 },
  { icon: KeyRound, t: 'Wallet sign-in', d: 'No password or email is needed to sign in.', s: 2 },
  { icon: Eye, t: 'Who else sees it', d: 'Every outside service involved is listed.', s: 10 },
  { icon: Clock, t: 'Fixed retention', d: 'A table and chart show how long each kind is kept.', s: 11 },
  { icon: Cookie, t: 'One sign-in cookie', d: 'No tracking cookies; browser storage is listed.', s: 9 },
  { icon: UserCheck, t: 'Your rights', d: 'Ask us and we delete what the law lets us.', s: 13 },
]

export function PrivacyPage() {
  return (
    <>
      <Seo title="Privacy Policy" description="What Gully Labs collects across the site, the app, Gully Analytics, Gully AI, Gully Security, the Holder Map, the Telegram bot and Gully Pay checkouts, why, who else sees it, where it is stored and how long it is kept." />
      <LegalPage
        kicker="Legal · Privacy"
        title="Privacy Policy"
        product="Gully Labs"
        sections={SECTIONS}
        testId="privacy-page"
        related={[
          { href: '/terms', label: 'Terms of Service' },
          { href: '/legal/merchant-terms', label: 'Gully Pay merchant terms' },
          { href: '/legal/scan-terms', label: 'Security scan terms' },
          { href: '/legal', label: 'All Gully legal pages' },
        ]}
        intro={
          <Intro>
            <P>
              The privacy of your data is a big deal to us. In this policy we lay out what data we collect and why, how it is handled, who else sees it, and your rights. We collect as little as we can to run what you use, we don’t sell it, and we don’t use it for advertising.
            </P>
            <P>
              This policy covers gullylabs.xyz, docs.gullylabs.xyz, the Gully Labs App at app.gullylabs.xyz, blog.gullylabs.xyz, analytics.gullylabs.xyz, the checkout pages at pay.gullylabs.xyz, the API at api.gullylabs.xyz, the widgets and badges at embed.gullylabs.xyz, Gully AI, and the @GullyLabsBot Telegram bot and its Mini App. HolderMaps has its own policy at holdermaps.xyz/privacy. Using the services is also governed by our Terms of Service.
            </P>
          </Intro>
        }
        glance={<Glance label="The privacy policy at a glance" items={GLANCE} />}
      >
        <S n={1} title="Who we are">
          <P>
            Gully Labs LLC, based in Oregon, USA (“<b>Gully Labs</b>”, “<b>we</b>”, “<b>us</b>”), builds and runs these sites and services. We decide what personal data they collect and why, so we are responsible for it. If you run a Gully Pay store or use Gully Analytics on your own site, you are responsible for your own customers’ and visitors’ data, and we process it for you to provide the service.
          </P>
          <P>
            Questions or requests about your data: <Mail />.
          </P>
        </S>

        <S n={2} title="What we collect and why">
          <P>
            <b>Identity and access: signing in with your wallet.</b> The app signs you in with Sign-In with Ethereum: you sign a message, and no password or email is needed. We keep your wallet address, when you first and last signed in, and whether the account is blocked. Each sign-in creates a session that stores a hash of a random session id (never the id itself), when it was created, last used and expires, your browser’s user agent and which workspace you have open. We don’t store your IP address with your account or sessions.
          </P>
          <P>
            <b>Workspaces and teams.</b> A workspace’s name, its members’ wallet addresses and roles, who invited whom and when, and invites (an invite link is kept only as a hash). If you add them: a display name, an email address, notification choices, and company details (name, postal address, tax ID) for invoices. To show your ENS or Basename we look your address up through public Ethereum and Base nodes and keep the answer for 24 hours. An activity log records who changed what in the workspace (for example a key created or a plan paid), without IP addresses.
          </P>
          <P>
            <b>API keys and usage.</b> We keep a hash of each key (never the key itself), its prefix and name, and count requests per key: per hour by result and endpoint, per day, and the last 50 requests (time, method, path, status and response time). Anonymous requests are limited per IP address in memory only; we don’t store those IPs.
          </P>
          <P>
            <b>Voluntary correspondence: contact and waitlists.</b> When you write to us through the contact form: your name, email, message, the kind of project and budget you pick. When you join the Gully Chains waitlist: the contact you give (an email or a Telegram @username), your project’s name, the answers you choose and any notes. The Chain Kit and devnet waitlists in the app keep your email, your wallet and workspace, and for Chain Kit the chain you name. A project or launchpad submitted for the ecosystem page keeps its website, contact, chains, factory address and note.
          </P>
          <P>
            Each of these also goes to our operators’ Telegram chat as a short message with the details, and once a day the chat gets a count of what is new. Operators can export the lists as CSV files. If the contact you give is a Telegram @username and that account has started @GullyLabsBot, the bot sends you one short thank-you. Our server sends no email.
          </P>
          <P>
            <b>Chains you launch.</b> The app’s chain launch flow (testnet only) keeps the chain’s name, chain id, type and gas token, its owner, validator and batch-poster addresses, the deployment transaction and contract addresses, and which wallet recorded it. It never receives a private key or seed phrase and refuses any request that looks like one.
          </P>
        </S>

        <S n={3} title="Website interactions and analytics">
          <P>
            Gully Analytics is our own, self-hosted fork of the open-source Umami analytics, at analytics.gullylabs.xyz. Its script loads on gullylabs.xyz, docs.gullylabs.xyz, app.gullylabs.xyz, blog.gullylabs.xyz and holdermaps.xyz. Customers can use it on their own sites too. We don’t load any other analytics or advertising script.
          </P>
          <L>
            <li>It sets no cookies. A visit is grouped by a hash of the site, your IP address, your browser and a salt that changes every month, so we can’t follow you from month to month.</li>
            <li>Your IP address is used to work out your country, region and city and is then dropped; it isn’t stored. We also record the page, referrer, browser, operating system, device type, screen size and language.</li>
            <li>The checkout pages (pay.gullylabs.xyz) and the widgets and frames (embed.gullylabs.xyz) load no analytics at all.</li>
            <li>In the app, where you connect a wallet, it records wallet connects and disconnects, chain switches and transactions you send, with the chain and wallet type. By default the wallet address is stored only as a short hash (the first 16 characters of its SHA-256). That is pseudonymous, not anonymous: anyone who knows your address can compute the same hash.</li>
            <li>To opt out in a browser, set the local storage value umami.disabled to 1 for the site.</li>
          </L>
          <P>
            <b>Geolocation.</b> Cloudflare, which carries our traffic, tells our server the country of each request. We use it only to decide whether the stock token swap may be shown, and don’t store it.
          </P>
          <P>If you sign up for Gully Analytics, we also keep your wallet address, your sites, your plan and trial dates, and monthly event counts. Your Umami password is never stored by us.</P>
          <P>
            <b>Server logs.</b> Our own server keeps no log of every request. It logs errors and service events, which can include the address of a page or API call, and our network edge (Cloudflare and the proxy in front of our server) can log requests, including IP addresses, to keep the services secure. We keep these logs only as long as we need them to run and secure the services, then delete them.
          </P>
        </S>

        <S n={4} title="Gully AI">
          <P>
            When you ask Gully AI a question (on the site, in the app or with /ask in Telegram), we log the question, how long the answer was (not the answer itself), which sources and live tools it used, whether you were signed in, and a salted hash of your IP address, or of your Telegram chat id. If you rate an answer with a thumbs up or down, we keep the rating with the question and the same hash, so we know which docs to write. We keep questions and ratings for 90 days.
          </P>
          <P>
            To write the answer, the question, your last few messages in that conversation and the matching passages of our docs are sent to Anthropic (Claude). When semantic search is switched on, the question is also sent to Voyage AI to compare it with our docs. When you are signed in to the app (or ask in a private Telegram chat linked to your wallet), Gully AI can read your own workspace’s store, API usage and alerts to answer, read-only; it never sees another workspace. The app also remembers your recent questions in your own browser.
          </P>
        </S>

        <S n={5} title="Telegram">
          <P>
            Using @GullyLabsBot requires following the Gully Labs News channel; the bot checks this with Telegram and remembers the answer for up to 30 minutes, in memory only. If you link a chat to your wallet for alerts, we keep the chat id and type, the chat’s title (for a private chat, your first and last name and @username as Telegram gives them), your Telegram user id and when you linked it. Link codes are kept only as hashes and expire after 10 minutes. You can unlink at any time with /stop or in the bot’s settings.
          </P>
          <P>
            <b>Bot records.</b> For every chat that uses the bot we keep when it was first and last seen, its language, your Telegram @username (lower-cased, so a thank-you can reach you when you give it on a form), whether it is linked to a wallet, whether it follows the News channel, whether it has blocked the bot or switched announcements off, and how it found the bot. No other names and no message text are kept in these records.
          </P>
          <P>
            <b>Writing to the team (/contact).</b> When you write to us through the bot, each message (and any photo or file with it) is passed on to our operators’ Telegram chat with your name, @username and Telegram user id, and our replies come back through the bot. The text is not stored on our server: it stays in the two Telegram chats. Our server keeps only which operator message belongs to which chat (the newest 5,000, for 30 days), whether a conversation is open (it closes after 24 hours without messages) and the user ids we stopped relaying for.
          </P>
          <P>
            <b>Inline lookups.</b> When you type “@GullyLabsBot” and a token in any chat, the token is looked up like any Holder Map lookup; your Telegram user id is used only to limit lookups per minute, in memory. Launch radar posts in the News channel are built from Holder Maps we already made, which are public chain data.
          </P>
          <P>
            <b>Announcements.</b> The bot sometimes sends news to chats chosen by those records (for example linked chats, chats with alerts, followers of the News channel, a language, or chats active recently). For each announcement we keep, per recipient chat, whether it was delivered (with Telegram’s message id or error). Its buttons go through a link made for that recipient, so when you open one we record that this recipient opened it, once; we don’t record when, your IP address or your browser. Every announcement has a 🔕 Stop announcements button, and Settings switches them off and on again; that never affects your alerts.
          </P>
          <P>The Mini App checks Telegram’s signed launch data to know who you are and stores nothing: no cookie and no session.</P>
        </S>

        <S n={6} title="Gully Security">
          <P>
            <b>Scans.</b> When your workspace runs an AI Security Scan we keep a record of it: the workspace, the wallet that started it, when, what was scanned (a contract address and chain, a GitHub repository and commit, or an uploaded file’s name and size), its price or invoice and its status. To run the scan we store the code on our server: the file you upload, the full text of the source files fetched from the chain’s explorer or GitHub or unpacked from your upload, the tools’ output, the AI’s findings and the report. For a web2 scan, files named .env are stored with the rest of the code but are never sent to the AI or the scanning tools. Please don’t upload secrets.
          </P>
          <P>
            <b>Who sees it.</b> Members of your workspace see its scans and reports; developers, admins and owners can start and cancel them. Gully Labs operators can see the list of scans (who started one, the target and its status). To review the code, the files in scope are sent to Anthropic (Claude) after common secret patterns (API keys, private-key blocks and similar) are replaced; that check works by pattern and can miss a secret. The contract address and chain are sent to Etherscan, Blockscout or Sourcify to fetch verified source, the repository and commit to GitHub, and for web2 scans the dependency list in package-lock.json to the npm registry.
          </P>
          <P>
            <b>Publishing.</b> A workspace owner or admin can publish a finished report. It then becomes public: the target, the findings, file paths with their hashes, and any code comments the scan flagged as attempts to instruct the AI; draft proof-of-concept code and the workspace are left out. Search engines are asked not to index it unless the publisher allows it. Published reports count towards that contract’s Gully Score. Unpublishing takes the report off the site at once; the copy stays on our server, not shown.
          </P>
          <P>
            <b>Security Review requests.</b> When you ask for a quote we keep what you send (name, email, project, scope, repository, contract, company, timeline) and the signed-in wallet if there is one. The request also goes to our admin inbox and to our operators’ Telegram chat. Requests are limited per IP address and email in memory only; the IP is not stored.
          </P>
          <P>
            <b>Monitors.</b> For each contract your workspace watches we keep the contract, chain and name, your alert thresholds, your webhook address and its signing secret, whether Telegram is on, whether the contract may be listed publicly, the contract’s last read state, its last 100 events and the last 50 alert deliveries. The contract is read through public blockchain nodes. A monitor whose listing is on adds its events to that contract’s public Gully Score; with listing off, nothing the monitor records reaches the public.
          </P>
        </S>

        <S n={7} title="Holder Map and Gully Score">
          <P>
            <b>Holder Map.</b> Looking up a map needs no account. To show the maps opened most today we count one view per visitor per token per day, using a hash of the IP address made with a random key that is held in memory only and replaced every day; the counts are reset each UTC day. New maps are limited per IP address for a minute, in memory only. To build a map we send the token’s address (never anything about you) to public blockchain nodes (including dRPC and Gully Chain’s own nodes), Blockscout, Moralis, Solana nodes and the launchpad APIs we read launches from. Holder alerts are kept like other alerts, until you delete them.
          </P>
          <P>
            <b>Deep checks.</b> For a Deep check we keep the chain and token, its price, its status, the Gully Pay invoice that paid for it and the report, under an id that is hard to guess; anyone with the report’s link can read it. To count free checks, re-run credits and duplicates, a check is tied to your workspace when you are signed in, and otherwise to a shortened SHA-256 hash of your IP address. That hash is not salted, so it is pseudonymous: anyone who knows the address can compute it. Your browser remembers the ids of the last 20 checks you started.
          </P>
          <P>
            <b>Partner launches and webhooks.</b> When a launchpad sends us its new launches with its API key, we keep each launch’s chain, token and transaction, the map’s result, the workspace’s webhook address, its signing secret and its threshold, and a log of deliveries. Badges and the map frame on embed.gullylabs.xyz are drawn from maps we already hold, set no cookies and record nothing about who views them.
          </P>
          <P>
            <b>Gully Score.</b> Looking up a score needs no account and we don’t record who looked. We keep each contract’s latest score and its history. The contract address is sent to Sourcify, Etherscan and public blockchain nodes to read its evidence. Lookups are limited per IP address in memory only.
          </P>
        </S>

        <S n={8} title="Billing: Gully Pay and public chains">
          <P>
            Payments happen on public blockchains. A transaction, the addresses in it and the amount are public and permanent, and nobody (us included) can change or delete them. We never hold your funds.
          </P>
          <P>
            When you pay us or a Gully Pay store, we record the transaction hash, chain, asset, amount, its US dollar value at the time, the paying address and the block, to confirm and receipt the payment. A store’s owner sees its own payments, and its webhook sends the payment, including the paying address, to the address the store sets. A store can put a customer name and email on an invoice; the store decides that, and is responsible for it. We count how often an invoice page is opened, without storing who opened it.
          </P>
          <P>For a store we keep its name, logo (copied once from the address given, never hot-linked), accent colour, support email, website, receiving wallets, which version of the merchant terms it accepted and with which wallet, its invoices, links, fees and statements.</P>
        </S>

        <S n={9} title="Cookies and browser storage">
          <L>
            <li>
              <b>One cookie of ours:</b> the app’s sign-in cookie (__Host-gl_dev), only after you sign in. It is HttpOnly, sent only to the app over HTTPS, and lasts 30 days or until you sign out. The checkout pages, the API and embed.gullylabs.xyz set no cookies.
            </li>
            <li>
              <b>No advertising or cross-site tracking cookies</b>, and Gully Analytics uses none.
            </li>
            <li>
              <b>Browser storage</b> remembers choices on your device only: the app’s sidebar, invites you declined, that you accepted the swap risk notice, recent Gully AI questions in the app, requests you already sent (Chain Kit, devnet waitlist), that you closed the announcement bar or the install card, the Deep checks you started, and chart and tab choices.
            </li>
            <li>
              <b>Installing the site or app</b> as a web app adds a service worker that keeps copies of our own page files on your device, so pages open faster and offline. It never stores API answers, payment pages, embeds or anything about your account. Removing the app or clearing the site’s data deletes them.
            </li>
            <li>The blog (Ghost) runs on our server and handles its own visitors; its member sign-up is switched off.</li>
          </L>
        </S>

        <S n={10} title="When we share your information">
          <P>We don’t sell personal data or share it for advertising. These services see some of it because they carry, host or power what you use:</P>
          <L>
            <li>
              <b>Cloudflare</b> (DNS, network, TLS and firewall) carries all traffic to our sites, so it sees your IP address and requests, and tells our server your country.
            </li>
            <li>
              <b>OVHcloud</b> hosts the servers our sites, data and backups live on.
            </li>
            <li>
              <b>Anthropic</b> and, when switched on, <b>Voyage AI</b>: Gully AI questions, as above. Anthropic also reviews the code of Gully Security scans.
            </li>
            <li>
              <b>Etherscan, Blockscout, Sourcify, GitHub and the npm registry</b>: the contract, repository or dependency list a Gully Security scan or a Gully Score reads, as above.
            </li>
            <li>
              <b>Blockscout, Moralis, dRPC and other public node providers, and launchpad APIs</b>: token addresses for the Holder Map, as above. We read transactions, balances and ENS names through public RPC endpoints, which can include your address. Your wallet talks to its own nodes.
            </li>
            <li>
              <b>Telegram</b>: everything you send to or receive from the bot.
            </li>
            <li>
              <b>Wallet and swap services you choose to use</b>: WalletConnect when you connect a wallet that way, LI.FI in the swap widget, and Jupiter for Solana swaps (it receives your public key).
            </li>
            <li>
              <b>Addresses you give us</b>: alert, store and partner launch webhooks are sent to the URLs you set.
            </li>
            <li>
              <b>Where we publish</b>: our pages link to Gully Labs on X, YouTube, TikTok, Facebook, Medium, GitHub and Telegram. They are plain links: nothing from those platforms loads on our pages, and their own policies apply once you visit them.
            </li>
          </L>
          <P>
            We access or disclose data only to provide what you asked for, to help with a support case you raise, to investigate or stop abuse of the services, when the law requires it (we tell you before we answer a request about you unless the law forbids it), or to a buyer if Gully Labs is sold, under this policy. We may use aggregated, de-identified figures (such as visit counts) for any purpose.
          </P>
        </S>

        <S n={11} title="How long we keep it">
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full border-collapse text-left text-[14px]">
              <caption className="sr-only">Retention periods</caption>
              <thead>
                <tr className="border-b border-line font-mono text-[11px] tracking-[1px] text-muted">
                  <th scope="col" className="px-4 py-3 font-normal">
                    DATA
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    KEPT FOR
                  </th>
                </tr>
              </thead>
              <tbody>
                {RETENTION.map(([what, how]) => (
                  <tr key={what} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-3 align-top font-medium text-ink">
                      {what}
                    </th>
                    <td className="px-4 py-3 text-ink-2">{how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RetentionChart />
          <P>Sessions last 30 days. Gully AI questions and ratings are kept 90 days. The activity log keeps 180 days, and so does a security scan’s code. Backups are kept 7 days. Accounts, payments and stores are not deleted automatically today.</P>
        </S>

        <S n={12} title="How we secure your data">
          <P>
            We store hashes instead of secrets wherever we can (session ids, API keys, invite and link codes, IP addresses in the Gully AI log and the Holder Map counts), use HTTPS everywhere, keep our servers behind Cloudflare, and back the data up every night to the same server, keeping 7 days. No system is perfectly secure; if a breach affects your data, we will tell you as the law requires.
          </P>
        </S>

        <S n={13} title="Your rights">
          <P>Wherever you live, you can ask us to:</P>
          <L>
            <li>tell you what we hold about you, and give you a copy;</li>
            <li>correct it, or delete it (the app has no self-service “delete my account” button yet, so email us and we will do it);</li>
            <li>stop or limit a use of it, or explain why we use it.</li>
          </L>
          <P>
            You can also act yourself: sign out or revoke any session in the app’s Settings; revoke API keys, delete alerts, remove webhooks and switch off pay links; unlink Telegram with /stop; delete a monitor or unpublish a scan report; and opt out of Gully Analytics as described above. Write to <Mail /> for anything else. We may keep payment records where the law requires, and we can’t delete anything that is on a public blockchain. Depending on where you live, you may also complain to your data protection authority.
          </P>
          <P>You must be at least 18 years old to use the services, and we don’t knowingly collect data from anyone younger.</P>
        </S>

        <S n={14} title="Where your data is">
          <P>
            The data the services store, and its backups, live on OVHcloud virtual servers that we run. Cloudflare and the other services listed above process data in their own locations, which can be in countries other than yours. Gully Labs LLC is a US company, so the laws of the United States apply to how we handle your data.
          </P>
        </S>

        <S n={15} title="Changes and questions">
          <P>
            We may update this policy as needed. When we do, the “Last updated” date at the top changes, and for a material change we say so on the site before it takes effect. Questions, requests or complaints: Gully Labs LLC, Oregon, USA, <Mail />. The{' '}
            <Link to="/terms" className={link}>
              Terms of Service
            </Link>{' '}
            and the <Ext href="https://docs.gullylabs.xyz/analytics">Gully Analytics docs</Ext> say more about how the services work.
          </P>
        </S>
      </LegalPage>
    </>
  )
}
