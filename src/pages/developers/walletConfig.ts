import { connectorsForWallets, darkTheme, type Theme } from '@rainbow-me/rainbowkit'
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, trustWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { QueryClient } from '@tanstack/react-query'
import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { arbitrum, arbitrumSepolia, avalanche, base, bsc, mainnet, optimism, polygon } from 'wagmi/chains'
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
  // Every Gully Pay chain (server/payments.mjs CHAINS) plus Robinhood Chain for the tracker, and Arbitrum Sepolia for
  // the chain launch wizard (testnet only; no payment or sign-in uses it).
  chains: [mainnet, base, bsc, arbitrum, optimism, polygon, avalanche, robinhood, arbitrumSepolia],
  connectors,
  transports: { [mainnet.id]: http(), [base.id]: http(), [bsc.id]: http(), [arbitrum.id]: http(), [optimism.id]: http(), [polygon.id]: http(), [avalanche.id]: http(), [robinhood.id]: http(), [arbitrumSepolia.id]: http() },
  ssr: false,
})

export const queryClient = new QueryClient()

export const walletTheme: Theme = (() => {
  const t = darkTheme({ accentColor: '#00d2ff', accentColorForeground: '#06050d', borderRadius: 'small', overlayBlur: 'small' })
  return {
    ...t,
    colors: { ...t.colors, modalBackground: '#0b0a16', modalBorder: '#181630', profileForeground: '#0a0914', generalBorder: '#242140', actionButtonSecondaryBackground: '#110f22', menuItemBackground: '#110f22', modalText: '#ffffff', modalTextSecondary: '#a3a8c3', closeButtonBackground: '#110f22', closeButton: '#a3a8c3' },
    fonts: { body: "'Hanken Grotesk', sans-serif" },
  }
})()
