// Input validation for createScan. Everything the caller (part 2's HTTP layer) passes is untrusted.
//
// Accepted shapes (input.kind):
//   address  { kind:'address', chain: 'base' | 8453, address: '0x…' }
//   github   { kind:'github',  repo: 'https://github.com/<owner>/<repo>', commit?: '<7-40 hex>', ref?: '<branch|tag>' }
//   upload   { kind:'upload',  filename: 'x.zip' | 'X.sol', data: Buffer | base64 string }
//   web2     { kind:'web2',    repo, commit?/ref? }  or  { kind:'web2', filename: 'x.zip', data }
// web2 is the checklist mode for JS/TS backends.

import { config } from './config.mjs'
import { CHAINS, resolveChain } from './chains.mjs'
import { sanitizePath } from './archive.mjs'
import { sha256 } from './source.mjs'

export class ScanInputError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

const GH_RE = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/
const REF_RE = /^(?!.*\.\.)(?!\/)(?!.*\/\/)[A-Za-z0-9._/-]{1,120}(?<!\/)$/

function parseRepo(input) {
  const m = GH_RE.exec(String(input.repo ?? '').trim())
  if (!m || m[2] === '.' || m[2] === '..') throw new ScanInputError('bad-repo', 'repo must be a public GitHub URL like https://github.com/owner/name')
  const commit = input.commit == null ? null : String(input.commit).trim().toLowerCase()
  if (commit !== null && !/^[0-9a-f]{7,40}$/.test(commit)) throw new ScanInputError('bad-commit', 'commit must be 7 to 40 hex characters')
  const ref = input.ref == null ? null : String(input.ref).trim()
  if (ref !== null && !REF_RE.test(ref)) throw new ScanInputError('bad-ref', 'ref is not a valid branch or tag name')
  if (!commit && !ref) throw new ScanInputError('missing-commit', 'give the commit to scan (a report always names one exact commit)')
  return { url: `https://github.com/${m[1]}/${m[2]}`, owner: m[1], name: m[2], ref: commit ?? ref, commit }
}

function parseUpload(input, { allowSol }) {
  const filename = sanitizePath(String(input.filename ?? '').split(/[\\/]/).pop() ?? '')
  if (!filename) throw new ScanInputError('bad-filename', 'filename is required')
  const isZip = /\.zip$/i.test(filename)
  const isSol = /\.sol$/i.test(filename)
  if (!isZip && !(allowSol && isSol)) throw new ScanInputError('bad-filetype', allowSol ? 'upload a .zip of Solidity files or a single .sol file' : 'upload a .zip of the repository')
  let data = input.data
  if (typeof data === 'string') {
    if (!/^[A-Za-z0-9+/=\s]*$/.test(data)) throw new ScanInputError('bad-upload', 'data must be bytes or base64')
    data = Buffer.from(data, 'base64')
  }
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) throw new ScanInputError('bad-upload', 'data must be bytes or base64')
  data = Buffer.from(data)
  if (!data.length) throw new ScanInputError('empty-upload', 'the upload is empty')
  if (data.length > config.maxUploadBytes()) throw new ScanInputError('upload-too-large', `the upload is larger than ${config.maxUploadBytes()} bytes`, 413)
  if (isZip && data.readUInt32LE(0) !== 0x04034b50) throw new ScanInputError('bad-upload', 'the file is not a zip archive')
  if (isSol && data.includes(0)) throw new ScanInputError('bad-upload', 'the .sol file is not text')
  return { filename, data, sha256: sha256(data), bytes: data.length, archive: isZip ? 'zip' : 'sol' }
}

/**
 * Validates and normalises an input. Returns { kind, public, private }: `public` is safe to store and show
 * (no bytes), `private` carries the upload bytes for the scan folder.
 */
export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ScanInputError('bad-input', 'input must be an object')
  const kind = String(input.kind ?? '')
  if (kind === 'address') {
    const chainId = resolveChain(input.chain ?? input.chainId)
    if (!chainId) throw new ScanInputError('bad-chain', `chain must be one of: ${Object.values(CHAINS).map((c) => c.key).join(', ')}`)
    const address = String(input.address ?? '').trim().toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new ScanInputError('bad-address', 'address must be a 0x-prefixed 20-byte hex address')
    if (/^0x0{40}$/.test(address)) throw new ScanInputError('bad-address', 'the zero address has no code')
    return { kind, public: { chainId, chain: CHAINS[chainId].key, address }, private: null }
  }
  if (kind === 'github') return { kind, public: { repo: parseRepo(input) }, private: null }
  if (kind === 'upload') {
    const u = parseUpload(input, { allowSol: true })
    return { kind, public: { upload: { name: u.filename, sha256: u.sha256, bytes: u.bytes, archive: u.archive } }, private: { data: u.data } }
  }
  if (kind === 'web2') {
    if (input.repo) return { kind, public: { source: 'github', repo: parseRepo(input) }, private: null }
    const u = parseUpload(input, { allowSol: false })
    return { kind, public: { source: 'upload', upload: { name: u.filename, sha256: u.sha256, bytes: u.bytes, archive: u.archive } }, private: { data: u.data } }
  }
  throw new ScanInputError('bad-kind', 'kind must be address, github, upload or web2')
}

/** True when two normalised inputs name the same thing (duplicate-scan guard). */
export function sameTarget(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
