/** Types for pwa-build.mjs. */
export function buildPrecacheList(bundle: Record<string, unknown>): string[]
export function versionStamp(list: string[], indexHtml?: string): string
export function generateSw(opts: { precache: string[]; version: string }): string
