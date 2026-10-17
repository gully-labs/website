import '@rainbow-me/rainbowkit/styles.css'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { Loader2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { erc20Abi } from 'viem'
import { useAccount, useSwitchChain, useWriteContract, WagmiProvider } from 'wagmi'
import { btnGold } from '../../components/ui'
import type { Intent } from './api'
import { queryClient, wagmiConfig, walletTheme } from './walletConfig'

/* One-click USDC payment: a plain ERC-20 transfer(treasury, exact amount) on Base from whichever wallet
   is connected. Its own lazy chunk (wagmi, viem, RainbowKit), loaded only when the button is shown.
   The transfer goes straight to the treasury; this page never holds funds. */

const BASE_ID = 8453

function friendly(e: unknown): string {
  const m = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e)
  if (/reject|denied|cancel/i.test(m)) return 'The wallet request was declined. Nothing was sent.'
  if (/insufficient/i.test(m)) return 'This wallet does not hold enough USDC on Base (or ETH for gas).'
  return m.slice(0, 220)
}

function PayButton({ intent, onSent, onError }: { intent: Intent; onSent: (hash: string) => void; onError: (message: string) => void }) {
  const { isConnected, chainId, address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [busy, setBusy] = useState<string | null>(null)

  const pay = async () => {
    onError('')
    if (!isConnected) return openConnectModal?.()
    try {
      if (chainId !== BASE_ID) {
        setBusy('Switching to Base…')
        await switchChainAsync({ chainId: BASE_ID })
      }
      setBusy('Confirm in your wallet…')
      const hash = await writeContractAsync({ address: intent.token as `0x${string}`, abi: erc20Abi, functionName: 'transfer', args: [intent.treasury as `0x${string}`, BigInt(intent.amountRaw)], chainId: BASE_ID })
      onSent(hash)
    } catch (e) {
      onError(friendly(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={pay} disabled={!!busy} className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:opacity-60`}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wallet size={16} aria-hidden />}
        {busy ?? (isConnected ? `Pay ${intent.amount} USDC` : 'Connect a wallet to pay')}
      </button>
      {isConnected && address && <span className="font-mono text-[11px] text-faint">from {`${address.slice(0, 6)}…${address.slice(-4)}`} on Base</span>}
    </div>
  )
}

export default function PayUsdc(props: { intent: Intent; onSent: (hash: string) => void; onError: (message: string) => void }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme} modalSize="compact" initialChain={BASE_ID}>
          <PayButton {...props} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
