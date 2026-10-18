// Bytecode notes for contracts whose source is not verified (Heimdall-style, much simpler): a linear
// disassembly that lists dispatcher selectors (named where well known), notable opcodes, the minimal-proxy
// pattern, the EIP-1967 slots and the compiler version from the CBOR metadata. These are observations, not
// vulnerability findings: without source the scan cannot judge intent.

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
const PRIVILEGED = new Set(['40c10f19', '1249c58b', '3659cfe6', '4f1ef286', '8456cb59', '3f4ba83a', 'f2fde38b', '2f2ff15d'])

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
  for (const [op, n] of Object.entries(notes.opcodes)) {
    if (op === 'CALL' || op === 'CREATE') continue
    const why = { DELEGATECALL: 'runs another contract’s code with this contract’s storage and balance', SELFDESTRUCT: 'can remove the contract code or force-send its ether', CALLCODE: 'is a deprecated form of delegate call', CREATE2: 'deploys contracts at predictable addresses', ORIGIN: 'reads tx.origin, which is unsafe for authorisation' }[op]
    add(`${op} opcode present`, `${op} appears ${n} time(s) in the runtime code.`, `This opcode ${why}. Whether it is safe depends on the source, which is not available.`, 'Verify the source so its use can be reviewed.', 'bytecode')
  }
  return out
}
