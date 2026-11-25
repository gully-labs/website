// Bot and app keys for the Gully AI surfaces and the Gully Labs Telegram bot: where they come from.
//
// The owner enters them on admin.gullylabs.xyz > Integrations (groups in admin-integrations-bots.mjs), which writes one
// file per name into the integrations folder (admin-integrations.mjs STORAGE). This module is the reader:
//
//   botSetting(NAME)        the saved file's value when there is one, else the environment variable, else ''
//   botSettingSource(NAME)  'saved' | 'server' | null   (never the value)
//
// Only the names below are read from a file; any other name is the environment variable as before. A save is in use
// within RECHECK_MS (the admin save also calls botSettingsChanged so the next read is fresh). Nothing here logs a value.

import fs from 'node:fs'
import path from 'node:path'
import { integrationsDir } from './ai-settings.mjs'

export const BOT_SETTING_NAMES = new Set([
  'DISCORD_APP_ID',
  'DISCORD_APP_PUBLIC_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_ID',
  'NEYNAR_API_KEY',
  'FARCASTER_WEBHOOK_SECRET',
  'FARCASTER_SIGNER_UUID',
  'FARCASTER_BOT_FID',
  'FARCASTER_ACCOUNT_ASSOCIATION',
])
const RECHECK_MS = 2_000
const cache = new Map() // name -> { at, dir, value }

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
  return value
}

const fromEnv = (name) => String(process.env[name] ?? '').trim()

export function botSetting(name) {
  if (!BOT_SETTING_NAMES.has(name)) return fromEnv(name)
  return saved(name) ?? fromEnv(name)
}

export function botSettingSource(name) {
  if (BOT_SETTING_NAMES.has(name) && saved(name) !== null) return 'saved'
  return fromEnv(name) ? 'server' : null
}

/** Called by the admin save and clear: the next read is fresh. */
export function botSettingsChanged(name) {
  cache.delete(name)
}
