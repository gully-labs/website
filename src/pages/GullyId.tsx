import { ArrowUpRight, KeyRound, ShieldCheck } from 'lucide-react'
import { Seo } from '../components/Seo'
import { btnOutline, eyebrow, h2 } from '../components/ui'
import { newTab } from '../components/LayoutNav'
import { PRODUCT_BRANDS } from '../data/productBrands.ts'

/* /gully-id: the official statement, from the established gullylabs.xyz domain, that gullyid.xyz is Gully Labs' own
   sign-in service (Safe Browsing review, 2026-10-31). gullyid.xyz/about links back here. The logo is the Gully ID
   brand kit v1 lockup file, byte-identical (public/brand/gullyid/gullyid-lockup-on-dark.svg), never typed. */

export const GULLY_ID_HOME = 'https://gullyid.xyz'

const PAGES: [string, string][] = [
  ['About Gully ID', `${GULLY_ID_HOME}/about`],
  ['Security', `${GULLY_ID_HOME}/security`],
  ['Privacy', `${GULLY_ID_HOME}/privacy`],
  ['Terms', `${GULLY_ID_HOME}/terms`],
  ['security.txt', `${GULLY_ID_HOME}/.well-known/security.txt`],
  ['For developers', `${GULLY_ID_HOME}/developers`],
]

const USED_BY: [string, string][] = [
  ['Gully Labs app', 'https://app.gullylabs.xyz/'],
  ['Gully Chain', 'https://gullychain.xyz/'],
  ['kre8.fun', 'https://kre8.fun/'],
  ['Gully Pay', 'https://gullypay.xyz/'],
  ['Gully RPC', 'https://gullyrpc.xyz/'],
  ['Gully Security', 'https://gullysecurity.xyz/'],
  ['Gully AI', 'https://gullyai.xyz/'],
  ['Gully Studio', 'https://gullystudio.xyz/'],
]

/** Sign-in options on gullyid.xyz today (GET /v1/auth/methods, 2026-11-25): social options open as their keys are set. */
const METHODS: [string, boolean][] = [
  ['Email code', true],
  ['Wallet', true],
  ['Sign in with Solana', true],
  ['Passkey', true],
  ['Google', false],
  ['Apple', false],
  ['X', false],
  ['Telegram', false],
]

const card = 'flex flex-col gap-3 rounded-card border border-line bg-surface p-6'
const extLink = 'inline-flex min-h-11 items-center gap-1 text-[14px] text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:text-gold'

export function GullyId() {
  return (
    <div className="flex flex-col gap-12 px-page pt-[72px] pb-24">
      <Seo page="/gully-id" />
      <section className="grid items-start gap-8 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]">
        <div className="flex max-w-[760px] flex-col gap-5">
        <span className={eyebrow}>GULLY LABS · SIGN-IN SERVICE</span>
        <img src={PRODUCT_BRANDS.id.logo!.src} width={176} height={52} alt="Gully ID" className="h-[52px] w-auto self-start" />
        <h1 className="m-0 font-display text-h1 font-extrabold">
          Gully ID is <span className="text-gold">our</span> sign-in service
        </h1>
        <p className="m-0 text-[17px] leading-[1.6] text-dim">
          Gully ID runs at <b className="font-mono text-ink">gullyid.xyz</b>. It is built and operated by Gully Labs, the company behind this site. Every Gully product sends you
          there to sign in with an email code, a wallet, Sign in with Solana or a passkey, then brings you back. It is the only official Gully ID address.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={GULLY_ID_HOME} {...newTab} className={`${btnOutline} inline-flex min-h-11 items-center gap-1 px-5 text-[14px]`}>
            Open gullyid.xyz
            <ArrowUpRight aria-hidden size={16} />
          </a>
        </div>
        </div>
        {/* The hero's second column (design round 4): the sign-in options as they stand, and where Gully ID is used. */}
        <aside className={card} aria-label="Sign-in options">
          <span className={eyebrow}>SIGN IN WITH</span>
          <ul className="m-0 grid list-none gap-0 p-0">
            {METHODS.map(([name, live]) => (
              <li key={name} className="flex min-h-11 items-center justify-between gap-3 border-b border-line last:border-b-0">
                <span className="text-[15px] text-ink">{name}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${live ? 'border-gold text-ink' : 'border-line-strong text-dim'}`}>{live ? 'Live' : 'Coming soon'}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[13px] leading-[1.5] text-dim">Money actions always ask for your passkey or wallet. No phone-number sign-in.</p>
        </aside>
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
        <div className={card}>
          <KeyRound aria-hidden size={22} className="text-gold" />
          <h2 className={h2}>What it does</h2>
          <p className="m-0 text-[15px] leading-[1.6] text-dim">
            One sign-in for every Gully app over standard OpenID Connect. Passkeys first (Face ID, a fingerprint or a security key), so there is no password to steal.
            Each app only gets what you approve. Your Gully Wallet is a smart account on Gully Chain controlled by your passkey; Gully Labs never holds a key that can
            move your funds.
          </p>
        </div>
        <div className={card}>
          <ShieldCheck aria-hidden size={22} className="text-gold" />
          <h2 className={h2}>How to recognise it</h2>
          <p className="m-0 text-[15px] leading-[1.6] text-dim">
            <b className="text-ink">Gully ID never asks for your seed phrase, recovery phrase or private key.</b> Anyone who does is not Gully ID. Sign in only when the
            address bar shows <span className="font-mono text-ink">gullyid.xyz</span>. Report a fake site or a vulnerability to{' '}
            <a href="mailto:team@gullylabs.xyz" className="text-ink underline underline-offset-4 hover:text-gold">
              team@gullylabs.xyz
            </a>
            .
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={h2}>Products that sign in with Gully ID</h2>
        <ul className="m-0 flex list-none flex-wrap gap-x-6 p-0">
          {USED_BY.map(([name, href]) => (
            <li key={name}>
              <a href={href} {...newTab} className={extLink}>
                {name}
                <ArrowUpRight aria-hidden size={13} />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={h2}>Gully ID pages</h2>
        <ul className="m-0 flex list-none flex-wrap gap-x-6 p-0">
          {PAGES.map(([name, href]) => (
            <li key={name}>
              <a href={href} {...newTab} className={extLink}>
                {name}
                <ArrowUpRight aria-hidden size={13} />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
