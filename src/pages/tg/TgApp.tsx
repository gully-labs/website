import { BellRing, ChartNoAxesColumn, Check, Megaphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Mascot, Wordmark } from '../../components/brand'
import { useTracker, type TrackerRow } from '../../lib/tracker'
import { useTgApi } from './hooks'
import { AlertsTab, AnnouncementsSwitch, Button, Chips, GapsTab, HoldersScreen, Notice, StockScreen, type Me } from './screens'
import { haptic, isLight, loadTelegram, themeVars, type ThemeParams, type WebApp } from './sdk'

/* The Gully Labs Telegram Mini App (gullylabs.xyz/tg, its own lazy chunk). Opened from @GullyLabsBot's
   menu button or its "📱 Open app" button. It loads Telegram's WebApp SDK, maps the theme onto the
   site's tokens, signs every API call with the raw initData (server: telegram-miniapp.mjs) and keeps a
   small screen stack: Telegram's BackButton pops it, the MainButton creates alerts on a stock, and taps
   give haptic feedback. Following @GullyLabsNews is required here as in the bot (the join screen). */

type Tab = 'gaps' | 'alerts'
type Screen = { k: 'home' } | { k: 'stock'; chain: string; ticker: string } | { k: 'holders'; chain: string; token: string }

/**
 * The holder screen the app was opened on, if any: the bot's "👥 Holders" button opens /tg?holders=<chain>:<token>;
 * a t.me link can pass start_param h_<chain>_<token>. Anything malformed is ignored.
 */
function holdersStart(wa: WebApp): Screen | null {
  let raw: [string, string] | null = null
  try {
    const q = new URLSearchParams(window.location.search).get('holders')
    const i = q ? q.indexOf(':') : -1
    if (q && i > 0) raw = [q.slice(0, i), q.slice(i + 1)]
  } catch {
    /* no query */
  }
  const sp = wa.initDataUnsafe?.start_param
  const m = !raw && sp ? /^h_([a-z]{2,12})_([A-Za-z0-9]{1,64})$/.exec(sp) : null
  if (m) raw = [m[1], m[2]]
  if (!raw || !/^[a-z]{2,12}$/.test(raw[0]) || !/^[A-Za-z0-9]{1,64}$/.test(raw[1])) return null
  return { k: 'holders', chain: raw[0], token: raw[1] }
}
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'gaps', label: 'Gaps', icon: <ChartNoAxesColumn size={14} aria-hidden /> },
  { id: 'alerts', label: 'My alerts', icon: <BellRing size={14} aria-hidden /> },
]
const BOT_URL = 'https://t.me/GullyLabsBot'

export function TgApp() {
  // undefined while the SDK loads; null when it could not load.
  const [wa, setWa] = useState<WebApp | null | undefined>(undefined)
  const [theme, setTheme] = useState<ThemeParams>({})
  useEffect(() => {
    let alive = true
    loadTelegram().then((w) => {
      if (!alive) return
      if (w) {
        w.ready()
        w.expand()
        setTheme({ ...w.themeParams })
      }
      setWa(w)
    })
    return () => {
      alive = false
    }
  }, [])

  // Theme changes (the user switches Telegram to night mode) re-map the tokens.
  useEffect(() => {
    if (!wa) return
    const on = () => setTheme({ ...wa.themeParams })
    wa.onEvent('themeChanged', on)
    return () => wa.offEvent('themeChanged', on)
  }, [wa])
  const vars = useMemo(() => themeVars(theme), [theme])
  const light = isLight(theme.bg_color)
  useEffect(() => {
    const html = document.documentElement
    const prev = [html.style.background, html.style.colorScheme]
    html.style.background = theme.bg_color ?? ''
    html.style.colorScheme = light ? 'light' : 'dark'
    try {
      if (wa && theme.bg_color && wa.isVersionAtLeast('6.1')) {
        wa.setHeaderColor?.(theme.bg_color)
        wa.setBackgroundColor?.(theme.bg_color)
      }
    } catch {
      /* older clients */
    }
    return () => {
      html.style.background = prev[0]
      html.style.colorScheme = prev[1]
    }
  }, [wa, theme.bg_color, light])

  const initData = wa?.initData ?? ''
  return (
    <div style={vars as React.CSSProperties} className="min-h-[100svh] bg-bg font-sans text-ink">
      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
        {wa === undefined ? <Boot /> : !wa || !initData ? <OutsideTelegram /> : <Signed wa={wa} initData={initData} ink={vars['--color-ink'] ?? '#ffffff'} />}
      </main>
    </div>
  )
}

function Boot() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 pt-2">
      <div className="h-[28px] w-[160px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-full bg-surface" />
      <div className="h-[40px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[12px] bg-surface" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-[62px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[14px] bg-surface" />
      ))}
    </div>
  )
}

function OutsideTelegram() {
  return (
    <div className="flex flex-col gap-4 pt-8">
      <Brand />
      <Notice title="Open this inside Telegram" action={<a href={BOT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-gold px-4 text-[14px] font-semibold text-[var(--tg-btn-text,var(--color-bg))]">Open @GullyLabsBot ↗</a>}>
        This is the Gully Labs Telegram app. Open it from the bot&apos;s menu button, or use the full tracker at{' '}
        <a href="/tracker" className="text-gold underline-offset-4 hover:underline">
          gullylabs.xyz/tracker
        </a>
        .
      </Notice>
    </div>
  )
}

function Brand({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <Mascot size={26} decorative />
        <Wordmark height={22} />
      </span>
      {right}
    </header>
  )
}

function Signed({ wa, initData, ink }: { wa: WebApp; initData: string; ink: string }) {
  const [fresh, setFresh] = useState(0)
  const { load: me } = useTgApi<Me>(initData, `/api/tg/me${fresh ? `?fresh=1&n=${fresh}` : ''}`)
  const tracker = useTracker()
  const [stack, setStack] = useState<Screen[]>(() => {
    const start = holdersStart(wa)
    return start ? [{ k: 'home' }, start] : [{ k: 'home' }]
  })
  const [tab, setTab] = useState<Tab>('gaps')
  const [alertsVersion, setAlertsVersion] = useState(0)
  const top = stack[stack.length - 1]

  // Telegram's BackButton pops the screen stack.
  useEffect(() => {
    const bb = wa.BackButton
    if (stack.length < 2) {
      bb.hide()
      return
    }
    const back = () => {
      haptic.tap()
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
    }
    bb.show()
    bb.onClick(back)
    return () => bb.offClick(back)
  }, [wa, stack.length])

  // The screen starts at the top whenever it changes.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [top, tab])

  if (me.k === 'loading') return <Boot />
  if (me.k === 'error')
    return (
      <div className="flex flex-col gap-4 pt-4">
        <Brand />
        <Notice title={me.status === 401 ? 'This session has expired' : 'The app could not start'} action={<Button onClick={() => wa.close()}>Close and reopen</Button>}>
          {me.status === 401 ? 'Telegram signs each app session for 24 hours. Close the app and open it again from the bot.' : me.status === 0 ? 'No connection right now. Check your internet, then close the app and open it again.' : me.status === 429 ? 'Too many requests in a minute. Wait a moment, then open the app again.' : 'Something went wrong on our side. Close the app and open it again in a minute.'}
        </Notice>
      </div>
    )
  const m = me.data
  if (m.gate.required && !m.gate.follows)
    return (
      <div className="flex flex-col gap-4 pt-4">
        <Brand />
        <Notice
          title={
            <>
              <Megaphone size={20} aria-hidden /> Follow Gully Labs News
            </>
          }
          action={
            <div className="grid gap-2">
              <Button onClick={() => wa.openTelegramLink(m.gate.url ?? 'https://t.me/GullyLabsNews')}>Join {m.gate.channel?.startsWith('@') ? m.gate.channel : 'the channel'}</Button>
              <Button tone="line" onClick={() => setFresh((n) => n + 1)}>
                <span className="inline-flex items-center justify-center gap-2">
                  <Check size={16} aria-hidden /> I&apos;ve joined
                </span>
              </Button>
            </div>
          }
        >
          The widest stock-token gaps, Gully Chain news and product drops. Join the channel, then tap <b>I&apos;ve joined</b>.
        </Notice>
        {fresh > 0 && <p className="m-0 px-1 text-[13px] text-error">Not joined yet. Telegram can take a few seconds: join the channel, wait a moment, then tap again.</p>}
        {m.linked && (
          <div className="flex flex-col gap-2">
            <p className="m-0 px-1 text-[13px] text-muted">Your alerts keep working. You can pause or delete them here without joining.</p>
            <AlertsTab wa={wa} initData={initData} me={m} version={alertsVersion} onOpenStock={() => undefined} exitsOnly />
          </div>
        )}
      </div>
    )

  const rowOf = (chain: string, ticker: string): TrackerRow | null => (tracker.k === 'ok' ? (tracker.data.rows.find((r) => r.chain === chain && r.ticker === ticker) ?? null) : null)
  const openStock = (chain: string, ticker: string) => setStack((s) => [...s, { k: 'stock', chain, ticker }])
  const openHolders = (chain: string, token: string) => setStack((s) => [...s, { k: 'holders', chain, token }])
  // Stock tokens get "Who holds?" only on chains where the Holder Map has data.
  const stockHolders = (chain: string) => (m.holderChains ?? []).includes(chain)

  return (
    <>
      <Brand
        right={
          <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
            <span className="truncate">{m.user.firstName}</span>
            <span className={`rounded-full border px-2 py-[2px] ${m.linked ? 'border-gold-line text-gold' : 'border-line text-faint'}`}>{m.linked ? m.linked.account : 'not linked'}</span>
          </span>
        }
      />
      {top.k === 'holders' ? (
        <HoldersScreen key={`${top.chain}:${top.token}`} wa={wa} initData={initData} me={m} chain={top.chain} token={top.token} onAlertsChanged={() => setAlertsVersion((v) => v + 1)} />
      ) : top.k === 'stock' ? (
        tracker.k === 'loading' ? (
          <Boot />
        ) : (
          <StockScreen key={`${top.chain}:${top.ticker}`} wa={wa} initData={initData} row={rowOf(top.chain, top.ticker)} me={m} ink={ink} onAlertsChanged={() => setAlertsVersion((v) => v + 1)} onHolders={stockHolders(top.chain) ? () => openHolders(top.chain, top.ticker) : undefined} />
        )
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-4 bg-bg px-4 py-2">
            <Chips value={tab} options={TABS} onChange={setTab} label="Section" />
          </div>
          {tab === 'gaps' && <GapsTab initData={initData} tracker={tracker} ink={ink} onOpen={(r) => openStock(r.chain, r.ticker)} />}
          {tab === 'alerts' && (
            <>
              <AlertsTab wa={wa} initData={initData} me={m} version={alertsVersion} onOpenStock={openStock} />
              <AnnouncementsSwitch initData={initData} me={m} />
            </>
          )}
        </>
      )}
    </>
  )
}
