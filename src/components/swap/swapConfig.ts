/* Build-time settings for the stock-page swap, read once. Nothing here is hard-coded per owner rule:
   VITE_LIFI_INTEGRATOR  the integrator name registered in the LI.FI portal (fees are paid to the wallet set there)
   VITE_LIFI_FEE         the integrator fee as a fraction, e.g. 0.003 for 0.3%; only used with a registered integrator
   Unset integrator: "gullylabs" is sent (LI.FI requires a name) and no fee is charged. */

const env = import.meta.env as Record<string, string | undefined>
const registered = env.VITE_LIFI_INTEGRATOR?.trim() || ''
const feeRaw = Number(env.VITE_LIFI_FEE?.trim() || '')

export const LIFI_INTEGRATOR = registered || 'gullylabs'
/** The fee as a fraction (0.003 = 0.3%), or null for none. Never set without a registered integrator. */
export const LIFI_FEE: number | null = registered && Number.isFinite(feeRaw) && feeRaw > 0 && feeRaw < 0.1 ? feeRaw : null

export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
/** Chain ids LI.FI uses for the chains the tracker follows. */
export const SWAP_CHAIN_ID: Record<string, number> = { robinhood: 4663, bsc: 56 }
export const NATIVE_SYMBOL: Record<string, string> = { robinhood: 'ETH', bsc: 'BNB' }

export const feeText = () => (LIFI_FEE === null ? 'Gully Labs adds no fee.' : `Gully Labs adds a ${+(LIFI_FEE * 100).toFixed(3)}% fee to each swap, shown in the quote before you confirm.`)
