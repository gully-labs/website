import { AlertTriangle, Loader2, Wallet } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Wordmark } from '../../components/brand'
import { SITE_URL } from '../../site-host'
import { api, ROLE_REFUSED, SESSION_ENDED, type Account, type Me, type WorkspaceRef } from './api'
import { ExtLink } from './ExtLink'
import { toastError, toastInfo, toastSuccess } from '../../components/ui/toast'
import { Dashboard } from './Dashboard'
import { InviteLanding } from './Invite'
import { APP_DESCRIPTION, APP_TITLE, inviteTokenFromHash, PortalContext, restoreFocusSoon, type Portal } from './portal'
import { mono, pillGold, pillLine } from './styles'
import { BadgeFooterRow } from '../../components/PoweredByBadge'
import { GullyIdButton, gullyIdAccessToken, gullyIdRedirectToken, isGullyIdReturn } from './gullyId'
import { PublicOverview } from './PublicOverview'

/* The Gully Labs App, the app dashboard (app.gullylabs.xyz; /app and /developers on localhost). Signed out: the public
   Overview (PublicOverview.tsx: live status and charts of the services Gully Labs runs, no account data; owner
   2026-11-09, public by default) beside one sign-in card with "Sign in with Gully ID" and "Connect wallet". Wallet sign-in is Sign-In with Ethereum: the
   wallet signs a message (no transaction, no gas) and the server sets an HttpOnly session cookie. Gully ID signs in
   on gullyid.xyz in a popup and the account is the Gully ID's wallet (gullyId.ts, server/gully-id.mjs). The wallet libraries
   load only when that button is pressed; the signed-in dashboard itself never needs them. */

const loadWallet = () => import('./WalletSignIn')
const WalletSignIn = lazy(loadWallet)

type Session = { state: 'loading' } | { state: 'out'; gullyId?: boolean } | { state: 'blocked'; message: string } | { state: 'error'; message: string } | { state: 'in'; account: Account; me: Me | null }

/** The workspace's account (/account) and who is signed in (/me, portal v2) together. */
async function readSession(): Promise<Session> {
  // Signed out: stop here, so /account and /me never answer 401 into the console.
  const probe = await api<{ signedIn: boolean; gullyId?: { enabled: boolean } }>('/api/developer/session')
  // GULLY_ID_SIGNIN=off on the server hides the Gully ID option (the flag is in the session probe).
  if (probe.ok && !probe.data.signedIn) return { state: 'out', gullyId: probe.data.gullyId?.enabled !== false }
  return Promise.all([api<Account>('/api/developer/account'), api<Me>('/api/developer/me')]).then(([r, m]) => {
    if (r.ok) return { state: 'in', account: r.data, me: m.ok ? m.data : null }
    if (r.status === 401) return { state: 'out' }
    if (r.status === 403) return { state: 'blocked', message: r.error }
    return { state: 'error', message: r.error }
  })
}

/** The sign-in card: Gully ID first, a wallet under it. It sits beside the public Overview (SignedOutHome). */
function SignedOut({ connect, busy, gully, gullyBusy, gullyOn = true }: { connect: () => void; busy: boolean; gully: () => void; gullyBusy: boolean; gullyOn?: boolean }) {
  const link = 'inline-flex min-h-11 items-center text-muted underline underline-offset-2 hover:text-gold'
  return (
    <section className="flex justify-center" data-testid="signed-out" aria-label="Sign in">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-3 rounded-card border border-line bg-surface p-6">
        <Wordmark height={28} />
        <img src="/brand/kit/owl/owl-thumbs-up-400.webp" alt="" width={46} height={120} decoding="async" className="block h-[120px] w-auto" />
        <h1 className="m-0 text-[22px] leading-[1.2] font-bold text-ink">Sign in</h1>
        {gullyOn && <GullyIdButton onClick={gully} busy={gullyBusy} disabled={busy} />}
        {gullyOn && gullyBusy && (
          <p className="m-0 text-center font-mono text-[12px] text-faint" role="status">
            Waiting for Gully ID…
          </p>
        )}
        <button type="button" onClick={connect} disabled={busy} data-focus-fallback data-testid="connect-wallet" className={`${gullyOn ? pillLine : pillGold} min-h-11 w-full text-[15px] disabled:opacity-70`}>
          {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Wallet size={18} aria-hidden />}
          {busy ? 'Opening wallets…' : 'Connect wallet'}
        </button>
        <p className="m-0 text-center text-[12px] leading-[1.4] text-faint" data-testid="signin-terms">
          By continuing you agree to the{' '}
          <ExtLink href={`${SITE_URL}/terms`} arrow={false} className={link}>
            Terms
          </ExtLink>{' '}
          and{' '}
          <ExtLink href={`${SITE_URL}/privacy`} arrow={false} className={link}>
            Privacy Policy
          </ExtLink>
          .
        </p>
      </div>
    </section>
  )
}

export function DevelopersPage() {
  const [session, setSession] = useState<Session>({ state: 'loading' })
  const [wallet, setWallet] = useState({ mounted: false, trigger: 0, signedOut: 0 })
  const [busy, setBusy] = useState(false)
  // Busy from the first render when this load is Gully ID's redirect back (finished in the effect below).
  const [gullyBusy, setGullyBusy] = useState(() => isGullyIdReturn(window.location.search))
  const [error, setError] = useState<string | null>(null)

  // Sign-in errors are toasts: the card stays the same size.
  useEffect(() => {
    if (error) toastError('Could not sign in', { detail: error, id: 'sign-in' })
  }, [error])
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

  // Sign in with Gully ID: the token from gullyid.xyz is exchanged once for our own session cookie.
  const gullyExchange = useCallback(
    async (token: string) => {
      const r = await api<{ address: string }>('/api/developer/gully', { method: 'POST', body: { accessToken: token } })
      if (!r.ok) return setError(r.error)
      setError(null)
      await loadAccount()
      restoreFocusSoon()
    },
    [loadAccount],
  )
  const gully = async () => {
    setError(null)
    setGullyBusy(true)
    try {
      await gullyExchange(await gullyIdAccessToken())
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Gully ID sign-in failed. Try again.')
    } finally {
      setGullyBusy(false)
    }
  }
  // A blocked popup makes the SDK fall back to a full-page redirect: finish it when Gully ID sends the browser back.
  useEffect(() => {
    if (!isGullyIdReturn(window.location.search)) return
    gullyIdRedirectToken()
      .then((t) => (t ? gullyExchange(t) : undefined))
      .catch((e) => setError(e instanceof Error && e.message ? e.message : 'Gully ID sign-in failed. Try again.'))
      .finally(() => setGullyBusy(false))
  }, [gullyExchange])

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
    <div className={session.state === 'in' ? 'contents' : 'flex min-h-[calc(100dvh-1px)] flex-col'}>
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
          <section className="mx-auto grid w-full max-w-[1200px] flex-1 gap-6 px-4 py-6 max-[480px]:px-3 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="signed-out-home" aria-label="Gully Labs App, signed out">
            <div className="order-first lg:order-last lg:sticky lg:top-6 lg:self-start">
              <SignedOut connect={connect} busy={busy} gully={gully} gullyBusy={gullyBusy} gullyOn={session.gullyId !== false} />
            </div>
            <PublicOverview />
          </section>
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
    </div>
  )
}
