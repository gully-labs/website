import { createElement, type ReactElement } from 'react'

/* Sign in with Gully ID on the Gully Labs App, next to Connect wallet. The Gully ID SDK (https://gullyid.xyz/sdk/v1.js,
   latest 1.x; /sdk.js while gully-id #50 is not live) loads only when the button is pressed; it runs the sign-in in a popup on gullyid.xyz (client gully-labs,
   gully-ops gully/gully-id/clients.json) and we post ONLY its access token to /api/developer/gully, which signs the
   browser in as the Gully ID's main wallet (server/gully-id.mjs).
   Written without JSX so scripts/test-gully-id.mjs can render the button under plain Node. */

export const GULLY_ID_URL = 'https://gullyid.xyz'
export const GULLY_ID_CLIENT_ID = 'gully-labs'
/** SDK channel (gully-id spec: /sdk/v1.js), then the legacy URL. */
export const GULLY_ID_SDK_PATHS = ['/sdk/v1.js', '/sdk.js']
/** The official button, byte-identical to the Gully ID brand kit v1 (buttons/sign-in-with-gullyid-dark-m.svg). */
export const GULLY_ID_BUTTON_SRC = '/brand/gullyid/sign-in-with-gullyid-dark-m.svg'

type GullyClient = {
  signIn(o?: { mode?: 'popup' | 'redirect' | 'passkey' }): Promise<{ accessToken: string }>
  handleRedirect(): Promise<{ accessToken: string } | null>
}
type GullySdk = { init(o: { clientId: string; issuer?: string }): GullyClient; version?: string }

let client: Promise<GullyClient> | null = null

function gullyClient(): Promise<GullyClient> {
  if (client) return client
  client = new Promise<GullyClient>((resolve, reject) => {
    const w = window as unknown as { GullyID?: GullySdk }
    const ready = () => (w.GullyID ? resolve(w.GullyID.init({ clientId: GULLY_ID_CLIENT_ID, issuer: GULLY_ID_URL })) : reject(new Error('Gully ID did not load. Try again.')))
    if (w.GullyID) return ready()
    // The stable 1.x channel first, then the legacy /sdk.js (1.2.0).
    const load = (paths: string[]) => {
      const s = document.createElement('script')
      s.src = `${GULLY_ID_URL}${paths[0]}`
      s.async = true
      s.onload = ready
      s.onerror = () => (paths.length > 1 ? load(paths.slice(1)) : reject(new Error('Gully ID is unreachable right now. Try again, or connect a wallet.')))
      document.head.appendChild(s)
    }
    load(GULLY_ID_SDK_PATHS)
  }).catch((e) => {
    client = null
    throw e
  })
  return client
}

/** Popup sign-in on gullyid.xyz; resolves the access token (only this goes to our server). */
export async function gullyIdAccessToken(): Promise<string> {
  const c = await gullyClient()
  const s = await c.signIn({ mode: 'popup' })
  if (!s?.accessToken) throw new Error('Gully ID sign-in was cancelled.')
  return s.accessToken
}

/** True when this page load is Gully ID's redirect back (the SDK falls back to redirect mode when a popup is blocked). */
export const isGullyIdReturn = (search: string) => /[?&]code=/.test(search) && /[?&]state=/.test(search)

/** Finishes a redirect-mode sign-in (no-op without one); resolves the access token or null. */
export async function gullyIdRedirectToken(): Promise<string | null> {
  const c = await gullyClient()
  const s = await c.handleRedirect()
  return s?.accessToken ?? null
}

/** The official "Sign in with Gully ID" button (kit SVG, label inside the image; dark variant on the dark app). */
export function GullyIdButton({ onClick, busy = false, disabled = false }: { onClick: () => void; busy?: boolean; disabled?: boolean }): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      onClick,
      disabled: busy || disabled,
      'aria-label': 'Sign in with Gully ID',
      'aria-busy': busy || undefined,
      'data-testid': 'gully-id-signin',
      className: 'inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00F7FC] disabled:cursor-default',
      style: busy ? { opacity: 0.6 } : undefined,
    },
    createElement('img', { src: GULLY_ID_BUTTON_SRC, width: 222, height: 48, alt: 'Sign in with Gully ID', draggable: false, className: 'block h-12 w-auto' }),
  )
}
