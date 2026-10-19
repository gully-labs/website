import { createRollupPrepareDeploymentParamsConfig, createRollupPrepareTransactionReceipt, createRollupPrepareTransactionRequest, prepareChainConfig, prepareNodeConfig } from '@arbitrum/chain-sdk'
import type { Address, PublicClient, TransactionReceipt } from 'viem'
import { PARENT } from './chain'
import type { CoreContracts, LaunchedChain, LaunchInput, Prepared } from './types'

/* The only file that imports @arbitrum/chain-sdk (Apache-2.0, ops/LAUNCH-FLOW-LICENCES.md). It builds the
   transactions and files; the user's wallet signs the transaction in the browser. Nothing here creates, asks
   for or keeps a private key. A lazy chunk: chain.ts imports it on demand.
   The SDK's types are written for viem 1.x; the app runs viem 2, so the public client is cast at the boundary
   (the runtime calls are the same, checked against the live Arbitrum Sepolia RPC). */

type SdkClient = Parameters<typeof createRollupPrepareDeploymentParamsConfig>[0]

function configOf(input: LaunchInput, client: PublicClient) {
  const chainConfig = prepareChainConfig({
    chainId: input.chainId,
    arbitrum: { InitialChainOwner: input.owner, DataAvailabilityCommittee: input.type === 'anytrust' },
  })
  const config = createRollupPrepareDeploymentParamsConfig(client as unknown as SdkClient, { chainId: BigInt(input.chainId), owner: input.owner, chainConfig })
  return { chainConfig, config }
}

/** The rollup-creation transaction for `account` to sign, built by the SDK against Arbitrum Sepolia. */
export async function prepareLaunch(input: LaunchInput, account: Address, client: PublicClient): Promise<Prepared> {
  const { chainConfig, config } = configOf(input, client)
  const req = await createRollupPrepareTransactionRequest({
    params: { config, batchPosters: input.batchPosters, validators: input.validators },
    account,
    publicClient: client as unknown as Parameters<typeof createRollupPrepareTransactionRequest>[0]['publicClient'],
  })
  if (!req.to || !req.data) throw new Error('The SDK returned no target or call data.')
  return { from: account, to: req.to, data: req.data, value: req.value ?? 0n, gas: req.gas, chainId: PARENT.id, chainConfig: chainConfig as unknown as Record<string, unknown>, stakeToken: config.stakeToken as Address }
}

/** The core contract addresses from the creation transaction's receipt. */
export function coreContractsOf(receipt: TransactionReceipt): CoreContracts {
  const c = createRollupPrepareTransactionReceipt(receipt).getCoreContracts()
  return { ...c } as CoreContracts
}

/** The node config for the chain, from the SDK helper. No private keys: the batch poster and validator stay disabled
    until the operator adds their own keys on their own machine. */
export async function nodeConfigOf(chain: LaunchedChain, core: CoreContracts, client: PublicClient): Promise<Record<string, unknown>> {
  const input: LaunchInput = { name: chain.name, chainId: chain.chainId, type: chain.type, owner: chain.owner, validators: chain.validators, batchPosters: chain.batchPosters }
  const { chainConfig, config } = configOf(input, client)
  return prepareNodeConfig({
    chainName: chain.name,
    chainConfig,
    coreContracts: core as Parameters<typeof prepareNodeConfig>[0]['coreContracts'],
    stakeToken: config.stakeToken,
    parentChainId: PARENT.id,
    parentChainRpcUrl: PARENT.rpc,
  }) as unknown as Record<string, unknown>
}
