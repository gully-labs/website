/** Types for fee-proxy-guard.mjs (shared with the browser's wallet path). See that file. */
export const FEE_PROXY_REGISTRY: Record<number, { erc20: string[]; native: string[] }>
export const SPLIT_PROXIES: Record<number, string>
export const SOLANA_LEDGER_CHAIN_ID: number
export const ALLOWED_TOKENS: Record<number, Record<string, 'USDC' | 'USDT'>>
export const STABLE_SYMBOLS: string[]
export const SEL_PAY: string
export const SEL_APPROVE: string
export const ZERO_ADDRESS: string
export function allFeeProxies(): Set<string>
export function isFeeProxy(a: unknown): boolean
export function allowedToken(chainId: number, token: string | null | undefined): 'USDC' | 'USDT' | null
export function recipientViolations(recipient: unknown, opts?: { chainId?: number | null; label?: string }): string[]
export function assetViolations(asset: { chainId: number; kind: string; symbol?: string; address: string | null } | null | undefined): string[]
export interface DecodedPayCall {
  token: string
  to: string
  amount: bigint
  ref: string
  fee: bigint
  feeAddress: string
}
export function decodePayCall(data: unknown): DecodedPayCall | null
export function decodeApprove(data: unknown): { spender: string; amount: bigint } | null
export interface SplitLike {
  proxy: string
  spender: string
  ref: string
  merchantRaw: string
  feeRaw: string
  feeTo: string
  approve: { to: string; data: string; value?: string }
  approveReset: { to: string; data: string; value?: string }
  pay: { to: string; data: string; value?: string }
}
export function splitViolations(split: SplitLike | null | undefined, ctx: { chainId: number; token: string | null; total: string | bigint; to: string; feeTo: string | null }): string[]
export function txViolations(tx: { to: string; value?: bigint | string | number | null; data?: string | null }): string[]
export function parsePaymentUri(uri: unknown): { scheme: 'ethereum' | 'solana'; token: string | null; chainId: number; to: string; amount: string | null } | null
