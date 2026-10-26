/* Admin's shared control recipes (design audit X3/X4): one chip for every option group, one status pill,
   one 44 px button. Colour comes from the caller (a STATUS_STYLE entry or a token pair). */

/** An option in a pick-one group (radio label or button): 44 px, round, gold when chosen. */
export const chip = (on: boolean) =>
  `inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] transition-colors ${on ? 'border-gold bg-[rgba(0,210,255,.1)] text-gold' : 'border-line-strong text-ink-2 hover:border-line-hover'}`

/** A status pill: 24 px high, mono 11, with the border and text colour passed in. */
export const pillCls = (tone: string) => `inline-flex min-h-6 items-center gap-1 rounded-full border px-[10px] font-mono text-[11px] ${tone}`

/** A 44 px secondary button (icon + label). */
export const ctl = 'inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50'

/** A 44 px text link (mailto, transaction, source): the link text keeps its look, the tap area grows. */
export const link44 = 'inline-flex min-h-11 items-center'

/** A 44 px text field or select. */
export const field44 = 'min-h-11 rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold'

/** A 44 px gold primary button. */
export const goldCtl = 'inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-50'
