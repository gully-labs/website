import { Code2, Copy, QrCode as QrIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { PayAsset } from '../api'
import { AssetMark } from '../../../components/pay/AssetPicker'
import { copyWithToast } from '../../../components/ui/toast'
import { embedSnippet } from '../../pay/embed'
import { QrCode } from '../../pay/QrCode'
import { Dialog } from '../Dialog'
import { chip, mono, pillDanger, pillLine, pillSm } from '../styles'
import { InfoTip } from '../ui'
import { payOrigin } from './api'
import { ExtLink } from '../ExtLink'

/* Small pieces shared by the Merchant tab's sections. */

/** One Merchant section (one sub-tab): a compact card. A long explanation goes in `info`, behind an (i) next
    to the one-line `sub`. */
export function Section({ id, title, sub, info, action, children }: { id: string; title: string; sub?: ReactNode; info?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex min-w-0 scroll-mt-28 flex-col gap-3 rounded-card border border-line bg-surface p-4 max-[600px]:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-[2px]">
          <h2 id={`${id}-h`} className="m-0 text-[15px] leading-tight font-semibold text-ink">
            {title}
          </h2>
          {sub && (info ? <InfoTip summary={sub}>{info}</InfoTip> : <span className="truncate text-[12px] text-dim">{sub}</span>)}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A confirm dialog for a destructive step (remove a wallet, cancel an invoice). */
export function Confirm({ open, title, children, confirm, busy, onConfirm, onClose }: { open: boolean; title: string; children: ReactNode; confirm: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4" data-testid="merchant-confirm">
        <div className="m-0 text-[14px] leading-[1.6] text-muted">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={pillLine}>
            Keep it
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className={pillDanger}>
            {confirm}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[6px]">
      <span className="text-[12px] text-dim">{label}</span>
      {children}
      {hint && <span className={mono}>{hint}</span>}
    </label>
  )
}

/** Asset toggles grouped as chips, with each asset's mark. Assets on chains without a wallet are marked. */
export function AssetChips({ assets, value, onChange, live }: { assets: PayAsset[]; value: string[]; onChange: (v: string[]) => void; live: Set<number> }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Assets accepted">
      {assets.map((a) => {
        const on = value.includes(a.id)
        return (
          <button key={a.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== a.id) : [...value, a.id])} className={chip(on)} title={live.has(a.chainId) ? undefined : `No receiving wallet on ${a.chain} yet: this asset is hidden at checkout until you add one.`}>
            <AssetMark asset={a} />
            {a.symbol} · {a.chain}
            {!live.has(a.chainId) && <span className="text-[11px] opacity-70">(no wallet)</span>}
          </button>
        )
      })}
    </div>
  )
}

const STATUS_CLS: Record<string, string> = {
  open: 'border-line-strong text-ink-2',
  active: 'border-success-line text-green',
  paid: 'border-success-line text-green',
  overdue: 'border-error-line text-error',
  expired: 'border-line-strong text-faint',
  cancelled: 'border-line-strong text-faint',
  inactive: 'border-line-strong text-faint',
  'used-up': 'border-line-strong text-faint',
  waived: 'border-line-strong text-faint',
}

export function StatusPill({ state }: { state: string }) {
  return <span className={`inline-flex min-h-[26px] items-center rounded-full border px-[10px] font-mono text-[11px] ${STATUS_CLS[state] ?? 'border-line-strong text-ink-2'}`}>{state}</span>
}

/** Checkout URL with copy, a QR on demand and the "Pay with crypto" button snippet. */
export function ShareBox({ path, label }: { path: string; label: string }) {
  const [qr, setQr] = useState(false)
  const [code, setCode] = useState(false)
  const url = `${payOrigin()}${path}`
  const snippet = embedSnippet(payOrigin(), path)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ExtLink href={url} className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2 underline-offset-4 hover:text-gold hover:underline">
          {url}
        </ExtLink>
        <button type="button" className={pillSm} onClick={() => copyWithToast(url, 'Checkout link')}>
          <Copy size={14} aria-hidden /> Copy
        </button>
        <button type="button" className={pillSm} aria-expanded={qr} onClick={() => setQr((v) => !v)}>
          <QrIcon size={14} aria-hidden /> QR
        </button>
        <button type="button" className={pillSm} aria-expanded={code} onClick={() => setCode((v) => !v)}>
          <Code2 size={14} aria-hidden /> Button
        </button>
      </div>
      {qr && (
        <div className="flex animate-[gl-rise_.25s_ease_both] flex-wrap items-center gap-4">
          <QrCode value={url} size={132} label={`QR code for ${label}`} />
          <span className="max-w-[320px] text-[13px] text-muted">Print it or show it at the counter: the phone opens this checkout and the payer picks a chain and an asset there.</span>
        </div>
      )}
      {code && (
        <div className="flex animate-[gl-rise_.25s_ease_both] flex-col gap-2">
          <pre className="m-0 overflow-x-auto rounded-input border border-line bg-bg p-3 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2">{snippet}</pre>
          <button type="button" className={`${pillSm} self-start`} onClick={() => copyWithToast(snippet, 'Button code')}>
            <Copy size={14} aria-hidden /> Copy button code
          </button>
        </div>
      )}
    </div>
  )
}
