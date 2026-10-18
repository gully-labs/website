/** Types for peddles.mjs, the on-chain reader for Peddles and PeddleQuest. The documents are typed in src/lib/peddles.ts. */
export function handlePeddlesOnchain(): Promise<unknown>
export function startPeddlesLoop(everyMs?: number): void
export function onchainSnapshot(nowMs?: number): { chains: unknown[]; at: string; contracts: unknown }
