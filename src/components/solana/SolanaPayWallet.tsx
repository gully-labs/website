import { Loader2, Wallet } from 'lucide-react'
import { useState } from 'react'
import type { Quote } from '../../pages/developers/api'
import { btnGold } from '../ui'
import { latestBlockhash, lamportsOf, sendRaw, tokenBalance } from './rpc'
import { WalletChooser } from './SolanaWallet'
import { shortKey, useSolanaWallet } from './useSolanaWallet'
import { associatedTokenAddress, b58encode, buildLegacyTx, createAtaIdempotentIx, solTransferIx, toBase64, transferCheckedIx } from './tx'
import { signAndSend } from './walletStandard'

/* One-click payment of a Gully Pay quote on Solana, the Solana twin of pay/PayWallet.tsx (same props):
   connect a Wallet Standard wallet, then sign one transaction that pays the treasury exactly the quoted
   amount and carries the quote's Solana Pay reference key, so the server finds it by itself. For USDC and
   USDT the transaction first makes the treasury's token account if it is missing (CreateIdempotent; the
   payer covers its rent once, about 0.002 SOL). Loaded only when "Pay with wallet" is pressed. */

type SolQuote = Quote & { reference?: string | null }
/** A little SOL is left for the network fee (5000 lamports a signature, plus priority). */
const FEE_RESERVE = 50_000n

function friendly(e: unknown, q: Quote): string {
  const m = String((e as Error)?.message ?? e)
  if (/reject|denied|cancel|declined/i.test(m)) return 'The wallet request was declined. Nothing was sent.'
  if (/insufficient|0x1\b|debit an account/i.test(m)) return `This wallet does not hold enough ${q.asset.symbol} on Solana${q.asset.kind === 'token' ? ' (or SOL for the network fee)' : ' for the amount plus the network fee'}.`
  if (/blockhash/i.test(m)) return 'The transaction took too long to sign and ran out. Try again.'
  return m.slice(0, 220)
}

export default function SolanaPayWallet({ quote, onSent, onError, disabled }: { quote: SolQuote; onSent: (signature: string) => void; onError: (message: string) => void; disabled: boolean }) {
  const w = useSolanaWallet()
  const [busy, setBusy] = useState<string | null>(null)

  const pay = async () => {
    onError('')
    if (!w.conn) return
    const payer = w.conn.account.address
    const amount = BigInt(quote.amountRaw)
    try {
      setBusy('Preparing the transaction…')
      const ixs = []
      if (quote.asset.kind === 'native') {
        const have = await lamportsOf(payer)
        if (have < amount + FEE_RESERVE) throw new Error('insufficient')
        ixs.push(solTransferIx(payer, quote.treasury, amount, quote.reference))
      } else {
        const mint = quote.asset.address!
        // Paid from the payer's largest account in that mint (normally its associated account).
        const { best, account } = await tokenBalance(payer, mint)
        if (!account || best < amount) throw new Error('insufficient')
        const dest = await associatedTokenAddress(quote.treasury, mint)
        ixs.push(createAtaIdempotentIx(payer, dest, quote.treasury, mint))
        ixs.push(transferCheckedIx(account, mint, dest, payer, amount, quote.asset.decimals, quote.reference))
      }
      const { blockhash } = await latestBlockhash()
      const tx = buildLegacyTx(payer, blockhash, ixs)
      setBusy('Confirm in your wallet…')
      const sig = await signAndSend(w.conn.wallet, w.conn.account, tx, (signed) => sendRaw(toBase64(signed)))
      onSent(typeof sig === 'string' ? sig : b58encode(sig))
    } catch (e) {
      onError(friendly(e, quote))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <WalletChooser state={w} compact />
      {w.error && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {w.error}
        </p>
      )}
      {w.conn && (
        <>
          <button type="button" onClick={pay} disabled={!!busy || disabled} className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60`}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wallet size={16} aria-hidden />}
            {busy ?? `Pay ${quote.amount} ${quote.asset.symbol}`}
          </button>
          <span className="font-mono text-[11px] text-faint">from {shortKey(w.conn.account.address)} on Solana · reference {quote.reference ? shortKey(quote.reference) : 'none'}</span>
        </>
      )}
    </div>
  )
}
