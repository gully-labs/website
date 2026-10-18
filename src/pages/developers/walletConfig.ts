import { connectorsForWallets, darkTheme, type Theme } from '@rainbow-me/rainbowkit'
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, trustWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { QueryClient } from '@tanstack/react-query'
import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { arbitrum, avalanche, base, bsc, mainnet, optimism, polygon } from 'wagmi/chains'
import { APP_URL } from '../../site-host'

/* The wallet set-up shared by sign-in (WalletSignIn) and Gully Pay checkout (components/pay/PayWallet). Both are lazy chunks;
   this module loads with whichever is needed first and never with the site or the dashboard itself.
   Injected wallets (any EIP-6963 browser wallet) and Coinbase Wallet need no configuration;
   WalletConnect wallets appear only when VITE_WALLETCONNECT_PROJECT_ID is set at build time. */

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
})

const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || ''
export const walletConnectEnabled = projectId.length > 0

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      // Without a WalletConnect project id, only wallets that never fall back to WalletConnect are listed.
      wallets: walletConnectEnabled ? [metaMaskWallet, coinbaseWallet, rabbyWallet, rainbowWallet, trustWallet, walletConnectWallet] : [injectedWallet, coinbaseWallet, rabbyWallet],
    },
  ],
  { appName: 'Gully Labs App', appDescription: 'Keys, alerts, analytics and payments for Gully Labs products', appUrl: APP_URL, projectId: projectId || 'not-configured' },
)

export const wagmiConfig = createConfig({
  // Every Gully Pay chain (server/payments.mjs CHAINS) plus Robinhood Chain for the tracker.
  chains: [mainnet, base, bsc, arbitrum, optimism, polygon, avalanche, robinhood],
  connectors,
  transports: { [mainnet.id]: http(), [base.id]: http(), [bsc.id]: http(), [arbitrum.id]: http(), [optimism.id]: http(), [polygon.id]: http(), [avalanche.id]: http(), [robinhood.id]: http() },
  ssr: false,
})

export const queryClient = new QueryClient()

export const walletTheme: Theme = (() => {
  const t = darkTheme({ accentColor: '#d9b563', accentColorForeground: '#0d141c', borderRadius: 'small', overlayBlur: 'small' })
  return {
    ...t,
    colors: { ...t.colors, modalBackground: '#151d28', modalBorder: '#1f2935', profileForeground: '#111923', generalBorder: '#2a3542', actionButtonSecondaryBackground: '#1a2330', menuItemBackground: '#1a2330', modalText: '#f4f2ec', modalTextSecondary: '#aeb5be', closeButtonBackground: '#1a2330', closeButton: '#aeb5be' },
    fonts: { body: "'Hanken Grotesk', sans-serif" },
  }
})()
