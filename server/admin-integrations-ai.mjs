// "Gully AI: model provider" group of admin.gullylabs.xyz Integrations (owner rule: keys are entered on this page, never
// in chat or by hand in a server file). Same write-only pattern as the other groups in admin-integrations.mjs (files in
// the integrations folder, passkey step-up, audit of names only); this file holds the field list, the on-page guide,
// the status line and the "Check" read.
//
// Gully AI reads these through ai-settings.mjs: the saved file first, then the server's environment value. A save is
// in use on the next request, with no restart (admin-integrations.mjs calls aiSettingsChanged; ask.mjs then clears the
// stored 'unavailable' state and probes the new key once).
//
// The key files are this process's only (mode 0400, never the Chain Kit runner's group): nothing else reads them.
// The Check is one GET <api>/v1/models?limit=1 with the key in use: it writes no text and uses no tokens. Its answer
// is a status word, never the key and never the provider's own text.

import fs from 'node:fs'
import path from 'node:path'
import { aiSettingSource } from './ai-settings.mjs'
import { KEY_ERROR } from './ask-health.mjs'
import { DATA_DIR } from './http.mjs'

const f = (name, label, hint, format, extra = {}) => ({ name, label, hint, format, ...extra })

export const AI_GROUPS = [
  {
    id: 'ai_provider',
    section: 'ai',
    title: 'Gully AI: model provider',
    body: 'The model provider key Gully AI answers with, the optional search key, and the daily cap and cost settings. A key saved here is used at once: no restart and no deploy.',
    usedIn: 'Gully AI on the site, the docs, the app and the Telegram bot, and the Gully Security review. Without a working key Gully AI answers from the docs only.',
    guide: {
      steps: [
        'Open the Anthropic Console and sign in with the account that pays for Gully AI.',
        'Set a spend limit first: Settings > Limits. Pick a monthly amount you are comfortable with.',
        'Open API keys and choose Create key. Name it (for example gully-ai) and copy it: the Console shows it once.',
        'Paste it below as the Anthropic API key and save. Then press Check: it should say accepted.',
        'Optional: a Voyage key turns on semantic search. Without it Gully AI searches by keywords.',
        'If the old key may have leaked, delete it in the Console after the new one is accepted.',
      ],
      links: [
        { label: 'Anthropic Console, API keys', url: 'https://console.anthropic.com/settings/keys' },
        { label: 'Anthropic Console, limits', url: 'https://console.anthropic.com/settings/limits' },
        { label: 'Voyage AI dashboard', url: 'https://dashboard.voyageai.com' },
      ],
      note: 'The Console pages can move: if a link opens somewhere else, look for API keys and Limits in its settings. Prices are the provider\'s: copy them from its pricing page, they are not known here.',
    },
    fields: [
      f('ANTHROPIC_API_KEY', 'Anthropic API key', 'starts with sk-ant-', /^sk-ant-[A-Za-z0-9_-]{40,250}$/, { ownerOnly: true }),
      f('VOYAGE_API_KEY', 'Voyage API key', 'from the Voyage dashboard', /^[A-Za-z0-9_-]{20,200}$/, { optional: true, ownerOnly: true }),
      f('ASK_DAILY_CAP', 'Daily cap (answers a day, all users)', 'a whole number, e.g. 2000', /^[1-9][0-9]{0,6}$/, { plain: true, optional: true, dflt: '2000', ownerOnly: true }),
      f('ASK_PRICE_INPUT_PER_MTOK', 'Input price (USD per million tokens)', 'a number from the provider\'s pricing page', /^(?:[1-9][0-9]{0,3}(?:\.[0-9]{1,4})?|0\.[0-9]{1,4})$/, { plain: true, optional: true, ownerOnly: true }),
      f('ASK_PRICE_OUTPUT_PER_MTOK', 'Output price (USD per million tokens)', 'a number from the provider\'s pricing page', /^(?:[1-9][0-9]{0,3}(?:\.[0-9]{1,4})?|0\.[0-9]{1,4})$/, { plain: true, optional: true, ownerOnly: true }),
      f('ASK_FALLBACK_MODEL', 'Fallback model', 'a model id, e.g. claude-…', /^claude-[a-z0-9][a-z0-9.-]{2,60}$/, { plain: true, optional: true, ownerOnly: true }),
    ],
    test: 'anthropic',
  },
]

export const AI_FIELD_NAMES = new Set(AI_GROUPS.flatMap((g) => g.fields.map((x) => x.name)))

const checkFile = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'admin-ai-provider-check.json')

/** The last check: { at, result } or null. Holds no key and no provider text. */
export function lastAiCheck() {
  try {
    const d = JSON.parse(fs.readFileSync(checkFile(), 'utf8'))
    return typeof d?.at === 'string' && typeof d?.result === 'string' ? { at: d.at, result: d.result.slice(0, 20) } : null
  } catch {
    return null
  }
}

function noteAiCheck(result, now = new Date().toISOString()) {
  try {
    fs.mkdirSync(path.dirname(checkFile()), { recursive: true })
    fs.writeFileSync(checkFile() + '.tmp', JSON.stringify({ at: now, result }), { mode: 0o600 })
    fs.renameSync(checkFile() + '.tmp', checkFile())
  } catch {
    /* the status line then shows no last check */
  }
}

/** A key was saved or removed: the last check was about the old one. */
export function forgetAiCheck() {
  fs.rmSync(checkFile(), { force: true })
}

const WORDS = { ok: 'accepted', unavailable: 'rejected', unknown: 'unreachable', none: 'incomplete' }
const DETAIL = {
  accepted: 'Accepted. The provider answered for this key.',
  rejected: 'Rejected by the provider. Create a new key in the Console and save it here.',
  unreachable: 'Could not reach the provider just now. The key was not judged: try again in a minute.',
  incomplete: 'No Anthropic API key is set yet.',
}

/**
 * The Check button and the check after a save. `probe` is ask.mjs checkProvider (or the promise a save started): it
 * answers { result: 'ok' | 'unavailable' | 'unknown' | 'none', status }. Returns the page's words only.
 */
export async function runAiCheck(probe) {
  let p = null
  try {
    p = await probe()
  } catch {
    /* unknown */
  }
  const result = WORDS[p?.result] ?? 'unreachable'
  if (result !== 'incomplete') noteAiCheck(result)
  const detail = result === 'unreachable' && Number.isInteger(p?.status) ? `The provider answered ${p.status}, which says nothing about the key. Try again in a minute.` : DETAIL[result]
  return { ok: result === 'accepted', status: 200, result, detail }
}

/**
 * The status line: configured / not configured / rejected (+ where the key in use comes from, the search key, the last
 * check). `health` is ask.mjs askProviderHealth(); its provider text never leaves the server.
 */
export function aiProviderStatus(health) {
  const source = aiSettingSource('ANTHROPIC_API_KEY')
  const last = lastAiCheck()
  let state = 'not_configured'
  let label = 'Not configured. Gully AI answers from the docs only.'
  if (source) {
    const from = source === 'saved' ? 'saved on this page' : 'from the server settings (a key saved here replaces it)'
    if (!health?.ok && KEY_ERROR.test(health?.lastError ?? '')) {
      state = 'rejected'
      label = `Rejected by the provider. The key in use is ${from}. Gully AI answers from the docs only until a working key is saved.`
    } else if (!health?.ok) {
      state = 'account_problem'
      label = `Configured, key ${from}, but the provider account reports a problem (billing or plan). Check the Console.`
    } else {
      state = 'configured'
      label = `Configured. The key in use is ${from}.`
    }
  }
  return { state, label, source: source ?? null, search: aiSettingSource('VOYAGE_API_KEY') ? 'on' : 'off', since: !health?.ok ? (health?.since ?? null) : null, lastCheck: last }
}
