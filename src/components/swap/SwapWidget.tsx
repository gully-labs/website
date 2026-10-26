import '@rainbow-me/rainbowkit/styles.css'
import { ChainType } from '@lifi/sdk'
import { LiFiWidget, useWidgetEvents, WidgetEvent, type WidgetConfig } from '@lifi/widget'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { WagmiProvider } from 'wagmi'
import { queryClient, wagmiConfig, walletTheme } from '../../pages/developers/walletConfig'
import { LifiEvmContext } from './LifiEvmContext'
import { LIFI_FEE, LIFI_INTEGRATOR, NATIVE_TOKEN } from './swapConfig'
import { track } from '../../lib/track'

/* The LI.FI widget for one stock token, locked to that token's chain. Its own lazy chunk, loaded only after the
   visitor has acknowledged the notice on a stock page. The wallet is the site's own (wagmi + RainbowKit); the
   widget finds routes through li.quest and the wallet signs; Gully Labs never holds funds. */

/* The widget's internal router (TanStack Router, memory history) resets the WINDOW's scroll on each of its own
   page changes, including its first render: ticking "I understand" jumped the page to the top. Its call is
   always scrollTo({ top: 0, left: 0, behavior }); this site never passes `left`, so exactly that call is
   dropped while this chunk is loaded (it is only ever loaded for the swap). */
if (typeof window !== 'undefined') {
  const original = window.scrollTo.bind(window) as (...a: unknown[]) => void
  window.scrollTo = ((...args: unknown[]) => {
    const o = args[0] as ScrollToOptions | undefined
    if (args.length === 1 && o && typeof o === 'object' && o.top === 0 && o.left === 0) return
    original(...args)
  }) as typeof window.scrollTo
}

const font = "'Hanken Grotesk', sans-serif"

const theme: WidgetConfig['theme'] = {
  container: { border: 'none', borderRadius: 0, boxShadow: 'none', maxWidth: '100%', minWidth: 0, background: '#0b0a16' },
  shape: { borderRadius: 10, borderRadiusSecondary: 6 },
  typography: { fontFamily: font },
  colorSchemes: {
    dark: {
      palette: {
        primary: { main: '#00d2ff', contrastText: '#06050d' },
        secondary: { main: '#66e4ff' },
        success: { main: '#3ddc97' },
        error: { main: '#FF8A7A' },
        background: { default: '#06050d', paper: '#0b0a16' },
        text: { primary: '#ffffff', secondary: '#a3a8c3' },
        grey: { 200: '#ffffff', 300: '#d6d8e6', 700: '#34305a', 800: '#181630' },
      },
    },
  },
}

/* Gully Analytics: swap-quoted the first time LI.FI shows routes for this token, swap-submitted each time the
   visitor starts a route (the wallet is asked to sign). Chain key and ticker only: no amounts, wallets or hashes. */
function useSwapEvents(chain: string, ticker: string) {
  const events = useWidgetEvents()
  useEffect(() => {
    let quoted = false
    const onRoutes = (routes: unknown[]) => {
      if (quoted || !routes?.length) return
      quoted = true
      track('swap-quoted', { venue: 'lifi', chain, ticker })
    }
    const onStart = () => track('swap-submitted', { venue: 'lifi', chain, ticker })
    events.on(WidgetEvent.AvailableRoutes, onRoutes)
    events.on(WidgetEvent.RouteExecutionStarted, onStart)
    return () => {
      events.off(WidgetEvent.AvailableRoutes, onRoutes)
      events.off(WidgetEvent.RouteExecutionStarted, onStart)
    }
  }, [events, chain, ticker])
}

function Widget({ chainId, token, chain, ticker }: { chainId: number; token: string; chain: string; ticker: string }) {
  const { openConnectModal } = useConnectModal()
  useSwapEvents(chain, ticker)
  const config = useMemo<WidgetConfig>(
    () => ({
      integrator: LIFI_INTEGRATOR,
      ...(LIFI_FEE !== null ? { feeConfig: { name: 'Gully Labs', fee: LIFI_FEE, showFeePercentage: true } } : {}),
      variant: 'compact',
      appearance: 'dark',
      theme,
      fromChain: chainId,
      toChain: chainId,
      fromToken: NATIVE_TOKEN,
      toToken: token,
      chains: { allow: [chainId], types: { allow: [ChainType.EVM] } },
      hiddenUI: { chainSelect: true, allNetworks: true, chainSidebar: true, bridgesSettings: true, toAddress: true, appearance: true, language: true, addressBookConnectedWallets: true },
      walletConfig: { onConnect: () => openConnectModal?.() },
      storageScopeKey: 'gully-swap',
    }),
    [chainId, token, openConnectModal],
  )
  return <LiFiWidget integrator={config.integrator} config={config} />
}

export default function SwapWidget({ chainId, token, chain, ticker }: { chainId: number; token: string; chain: string; ticker: string }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme} modalSize="compact">
          <LifiEvmContext>
            <Widget key={`${chainId}:${token}`} chainId={chainId} token={token} chain={chain} ticker={ticker} />
          </LifiEvmContext>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
