import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Seo } from '../../components/Seo'
import { eyebrow } from '../../components/ui'
import { FeeCurve } from '../../docs/pages/GullyPayMerchantsDocs'

/* /legal/merchant-terms: the Gully Pay merchant terms, adapted from the Common Paper Cloud Service
   Agreement Standard Terms Version 2.1 (CC BY 4.0; attribution and the list of changes at the foot of the
   page, as the licence requires). The fee rate and free allowance are read live from GET /api/pay/m/config,
   the same values the server charges; nothing numeric about fees is typed here.
   MERCHANT_TERMS_VERSION must match server/merchants.mjs, which records which version a store accepted. */

export const MERCHANT_TERMS_VERSION = '2026-10-17'
const CP_URL = 'https://commonpaper.com/standards/cloud-service-agreement/2.1/'
const CC_URL = 'https://creativecommons.org/licenses/by/4.0/'

interface Config {
  feePct: number
  freeUsd: number
  minStatementUsd: number
  pauseAfterDays: number
}

function useConfig() {
  const [cfg, setCfg] = useState<Config | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/pay/m/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setCfg(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return cfg
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 })

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

/** Renders an HTML comment into the page (visible to anyone reading the source, never on screen). */
function HtmlComment({ text }: { text: string }) {
  return <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: `<!-- ${text.replace(/--/g, '—')} -->` }} />
}

export function MerchantTermsPage() {
  const cfg = useConfig()
  const rate = cfg ? `${cfg.feePct}%` : 'the rate shown in your portal'
  const free = cfg ? money(cfg.freeUsd) : 'the free allowance shown in your portal'
  const days = cfg?.pauseAfterDays ?? 7
  return (
    <>
      <Seo title="Gully Pay merchant terms" description="The terms for businesses that take crypto payments with Gully Pay: non-custodial, a fee per payment only, weekly fee statements, and what happens when a statement is unpaid." />
      <HtmlComment text="Draft: review by counsel before relying on it." />
      <article className="relative px-page pt-[64px] pb-24 max-[600px]:pt-10">
        <div className="mx-auto flex max-w-[820px] flex-col gap-10">
          <header className="flex flex-col gap-4" style={{ animation: 'gl-rise .5s ease both' }}>
            <span className={eyebrow}>LEGAL · GULLY PAY</span>
            <h1 className="m-0 font-display text-[clamp(40px,7vw,72px)] leading-[.92] font-extrabold uppercase">Merchant terms</h1>
            <p className="m-0 font-mono text-[12px] text-faint">Version {MERCHANT_TERMS_VERSION}</p>
            <P>
              These terms are an agreement between Gully Labs (“<b>Gully Labs</b>”, “we”) and the business that runs a store with Gully Pay (“<b>Merchant</b>”, “you”). You accept them when you tick “I agree” in the Merchant tab of the Gully Labs App, which records the version and the wallet that accepted.
            </P>
            <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
              {['The service', 'Accounts and wallets', 'Restrictions', 'Customer payments', 'Fees and taxes', 'Suspension', 'Webhooks and API', 'Term and termination', 'Disclaimer', 'Liability', 'Indemnity', 'General'].map((t, i) => (
                <a key={t} href={`#s${i + 1}`} className="inline-flex min-h-11 items-center text-dim hover:text-gold">
                  {i + 1}. {t}
                </a>
              ))}
            </nav>
          </header>

          <S n={1} title="The service">
            <P>
              <b>1.1 Access and use.</b> While these terms are in force, you may use Gully Pay (the hosted checkout, pay links, invoices, the payments dashboard, webhooks and the related APIs and documentation, together the “<b>Service</b>”) to take payments for your own business.
            </P>
            <P>
              <b>1.2 Non-custodial.</b> Payments go directly to your wallet. Gully Labs never holds your funds: each payment is a transfer from your customer’s wallet to the receiving wallet you set, in your customer’s own transaction. We never have your keys and cannot move, freeze, hold, reverse or refund a payment. The Service shows a checkout, gives a quote and reads the payment back from a public node of the chain.
            </P>
            <P>
              <b>1.3 Ownership.</b> We keep all rights in the Service. You keep all rights in your store’s name, logo and content, and let us show them on your checkouts.
            </P>
          </S>

          <S n={2} title="Accounts and wallets">
            <P>
              <b>2.1 Your workspace.</b> You are responsible for everything done through your workspace and by its members, and for their compliance with these terms. Keep your wallets and sign-in secure, and tell us at <a href="mailto:hello@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">hello@gullylabs.xyz</a> at once if you suspect misuse.
            </P>
            <P>
              <b>2.2 Receiving wallets.</b> You choose the receiving address on each chain and you are responsible for controlling it. We check the address’s checksum and, for a contract wallet, that it is deployed on that chain before the chain can take payments; we cannot check that you hold its keys. A payment sent to the address you set is final.
            </P>
          </S>

          <S n={3} title="Restrictions and prohibited businesses">
            <P>
              <b>3.1</b> You will not, and will not let anyone else: (i) reverse engineer or try to discover the source of the Service, except where the law forbids this restriction; (ii) resell or give others access to the Service apart from your customers paying you; (iii) test the security of, interfere with, overload or get around the limits of the Service; (iv) access accounts or data you are not authorised to access; (v) use the Service for any activity prohibited by law; or (vi) present a payment to an address other than your receiving wallet as a payment to you.
            </P>
            <P>
              <b>3.2 Prohibited businesses.</b> You will not use the Service to sell or take payments for: anything illegal where you or your customer is; weapons, explosives or their parts; illegal drugs or drug paraphernalia; gambling, lotteries or betting without the licences the law requires; adult content involving minors or anyone without consent; counterfeit or stolen goods, or goods that infringe others’ rights; investment schemes, securities or financial products offered without the authorisations the law requires; money transmission or exchange services for others; mixers or other services meant to hide the source of funds; anything for or on behalf of a person or country under sanctions; or fraud, deceptive offers, pyramid schemes or ransoms.
            </P>
          </S>

          <S n={4} title="Payments from your customers">
            <L>
              <li>
                <b>Final on chain.</b> Blockchain payments cannot be charged back. There is no card-style dispute process, and we cannot reverse a payment for you or for your customer.
              </li>
              <li>
                <b>Refunds are yours.</b> You decide your refund policy and make any refund from your own wallet. Questions about an order, a delivery or a refund go to you; your checkout shows your support email for this.
              </li>
              <li>
                <b>You are the seller.</b> Your goods and services, prices, receipts, delivery, warranties and any consumer-law duties are yours alone.
              </li>
              <li>
                <b>What counts.</b> A payment counts only when it sends your receiving wallet exactly the quoted amount, in the quoted asset, on the quoted chain, within the quote’s time, with the chain’s confirmations, and its transaction was never used before. A transfer to any other address never counts.
              </li>
            </L>
          </S>

          <S n={5} title="Fees, statements and taxes">
            <P>
              <b>5.1 Fees.</b> You pay a transaction fee only: {rate} of each confirmed payment, at the payment’s quoted value in US dollars. There is no monthly fee and no set-up fee. Your workspace’s first {free} of lifetime payment volume is fee-free; a payment that crosses it pays only on the part above it. Fees are in US dollars, exclude taxes and are not refundable once a statement is paid. We may change the fee or the allowance with at least 30 days’ notice in the Gully Labs App; a change applies only to payments confirmed after it takes effect.
            </P>
            <figure className="m-0 flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <FeeCurve />
            </figure>
            <P>
              <b>5.2 Statements.</b> Every Monday at 00:00 UTC we issue a statement for fees accrued and not yet billed, once they reach {cfg ? money(cfg.minStatementUsd) : 'the minimum shown in your portal'}; smaller amounts roll into the next week. A statement is a Gully Labs invoice, payable in crypto through the Gully Pay checkout, and is due within {days} days of issue. When a customer pays in a stablecoin from a connected wallet, the fee on that payment may instead be deducted at payment time, in the same transaction, through Request Network’s open-source fee contract (ERC20FeeProxy), which sends it straight to Gully Labs; a statement then bills only the fees not collected that way.
            </P>
            <P>
              <b>5.3 Disputes.</b> If you disagree in good faith with a statement, tell us at <a href="mailto:hello@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">hello@gullylabs.xyz</a> before it is due and pay any undisputed part on time. We will work with you to resolve it within 15 days.
            </P>
            <P>
              <b>5.4 Taxes.</b> You are responsible for all taxes on your sales, on the payments you receive and on our fees (including sales, use, VAT, GST and withholding), except for Gully Labs’ own income taxes. We do not collect, report or remit taxes for you.
            </P>
          </S>

          <S n={6} title="Suspension">
            <P>
              <b>6.1 Unpaid statements.</b> If a statement is unpaid {days} days after it is issued, your store’s checkouts pause: payers see that the checkout is paused and no new payment can start. We tell you when the statement is issued, on day five and on day {days}, in your activity log and on Telegram if your workspace linked a chat. Paying the statement resumes checkout at once. Payments already sent to your wallet are not affected.
            </P>
            <P>
              <b>6.2 Other grounds.</b> We may also suspend your store or workspace, with or without notice, if you breach Section 3, use the Service in breach of these terms or in a way that materially harms the Service or others, or if the law or a sanctions rule requires it. We will try to tell you first when practical, and will reinstate access once you resolve the underlying issue.
            </P>
          </S>

          <S n={7} title="Webhooks and API">
            <P>
              Webhooks, the API, the “Pay with crypto” button and the dashboard’s figures are provided as is. A delivery can arrive late, more than once or not at all, and can be redelivered. Verify each delivery’s signature, drop duplicates by event id, and check a payment yourself before acting on something of high value. You are responsible for keeping your signing secret private and for what your systems do with events.
            </P>
          </S>

          <S n={8} title="Term and termination">
            <P>
              <b>8.1</b> These terms start when you accept them and continue until either party ends them. You may stop at any time by removing your receiving wallets. Either party may end these terms if the other fails to cure a material breach within 30 days of notice, and at once on notice if the other materially breaches them in a way that cannot be cured, stops doing business, or becomes insolvent. We may end them at once if you breach Section 3.2.
            </P>
            <P>
              <b>8.2 Effect.</b> On termination your checkouts close and you can no longer use the Service. Fees accrued before termination stay payable and we will issue a final statement. Funds already in your wallet are yours and are not affected. Sections 1.3, 3, 4, 5 (for fees accrued), 8.2 and 9 to 12 survive.
            </P>
          </S>

          <S n={9} title="Disclaimer of warranties">
            <P>
              We make no guarantee that the Service will always be safe, secure or error-free, or that it will work without disruptions, delays or imperfections. Blockchains, their nodes, price feeds, wallets and networks are run by others and can fail, fork, congest, be delayed or give wrong answers; quotes can expire; a token issuer can freeze or change its token. <b>Except as these terms say, we disclaim all other warranties and conditions, express or implied, including merchantability, fitness for a particular purpose, title and non-infringement, to the maximum extent the law allows.</b>
            </P>
          </S>

          <S n={10} title="Limitation of liability">
            <P>
              <b>10.1 Cap.</b> Each party’s total liability for all claims arising out of or relating to these terms will not be more than the fees you paid us in the 12 months before the claim.
            </P>
            <P>
              <b>10.2 Damages waiver.</b> Neither party will be liable to the other for lost profits or revenues, or for consequential, special, indirect, exemplary, punitive or incidental damages relating to these terms, even if told of the possibility in advance. We are not liable for any loss of funds sent on chain, including to a wrong or uncontrolled address.
            </P>
            <P>
              <b>10.3 Applicability and exceptions.</b> These limits apply to all liability, whether in tort (including negligence), contract, breach of statutory duty or otherwise. They do not apply to your obligations under Sections 5 and 11, and nothing here limits liability where the law forbids it.
            </P>
          </S>

          <S n={11} title="Indemnification">
            <P>
              You will indemnify, defend and hold Gully Labs harmless from claims by others, and the resulting damages, settlements, costs and reasonable legal fees, arising from your goods or services, your dealings with your customers (including refunds and taxes), or your breach of Section 3. We will promptly tell you of the claim, give you reasonable help at your expense and let you control its defence; you may not settle in a way that admits fault for us without our written consent.
            </P>
          </S>

          <S n={12} title="General">
            <L>
              <li>
                <b>Entire agreement.</b> These terms are the whole agreement between us about the Service and replace any earlier statements about it.
              </li>
              <li>
                <b>Changes.</b> We may update these terms with at least 30 days’ notice in the Gully Labs App; continuing to use the Service after that accepts the new version. Fee changes follow Section 5.1.
              </li>
              <li>
                <b>Severability and waiver.</b> If a term is invalid, the rest stays in force. Not enforcing a term is not a waiver of it.
              </li>
              <li>
                <b>Assignment.</b> Neither party may assign these terms without the other’s written consent, except on notice in a merger, change of control or sale of the business they relate to.
              </li>
              <li>
                <b>Notices.</b> We send notices in the Gully Labs App, to your workspace’s activity log, and to your linked Telegram chat or email when set. You send notices to <a href="mailto:hello@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">hello@gullylabs.xyz</a>.
              </li>
              <li>
                <b>Force majeure.</b> Neither party is liable for a delay or failure caused by events beyond its reasonable control, including blockchain or network failures; this does not excuse paying fees already due.
              </li>
              <li>
                <b>Independent parties.</b> We are independent contractors, not agents, partners or joint venturers, and there are no third-party beneficiaries.
              </li>
              <li>
                <b>Governing law.</b> These terms are governed by the laws of the place where Gully Labs is established, and its courts have exclusive jurisdiction, unless Gully Labs names others in a notice to you.
              </li>
              <li>
                <b>Interpretation.</b> Headings are for convenience; “including” means “including without limitation”.
              </li>
            </L>
          </S>

          <footer className="flex flex-col gap-3 border-t border-line pt-6 font-mono text-[12px] leading-[1.7] text-faint">
            <p className="m-0">
              Adapted from the{' '}
              <a href={CP_URL} target="_blank" rel="noopener noreferrer" className="text-dim underline underline-offset-4 hover:text-gold">
                Common Paper Cloud Service Agreement Standard Terms Version 2.1
              </a>{' '}
              by Common Paper, Inc., free to use under{' '}
              <a href={CC_URL} target="_blank" rel="noopener noreferrer license" className="text-dim underline underline-offset-4 hover:text-gold">
                CC BY 4.0
              </a>
              . Changes made: shortened and reorganised; adapted to a non-custodial crypto payment service (custody, on-chain finality, refunds, prohibited businesses, fee statements and checkout pauses, webhooks added); subscription, support, confidentiality, machine-learning and government-use clauses removed. Common Paper does not endorse these terms. These merchant terms are also available under CC BY 4.0.
            </p>
            <p className="m-0">
              Questions: <a href="mailto:hello@gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">hello@gullylabs.xyz</a> ·{' '}
              <a href="https://docs.gullylabs.xyz/gully-pay-merchants" target="_blank" rel="noopener noreferrer" className="hover:text-gold">
                Gully Pay for merchants docs
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
