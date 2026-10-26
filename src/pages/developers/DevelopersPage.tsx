import { AlertTriangle, BookOpen, ChartNoAxesCombined, KeyRound, Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Mascot, Wordmark } from '../../components/brand'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { api, ROLE_REFUSED, SESSION_ENDED, type Account, type Me, type Offer, type WorkspaceRef } from './api'
import { ExtLink } from './ExtLink'
import { toastError, toastInfo, toastSuccess } from '../../components/ui/toast'
import { Dashboard } from './Dashboard'
import { InviteLanding } from './Invite'
import { APP_DESCRIPTION, APP_TITLE, inviteTokenFromHash, PortalContext, restoreFocusSoon, type Portal } from './portal'
import { mono, pillGold, pillLine } from './styles'
import { BadgeFooterRow } from '../../components/PoweredByBadge'

/* The Gully Labs App, the app dashboard (app.gullylabs.xyz; /app and /developers on localhost). Signed out: what the
   free tier is and a "Connect wallet" button. Signing in is Sign-In with Ethereum: the wallet signs a
   message (no transaction, no gas) and the server sets an HttpOnly session cookie. The wallet libraries
   load only when that button is pressed; the signed-in dashboard itself never needs them. */

const loadWallet = () => import('./WalletSignIn')
const WalletSignIn = lazy(loadWallet)

type Session = { state: 'loading' } | { state: 'out' } | { state: 'blocked'; message: string } | { state: 'error'; message: string } | { state: 'in'; account: Account; me: Me | null }

/** The workspace's account (/account) and who is signed in (/me, portal v2) together. */
async function readSession(): Promise<Session> {
  // Signed out: stop here, so /account and /me never answer 401 into the console.
  const probe = await api<{ signedIn: boolean }>('/api/developer/session')
  if (probe.ok && !probe.data.signedIn) return { state: 'out' }
  return Promise.all([api<Account>('/api/developer/account'), api<Me>('/api/developer/me')]).then(([r, m]) => {
    if (r.ok) return { state: 'in', account: r.data, me: m.ok ? m.data : null }
    if (r.status === 401) return { state: 'out' }
    if (r.status === 403) return { state: 'blocked', message: r.error }
    return { state: 'error', message: r.error }
  })
}

type Tiers = { anon: number; free: number; keys: number } | null

/** The public tiers from GET /api/plans, so the sign-in card never states a stale limit. */
function useTiers(): Tiers {
  const [t, setT] = useState<Tiers>(null)
  useEffect(() => {
    let alive = true
    api<Offer>('/api/plans').then((r) => {
      if (!alive || !r.ok) return
      const free = r.data.plans.find((p) => p.id === 'free')
      if (free) setT({ anon: r.data.anonymous.perMin, free: free.perMin, keys: free.maxKeys })
    })
    return () => {
      alive = false
    }
  }, [])
  return t
}

function SignedOut({ connect, busy, error }: { connect: () => void; busy: boolean; error: string | null }) {
  const tiers = useTiers()
  return (
    <section className="relative flex min-h-[calc(100vh-200px)] items-center justify-center overflow-hidden px-4 py-16">
      <div aria-hidden className="pointer-events-none absolute top-[-200px] left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,210,255,.12),transparent_62%)]" />
      <div className="relative flex w-full max-w-[460px] animate-[gl-rise_.5s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-5 rounded-card border border-line bg-surface p-6 shadow-[0_24px_64px_rgba(0,0,0,.35)] max-[480px]:p-5">
        <div className="flex items-center gap-[10px]">
          <Mascot size={24} decorative />
          <Wordmark height={20} />
          <span className="font-semibold text-muted">App</span>
          <span className="ml-auto font-mono text-[11px] tracking-[1px] text-faint">TRACKER API · ANALYTICS</span>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-[34px] leading-[.95] font-bold uppercase">
            Sign in with <span className="text-gold">your wallet</span>
          </h1>
          <p className="m-0 text-[14px] leading-[1.6] text-muted">Your address is your account: no email, no password. Create API keys instantly, set gap alerts, run Gully Analytics and pay for a plan, all from one app.</p>
        </div>
        {tiers ? (
          <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
            <div className="flex flex-col gap-1 bg-surface-deep px-4 py-3">
              <dt className="text-[11px] text-dim">No key</dt>
              <dd className="m-0 font-display text-[28px] leading-none font-bold">
                {tiers.anon.toLocaleString('en-US')}
                <span className="ml-1 font-mono text-[11px] font-normal text-faint">/min per IP</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1 bg-surface-deep px-4 py-3">
              <dt className="text-[11px] text-dim">Free key · up to {tiers.keys}</dt>
              <dd className="m-0 font-display text-[28px] leading-none font-bold text-gold">
                {tiers.free.toLocaleString('en-US')}
                <span className="ml-1 font-mono text-[11px] font-normal text-faint">/min per key</span>
              </dd>
            </div>
          </dl>
        ) : null}
        {window.location.hash === '#analytics' && (
          <p className="m-0 flex items-start gap-3 rounded-[10px] border border-gold-line bg-[rgba(0,210,255,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
            <ChartNoAxesCombined size={18} className="mt-[3px] shrink-0 text-gold" aria-hidden />
            Here for Gully Analytics? Connect your wallet: the Analytics tab of the app starts the free trial.
          </p>
        )}
        <button type="button" onClick={connect} disabled={busy} data-focus-fallback data-testid="connect-wallet" className={`${pillGold} min-h-12 w-full text-[16px] disabled:opacity-70`}>
          {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Wallet size={18} aria-hidden />}
          {busy ? 'Opening wallets…' : 'Connect wallet'}
        </button>
        <p className="m-0 text-[12px] leading-[1.5] text-faint" data-testid="signin-terms">
          By connecting a wallet you agree to the{' '}
          <ExtLink href={`${SITE_URL}/legal/terms`} arrowSize={11} className="inline-flex min-h-11 items-center gap-[2px] text-muted underline underline-offset-2 hover:text-gold">
            Terms of Service
          </ExtLink>{' '}
          and the{' '}
          <ExtLink href={`${SITE_URL}/legal/privacy`} arrowSize={11} className="inline-flex min-h-11 items-center gap-[2px] text-muted underline underline-offset-2 hover:text-gold">
            Privacy policy
          </ExtLink>
          .
        </p>
        {error && (
          <p className="m-0 flex items-start gap-2 text-[14px] text-error" role="alert">
            <AlertTriangle size={16} className="mt-[2px] shrink-0" aria-hidden /> {error}
          </p>
        )}
        <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0 max-[420px]:grid-cols-1">
          {[
            { icon: Wallet, t: 'Connect', d: 'Any browser wallet or Coinbase Wallet.' },
            { icon: ShieldCheck, t: 'Sign', d: 'A message, not a transaction. Free, expires in 10 min.' },
            { icon: KeyRound, t: 'Build', d: 'Keys, alerts and analytics. Keys are shown once and stored hashed.' },
          ].map((s, i) => {
            const Icon = s.icon
            return (
              <li key={s.t} className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className="font-mono text-[11px] text-gold">{i + 1}</span>
                  <Icon size={14} className="text-gold" aria-hidden /> {s.t}
                </span>
                <span className="text-[12px] leading-[1.45] text-dim">{s.d}</span>
              </li>
            )
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <ExtLink href={`${DOCS_URL}/api`} className="inline-flex min-h-11 items-center gap-2 text-[13px] text-muted hover:text-ink">
            <BookOpen size={15} aria-hidden /> Read the docs
          </ExtLink>
          <ExtLink href={isLocalHost() ? '/widget' : `${SITE_URL}/widget`} className="inline-flex min-h-11 items-center gap-1 text-[13px] text-muted hover:text-gold">
            No code? Embed the widget
          </ExtLink>
        </div>
      </div>
    </section>
  )
}

export function DevelopersPage() {
  const [session, setSession] = useState<Session>({ state: 'loading' })
  const [wallet, setWallet] = useState({ mounted: false, trigger: 0, signedOut: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAccount = useCallback(() => readSession().then(setSession), [])
  const [invite, setInvite] = useState(inviteTokenFromHash)
  useEffect(() => {
    const on = () => setInvite(inviteTokenFromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // A write refused for the role (403 forbidden-role): one toast, whichever tab asked.
  useEffect(() => {
    const refused = (e: Event) => toastError("Your role can't do that", { detail: (e as CustomEvent<string>).detail, id: 'forbidden-role' })
    window.addEventListener(ROLE_REFUSED, refused)
    return () => window.removeEventListener(ROLE_REFUSED, refused)
  }, [])
  // A signed-in request answered 401 (the session ended elsewhere): show the sign-in screen, once.
  useEffect(() => {
    const ended = () =>
      setSession((s) => {
        if (s.state !== 'in') return s
        toastInfo('Your session ended', { detail: 'Sign in again with your wallet to continue.', id: 'session-ended' })
        return { state: 'out' }
      })
    window.addEventListener(SESSION_ENDED, ended)
    return () => window.removeEventListener(SESSION_ENDED, ended)
  }, [])
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

  // The app's title and description (signed in, the Dashboard names the page in the title instead).
  useEffect(() => {
    if (session.state !== 'in') document.title = APP_TITLE
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', APP_DESCRIPTION)
  }, [session.state])

  const me = session.state === 'in' ? session.me : null
  // Without /me the role is unknown and every write stays disabled: ask again with backoff (5 s, 10 s … 60 s).
  const signedIn = session.state === 'in'
  useEffect(() => {
    if (!signedIn || me) return
    let alive = true
    let wait = 5_000
    let t = 0
    const again = () => {
      t = window.setTimeout(async () => {
        const r = await api<Me>('/api/developer/me')
        if (!alive) return
        if (r.ok) setSession((s) => (s.state === 'in' ? { ...s, me: r.data } : s))
        else {
          wait = Math.min(wait * 2, 60_000)
          again()
        }
      }, wait)
    }
    again()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [signedIn, me])
  const portal: Portal = useMemo(
    () => ({
      me,
      user: me?.address ?? (session.state === 'in' ? session.account.address : ''),
      role: me?.active.role ?? 'viewer',
      roleKnown: !!me,
      reloadMe: () =>
        api<Me>('/api/developer/me').then((r) => {
          if (r.ok) setSession((s) => (s.state === 'in' ? { ...s, me: r.data } : s))
        }),
      refreshAll: () => readSession().then(setSession),
      switchTo: async (id: string) => {
        const r = await api<{ active: WorkspaceRef }>('/api/developer/workspace/switch', { method: 'POST', body: { id } })
        if (!r.ok) {
          toastError('Could not switch workspace', { detail: r.error })
          return false
        }
        await readSession().then(setSession)
        toastSuccess(`Switched to ${r.data.active.name}`, { detail: `You are ${r.data.active.role} here.`, id: 'workspace-switch' })
        return true
      },
    }),
    [me, session],
  )

  const signOut = async () => {
    await api('/api/developer/logout', { method: 'POST' })
    setWallet((w) => ({ ...w, signedOut: w.signedOut + 1 }))
    setSession({ state: 'out' })
    // The wallet menu that started this is gone: focus lands on Connect wallet.
    restoreFocusSoon()
  }

  return (
    <>
      {session.state === 'loading' && (
        <section className="flex min-h-[50vh] items-center justify-center px-4">
          <span className="inline-flex items-center gap-3 font-mono text-[13px] text-faint">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Checking your session…
          </span>
        </section>
      )}
      {session.state === 'out' &&
        (invite ? (
          <section className="flex min-h-[calc(100vh-200px)] items-center justify-center px-4 py-16">
            <InviteLanding token={invite} signedIn={false} connect={connect} connecting={busy} onDone={() => setInvite(null)} />
          </section>
        ) : (
          <SignedOut connect={connect} busy={busy} error={error} />
        ))}
      {(session.state === 'error' || session.state === 'blocked') && (
        <section className="mx-auto flex min-h-[50vh] w-full max-w-[640px] flex-col items-start justify-center gap-4 px-4 py-16">
          <span className={mono}>APP DASHBOARD</span>
          <p className="m-0 flex max-w-[640px] items-start gap-3 text-[17px] leading-[1.55] text-error" role="alert">
            <AlertTriangle size={20} className="mt-[3px] shrink-0" aria-hidden />
            {session.state === 'blocked' ? session.message : `The dashboard could not be loaded: ${session.message}`}
          </p>
          <div className="flex gap-3">
            {session.state === 'error' && (
              <button type="button" onClick={loadAccount} className={pillGold}>
                Try again
              </button>
            )}
            {session.state === 'blocked' && (
              <button type="button" onClick={signOut} className={pillLine}>
                Sign out
              </button>
            )}
          </div>
        </section>
      )}
      {/* Signed out (and while loading or on an error) the page has no app shell: its own footer row with the badge. */}
      {session.state !== 'in' && (
        <footer className="border-t border-line px-6 py-4 max-[480px]:px-4">
          <BadgeFooterRow />
        </footer>
      )}
      {session.state === 'in' && (
        <PortalContext.Provider value={portal}>
          <Dashboard account={session.account} reload={loadAccount} onSignOut={signOut} />
        </PortalContext.Provider>
      )}

      {wallet.mounted && (
        <Suspense fallback={null}>
          <WalletSignIn
            trigger={wallet.trigger}
            signedOut={wallet.signedOut}
            onSignedIn={() => {
              setError(null)
              loadAccount().then(() => restoreFocusSoon())
            }}
            onClose={() => {
              // The wallet modal was dismissed: focus goes back to Connect wallet (P1-7).
              setBusy(false)
              restoreFocusSoon()
            }}
            onError={setError}
          />
        </Suspense>
      )}
    </>
  )
}
