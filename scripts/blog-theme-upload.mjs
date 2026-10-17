#!/usr/bin/env node
/* Uploads ghost/theme/gully.zip to the blog and activates it, through Ghost's Admin API.

   GHOST_ADMIN_KEY="<id>:<secret>" node scripts/blog-theme-upload.mjs [--no-activate]

   The key is a Ghost Admin API key (Ghost admin > Settings > Integrations > a custom integration).
   It is read from the environment only and never printed. The script signs a short-lived token with
   it (HS256, kid = id, aud = /admin/, 5 minutes), POSTs the zip to /ghost/api/admin/themes/upload/,
   then PUTs /ghost/api/admin/themes/gully/activate/. It prints the HTTP status of each call and,
   on failure, Ghost's error message (which never contains the key).
   GHOST_URL overrides the blog address (default https://blog.gullylabs.xyz). No dependencies. */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ZIP = join(root, 'ghost', 'theme', 'gully.zip')
const BASE = (process.env.GHOST_URL || 'https://blog.gullylabs.xyz').replace(/\/+$/, '')
const THEME = 'gully'

const key = process.env.GHOST_ADMIN_KEY || ''
const [id, secret] = key.split(':')
if (!id || !secret || !/^[0-9a-f]+$/i.test(secret)) {
  console.error('GHOST_ADMIN_KEY is missing or not in the form <id>:<hex secret>.')
  process.exit(2)
}
if (!existsSync(ZIP)) {
  console.error('ghost/theme/gully.zip not found: run node scripts/blog-theme-zip.mjs first.')
  process.exit(2)
}

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT', kid: id })
  const body = b64({ iat: now, exp: now + 5 * 60, aud: '/admin/' })
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

async function report(step, res) {
  console.log(`${step}: HTTP ${res.status}`)
  if (res.ok) return true
  try {
    const j = await res.json()
    for (const e of j.errors || []) console.log(`  ${e.type || 'Error'}: ${e.message || ''}${e.context ? ` (${e.context})` : ''}`)
  } catch {
    /* no JSON body */
  }
  return false
}

const headers = () => ({ Authorization: `Ghost ${token()}`, 'Accept-Version': 'v6.0' })

const form = new FormData()
form.append('file', new Blob([readFileSync(ZIP)], { type: 'application/zip' }), 'gully.zip')
const up = await fetch(`${BASE}/ghost/api/admin/themes/upload/`, { method: 'POST', headers: headers(), body: form })
if (!(await report('upload', up))) process.exit(1)

if (process.argv.includes('--no-activate')) process.exit(0)
const act = await fetch(`${BASE}/ghost/api/admin/themes/${THEME}/activate/`, { method: 'PUT', headers: headers() })
if (!(await report('activate', act))) process.exit(1)
