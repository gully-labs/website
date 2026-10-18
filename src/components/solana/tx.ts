/* The few Solana primitives the pay button needs, hand-written (no SDK in the bundle): base58, the
   associated token account address (a program-derived address: sha256 plus an ed25519 off-curve check),
   and a legacy transaction carrying a SOL or SPL-token transfer with the Solana Pay reference key.
   Mirrors server/solana.mjs; scripts/test-solana.mjs checks both against the same mainnet fixtures. */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function b58encode(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  let n = 0n
  for (const x of bytes) n = (n << 8n) | BigInt(x)
  let s = ''
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s
    n /= 58n
  }
  return '1'.repeat(zeros) + s
}

export function b58decode(str: string): Uint8Array {
  let zeros = 0
  while (zeros < str.length && str[zeros] === '1') zeros++
  let n = 0n
  for (const c of str) {
    const v = ALPHABET.indexOf(c)
    if (v < 0) throw new Error('not base58')
    n = n * 58n + BigInt(v)
  }
  const out: number[] = []
  while (n > 0n) {
    out.unshift(Number(n & 255n))
    n >>= 8n
  }
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...out])
}

export const SYSTEM_PROGRAM = '11111111111111111111111111111111'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

/* ed25519 point decoding (RFC 8032): a program-derived address must not be a curve point. */
const P = 2n ** 255n - 19n
const mod = (a: bigint) => ((a % P) + P) % P
function pow(b: bigint, e: bigint) {
  let r = 1n
  b = mod(b)
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P
    b = (b * b) % P
    e >>= 1n
  }
  return r
}
const D = mod(-121665n * pow(121666n, P - 2n))
const SQRT_M1 = pow(2n, (P - 1n) / 4n)

export function isOnCurve(b: Uint8Array): boolean {
  if (b.length !== 32) return false
  const sign = b[31] >> 7
  let y = 0n
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? b[i] & 0x7f : b[i])
  if (y >= P) return false
  const y2 = mod(y * y)
  const u = mod(y2 - 1n)
  const v = mod(D * y2 + 1n)
  const v3 = mod(v * v * v)
  const v7 = mod(v3 * v3 * v)
  let x = mod(u * v3 * pow(mod(u * v7), (P - 5n) / 8n))
  const vx2 = mod(v * x * x)
  if (vx2 !== u) {
    if (vx2 === mod(-u)) x = mod(x * SQRT_M1)
    else return false
  }
  return !(x === 0n && sign === 1)
}

const enc = new TextEncoder()

export async function findProgramAddress(seeds: Uint8Array[], programId: string): Promise<string> {
  const prog = b58decode(programId)
  const marker = enc.encode('ProgramDerivedAddress')
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), prog, marker]
    const buf = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
    let o = 0
    for (const p of parts) {
      buf.set(p, o)
      o += p.length
    }
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
    if (!isOnCurve(h)) return b58encode(h)
  }
  throw new Error('no viable bump')
}

export const associatedTokenAddress = (owner: string, mint: string, tokenProgram = TOKEN_PROGRAM) => findProgramAddress([b58decode(owner), b58decode(tokenProgram), b58decode(mint)], ASSOCIATED_TOKEN_PROGRAM)

/* ------------------------------------------------------- legacy message --- */

type Meta = { key: string; signer: boolean; writable: boolean }
export type Ix = { program: string; keys: Meta[]; data: Uint8Array }

function compactU16(n: number): number[] {
  const out: number[] = []
  for (;;) {
    let b = n & 0x7f
    n >>= 7
    if (n) b |= 0x80
    out.push(b)
    if (!n) return out
  }
}

const u64le = (v: bigint) => {
  const b = new Uint8Array(8)
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 255n)
  return b
}

const key32 = (k: string) => {
  const b = b58decode(k)
  if (b.length !== 32) throw new Error(`not a public key: ${k}`)
  return b
}

/** A legacy transaction (one zero-filled signature slot per signer) ready for the wallet to sign. */
export function buildLegacyTx(payer: string, recentBlockhash: string, ixs: Ix[]): Uint8Array {
  const metas = new Map<string, Meta>([[payer, { key: payer, signer: true, writable: true }]])
  const add = (m: Meta) => {
    const cur = metas.get(m.key)
    metas.set(m.key, cur ? { key: m.key, signer: cur.signer || m.signer, writable: cur.writable || m.writable } : { ...m })
  }
  for (const ix of ixs) {
    for (const k of ix.keys) add(k)
    add({ key: ix.program, signer: false, writable: false })
  }
  const all = [...metas.values()]
  const rank = (m: Meta) => (m.signer ? (m.writable ? 0 : 1) : m.writable ? 2 : 3)
  // The fee payer stays first; the rest are grouped as the runtime requires (stable within a group).
  const ordered = [all[0], ...all.slice(1).sort((a, b) => rank(a) - rank(b))]
  const index = new Map(ordered.map((m, i) => [m.key, i]))
  const nSign = ordered.filter((m) => m.signer).length
  const nRoSigned = ordered.filter((m) => m.signer && !m.writable).length
  const nRoUnsigned = ordered.filter((m) => !m.signer && !m.writable).length
  const bytes: number[] = [nSign, nRoSigned, nRoUnsigned, ...compactU16(ordered.length)]
  for (const m of ordered) bytes.push(...key32(m.key))
  bytes.push(...key32(recentBlockhash), ...compactU16(ixs.length))
  for (const ix of ixs) bytes.push(index.get(ix.program)!, ...compactU16(ix.keys.length), ...ix.keys.map((k) => index.get(k.key)!), ...compactU16(ix.data.length), ...ix.data)
  return Uint8Array.from([...compactU16(nSign), ...new Array<number>(64 * nSign).fill(0), ...bytes])
}

/** SystemProgram.transfer, with the Solana Pay reference as an extra read-only key. */
export function solTransferIx(from: string, to: string, lamports: bigint, reference?: string | null): Ix {
  const data = new Uint8Array(12)
  data.set([2, 0, 0, 0])
  data.set(u64le(lamports), 4)
  return { program: SYSTEM_PROGRAM, data, keys: [{ key: from, signer: true, writable: true }, { key: to, signer: false, writable: true }, ...(reference ? [{ key: reference, signer: false, writable: false }] : [])] }
}

/** Associated Token Account program, CreateIdempotent: makes the recipient's account when it is missing, else does nothing. */
export function createAtaIdempotentIx(payer: string, ata: string, owner: string, mint: string, tokenProgram = TOKEN_PROGRAM): Ix {
  return {
    program: ASSOCIATED_TOKEN_PROGRAM,
    data: Uint8Array.of(1),
    keys: [
      { key: payer, signer: true, writable: true },
      { key: ata, signer: false, writable: true },
      { key: owner, signer: false, writable: false },
      { key: mint, signer: false, writable: false },
      { key: SYSTEM_PROGRAM, signer: false, writable: false },
      { key: tokenProgram, signer: false, writable: false },
    ],
  }
}

/** SPL Token TransferChecked (instruction 12), with the reference as an extra read-only key. */
export function transferCheckedIx(source: string, mint: string, dest: string, owner: string, amount: bigint, decimals: number, reference?: string | null, tokenProgram = TOKEN_PROGRAM): Ix {
  const data = new Uint8Array(10)
  data[0] = 12
  data.set(u64le(amount), 1)
  data[9] = decimals
  return {
    program: tokenProgram,
    data,
    keys: [
      { key: source, signer: false, writable: true },
      { key: mint, signer: false, writable: false },
      { key: dest, signer: false, writable: true },
      { key: owner, signer: true, writable: false },
      ...(reference ? [{ key: reference, signer: false, writable: false }] : []),
    ],
  }
}

export const toBase64 = (b: Uint8Array) => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
