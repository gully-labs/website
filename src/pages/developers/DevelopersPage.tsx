import { motion } from 'motion/react'
import { Activity, AlertTriangle, ArrowUpRight, BookOpen, ChartLine, KeyRound, Loader2, ShieldCheck, Wallet, Zap } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Seo } from '../../components/Seo'
import { btnGold, btnOutline, eyebrow } from '../../components/ui'
import { DOCS_URL } from '../../site-host'
import { api, type Account } from './api'
import { Dashboard } from './Dashboard'

/* The developer dashboard (developers.gullylabs.xyz, /developers on localhost). Signed out: what the
   free tier is and a "Connect wallet" button. Signing in is Sign-In with Ethereum: the wallet signs a
   message (no transaction, no gas) and the server sets an HttpOnly session cookie. The wallet libraries
   load only when that button is pressed; the signed-in dashboard itself never needs them. */

const loadWallet = () => import('./WalletSignIn')
const WalletSignIn = lazy(loadWallet)

type Session = { state: 'loading' } | { state: 'out' } | { state: 'blocked'; message: string } | { state: 'error'; message: string } | { state: 'in'; account: Account }

function readSession(): Promise<Session> {
  return api<Account>('/api/developer/account').then((r) => {
    if (r.ok) return { state: 'in', account: r.data }
    if (r.status === 401) return { state: 'out' }
    if (r.status === 403) return { state: 'blocked', message: r.error }
    return { state: 'error', message: r.error }
  })
}

const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.06}s ease both` })

const FEATURES = [
  { icon: Zap, title: 'Keys in seconds', body: 'No form and no waiting for approval. Sign in, name a key, use it. Up to five per wallet.' },
  { icon: ChartLine, title: 'Usage you can read', body: 'Requests per hour or day for each key, error rate and status codes, as they happen.' },
  { icon: Activity, title: 'Request log', body: 'The last fifty calls made with your keys: path, status and latency.' },
  { icon: ShieldCheck, title: 'Wallet sign-in', body: 'Sign-In with Ethereum (EIP-4361). No password or email to leak; keys are stored only as hashes.' },
]

function SignedOut({ connect, busy, error }: { connect: () => void; busy: boolean; error: string | null }) {
  return (
    <>
      <section className="relative overflow-hidden px-page pt-[64px] pb-14">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(232,192,96,.16),transparent_62%)]" />
        <div className="relative grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-12 max-[1023px]:grid-cols-1">
          <div className="flex flex-col gap-6">
            <span className={eyebrow} style={rise(0)}>
              DEVELOPERS · TRACKER API
            </span>
            <h1 className="m-0 font-display text-[clamp(48px,6.4cqw,92px)] leading-[.9] font-extrabold uppercase" style={rise(1)}>
              Build on the <span className="text-gold">fair-price tracker</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[18px] leading-[1.55] text-muted" style={rise(2)}>
              Tokenised-stock prices against their fair value, across chains, as JSON. Free and open without a key. Connect a wallet to create keys instantly, raise your limit tenfold and watch your usage.
            </p>
            <div className="flex flex-wrap items-center gap-3" style={rise(3)}>
              <button type="button" onClick={connect} disabled={busy} className={`${btnGold} inline-flex min-h-[52px] items-center gap-3 px-7 text-[17px] disabled:opacity-70`}>
                {busy ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <Wallet size={19} aria-hidden />}
                {busy ? 'Opening wallets…' : 'Connect wallet'}
              </button>
              <a href={`${DOCS_URL}/api`} className={`${btnOutline} inline-flex min-h-[52px] items-center gap-2 px-6 text-[16px]`}>
                <BookOpen size={17} aria-hidden /> Read the docs
              </a>
            </div>
            {error && (
              <p className="m-0 flex max-w-[620px] items-start gap-2 text-[14px] text-error" role="alert">
                <AlertTriangle size={16} className="mt-[2px] shrink-0" aria-hidden /> {error}
              </p>
            )}
            <p className="m-0 font-mono text-[12px] leading-[1.7] text-faint" style={rise(4)}>
              Signing in signs a message, not a transaction: it is free and moves nothing. Any browser wallet or Coinbase Wallet works.
            </p>
          </div>

          <div className="flex flex-col gap-3" style={rise(3)}>
            {[
              { k: 'NO KEY', v: '60', u: 'requests / min', d: 'Per IP address. Nothing to sign up for: call the API.', tone: 'text-ink' },
              { k: 'FREE KEY', v: '600', u: 'requests / min', d: 'Per key, up to five keys, with usage charts and a request log.', tone: 'text-gold' },
            ].map((t, i) => (
              <motion.div
                key={t.k}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }}
                className={`relative flex items-center gap-6 overflow-hidden rounded-card border bg-surface px-6 py-5 max-[480px]:gap-4 max-[480px]:px-4 ${i ? 'border-gold-line' : 'border-line'}`}
              >
                {i === 1 && <span aria-hidden className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(232,192,96,.08)_50%,transparent_70%)] bg-[length:200%_100%]" />}
                <div className="relative flex min-w-[112px] flex-col max-[480px]:min-w-[92px]">
                  <span className="font-mono text-[11px] tracking-[1.5px] text-faint">{t.k}</span>
                  <span className={`font-display text-[56px] leading-[.95] font-extrabold max-[480px]:text-[44px] ${t.tone}`}>{t.v}</span>
                  <span className="font-mono text-[11px] text-muted">{t.u}</span>
                </div>
                <p className="relative m-0 text-[15px] leading-[1.5] text-muted">{t.d}</p>
              </motion.div>
            ))}
            <pre className="m-0 overflow-x-auto rounded-input border border-line bg-surface-deep px-4 py-3 font-mono text-[12.5px] leading-[1.7] text-ink-2">
              <span className="text-faint">$ </span>curl https://gullylabs.xyz/api/tracker \{'\n'}
              {'    '}-H <span className="text-gold">&quot;Authorization: Bearer gl_live_…&quot;</span>
            </pre>
          </div>
        </div>
      </section>

      <section className="px-page pb-12">
        <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <div key={f.title} className="group flex flex-col gap-3 rounded-card border border-line bg-surface p-6 transition-colors hover:border-line-hover" style={rise(4 + i)}>
                <span className="inline-flex size-10 items-center justify-center rounded-input border border-gold-line bg-[rgba(232,192,96,.07)] text-gold transition-transform group-hover:-translate-y-[2px]">
                  <Icon size={19} aria-hidden />
                </span>
                <h2 className="m-0 font-display text-[22px] leading-none font-bold uppercase">{f.title}</h2>
                <p className="m-0 text-[14px] leading-[1.6] text-muted">{f.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="px-page pb-24">
        <div className="flex flex-col gap-6 rounded-card border border-line bg-surface-deep p-8 max-[600px]:p-5">
          <h2 className="m-0 font-display text-[30px] leading-none font-bold uppercase">How it works</h2>
          <ol className="m-0 grid list-none grid-cols-3 gap-6 p-0 max-[900px]:grid-cols-1">
            {[
              { icon: Wallet, t: 'Connect', d: 'Choose your wallet. Your address is your account: no email, no password.' },
              { icon: ShieldCheck, t: 'Sign', d: 'Sign a one-time message for developers.gullylabs.xyz. It expires in ten minutes and cannot be replayed.' },
              { icon: KeyRound, t: 'Create a key', d: 'Name it and copy it. It works at once; we keep only a hash, so it is shown one time.' },
            ].map((s, i) => {
              const Icon = s.icon
              return (
                <li key={s.t} className="flex gap-4">
                  <span className="font-display text-[44px] leading-[.8] font-extrabold text-gold">{i + 1}</span>
                  <span className="flex flex-col gap-2">
                    <span className="flex items-center gap-2 font-display text-[20px] leading-none font-bold uppercase">
                      <Icon size={17} className="text-gold" aria-hidden /> {s.t}
                    </span>
                    <span className="text-[14px] leading-[1.6] text-muted">{s.d}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-5 font-mono text-[12px] text-faint">
            <a href={`${DOCS_URL}/api-keys`} className="inline-flex items-center gap-1 text-muted hover:text-gold">
              About API keys <ArrowUpRight size={13} aria-hidden />
            </a>
            <a href="/widget" className="inline-flex items-center gap-1 text-muted hover:text-gold">
              No code? Embed the widget <ArrowUpRight size={13} aria-hidden />
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

export function DevelopersPage() {
  const [session, setSession] = useState<Session>({ state: 'loading' })
  const [wallet, setWallet] = useState({ mounted: false, trigger: 0, signedOut: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAccount = useCallback(() => readSession().then(setSession), [])
  useEffect(() => {
    readSession().then(setSession)
  }, [])

  const connect = () => {
    setError(null)
    setBusy(true)
    loadWallet().then(
      () => setWallet((w) => ({ ...w, mounted: true, trigger: w.trigger + 1 })),
      () => {
        setBusy(false)
        setError('The wallet module could not be loaded. Check your connection and try again.')
      },
    )
  }
  // The modal opens once the chunk has mounted; the button stops spinning shortly after.
  useEffect(() => {
    if (!wallet.trigger) return
    const id = setTimeout(() => setBusy(false), 400)
    return () => clearTimeout(id)
  }, [wallet.trigger])

  const signOut = async () => {
    await api('/api/developer/logout', { method: 'POST' })
    setWallet((w) => ({ ...w, signedOut: w.signedOut + 1 }))
    setSession({ state: 'out' })
  }

  return (
    <>
      <Seo title="Developers" description="Free API keys for the Gully Labs tracker API: sign in with your wallet, create keys instantly and see your usage." />
      {session.state === 'loading' && (
        <section className="flex min-h-[50vh] items-center justify-center px-page">
          <span className="inline-flex items-center gap-3 font-mono text-[13px] text-faint">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Checking your session…
          </span>
        </section>
      )}
      {session.state === 'out' && <SignedOut connect={connect} busy={busy} error={error} />}
      {(session.state === 'error' || session.state === 'blocked') && (
        <section className="flex min-h-[50vh] flex-col items-start justify-center gap-4 px-page py-16">
          <span className={eyebrow}>DEVELOPER DASHBOARD</span>
          <p className="m-0 flex max-w-[640px] items-start gap-3 text-[17px] leading-[1.55] text-error" role="alert">
            <AlertTriangle size={20} className="mt-[3px] shrink-0" aria-hidden />
            {session.state === 'blocked' ? session.message : `The dashboard could not be loaded: ${session.message}`}
          </p>
          <div className="flex gap-3">
            {session.state === 'error' && (
              <button type="button" onClick={loadAccount} className={`${btnGold} min-h-11 px-5 text-[15px]`}>
                Try again
              </button>
            )}
            {session.state === 'blocked' && (
              <button type="button" onClick={signOut} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
                Sign out
              </button>
            )}
          </div>
        </section>
      )}
      {session.state === 'in' && <Dashboard account={session.account} reload={loadAccount} onSignOut={signOut} />}
      {wallet.mounted && (
        <Suspense fallback={null}>
          <WalletSignIn
            trigger={wallet.trigger}
            signedOut={wallet.signedOut}
            onSignedIn={() => {
              setError(null)
              loadAccount()
            }}
            onClose={() => setBusy(false)}
            onError={setError}
          />
        </Suspense>
      )}
    </>
  )
}
