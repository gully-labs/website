/** Types for telegram.mjs (the parts vite.config.ts uses). */
export function alertChannels(): Promise<{ webhook: { enabled: boolean }; telegram: { enabled: boolean; bot: string | null; reason?: string } }>
