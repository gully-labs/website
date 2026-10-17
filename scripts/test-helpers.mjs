// Helpers shared by the end-to-end test scripts (test-siwe.mjs, test-paid.mjs): a tiny HTTP client that
// keeps the dashboard session cookie, and Sign-In with Ethereum for a viem account.

import { createSiweMessage } from 'viem/siwe'

/** A client for one server. `call` keeps the session cookie between requests unless useCookie is false. */
export function makeClient(base) {
  let cookie = ''
  async function call(path, { method = 'GET', body, headers = {}, auth, useCookie = true } = {}) {
    const h = { ...headers }
    if (body !== undefined) h['content-type'] = 'application/json'
    if (useCookie && cookie) h.cookie = cookie
    if (auth) h.authorization = `Bearer ${auth}`
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
    const text = await r.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      /* not json */
    }
    return { status: r.status, data, headers: r.headers }
  }
  const post = (path, body, extra = {}) => call(path, { ...extra, method: 'POST', body: body ?? {}, headers: { 'x-requested-with': 'gully', ...(extra.headers ?? {}) } })

  /** A SIWE message for `account` with a fresh server nonce. */
  async function siweMessage(account, overrides = {}) {
    const { data } = await call('/api/developer/nonce')
    return createSiweMessage({ domain: new URL(base).host, address: account.address, uri: base, version: '1', chainId: 1, nonce: data.nonce, issuedAt: new Date(), statement: 'Sign in to the Gully Labs developer dashboard.', ...overrides })
  }

  /** Signs in and keeps the session cookie. Returns the sign-in response. */
  async function signIn(account) {
    const m = await siweMessage(account)
    const r = await post('/api/developer/siwe', { message: m, signature: await account.signMessage({ message: m }) }, { useCookie: false })
    const set = (r.headers.get('set-cookie') ?? '').split(';')[0]
    if (r.status === 200 && set) cookie = set
    return r
  }

  return {
    call,
    post,
    siweMessage,
    signIn,
    get cookie() {
      return cookie
    },
    set cookie(v) {
      cookie = v
    },
  }
}

/** PASS/FAIL printer with a running tally. */
export function makeChecker() {
  const t = { passed: 0, failed: 0 }
  t.check = (name, cond, extra = '') => {
    if (cond) t.passed++
    else t.failed++
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  }
  return t
}

/** One request to `base` as if sent to another host (the Host header decides the app: app.*, developers.*,
    the main site). Redirects are not followed. Resolves { status, headers, text, data }. */
export async function hostRequest(base, host, path, { method = 'GET', body, headers = {} } = {}) {
  const http = await import('node:http')
  const u = new URL(base)
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path, method, headers: { host, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (text += c))
        res.on('end', () => {
          let data = null
          try {
            data = JSON.parse(text)
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, data })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** Signs in with SIWE on `host` (a production host name, so the message's domain and https URI name it).
    Resolves the sign-in response. */
export async function hostSignIn(base, host, account, { domain = host } = {}) {
  const n = await hostRequest(base, host, '/api/developer/nonce')
  const message = createSiweMessage({ domain, address: account.address, uri: `https://${domain}`, version: '1', chainId: 1, nonce: n.data?.nonce, issuedAt: new Date(), statement: 'Sign in to the Gully Labs App.' })
  const signature = await account.signMessage({ message })
  return hostRequest(base, host, '/api/developer/siwe', { method: 'POST', body: { message, signature }, headers: { 'x-requested-with': 'gully', origin: `https://${host}` } })
}

/* ------------------------------------------------------------- run guard --- */
// Every suite that starts the server in its own process calls guardTestRun(PORT) first:
// - it fails fast, with a clear message, when TEST_PORT is already taken (a leftover server would otherwise
//   answer this suite's requests and make it fail in confusing ways);
// - children registered with track() are killed on exit, on SIGINT/SIGTERM and on an uncaught error;
// - a watchdog ends a suite that hangs (for example waiting on a child that never exits), so no server
//   is left listening after the script.

import net from 'node:net'

const children = new Set()

/** Registers a spawned child so it is killed whenever this test process ends. Returns the child. */
export function track(child) {
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

function killChildren() {
  for (const c of children) {
    try {
      c.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  children.clear()
}

/** Resolves when `port` is free on localhost; exits the process with a clear message when it is not. */
export async function guardTestRun(port, { watchdogMs = 5 * 60_000, name = process.argv[1]?.split(/[\/]/).pop() } = {}) {
  const busy = await new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', (e) => resolve(e.code === 'EADDRINUSE' ? true : false))
    s.listen(port, () => s.close(() => resolve(false)))
  })
  if (busy) {
    console.error(`${name}: port ${port} is already in use (a server left over from an earlier run?). Stop it or set TEST_PORT to a free port.`)
    process.exit(2)
  }
  process.on('exit', killChildren)
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      killChildren()
      process.exit(130)
    })
  }
  process.on('uncaughtException', (e) => {
    console.error(`${name}: uncaught ${e?.stack ?? e}`)
    killChildren()
    process.exit(1)
  })
  const dog = setTimeout(() => {
    console.error(`${name}: timed out after ${Math.round(watchdogMs / 1000)} s; stopping the server and any child processes.`)
    killChildren()
    process.exit(1)
  }, watchdogMs)
  dog.unref()
}
