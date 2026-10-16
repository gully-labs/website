/* A page opened before a deploy asks for code files by their old names. The server keeps previous
   builds' files, but if one is still missing the cure is a reload, which fetches the current build.
   Reload at most once a minute so a real outage cannot loop. */
const KEY = 'gl-stale-reload-at'

export function isChunkError(e: unknown): boolean {
  const msg = String((e as { message?: unknown })?.message ?? e ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg)
}

/** Reloads the page unless it already did so in the last minute. Returns whether it reloaded. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* no storage: still reload once for this page view */
  }
  window.location.reload()
  return true
}
