// Bytecode notes for contracts whose source is not verified (Heimdall-style, much simpler): a linear
// disassembly that lists dispatcher selectors (named where well known), notable opcodes, the minimal-proxy
// pattern, the EIP-1967 slots and the compiler version from the CBOR metadata. These are observations, not
// vulnerability findings: without source the scan cannot judge intent.
//
// tokenControls(notes) groups the token-owner controls among the selectors (mint, blacklist, fee setters, transfer
// limits, a trading switch): what the Gully Score's "Token behaviour" part and the bytecode-only scan report.

import { keccak_256 } from '../vendor/noble.mjs'

const enc = new TextEncoder()
const sel = (sig) => Array.from(keccak_256(enc.encode(sig)).subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join('')

export const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'

const KNOWN = {
  a9059cbb: 'transfer(address,uint256)',
  '23b872dd': 'transferFrom(address,address,uint256)',
  '095ea7b3': 'approve(address,uint256)',
  '18160ddd': 'totalSupply()',
  '70a08231': 'balanceOf(address)',
  dd62ed3e: 'allowance(address,address)',
  '8da5cb5b': 'owner()',
  f2fde38b: 'transferOwnership(address)',
  '715018a6': 'renounceOwnership()',
  '40c10f19': 'mint(address,uint256)',
  '1249c58b': 'mint()',
  '42966c68': 'burn(uint256)',
  '3659cfe6': 'upgradeTo(address)',
  '4f1ef286': 'upgradeToAndCall(address,bytes)',
  '8456cb59': 'pause()',
  '3f4ba83a': 'unpause()',
  '5c975abb': 'paused()',
  '2f2ff15d': 'grantRole(bytes32,address)',
  '91d14854': 'hasRole(bytes32,address)',
  d505accf: 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  '3ccfd60b': 'withdraw()',
  '2e1a7d4d': 'withdraw(uint256)',
  d0e30db0: 'deposit()',
}
/** Token-owner controls by group: the signatures seen in the wild for each (selectors computed, never typed). */
export const CONTROL_SIGS = {
  mint: ['mint(address,uint256)', 'mint(uint256)', 'mint()', 'mintTo(address,uint256)', 'mintFor(address,uint256)'],
  blacklist: ['blacklist(address)', 'unBlacklist(address)', 'unblacklist(address)', 'isBlacklisted(address)', 'blacklisted(address)', 'addBlacklist(address)', 'removeBlacklist(address)', 'setBlacklist(address,bool)', 'blacklistAddress(address,bool)', 'blockAccount(address)', 'unblockAccount(address)', 'setBots(address[],bool)', 'addBot(address)', 'delBot(address)', 'setBlacklisted(address,bool)', 'isBot(address)'],
  fee: ['setFee(uint256)', 'setFees(uint256,uint256)', 'setTaxes(uint256,uint256)', 'setTax(uint256)', 'setBuyTax(uint256)', 'setSellTax(uint256)', 'setBuyFee(uint256)', 'setSellFee(uint256)', 'updateFees(uint256,uint256)', 'updateBuyFees(uint256,uint256,uint256)', 'updateSellFees(uint256,uint256,uint256)', 'setTaxFee(uint256)', 'setFeePercent(uint256)', 'excludeFromFee(address)', 'excludeFromFees(address,bool)', 'setTransferFee(uint256)'],
  limits: ['setMaxTxAmount(uint256)', 'setMaxTx(uint256)', 'setMaxTxPercent(uint256)', 'setMaxWallet(uint256)', 'setMaxWalletAmount(uint256)', 'setMaxWalletPercent(uint256)', 'removeLimits()', 'setLimits(uint256,uint256)', 'updateMaxTxnAmount(uint256)', 'updateMaxWalletAmount(uint256)'],
  trading: ['enableTrading()', 'openTrading()', 'setTradingEnabled(bool)', 'startTrading()', 'setTradingOpen(bool)', 'tradingOpen()', 'tradingEnabled()', 'pause()', 'unpause()'],
}
const CONTROL_SEL = Object.fromEntries(Object.entries(CONTROL_SIGS).map(([k, sigs]) => [k, new Map(sigs.map((s) => [sel(s), s]))]))
for (const m of Object.values(CONTROL_SEL)) for (const [s, sig] of m) KNOWN[s] ??= sig
const PRIVILEGED = new Set(['40c10f19', '1249c58b', '3659cfe6', '4f1ef286', '8456cb59', '3f4ba83a', 'f2fde38b', '2f2ff15d', ...CONTROL_SEL.mint.keys(), ...[...CONTROL_SEL.blacklist.keys()].filter((s) => !/^(fe575a87)$/.test(s))])

/** The token-owner controls among a contract's selectors: { mint, blacklist, fee, limits, trading } as signature lists. */
export function tokenControls(notes) {
  const have = new Set((notes?.selectors ?? []).map((s) => String(s.selector).replace(/^0x/, '')))
  const out = {}
  for (const [k, m] of Object.entries(CONTROL_SEL)) out[k] = [...m].filter(([s]) => have.has(s)).map(([, sig]) => sig)
  return out
}

const OPS = { 0xf4: 'DELEGATECALL', 0xff: 'SELFDESTRUCT', 0xf2: 'CALLCODE', 0xf5: 'CREATE2', 0xf0: 'CREATE', 0xf1: 'CALL', 0x32: 'ORIGIN' }

function metadata(bytes) {
  if (bytes.length < 4) return { codeEnd: bytes.length, solc: null }
  const len = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1]
  if (len <= 0 || len + 2 > bytes.length) return { codeEnd: bytes.length, solc: null }
  const cbor = bytes.subarray(bytes.length - 2 - len, bytes.length - 2)
  const i = Buffer.from(cbor).indexOf(Buffer.from('64736f6c6343', 'hex')) // "solc" + bytes(3)
  const solc = i >= 0 && i + 9 <= cbor.length ? `${cbor[i + 6]}.${cbor[i + 7]}.${cbor[i + 8]}` : null
  return { codeEnd: cbor[0] >= 0xa0 && cbor[0] <= 0xbf ? bytes.length - 2 - len : bytes.length, solc }
}

/** Notes on runtime bytecode (hex string). */
export function bytecodeNotes(hex) {
  const clean = String(hex ?? '').replace(/^0x/, '').toLowerCase()
  const bytes = Buffer.from(clean.length % 2 ? '' : clean, 'hex')
  const notes = { size: bytes.length, empty: bytes.length === 0, minimalProxy: null, selectors: [], opcodes: {}, solc: null }
  if (!bytes.length) return notes
  const m = /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/.exec(clean)
  if (m) notes.minimalProxy = `0x${m[1]}`
  const { codeEnd, solc } = metadata(bytes)
  notes.solc = solc
  const sels = new Set()
  const ops = []
  for (let i = 0; i < codeEnd; i++) {
    const op = bytes[i]
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f
      if (n === 4) ops.push({ op, arg: bytes.subarray(i + 1, i + 5).toString('hex') })
      else ops.push({ op })
      i += n
      continue
    }
    ops.push({ op })
    if (OPS[op]) notes.opcodes[OPS[op]] = (notes.opcodes[OPS[op]] ?? 0) + 1
  }
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].op === 0x63 && ops[k].arg && (ops[k + 1]?.op === 0x14 || ops[k + 2]?.op === 0x14)) sels.add(ops[k].arg)
  }
  notes.selectors = [...sels].map((s) => ({ selector: `0x${s}`, signature: KNOWN[s] ?? null, privileged: PRIVILEGED.has(s) }))
  return notes
}

/** Engine-note findings from bytecode notes (always Info: observations without source). */
export function notesToFindings(notes, { proxyImplementation = null } = {}) {
  const out = []
  const add = (title, description, explanation, recommendation, category = 'bytecode') =>
    out.push({ title, likelihood: 'low', impact: 'none', confidence: 'medium', category, triage: 'engine-note', sources: [{ tool: 'bytecode-notes', detector: null }], locations: [], description, explanation, recommendation, poc: null })
  if (notes.empty) {
    add('No contract code at this address', 'eth_getCode returned empty bytecode.', 'There is no smart contract at this address on this chain (it may be a wallet, or the contract self-destructed).', 'Check the address and chain.')
    return out
  }
  add(
    'Source code is not verified',
    `The runtime bytecode (${notes.size} bytes) has no verified source on Etherscan, Blockscout or Sourcify.`,
    'Nobody can read what this contract does without decompiling it. Unverified contracts cannot be reviewed for logic bugs by this scan.',
    'Verify the source on the block explorer and Sourcify, then run a source scan.',
    'transparency',
  )
  if (notes.minimalProxy) add('Minimal proxy (EIP-1167)', `Delegates every call to ${notes.minimalProxy}.`, 'This is a clone: its behaviour is entirely the implementation contract’s.', `Scan the implementation ${notes.minimalProxy} instead.`, 'proxy')
  if (proxyImplementation) add('Upgradeable proxy (EIP-1967)', `The EIP-1967 implementation slot points to ${proxyImplementation}.`, 'Whoever controls upgrades can replace this contract’s logic at any time.', 'Check who holds the upgrade/admin role and whether it is behind a timelock or multisig; scan the implementation.', 'proxy')
  const priv = notes.selectors.filter((s) => s.privileged)
  if (priv.length) add('Privileged functions present', `Dispatcher selectors include: ${priv.map((s) => s.signature).join(', ')}.`, 'The contract exposes functions such as minting, pausing, upgrading or changing ownership that are usually restricted to an admin.', 'Confirm who holds those roles and how they are protected.', 'access-control')
  const ctl = tokenControls(notes)
  if (ctl.blacklist.length) add('Blacklist functions present', `Selectors include: ${ctl.blacklist.join(', ')}.`, 'Whoever controls the contract can stop chosen wallets from transferring or trading the token.', 'Check who holds that power and whether any wallet is blocked today; a blacklisted holder cannot sell.', 'token-controls')
  if (ctl.fee.length) add('Fee or tax setters present', `Selectors include: ${ctl.fee.join(', ')}.`, 'The owner can change what the token takes on buys, sells or transfers, which can turn a plain token into one that keeps most of every trade.', 'Read the current fees on chain and whether the setters are capped or renounced.', 'token-controls')
  if (ctl.limits.length) add('Adjustable transfer limits', `Selectors include: ${ctl.limits.join(', ')}.`, 'Maximum transaction or wallet limits can be changed by the owner, which can block sells above a size.', 'Check the current limits and who can change them.', 'token-controls')
  if (ctl.trading.length) add('Trading switch present', `Selectors include: ${ctl.trading.join(', ')}.`, 'Trading or transfers can be switched off by the owner.', 'Check whether trading is open and who can close it.', 'token-controls')
  for (const [op, n] of Object.entries(notes.opcodes)) {
    if (op === 'CALL' || op === 'CREATE') continue
    const why = { DELEGATECALL: 'runs another contract’s code with this contract’s storage and balance', SELFDESTRUCT: 'can remove the contract code or force-send its ether', CALLCODE: 'is a deprecated form of delegate call', CREATE2: 'deploys contracts at predictable addresses', ORIGIN: 'reads tx.origin, which is unsafe for authorisation' }[op]
    add(`${op} opcode present`, `${op} appears ${n} time(s) in the runtime code.`, `This opcode ${why}. Whether it is safe depends on the source, which is not available.`, 'Verify the source so its use can be reviewed.', 'bytecode')
  }
  return out
}
