import { useEffect, useState } from 'react'
import { DayBars } from '../../components/charts/DayBars'
import { Seo } from '../../components/Seo'
import { btnGold, btnOutline, eyebrow } from '../../components/ui'
import { DOCS_URL } from '../../site-host'

/* The developer dashboard: request an API key, redeem it once approved, and see its usage.
   The key never leaves this browser except to call our API; it is kept in sessionStorage only. */

interface Me {
  project: string
  prefix: string
  limit: number
  createdAt: string
  usage: { requests: number; limited: number; lastUsed: string | null; today: number; days: { day: string; requests: number }[] }
}

const KEY_STORE = 'gully-dev-key'
const CLAIM_STORE = 'gully-dev-claim'
const box = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-7 max-[600px]:p-5'
const input = 'h-11 w-full rounded-input border border-line-strong bg-bg px-3 text-[15px] text-ink outline-none focus:border-gold'
const label = 'flex flex-col gap-2 text-[14px] text-ink-2'
const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.06}s ease both` })

const store = {
  get: (s: Storage, k: string) => {
    try {
      return s.getItem(k)
    } catch {
      return null
    }
  },
  set: (s: Storage, k: string, v: string | null) => {
    try {
      if (v === null) s.removeItem(k)
      else s.setItem(k, v)
    } catch {
      /* private mode */
    }
  },
}

async function post<T>(path: string, body: unknown, key?: string): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body ?? {}) })
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as T }
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true)).then(() => setTimeout(() => setDone(false), 1500))}
      className="shrink-0 rounded-btn border border-line-strong px-3 py-[6px] font-mono text-[12px] text-ink-2 transition-colors hover:border-gold"
      aria-live="polite"
    >
      {done ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function Secret({ label: l, value, warn }: { label: string; value: string; warn?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{l}</span>
      <div className="flex items-center gap-2 rounded-input border border-gold-line bg-bg px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-gold">{value}</code>
        <Copy text={value} />
      </div>
      {warn && <span className="text-[13px] text-muted">{warn}</span>}
    </div>
  )
}

function RequestForm({ onCreated }: { onCreated: (c: { requestId: string; claimCode: string }) => void }) {
  const [f, setF] = useState({ email: '', project: '', url: '', use: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(null)
        try {
          const r = await post<{ requestId: string; claimCode: string; error?: string }>('/api/developer/request', f)
          if (!r.ok) setErr(r.data.error ?? `Request failed (${r.status}).`)
          else onCreated(r.data)
        } catch {
          setErr('The server could not be reached. Try again.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className={label}>
        Email
        <input className={input} type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label className={label}>
        Project name
        <input className={input} required minLength={2} maxLength={80} value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} />
      </label>
      <label className={label}>
        Website <span className="text-faint">(optional)</span>
        <input className={input} type="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </label>
      <label className={label}>
        What you will build
        <textarea className={`${input} h-24 py-2`} required minLength={10} maxLength={1000} value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })} />
      </label>
      {err && <p className="m-0 text-[14px] text-error">{err}</p>}
      <button type="submit" disabled={busy} className={`${btnGold} min-h-11 self-start px-6 text-[15px] disabled:opacity-60`}>
        {busy ? 'Sending…' : 'Request an API key'}
      </button>
    </form>
  )
}

function Claim({ claim, onKey, onForget }: { claim: { requestId: string; claimCode: string }; onKey: (k: string) => void; onForget: () => void }) {
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const check = async () => {
    setErr(null)
    try {
      const r = await post<{ status: string; key?: string; error?: string }>('/api/developer/claim', claim)
      if (!r.ok) return setErr(r.data.error ?? `Check failed (${r.status}).`)
      setStatus(r.data.status)
      if (r.data.key) setKey(r.data.key)
    } catch {
      setErr('The server could not be reached. Try again.')
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Secret label="REQUEST ID" value={claim.requestId} />
      <Secret label="CLAIM CODE" value={claim.claimCode} warn="Shown once. Keep it: it redeems your key after approval. This browser remembers it too." />
      {key ? (
        <>
          <Secret label="YOUR API KEY" value={key} warn="Shown once and stored only as a hash on our side. Copy it now." />
          <button type="button" onClick={() => onKey(key)} className={`${btnGold} min-h-11 self-start px-6 text-[15px]`}>
            Open my dashboard
          </button>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={check} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
            Check status
          </button>
          {status && (
            <span className="font-mono text-[13px] text-muted">
              Status: <b className={status === 'rejected' ? 'text-error' : 'text-gold'}>{status}</b>
              {status === 'pending' && ' · requests are reviewed by hand, usually within a day'}
              {status === 'claimed' && ' · this key was already redeemed; sign in with it below'}
            </span>
          )}
          <button type="button" onClick={onForget} className="bg-transparent p-0 text-[13px] text-faint underline-offset-4 hover:text-ink hover:underline">
            Forget this request
          </button>
        </div>
      )}
      {err && <p className="m-0 text-[14px] text-error">{err}</p>}
    </div>
  )
}

function Dashboard({ apiKey, onSignOut, onRotated }: { apiKey: string; onSignOut: () => void; onRotated: (k: string) => void }) {
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/developer/me', { headers: { authorization: `Bearer ${apiKey}` } })
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => alive && (ok ? setMe(d as Me) : setErr((d as { error?: string }).error ?? 'Sign-in failed.')), () => alive && setErr('The server could not be reached.'))
    return () => {
      alive = false
    }
  }, [apiKey])

  if (err)
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[15px] text-error">{err}</p>
        <button type="button" onClick={onSignOut} className={`${btnOutline} min-h-11 self-start px-5 text-[15px]`}>
          Use another key
        </button>
      </div>
    )
  if (!me) return <p className="m-0 font-mono text-[13px] text-faint">Reading your usage…</p>
  const tiles = [
    { k: 'REQUESTS TODAY', v: me.usage.today.toLocaleString('en-US') },
    { k: 'LAST 30 DAYS', v: me.usage.days.reduce((a, d) => a + d.requests, 0).toLocaleString('en-US') },
    { k: 'LIMIT', v: `${me.limit}/min` },
    { k: 'RATE-LIMITED', v: me.usage.limited.toLocaleString('en-US') },
  ]
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[12px] text-faint">SIGNED IN</span>
          <span className="font-display text-[32px] leading-none font-bold uppercase">{me.project}</span>
          <span className="font-mono text-[12px] text-muted">
            {me.prefix}… · created {new Date(me.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {me.usage.lastUsed && ` · last used ${new Date(me.usage.lastUsed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Rotate this key? The current key stops working immediately.')) return
              const r = await post<{ key?: string; error?: string }>('/api/developer/rotate', {}, apiKey)
              if (r.data.key) {
                setFresh(r.data.key)
                onRotated(r.data.key)
              } else setErr(r.data.error ?? 'Rotation failed.')
            }}
            className={`${btnOutline} min-h-10 px-4 text-[14px]`}
          >
            Rotate key
          </button>
          <button type="button" onClick={onSignOut} className={`${btnOutline} min-h-10 px-4 text-[14px]`}>
            Sign out
          </button>
        </div>
      </div>
      {fresh && <Secret label="NEW API KEY" value={fresh} warn="Shown once. The old key no longer works." />}
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line">
        {tiles.map((t, i) => (
          <div key={t.k} className="flex flex-col gap-1 bg-surface-deep px-5 py-4" style={rise(i)}>
            <dt className="font-mono text-[10px] tracking-[1px] text-faint">{t.k}</dt>
            <dd className="m-0 font-display text-[30px] leading-none font-extrabold">{t.v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[12px] text-faint">Requests per day, last 30 days · requests served from the edge cache are not counted</span>
        <DayBars days={me.usage.days.map((d) => ({ day: d.day, requests: d.requests }))} series={[{ key: 'requests', label: 'Requests', color: '#e8c060' }]} />
      </div>
    </div>
  )
}

export function DevelopersPage() {
  const [apiKey, setApiKey] = useState<string | null>(() => store.get(sessionStorage, KEY_STORE))
  const [claim, setClaim] = useState<{ requestId: string; claimCode: string } | null>(() => {
    const raw = store.get(localStorage, CLAIM_STORE)
    try {
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [signIn, setSignIn] = useState('')
  const rememberKey = (k: string | null) => {
    store.set(sessionStorage, KEY_STORE, k)
    setApiKey(k)
  }

  return (
    <>
      <Seo title="Developers" description="Free access to the Gully Labs tracker API. Request an API key for a higher rate limit and see your usage." />
      <section className="flex flex-col gap-5 px-page pt-[64px] pb-10">
        <span className={eyebrow} style={rise(0)}>
          DEVELOPERS · TRACKER API
        </span>
        <h1 className="m-0 max-w-[900px] font-display text-[clamp(48px,6.4cqw,92px)] leading-[.9] font-extrabold uppercase" style={rise(1)}>
          Build on the <span className="text-gold">fair-price tracker</span>
        </h1>
        <p className="m-0 max-w-[680px] text-[18px] leading-[1.55] text-muted" style={rise(2)}>
          The API is free and open: 60 requests a minute per address, no key needed. A key raises that to 600 and shows your usage here. Read the{' '}
          <a href={`${DOCS_URL}/api`} className="text-gold hover:text-gold-hover">
            API reference
          </a>{' '}
          or drop in the{' '}
          <a href="/widget" className="text-gold hover:text-gold-hover">
            widget
          </a>
          .
        </p>
        <pre className="m-0 max-w-[680px] overflow-x-auto rounded-input border border-line bg-surface-deep px-4 py-3 font-mono text-[13px] text-ink-2" style={rise(3)}>
          <span className="text-faint">$ </span>curl https://gullylabs.xyz/api/tracker
        </pre>
      </section>

      <section className="grid grid-cols-[1fr_1fr] gap-5 px-page pb-24 max-[959px]:grid-cols-1">
        <div className={box} style={rise(2)}>
          {apiKey ? (
            <Dashboard apiKey={apiKey} onSignOut={() => rememberKey(null)} onRotated={(k) => store.set(sessionStorage, KEY_STORE, k)} />
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 font-display text-[28px] font-bold uppercase">Sign in with your key</h2>
                <span className="text-[14px] text-muted">Kept in this tab only and sent only to this site.</span>
              </div>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (signIn.trim()) rememberKey(signIn.trim())
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">API key</span>
                  <input className={input} placeholder="gl_live_…" value={signIn} onChange={(e) => setSignIn(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
                <button type="submit" className={`${btnGold} min-h-11 px-5 text-[15px]`}>
                  Sign in
                </button>
              </form>
              <p className="m-0 font-mono text-[12px] leading-[1.6] text-faint">No key yet? Request one. It is free; requests are reviewed by hand.</p>
            </>
          )}
        </div>

        <div className={box} style={rise(3)}>
          <div className="flex flex-col gap-1">
            <h2 className="m-0 font-display text-[28px] font-bold uppercase">{claim ? 'Your request' : 'Request an API key'}</h2>
            <span className="text-[14px] text-muted">
              {claim ? 'Check back after approval to redeem your key, once.' : 'Tell us who you are and what you will build. You get a claim code straight away.'}
            </span>
          </div>
          {claim ? (
            <Claim
              claim={claim}
              onKey={(k) => {
                rememberKey(k)
                store.set(localStorage, CLAIM_STORE, null)
                setClaim(null)
              }}
              onForget={() => {
                store.set(localStorage, CLAIM_STORE, null)
                setClaim(null)
              }}
            />
          ) : (
            <RequestForm
              onCreated={(c) => {
                store.set(localStorage, CLAIM_STORE, JSON.stringify(c))
                setClaim(c)
              }}
            />
          )}
        </div>
      </section>
    </>
  )
}
