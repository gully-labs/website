/* A segmented control: the group, and one of its buttons (`on` is the chosen one). The same recipe on
   the ledger's range switch, the project sort, the venue charts, the pricing switch and the tracker's
   chain tabs: a 6 px input-radius frame with 4 px buttons inside, 44 px tall. */
export const segGroup = 'flex w-fit max-w-full gap-1 rounded-input border border-line bg-surface p-1'
export const segBtn = (on: boolean) =>
  `min-h-11 rounded-btn px-3 font-mono text-[12px] whitespace-nowrap transition-colors ${on ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`
