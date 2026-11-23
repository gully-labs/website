// Gully AI: where the model provider's keys and a few settings come from.
//
// The owner enters them on admin.gullylabs.xyz > Integrations ("Gully AI: model provider", admin-integrations-ai.mjs),
// which writes one file per name into the integrations folder (admin-integrations.mjs STORAGE). This module is the
// reader every Gully AI module uses:
//
//   aiSetting(NAME)        the saved file's value when there is one, else the environment variable, else ''
//   aiSettingSource(NAME)  'saved' | 'server' | null   (where the value in use comes from; never the value)
//
// A saved value is picked up WITHOUT a restart: the admin save calls aiSettingsChanged(NAME) (the next read is fresh,
// and listeners such as ask.mjs re-check the provider), and a file changed any other way is noticed within RECHECK_MS.
// Only the names below are ever read from a file; any other name is the environment variable as before.
// Nothing here logs, returns to a client or stores a value anywhere but the in-memory cache.

import fs from 'node:fs'
import path from 'node:path'

export const integrationsDir = () => process.env.CHAINKIT_INTEGRATIONS_DIR || '/srv/chainkit/integrations'

export const AI_SECRET_NAMES = ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY']
export const AI_PLAIN_NAMES = ['ASK_DAILY_CAP', 'ASK_PRICE_INPUT_PER_MTOK', 'ASK_PRICE_OUTPUT_PER_MTOK', 'ASK_FALLBACK_MODEL']
const NAMES = new Set([...AI_SECRET_NAMES, ...AI_PLAIN_NAMES])
const RECHECK_MS = 2_000

const cache = new Map() // name -> { at, dir, value }
const listeners = new Set()

function notify(name) {
  for (const fn of listeners) {
    try {
      fn(name)
    } catch {
      /* a listener never breaks a read or a save */
    }
  }
}

function saved(name, now = Date.now()) {
  const dir = integrationsDir()
  const c = cache.get(name)
  if (c && c.dir === dir && now - c.at < RECHECK_MS) return c.value
  let value = null
  try {
    value = fs.readFileSync(path.join(dir, name), 'utf8').trim() || null
  } catch {
    /* no file: the environment value stands */
  }
  cache.set(name, { at: now, dir, value })
  // A file that changed behind our back (not through the admin save) still reaches the listeners.
  if (c && c.dir === dir && c.value !== value) queueMicrotask(() => notify(name))
  return value
}

const fromEnv = (name) => String(process.env[name] ?? '').trim()

export function aiSetting(name) {
  if (!NAMES.has(name)) return fromEnv(name)
  return saved(name) ?? fromEnv(name)
}

export function aiSettingSource(name) {
  if (NAMES.has(name) && saved(name) !== null) return 'saved'
  return fromEnv(name) ? 'server' : null
}

/** Environment-shaped view (env.NAME) for helpers that take an env object. */
export const aiSettingsEnv = () => new Proxy({}, { get: (_, k) => (typeof k === 'string' ? aiSetting(k) || undefined : undefined) })

/** Called by the admin save and clear: forget the cached value and tell the listeners. */
export function aiSettingsChanged(name) {
  if (!NAMES.has(name)) return
  cache.delete(name)
  notify(name)
}

/** fn(name) runs after a saved value changed. Returns the unsubscribe. */
export function onAiSettingsChanged(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Tests: forget every cached value. */
export const resetAiSettingsForTest = () => cache.clear()
