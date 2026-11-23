// Shared redaction for logs and for text sent to outside services (model providers).
// Masks what is personal or secret and keeps what is public on chain: wallet addresses (0x + 40 hex) and
// transaction hashes (0x + 64 hex) stay readable unless a word next to them says they are a key.
// Pure, no dependencies, safe to copy into any Gully Node service (kept identical in gully-ops l3/lib when shared).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,16}\d(?![\w.])/g
const SECRET_TOKEN = /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{32,}|sk_live_[A-Za-z0-9]{16,}|gk_[A-Za-z0-9]{24,}|\d{8,10}:AA[A-Za-z0-9_-]{33})\b/g
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g
const LABELLED_KEY = /((?:private|priv|secret)[ _-]?key|mnemonic|seed(?: phrase)?|recovery phrase)(\s+is\s+|["'\s:=,]{1,8})(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/gi
const BARE_HEX64 = /(?<![0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g
const PHRASE = /((?:seed phrase|mnemonic|recovery phrase|secret phrase)["'\s:=,-]{1,8})((?:[a-z]{3,8}\s+){11,23}[a-z]{3,8})/gi
const URL_SECRET = /([?&](?:token|key|apikey|api_key|secret|code|password|access_token|signature|sig)=)[^&\s"']+/gi
const IPV4 = /(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))\.(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g
const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi

/** Mask for the log files. Returns the text with masks; `count` is how many masks were applied. */
export function redact(input, { maxLen = 4000, ips = true } = {}) {
  let n = 0
  const sub = (s, re, to) => s.replace(re, (...a) => { n++; return typeof to === 'function' ? to(...a) : to })
  let s = String(input ?? '')
  s = sub(s, PEM, '[private key removed]')
  s = sub(s, PHRASE, (_m, label) => `${label}[phrase removed]`)
  s = sub(s, LABELLED_KEY, (_m, label, sep) => `${label}${sep}[key removed]`)
  s = sub(s, SECRET_TOKEN, '[secret removed]')
  s = sub(s, JWT, '[token removed]')
  s = sub(s, BEARER, (_m, kind) => `${kind} [removed]`)
  s = sub(s, URL_SECRET, (_m, head) => `${head}[removed]`)
  s = sub(s, EMAIL, (m) => `${m[0]}***@${m.split('@')[1].replace(/^[^.]*/, '***')}`)
  s = sub(s, BARE_HEX64, '[hex removed]')
  if (ips) {
    s = sub(s, IPV4, (_m, p) => `${p}.0`)
    s = sub(s, IPV6, '[ipv6]')
  }
  s = sub(s, PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone removed]' : (n--, m)))
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`
  return { text: s, count: n }
}

/**
 * Text for an outside model provider. Stricter than the log mask: emails, phones, keys and phrases never leave.
 * Returns { text, count, blocked }. `blocked` is true when a private key or recovery phrase was present: the caller
 * should refuse the call and tell the user to never share it.
 */
export function scrubForModel(input) {
  const raw = String(input ?? '')
  const blocked = [PEM, LABELLED_KEY, PHRASE].some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(raw))
  const r = redact(raw, { maxLen: Number.MAX_SAFE_INTEGER, ips: true })
  return { text: r.text, count: r.count, blocked }
}

/** Shallow-redact the string fields of a log entry (keys named like secrets are dropped entirely). */
export function redactEntry(entry, fields = ['question', 'error']) {
  const out = { ...entry }
  for (const f of fields) if (typeof out[f] === 'string') out[f] = redact(out[f], { maxLen: 2000 }).text
  for (const k of Object.keys(out)) if (/^(authorization|cookie|password|secret|token|apikey|api_key)$/i.test(k)) delete out[k]
  return out
}
