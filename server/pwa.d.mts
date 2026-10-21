/** Types for pwa.mjs: manifests, the service worker's rules and generator, and the install card's logic. */
export interface Manifest {
  id: string
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}
export const SITE_MANIFEST: Manifest
export const APP_MANIFEST: Manifest
export function manifestFor(host: string): Manifest | null
export function handleManifest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL, host: string): boolean
export interface SwRules {
  never: string[]
  hashed: string
}
export const SW_RULES: SwRules
export function routeFor(rules: SwRules, req: { url: string; method: string; mode?: string; origin: string; hasAuth?: boolean }): 'asset' | 'navigate' | null
export function swEligible(host: string, pathname: string): boolean
export const INSTALL_DISMISS_KEY: string
export const INSTALL_DISMISS_DAYS: number
export function dismissedRecently(raw: string | null | undefined, now?: number): boolean
export function isIosSafari(ua: string, platform?: string, touchPoints?: number): boolean
export function installCardMode(o: { standalone: boolean; dismissedRaw: string | null | undefined; now?: number; hasPrompt: boolean; ios: boolean }): 'prompt' | 'ios' | null
