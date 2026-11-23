// Gully AI: the public-text guard for what goes into the index. Gully AI may learn only from PUBLIC pages and docs,
// so every chunk of every source (local build, remote docs, READMEs) passes through here, and a chunk that looks like
// internal data is dropped and counted, never indexed. The same patterns run in the tests over the committed index.
// This mirrors the rule "no admin or internal data on live public sites": admin consoles, box addresses, server
// paths, env or flag names, keys, private repos, internal notes, stack traces.
//
//   import { guardChunks, findLeak } from './ask-public-guard.mjs'
//   const { kept, rejected } = guardChunks(chunks)   // rejected: [{ url, reason }]

const PATTERNS = [
  ['box address', /\b(?:57\.12\d|40\.160|51\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/],
  ['private IP address', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ['server path', /(?:^|[\s"'`(])\/(?:srv|home|var\/lib|etc\/caddy|opt)\/[\w./-]{3,}/],
  ['admin console', /\badmin\.(?:gully|kre8|swoop)[a-z0-9-]*\.(?:xyz|fun)\b/i],
  ['secret or key', /(?:\bsk-ant-[A-Za-z0-9_-]{8,}|\bgk_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b0x[0-9a-fA-F]{64}\b)/],
  // KEY=value with a real-looking value; placeholders (<your key>, your-key, xxx, $VAR) are fine.
  ['env assignment', /\b[A-Z][A-Z0-9_]{3,}_(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*(?!<|your|YOUR|xxx|\.\.\.|["']?\$)[A-Za-z0-9+/_-]{20,}/],
  ['internal host name', /\b(?:gully-l3|status-caddy|agent-slot|gully-deploy\.lock|DEPLOYED_SHA)\b/],
  ['ssh command', /\bssh\s+(?:-\w+\s+)*(?:deploy|ubuntu|root)@/],
  ['private repo', /github\.com\/gully-labs\/(?:gully-ops|gully-street|gully-offerwall|gully-id|gull-pay|gully-rpc|gully-core-app|gully-bots|gully-solver)\b/i],
  ['internal note', /\b(?:internal only|not for public|owner decision pending|TODO:\s*owner)\b/i],
  ['stack trace', /\bat\s+[\w.$<>]+\s+\((?:file:|\/|[A-Z]:[\\/])[^)]*:\d+:\d+\)/],
]

/** The reason a text must not be indexed, or null. */
export function findLeak(text) {
  const t = String(text ?? '')
  for (const [reason, re] of PATTERNS) if (re.test(t)) return reason
  return null
}

/** Splits chunks into those safe to index and those refused (with url + reason). */
export function guardChunks(chunks) {
  const kept = []
  const rejected = []
  for (const c of chunks) {
    const reason = findLeak(`${c.title ?? ''}\n${c.section ?? ''}\n${c.text ?? ''}`)
    if (reason) rejected.push({ url: c.url, reason })
    else kept.push(c)
  }
  return { kept, rejected }
}

export const GUARD_REASONS = PATTERNS.map(([r]) => r)
