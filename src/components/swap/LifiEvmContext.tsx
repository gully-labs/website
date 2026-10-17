import { ChainType } from '@lifi/sdk'
import { EthereumProvider as EthereumSDKProvider, isBatchingSupported, isDelegationDesignatorCode, isGaslessStep } from '@lifi/sdk-provider-ethereum'
import { EthereumContext, type EthereumProviderContext } from '@lifi/widget-provider'
import { useCallback, useMemo, type PropsWithChildren } from 'react'
import type { Address } from 'viem'
import { useAccount, useConfig, useConnectors } from 'wagmi'
import { connect, disconnect, getAccount, getBytecode, getConnectorClient, getTransactionCount, switchChain } from 'wagmi/actions'

/* Hands the site's own wallet (wagmi v2 + RainbowKit, see pages/developers/walletConfig) to the LI.FI widget.
   LI.FI's @lifi/widget-provider-ethereum does the same for wagmi v3 only, and RainbowKit still needs wagmi v2,
   so this is a port of its "external context" branch (EthereumProviderValues, v4.1.9) to the v2 API: same
   context value, same SDK provider. Rendered around <LiFiWidget>, it makes the widget use this wallet and
   call walletConfig.onConnect (RainbowKit's modal) instead of its own wallet menu. */

export function LifiEvmContext({ children }: PropsWithChildren) {
  const wagmiConfig = useConfig()
  const current = useAccount()
  const connectors = useConnectors()

  const account = useMemo(() => ({ ...current, chainType: ChainType.EVM }), [current])

  const sdkProvider = useMemo(
    () =>
      EthereumSDKProvider({
        getWalletClient: () => getConnectorClient(wagmiConfig, { assertChainId: false }),
        switchChain: async (chainId: number) => {
          const chain = await switchChain(wagmiConfig, { chainId: chainId as (typeof wagmiConfig.chains)[number]['id'] })
          return getConnectorClient(wagmiConfig, { chainId: chain.id })
        },
      }),
    [wagmiConfig],
  )

  const installedWallets = useMemo(() => connectors.filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i), [connectors])

  const handleConnect = useCallback(
    async (idOrName: string, onSuccess?: (address: string, chainId: number) => void) => {
      const connector = installedWallets.find((c) => (c.id ?? c.name) === idOrName)
      if (!connector) return
      const data = await connect(wagmiConfig, { connector })
      if (data.accounts.length > 0) onSuccess?.(data.accounts[0], data.chainId)
    },
    [wagmiConfig, installedWallets],
  )

  const handleDisconnect = useCallback(async () => {
    const { connector } = getAccount(wagmiConfig)
    if (connector) await disconnect(wagmiConfig, { connector })
  }, [wagmiConfig])

  const value = useMemo<EthereumProviderContext>(
    () => ({
      isEnabled: true,
      account,
      sdkProvider,
      installedWallets,
      isConnected: account.isConnected,
      isExternalContext: true,
      connect: handleConnect,
      disconnect: handleDisconnect,
      getBytecode: (chainId, address) => getBytecode(wagmiConfig, { chainId: chainId as (typeof wagmiConfig.chains)[number]['id'], address: address as Address }),
      getTransactionCount: (chainId, address) => getTransactionCount(wagmiConfig, { chainId: chainId as (typeof wagmiConfig.chains)[number]['id'], address: address as Address }),
      isGaslessStep,
      isBatchingSupported,
      isDelegationDesignatorCode,
    }),
    [account, sdkProvider, installedWallets, handleConnect, handleDisconnect, wagmiConfig],
  )

  return <EthereumContext value={value}>{children}</EthereumContext>
}
