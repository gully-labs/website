import '@rainbow-me/rainbowkit/styles.css'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { useAccount, useSendTransaction, useSwitchChain, WagmiProvider } from 'wagmi'
import { queryClient, wagmiConfig, walletTheme } from '../walletConfig'
import { PARENT } from './chain'
import type { Prepared } from './types'

/* The launch flow's wallet, its own lazy chunk (wagmi, RainbowKit) mounted only on the Review, Deploy and Result steps.
   The same wallet connection the app already uses (walletConfig.ts). The wallet signs the SDK's prepared
   transaction in the browser; this file sends exactly the request the Review step showed and never touches a key.
   Children get a small API so the pages stay free of wagmi. */

export type WalletApi = {
  address: Address | null
  /** The wallet's current chain id (null when not connected). */
  chainId: number | null
  onParent: boolean
  connect: () => void
  /** Switches the wallet to Arbitrum Sepolia (asks the wallet). */
  switchToParent: () => Promise<void>
  /** Sends the prepared transaction from the connected wallet. Resolves to the hash. */
  send: (tx: Prepared) => Promise<Hex>
}

function Inner({ children }: { children: (w: WalletApi) => React.ReactNode }) {
  const { address, chainId, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const api: WalletApi = {
    address: isConnected && address ? address : null,
    chainId: isConnected ? (chainId ?? null) : null,
    onParent: isConnected && chainId === PARENT.id,
    connect: () => openConnectModal?.(),
    switchToParent: async () => void (await switchChainAsync({ chainId: PARENT.id })),
    send: (tx) => {
      // The testnet-only rule, once more at the point of sending.
      if (tx.chainId !== PARENT.id) throw new Error(`Refused: this flow only sends to ${PARENT.name}.`)
      return sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value, gas: tx.gas, chainId: PARENT.id })
    },
  }
  return <>{children(api)}</>
}

export default function ChainWallet({ children }: { children: (w: WalletApi) => React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme} modalSize="compact" initialChain={PARENT.id}>
          <Inner>{children}</Inner>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
