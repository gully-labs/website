import '@rainbow-me/rainbowkit/styles.css'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { Loader2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { encodeFunctionData, erc20Abi } from 'viem'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, WagmiProvider } from 'wagmi'
import type { Quote } from '../../pages/developers/api'
import { assetViolations, recipientViolations, splitViolations, txViolations } from '../../../server/fee-proxy-guard.mjs'
import { queryClient, wagmiConfig, walletTheme } from '../../pages/developers/walletConfig'
import { btnGold } from '../ui'

/* One-click payment of a Gully Pay quote from whichever wallet is connected: a plain transfer of the
   native coin (sendTransaction) or an ERC-20 transfer(treasury, exact amount) (writeContract), after
   switching the wallet to the quote's chain. Its own lazy chunk (wagmi, viem, RainbowKit), loaded only
   when the button is shown. The transfer goes straight to the treasury; this page never holds funds.
   A split quote (quote.split: a merchant payment with Gully Labs' fee) instead approves Request Network's
   ERC20FeeProxy for the exact amount when the allowance falls short, then calls it with the call data the
   server built: one transaction pays the merchant and the fee, tagged with the quote's payment reference.

   Fee-proxy guards (server/fee-proxy-guard.mjs, the same rules the server applies before it emits a quote): the
   quote is re-checked here before anything is sent; the proxy call is simulated with eth_call first; every
   transaction passes txViolations (never native value to a proxy, never a plain transfer to one); and a split
   that fails any of this is refused outright, never retried as a plain transfer. Funds can't get stuck. */

const SAFETY = 'This payment failed a safety check, so nothing was sent. Please contact hello@gullylabs.xyz.'

/** Every fee-proxy rule against the quote as received. Empty = safe to start. */
function quoteIssues(q: Quote): string[] {
  const out = [...assetViolations({ chainId: q.asset.chainId, kind: q.asset.kind, symbol: q.asset.symbol, address: q.asset.address }), ...recipientViolations(q.treasury, { chainId: q.chainId, label: 'recipient' })]
  if (q.asset.chainId !== q.chainId) out.push('the asset is on another chain')
  if (q.split) {
    if (q.asset.kind !== 'token') out.push('a split on a native coin')
    else out.push(...splitViolations(q.split, { chainId: q.chainId, token: q.asset.address, total: q.amountRaw, to: q.treasury, feeTo: q.split.feeTo }))
  }
  return out
}

class GuardError extends Error {}

function friendly(e: unknown, q: Quote): string {
  if (e instanceof GuardError) return e.message
  const m = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e)
  if (/reject|denied|cancel/i.test(m)) return 'The wallet request was declined. Nothing was sent.'
  if (/insufficient/i.test(m)) return `This wallet does not hold enough ${q.asset.symbol} on ${q.asset.chain}${q.asset.kind === 'token' ? ' (or coin for gas)' : ' for the amount plus gas'}.`
  if (/chain/i.test(m) && /switch|unsupported|unrecognized/i.test(m)) return `Switch your wallet to ${q.asset.chain} (chain ${q.chainId}) and try again, or send the amount by hand and paste the hash.`
  return m.slice(0, 220)
}

function PayButton({ quote, onSent, onError, disabled }: { quote: Quote; onSent: (hash: string) => void; onError: (message: string) => void; disabled: boolean }) {
  const { isConnected, chainId, address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const [busy, setBusy] = useState<string | null>(null)
  const target = quote.chainId

  const client = usePublicClient({ chainId: target })

  /** The only way this page sends anything: checked against the fee-proxy rules first, value always explicit. */
  const send = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }) => {
    const bad = txViolations({ to: tx.to, data: tx.data ?? null, value: tx.value ?? 0n })
    if (bad.length) throw new GuardError(`${SAFETY} (${bad.join('; ')})`)
    return sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value ?? 0n, chainId: target })
  }

  /** Approve (only as far as needed), wait for it, simulate the proxy call, then send it. Resolves to the payment's hash. */
  const paySplit = async (q: Quote, owner: `0x${string}`): Promise<`0x${string}`> => {
    const s = q.split!
    const total = BigInt(q.amountRaw)
    const token = s.approve.to as `0x${string}`
    if (!client) throw new Error(`No connection to ${q.asset.chain}. Try again in a moment.`)
    const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
    if (balance < total) throw new GuardError(`This wallet holds less ${q.asset.symbol} than the ${q.amount} this payment needs on ${q.asset.chain}. Nothing was sent.`)
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, s.spender as `0x${string}`] })
    if (allowance < total) {
      // USDT on Ethereum refuses to change a non-zero allowance to another non-zero one.
      if (allowance > 0n) {
        setBusy('Reset the old allowance in your wallet…')
        await client.waitForTransactionReceipt({ hash: await send({ to: token, data: s.approveReset.data as `0x${string}` }) })
      }
      setBusy(`Allow exactly ${q.amount} ${q.asset.symbol} in your wallet (1 of 2)…`)
      const approved = await client.waitForTransactionReceipt({ hash: await send({ to: token, data: s.approve.data as `0x${string}` }) })
      if (approved.status !== 'success') throw new Error('The approval failed on chain. Nothing was paid.')
    }
    // Simulate the exact call before the wallet sees it: a revert here means nothing is sent at all.
    setBusy('Checking the payment…')
    try {
      await client.call({ account: owner, to: s.pay.to as `0x${string}`, data: s.pay.data as `0x${string}`, value: 0n })
    } catch (e) {
      const why = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e).slice(0, 160)
      throw new GuardError(`The payment did not pass its simulation (${why}), so nothing was sent. Try again, or contact hello@gullylabs.xyz.`)
    }
    setBusy(allowance < total ? 'Confirm the payment in your wallet (2 of 2)…' : 'Confirm in your wallet…')
    return send({ to: s.pay.to as `0x${string}`, data: s.pay.data as `0x${string}`, value: 0n })
  }

  const pay = async () => {
    onError('')
    if (!isConnected) return openConnectModal?.()
    try {
      if (chainId !== target) {
        setBusy(`Switch to ${quote.asset.chain} in your wallet…`)
        await switchChainAsync({ chainId: target })
      }
      // Same rules as the server, before anything reaches the wallet. A split that fails is refused, never sent
      // as a plain transfer instead.
      const issues = quoteIssues(quote)
      if (issues.length) throw new GuardError(`${SAFETY} (${issues.join('; ')})`)
      if (quote.split) {
        if (!address) throw new Error('Connect a wallet to pay.')
        return onSent(await paySplit(quote, address))
      }
      setBusy('Confirm in your wallet…')
      const value = BigInt(quote.amountRaw)
      const to = quote.treasury as `0x${string}`
      const hash =
        quote.asset.kind === 'native'
          ? await send({ to, value })
          : await send({ to: quote.asset.address as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, value] }), value: 0n })
      onSent(hash)
    } catch (e) {
      onError(friendly(e, quote))
    } finally {
      setBusy(null)
    }
  }

  const wrongChain = isConnected && chainId !== target
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={pay} disabled={!!busy || disabled} className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60`}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wallet size={16} aria-hidden />}
        {busy ?? (!isConnected ? 'Connect a wallet to pay' : wrongChain ? `Switch to ${quote.asset.chain} and pay` : `Pay ${quote.amount} ${quote.asset.symbol}`)}
      </button>
      {isConnected && address && (
        <span className="font-mono text-[11px] text-faint">
          from {`${address.slice(0, 6)}…${address.slice(-4)}`}
          {wrongChain ? ` · wallet is on chain ${chainId}; it will be asked to switch to ${quote.asset.chain}` : ` on ${quote.asset.chain}`}
        </span>
      )}
    </div>
  )
}

export default function PayWallet(props: { quote: Quote; onSent: (hash: string) => void; onError: (message: string) => void; disabled: boolean }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme} modalSize="compact" initialChain={props.quote.chainId}>
          <PayButton {...props} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
