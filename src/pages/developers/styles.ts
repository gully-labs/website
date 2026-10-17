/* Class strings shared by the dashboard's panels (Dashboard, Billing, Alerts). */

export const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
export const cardTitle = 'm-0 font-display text-[24px] leading-none font-bold uppercase'
export const sub = 'font-mono text-[11px] tracking-[.5px] text-faint'
export const input = 'h-11 w-full rounded-input border border-line-strong bg-bg px-3 text-[15px] text-ink outline-none transition-colors focus:border-gold'
export const iconBtn = 'inline-flex min-h-10 items-center gap-2 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50'
export const rise = (i: number) => ({ animation: `gl-rise .45s ${i * 0.05}s ease both` })
