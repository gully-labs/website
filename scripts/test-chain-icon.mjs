// Gully Chain kit v4 (owner rule: logos pixel perfect): public/chains/gully-chain.svg is brand-kit-v4/logo/gc-icon.svg
// byte for byte (was the older disc-wrapped pack file).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const h = createHash('sha256').update(readFileSync(new URL('../public/chains/gully-chain.svg', import.meta.url))).digest('hex')
const ok = h === '4f86d2a0c2bb1afda317f21ae7c2198564ca61241f2c48cc75df1cb87033739b'
console.log(`${ok ? 'ok  ' : 'FAIL'} public/chains/gully-chain.svg is gc-icon.svg byte for byte (${h.slice(0, 12)})`)
console.log(`\n${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed`)
process.exit(ok ? 0 : 1)
