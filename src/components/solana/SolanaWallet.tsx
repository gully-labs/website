import { Loader2, LogOut, Wallet } from 'lucide-react'
import { shortKey, type useSolanaWallet } from './useSolanaWallet'

/* The wallet picker for Solana: one button per Wallet Standard wallet found, or the connected one. */

export function WalletChooser({ state, compact = false }: { state: ReturnType<typeof useSolanaWallet>; compact?: boolean }) {
  const { wallets, conn, busy, connect, disconnect } = state
  if (conn)
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-input border border-line-strong bg-bg px-3">
        <span className="inline-flex min-w-0 items-center gap-2 font-mono text-[12px] text-ink-2">
          {conn.wallet.icon && <img src={conn.wallet.icon} alt="" width={18} height={18} className="size-[18px] rounded-[4px]" />}
          <span className="truncate">
            {conn.wallet.name} · {shortKey(conn.account.address)}
          </span>
        </span>
        <button type="button" onClick={disconnect} aria-label="Disconnect the wallet" className="inline-flex size-9 items-center justify-center rounded-btn text-muted hover:text-gold">
          <LogOut size={14} aria-hidden />
        </button>
      </div>
    )
  if (!wallets.length)
    return (
      <p className="m-0 flex items-start gap-2 rounded-input border border-line-strong bg-bg px-3 py-3 text-[13px] leading-[1.55] text-muted" role="status">
        <Wallet size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        <span>No Solana wallet was found in this browser. Install Phantom, Solflare or Backpack{compact ? '' : ', or scan the QR code with a phone wallet'}.</span>
      </p>
    )
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a Solana wallet">
      {wallets.map((w) => (
        <button
          key={w.name}
          type="button"
          disabled={!!busy}
          onClick={() => connect(w)}
          className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 text-[14px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-60"
        >
          {busy === w.name ? <Loader2 size={16} className="animate-spin" aria-hidden /> : w.icon ? <img src={w.icon} alt="" width={20} height={20} className="size-5 rounded-[4px]" /> : <Wallet size={16} aria-hidden />}
          {w.name}
        </button>
      ))}
    </div>
  )
}
