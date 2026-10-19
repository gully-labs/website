import type { Address, Hex } from 'viem'

/* Shared types of the chain launch flow. Addresses and configuration only: nothing in this folder generates,
   asks for, holds or sends a private key. */

export type ChainType = 'rollup' | 'anytrust'

/** What the wizard collects (the SDK is given exactly this). */
export type LaunchInput = {
  name: string
  chainId: number
  type: ChainType
  owner: Address
  validators: Address[]
  batchPosters: Address[]
}

/** The SDK's prepared rollup-creation transaction, as the Review step shows it and the Deploy step sends it. */
export type Prepared = {
  from: Address
  to: Address
  data: Hex
  value: bigint
  gas?: bigint
  chainId: number
  /** The chain config JSON the SDK built (what ends up in the rollup's genesis config). */
  chainConfig: Record<string, unknown>
  stakeToken: Address
}

export type CoreContracts = {
  rollup: Address
  nativeToken?: Address
  inbox?: Address
  outbox?: Address
  rollupEventInbox?: Address
  challengeManager?: Address
  adminProxy?: Address
  sequencerInbox?: Address
  bridge?: Address
  upgradeExecutor?: Address
  validatorUtils?: Address
  validatorWalletCreator?: Address
  deployedAtBlockNumber?: number
}

/** A chain as GET /api/developer/chains-launch lists it (server/chains-launch.mjs). */
export type LaunchedChain = {
  id: string
  at: string
  by: string
  name: string
  chainId: number
  type: ChainType
  parentChainId: number
  owner: Address
  validators: Address[]
  batchPosters: Address[]
  gasToken: 'ETH'
  txHash: Hex
  status: 'submitted' | 'deployed'
  coreContracts: CoreContracts | null
}

export type ChainsState = { parent: { id: number; name: string }; types: ChainType[]; max: number; chains: LaunchedChain[] }

export type Finalized = { state: 'pending' } | { state: 'failed'; reason: string } | { state: 'deployed'; coreContracts: CoreContracts }
