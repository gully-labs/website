/* Solana wallets through the Wallet Standard (https://github.com/wallet-standard/wallet-standard), with
   no library: the page announces itself with the `wallet-standard:app-ready` event and listens for
   `wallet-standard:register-wallet`; Phantom, Solflare, Backpack and every other standard wallet
   register themselves that way. Only the features used here are typed. */

export interface WalletAccount {
  address: string
  publicKey: Uint8Array
  chains: readonly string[]
  features: readonly string[]
}

export interface StandardWallet {
  name: string
  icon: string
  chains: readonly string[]
  accounts: readonly WalletAccount[]
  features: Record<string, unknown>
}

type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }> }
type DisconnectFeature = { disconnect: () => Promise<void> }
type SignAndSendFeature = { signAndSendTransaction: (...inputs: { account: WalletAccount; chain: string; transaction: Uint8Array; options?: { skipPreflight?: boolean; commitment?: string } }[]) => Promise<readonly { signature: Uint8Array }[]> }
type SignFeature = { signTransaction: (...inputs: { account: WalletAccount; chain?: string; transaction: Uint8Array }[]) => Promise<readonly { signedTransaction: Uint8Array }[]> }

export const SOLANA_MAINNET = 'solana:mainnet'

const registered = new Set<StandardWallet>()
const listeners = new Set<() => void>()
let started = false

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  const api = {
    register: (...wallets: StandardWallet[]) => {
      for (const w of wallets) registered.add(w)
      listeners.forEach((l) => l())
      return () => {
        for (const w of wallets) registered.delete(w)
        listeners.forEach((l) => l())
      }
    },
  }
  window.addEventListener('wallet-standard:register-wallet', (e: Event) => {
    const cb = (e as CustomEvent<(a: typeof api) => void>).detail
    try {
      cb(api)
    } catch {
      /* a broken wallet must not break the page */
    }
  })
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }))
  } catch {
    /* very old browsers */
  }
}

/** Standard wallets that can sign Solana mainnet transactions, in the order they registered. */
export function solanaWallets(): StandardWallet[] {
  start()
  return [...registered].filter((w) => (w.chains ?? []).some((c) => c.startsWith('solana:')) && 'standard:connect' in w.features && ('solana:signAndSendTransaction' in w.features || 'solana:signTransaction' in w.features))
}

/** Calls `fn` whenever a wallet registers or leaves; returns the unsubscribe. */
export function onWalletsChange(fn: () => void): () => void {
  start()
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export async function connectWallet(w: StandardWallet): Promise<WalletAccount> {
  const { accounts } = await (w.features['standard:connect'] as ConnectFeature).connect()
  const acc = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0]
  if (!acc) throw new Error('The wallet shared no account.')
  return acc
}

export async function disconnectWallet(w: StandardWallet) {
  const f = w.features['standard:disconnect'] as DisconnectFeature | undefined
  await f?.disconnect().catch(() => undefined)
}

/**
 * Has the wallet sign and send a serialized transaction. Wallets with only signTransaction get it
 * signed, then it is sent through `send` (this site's RPC proxy). Resolves to the signature bytes.
 */
export async function signAndSend(w: StandardWallet, account: WalletAccount, tx: Uint8Array, send: (signed: Uint8Array) => Promise<string>): Promise<Uint8Array | string> {
  const ss = w.features['solana:signAndSendTransaction'] as SignAndSendFeature | undefined
  if (ss) {
    const [out] = await ss.signAndSendTransaction({ account, chain: SOLANA_MAINNET, transaction: tx, options: { commitment: 'confirmed' } })
    return out.signature
  }
  const s = w.features['solana:signTransaction'] as SignFeature | undefined
  if (!s) throw new Error('This wallet cannot sign Solana transactions.')
  const [out] = await s.signTransaction({ account, chain: SOLANA_MAINNET, transaction: tx })
  return send(out.signedTransaction)
}
