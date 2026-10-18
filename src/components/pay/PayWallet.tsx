import '@rainbow-me/rainbowkit/styles.css'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { Loader2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { erc20Abi } from 'viem'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract, WagmiProvider } from 'wagmi'
import type { Quote } from '../../pages/developers/api'
import { queryClient, wagmiConfig, walletTheme } from '../../pages/developers/walletConfig'
import { btnGold } from '../ui'

/* One-click payment of a Gully Pay quote from whichever wallet is connected: a plain transfer of the
   native coin (sendTransaction) or an ERC-20 transfer(treasury, exact amount) (writeContract), after
   switching the wallet to the quote's chain. Its own lazy chunk (wagmi, viem, RainbowKit), loaded only
   when the button is shown. The transfer goes straight to the treasury; this page never holds funds.
   A split quote (quote.split: a merchant payment with Gully Labs' fee) instead approves Request Network's
   ERC20FeeProxy for the exact amount when the allowance falls short, then calls it with the call data the
   server built: one transaction pays the merchant and the fee, tagged with the quote's payment reference. */

function friendly(e: unknown, q: Quote): string {
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
  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()
  const [busy, setBusy] = useState<string | null>(null)
  const target = quote.chainId

  const client = usePublicClient({ chainId: target })

  /** Approve (only as far as needed), wait for it, then the proxy call. Resolves to the payment's hash. */
  const paySplit = async (q: Quote, owner: `0x${string}`): Promise<`0x${string}`> => {
    const s = q.split!
    const total = BigInt(q.amountRaw)
    const token = s.approve.to as `0x${string}`
    if (!client) throw new Error(`No connection to ${q.asset.chain}. Try again in a moment.`)
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, s.spender as `0x${string}`] })
    if (allowance < total) {
      // USDT on Ethereum refuses to change a non-zero allowance to another non-zero one.
      if (allowance > 0n) {
        setBusy('Reset the old allowance in your wallet…')
        await client.waitForTransactionReceipt({ hash: await sendTransactionAsync({ to: token, data: s.approveReset.data as `0x${string}`, chainId: target }) })
      }
      setBusy(`Allow exactly ${q.amount} ${q.asset.symbol} in your wallet (1 of 2)…`)
      const approved = await client.waitForTransactionReceipt({ hash: await sendTransactionAsync({ to: token, data: s.approve.data as `0x${string}`, chainId: target }) })
      if (approved.status !== 'success') throw new Error('The approval failed on chain. Nothing was paid.')
      setBusy('Confirm the payment in your wallet (2 of 2)…')
    } else setBusy('Confirm in your wallet…')
    return sendTransactionAsync({ to: s.pay.to as `0x${string}`, data: s.pay.data as `0x${string}`, chainId: target })
  }

  const pay = async () => {
    onError('')
    if (!isConnected) return openConnectModal?.()
    try {
      if (chainId !== target) {
        setBusy(`Switch to ${quote.asset.chain} in your wallet…`)
        await switchChainAsync({ chainId: target })
      }
      if (quote.split && address) return onSent(await paySplit(quote, address))
      setBusy('Confirm in your wallet…')
      const value = BigInt(quote.amountRaw)
      const to = quote.treasury as `0x${string}`
      const hash =
        quote.asset.kind === 'native'
          ? await sendTransactionAsync({ to, value, chainId: target })
          : await writeContractAsync({ address: quote.asset.address as `0x${string}`, abi: erc20Abi, functionName: 'transfer', args: [to, value], chainId: target })
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
