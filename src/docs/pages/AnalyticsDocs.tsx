import { useEffect, useState } from 'react'
import type { Offer } from '../../pages/developers/api'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { apiOrigin } from '../nav'

const sections = [
  { id: 'start', title: 'Sign up' },
  { id: 'install', title: 'Install the tracker' },
  { id: 'web3', title: 'Web3 events' },
  { id: 'privacy', title: 'Privacy modes' },
  { id: 'plans', title: 'Plans and limits' },
  { id: 'dashboard', title: 'Dashboard and API' },
]

const INSTALL = `<script
  defer
  src="https://analytics.gullylabs.xyz/script.js"
  data-website-id="YOUR-WEBSITE-ID"
  data-web3="true"
></script>`

const PRIVACY = `<script defer src="https://analytics.gullylabs.xyz/script.js"
  data-website-id="YOUR-WEBSITE-ID" data-web3="true" data-web3-address="none"></script>`

const MANUAL = `// e.g. from a backend-relayed or account-abstraction flow
umami.track('tx-sent', { hash, chainId: 8453, to, address })`

const REFUSED = `// The answer to a tracker call that is not recorded (HTTP 402)
{
  "error": { "message": "…", "code": "gully-quota-exceeded", "status": 402 },
  "disabled": true
}`

function useOffer() {
  const [offer, setOffer] = useState<Offer | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    fetch(`${apiOrigin()}/api/plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (o: Offer) => alive && setOffer(o),
        () => alive && setOffer('error'),
      )
    return () => {
      alive = false
    }
  }, [])
  return offer
}

export function AnalyticsDocs() {
  const offer = useOffer()
  const a = offer && offer !== 'error' ? offer.analytics : null
  return (
    <DocPage
      slug="analytics"
      eyebrow="PRODUCTS · GULLY ANALYTICS"
      title="Gully Analytics"
      description="Gully Analytics: sign up with a wallet, install the tracker, Web3 events, address privacy modes, plans and what happens at the quota or when a plan lapses."
      lead="Privacy-friendly web analytics with Web3 tracking for dapps: page views plus wallet connects, chain switches and transactions. It is a fork of Umami; everything Umami does still works."
      sections={sections}
    >
      <Section id="start" title="Sign up">
        <List>
          <li>
            Open the <Ext href="https://app.gullylabs.xyz/#analytics">developer portal</Ext>, connect a wallet and sign the sign-in message (no transaction, no gas).
          </li>
          <li>
            In the <b>Analytics</b> tab press <b>Start free trial</b>. The server creates a Gully Analytics login for your wallet and shows its password once; copy it. We do not keep the password. <b>Reset password</b> in the same tab sets a new one and signs out open sessions.
          </li>
          <li>Add a website with its name and domain. The tab shows its website id, the install snippet, a link to its dashboard and the events counted this month.</li>
        </List>
        <Callout label="ONE TRIAL PER WALLET">The free trial runs once per wallet. After it, choose a plan in the same tab to keep recording.</Callout>
      </Section>

      <Section id="install" title="Install the tracker">
        <P>Put the snippet on every page, before the closing head tag. The Analytics tab gives it with your website id filled in.</P>
        <CodeBlock lang="html" code={INSTALL} />
        <P>
          Without <C>data-web3="true"</C> the script behaves exactly like the Umami tracker. The usual Umami attributes (<C>data-domains</C>, <C>data-do-not-track</C>, <C>data-tag</C>, <C>data-before-send</C>, …) still apply, and Web3 events respect them.
        </P>
      </Section>

      <Section id="web3" title="Web3 events">
        <P>
          The script finds wallets through EIP-6963 and <C>window.ethereum</C> and watches what your dapp asks of them. It never calls a wallet method itself, so it cannot trigger a wallet prompt. All four events are standard custom events with event data, so they also show under Events, Goals, Funnels and filters.
        </P>
        <Fields
          head={['Event', 'Event data', 'When']}
          rows={[
            ['wallet-connect', <>An <C>eth_requestAccounts</C> call resolves with an account not already reported on this page, or the user switches account in the wallet. Silent reconnects on page load are not counted.</>, 'address, chainId, wallet'],
            ['wallet-disconnect', <>The wallet reports no accounts after a connect.</>, 'wallet'],
            ['chain-switch', <>A <C>wallet_switchEthereumChain</C> call succeeds, or the wallet moves away from a known chain.</>, 'chainId'],
            ['tx-sent', <><C>eth_sendTransaction</C> or <C>eth_sendRawTransaction</C> returns a hash.</>, 'hash, chainId, to, address'],
          ].map(([e, w, d]) => [e as string, d as string, w])}
        />
        <P>
          <C>chainId</C> is a decimal number; <C>wallet</C> is the wallet’s EIP-6963 id (<C>io.metamask</C>, <C>io.rabby</C>, …) or its name. You can send these events yourself too, and the Web3 dashboard reads them the same:
        </P>
        <CodeBlock lang="js" code={MANUAL} />
      </Section>

      <Section id="privacy" title="Privacy modes">
        <P>
          <C>data-web3-address</C> decides what is stored about the wallet address:
        </P>
        <Fields
          head={['Value', 'Unique wallets', 'Stored as']}
          rows={[
            ['hash (default)', 'counted', 'The first 16 hex characters of the SHA-256 of the lowercase address. Wallets can be counted; the address cannot be read back.'],
            ['full', 'counted', 'The lowercase address.'],
            ['none', 'not counted', 'Nothing. Unique wallets and transactions per wallet show 0 or a dash.'],
          ]}
        />
        <CodeBlock lang="html" code={PRIVACY} />
        <P>Hashing needs a secure context (HTTPS or localhost); on plain HTTP the address is dropped rather than sent in clear. A hash of a public address is pseudonymous, not anonymous: anyone with a candidate address can hash it and compare. Use none if that matters for your users.</P>
      </Section>

      <Section id="plans" title="Plans and limits">
        <P>
          The plans below are read live from <C>GET /api/plans</C> (field <C>analytics</C>), the same source the <Ext href="https://gullylabs.xyz/pricing#analytics">pricing page</Ext> and the dashboard use.
        </P>
        {offer === null && <P>Reading the plans…</P>}
        {offer === 'error' && <Callout label="UNAVAILABLE">The plans could not be read just now. They are always on the pricing page and at /api/plans.</Callout>}
        {a && offer && offer !== 'error' && (
          <>
            <Fields head={['Plan', 'Price', 'Includes']} rows={a.plans.map((p) => [p.name, p.priceUsdc ? `${p.priceUsdc} USD / ${a.periodDays} days` : `free for ${a.trialDays} days`, `${p.sites} website${p.sites === 1 ? '' : 's'}, ${p.eventsPerMonth.toLocaleString('en-US')} events a month`])} />
            {!offer.checkout.enabled && <Callout label="NOT ON SALE YET">{offer.checkout.reason}</Callout>}
          </>
        )}
        <List>
          <li>An event is any call the tracker makes for one of your websites: page views, custom events and Web3 events. They are counted across your websites per calendar month in UTC.</li>
          <li>At the limit, new events are not recorded until the month turns or you upgrade. The tracker gets an HTTP 402 answer and stops sending for the rest of that page view.</li>
          <li>Websites beyond what your plan includes (after a downgrade, say) do not record until you remove some or upgrade; the oldest ones keep recording.</li>
          <li>
            Paying works like the tracker API plans (see <Ext href="https://docs.gullylabs.xyz/plans-alerts#paying">Paying</Ext>): ETH, BNB, USDC or USDT on Base, Ethereum, BNB Chain or Arbitrum, straight to the treasury, checked on chain. A payment buys {a?.periodDays ?? 30} days; paying again for the same plan adds them to the end. Nothing renews by itself.
          </li>
          <li>When a trial or plan ends, recording stops. Your dashboard stays readable for {a?.graceDays ?? 30} days; after that the account and its data may be deleted.</li>
        </List>
        <CodeBlock lang="json" code={REFUSED} caption="JSON · a refused tracker call" />
      </Section>

      <Section id="dashboard" title="Dashboard and API">
        <P>
          Sign in at <Ext href="https://analytics.gullylabs.xyz/login">analytics.gullylabs.xyz</Ext> with the login from the Analytics tab. Each website has the usual Umami views plus a <b>Web3</b> tab: unique wallets, connects, connect rate, transactions, transactions per wallet, a visit → connect → transaction funnel, chains, wallet apps and the top pages by connects.
        </P>
        <P>
          The Umami REST API works with your own login: sign in with <C>POST /api/auth/login</C> and send the token as <C>Authorization: Bearer …</C>. The Web3 figures are at <C>GET /api/websites/{'{websiteId}'}/web3?startAt=…&amp;endAt=…</C>.
        </P>
        <P>
          The source is public: <Ext href="https://github.com/gully-labs/umami">gully-labs/umami</Ext>, MIT licensed like Umami.
        </P>
      </Section>
    </DocPage>
  )
}
