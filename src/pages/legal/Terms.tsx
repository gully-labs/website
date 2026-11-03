import { Ban, Coins, FlaskConical, KeyRound, LineChart, ScanSearch } from 'lucide-react'
import { Link } from 'react-router'
import { Seo } from '../../components/Seo'
import { Glance, Intro, L, LEGAL, LegalPage, link, Mail, P, S } from './kit'

/* gullylabs.xyz/terms (/legal/terms 301s here): the Terms of Service for everything Gully Labs LLC runs on gullylabs.xyz
   and its service hosts. Structure and plain-language style adapted from the Basecamp open-source policies (CC BY 4.0;
   LICENSES/POLICIES.md), rewritten for these products as the code runs them on 2026-11-03: wallet sign-in and
   workspaces (siwe.mjs, workspaces.mjs), plans paid per 30 days with no renewal (plans.mjs PERIOD_DAYS, billing.mjs),
   the Holder Map Deep check and its re-run credit (holders-deep-routes.mjs), Gully Security scans (security-routes.mjs;
   the scan's own terms at /legal/scan-terms), the swap's blocked countries (geo.mjs SWAP_BLOCKED, named in Section 4 and
   checked by scripts/test-legal.mjs), the testnet-only chain launch (chains-launch.mjs), the Telegram relay
   (telegram-relay.mjs) and the service hosts (hosts.mjs). Prices are never typed here: they live in plans.mjs and are
   shown on /pricing and at checkout. Section ids are s1…s20: Gully AI's index (scripts/build-ask-index.mjs) cites them. */

export const TERMS_VERSION = LEGAL.updatedIso
export const GOVERNING_LAW = LEGAL.law
const SCAN_TERMS = '/legal/scan-terms'
const MERCHANT_TERMS = '/legal/merchant-terms'
export const SECTIONS = [
  'These terms',
  'The services',
  'Account terms',
  'Where the services are offered',
  'Payment, refunds and plan changes',
  'Cancellation and termination',
  'Changes to the services and prices',
  'Uptime, security and privacy',
  'Copyright and content ownership',
  'Features and bugs',
  'API, widgets and badges',
  'Information, not advice',
  'Swaps and third-party protocols',
  'Gully Pay',
  'Security scans and Deep checks',
  'Gully Chains testnet',
  'Telegram',
  'Acceptable use',
  'Liability',
  'Law, notices and contact',
] as const

const GLANCE = [
  { icon: KeyRound, t: 'Your keys, your funds', d: 'We never hold your keys or your money.', s: 3 },
  { icon: Coins, t: 'Final on chain', d: 'Crypto payments cannot be reversed or charged back.', s: 5 },
  { icon: LineChart, t: 'Not advice', d: 'Data and scores are information, not recommendations.', s: 12 },
  { icon: ScanSearch, t: 'Automated, not an audit', d: 'Scans and Deep checks are signals, not verdicts.', s: 15 },
  { icon: FlaskConical, t: 'Testnet has no value', d: 'Testnet chains and tokens can be reset at any time.', s: 16 },
  { icon: Ban, t: 'Fair use', d: 'No abuse, no evading limits, nothing illegal.', s: 18 },
]

export function TermsPage() {
  return (
    <>
      <Seo title="Terms of Service" description="The terms for using Gully Labs: the site, the app, the API and widgets, Gully AI, the Holder Map, Gully Score, Gully Security, Gully Pay checkouts and the Telegram bot. Self-custody, information not advice, final on-chain payments." />
      <LegalPage
        kicker="Legal · Terms"
        title="Terms of Service"
        product="Gully Labs"
        sections={SECTIONS}
        testId="terms-page"
        related={[
          { href: '/privacy', label: 'Privacy Policy' },
          { href: MERCHANT_TERMS, label: 'Gully Pay merchant terms' },
          { href: SCAN_TERMS, label: 'Security scan terms' },
          { href: '/legal', label: 'All Gully legal pages' },
        ]}
        intro={
          <Intro>
            <P>
              Thanks for using Gully Labs. These Terms of Service (“<b>terms</b>”) are an agreement between Gully Labs LLC, a company based in Oregon, USA (“<b>Gully Labs</b>”, “<b>we</b>”, “<b>us</b>”), and you, the person or business using our sites and services. By using them, connecting a wallet to them or paying for one of them, you agree to these terms. If you don’t agree, please don’t use the services.
            </P>
            <P>
              We wrote them in plain words on purpose. If something is unclear, write to <Mail /> and we will explain it.
            </P>
          </Intro>
        }
        glance={<Glance label="The terms at a glance" items={GLANCE} />}
      >
        <S n={1} title="These terms">
          <P>
            These terms cover every service Gully Labs runs on gullylabs.xyz and its hosts. Some services have their own terms too, and those win where they are more specific: the{' '}
            <Link to={MERCHANT_TERMS} className={link}>
              Gully Pay merchant terms
            </Link>{' '}
            for businesses that run a store, the{' '}
            <Link to={SCAN_TERMS} className={link}>
              security scan terms
            </Link>{' '}
            for AI Security Scans, and the HolderMaps terms at holdermaps.xyz/terms for HolderMaps. How we handle personal data is in the{' '}
            <Link to="/privacy" className={link}>
              Privacy Policy
            </Link>
            . Other Gully products (Gully Chain, kre8.fun, Gully Pay, Gully ID, Gully RPC, Gully AI, Gully Security and Gully Studio) have their own terms, all listed on{' '}
            <Link to="/legal" className={link}>
              gullylabs.xyz/legal
            </Link>
            .
          </P>
          <P>If you use the services for a company, you agree to these terms for it and confirm you may do so; “you” then means the company too.</P>
        </S>

        <S n={2} title="The services">
          <P>“<b>Services</b>” means everything Gully Labs runs here, today:</P>
          <L>
            <li>the sites gullylabs.xyz, docs.gullylabs.xyz and blog.gullylabs.xyz, the stock token tracker and its stock pages, Gully AI, the Holder Map and Gully Score;</li>
            <li>the Gully Labs App at app.gullylabs.xyz: wallet sign-in, workspaces and teams, API keys, plans, alerts, Gully Analytics (analytics.gullylabs.xyz), Gully Security scans and monitors, and the testnet chain launch;</li>
            <li>the public API at api.gullylabs.xyz, and the widgets, embeds and badges at embed.gullylabs.xyz;</li>
            <li>Gully Labs checkouts, pay links, invoices and receipts at pay.gullylabs.xyz;</li>
            <li>the @GullyLabsBot Telegram bot and its Mini App, and the Gully Labs News channel;</li>
            <li>our SDKs and open-source code, which come with their own licences (Section 9).</li>
          </L>
          <P>Some services are marked beta or testnet. They may change, break, lose data or stop without notice.</P>
        </S>

        <S n={3} title="Account terms">
          <L>
            <li>You must be at least 18 years old and able to enter into a binding contract.</li>
            <li>
              <b>Self-custody.</b> You sign in with your own wallet (Sign-In with Ethereum): you sign a message, which sends no transaction and costs no gas. We never receive, generate or store your private keys, seed phrase or funds, and we can never move, freeze or recover your assets. If you lose access to your wallet, we cannot restore it. Never share a seed phrase with anyone, including anyone claiming to be us.
            </li>
            <li>
              <b>Your account and workspace.</b> Your wallet address is your account, and its workspace is created the first time you change something in it. You are responsible for everything done through your account and workspace, by you and by the members you invite, and for their roles. Tell us at <Mail /> at once if you think someone else is using it.
            </li>
            <li>
              <b>API keys and secrets.</b> API keys, webhook signing secrets and similar values are shown once. Keep them private; anything done with your key counts as done by you. Revoke a key in the app if it leaks.
            </li>
            <li>You are responsible for following the laws that apply to you, including tax law, when you use the services.</li>
          </L>
        </S>

        <S n={4} title="Where the services are offered">
          <L>
            <li>
              You may not use the services if you, or anyone you act for, are the target of sanctions (including the lists kept by the US Treasury’s OFAC, the UN, the EU and the UK), or are in a country or region under comprehensive sanctions, such as Cuba, Iran, North Korea, Syria and the occupied regions of Ukraine.
            </li>
            <li>
              The in-page stock token swap is not shown in the United States, Cuba, Iran, North Korea and Syria. We decide this from the country our network provider reports for your connection. The issuers of stock tokens set their own rules about who may hold them.
            </li>
            <li>You must not use a VPN or anything else to get around a restriction based on where you are.</li>
          </L>
        </S>

        <S n={5} title="Payment, refunds and plan changes">
          <P>
            <b>5.1 Prices.</b> Prices for plans, AI Security Scans, Holder Map Deep checks and other paid services are shown on the{' '}
            <Link to="/pricing" className={link}>
              pricing page
            </Link>{' '}
            and at checkout, which is the price you pay.
          </P>
          <P>
            <b>5.2 Paying in crypto.</b> You pay with a wallet, in the asset and on the chain the checkout quotes, straight to the Gully Labs treasury wallet. A payment counts when it meets the checkout’s rules: the exact quoted amount (for a plan paid in a stablecoin from your signed-in wallet, at least the price), in the quoted asset and chain, within the quote’s time, with the chain’s confirmations. Sending a different amount, a different asset, to another address or on another chain may mean the payment cannot be matched.
          </P>
          <P>
            <b>5.3 Plans.</b> A plan runs for 30 days from the payment that confirms, or from the end of the same plan if it is still running. Switching to a different plan starts it the day you pay; days left on the old plan are not carried over. A plan does not renew by itself: nothing is ever taken from your wallet without you sending it.
          </P>
          <P>
            <b>5.4 Final, and refunds.</b> Blockchain payments are final and cannot be charged back. Payments are not refundable, except where these terms, the product’s own terms or the law say otherwise. A paid Holder Map Deep check or AI Security Scan that fails gives you a credit for one free re-run instead of an on-chain refund. If you think you paid by mistake or were charged wrongly, write to <Mail /> and we will look at it in good faith.
          </P>
          <P>
            <b>5.5 Taxes.</b> Prices exclude taxes. You are responsible for any taxes on what you buy, except Gully Labs’ own income taxes.
          </P>
        </S>

        <S n={6} title="Cancellation and termination">
          <P>
            You may stop using the services at any time; a plan simply runs out at the end of its 30 days. To have your account’s off-chain data deleted, write to <Mail /> (the app has no self-service delete button yet).
          </P>
          <P>
            We may suspend or end your access, block an API key, a workspace or a Telegram user, or unpublish content, with or without notice, if you break these terms, if your use puts the services or others at risk, or if the law or a sanctions rule requires it. Where practical we tell you first. Sections 5.4, 9, 12, 15 and 19 to 20 survive the end of these terms.
          </P>
        </S>

        <S n={7} title="Changes to the services and prices">
          <P>
            We may add, change or end any service, temporarily or for good. Where you paid for a period that has not run out and we end that service, write to us and we will make it right in good faith. We may change prices; a change never affects a period you have already paid for, and it is shown on the pricing page and at checkout before you pay.
          </P>
        </S>

        <S n={8} title="Uptime, security and privacy">
          <L>
            <li>We work to keep the services up, but they are provided “as is” and “as available”, with no promise of any level of uptime.</li>
            <li>We use HTTPS everywhere, store hashes instead of secrets where we can, and back our data up every night. The Privacy Policy says what we collect, where it is kept and for how long.</li>
            <li>Your data travels through and is stored by the outside providers listed in the Privacy Policy, such as Cloudflare (network) and OVHcloud (servers).</li>
            <li>Found a security problem? Tell us at <Mail />. Responsible disclosure is welcome and we will not pursue good-faith research that respects users and stops at a proof.</li>
          </L>
        </S>

        <S n={9} title="Copyright and content ownership">
          <P>
            <b>9.1 Your content.</b> You keep your rights in what you upload or send (code for a scan, a store’s logo, messages). You give us the permission we need to host, process and show it to run the services for you, as the Privacy Policy describes, and you confirm you have the rights to give it.
          </P>
          <P>
            <b>9.2 Our rights.</b> The services, the sites’ design and copy, our data compilations, the Gully Labs names and logos and our brand kit belong to Gully Labs. These terms give you the right to use the services, not ownership of them.
          </P>
          <P>
            <b>9.3 Open source.</b> Our SDKs on npm and the code in our public repositories come under the licence in each package or repository, which governs that code instead of these terms. These terms themselves are adapted from Basecamp’s open-source policies and are available under CC BY 4.0.
          </P>
          <P>
            <b>9.4 Feedback.</b> If you send ideas or feedback, we may use them freely without paying you or owing you anything.
          </P>
        </S>

        <S n={10} title="Features and bugs">
          <P>
            We design the services with care, but no software is perfect. They can have bugs, and a figure, map, score or answer can be wrong. We don’t promise every feature will keep working the same way, and we don’t guarantee the services will meet your needs. If you find a bug, tell us at <Mail /> or with /contact in @GullyLabsBot.
          </P>
        </S>

        <S n={11} title="API, widgets and badges">
          <L>
            <li>
              <b>Limits.</b> The API, widgets and badges are limited per IP address without a key and per key by plan, as the{' '}
              <Link to="/pricing" className={link}>
                pricing page
              </Link>{' '}
              shows. Don’t get around them: no rotating keys, IP addresses or accounts to exceed a limit, and no scraping of the sites beyond what the API offers.
            </li>
            <li>
              <b>Embedding.</b> You may embed our widgets, the Holder Map frame and our badges on your own pages as our docs describe. Keep the “by Gully Labs” attribution and the link back, don’t change what a widget or badge says, and don’t present our data or scores as your own or as our endorsement of your project.
            </li>
            <li>
              <b>Partner webhooks.</b> If you register a launch webhook, you are responsible for the endpoint and for checking each delivery’s signature. Deliveries can be late, repeated or missing.
            </li>
            <li>
              <b>Changes.</b> We may change, version or retire API endpoints. We try to give notice in the docs’ changelog before we break something on purpose.
            </li>
          </L>
        </S>

        <S n={12} title="Information, not advice">
          <P>
            The tracker, the stock pages, the venue figures, the Holder Map, Deep checks, Gully Score, security scans, Gully AI’s answers and every other figure or signal we show are <b>information only</b>. They are not investment, financial, legal or tax advice, and not a recommendation to buy, sell, hold or launch anything.
          </P>
          <L>
            <li>Data comes from blockchains, public nodes, explorers, price feeds, venue APIs and other third parties. It can be late, incomplete or wrong, and a source can stop answering.</li>
            <li>Signals such as linked wallets, wallet labels, snipers, concentration or a low score are measured facts or estimates, not a judgement of anyone’s intent, and they can be wrong.</li>
            <li>Gully AI is an AI system and can be wrong. Check anything important against the sources it cites.</li>
            <li>Crypto assets and tokenised stocks are risky and can lose all their value. Decide for yourself, and get professional advice where you need it.</li>
          </L>
        </S>

        <S n={13} title="Swaps and third-party protocols">
          <P>
            Where we show a swap, it is a window onto third-party protocols (LI.FI routes and, for Solana, Jupiter). Your wallet signs and sends the transaction to those protocols; Gully Labs does not execute, route, hold or settle it, and is not your broker or exchange. Quotes, prices, slippage, fees and outcomes are theirs, and the token issuer’s own terms apply to the token. Read the risk notice before you swap.
          </P>
        </S>

        <S n={14} title="Gully Pay">
          <P>
            Gully Pay is non-custodial: a payer’s wallet pays the merchant’s own wallet directly. If you run a store from the Gully Labs App, the{' '}
            <Link to={MERCHANT_TERMS} className={link}>
              merchant terms
            </Link>{' '}
            apply. If you pay a store, your purchase is with that store, not with Gully Labs: questions about the order, delivery or a refund go to the store, whose support contact is on its checkout. We cannot reverse, refund or hold a payment for either side. Gully Pay’s own product at gullypay.xyz has its own terms there.
          </P>
        </S>

        <S n={15} title="Security scans and Deep checks">
          <L>
            <li>
              <b>Automated, not an audit.</b> An AI Security Scan is an automated review by tools and an AI model. It can miss vulnerabilities and can report problems that are not real. It is not a manual audit and not a guarantee that code is safe. A Security Review by people is a separate service, quoted and agreed separately. The{' '}
              <Link to={SCAN_TERMS} className={link}>
                security scan terms
              </Link>{' '}
              add the details.
            </li>
            <li>
              <b>Only what you may scan.</b> Point a scan only at code you own or have permission to have reviewed, and don’t upload secrets.
            </li>
            <li>
              <b>Deep checks.</b> A Holder Map Deep check is a bounded, automated investigation of one token’s holders from public chain data. It works within fixed limits, says what it could not read, and can end partial. Its findings carry a confidence and a source; they are signals, not verdicts about any person.
            </li>
            <li>
              <b>Results can’t be bought.</b> Paying for a scan or a check buys the work, never a better result, score or report.
            </li>
            <li>
              <b>Publishing.</b> A report you publish, or a Deep check link you share, can be read by anyone with it. You are responsible for what you choose to publish.
            </li>
          </L>
        </S>

        <S n={16} title="Gully Chains testnet">
          <P>
            The chain launch flow in the app deploys only to a testnet (its parent chain is Arbitrum Sepolia), signed by your own wallet; we record the chain’s addresses and configuration, never a key. Testnet chains, tokens and balances have <b>no monetary value</b>, can be reset, paused or removed at any time, and must not be sold or promised as having value. A mainnet chain or any hosted service needs a separate written agreement and price. The software these chains run (such as Arbitrum Nitro) comes under its own licences.
          </P>
        </S>

        <S n={17} title="Telegram">
          <P>
            The @GullyLabsBot bot, its Mini App and the Gully Labs News channel run on Telegram, so Telegram’s own terms apply too. Using the bot requires following the News channel. Announcements can be switched off with 🔕 Stop announcements or in the bot’s settings. Messages you send through the bot’s contact relay (/contact) go to the Gully Labs team’s Telegram chat; be respectful, and don’t send secrets. We may stop relaying for anyone who abuses it.
          </P>
        </S>

        <S n={18} title="Acceptable use">
          <P>You will not, and will not help anyone else to:</P>
          <L>
            <li>use the services for anything illegal, for fraud, market manipulation, phishing or scams, or to launder money or hide where funds come from;</li>
            <li>break, probe, overload or get around the security, rate limits, quotas, payments or access controls of the services, or access accounts or data that are not yours (responsible disclosure to <Mail /> is welcome);</li>
            <li>run automated traffic that degrades the services for others, or resell or offer the services to others as your own, except as the API and embed terms allow;</li>
            <li>upload malware or code you have no right to share, or try to make Gully AI or a scan reveal secrets or act against its instructions;</li>
            <li>harass, threaten or impersonate anyone, including Gully Labs or its team;</li>
            <li>use our names, logos or badges in a way that suggests we endorse you when we don’t.</li>
          </L>
        </S>

        <S n={19} title="Liability">
          <P>
            <b>19.1 No warranties.</b> The services are provided “as is” and “as available”. Blockchains can fork, congest, reorganise or fail; tokens can be frozen or changed by their issuers; smart contracts can have bugs. <b>To the maximum extent the law allows, we disclaim all warranties and conditions, express or implied, including merchantability, fitness for a particular purpose, title and non-infringement.</b>
          </P>
          <P>
            <b>19.2 Cap.</b> To the maximum extent the law allows, Gully Labs’ total liability for all claims arising out of or relating to the services or these terms is limited to the greater of the amount you paid Gully Labs for the service concerned in the 12 months before the claim, and 100 US dollars.
          </P>
          <P>
            <b>19.3 Excluded damages.</b> We are not liable for lost profits, revenue, data, goodwill or trading opportunities, or for indirect, consequential, special, exemplary or punitive damages, even if told they were possible. We are not liable for losses from your trading or investment decisions, from transactions you sign, from funds sent to a wrong address, from a third-party protocol, token or chain, or from lost wallet keys.
          </P>
          <P>
            <b>19.4 Indemnity.</b> You will defend and indemnify Gully Labs against claims by others, and the resulting losses, costs and reasonable legal fees, arising from your breach of these terms, your misuse of the services, content you upload or publish, or your violation of law or of someone else’s rights.
          </P>
          <P>
            <b>19.5 Where the law says otherwise.</b> Nothing in these terms limits liability that the law does not allow to be limited, such as for fraud, or rights you have as a consumer that cannot be waived.
          </P>
        </S>

        <S n={20} title="Law, notices and contact">
          <L>
            <li>
              <b>Changes to these terms.</b> We may update these terms. The “Last updated” date at the top changes, and for a material change we say so on the site or in the app before it takes effect. Using the services after that means you accept the new version.
            </li>
            <li>
              <b>Governing law.</b> These terms are governed by the laws of the State of Oregon, USA, without regard to its conflict-of-laws rules. Any dispute goes to the state and federal courts located in Oregon, and you and we agree to their jurisdiction, except where consumer law gives you the right to bring a claim where you live.
            </li>
            <li>
              <b>Whole agreement.</b> These terms, with the product terms and policies they name, are the whole agreement between us about the services. If a part is invalid, the rest stays in force; not enforcing a part is not a waiver of it. You may not transfer these terms without our consent; we may transfer them with the business they relate to.
            </li>
            <li>
              <b>Contact.</b> Questions, notices and requests: Gully Labs LLC, Oregon, USA, <Mail />, or /contact in @GullyLabsBot.
            </li>
          </L>
        </S>
      </LegalPage>
    </>
  )
}
