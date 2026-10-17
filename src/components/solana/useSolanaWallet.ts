import { useEffect, useState } from 'react'
import { connectWallet, disconnectWallet, onWalletsChange, solanaWallets, type StandardWallet, type WalletAccount } from './walletStandard'

/* Connect a Solana wallet (Phantom, Solflare, Backpack or any Wallet Standard wallet) and remember it for
   this page. Shared by the Solana Pay button and the Jupiter swap card; nothing here holds funds. */

export type Connected = { wallet: StandardWallet; account: WalletAccount }

export function useSolanaWallet() {
  const [wallets, setWallets] = useState<StandardWallet[]>(() => solanaWallets())
  const [conn, setConn] = useState<Connected | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => onWalletsChange(() => setWallets(solanaWallets())), [])

  const connect = async (w: StandardWallet) => {
    setError('')
    setBusy(w.name)
    try {
      setConn({ wallet: w, account: await connectWallet(w) })
    } catch (e) {
      const m = String((e as Error)?.message ?? e)
      setError(/reject|denied|cancel/i.test(m) ? 'The wallet request was declined.' : m.slice(0, 200))
    } finally {
      setBusy(null)
    }
  }
  const disconnect = () => {
    if (conn) void disconnectWallet(conn.wallet)
    setConn(null)
  }
  return { wallets, conn, busy, error, setError, connect, disconnect }
}

export const shortKey = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`
