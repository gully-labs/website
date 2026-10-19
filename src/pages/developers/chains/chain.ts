import { createPublicClient, http, type Address, type Hex } from 'viem'
import { arbitrumSepolia } from 'viem/chains'
import { isLocalHost } from '../../../site-host'
import type { CoreContracts, Finalized, LaunchedChain, LaunchInput, Prepared } from './types'

/* The light side of the launch flow: the parent chain (Arbitrum Sepolia, the only one: testnet only), and the
   seam between the pages and the Arbitrum chain SDK. The SDK itself (sdk.ts) is a lazy chunk, loaded only when a
   transaction is prepared or a result is read. On localhost a test may install window.__GULLY_CHAINS_STUB__ to
   replace the SDK's prepare, finalize and node-config steps, so no real chain is ever touched in tests; the stub
   is ignored on every other host. */

export const PARENT = { id: 421614, name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io' } as const

const makeClient = () => createPublicClient({ chain: arbitrumSepolia, transport: http(PARENT.rpc) })
let client: ReturnType<typeof makeClient> | null = null
export const parentClient = () => (client ??= makeClient())

export type Stub = {
  prepare?: (input: LaunchInput, account: Address) => Promise<Prepared>
  finalize?: (txHash: Hex) => Promise<Finalized>
  nodeConfig?: (chain: LaunchedChain) => Promise<Record<string, unknown>>
}
const stub = (): Stub | undefined => (isLocalHost() && typeof window !== 'undefined' ? (window as unknown as { __GULLY_CHAINS_STUB__?: Stub }).__GULLY_CHAINS_STUB__ : undefined)
/** True when a test stub replaces the SDK's prepare step (no wallet is needed to look at the review). */
export const stubbed = () => !!stub()?.prepare

/** The SDK builds the rollup-creation transaction for `account` to sign. Read-only: it asks the parent chain for fees and gas. */
export async function prepareLaunch(input: LaunchInput, account: Address): Promise<Prepared> {
  const s = stub()
  if (s?.prepare) return s.prepare(input, account)
  const sdk = await import('./sdk')
  return sdk.prepareLaunch(input, account, parentClient())
}

/** Reads a submitted deployment's receipt: still pending, failed, or deployed with its core contract addresses (via the SDK). */
export async function finalize(txHash: Hex): Promise<Finalized> {
  const s = stub()
  if (s?.finalize) return s.finalize(txHash)
  let receipt
  try {
    receipt = await parentClient().getTransactionReceipt({ hash: txHash })
  } catch {
    return { state: 'pending' }
  }
  if (receipt.status !== 'success') return { state: 'failed', reason: 'The transaction was mined but reverted. Nothing was deployed; you can launch again.' }
  const sdk = await import('./sdk')
  return { state: 'deployed', coreContracts: sdk.coreContractsOf(receipt) }
}

/** The node config JSON from the SDK's prepareNodeConfig. It holds NO keys: the batch poster and validator are left disabled. */
export async function nodeConfigFor(chain: LaunchedChain): Promise<Record<string, unknown>> {
  const s = stub()
  if (s?.nodeConfig) return s.nodeConfig(chain)
  if (!chain.coreContracts) throw new Error('This chain has no core contract addresses yet.')
  const sdk = await import('./sdk')
  return sdk.nodeConfigOf(chain, chain.coreContracts as CoreContracts, parentClient())
}
