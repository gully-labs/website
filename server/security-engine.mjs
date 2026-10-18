// Gully Security: the ONE place the product UI talks to the scan engine (part 1, feat/sec-engine).
//
// INTEGRATION POINT: the engine's module API is createScan / getScan / listScans / cancelScan plus progress
// events. Until it merges, nothing here is wired to a real engine:
//   - ENGINE_MODULE is loaded on first use. If the file does not exist, engineInstalled() is false and the
//     routes answer 503 "the scan engine is not installed yet" for new scans (reads keep working).
//   - The tests install a stub (scripts/fixtures/security-stub-engine.mjs) with setEngineForTest(); the
//     stub never ships.
// When part 1 merges: point ENGINE_MODULE at its entry file if it is not server/security/index.mjs, and
// adapt the four calls in this file if its argument shapes differ from the ones written below. Nothing
// else in the UI calls the engine.
//
// Assumed engine API (what the calls below pass):
//   createScan({ workspace, input, upload? })  -> scan        upload: { name, size, bytes: Buffer } for kind 'upload'
//   getScan(id)                                -> scan | null
//   listScans({ workspace })                   -> scan[]      (not needed by the UI; jobs are tracked here)
//   cancelScan(id)                             -> scan
//   progress: onProgress(listener) -> unsubscribe,  or  events.on('progress', listener)   listener(scan)
// When the engine offers neither, progress is read by polling getScan (watchScan below).

const ENGINE_MODULE = './security/index.mjs'

let engine = null
let loading = null

async function load() {
  if (engine) return engine
  loading ??= import(ENGINE_MODULE).then(
    (m) => (engine ??= m.default && typeof m.default.createScan === 'function' ? m.default : m),
    (e) => {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND') console.error('security engine: failed to load:', e?.message ?? e)
      loading = null
      return null
    },
  )
  return loading
}

/** Test hook: install a stub engine (or null to uninstall). */
export function setEngineForTest(e) {
  engine = e
  loading = null
}

/** Whether a scan engine is installed on this server. */
export async function engineInstalled() {
  return !!(await load())
}

/** Starts a scan. Resolves the engine's scan record, or throws. */
export async function startScan({ workspace, input, upload = null }) {
  const e = await load()
  if (!e) throw Object.assign(new Error('The scan engine is not installed on this server yet.'), { status: 503 })
  return e.createScan({ workspace, input, ...(upload ? { upload } : {}) })
}

/** The engine's record of a scan, or null when unknown or unreadable. */
export async function readScan(id) {
  const e = await load()
  if (!e || !id) return null
  try {
    return (await e.getScan(id)) ?? null
  } catch (err) {
    console.error('security engine: getScan failed:', err?.message ?? err)
    return null
  }
}

/** Asks the engine to stop a scan. Resolves the updated record, or throws. */
export async function stopScan(id) {
  const e = await load()
  if (!e) throw Object.assign(new Error('The scan engine is not installed on this server yet.'), { status: 503 })
  return e.cancelScan(id)
}

/**
 * Calls `cb(scan)` whenever scan `id` changes, through the engine's progress events when it has them and
 * by polling getScan every `pollMs` otherwise. Returns a function that stops watching.
 */
export function watchScan(id, cb, { pollMs = 1_000 } = {}) {
  let stopped = false
  let last = ''
  const emit = (scan) => {
    if (stopped || !scan || scan.id !== id) return
    const key = `${scan.status}|${scan.progress?.step ?? ''}|${scan.progress?.pct ?? ''}|${scan.updatedAt ?? ''}`
    if (key === last) return
    last = key
    cb(scan)
  }
  let off = null
  load().then((e) => {
    if (stopped || !e) return
    if (typeof e.onProgress === 'function') off = e.onProgress(emit)
    else if (e.events && typeof e.events.on === 'function') {
      e.events.on('progress', emit)
      off = () => e.events.off?.('progress', emit)
    }
  })
  const poll = async () => {
    if (stopped) return
    emit(await readScan(id))
  }
  poll()
  const timer = setInterval(poll, pollMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
    try {
      off?.()
    } catch {
      /* already gone */
    }
  }
}
