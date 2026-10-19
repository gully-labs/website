// A small copy of the feature catalog's shape (src/content/features.ts, merged separately) for the Ask tests.
// Not real product claims: only the schema and the status handling matter here.
export type FeatureStatus = 'live' | 'beta' | 'testnet' | 'building' | 'planned'
export interface Feature {
  id: string
  product: string
  name: string
  status: FeatureStatus
  summary: string
  facts: string[]
  url?: string
  source: string[]
}

export const features: Feature[] = [
  { id: 'holder-launch-health', product: 'Holder Map', name: 'Launch Health score', status: 'live', summary: 'A score from the launch checks on a token: bundled first-block buyers, snipers, the deployer and the liquidity lock.', facts: ['Computed from public chain data.', 'It describes checks on the holder data, not a rating of the token.'], url: 'https://gullylabs.xyz/holders', source: ['src/pages/HoldersLanding.tsx'] },
  { id: 'pay-solana-checkout', product: 'Solana Pay', name: 'Solana Pay checkout', status: 'beta', summary: 'Merchants can take Solana Pay payments with a QR code on their checkout.', facts: ['Payments go straight to the merchant wallet.'], source: ['src/docs/pages/SolanaPayDocs.tsx'] },
  { id: 'chains-l3-testnet', product: 'Gully Chains', name: 'Gully L3 testnet', status: 'testnet', summary: 'A test network for the Gully L3, for developers only.', facts: ['Testnet only, no real value.'], source: ['ops/l3/SPEC.md'] },
  { id: 'tracker-alerts-telegram', product: 'Tracker', name: 'Telegram gap alerts', status: 'live', summary: 'Alerts to Telegram when a tokenised stock gap crosses your threshold.', facts: ['Set up in the app, Alerts tab.'], source: ['src/docs/pages/PlansAlerts.tsx'] },
  { id: 'zeta-vault-sweeper', product: 'Zeta Vault', name: 'Zeta vault sweeper', status: 'building', summary: 'An automatic sweeper for dust balances across chains.', facts: ['Internal prototype only.'], source: ['ops/pitch'] },
  { id: 'sdk-python', product: 'SDK', name: 'Python SDK', status: 'planned', summary: 'A Python client for the tracker API.', facts: ['No release date.'], source: ['src/docs/pages/Sdk.tsx'] },
]
