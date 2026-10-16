import '@rainbow-me/rainbowkit/styles.css'
import { connectorsForWallets, createAuthenticationAdapter, darkTheme, RainbowKitAuthenticationProvider, RainbowKitProvider, useConnectModal, type AuthenticationStatus, type Theme } from '@rainbow-me/rainbowkit'
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, trustWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createSiweMessage } from 'viem/siwe'
import { createConfig, http, useAccount, useDisconnect, WagmiProvider } from 'wagmi'
import { base, bsc, mainnet } from 'wagmi/chains'
import { defineChain } from 'viem'
import { api } from './api'

/* Wallet connection and Sign-In with Ethereum. This module (wagmi, viem, RainbowKit) is its own lazy
   chunk: it loads only when someone presses "Connect wallet", never with the site or the signed-in
   dashboard. Injected wallets (any EIP-6963 browser wallet) and Coinbase Wallet need no configuration;
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

const config = createConfig({
  chains: [mainnet, base, bsc, robinhood],
  connectors,
  transports: { [mainnet.id]: http(), [base.id]: http(), [bsc.id]: http(), [robinhood.id]: http() },
  ssr: false,
})

const queryClient = new QueryClient()

const theme: Theme = (() => {
  const t = darkTheme({ accentColor: '#e8c060', accentColorForeground: '#0b0e13', borderRadius: 'small', overlayBlur: 'small' })
  return {
    ...t,
    colors: { ...t.colors, modalBackground: '#10141a', modalBorder: '#1d232c', profileForeground: '#0d1116', generalBorder: '#2c3540', actionButtonSecondaryBackground: '#131820', menuItemBackground: '#131820', modalText: '#eef0f2', modalTextSecondary: '#a6b0bd', closeButtonBackground: '#131820', closeButton: '#a6b0bd' },
    fonts: { body: "'Hanken Grotesk', sans-serif" },
  }
})()

function Opener({ trigger, status, onClose }: { trigger: number; status: AuthenticationStatus; onClose: () => void }) {
  const { openConnectModal, connectModalOpen } = useConnectModal()
  const wasOpen = useRef(false)
  const handled = useRef(0)
  const { status: account } = useAccount()
  // Wait until wagmi has finished restoring a previous connection: RainbowKit closes its modals when the
  // connection status changes, so a modal opened during that would close at once.
  useEffect(() => {
    if (trigger === handled.current || !openConnectModal || account === 'reconnecting' || account === 'connecting') return
    const id = setTimeout(() => {
      handled.current = trigger
      openConnectModal()
    }, 60)
    return () => clearTimeout(id)
  }, [trigger, openConnectModal, account])
  useEffect(() => {
    if (connectModalOpen) wasOpen.current = true
    else if (wasOpen.current) {
      wasOpen.current = false
      if (status !== 'authenticated') onClose()
    }
  }, [connectModalOpen, status, onClose])
  return null
}

/** Disconnects the wallet when the dashboard session ends. */
function SignOutSync({ signedOut }: { signedOut: number }) {
  const { disconnect } = useDisconnect()
  useEffect(() => {
    if (signedOut) disconnect()
  }, [signedOut, disconnect])
  return null
}

// The adapter lives at module level (it is stateless); the mounted component points these at its callbacks.
const handlers: { onSignedIn: () => void; onError: (message: string) => void; onSignedOut: () => void } = { onSignedIn: () => {}, onError: () => {}, onSignedOut: () => {} }

const adapter = createAuthenticationAdapter<string>({
  getNonce: async () => {
    const r = await api<{ nonce: string }>('/api/developer/nonce')
    if (!r.ok) throw new Error(r.error)
    return r.data.nonce
  },
  createMessage: ({ nonce, address, chainId }) =>
    createSiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to the Gully Labs developer dashboard. This request will not trigger a transaction or cost any gas.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 10 * 60_000),
    }),
  verify: async ({ message, signature }) => {
    const r = await api('/api/developer/siwe', { method: 'POST', body: { message, signature } })
    if (!r.ok) {
      handlers.onError(r.error)
      return false
    }
    handlers.onSignedIn()
    return true
  },
  signOut: async () => {
    await api('/api/developer/logout', { method: 'POST' })
    handlers.onSignedOut()
  },
})

/**
 * Opens the wallet modal each time `trigger` changes; after the wallet signs the SIWE message the
 * server sets the session cookie and `onSignedIn` runs. `onClose` runs if the modal is dismissed.
 */
export default function WalletSignIn({ trigger, signedOut, onSignedIn, onClose, onError }: { trigger: number; signedOut: number; onSignedIn: () => void; onClose: () => void; onError: (message: string) => void }) {
  // Authenticated for the sign-out epoch in which the signature was accepted; a later sign-out resets it.
  const [authAt, setAuthAt] = useState<number | null>(null)
  const status: AuthenticationStatus = authAt !== null && authAt === signedOut ? 'authenticated' : 'unauthenticated'
  useEffect(() => {
    handlers.onSignedIn = () => {
      setAuthAt(signedOut)
      onSignedIn()
    }
    handlers.onError = onError
    handlers.onSignedOut = () => setAuthAt(null)
  }, [signedOut, onSignedIn, onError])

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
          <RainbowKitProvider theme={theme} modalSize="compact" appInfo={{ appName: 'Gully Labs Developers', learnMoreUrl: 'https://docs.gullylabs.xyz/api-keys' }}>
            <Opener trigger={trigger} status={status} onClose={onClose} />
            <SignOutSync signedOut={signedOut} />
          </RainbowKitProvider>
        </RainbowKitAuthenticationProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
