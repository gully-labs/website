/** An address the logo service accepts: an EVM address, or a Solana mint (base58). Anything else gets the neutral glyph without a request. */
export const servable = (chain: string, token: string) => (chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) : /^0x[0-9a-fA-F]{40}$/.test(token))
