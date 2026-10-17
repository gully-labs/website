import { connectorsForWallets, darkTheme, type Theme } from '@rainbow-me/rainbowkit'
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, trustWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { QueryClient } from '@tanstack/react-query'
import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { arbitrum, base, bsc, mainnet } from 'wagmi/chains'

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
  { appName: 'Gully Labs Developers', appDescription: 'API keys for the Gully Labs tracker API', appUrl: 'https://developers.gullylabs.xyz', projectId: projectId || 'not-configured' },
)

export const wagmiConfig = createConfig({
  chains: [mainnet, base, bsc, arbitrum, robinhood],
  connectors,
  transports: { [mainnet.id]: http(), [base.id]: http(), [bsc.id]: http(), [arbitrum.id]: http(), [robinhood.id]: http() },
  ssr: false,
})

export const queryClient = new QueryClient()

export const walletTheme: Theme = (() => {
  const t = darkTheme({ accentColor: '#e8c060', accentColorForeground: '#0b0e13', borderRadius: 'small', overlayBlur: 'small' })
  return {
    ...t,
    colors: { ...t.colors, modalBackground: '#10141a', modalBorder: '#1d232c', profileForeground: '#0d1116', generalBorder: '#2c3540', actionButtonSecondaryBackground: '#131820', menuItemBackground: '#131820', modalText: '#eef0f2', modalTextSecondary: '#a6b0bd', closeButtonBackground: '#131820', closeButton: '#a6b0bd' },
    fonts: { body: "'Hanken Grotesk', sans-serif" },
  }
})()
