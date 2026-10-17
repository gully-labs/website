import '@rainbow-me/rainbowkit/styles.css'
import { ChainType } from '@lifi/sdk'
import { LiFiWidget, type WidgetConfig } from '@lifi/widget'
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo } from 'react'
import { WagmiProvider } from 'wagmi'
import { queryClient, wagmiConfig, walletTheme } from '../../pages/developers/walletConfig'
import { LifiEvmContext } from './LifiEvmContext'
import { LIFI_FEE, LIFI_INTEGRATOR, NATIVE_TOKEN } from './swapConfig'

/* The LI.FI widget for one stock token, locked to that token's chain. Its own lazy chunk, loaded only after the
   visitor has acknowledged the notice on a stock page. The wallet is the site's own (wagmi + RainbowKit); the
   widget finds routes through li.quest and the wallet signs; Gully Labs never holds funds. */

const font = "'Hanken Grotesk', sans-serif"

const theme: WidgetConfig['theme'] = {
  container: { border: 'none', borderRadius: 0, boxShadow: 'none', maxWidth: '100%', minWidth: 0, background: '#10141A' },
  shape: { borderRadius: 10, borderRadiusSecondary: 6 },
  typography: { fontFamily: font },
  colorSchemes: {
    dark: {
      palette: {
        primary: { main: '#E8C060', contrastText: '#0B0E13' },
        secondary: { main: '#F4D98C' },
        success: { main: '#6FCF6A' },
        error: { main: '#FF8A7A' },
        background: { default: '#0B0E13', paper: '#10141A' },
        text: { primary: '#EEF0F2', secondary: '#A6B0BD' },
        grey: { 200: '#EEF0F2', 300: '#CFD5DC', 700: '#3A4452', 800: '#1D232C' },
      },
    },
  },
}

function Widget({ chainId, token }: { chainId: number; token: string }) {
  const { openConnectModal } = useConnectModal()
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

export default function SwapWidget({ chainId, token }: { chainId: number; token: string }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme} modalSize="compact">
          <LifiEvmContext>
            <Widget key={`${chainId}:${token}`} chainId={chainId} token={token} />
          </LifiEvmContext>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
