// Token logos for the whole stack: GET /api/logo/:chain/:address(.png)?s=64|128|256.
//
// resolveTokenLogo(chain, address, { symbol }) tries these sources in order; the first image that passes
// every check wins:
//   1. deepcore     DeepCore's launch token list (GET /v1/chains/:id/tokenlists/launches.json, logoURI)
//   2. dexscreener  DexScreener pairs where the token is the BASE token (info.imageUrl belongs to the base)
//   3. jupiter      Solana: Jupiter's token API (lite-api.jup.ag tokens v2, `icon`)
//      xstocks      tokenised stocks the tracker follows (server/data/*-stocks.json): Backed's official
//                   xStocks logo, the same file api.xstocks.fi lists as an asset's `logo`
//   4. coingecko    CoinGecko's keyless /coins/{platform}/contract/{address} (`image.large`)
//   5. trustwallet  Trust Wallet's assets repo (MIT), blockchains/{chain}/assets/{checksum}/logo.png
// A chain a source does not cover is skipped for that source.
//
// Safety: every upstream read is server-side, https only, at most 3 redirects, 8 s in all, and every hop's
// host is resolved and refused when any address is private, loopback, link-local or otherwise not public;
// the connection is pinned to the checked address (no DNS rebinding). Images are capped at 2 MB, must be
// PNG, JPEG, WebP or GIF by their magic bytes (the content type alone never decides), SVG is refused
// outright, and the stated dimensions must be 16 to 4096 px. The image is decoded and re-encoded by resvg
// (WebAssembly, already used for the OG cards) into fresh PNGs at 64, 128 and 256 px: nothing of the
// original file (metadata, colour profiles, extra chunks) survives. resvg 2.6.2 decodes PNG, JPEG and GIF;
// a WebP passes the gate but cannot be decoded, so that source counts as a miss and the next one is tried.
//
// Cache: DATA_DIR/logos/<chain>/<address>-<size>.png plus DATA_DIR/logos/index.json; at most 5,000 tokens
// and 200 MB, least recently used out first. "None found" is remembered for 24 h (15 min when a source
// was skipped for its rate limit), and a found logo is re-resolved in the background after 7 days.
//
// Serving: Cache-Control public 1 day, a strong ETag (304 on If-None-Match), CORS *, and the kit's neutral
// token glyph (the site's own fallback disc: surface-deep, a slate hairline ring, the line icon; no letters)
// for anything unknown. X-Logo-Source names the source for debugging and is not exposed to pages (no
// Access-Control-Expose-Headers). Upstream URLs are never logged, sent or stored outside index.json's
// source name.

import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientIp, DATA_DIR } from './http.mjs'
import { loadResvg } from './og.mjs'
import { keccak_256 } from './vendor/noble.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const LOGO_SIZES = [64, 128, 256]
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_JSON_BYTES = 4 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3
const MIN_DIM = 16
const MAX_DIM = 4096
const NEG_TTL_MS = 24 * 3600_000
const NEG_PARTIAL_TTL_MS = 15 * 60_000
const REFRESH_AFTER_MS = 7 * 24 * 3600_000
const MAX_ENTRIES = 5_000
const MAX_BYTES = 200 * 1024 * 1024
const UA = 'gullylabs-logos/1 (+https://gullylabs.xyz)'
const ACCEPT_IMAGE = 'image/png,image/jpeg;q=0.9,image/gif;q=0.8,image/webp;q=0.1'

/* ---------------------------------------------------------------- chains --- */

/** Our chain keys and each source's id for them (null = that source does not cover the chain). */
export const LOGO_CHAINS = {
  robinhood: { evm: true, deepcore: 4663, dexscreener: 'robinhood', coingecko: 'robinhood', trustwallet: null },
  bsc: { evm: true, deepcore: 56, dexscreener: 'bsc', coingecko: 'binance-smart-chain', trustwallet: 'smartchain' },
  base: { evm: true, deepcore: 8453, dexscreener: 'base', coingecko: 'base', trustwallet: 'base' },
  hyperevm: { evm: true, deepcore: 999, dexscreener: 'hyperevm', coingecko: 'hyperevm', trustwallet: 'hyperevm' },
  solana: { evm: false, deepcore: null, dexscreener: 'solana', coingecko: 'solana', trustwallet: 'solana' },
  gully: { evm: true, deepcore: null, dexscreener: null, coingecko: null, trustwallet: null },
  ethereum: { evm: true, deepcore: null, dexscreener: 'ethereum', coingecko: 'ethereum', trustwallet: 'ethereum' },
  arbitrum: { evm: true, deepcore: null, dexscreener: 'arbitrum', coingecko: 'arbitrum-one', trustwallet: 'arbitrum' },
  optimism: { evm: true, deepcore: null, dexscreener: 'optimism', coingecko: 'optimistic-ethereum', trustwallet: 'optimism' },
  polygon: { evm: true, deepcore: null, dexscreener: 'polygon', coingecko: 'polygon-pos', trustwallet: 'polygon' },
  avalanche: { evm: true, deepcore: null, dexscreener: 'avalanche', coingecko: 'avalanche', trustwallet: 'avalanchec' },
}
const CHAIN_ALIAS = { bnb: 'bsc', eth: 'ethereum', mainnet: 'ethereum', 'arbitrum-one': 'arbitrum', op: 'optimism', matic: 'polygon', avax: 'avalanche', hyperliquid: 'hyperevm', sol: 'solana' }

/** A chain key or alias to our key, or null. */
export function logoChainKey(chain) {
  const k = String(chain ?? '').trim().toLowerCase()
  return LOGO_CHAINS[k] ? k : CHAIN_ALIAS[k] ?? null
}

/** The token's address in the form the cache keys use (EVM lower case, Solana as given), or null. */
export function normaliseAddress(chain, address) {
  const a = String(address ?? '').trim()
  if (LOGO_CHAINS[chain]?.evm) return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null
  if (chain === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null
  return null
}

/** EIP-55 checksum of a lower-case 0x address (Trust Wallet's folder names). */
export function checksum(addr) {
  const a = addr.toLowerCase().replace(/^0x/, '')
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString('hex')
  let out = '0x'
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i]
  return out
}

/* ------------------------------------------------------------ SSRF guard --- */

const BLOCKED = new net.BlockList()
for (const [a, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCKED.addSubnet(a, bits, 'ipv4')
// (No ::ffff:0:0/96 rule: BlockList checks IPv4 against IPv6 rules as v4-mapped, so it would block every IPv4.
// isPrivateAddress unwraps a v4-mapped address and checks the IPv4 rules instead.)
for (const [a, bits] of [['::', 127], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) BLOCKED.addSubnet(a, bits, 'ipv6')

/** True for any address that is not public unicast: RFC 1918, loopback, link-local, CGNAT, ULA, multicast, … */
export function isPrivateAddress(ip) {
  const kind = net.isIP(ip)
  if (!kind) return true
  if (kind === 6) {
    const m = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (m) return isPrivateAddress(m[1])
  }
  return BLOCKED.check(ip, kind === 4 ? 'ipv4' : 'ipv6')
}

class LogoError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
  }
}

/** Default DNS: every address of the host. */
const dnsLookup = async (host) => dns.lookup(host, { all: true, verbatim: true })

/** Default transport: one https GET pinned to the checked address. Resolves { status, headers, body, close }. */
function httpsTransport(url, target, { headers, signal }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers,
      signal,
      lookup: (_h, opts, cb) => (opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)),
    }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, close: () => res.destroy() }))
    req.on('error', reject)
    req.end()
  })
}

/* ---------------------------------------------------------------- images --- */

/** The image kind by magic bytes: 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | null. */
export function sniffImage(b) {
  if (b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'gif'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  const head = b.toString('utf8', 0, Math.min(b.length, 512)).replace(/^﻿/, '').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || (head.startsWith('<!doctype svg'))) return 'svg'
  return null
}

/** Width and height as the file states them, or null when they cannot be read. */
export function imageSize(b, kind) {
  try {
    if (kind === 'png') return b.length >= 24 && b.toString('latin1', 12, 16) === 'IHDR' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null
    if (kind === 'gif') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
    if (kind === 'jpeg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1]
        if (m === 0xff) { i++; continue }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
        i += 2 + b.readUInt16BE(i + 2)
      }
      return null
    }
    if (kind === 'webp') {
      const c = b.toString('latin1', 12, 16)
      if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
      if (c === 'VP8L') { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) } }
      if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    }
  } catch {
    return null
  }
  return null
}

const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/** Checks fetched bytes and returns { kind, w, h } or throws a LogoError. */
export function checkImage(buf, contentType = '') {
  if (buf.length > MAX_IMAGE_BYTES) throw new LogoError('too-large')
  const ct = String(contentType).split(';')[0].trim().toLowerCase()
  if (ct.includes('svg')) throw new LogoError('svg')
  const kind = sniffImage(buf)
  if (kind === 'svg') throw new LogoError('svg')
  if (!kind) throw new LogoError('not-image')
  if (ct && !ct.startsWith('image/') && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream') throw new LogoError('not-image', 'content type')
  const dim = imageSize(buf, kind)
  if (!dim || dim.w < MIN_DIM || dim.h < MIN_DIM || dim.w > MAX_DIM || dim.h > MAX_DIM) throw new LogoError('bad-size')
  return { kind, ...dim }
}

/** Decodes a checked image and re-encodes it as PNG at every size: { 64: Buffer, 128: Buffer, 256: Buffer }. */
export async function renderSizes(buf, kind) {
  if (kind === 'webp') throw new LogoError('undecodable', 'webp')
  const { Resvg } = await loadResvg()
  const href = `data:${MIME[kind]};base64,${buf.toString('base64')}`
  const out = {}
  for (const s of LOGO_SIZES) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><image x="0" y="0" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet" href="${href}"/></svg>`
    const r = new Resvg(svg, { fitTo: { mode: 'original' }, imageRendering: 0 })
    const img = r.render()
    try {
      const px = img.pixels
      let seen = false
      for (let i = 3; i < px.length; i += 4) if (px[i]) { seen = true; break }
      if (!seen) throw new LogoError('undecodable')
      out[s] = Buffer.from(img.asPng())
    } finally {
      img.free()
      r.free()
    }
  }
  return out
}

/* ---------------------------------------------------------- fallback glyph --- */

// The kit's neutral token glyph, drawn exactly like the site's Logo fallback (src/components/logos/Logo.tsx):
// a surface-deep disc, a slate hairline ring, and the line icon (lucide circle-dollar-sign) in text-muted at
// 56 % of the disc. Colours are the kit tokens (src/index.css / public/brand/tokens). No letters.
export function fallbackSvg(s) {
  const ring = Math.max(1, s / 32)
  const g = Math.round(s * 0.56)
  const o = (s - g) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
    `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - ring / 2}" fill="#111923" stroke="#2a3542" stroke-width="${ring}"/>` +
    `<g transform="translate(${o} ${o}) scale(${g / 24})" fill="none" stroke="#aeb5be" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">` +
    '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></g></svg>'
}

const fallbackCache = new Map()
/** The fallback glyph as PNG bytes at one of LOGO_SIZES. */
export async function fallbackPng(s) {
  if (fallbackCache.has(s)) return fallbackCache.get(s)
  const { Resvg } = await loadResvg()
  const r = new Resvg(fallbackSvg(s), { fitTo: { mode: 'original' }, shapeRendering: 2 })
  const img = r.render()
  const png = Buffer.from(img.asPng())
  img.free()
  r.free()
  fallbackCache.set(s, png)
  return png
}

/* ----------------------------------------------------------- rate limits --- */

/** A token bucket per upstream (requests per minute), with exponential backoff after 429 / 5xx. */
class Bucket {
  constructor(perMin, now) {
    this.cap = Math.max(1, Math.ceil(perMin / 6))
    this.rate = perMin / 60_000
    this.tokens = this.cap
    this.now = now
    this.last = now()
    this.pausedUntil = 0
    this.strikes = 0
  }
  take() {
    const t = this.now()
    if (t < this.pausedUntil) return false
    this.tokens = Math.min(this.cap, this.tokens + (t - this.last) * this.rate)
    this.last = t
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
  backoff(retryAfterS) {
    this.strikes = Math.min(this.strikes + 1, 6)
    const ms = Number.isFinite(retryAfterS) && retryAfterS > 0 ? Math.min(600, retryAfterS) * 1000 : Math.min(600_000, 15_000 * 2 ** this.strikes)
    this.pausedUntil = this.now() + ms
  }
  ok() {
    this.strikes = 0
  }
}

/* ------------------------------------------------------------ the service --- */

const readJsonFile = (p, fb) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fb
  }
}

/** Tokenised stocks the tracker follows, by chain key and address: { ticker }. */
function loadStocks() {
  const m = new Map()
  for (const [chain, file] of [['robinhood', 'robinhood-stocks.json'], ['bsc', 'bsc-stocks.json'], ['solana', 'solana-stocks.json']]) {
    const t = readJsonFile(path.join(HERE, 'data', file), { stocks: [] })
    for (const s of t.stocks ?? []) {
      if (!s?.token || !s?.ticker) continue
      const a = normaliseAddress(chain, s.token)
      if (a) m.set(`${chain}/${a}`, { ticker: String(s.backedSymbol ?? s.ticker).replace(/[^A-Za-z0-9.]/g, '') })
    }
  }
  return m
}

/**
 * One logo service. Everything it talks to can be replaced for tests: `transport` (one pinned https GET),
 * `lookup` (DNS), `now`, `dataDir`, the endpoints in `endpoints`, and the limits.
 */
export function createTokenLogos(opts = {}) {
  const now = opts.now ?? Date.now
  const transport = opts.transport ?? httpsTransport
  const lookup = opts.lookup ?? dnsLookup
  const dir = opts.dataDir ?? path.join(DATA_DIR, 'logos')
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES
  const maxBytes = opts.maxBytes ?? MAX_BYTES
  const concurrency = opts.concurrency ?? 4
  const maxQueue = opts.maxQueue ?? 64
  const perIpPerMin = opts.perIpPerMin ?? 240
  const perIpResolvesPerMin = opts.perIpResolvesPerMin ?? 30
  const log = opts.log ?? ((m) => console.warn(`token-logos: ${m}`))
  const ep = {
    deepcore: String(opts.endpoints?.deepcore ?? process.env.DEEPCORE_API ?? 'https://api.deepcore.fun').replace(/\/+$/, ''),
    dexscreener: opts.endpoints?.dexscreener ?? 'https://api.dexscreener.com',
    jupiter: opts.endpoints?.jupiter ?? 'https://lite-api.jup.ag',
    xstocks: opts.endpoints?.xstocks ?? 'https://xstocks-metadata.backed.fi',
    coingecko: opts.endpoints?.coingecko ?? 'https://api.coingecko.com',
    trustwallet: opts.endpoints?.trustwallet ?? 'https://raw.githubusercontent.com',
  }
  const perMin = { deepcore: 30, dexscreener: 50, jupiter: 50, xstocks: 30, coingecko: 8, trustwallet: 60, images: 120, ...opts.perMin }
  const buckets = Object.fromEntries(Object.entries(perMin).map(([k, v]) => [k, new Bucket(v, now)]))
  const stocks = opts.stocks ?? loadStocks()

  /* ---- guarded fetch ---- */

  async function guardedGet(raw, { accept, max, bucket }) {
    const deadline = now() + FETCH_TIMEOUT_MS
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    try {
      let url
      try {
        url = new URL(raw)
      } catch {
        throw new LogoError('bad-url')
      }
      for (let hop = 0; ; hop++) {
        if (url.protocol !== 'https:') throw new LogoError('not-https')
        if (url.username || url.password) throw new LogoError('bad-url')
        const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
        if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) throw new LogoError('private')
        let addrs
        if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }]
        else {
          try {
            addrs = await lookup(host)
          } catch {
            throw new LogoError('dns')
          }
        }
        if (!addrs?.length) throw new LogoError('dns')
        if (addrs.some((a) => isPrivateAddress(a.address))) throw new LogoError('private')
        if (now() > deadline) throw new LogoError('timeout')
        let r
        try {
          r = await transport(url, addrs[0], { headers: { accept, 'user-agent': UA, 'accept-encoding': 'identity' }, signal: ac.signal })
        } catch (e) {
          throw new LogoError(ac.signal.aborted ? 'timeout' : 'network', String(e?.code ?? ''))
        }
        if ([301, 302, 303, 307, 308].includes(r.status)) {
          r.close?.()
          const loc = r.headers?.location
          if (!loc || hop >= MAX_REDIRECTS) throw new LogoError('redirects')
          try {
            url = new URL(String(loc), url)
          } catch {
            throw new LogoError('bad-url')
          }
          continue
        }
        if (r.status === 429 || r.status >= 500) {
          r.close?.()
          bucket?.backoff(Number(r.headers?.['retry-after']))
          throw new LogoError('upstream-busy', String(r.status))
        }
        if (r.status !== 200) {
          r.close?.()
          throw new LogoError('status', String(r.status))
        }
        const len = Number(r.headers?.['content-length'])
        if (Number.isFinite(len) && len > max) {
          r.close?.()
          throw new LogoError('too-large')
        }
        const chunks = []
        let n = 0
        if (Buffer.isBuffer(r.body)) {
          if (r.body.length > max) throw new LogoError('too-large')
          chunks.push(r.body)
        } else {
          for await (const c of r.body) {
            n += c.length
            if (n > max) {
              r.close?.()
              throw new LogoError('too-large')
            }
            chunks.push(c)
          }
        }
        bucket?.ok()
        return { body: Buffer.concat(chunks), contentType: String(r.headers?.['content-type'] ?? '') }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function getJson(url, bucket) {
    const { body } = await guardedGet(url, { accept: 'application/json', max: MAX_JSON_BYTES, bucket })
    try {
      return JSON.parse(body.toString('utf8'))
    } catch {
      throw new LogoError('bad-json')
    }
  }

  const httpsUrl = (u) => {
    if (typeof u !== 'string' || u.length > 2048) return null
    const s = u.trim().replace(/^ipfs:\/\/(ipfs\/)?/i, 'https://ipfs.io/ipfs/')
    return /^https:\/\//i.test(s) ? s : null
  }

  /* ---- sources: each returns candidate image URLs (never shown to anyone) ---- */

  const deepcoreLists = new Map() // chainId -> { at, map }
  const sources = [
    {
      id: 'deepcore',
      supports: (c) => !!LOGO_CHAINS[c].deepcore,
      async candidates(c, a) {
        const id = LOGO_CHAINS[c].deepcore
        let hit = deepcoreLists.get(id)
        if (!hit || now() - hit.at > 10 * 60_000) {
          if (!buckets.deepcore.take()) throw new LogoError('rate-limited')
          const j = await getJson(`${ep.deepcore}/v1/chains/${id}/tokenlists/launches.json`, buckets.deepcore)
          const map = new Map()
          for (const t of Array.isArray(j?.tokens) ? j.tokens : []) {
            const x = t?.extensions?.deepcore ?? {}
            const img = httpsUrl(t?.logoURI) ?? httpsUrl(x.logoURI) ?? httpsUrl(x.image) ?? httpsUrl(x.imageUrl) ?? httpsUrl(x.logo)
            if (img && typeof t?.address === 'string') map.set(t.address.toLowerCase(), img)
          }
          hit = { at: now(), map }
          deepcoreLists.set(id, hit)
        }
        const u = hit.map.get(a.toLowerCase())
        return u ? [u] : []
      },
    },
    {
      id: 'dexscreener',
      supports: (c) => !!LOGO_CHAINS[c].dexscreener,
      async candidates(c, a, { symbol }) {
        const chainId = LOGO_CHAINS[c].dexscreener
        const pick = (pairs) => {
          const mine = (Array.isArray(pairs) ? pairs : []).filter((p) => p?.chainId === chainId && String(p?.baseToken?.address ?? '').toLowerCase() === a.toLowerCase() && p?.info?.imageUrl)
          mine.sort((x, y) => (Number(y?.liquidity?.usd) || 0) - (Number(x?.liquidity?.usd) || 0))
          if (symbol) mine.sort((x, y) => Number(String(y.baseToken.symbol).toUpperCase() === symbol.toUpperCase()) - Number(String(x.baseToken.symbol).toUpperCase() === symbol.toUpperCase()))
          return [...new Set(mine.map((p) => httpsUrl(p.info.imageUrl)).filter(Boolean))]
        }
        if (!buckets.dexscreener.take()) throw new LogoError('rate-limited')
        const v1 = await getJson(`${ep.dexscreener}/tokens/v1/${chainId}/${a}`, buckets.dexscreener)
        let urls = pick(v1)
        if (!urls.length) {
          if (!buckets.dexscreener.take()) throw new LogoError('rate-limited')
          const latest = await getJson(`${ep.dexscreener}/latest/dex/tokens/${a}`, buckets.dexscreener)
          urls = pick(latest?.pairs)
        }
        return urls.slice(0, 2)
      },
    },
    {
      id: 'jupiter',
      supports: (c) => c === 'solana',
      async candidates(_c, a) {
        if (!buckets.jupiter.take()) throw new LogoError('rate-limited')
        const j = await getJson(`${ep.jupiter}/tokens/v2/search?query=${encodeURIComponent(a)}`, buckets.jupiter)
        const t = (Array.isArray(j) ? j : []).find((x) => x?.id === a || x?.address === a)
        const u = httpsUrl(t?.icon) ?? httpsUrl(t?.logoURI)
        return u ? [u] : []
      },
    },
    {
      id: 'xstocks',
      supports: () => true,
      async candidates(c, a) {
        const s = stocks.get(`${c}/${a}`)
        if (!s) return []
        if (!buckets.xstocks.take()) throw new LogoError('rate-limited')
        return [`${ep.xstocks}/logos/tokens/${encodeURIComponent(s.ticker)}x.png`]
      },
    },
    {
      id: 'coingecko',
      supports: (c) => !!LOGO_CHAINS[c].coingecko,
      async candidates(c, a) {
        if (!buckets.coingecko.take()) throw new LogoError('rate-limited')
        let j
        try {
          j = await getJson(`${ep.coingecko}/api/v3/coins/${LOGO_CHAINS[c].coingecko}/contract/${a}`, buckets.coingecko)
        } catch (e) {
          if (e.code === 'status') return [] // 404: CoinGecko does not list it
          throw e
        }
        const u = httpsUrl(j?.image?.large) ?? httpsUrl(j?.image?.small)
        return u && !/missing_(large|small|thumb)/.test(u) ? [u] : []
      },
    },
    {
      id: 'trustwallet',
      supports: (c) => !!LOGO_CHAINS[c].trustwallet,
      async candidates(c, a) {
        if (!buckets.trustwallet.take()) throw new LogoError('rate-limited')
        const folder = LOGO_CHAINS[c].evm ? checksum(a) : a
        return [`${ep.trustwallet}/trustwallet/assets/master/blockchains/${LOGO_CHAINS[c].trustwallet}/assets/${folder}/logo.png`]
      },
    },
  ]

  const stats = { resolved: 0, misses: 0, rejected: {}, sourceErrors: {} }
  const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1)

  /** Fetches, checks and renders one candidate. */
  async function tryImage(u) {
    if (!buckets.images.take()) throw new LogoError('rate-limited')
    const { body, contentType } = await guardedGet(u, { accept: ACCEPT_IMAGE, max: MAX_IMAGE_BYTES, bucket: null })
    const { kind } = checkImage(body, contentType)
    return renderSizes(body, kind)
  }

  /**
   * Resolves a logo from the sources, uncached: { source, sizes } or { source: null, partial } where
   * partial means a source was skipped (rate limit, upstream busy) and the miss should not be kept long.
   */
  async function resolveFresh(chain, addr, { symbol } = {}) {
    let partial = false
    for (const src of sources) {
      if (!src.supports(chain)) continue
      let urls
      try {
        urls = await src.candidates(chain, addr, { symbol })
      } catch (e) {
        bump(stats.sourceErrors, `${src.id}:${e.code ?? 'error'}`)
        if (e.code === 'rate-limited' || e.code === 'upstream-busy' || e.code === 'timeout' || e.code === 'network') partial = true
        continue
      }
      for (const u of urls.slice(0, 2)) {
        try {
          const sizes = await tryImage(u)
          return { source: src.id, sizes }
        } catch (e) {
          bump(stats.rejected, e.code ?? 'error')
          if (e.code === 'rate-limited' || e.code === 'upstream-busy' || e.code === 'timeout' || e.code === 'network') partial = true
        }
      }
    }
    return { source: null, partial }
  }

  /* ---- disk cache with an LRU index ---- */

  const indexFile = path.join(dir, 'index.json')
  let index = null // Map key -> { s, at, la, b, until? }
  let totalBytes = 0
  let saveTimer = null
  const loadIndex = () => {
    if (index) return index
    index = new Map(Object.entries(readJsonFile(indexFile, {})))
    totalBytes = 0
    for (const e of index.values()) totalBytes += e.b ?? 0
    return index
  }
  const saveSoon = () => {
    if (saveTimer) return
    saveTimer = setTimeout(flush, 2_000)
    saveTimer.unref?.()
  }
  function flush() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (!index) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      const tmp = `${indexFile}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(index)))
      fs.renameSync(tmp, indexFile)
    } catch (e) {
      log(`index not saved (${e?.code ?? 'error'})`)
    }
  }
  const fileOf = (key, s) => path.join(dir, ...key.split('/').slice(0, 1), `${key.split('/')[1]}-${s}.png`)
  const removeFiles = (key) => {
    for (const s of LOGO_SIZES) fs.rmSync(fileOf(key, s), { force: true })
  }
  function evict() {
    if (index.size <= maxEntries && totalBytes <= maxBytes) return
    const order = [...index.entries()].sort((x, y) => (x[1].la ?? 0) - (y[1].la ?? 0))
    for (const [k, e] of order) {
      if (index.size <= maxEntries && totalBytes <= maxBytes) break
      removeFiles(k)
      totalBytes -= e.b ?? 0
      index.delete(k)
    }
  }
  function store(key, r) {
    loadIndex()
    const old = index.get(key)
    if (old) totalBytes -= old.b ?? 0
    const t = now()
    if (r.source) {
      fs.mkdirSync(path.dirname(fileOf(key, 64)), { recursive: true })
      let b = 0
      for (const s of LOGO_SIZES) {
        fs.writeFileSync(fileOf(key, s), r.sizes[s])
        b += r.sizes[s].length
      }
      index.set(key, { s: r.source, at: t, la: t, b })
      totalBytes += b
    } else {
      if (old?.s) removeFiles(key)
      index.set(key, { s: null, at: t, la: t, b: 0, until: t + (r.partial ? NEG_PARTIAL_TTL_MS : NEG_TTL_MS) })
    }
    evict()
    saveSoon()
  }

  /* ---- coalescing and the concurrency cap ---- */

  const inflight = new Map()
  let active = 0
  const waiting = []
  const acquire = () => {
    if (active < concurrency) {
      active++
      return Promise.resolve()
    }
    if (waiting.length >= maxQueue) return Promise.reject(new LogoError('busy'))
    return new Promise((res) => waiting.push(res))
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
  /** One resolution per token at a time: concurrent callers share it. */
  function resolveShared(chain, addr, symbol, { keepOld = false } = {}) {
    const key = `${chain}/${addr}`
    if (inflight.has(key)) return inflight.get(key)
    const p = (async () => {
      await acquire()
      try {
        const r = await resolveFresh(chain, addr, { symbol })
        if (r.source) stats.resolved++
        else stats.misses++
        // A background refresh that finds nothing keeps the logo it had.
        if (!(keepOld && !r.source)) store(key, r)
        return r
      } finally {
        release()
      }
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  const readCached = (key, s) => {
    try {
      return fs.readFileSync(fileOf(key, s))
    } catch {
      return null
    }
  }

  /**
   * The logo for one token at one size: { png, source, cached } where source is null for the fallback
   * glyph. Uses the cache; resolves on a miss (coalesced); refreshes old positives in the background.
   */
  async function getLogo(chainIn, address, { size = 64, symbol, resolve = true } = {}) {
    const chain = logoChainKey(chainIn)
    const addr = chain ? normaliseAddress(chain, address) : null
    const s = LOGO_SIZES.includes(Number(size)) ? Number(size) : 64
    if (!addr) return { png: await fallbackPng(s), source: null, invalid: true }
    const key = `${chain}/${addr}`
    loadIndex()
    const e = index.get(key)
    const t = now()
    if (e?.s) {
      const png = readCached(key, s)
      if (png) {
        e.la = t
        saveSoon()
        if (t - e.at > REFRESH_AFTER_MS && !inflight.has(key)) resolveShared(chain, addr, symbol, { keepOld: true }).catch(() => {})
        return { png, source: e.s, cached: true }
      }
    } else if (e && t < (e.until ?? 0)) {
      e.la = t
      return { png: await fallbackPng(s), source: null, cached: true }
    }
    if (!resolve) return { png: await fallbackPng(s), source: null, deferred: true }
    try {
      const r = await resolveShared(chain, addr, symbol)
      if (r.source) return { png: r.sizes[s], source: r.source, cached: false }
    } catch (err) {
      if (err.code === 'busy') return { png: await fallbackPng(s), source: null, busy: true }
      throw err
    }
    return { png: await fallbackPng(s), source: null, cached: false }
  }

  /** resolveTokenLogo(chain, address, { symbol }): { source, sizes: {64,128,256} } or { source: 'fallback' }. */
  async function resolveTokenLogo(chain, address, { symbol } = {}) {
    const out = {}
    let source = null
    for (const s of LOGO_SIZES) {
      const r = await getLogo(chain, address, { size: s, symbol })
      out[s] = r.png
      source = r.source
    }
    return { source: source ?? 'fallback', sizes: out }
  }

  /** Resolved and fallback counts per chain and per source, for the admin page and /status. */
  function logoCoverage() {
    loadIndex()
    const t = now()
    const chains = {}
    const bySource = {}
    let resolved = 0
    let fallback = 0
    for (const [k, e] of index) {
      const c = k.split('/')[0]
      const row = (chains[c] ??= { resolved: 0, fallback: 0, sources: {} })
      if (e.s) {
        row.resolved++
        resolved++
        row.sources[e.s] = (row.sources[e.s] ?? 0) + 1
        bySource[e.s] = (bySource[e.s] ?? 0) + 1
      } else if (t < (e.until ?? 0)) {
        row.fallback++
        fallback++
      }
    }
    return {
      resolved,
      fallback,
      chains,
      sources: bySource,
      cache: { entries: index.size, bytes: totalBytes, maxEntries, maxBytes },
      upstreams: Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, { pausedUntil: b.pausedUntil > t ? new Date(b.pausedUntil).toISOString() : null }])),
      since: { resolvedThisProcess: stats.resolved, missesThisProcess: stats.misses, rejected: { ...stats.rejected }, sourceErrors: { ...stats.sourceErrors } },
    }
  }

  /* ---- HTTP ---- */

  const ipWindows = new Map() // ip -> { start, n, r }
  function ipAllow(ip, kind) {
    const t = now()
    let w = ipWindows.get(ip)
    if (!w || t - w.start >= 60_000) {
      if (ipWindows.size > 20_000) ipWindows.clear()
      w = { start: t, n: 0, r: 0 }
      ipWindows.set(ip, w)
    }
    if (kind === 'request') return ++w.n <= perIpPerMin
    return ++w.r <= perIpResolvesPerMin
  }

  const etagOf = (png) => `"${crypto.createHash('sha256').update(png).digest('base64url').slice(0, 22)}"`

  /** GET /api/logo/:chain/:address(.png)?s=64|128|256. Always answers; returns true. */
  async function handleLogo(req, res, url) {
    const base = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...base, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' })
      return res.end(), true
    }
    const send = (status, png, source, cache) => {
      const etag = etagOf(png)
      const h = { ...base, 'Content-Type': 'image/png', 'Cache-Control': cache, ETag: etag, 'X-Logo-Source': source ?? 'fallback' }
      if (status === 200 && String(req.headers['if-none-match'] ?? '').split(/\s*,\s*/).includes(etag)) {
        res.writeHead(304, h)
        return res.end(), true
      }
      res.writeHead(status, { ...h, 'Content-Length': png.length })
      res.end(req.method === 'HEAD' ? undefined : png)
      return true
    }
    const s = LOGO_SIZES.includes(Number(url.searchParams.get('s'))) ? Number(url.searchParams.get('s')) : 64
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...base, Allow: 'GET, HEAD, OPTIONS', 'Content-Type': 'text/plain' })
      return res.end('GET only'), true
    }
    const m = url.pathname.match(/^\/api\/logo\/([a-z0-9-]{1,24})\/([0-9A-Za-z]{20,64})(?:\.png)?\/?$/)
    const ip = clientIp(req)
    if (!ipAllow(ip, 'request')) {
      res.setHeader('Retry-After', '60')
      return send(429, await fallbackPng(s), null, 'no-store')
    }
    if (!m) return send(400, await fallbackPng(s), null, 'public, max-age=3600')
    const symbol = String(url.searchParams.get('symbol') ?? '').replace(/[^A-Za-z0-9.$_-]/g, '').slice(0, 24) || undefined
    const chain = logoChainKey(m[1])
    const addr = chain ? normaliseAddress(chain, m[2]) : null
    if (!addr) return send(400, await fallbackPng(s), null, 'public, max-age=3600')
    // A miss costs upstream calls: those are limited per IP more tightly than cache hits.
    let r = await getLogo(chain, addr, { size: s, symbol, resolve: false })
    if (r.deferred) {
      if (!ipAllow(ip, 'resolve')) {
        res.setHeader('Retry-After', '60')
        return send(429, r.png, null, 'no-store')
      }
      try {
        r = await getLogo(chain, addr, { size: s, symbol })
      } catch (e) {
        log(`resolve failed (${e?.code ?? 'error'})`)
        return send(200, await fallbackPng(s), null, 'public, max-age=60')
      }
    }
    if (r.busy) return send(200, r.png, null, 'no-store')
    return send(200, r.png, r.source, r.source ? 'public, max-age=86400' : 'public, max-age=3600')
  }

  function reset() {
    flush()
    index = null
    totalBytes = 0
    inflight.clear()
    ipWindows.clear()
    deepcoreLists.clear()
  }

  return { resolveTokenLogo, getLogo, logoCoverage, handleLogo, flush, reset, guardedGet, buckets, sources: sources.map((s) => s.id) }
}

/* ------------------------------------------------- the process's service --- */

let shared = null
const service = () => (shared ??= createTokenLogos())

/** The logo for one token (see createTokenLogos). */
export const resolveTokenLogo = (chain, address, opts) => service().resolveTokenLogo(chain, address, opts)
/** Resolved vs fallback counts per chain and source (admin, /status). */
export const logoCoverage = () => service().logoCoverage()
/** GET /api/logo/:chain/:address(.png)?s=64|128|256 for server.mjs. */
export const handleLogo = (req, res, url) => service().handleLogo(req, res, url)
