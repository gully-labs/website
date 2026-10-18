/* Class strings shared by the dashboard's panels (Dashboard, Billing, Alerts). */

export const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
export const cardTitle = 'm-0 font-display text-[24px] leading-none font-bold uppercase'
export const sub = 'font-mono text-[11px] tracking-[.5px] text-faint'
export const input = 'h-11 w-full rounded-input border border-line-strong bg-bg px-3 text-[15px] text-ink outline-none transition-colors focus:border-gold'
export const iconBtn = 'inline-flex min-h-10 items-center gap-2 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50'
export const rise = (i: number) => ({ animation: `gl-rise .45s ${i * 0.05}s ease both` })

/* ---- The console portal ("B · Console app"): 14px panels, pill buttons, chips. ---- */

/** A console panel: the kit's card radius with 16px padding. */
export const panel = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4'
/** The one page title of every app page (ServiceHeader): 20 px, never 18/22/24/30. */
export const pageTitle = 'm-0 text-[20px] leading-tight font-semibold text-ink'
export const panelTitle = 'm-0 text-[15px] leading-tight font-semibold text-ink'
/** Small grey label above a value (the design's 11–12px #949daa). */
export const label = 'text-[12px] text-dim'
export const mono = 'font-mono text-[11px] text-faint'

const pillBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
export const pillGold = `${pillBase} bg-gold text-bg hover:bg-gold-hover`
export const pillLine = `${pillBase} border border-line-strong bg-transparent font-medium text-ink hover:border-gold`
export const pillGoldLine = `${pillBase} border border-gold-line text-gold hover:border-gold`
export const pillDanger = `${pillBase} bg-error text-bg hover:opacity-90`
/** Small secondary action (still 44px tall on touch). */
export const pillSm = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-50'

/** A choice chip (radio or toggle). */
export const chip = (on: boolean, monoFont = false) =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${monoFont ? 'font-mono text-[12px]' : ''} ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong bg-transparent text-ink-2 hover:border-gold hover:text-ink'}`

/** Series colours for API keys, in account order; 429s are always the error red. */
export const KEY_COLORS = ['#d9b563', '#5aa9e6', '#74c27b', '#c98bdb', '#26ab94', '#f2704a', '#aeb5be']
export const LIMITED_COLOR = '#ff8a7a'
export const BLUE = '#5aa9e6'
export const keyColor = (i: number) => KEY_COLORS[Math.max(0, i) % KEY_COLORS.length]
