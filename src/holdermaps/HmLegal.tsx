import { Seo } from '../components/Seo'
import { useDeepOffer } from '../lib/holdersDeep'
import { Ext, Intro, L, LegalPage, Mail, P, S, SITE_LEGAL, To } from '../pages/legal/kit'
import { CHAIN_NAMES, PICK_CHAINS } from './insights'

/* holdermaps.xyz/terms and holdermaps.xyz/privacy (2026-11-03): HolderMaps' own Terms of Service and Privacy Policy, in
   the HolderMaps kit (the .hm root re-points the site's tokens; src/holdermaps/hm.css), laid out on the Basecamp
   template (src/pages/legal/kit.tsx; LICENSES/POLICIES.md). Facts from the code: the chains and their data sources
   (server/holders.mjs HOLDER_CHAINS: public RPCs including dRPC, Blockscout, Moralis, Solana RPC, the launchpad log APIs,
   Gully Chain's own nodes), wallet labels (Blockscout's public name tags and our own registry), the Deep check
   (server/plans.mjs HOLDER_DEEP, read live from GET /api/holders/deep: never typed here), its re-run credit and its
   storage (holders-deep-routes.mjs), view counts and per-IP limits (holders-intel.mjs, holders.mjs), the analytics
   script (index.html) and backups (ops/backup.sh). Everything not specific to HolderMaps is in the Gully Labs Terms and
   Privacy Policy on gullylabs.xyz, which these pages name. Section ids s1…sN. */

const CHAINS = PICK_CHAINS.map((k) => CHAIN_NAMES[k])

const RELATED = [
  { href: '/terms', label: 'HolderMaps Terms' },
  { href: '/privacy', label: 'HolderMaps Privacy Policy' },
  { href: SITE_LEGAL.terms, label: 'Gully Labs Terms' },
  { href: SITE_LEGAL.index, label: 'All Gully legal pages' },
]

export const HM_TERMS_SECTIONS = ['These terms', 'What HolderMaps is', 'Using HolderMaps', 'The Deep check', 'Where the data comes from', 'Labels and clusters can be wrong', 'Not financial advice', 'Gully Chain tokens', 'Acceptable use', 'Liability, law and contact'] as const

export function HmTermsPage() {
  const deep = useDeepOffer()
  const offer = deep.k === 'ok' ? deep.data.offer : null
  const price = offer ? `$${offer.priceUsd}` : 'the price shown before you confirm'
  const free = offer ? Math.max(0, ...Object.values(offer.freePerMonth)) : null
  return (
    <>
      <Seo title="Terms of Service" description="The terms for using HolderMaps: free holder bubble maps for any token, the paid Deep check, where the data comes from, why labels can be wrong, and why none of it is financial advice." />
      <LegalPage
        kicker="HolderMaps · Terms"
        title="Terms of Service"
        product="HolderMaps"
        sections={HM_TERMS_SECTIONS}
        related={RELATED}
        testId="hm-terms"
        intro={
          <Intro>
            <P>
              Thanks for using HolderMaps. HolderMaps is a product of Gully Labs LLC, based in Oregon, USA (“<b>Gully Labs</b>”, “<b>we</b>”). These terms cover holdermaps.xyz, its maps, the Deep check, the embed and the widget. By using them you agree to these terms and to the{' '}
              <Ext href={SITE_LEGAL.terms}>Gully Labs Terms of Service</Ext>, which cover everything these terms don’t say. If you don’t agree, please don’t use HolderMaps.
            </P>
          </Intro>
        }
      >
        <S n={1} title="These terms">
          <P>
            Where these terms and the Gully Labs Terms differ, these win for HolderMaps. How we handle data on HolderMaps is in the <To href="/privacy">HolderMaps Privacy Policy</To>. You must be at least 18 years old to use HolderMaps.
          </P>
        </S>

        <S n={2} title="What HolderMaps is">
          <P>
            HolderMaps draws a token’s holders as a bubble map: the biggest wallets, the wallets that trade with each other or share a funder (clusters), how concentrated the supply is, and, for launches we can read from their first block, launch health such as snipers and bundled buys. It covers tokens on {CHAINS.join(', ').replace(/, ([^,]*)$/, ' and $1')}, where a source for that chain is available. Maps are free and need no account.
          </P>
        </S>

        <S n={3} title="Using HolderMaps">
          <L>
            <li>New maps are limited per IP address, and the API, embed and widget follow the limits in the Gully Labs Terms. Don’t get around them or scrape the site beyond what the API offers.</li>
            <li>You may embed a map or the widget on your own pages as the docs describe. Keep the HolderMaps attribution and the link back, and don’t change what a map says.</li>
            <li>A map is a snapshot read from the chain at a moment in time. It is cached for a few minutes and can be out of date by the time you read it.</li>
          </L>
        </S>

        <S n={4} title="The Deep check">
          <L>
            <li>
              A Deep check is a bounded, automated investigation of one token’s holders: where the biggest wallets got their first funds, wallets that share a funder, the deployer’s other tokens, and early buyers. It costs {price} per token
              {free ? `; some Gully Labs plans include up to ${free} free checks a month` : ''}, and the price is always shown before you confirm. Nothing is charged silently.
            </li>
            <li>You pay through a Gully Pay invoice, in crypto, from your own wallet. Blockchain payments are final and cannot be charged back.</li>
            <li>A check works within fixed limits. It says what it could not read and can finish partial. A paid check that fails gives you a credit for one free re-run instead of an on-chain refund. If you think something went wrong, write to <Mail />.</li>
            <li>Paying buys the work, never a better result: nobody can pay to change what a map or a check finds.</li>
            <li>Anyone with a report’s link can read it. You decide who you share it with.</li>
          </L>
        </S>

        <S n={5} title="Where the data comes from">
          <P>
            Every map is built from public blockchain data that we read from third parties: public RPC nodes (including dRPC), Blockscout, Moralis, Solana RPC nodes, the public log APIs of the launchpads we cover, and Gully Chain’s own nodes and indexer. They can be late, incomplete or wrong, and a source can stop answering; when a source fails, the map says so instead of guessing. We don’t control these services.
          </P>
        </S>

        <S n={6} title="Labels and clusters can be wrong">
          <P>
            Wallet labels (exchanges, pools, routers, lockers, burn addresses and the like) come from public name tags and our own lists, and can be missing, out of date or wrong. Clusters are drawn from transfers and shared funders: two wallets in one cluster are linked on chain, which does not prove one person controls them. A label, a cluster or a flag is a signal, not a statement about anyone’s identity or intent. If a label about your address is wrong, tell us at <Mail /> and we will look at it.
          </P>
        </S>

        <S n={7} title="Not financial advice">
          <P>
            HolderMaps shows information only. It is not investment, financial, legal or tax advice, and not a recommendation to buy, sell or hold any token. Crypto assets are risky and can lose all their value. Do your own research and decide for yourself.
          </P>
        </S>

        <S n={8} title="Gully Chain tokens">
          <P>
            HolderMaps supports tokens on Gully Chain, Gully Labs’ own chain. Gully Chain is a testnet today: its tokens and balances have no monetary value, and the chain can be reset. A map of a Gully Chain token is as informational as any other.
          </P>
        </S>

        <S n={9} title="Acceptable use">
          <P>
            Don’t use HolderMaps to harass, threaten or dox anyone, to run scams or market manipulation, or to present a map as proof of wrongdoing by a named person. Don’t overload or attack the service. The acceptable use rules of the Gully Labs Terms apply too.
          </P>
        </S>

        <S n={10} title="Liability, law and contact">
          <P>
            HolderMaps is provided “as is”, with no warranty that a map, label or check is complete or correct. The disclaimers, the cap on liability and the indemnity in the Gully Labs Terms apply to HolderMaps. These terms are governed by the laws of the State of Oregon, USA, and any dispute goes to the state and federal courts located in Oregon, except where consumer law gives you the right to bring a claim where you live.
          </P>
          <P>
            We may update these terms; the “Last updated” date above changes with them. Questions: Gully Labs LLC, Oregon, USA, <Mail />.
          </P>
        </S>
      </LegalPage>
    </>
  )
}

export const HM_PRIVACY_SECTIONS = ['Who we are', 'What we collect', 'Analytics', 'Who else sees data', 'How long we keep it', 'Your rights', 'Changes and questions'] as const

export function HmPrivacyPage() {
  return (
    <>
      <Seo title="Privacy Policy" description="What HolderMaps collects (very little: no account, no cookies), what is sent to the blockchain data providers, how long Deep checks are kept, and your rights." />
      <LegalPage
        kicker="HolderMaps · Privacy"
        title="Privacy Policy"
        product="HolderMaps"
        sections={HM_PRIVACY_SECTIONS}
        related={RELATED}
        testId="hm-privacy"
        intro={
          <Intro>
            <P>
              HolderMaps needs no account and sets no cookies. This policy says what little it collects and why, who else sees it and how long it is kept. HolderMaps is run by Gully Labs LLC, so the <Ext href={SITE_LEGAL.privacy}>Gully Labs Privacy Policy</Ext> covers anything not said here, such as the Gully Labs App you may sign in with.
            </P>
          </Intro>
        }
      >
        <S n={1} title="Who we are">
          <P>
            Gully Labs LLC, based in Oregon, USA (“<b>we</b>”), runs HolderMaps and is responsible for the data it collects. Questions or requests: <Mail />.
          </P>
        </S>

        <S n={2} title="What we collect">
          <L>
            <li>
              <b>Lookups.</b> The tokens you map are public chain data. To show the maps opened most today we count one view per visitor per token per day, using a hash of your IP address made with a random key that is held in memory only and replaced every day; the counts are reset each UTC day. New maps are limited per IP address for a minute, in memory only. We don’t store your IP address.
            </li>
            <li>
              <b>Deep checks.</b> For a check we keep the chain and token, its price, its status, the Gully Pay invoice that paid for it and the report, under an id that is hard to guess. To count free checks, re-run credits and duplicates, a check is tied to your Gully Labs workspace when you are signed in, and otherwise to a shortened SHA-256 hash of your IP address. That hash is not salted, so it is pseudonymous: anyone who knows the address can compute it.
            </li>
            <li>
              <b>Payments.</b> A Deep check is paid on a public blockchain: the transaction, the paying address and the amount are public and permanent. We record them to confirm the payment.
            </li>
            <li>
              <b>Your browser</b> remembers the ids of the last 20 checks you started, on your device only. HolderMaps sets no cookies.
            </li>
          </L>
        </S>

        <S n={3} title="Analytics">
          <P>
            HolderMaps loads Gully Analytics, our own self-hosted fork of the open-source Umami analytics. It sets no cookies; a visit is grouped by a hash of the site, your IP address, your browser and a salt that changes every month, and your IP address is used to work out your country and city, then dropped. It records the page, referrer, browser, device and language. To opt out, set the local storage value umami.disabled to 1 for holdermaps.xyz. The embed and widget frames load no analytics.
          </P>
        </S>

        <S n={4} title="Who else sees data">
          <L>
            <li>
              <b>Cloudflare</b> carries all traffic to holdermaps.xyz, so it sees your IP address and requests.
            </li>
            <li>
              <b>OVHcloud</b> hosts the server HolderMaps and its data run on.
            </li>
            <li>
              <b>Blockchain data providers</b>: to build a map we send the token’s address, never anything about you, to public RPC nodes (including dRPC), Blockscout, Moralis, Solana RPC nodes, launchpad log APIs and Gully Chain’s own nodes.
            </li>
            <li>
              <b>Gully Pay</b>: a paid Deep check is a Gully Pay invoice on pay.gullylabs.xyz, which records the payment as above.
            </li>
          </L>
          <P>We don’t sell personal data or share it for advertising.</P>
        </S>

        <S n={5} title="How long we keep it">
          <L>
            <li>View counts: reset every UTC day; the key that hashes visitors is never written down.</li>
            <li>Per-IP limits: in memory only, for about a minute.</li>
            <li>Deep checks and their reports: a cancelled check is deleted after 30 days; others are not deleted automatically today. Ask us and we delete yours.</li>
            <li>Backups of the server’s data: 7 days, on the same server.</li>
            <li>On-chain payments: permanent, on the public blockchain; nobody can delete them.</li>
          </L>
        </S>

        <S n={6} title="Your rights">
          <P>
            Wherever you live, you can ask us to tell you what we hold about you, give you a copy, correct it or delete it: write to <Mail />. We can’t delete anything that is on a public blockchain. Depending on where you live, you may also complain to your data protection authority. You must be at least 18 years old to use HolderMaps.
          </P>
        </S>

        <S n={7} title="Changes and questions">
          <P>
            We may update this policy; the “Last updated” date above changes with it, and for a material change we say so on the site. Questions, requests or complaints: Gully Labs LLC, Oregon, USA, <Mail />.
          </P>
        </S>
      </LegalPage>
    </>
  )
}
