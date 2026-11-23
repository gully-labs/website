// Developer tools group of admin.gullylabs.xyz Integrations (owner, 2026-11-23: "add to admin panel, I can add details, API
// keys etc"). Same write-only pattern and storage as the Chain Kit fields in admin-integrations.mjs (files in the
// integrations folder, passkey step-up, audit of names only); this file only holds the field list, the on-page guides,
// the setup-progress rules and the safe "Check" reads. NOTHING here publishes anything: values are stored, and the
// release lane reads the files when the owner says "publish".
//
// Steps in the guides come from design/gully-devtools-2026-11-23/PUBLISHER-SIGNUP.txt (general knowledge of each store,
// not re-read from its pages on the day it was written): every guide says to check the page before paying or signing.
import crypto from 'node:crypto'

const NAME = /^[a-z0-9][a-z0-9-]{1,62}$/i
const TOKEN = /^[A-Za-z0-9_.~+/=-]{16,512}$/
const SIGNUP_NOTE = 'Steps are from general knowledge and were not re-read from the store pages today: check each page before you pay or sign.'

/** Strict PEM shape for a GitHub App private key (RSA PKCS#1 or PKCS#8): headers, base64 body, DER sequence, RSA size. */
export function pemShape(raw) {
  const v = String(raw ?? '').replace(/\r\n?/g, '\n').trim()
  if (v.length > 8192) return null
  const m = /^-----BEGIN (RSA )?PRIVATE KEY-----\n([A-Za-z0-9+/=\n]+)\n-----END \1?PRIVATE KEY-----$/.exec(v)
  if (!m) return null
  const der = Buffer.from(m[2].replace(/\n/g, ''), 'base64')
  if (der.length < 1100 || der[0] !== 0x30) return null // 2048-bit RSA is about 1190 bytes: this also rules out EC and ed25519 wallet keys
  return `${v}\n`
}

const f = (name, label, hint, format, extra = {}) => ({ name, label, hint, format, ...extra })

export const DEVTOOLS_GROUPS = [
  {
    id: 'dt_vsmarketplace',
    section: 'devtools',
    title: 'VS Marketplace (VS Code)',
    body: 'Publishes the Gully Dev Copilot extension to the Visual Studio Marketplace. The publisher id is not secret; the token is.',
    usedIn: 'Release lane, extension publish: vsce publish --pat (VSCE_PAT), publisher VSCE_PUBLISHER_ID. Only when you say publish.',
    guide: {
      steps: [
        'Sign in with a Microsoft account at the Marketplace manage page.',
        'Create an Azure DevOps organization (free) if asked.',
        'On the manage page choose Create publisher. ID (permanent, lowercase): gully-labs. Display name: Gully Labs. Add website https://gullylabs.xyz, a role mailbox for support and a logo.',
        'Azure DevOps > User settings > Personal access tokens > New token. Organization: All accessible organizations. Scopes: Custom defined > Marketplace > Manage. Expiry: the longest allowed (set a reminder to renew).',
        'Paste the token below as the VS Marketplace token, and the publisher id as shown on the manage page.',
      ],
      links: [
        { label: 'Marketplace manage page', url: 'https://marketplace.visualstudio.com/manage' },
        { label: 'Azure DevOps', url: 'https://dev.azure.com' },
      ],
      note: SIGNUP_NOTE,
    },
    fields: [
      f('VSCE_PUBLISHER_ID', 'Publisher id', 'lowercase, e.g. gully-labs', NAME, { plain: true }),
      f('VSCE_PAT', 'VS Marketplace token (PAT)', 'Azure DevOps personal access token', /^[A-Za-z0-9]{40,128}$/),
    ],
  },
  {
    id: 'dt_openvsx',
    section: 'devtools',
    title: 'Open VSX (VSCodium, Cursor, Windsurf, Gitpod)',
    body: 'Publishes the same extension to the open registry the other editors read. The namespace is not secret; the token is.',
    usedIn: 'Release lane, extension publish: npx ovsx publish -p (OVSX_PAT) into the namespace OVSX_NAMESPACE. The namespace is created once after you save the token.',
    guide: {
      steps: [
        'Sign in to Open VSX with your GitHub account.',
        'Create an Eclipse Foundation account. The GitHub username on the Eclipse profile must match your GitHub login.',
        'From your Open VSX user settings page, sign the Eclipse Open VSX Publisher Agreement. It is required before publishing.',
        'Open the access tokens page and choose Generate new token.',
        'Paste the token below as the Open VSX token, and the namespace you want (gully-labs).',
      ],
      links: [
        { label: 'Open VSX', url: 'https://open-vsx.org' },
        { label: 'Eclipse account', url: 'https://accounts.eclipse.org' },
        { label: 'Open VSX access tokens', url: 'https://open-vsx.org/user-settings/tokens' },
      ],
      note: SIGNUP_NOTE,
    },
    fields: [
      f('OVSX_NAMESPACE', 'Namespace', 'lowercase, e.g. gully-labs', NAME, { plain: true }),
      f('OVSX_PAT', 'Open VSX token', 'from the access tokens page', /^[A-Za-z0-9_-]{16,128}$/),
    ],
    test: 'openvsx',
  },
  {
    id: 'dt_githubapp',
    section: 'devtools',
    title: 'GitHub App (Gully Review, PR comments)',
    body: 'The GitHub App that comments on pull requests. The App ID is not secret. The private key and the webhook secret are write-only, and the key is never stored anywhere but the secret folder.',
    usedIn: 'The Gully Review webhook handler (hosted later): signs a short-lived app token with the private key, verifies webhooks with the secret. Nothing runs until the handler is hosted and you say so.',
    guide: {
      steps: [
        'GitHub organization settings > Developer settings > GitHub Apps > New GitHub App.',
        'Name: Gully Review (any free name). Homepage: https://gullylabs.xyz. Webhook URL: given to you after the handler is hosted.',
        'Webhook secret: generate a long random value (for example the output of openssl rand -base64 32) and paste it below.',
        'Permissions: Pull requests Read and write; Contents Read-only; Metadata Read-only. Subscribe to the Pull request event. Installable on this account only, for now.',
        'After creating the App: copy the App ID (a number) below, then Generate a private key (a .pem file downloads). Open it in a text editor and paste the whole text below, including the BEGIN and END lines.',
        'Install the App on the repositories you want reviewed. Note the installation in the notes field if you like.',
      ],
      links: [{ label: 'New GitHub App (gully-labs)', url: 'https://github.com/organizations/gully-labs/settings/apps/new' }],
      note: SIGNUP_NOTE,
    },
    fields: [
      f('GITHUB_APP_ID', 'App ID', 'a number, shown on the App page', /^[0-9]{1,12}$/, { plain: true }),
      f('GITHUB_APP_PRIVATE_KEY', 'Private key (PEM)', 'paste the whole .pem file text', null, { multiline: true, pem: true }),
      f('GITHUB_APP_WEBHOOK_SECRET', 'Webhook secret', 'the long random value you set on the App', /^[A-Za-z0-9_+/=.-]{16,256}$/, { hexKeyOk: true }),
      f('GITHUB_APP_INSTALLATION_NOTES', 'Installation notes', 'where it is installed, up to 500 characters', /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]{1,500}$/, { plain: true, optional: true }),
    ],
    test: 'githubapp',
  },
  {
    id: 'dt_chrome',
    section: 'devtools',
    title: 'Chrome Web Store (Gully Lens extension)',
    body: 'Optional. API credentials for submitting the Gully Lens browser extension to the Chrome Web Store.',
    usedIn: 'Release lane, Gully Lens publish to Chrome. Optional until the extension is ready to list.',
    optionalGroup: true,
    guide: {
      steps: [
        'Open the Chrome Web Store developer dashboard with the account that owns the listing (a one-time registration fee applies).',
        'Create the OAuth client and a refresh token for the Chrome Web Store API as described in the dashboard help, then paste the three values below.',
        'The extension id appears after the first upload; add it then.',
      ],
      links: [{ label: 'Chrome Web Store developer dashboard', url: 'https://chrome.google.com/webstore/devconsole' }],
      note: SIGNUP_NOTE,
    },
    fields: [
      f('CHROME_WEBSTORE_CLIENT_ID', 'OAuth client id', 'ends in .apps.googleusercontent.com', TOKEN, { optional: true }),
      f('CHROME_WEBSTORE_CLIENT_SECRET', 'OAuth client secret', 'from the Google Cloud credentials page', TOKEN, { optional: true }),
      f('CHROME_WEBSTORE_REFRESH_TOKEN', 'Refresh token', 'from the OAuth consent step', TOKEN, { optional: true }),
      f('CHROME_WEBSTORE_EXTENSION_ID', 'Extension id', '32 letters, after the first upload', /^[a-p]{32}$/, { plain: true, optional: true }),
    ],
  },
  {
    id: 'dt_edge',
    section: 'devtools',
    title: 'Edge Add-ons (Gully Lens extension)',
    body: 'Optional. API credentials for submitting the Gully Lens extension to Microsoft Edge Add-ons.',
    usedIn: 'Release lane, Gully Lens publish to Edge. Optional until the extension is ready to list.',
    optionalGroup: true,
    guide: {
      steps: ['Sign in to Partner Center with the account that owns the Edge listing.', 'Open the Edge Add-ons publish API page, enable the API and create the client id and API key, then paste them below.'],
      links: [{ label: 'Partner Center, Microsoft Edge', url: 'https://partner.microsoft.com/dashboard/microsoftedge/overview' }],
      note: SIGNUP_NOTE,
    },
    fields: [
      f('EDGE_ADDONS_CLIENT_ID', 'Client id', 'from the publish API page', TOKEN, { optional: true }),
      f('EDGE_ADDONS_API_KEY', 'API key', 'from the publish API page', TOKEN, { optional: true }),
    ],
  },
  {
    id: 'dt_firefox',
    section: 'devtools',
    title: 'Firefox Add-ons / AMO (Gully Lens extension)',
    body: 'Optional. API keys for submitting the Gully Lens extension to addons.mozilla.org.',
    usedIn: 'Release lane, Gully Lens publish to Firefox (web-ext sign). Optional until the extension is ready to list.',
    optionalGroup: true,
    guide: {
      steps: ['Sign in at addons.mozilla.org with the developer account.', 'Open the API keys page and choose Generate new credentials. Paste the JWT issuer (looks like user:12345:67) and the JWT secret below.'],
      links: [{ label: 'AMO API keys', url: 'https://addons.mozilla.org/developers/addon/api/key/' }],
      note: SIGNUP_NOTE,
    },
    fields: [
      f('AMO_JWT_ISSUER', 'JWT issuer', 'looks like user:12345:67', /^user:[0-9]+:[0-9]+$/, { optional: true }),
      f('AMO_JWT_SECRET', 'JWT secret', '64 hex characters', /^[A-Za-z0-9]{32,128}$/, { optional: true, hexKeyOk: true }),
    ],
  },
  {
    id: 'dt_ownerheld',
    section: 'devtools',
    title: 'Held by the owner, not stored here',
    body: 'These stay with you. Nothing is entered on this page for them; the notes say what each needs and who does the step.',
    usedIn: 'Release lane: it asks you at the moment of the step.',
    guideOnly: true,
    fields: [],
    notes: [
      { id: 'npm', title: 'npm publish', text: 'You publish with your account and 2FA. No npm token is stored anywhere.', links: [{ label: 'npm access tokens', url: 'https://www.npmjs.com/settings' }] },
      { id: 'apple', title: 'Apple Developer account', text: 'For the desktop and mobile apps: the Apple Developer Program membership, certificates and notarisation credentials stay in your Apple account and Keychain. Not stored.', links: [{ label: 'Apple Developer Program', url: 'https://developer.apple.com/programs/' }] },
      { id: 'tauri', title: 'Tauri updater signing key', text: 'The key that signs desktop app updates. Generate it on your own machine and keep it offline with a backup; if it is lost, existing installs cannot be updated. Only the public half goes into the app config. Not stored.', links: [{ label: 'Tauri updater plugin', url: 'https://v2.tauri.app/plugin/updater/' }] },
      { id: 'winsign', title: 'Windows code-signing certificate', text: 'A certificate from a certificate authority (or a cloud signing service) so Windows does not warn on install. It stays with you or in the signing service. Not stored.', links: [] },
    ],
  },
]

/** Which tool waits for which missing item. `isSet(name)` says whether a file holds a value. */
export function progressOf(isSet) {
  const need = (tool, names, labels, extra = {}) => {
    const missing = names.filter((n) => !isSet(n)).map((n) => labels[n])
    return { tool, ready: missing.length === 0, missing, ...extra }
  }
  const lab = Object.fromEntries(DEVTOOLS_GROUPS.flatMap((g) => g.fields.map((x) => [x.name, x.label])))
  return [
    need('Gully Dev Copilot on the VS Marketplace', ['VSCE_PUBLISHER_ID', 'VSCE_PAT'], lab),
    need('Gully Dev Copilot on Open VSX', ['OVSX_NAMESPACE', 'OVSX_PAT'], lab),
    need('Gully Review (GitHub App, PR comments)', ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET'], lab),
    need('Gully Lens on the Chrome Web Store', ['CHROME_WEBSTORE_CLIENT_ID', 'CHROME_WEBSTORE_CLIENT_SECRET', 'CHROME_WEBSTORE_REFRESH_TOKEN'], lab, { optional: true }),
    need('Gully Lens on Edge Add-ons', ['EDGE_ADDONS_CLIENT_ID', 'EDGE_ADDONS_API_KEY'], lab, { optional: true }),
    need('Gully Lens on Firefox Add-ons', ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'], lab, { optional: true }),
    { tool: 'npm packages', ready: null, missing: [], heldByOwner: 'You publish with 2FA' },
    { tool: 'Desktop apps (Apple account, update signing key, Windows signing)', ready: null, missing: [], heldByOwner: 'Held by you, not stored here' },
  ]
}

const b64u = (b) => Buffer.from(b).toString('base64url')

/** A GitHub App JWT (RS256, 9 minutes). Throws when the key is not a usable RSA key. */
export function appJwt(appId, pem, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: String(appId) }))
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(pem)
  return `${head}.${body}.${b64u(sig)}`
}

/**
 * The "Check" button: safe reads only, never a write and never a publish.
 *  githubapp: GET https://api.github.com/app signed with the stored key (read-only), answers the app name.
 *  openvsx:   GET https://open-vsx.org/api/<namespace> (public, no token sent): does the namespace exist yet.
 * Other groups have no verified safe read: only the saved values' shape is confirmed. Never returns a value.
 */
export async function runDevtoolsTest(id, read, fetchImpl = fetch) {
  const g = DEVTOOLS_GROUPS.find((x) => x.id === id)
  if (!g || g.guideOnly) return { ok: false, status: 404, result: 'unknown', detail: 'No such tool.' }
  const missing = g.fields.filter((x) => !x.optional && read(x.name) === null).map((x) => x.label)
  if (missing.length) return { ok: false, status: 200, result: 'incomplete', detail: `Not set yet: ${missing.join(', ')}.` }
  const get = async (url, headers = {}) => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    try {
      return await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'gully-admin-check', ...headers }, signal: ctl.signal, redirect: 'error' })
    } finally {
      clearTimeout(t)
    }
  }
  try {
    if (g.test === 'githubapp') {
      let jwt
      try {
        jwt = appJwt(read('GITHUB_APP_ID'), read('GITHUB_APP_PRIVATE_KEY'))
      } catch {
        return { ok: false, status: 200, result: 'invalid', detail: 'The stored private key could not sign. Paste the .pem again.' }
      }
      const r = await get('https://api.github.com/app', { authorization: `Bearer ${jwt}`, 'x-github-api-version': '2022-11-28' })
      if (r.status === 200) {
        const d = await r.json().catch(() => ({}))
        return { ok: true, status: 200, result: 'ok', detail: `GitHub accepted the key for the app${typeof d?.name === 'string' ? ` "${d.name.slice(0, 80)}"` : ''}.` }
      }
      return { ok: false, status: 200, result: 'rejected', detail: r.status === 401 ? 'GitHub did not accept this App ID and key together.' : `GitHub answered ${r.status}.` }
    }
    if (g.test === 'openvsx') {
      const ns = read('OVSX_NAMESPACE')
      const r = await get(`https://open-vsx.org/api/${encodeURIComponent(ns)}`)
      if (r.status === 200) return { ok: true, status: 200, result: 'ok', detail: `The namespace ${ns} exists on Open VSX. The token itself is only checked when you publish.` }
      if (r.status === 404) return { ok: true, status: 200, result: 'ok', detail: `The namespace ${ns} is not created yet. It is created once, after you say publish. The token is only checked then.` }
      return { ok: false, status: 200, result: 'rejected', detail: `Open VSX answered ${r.status}.` }
    }
  } catch {
    return { ok: false, status: 200, result: 'unreachable', detail: 'The service could not be reached just now. Try again later.' }
  }
  return { ok: true, status: 200, result: 'saved', detail: 'The values are saved. This store has no safe read to check them with, so they are only used when you say publish.' }
}
