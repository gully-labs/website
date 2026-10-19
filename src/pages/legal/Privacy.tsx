import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Seo } from '../../components/Seo'
import { eyebrow } from '../../components/ui'
import { EChart } from '../../components/charts/EChart'
import { axisTooltip, barsPreset, C, PALETTE, tipHtml } from '../../components/charts/chartPresets'

/* /legal/privacy: the Gully Labs privacy policy, adapted from Basecamp's open-source policies
   (github.com/basecamp/policies, CC BY 4.0; attribution and the list of changes at the foot of the page, as
   the licence requires). Every statement about what is collected and how long it is kept was checked
   against the code on 2026-10-18 (server/store.mjs, workspaces.mjs, activity.mjs, access.mjs, ask.mjs,
   telegram*.mjs, telegram-broadcast.mjs, telegram-users.mjs, billing.mjs, merchants.mjs, analytics.mjs,
   security-routes.mjs, security-store.mjs, security/*.mjs, sec-monitor.mjs, gully-score.mjs, holders*.mjs,
   index.html, compose.yaml, ops/backup.sh).
   When one of those changes what it stores or how long it keeps it, change this page and PRIVACY_VERSION.
   Section ids are s1…s12: Gully AI's index (scripts/build-ask-index.mjs) cites them. */

export const PRIVACY_VERSION = '2026-10-18'
const BASECAMP_URL = 'https://github.com/basecamp/policies'
const CC_URL = 'https://creativecommons.org/licenses/by/4.0/'
const SECTIONS = ['Who we are', 'What we collect', 'Gully Analytics', 'Gully AI', 'Telegram', 'Gully Security', 'Holder Map and Gully Score', 'Gully Pay and public chains', 'Cookies and browser storage', 'Who else sees data', 'How long we keep it', 'Security', 'Your choices', 'Changes and contact']

function S({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section id={`s${n}`} aria-labelledby={`s${n}-h`} className="flex scroll-mt-24 flex-col gap-3">
      <h2 id={`s${n}-h`} className="m-0 font-display text-[clamp(24px,3.4vw,30px)] leading-none font-bold uppercase text-ink">
        <span className="mr-2 font-mono text-[15px] font-normal text-gold">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  )
}
const P = ({ children }: { children: ReactNode }) => <p className="m-0 text-[16px] leading-[1.7] text-ink-2">{children}</p>
const L = ({ children }: { children: ReactNode }) => <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[16px] leading-[1.65] text-ink-2 marker:text-gold">{children}</ul>
const ext = 'text-gold underline decoration-gold-line underline-offset-2'

/** Renders an HTML comment into the page (visible to anyone reading the source, never on screen). */
function HtmlComment({ text }: { text: string }) {
  return <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: `<!-- ${text.replace(/--/g, '—')} -->` }} />
}

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
  ['Security monitors', 'Until you delete the monitor; each keeps its last 100 events and last 50 alert deliveries'],
  ['Gully Score results and history', 'Not deleted automatically (who looked a score up is not recorded)'],
  ['Holder Map view counts', 'Reset every UTC day; the key that hashes visitors is never written down'],
  ['Telegram announcements: deliveries and opened links', 'The newest 200 announcements'],
  ['Telegram bot records (first and last seen, language, opt-out)', 'Not deleted automatically today'],
  ['Backups of all of the above', '7 days'],
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

export function PrivacyPage() {
  return (
    <>
      <Seo title="Privacy policy" description="What Gully Labs collects across the site, the app, Gully Analytics, Gully AI, Gully Security, the Holder Map, the Telegram bot and Gully Pay, why, who else sees it and how long it is kept." />
      <HtmlComment text="Draft: review by counsel before relying on it." />
      <article className="relative px-page pt-[64px] pb-24 max-[600px]:pt-10">
        <div className="mx-auto flex max-w-[820px] flex-col gap-10">
          <header className="flex flex-col gap-4" style={{ animation: 'gl-rise .5s ease both' }}>
            <span className={eyebrow}>LEGAL · PRIVACY</span>
            <h1 className="m-0 font-display text-[clamp(40px,7vw,72px)] leading-[.92] font-extrabold uppercase">Privacy policy</h1>
            <p className="m-0 font-mono text-[12px] text-faint">Version {PRIVACY_VERSION}</p>
            <P>
              We collect as little as we can to run what you use, we don’t sell it, and we don’t use it for advertising. This page says what we collect, why, who else sees it and how long we keep it, product by product. It covers gullylabs.xyz, docs.gullylabs.xyz, the Gully Labs app at app.gullylabs.xyz, blog.gullylabs.xyz, analytics.gullylabs.xyz, the payment pages, Gully AI, and the @GullyLabsBot Telegram bot and its Mini App.
            </P>
            <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
              {SECTIONS.map((t, i) => (
                <a key={t} href={`#s${i + 1}`} className="inline-flex min-h-11 items-center text-dim hover:text-gold">
                  {i + 1}. {t}
                </a>
              ))}
            </nav>
          </header>

          <S n={1} title="Who we are">
            <P>
              Gully Labs (“<b>we</b>”, “<b>us</b>”) builds and runs these sites and services. We decide what personal data they collect and why, so we are responsible for it. If you run a Gully Pay store or use Gully Analytics on your own site, you are responsible for your own customers’ and visitors’ data, and we process it for you to provide the service.
            </P>
            <P>Questions or requests about your data: <a href="mailto:team@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">team@gullylabs.xyz</a>.</P>
          </S>

          <S n={2} title="What we collect">
            <P>
              <b>Signing in with your wallet.</b> The app signs you in with Sign-In with Ethereum: you sign a message, and no password or email is needed. We keep your wallet address, when you first and last signed in, and whether the account is blocked. Each sign-in creates a session that stores a hash of a random session id (never the id itself), when it was created, last used and expires, your browser’s user agent and which workspace you have open. We don’t store your IP address with your account or sessions.
            </P>
            <P>
              <b>Workspaces and teams.</b> A workspace’s name, its members’ wallet addresses and roles, who invited whom and when, and invites (an invite link is kept only as a hash). If you add them: a display name, an email address, notification choices, and company details (name, postal address, tax ID) for invoices. To show your ENS or Basename we look your address up through public Ethereum and Base nodes and keep the answer for 24 hours. An activity log records who changed what in the workspace (for example a key created or a plan paid), without IP addresses.
            </P>
            <P>
              <b>API keys and usage.</b> We keep a hash of each key (never the key itself), its prefix and name, and count requests per key: per hour by result and endpoint, per day, and the last 50 requests (time, method, path, status and response time). Anonymous requests are limited per IP address in memory only; we don’t store those IPs.
            </P>
            <P>
              <b>Contact and waitlists.</b> When you write to us through the contact form: your name, email, message, the kind of project and budget you pick. When you join a waitlist: your email and which list.
            </P>
          </S>

          <S n={3} title="Gully Analytics">
            <P>
              Gully Analytics is our own, self-hosted fork of the open-source Umami analytics, at analytics.gullylabs.xyz. We use it on our own sites, and customers can use it on theirs.
            </P>
            <L>
              <li>It sets no cookies. A visit is grouped by a hash of the site, your IP address, your browser and a salt that changes every month, so we can’t follow you from month to month.</li>
              <li>Your IP address is used to work out your country, region and city and is then dropped; it isn’t stored. We also record the page, referrer, browser, operating system, device type, screen size and language.</li>
              <li>On pages where you connect a wallet (the app and payment pages), it records wallet connects and disconnects, chain switches and transactions you send, with the chain and wallet type. By default the wallet address is stored only as a short hash (the first 16 characters of its SHA-256). That is pseudonymous, not anonymous: anyone who knows your address can compute the same hash.</li>
              <li>To opt out in a browser, set the local storage value umami.disabled to 1 for the site.</li>
            </L>
            <P>
              If you sign up for Gully Analytics, we also keep your wallet address, your sites, your plan and trial dates, and monthly event counts. Your Umami password is never stored by us.
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
              <b>Bot records.</b> For every chat that uses the bot we keep when it was first and last seen, its language, whether it is linked to a wallet, whether it follows the News channel, whether it has blocked the bot or switched announcements off, and how it found the bot. No names and no message text are kept in these records.
            </P>
            <P>
              <b>Announcements.</b> The bot sometimes sends news to chats chosen by those records (for example, linked chats, chats with alerts, followers of the News channel, a language, or chats active recently). For each announcement we keep, per recipient chat, whether it was delivered (with Telegram’s message id or error). Its buttons go through a link made for that recipient, so when you open one we record that this recipient opened it, once; we don’t record when, your IP address or your browser. Our operators see delivery and opens with chat ids shortened to their last 4 digits. Every announcement has a 🔕 Stop announcements button, and Settings switches them off and on again; that never affects your alerts.
            </P>
            <P>The Mini App checks Telegram’s signed launch data to know who you are and stores nothing: no cookie and no session.</P>
          </S>

          <S n={6} title="Gully Security">
            <P>
              <b>Scans.</b> When your workspace runs an AI Security Scan we keep a record of it: the workspace, the wallet that started it, when, what was scanned (a contract address and chain, a GitHub repository and commit, or an uploaded file’s name and size), its price or invoice and its status. To run the scan we store the code on our server: the file you upload, the full text of the source files fetched from the chain’s explorer or GitHub or unpacked from your upload, the tools’ output, the AI’s findings and the report. For a web2 scan, files named <code className="font-mono text-[.9em]">.env</code> are stored with the rest of the code but are never sent to the AI or the scanning tools. Please don’t upload secrets.
            </P>
            <P>
              <b>Who sees it.</b> Members of your workspace see its scans and reports; developers, admins and owners can start and cancel them. Gully Labs operators can see the list of scans (who started one, the target and its status). To review the code, the files in scope are sent to Anthropic (Claude) after common secret patterns (API keys, private-key blocks and similar) are replaced; that check works by pattern and can miss a secret. When our static-tools worker runs (it does not yet), it receives the code too, on our own servers. The contract address and chain are sent to Etherscan, Blockscout or Sourcify to fetch verified source, the repository and commit to GitHub, and for web2 scans the dependency list in package-lock.json to the npm registry.
            </P>
            <P>
              <b>Publishing.</b> A workspace owner or admin can publish a finished report. It then becomes public: the target, the findings, file paths with their hashes, and any code comments the scan flagged as attempts to instruct the AI; draft proof-of-concept code and the workspace are left out. Search engines are asked not to index it unless the publisher allows it. Published reports count towards that contract’s Gully Score. Unpublishing takes the report off the site at once; the copy stays on our server, not shown.
            </P>
            <P>
              <b>Security Review requests.</b> When you ask for a quote we keep what you send (name, email, project, scope, repository, contract, company, timeline) and the signed-in wallet if there is one. The request also goes to our enquiries inbox and to our operators’ Telegram chat. Requests are limited per IP address and email in memory only; the IP is not stored.
            </P>
            <P>
              <b>Monitors.</b> For each contract your workspace watches we keep the contract, chain and name, your alert thresholds, your webhook address and its signing secret, whether Telegram is on, whether the contract may be listed publicly, the contract’s last read state, its last 100 events and the last 50 alert deliveries. The contract is read through public blockchain nodes. Events a monitor sees are public chain data. A monitor whose listing is on adds them to that contract’s public Gully Score. With listing off, nothing the monitor records reaches the public: not the contract’s score, the public list of scores, the sitemap, score badges or Gully AI; a score already worked out from it is dropped and worked out again without it.
            </P>
          </S>

          <S n={7} title="Holder Map and Gully Score">
            <P>
              <b>Holder Map.</b> Looking up a map needs no account. To show the maps opened most today we count one view per visitor per token per day, using a hash of the IP address made with a random key that is held in memory only and replaced every day; the counts are reset each UTC day. New maps are limited per IP address for a minute, in memory only. To build a map we send the token’s address (never anything about you) to DeepCore, Blockscout, Moralis, Solana nodes and public blockchain nodes. Holder alerts are kept like other alerts, until you delete them.
            </P>
            <P>
              <b>Gully Score.</b> Looking up a score needs no account and we don’t record who looked. We keep each contract’s latest score and its history. The contract address is sent to Sourcify, Etherscan and public blockchain nodes to read its evidence. Lookups are limited per IP address in memory only.
            </P>
          </S>

          <S n={8} title="Gully Pay and public chains">
            <P>
              Payments happen on public blockchains. A transaction, the addresses in it and the amount are public and permanent, and nobody (us included) can change or delete them. We never hold your funds.
            </P>
            <P>
              When you pay us or a Gully Pay store, we record the transaction hash, chain, asset, amount, its US dollar value at the time, the paying address and the block, to confirm and receipt the payment. A store’s owner sees its own payments, and its webhook sends the payment, including the paying address, to the address the store sets. A store can put a customer name and email on an invoice; the store decides that, and is responsible for it. We count how often an invoice page is opened, without storing who opened it.
            </P>
            <P>
              For a store we keep its name, logo (copied once from the address given, never hot-linked), accent colour, support email, website, receiving wallets, which version of the merchant terms it accepted and with which wallet, its invoices, links, fees and statements.
            </P>
          </S>

          <S n={9} title="Cookies and browser storage">
            <L>
              <li>
                <b>One cookie of ours:</b> the app’s sign-in cookie (__Host-gl_dev), only after you sign in. It is HttpOnly, sent only to the app over HTTPS, and lasts 30 days or until you sign out.
              </li>
              <li>
                <b>No advertising or cross-site tracking cookies</b>, and Gully Analytics uses none.
              </li>
              <li>
                <b>Browser storage</b> remembers choices on your device only: the app’s sidebar, invites you declined, that you accepted the swap risk notice, recent Gully AI questions in the app, and requests you already sent (Chain Kit, devnet waitlist).
              </li>
              <li>The blog (Ghost) runs on our server and handles its own visitors; its member sign-up is switched off.</li>
            </L>
          </S>

          <S n={10} title="Who else sees data">
            <P>We don’t sell personal data or share it for advertising. These services see some of it because they carry or power what you use:</P>
            <L>
              <li>
                <b>Cloudflare</b> carries all traffic to our sites, so it sees your IP address and requests, and tells our server your country. Its Web Analytics beacon runs on our pages.
              </li>
              <li>
                <b>Anthropic</b> and, when switched on, <b>Voyage AI</b>: Gully AI questions, as above. Anthropic also reviews the code of Gully Security scans.
              </li>
              <li>
                <b>Etherscan, Blockscout, Sourcify, GitHub and the npm registry</b>: the contract, repository or dependency list a Gully Security scan or a Gully Score reads, as above.
              </li>
              <li>
                <b>DeepCore, Blockscout and Moralis</b>: token addresses for the Holder Map, as above.
              </li>
              <li>
                <b>Telegram</b>: everything you send to or receive from the bot.
              </li>
              <li>
                <b>Blockchain node providers</b> (public RPC endpoints): we read transactions, balances and ENS names through them, which can include your address. Your wallet talks to its own nodes.
              </li>
              <li>
                <b>Wallet and swap services you choose to use</b>: WalletConnect when you connect a wallet that way, LI.FI in the swap widget, and Jupiter for Solana swaps (it receives your public key).
              </li>
              <li>
                <b>Addresses you give us</b>: alert and store webhooks are sent to the URLs you set.
              </li>
            </L>
            <P>We may disclose data when the law requires it, to protect our users or services from fraud or abuse, or to a buyer if Gully Labs is sold, under this policy.</P>
          </S>

          <S n={11} title="How long we keep it">
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-left text-[14px]">
                <caption className="sr-only">Retention periods</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] tracking-[1px] text-faint">
                    <th scope="col" className="px-4 py-3 font-normal">DATA</th>
                    <th scope="col" className="px-4 py-3 font-normal">KEPT FOR</th>
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

          <S n={12} title="Security">
            <P>
              We store hashes instead of secrets wherever we can (session ids, API keys, invite and link codes, IP addresses in the Gully AI log and the Holder Map counts), use HTTPS everywhere, and back the data up every night to the same server, keeping 7 days. No system is perfectly secure; if a breach affects your data, we will tell you as the law requires.
            </P>
          </S>

          <S n={13} title="Your choices">
            <L>
              <li>Sign out, or revoke any session, in the app’s Settings.</li>
              <li>Revoke API keys, delete alerts, remove webhooks and switch off pay links in the app.</li>
              <li>Unlink Telegram with /stop or in the bot’s settings, and switch announcements off with 🔕 Stop announcements or in Settings.</li>
              <li>Delete a monitor, or unpublish a scan report, in the app; ask us to delete a scan’s code before the 180 days are up.</li>
              <li>Opt out of Gully Analytics as described above, or use a browser that blocks scripts.</li>
              <li>
                Ask us at <a href="mailto:team@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">team@gullylabs.xyz</a> to see, correct, export or delete what we hold about you off-chain. The app doesn’t have a self-service “delete my account” button yet, so email us and we will do it. We may keep payment records where the law requires, and we can’t delete anything that is on a public blockchain.
              </li>
            </L>
            <P>Depending on where you live, you may also have the right to object to or restrict how we use your data, and to complain to your data protection authority.</P>
            <P>Our services are not meant for anyone under 18.</P>
          </S>

          <S n={14} title="Changes and contact">
            <P>
              When we change this policy we update the version date at the top, and for a material change we say so on the site. Our server and our providers may process data in countries other than yours. Questions, requests or complaints: <a href="mailto:team@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">team@gullylabs.xyz</a>.
            </P>
          </S>

          <footer className="flex flex-col gap-3 border-t border-line pt-6 font-mono text-[12px] leading-[1.7] text-faint">
            <p className="m-0">
              Adapted from the{' '}
              <a href={BASECAMP_URL} target="_blank" rel="noopener noreferrer" className="text-dim underline underline-offset-4 hover:text-gold">
                Basecamp open-source policies
              </a>{' '}
              by 37signals LLC, used under{' '}
              <a href={CC_URL} target="_blank" rel="noopener noreferrer license" className="text-dim underline underline-offset-4 hover:text-gold">
                CC BY 4.0
              </a>
              . Changes made: rewritten for Gully Labs’ own products (wallet sign-in, workspaces, API usage, Gully Analytics, Gully AI, Gully Security, the Holder Map, the Telegram bot and Gully Pay on public blockchains); retention periods replaced with the ones our code enforces; Basecamp-specific products, staff-access and law-enforcement sections shortened. 37signals does not endorse this policy. This policy is also available under CC BY 4.0.
            </p>
            <p className="m-0">
              <Link to="/legal/merchant-terms" className="hover:text-gold">
                Gully Pay merchant terms
              </Link>{' '}
              ·{' '}
              <a href="https://docs.gullylabs.xyz/analytics" target="_blank" rel="noopener noreferrer" className={ext}>
                Gully Analytics docs
              </a>{' '}
              ·{' '}
              <Link to="/" className="hover:text-gold">
                gullylabs.xyz
              </Link>
            </p>
          </footer>
        </div>
      </article>
    </>
  )
}
