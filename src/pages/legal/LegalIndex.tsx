import { ArrowUpRight, FileText, Lock } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { PRODUCTS, type LogoDef, type Slug } from '../../terminal/catalog'
import { LEGAL, Mail, To } from './kit'

/* gullylabs.xyz/legal: every Gully product's Terms and Privacy Policy in one place (owner, 2026-11-03), each with its
   kit logo (src/terminal/catalog.ts, files byte-identical to the kits) and one line on what it is. The addresses are
   the canonical URL map of the legal pages brief; server/seo.mjs LEGAL_INDEX_LINKS restates them for the pre-render. */

interface Entry {
  key: string
  name: string
  logo: LogoDef
  line: string
  terms: string
  privacy: string
  extra?: [string, string][]
}

const LABS: LogoDef = { kind: 'mark', mark: 'labs', label: 'Gully Labs' }
const logoOf = (slug: Slug) => PRODUCTS.find((p) => p.slug === slug)?.logo ?? LABS

export const LEGAL_INDEX: Entry[] = [
  {
    key: 'labs',
    name: 'Gully Labs',
    logo: LABS,
    line: 'The hub: the Gully Labs App, the API, the stock token tracker, Gully Score, Gully Analytics and the Telegram bot.',
    terms: '/terms',
    privacy: '/privacy',
    extra: [
      ['Merchant terms (stores in the app)', '/legal/merchant-terms'],
      ['Security scan terms (scans in the app)', '/legal/scan-terms'],
    ],
  },
  { key: 'holdermaps', name: 'HolderMaps', logo: logoOf('holders'), line: 'Holder bubble maps for any token, with linked wallets, launch health and the paid Deep check.', terms: 'https://holdermaps.xyz/terms', privacy: 'https://holdermaps.xyz/privacy' },
  { key: 'chain', name: 'Gully Chain', logo: logoOf('chain'), line: 'Our own chain and its builder surfaces: gullychain.xyz, the docs, explorer, bridge, faucet and Safe.', terms: 'https://gullychain.xyz/terms', privacy: 'https://gullychain.xyz/privacy' },
  {
    key: 'kre8',
    name: 'kre8.fun',
    logo: logoOf('street'),
    line: 'The creator app on Gully Chain: launch a coin, post, go live and get paid by your fans.',
    terms: 'https://kre8.fun/terms',
    privacy: 'https://kre8.fun/privacy',
    extra: [
      ['Content Policy', 'https://kre8.fun/content-policy'],
      ['Copyright', 'https://kre8.fun/copyright'],
    ],
  },
  { key: 'pay', name: 'Gully Pay', logo: logoOf('pay'), line: 'The payment gateway for every Gully product: x402, checkout and merchant tools. Its merchant terms are part of its Terms.', terms: 'https://gullypay.xyz/terms', privacy: 'https://gullypay.xyz/privacy' },
  { key: 'id', name: 'Gully ID', logo: logoOf('gully-id'), line: 'One sign-in for every Gully product, with a passkey, a wallet or email.', terms: 'https://gullyid.xyz/terms', privacy: 'https://gullyid.xyz/privacy' },
  { key: 'rpc', name: 'Gully RPC', logo: logoOf('rpc'), line: 'The RPC gateway and node platform that serves Gully Chain and other networks. Acceptable use is part of its Terms.', terms: 'https://gullyrpc.xyz/terms', privacy: 'https://gullyrpc.xyz/privacy' },
  { key: 'ai', name: 'Gully AI', logo: logoOf('ai'), line: 'The Gully assistant: answers from our docs and live data, with its sources.', terms: 'https://gullyai.xyz/terms', privacy: 'https://gullyai.xyz/privacy' },
  { key: 'security', name: 'Gully Security', logo: logoOf('security'), line: 'Automated security scans and contract monitoring. Its scan terms are part of its Terms.', terms: 'https://gullysecurity.xyz/terms', privacy: 'https://gullysecurity.xyz/privacy' },
  { key: 'studio', name: 'Gully Studio', logo: logoOf('studio'), line: 'Gully Labs’ game studio.', terms: 'https://gullystudio.xyz/terms', privacy: 'https://gullystudio.xyz/privacy' },
]

/** A product's kit logo at a fixed height (official files, never redrawn). */
function KitLogo({ def, name }: { def: LogoDef; name: string }) {
  if (def.kind === 'mark') {
    const h = 24
    return (
      <span className="inline-flex h-8 items-center gap-2 text-[17px] font-semibold text-ink" aria-hidden>
        {def.mark === 'chain' ? (
          <img src="/brand/web/logos/gc-icon.svg" width={h} height={h} alt="" decoding="async" loading="lazy" draggable={false} />
        ) : (
          <img src="/brand/kit/mark-reversed.svg" width={Math.round(h * 1.042)} height={h} alt="" decoding="async" loading="lazy" draggable={false} />
        )}
        {def.label}
      </span>
    )
  }
  const h = Math.min(28, Math.round(def.display * 0.8))
  const w = Math.round((h * def.w) / def.h)
  const img = <img src={def.src} width={w} height={h} alt={name} decoding="async" loading="lazy" draggable={false} style={{ width: w, maxWidth: '100%', height: 'auto' }} />
  return (
    <span className="inline-flex h-8 items-center">
      {def.webp ? (
        <picture>
          <source srcSet={def.webp} type="image/webp" />
          {img}
        </picture>
      ) : (
        img
      )}
    </span>
  )
}

const pill = 'inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-[14px] font-medium text-ink transition-colors hover:border-gold-line hover:text-gold focus-visible:border-gold-line'

export function LegalIndexPage() {
  return (
    <>
      <Seo page="/legal" />
      <article className="relative px-page pt-[56px] pb-24 max-[600px]:pt-8" data-legal-page data-testid="legal-index">
        <div className="mx-auto flex max-w-[960px] flex-col gap-8">
          <header className="flex max-w-[70ch] flex-col gap-4" style={{ animation: 'gl-rise .5s ease both' }}>
            <span className="font-mono text-[12px] tracking-[1.5px] text-gold uppercase">Legal</span>
            <h1 className="m-0 font-display text-[clamp(38px,6.5vw,64px)] leading-[.95] font-extrabold text-ink uppercase">Terms and Privacy</h1>
            <p className="m-0 font-mono text-[13px] text-muted">
              Last updated <time dateTime={LEGAL.updatedIso}>{LEGAL.updated}</time>
            </p>
            <p className="m-0 text-[17px] leading-[1.7] text-ink-2 max-[600px]:text-[16px]">
              Every Gully product is run by {LEGAL.entity}, based in {LEGAL.place}. Each one has its own Terms of Service and Privacy Policy, written for what that product actually does. Here they all are. Questions about any of them: <Mail />.
            </p>
          </header>

          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 min-[768px]:grid-cols-2" aria-label="Gully products">
            {LEGAL_INDEX.map((e, i) => (
              <li key={e.key} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5" style={{ animation: `gl-rise .5s ${(0.05 + i * 0.04).toFixed(2)}s cubic-bezier(.2,.8,.2,1) both` }} data-legal-product={e.key}>
                <h2 className="m-0">
                  <span className="sr-only">{e.name}</span>
                  <KitLogo def={e.logo} name={e.name} />
                </h2>
                <p className="m-0 text-[15px] leading-[1.6] text-ink-2">{e.line}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <To href={e.terms} className={pill}>
                    <FileText size={15} aria-hidden className="text-gold" />
                    {e.name} Terms of Service
                    {/^https?:/.test(e.terms) && <ArrowUpRight size={13} aria-hidden className="text-muted" />}
                  </To>
                  <To href={e.privacy} className={pill}>
                    <Lock size={15} aria-hidden className="text-gold" />
                    {e.name} Privacy Policy
                    {/^https?:/.test(e.privacy) && <ArrowUpRight size={13} aria-hidden className="text-muted" />}
                  </To>
                  {e.extra?.map(([label, href]) => (
                    <To key={href} href={href} className={pill}>
                      {label}
                      {/^https?:/.test(href) && <ArrowUpRight size={13} aria-hidden className="text-muted" />}
                    </To>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <p className="m-0 max-w-[70ch] text-[13px] leading-[1.7] text-muted">
            Most of these pages are adapted from the Basecamp open-source policies (CC BY 4.0), and the merchant terms from Common Paper’s standard terms (CC BY 4.0); each page names its source at its foot and is available under the same licence. Our code keeps its own licences.
          </p>
        </div>
      </article>
    </>
  )
}
