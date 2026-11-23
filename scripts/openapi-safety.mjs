// Checks that an OpenAPI document is fit to publish. Shared, byte-identical, by every Gully repo that commits a
// public spec (openapi/*.json). Owner rule: no admin or internal data on public sites.
// Usage: const findings = checkPublicSpec(spec, { hosts: ['api.example.xyz'] }); assert.deepEqual(findings, []);
// Options: hosts (allowed server hosts, https only), extraPathDeny (RegExp[]), allowAddresses (lowercase 0x.. the
// spec may name, e.g. a public token contract), allowText (RegExp[] of exact matches to skip).

const PATH_DENY = /(^|\/)(admin|internal|_internal|healthz|health|metrics|debug|ops)(\/|$|\.)/i;
const ENV_NAME = /\b(?:DEV_API|ADS|ACTIONS|SWOOP|ASK|AI|GULLY|GULLYPAY|VITE|NEXT_PUBLIC|DATABASE|POSTGRES|PG|REDIS|JWT|STRIPE|ERPC|CORS|SOCIAL|TOKEN_PROMO|NETWORK|REFERRALS?|FRAUD|IPFS|CHAT|VIDEO|HYDRA|CONNECT|WALLET)_[A-Z0-9]+(?:_[A-Z0-9]+)*\b/g;
const ENV_SUFFIX = /\b[A-Z][A-Z0-9_]*_(?:FILE|DSN|SECRET|PASSWORD|PRIVATE_KEY)\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HEX40 = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const HEX64 = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const KEYISH = /\b(?:rk|sk|pk|gk|hk|lk|ak|ow|sw)_(?:live|test)_[A-Za-z0-9]{6,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/g;
const PRIVATE_LINK = /github\.com\/gully-labs\/[A-Za-z0-9._-]+/g;
const INTERNAL_WORDS = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\/srv\/|docker|erpc_auth|gully-internal|own-ip|ownIps)\b/gi;
const CLAIMS = /\b(?:audited|guaranteed|guarantee)\b/gi;

/** A placeholder hex value: one or two characters repeated, a counting pattern, or all zero / dead. */
export function isPlaceholderHex(h) {
  const s = h.slice(2).toLowerCase();
  if (/^(..)\1+$/.test(s) || /^(.)\1+$/.test(s)) return true;
  if (/^(0123456789abcdef)+0?1?2?3?4?5?6?7?$/.test(s) || /^(1234567890abcdef)+1?2?3?4?5?6?7?8?$/.test(s)) return true;
  if (/^0+(dead|beef|1|2|3)?$/.test(s)) return true;
  return false;
}
const placeholderKey = (k) => /your|example|xxxx|placeholder|0000/i.test(k);

export function checkPublicSpec(spec, opts = {}) {
  const out = [];
  const hosts = opts.hosts || [];
  const allowAddr = new Set((opts.allowAddresses || []).map((a) => a.toLowerCase()));
  const allowText = opts.allowText || [];
  const skip = (m) => allowText.some((re) => re.test(m));

  if (!/^3\.1\./.test(spec.openapi || '')) out.push(`openapi version is ${spec.openapi}, expected 3.1.x`);
  if (!spec.info?.title || !spec.info?.version) out.push('info.title and info.version are required');
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) out.push('servers is empty');
  for (const s of spec.servers || []) {
    let u;
    try {
      u = new URL(s.url);
    } catch {
      out.push(`server url is not absolute: ${s.url}`);
      continue;
    }
    if (u.protocol !== 'https:') out.push(`server is not https: ${s.url}`);
    if (!hosts.includes(u.host)) out.push(`server host not on the public list: ${u.host}`);
  }
  // every per-path / per-operation server too
  const walkServers = (node, where) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n, i) => walkServers(n, `${where}[${i}]`));
    for (const [k, v] of Object.entries(node)) {
      if (k === 'servers' && where !== '$' && Array.isArray(v)) {
        for (const s of v) {
          try {
            const u = new URL(s.url);
            if (u.protocol !== 'https:' || !hosts.includes(u.host)) out.push(`server not on the public list at ${where}: ${s.url}`);
          } catch {
            out.push(`server url is not absolute at ${where}: ${s.url}`);
          }
        }
      } else walkServers(v, `${where}.${k}`);
    }
  };
  walkServers(spec, '$');

  const deny = [PATH_DENY, ...(opts.extraPathDeny || [])];
  for (const p of Object.keys(spec.paths || {})) {
    if (!p.startsWith('/')) out.push(`path does not start with /: ${p}`);
    if (/[?#]/.test(p)) out.push(`path holds a query or fragment: ${p}`);
    for (const re of deny) if (re.test(p)) out.push(`internal path in a public spec: ${p}`);
    for (const [m, op] of Object.entries(spec.paths[p] || {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m)) continue;
      if (!op.operationId) out.push(`missing operationId: ${m.toUpperCase()} ${p}`);
      if (!op.summary) out.push(`missing summary: ${m.toUpperCase()} ${p}`);
      if (!op.responses || Object.keys(op.responses).length === 0) out.push(`missing responses: ${m.toUpperCase()} ${p}`);
    }
  }
  const ids = Object.values(spec.paths || {}).flatMap((item) => Object.values(item).map((op) => op && op.operationId).filter(Boolean));
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) out.push(`duplicate operationId: ${id}`);

  const text = JSON.stringify(spec);
  const scan = (re, label, ok = () => false) => {
    for (const m of text.match(re) || []) if (!ok(m) && !skip(m)) out.push(`${label}: ${m}`);
  };
  scan(ENV_NAME, 'environment or flag name');
  scan(ENV_SUFFIX, 'environment or flag name');
  scan(IPV4, 'IP address', (m) => /^(\d+\.){3}\d+$/.test(m) && m.split('.').some((n) => Number(n) > 255));
  scan(HEX40, 'address that is not a placeholder', (m) => isPlaceholderHex(m) || allowAddr.has(m.toLowerCase()));
  scan(HEX64, 'hash that is not a placeholder', (m) => isPlaceholderHex(m));
  scan(KEYISH, 'key-shaped value', placeholderKey);
  scan(JWT, 'token-shaped value');
  scan(PRIVATE_LINK, 'repository link', (m) => (opts.publicRepos || []).some((r) => m.toLowerCase().endsWith(`/${r}`)));
  scan(INTERNAL_WORDS, 'internal detail');
  scan(CLAIMS, 'claim wording');
  return [...new Set(out)];
}

/** Stable JSON: the committed file is byte-identical for the same inputs. */
export const stableJson = (v) => JSON.stringify(v, null, 2) + '\n';
