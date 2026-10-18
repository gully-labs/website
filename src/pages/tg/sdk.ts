/* Telegram's WebApp SDK for the Mini App (/tg): loaded once from telegram.org at an exact URL (the CSP
   allows that script on /tg only), typed to the parts this app uses, and its theme mapped onto the
   site's colour tokens so every utility class (bg-bg, text-ink, border-line, …) follows Telegram's
   light or dark theme. Outside Telegram the SDK still loads but initData is empty; the app then says
   to open it from the bot. */

/** The SDK's exact URL. The query is Telegram's own cache-buster for the published version. */
export const TG_SDK_SRC = 'https://telegram.org/js/telegram-web-app.js?59'

export type ThemeParams = Partial<
  Record<
    | 'bg_color'
    | 'text_color'
    | 'hint_color'
    | 'link_color'
    | 'button_color'
    | 'button_text_color'
    | 'secondary_bg_color'
    | 'header_bg_color'
    | 'bottom_bar_bg_color'
    | 'accent_text_color'
    | 'section_bg_color'
    | 'section_header_text_color'
    | 'section_separator_color'
    | 'subtitle_text_color'
    | 'destructive_text_color',
    string
  >
>

interface BottomButton {
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void
  show(): void
  hide(): void
  enable(): void
  disable(): void
  showProgress(leaveActive?: boolean): void
  hideProgress(): void
  onClick(fn: () => void): void
  offClick(fn: () => void): void
}

export interface WebApp {
  initData: string
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string }; start_param?: string }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: ThemeParams
  ready(): void
  expand(): void
  close(): void
  isVersionAtLeast(v: string): boolean
  setHeaderColor?(c: string): void
  setBackgroundColor?(c: string): void
  openLink(url: string, o?: { try_instant_view?: boolean }): void
  openTelegramLink(url: string): void
  showConfirm?(message: string, cb: (ok: boolean) => void): void
  onEvent(e: string, fn: () => void): void
  offEvent(e: string, fn: () => void): void
  BackButton: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void; isVisible: boolean }
  MainButton: BottomButton
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(t: 'error' | 'success' | 'warning'): void; selectionChanged(): void }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp }
  }
}

let loading: Promise<WebApp | null> | null = null

/** Loads the SDK (once) and resolves to Telegram.WebApp, or null when it cannot load. */
export function loadTelegram(): Promise<WebApp | null> {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp)
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = TG_SDK_SRC
    s.async = true
    s.onload = () => resolve(window.Telegram?.WebApp ?? null)
    s.onerror = () => {
      loading = null
      resolve(null)
    }
    document.head.appendChild(s)
  })
  return loading
}

/* ---------- theme ---------- */

const HEX = /^#[0-9a-f]{6}$/i

/** WCAG relative luminance of a #rrggbb colour. */
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
/** Contrast ratio of two #rrggbb colours. */
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
/** Telegram's button text on its button colour when that is AA (4.5:1); otherwise the kit's night or bone, whichever reads better. */
export const buttonText = (btn: string | undefined, text: string | undefined) => {
  if (!btn || !HEX.test(btn)) return text
  if (text && HEX.test(text) && contrast(btn, text) >= 4.5) return text
  return contrast(btn, '#0d141c') >= contrast(btn, '#f4f2ec') ? '#0d141c' : '#f4f2ec'
}

/** Telegram's theme params as our colour tokens (CSS custom properties). Unknown or missing ones keep the brand's. */
export function themeVars(p: ThemeParams): Record<string, string> {
  const ok = (c?: string) => (c && HEX.test(c) ? c : undefined)
  const bg = ok(p.bg_color)
  const second = ok(p.secondary_bg_color)
  const section = ok(p.section_bg_color) ?? second
  const text = ok(p.text_color)
  const hint = ok(p.hint_color)
  const sub = ok(p.subtitle_text_color) ?? hint
  const accent = ok(p.button_color)
  const sep = ok(p.section_separator_color) ?? (hint ? `${hint}40` : undefined)
  const pairs: [string, string | undefined][] = [
    ['--color-bg', bg],
    ['--color-bg-alt', second],
    ['--color-surface', section],
    ['--color-surface-deep', second],
    ['--color-surface-hover', second],
    ['--color-line', sep],
    ['--color-line-strong', sep],
    ['--color-grid', sep],
    ['--color-ink', text],
    ['--color-ink-2', text],
    ['--color-muted', sub],
    ['--color-dim', hint],
    ['--color-faint', hint],
    ['--color-gold', accent],
    ['--color-gold-hover', accent],
    ['--color-gold-line', accent ? `${accent}66` : undefined],
    ['--color-error', ok(p.destructive_text_color)],
    ['--tg-link', ok(p.link_color) ?? ok(p.accent_text_color)],
    ['--tg-accent-text', ok(p.accent_text_color) ?? accent],
    ['--tg-btn-text', buttonText(accent, ok(p.button_text_color))],
    ['--tg-section-head', ok(p.section_header_text_color) ?? hint],
  ]
  return Object.fromEntries(pairs.filter((x): x is [string, string] => !!x[1]))
}

/** Whether a #rrggbb colour is light (for the browser's color-scheme and chart contrast). */
export const isLight = (hex?: string) => {
  if (!hex || !HEX.test(hex)) return false
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
}

/* ---------- haptics ---------- */

/** Haptic feedback that is a no-op where the client has none. */
export const haptic = {
  tap: () => window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'),
  select: () => window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(),
  ok: () => window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'),
  fail: () => window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error'),
  warn: () => window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning'),
}

/* ---------- API ---------- */

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; body: Record<string, unknown> | null }

/** One call to the Mini App API (/api/tg/*), signed with the raw initData. Never throws. */
export async function tgApi<T>(initData: string, path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const r = await fetch(path, {
      method: opts.method ?? 'GET',
      headers: { authorization: `tma ${initData}`, accept: 'application/json', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (r.ok) return { ok: true, status: r.status, data: j as T }
    return { ok: false, status: r.status, error: typeof j?.error === 'string' ? j.error : `The server answered ${r.status}.`, body: j }
  } catch {
    return { ok: false, status: 0, error: 'No connection. Check your network and try again.', body: null }
  }
}
