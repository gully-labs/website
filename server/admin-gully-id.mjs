// Gully ID sign-in for an owner admin console, with an allowlist (owner decision 2026-10-30).
//
// Server-side OIDC authorization code flow with PKCE against https://gullyid.xyz (public, first-party client, no
// secret; gully-id docs/integrate-current.md). The browser never holds a Gully token: the server exchanges the code,
// asks GET /v1/profile who the token belongs to, and lets the account in only when
//   1. the token was issued to this console's client  (profile.client === clientId; a token minted for any other
//      Gully app is refused), and
//   2. the Gully ID `sub` is in ADMIN_GULLY_SUBS        (comma-separated; empty = nobody gets in through Gully ID).
// The id_token from the token endpoint is checked too (iss, aud, nonce, exp, same sub): it came straight from the
// issuer over TLS, so its signature is not re-verified here (OIDC Core 3.1.3.7).
//
// The same file is used by the Gully AI gateway, the Gully Labs site and the gully-ops admins (l3/admin,
// gully/gullystudio-admin). It has no dependencies. Keep the copies byte-identical (compare with sha256sum).
//
// Logs: one JSON line per sign-in attempt, { evt: 'admin_auth', action, result, via, sub: <12-hex tag> }. The tag is a
// salted sha256 of the sub, enough to tell accounts apart in the log, never the sub, name, email, wallet or IP.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const VERSION = 'admin-gully-id/1';
export const TX_COOKIE = 'gid_admin_tx';
const TX_TTL_MS = 10 * 60_000;
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s).digest();

/** A short, stable tag for a sub, for logs only. */
export const subTag = (sub) => createHash('sha256').update('gully-admin-log:' + String(sub)).digest('hex').slice(0, 12);

/** on/off flag: on|1|true|yes vs off|0|false|no; anything else (unset, empty) = the default. */
export function onOff(v, dflt) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['on', '1', 'true', 'yes'].includes(s)) return true;
  if (['off', '0', 'false', 'no'].includes(s)) return false;
  return dflt;
}

/** ADMIN_GULLY_SUBS: comma or whitespace separated Gully ID subs. Junk entries are dropped, never widened. */
export function parseSubs(v) {
  return new Set(String(v ?? '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^[A-Za-z0-9._:@|-]{1,128}$/.test(s)));
}

function fileOrEmpty(path) {
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Console settings from the environment.
 *   GULLY_ID_ISSUER         default https://gullyid.xyz (never id.gullychain.xyz: its 301 breaks the token POST)
 *   ADMIN_GULLY_ID_CLIENT_ID  default: the console's own client (argument)
 *   ADMIN_GULLY_SUBS        or ADMIN_GULLY_SUBS_FILE: the allowlist. Empty = nobody through Gully ID.
 *   ADMIN_PASSWORD_LOGIN    on (default for this release) | off: the old password / token / basic-auth login.
 *   ADMIN_GULLY_ID          on (default) | off: hides the Gully ID button and refuses its routes.
 *   ADMIN_SESSION_HOURS     8, ADMIN_IDLE_MINUTES 60
 */
export function adminAuthConfig(env, { clientId, sessionHours = 8, idleMinutes = 60 } = {}) {
  let issuer = String(env.GULLY_ID_ISSUER || 'https://gullyid.xyz').trim().replace(/\/+$/, '');
  if (/\/\/id\.gullychain\.xyz$/i.test(issuer)) issuer = 'https://gullyid.xyz';
  const int = (k, d) => {
    const n = Number.parseInt(env[k] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return Object.freeze({
    issuer,
    clientId: String(env.ADMIN_GULLY_ID_CLIENT_ID || clientId || '').trim(),
    subs: parseSubs(env.ADMIN_GULLY_SUBS ?? fileOrEmpty(env.ADMIN_GULLY_SUBS_FILE)),
    passwordLogin: onOff(env.ADMIN_PASSWORD_LOGIN, true),
    gullyId: onOff(env.ADMIN_GULLY_ID, true),
    sessionMs: int('ADMIN_SESSION_HOURS', sessionHours) * 3_600_000,
    idleMs: int('ADMIN_IDLE_MINUTES', idleMinutes) * 60_000,
  });
}

/** Public view for the login page (no allowlist, no secrets). */
export const publicAuthConfig = (c) => ({ gullyId: { enabled: c.gullyId && !!c.clientId, issuer: c.issuer, clientId: c.clientId, allowlisted: c.subs.size }, passwordLogin: c.passwordLogin });

export function logAuth(log, action, fields = {}) {
  const line = { ts: new Date().toISOString(), evt: 'admin_auth', action, ...fields };
  if (line.sub) line.sub = subTag(line.sub);
  try {
    (log?.info ?? log?.log ?? console.log).call(log ?? console, JSON.stringify(line));
  } catch {
    /* logging never breaks a login */
  }
}

function decodeJwtPayload(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const fail = (status, code, message) => ({ ok: false, status, code, message });

/** The OIDC half: start a sign-in, finish it. Sessions are the caller's. */
export class GullyIdAdminLogin {
  constructor(config, { fetchImpl = (...a) => fetch(...a), now = Date.now, log = console, scope = 'openid profile' } = {}) {
    Object.assign(this, { c: config, fetch: fetchImpl, now, log, scope });
    this.tx = new Map(); // state -> { verifier, nonce, redirectUri, t }
  }

  get enabled() {
    return this.c.gullyId && !!this.c.clientId;
  }

  sweep() {
    const t = this.now();
    for (const [k, v] of this.tx) if (t - v.t > TX_TTL_MS) this.tx.delete(k);
    while (this.tx.size >= 500) this.tx.delete(this.tx.keys().next().value);
  }

  /** -> { location, state }. Bind `state` to the browser with a short SameSite=Lax cookie (txCookie). */
  start(redirectUri) {
    this.sweep();
    const state = b64u(randomBytes(24));
    const verifier = b64u(randomBytes(32));
    const nonce = b64u(randomBytes(16));
    this.tx.set(state, { verifier, nonce, redirectUri, t: this.now() });
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.c.clientId,
      redirect_uri: redirectUri,
      scope: this.scope,
      state,
      nonce,
      code_challenge: b64u(sha256(verifier)),
      code_challenge_method: 'S256',
    });
    return { location: `${this.c.issuer}/oauth2/auth?${q}`, state };
  }

  /**
   * Finish at the callback. query: URLSearchParams of the callback URL; txState: the state from the tx cookie.
   * -> { ok: true, sub, name } | { ok: false, status, code, message }
   */
  async finish(query, txState) {
    const state = query.get('state') ?? '';
    const entry = state ? this.tx.get(state) : null;
    if (entry) this.tx.delete(state); // one use, whatever happens next
    if (query.get('error')) return fail(401, 'idp_error', 'Gully ID did not complete the sign-in.');
    if (!entry || typeof txState !== 'string' || txState.length !== state.length || !timingSafeEqual(Buffer.from(txState), Buffer.from(state))) {
      return fail(400, 'bad_state', 'This sign-in link is stale or was not started here. Start again.');
    }
    if (this.now() - entry.t > TX_TTL_MS) return fail(400, 'bad_state', 'This sign-in took too long. Start again.');
    const code = query.get('code');
    if (!code || code.length > 2048) return fail(400, 'no_code', 'Gully ID sent no code. Start again.');

    let tok;
    try {
      const r = await this.fetch(`${this.c.issuer}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: entry.redirectUri, client_id: this.c.clientId, code_verifier: entry.verifier }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return fail(401, 'token_exchange', 'Gully ID refused the sign-in code. Start again.');
      tok = await r.json();
    } catch {
      return fail(503, 'gully_id_unavailable', 'Gully ID is unreachable right now. Try again.');
    }
    if (!tok || typeof tok.access_token !== 'string' || !tok.access_token) return fail(401, 'token_exchange', 'Gully ID sent no access token.');

    const idt = decodeJwtPayload(tok.id_token);
    const aud = idt ? (Array.isArray(idt.aud) ? idt.aud : [idt.aud]) : [];
    if (!idt || idt.iss !== `${this.c.issuer}/` || !aud.includes(this.c.clientId) || idt.nonce !== entry.nonce || !(Number(idt.exp) * 1000 > this.now())) {
      return fail(401, 'bad_id_token', 'The Gully ID token did not match this sign-in.');
    }

    let prof;
    try {
      const r = await this.fetch(`${this.c.issuer}/v1/profile`, { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (r.status === 401 || r.status === 403) return fail(401, 'token_invalid', 'Gully sign-in failed or expired.');
      if (!r.ok) return fail(503, 'gully_id_unavailable', 'Gully ID is unavailable right now. Try again.');
      prof = await r.json();
    } catch {
      return fail(503, 'gully_id_unavailable', 'Gully ID is unreachable right now. Try again.');
    }
    if (!prof || typeof prof.sub !== 'string' || !prof.sub || prof.sub.length > 128) return fail(401, 'token_invalid', 'Gully sign-in failed or expired.');
    if (prof.client !== this.c.clientId) return { ...fail(401, 'wrong_client', 'This Gully ID sign-in was not made for this console.'), sub: prof.sub };
    if (idt.sub !== prof.sub) return { ...fail(401, 'bad_id_token', 'The Gully ID token did not match this sign-in.'), sub: prof.sub };
    if (!this.c.subs.has(prof.sub)) return { ...fail(403, 'not_allowlisted', 'This Gully ID account is not on the admin allowlist.'), sub: prof.sub };
    return { ok: true, sub: prof.sub, name: typeof (prof.gullyName || prof.name) === 'string' ? String(prof.gullyName || prof.name).slice(0, 64) : null };
  }
}

export const txCookie = (state, path) => `${TX_COOKIE}=${state}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${TX_TTL_MS / 1000}`;
export const clearTxCookie = (path) => `${TX_COOKIE}=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        out[k] = '';
      }
    }
  }
  return out;
}

/** Constant-time compare of two strings. */
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * In-memory admin sessions: random token in an HttpOnly cookie (only its sha256 is kept), absolute lifetime and idle
 * timeout, one CSRF token per session that every state change must send back. A restart signs everyone out.
 */
export class AdminSessions {
  constructor({ ttlMs, idleMs, max = 50, now = Date.now }) {
    Object.assign(this, { ttlMs, idleMs, max, now });
    this.map = new Map();
  }

  create(via, sub = null) {
    this.sweep();
    while (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    const token = b64u(randomBytes(32));
    const csrf = b64u(randomBytes(24));
    const t = this.now();
    this.map.set(sha256(token).toString('hex'), { csrf, via, sub, created: t, seen: t });
    return { token, csrf };
  }

  get(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const id = sha256(token).toString('hex');
    const s = this.map.get(id);
    if (!s) return null;
    const t = this.now();
    if (t - s.created > this.ttlMs || t - s.seen > this.idleMs) {
      this.map.delete(id);
      return null;
    }
    s.seen = t;
    return s;
  }

  destroy(token) {
    if (typeof token === 'string') this.map.delete(sha256(token).toString('hex'));
  }

  sweep() {
    const t = this.now();
    for (const [id, s] of this.map) if (t - s.created > this.ttlMs || t - s.seen > this.idleMs) this.map.delete(id);
  }
}

/** Failed password logins: perIp per window, plus a global cap. */
export class LoginLimiter {
  constructor({ perIp = 5, global = 50, windowMs = 15 * 60_000, now = Date.now } = {}) {
    Object.assign(this, { perIp, global, windowMs, now });
    this.byIp = new Map();
    this.all = [];
  }

  blocked(ip) {
    const t = this.now();
    const prune = (l) => {
      while (l.length && l[0] <= t - this.windowMs) l.shift();
    };
    prune(this.all);
    const mine = this.byIp.get(ip) ?? [];
    prune(mine);
    return mine.length >= this.perIp || this.all.length >= this.global;
  }

  fail(ip) {
    const t = this.now();
    const mine = this.byIp.get(ip) ?? [];
    mine.push(t);
    this.byIp.set(ip, mine);
    this.all.push(t);
    if (this.byIp.size > 10_000) this.byIp.clear();
  }

  succeed(ip) {
    this.byIp.delete(ip);
  }
}
