/* Solana JSON-RPC through this site's narrow proxy (POST /api/solana/rpc, server/solana-routes.mjs), so
   the page talks only to its own origin. Only the methods the proxy allows are used here. */

export async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  let r: Response
  try {
    r = await fetch('/api/solana/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  } catch {
    throw new Error('Solana could not be reached through this site just now.')
  }
  const j = (await r.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null
  if (!j || j.error || !r.ok) throw new Error(j?.error?.message ?? `Solana RPC answered ${r.status}.`)
  return j.result as T
}

export const latestBlockhash = () => solRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]).then((r) => r.value)

export async function signatureStatus(sig: string): Promise<{ confirmationStatus: string | null; err: unknown } | null> {
  const r = await solRpc<{ value: ({ confirmationStatus: string | null; err: unknown } | null)[] }>('getSignatureStatuses', [[sig], { searchTransactionHistory: false }])
  return r.value[0] ?? null
}

export const lamportsOf = (owner: string) => solRpc<{ value: number }>('getBalance', [owner, { commitment: 'confirmed' }]).then((r) => BigInt(r.value))

/** The owner's balance of one mint across its token accounts, in raw units, and its largest account with that account's balance. */
export async function tokenBalance(owner: string, mint: string): Promise<{ raw: bigint; account: string | null; best: bigint }> {
  const r = await solRpc<{ value: { pubkey: string; account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>('getTokenAccountsByOwner', [owner, { mint }, { commitment: 'confirmed' }])
  let raw = 0n
  let best: { k: string; v: bigint } | null = null
  for (const a of r.value) {
    const v = BigInt(a.account.data.parsed.info.tokenAmount.amount)
    raw += v
    if (!best || v > best.v) best = { k: a.pubkey, v }
  }
  return { raw, account: best?.k ?? null, best: best?.v ?? 0n }
}

export const sendRaw = (b64: string) => solRpc<string>('sendTransaction', [b64, { encoding: 'base64' }])
