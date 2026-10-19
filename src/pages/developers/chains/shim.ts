/* Browser globals the Arbitrum chain SDK's dependencies (ethers 5, Safe) read at load time. Imported first by sdk.ts, so
   it is evaluated before they are, and only inside the lazy SDK chunk: the rest of the app is untouched. */
const g = globalThis as unknown as Record<string, unknown>
g.global ??= globalThis
g.process ??= { env: {}, versions: {}, browser: true, platform: 'browser', version: '', nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)) }
export {}
