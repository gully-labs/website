import '@rainbow-me/rainbowkit/styles.css'
import { createAuthenticationAdapter, RainbowKitAuthenticationProvider, RainbowKitProvider, useConnectModal, type AuthenticationStatus } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createSiweMessage } from 'viem/siwe'
import { useAccount, useDisconnect, WagmiProvider } from 'wagmi'
import { api } from './api'
import { queryClient, wagmiConfig as config, walletTheme as theme } from './walletConfig'

/* Wallet connection and Sign-In with Ethereum. This module (wagmi, viem, RainbowKit) is its own lazy
   chunk: it loads only when someone presses "Connect wallet", never with the site or the signed-in
   dashboard. The wallet set-up itself is shared with checkout (walletConfig.ts). */

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
