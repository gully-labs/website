import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, P, Section } from '../DocPage'
import { ApiStatusStrip } from '../LiveCharts'
import { useDocHref, type DocSlug } from '../nav'

const sections = [
  { id: 'what-it-is', title: 'What the tracker is' },
  { id: 'live', title: 'Live status' },
  { id: 'start-here', title: 'Start here' },
  { id: 'quick-start', title: 'Quick start' },
  { id: 'products', title: 'Products and more' },
  { id: 'sources', title: 'Where the numbers come from' },
]

const CARDS: { slug: DocSlug; title: string; note: string }[] = [
  { slug: 'methodology', title: 'Tracker methodology', note: 'How fair and onchain prices are read, and when a gap is flagged.' },
  { slug: 'api', title: 'API reference', note: 'Both endpoints, every field, caching, limits and errors.' },
  { slug: 'widget', title: 'Widget guide', note: 'A ticker, a badge or a table on any page, in two lines of HTML.' },
  { slug: 'api-keys', title: 'API keys', note: 'Higher limits for apps that call the API often.' },
]

const PRODUCTS: { slug: DocSlug; title: string; note: string }[] = [
  { slug: 'solana', title: 'Solana', note: 'xStocks in the tracker, Holder Map, Solana Pay and Jupiter swaps.' },
  { slug: 'swaps', title: 'Swaps', note: 'LI.FI on EVM chains, Jupiter on Solana, the region check and fees.' },
  { slug: 'holder-map', title: 'Holder Map', note: 'Who really holds a token, clusters and the launch health score.' },
  { slug: 'gully-ai', title: 'Gully AI', note: 'Answers from our docs and live data, with a source on every fact.' },
  { slug: 'telegram', title: 'Telegram bot', note: '@GullyLabsBot: gaps, launches, alerts with Mute, and the Mini App.' },
  { slug: 'chain-kit', title: 'Chain Kit', note: 'A branded Blockscout explorer for your EVM chain, run for you. Waitlist.' },
  { slug: 'status', title: 'Status', note: 'What each live check means, uptime and incidents.' },
]

function Card({ slug, title, note, i }: { slug: DocSlug; title: string; note: string; i: number }) {
  const href = useDocHref(slug)
  return (
    <Link
      to={href}
      className="group flex min-w-0 flex-col gap-2 rounded-card border border-line bg-card-token p-5 transition-[border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-gold-line"
      style={{ animation: `gl-rise .5s ${0.1 + i * 0.06}s ease both` }}
    >
      <span className="flex items-center justify-between gap-2 font-display text-[22px] font-bold text-ink uppercase">
        {title}
        <ArrowRight size={16} aria-hidden className="text-gold transition-transform group-hover:translate-x-1" />
      </span>
      <span className="text-[14px] leading-[1.55] text-muted">{note}</span>
    </Link>
  )
}

export function Overview() {
  return (
    <DocPage
      slug=""
      eyebrow="GULLY LABS DOCS"
      title="Tokenised stocks, priced two ways"
      description="Docs for Gully Labs: the stock token tracker on Robinhood Chain, BNB Chain and Solana, its public API, the widget and API keys, plus Gully Pay, the Holder Map, Gully AI, the Telegram bot, swaps and status."
      lead={
        <>
          The Gully Labs tracker checks every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, live. These docs cover how it works, the public API it is built on, the widget that puts it on your own page, and the
          products built around it.
        </>
      }
      sections={sections}
    >
      <Section id="what-it-is" title="What the tracker is">
        <P>
          For each stock token the tracker reads two prices: the <strong className="text-ink">fair price</strong>, from the Chainlink feed for that stock, read on chain; and the <strong className="text-ink">onchain price</strong>, what the token trades at in its deepest pool. The difference, as a percentage of fair, is the gap. A token trading above its fair price is at a premium; below it, at a discount.
        </P>
        <P>
          The live page is at <Ext href="https://gullylabs.xyz/tracker">gullylabs.xyz/tracker</Ext>. Everything it shows comes from the same public API these docs describe.
        </P>
        <P>
          It covers three chains: Robinhood Chain (Robinhood’s stock tokens), BNB Chain (Binance bStocks) and Solana (Backed’s xStocks). How Solana differs is on the <DocLink to="solana">Solana</DocLink> page.
        </P>
      </Section>

      <Section id="live" title="Live status">
        <P>The public API as your browser sees it right now, checked every 15 seconds, and the widest gaps the tracker stands behind at this moment.</P>
        <ApiStatusStrip />
      </Section>

      <Section id="start-here" title="Start here">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
          {CARDS.map((c, i) => (
            <Card key={c.slug} {...c} i={i} />
          ))}
        </div>
      </Section>

      <Section id="quick-start" title="Quick start">
        <P>Read the whole tracker as JSON. No key is needed:</P>
        <CodeBlock lang="bash" code={'curl https://api.gullylabs.xyz/api/tracker'} />
        <P>Or put a live ticker on a web page:</P>
        <CodeBlock lang="html" code={'<div data-gully-widget="ticker"></div>\n<script src="https://embed.gullylabs.xyz/widget.js" async></script>'} />
        <P>
          The <DocLink to="api">API reference</DocLink> lists every field; the <DocLink to="widget">widget guide</DocLink> every option. Build a widget visually at <Ext href="https://gullylabs.xyz/widget">gullylabs.xyz/widget</Ext>.
        </P>
      </Section>

      <Section id="products" title="Products and more">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
          {PRODUCTS.map((c, i) => (
            <Card key={c.slug} {...c} i={i} />
          ))}
        </div>
      </Section>

      <Section id="sources" title="Where the numbers come from">
        <P>
          Fair prices are Chainlink feeds read on chain with <C>latestRoundData()</C>; on Solana, where a share has no Chainlink feed, the issuer’s own xStocks quote, and every row names its source. Onchain prices are read from each token’s deepest pool on chain; DexScreener and GeckoTerminal only find the pool. Nothing is estimated or typed in: a price that cannot be read is reported as unreadable, never as zero. The <DocLink to="methodology">methodology</DocLink> gives the exact rules.
        </P>
        <Callout label="NOT ADVICE">The tracker reports what two public sources say. It is not investment advice, and a gap is not a promise that anyone can trade it away.</Callout>
      </Section>
    </DocPage>
  )
}
