export type ServiceType = 'Smart contracts' | 'dApp / frontend' | 'Infrastructure' | 'Audit' | 'Other'

export interface Service {
  n: string
  name: string
  time: string
  description: string
  items: string[]
  /** Chip pre-selected in the contact modal by "Ask about this". */
  type: ServiceType
}

export const services: Service[] = [
  {
    n: '01',
    name: 'Smart Contracts',
    time: '6–12 weeks',
    description: 'Solidity and Rust contracts designed, tested and deployed to mainnet.',
    items: ['Token and NFT standards', 'DeFi protocols', 'Upgradeable architectures'],
    type: 'Smart contracts',
  },
  {
    n: '02',
    name: 'dApps & Frontends',
    time: '8–16 weeks',
    description: 'Wallet-connected web and mobile apps people can actually use.',
    items: ['Wallet integration', 'Indexing and APIs', 'Web and mobile clients'],
    type: 'dApp / frontend',
  },
  {
    n: '03',
    name: 'Chain Infrastructure',
    time: '8–20 weeks',
    description: 'Nodes, rollups, bridges and the plumbing underneath.',
    items: ['L2 and appchain setup', 'Bridges and oracles', 'Node operations'],
    type: 'Infrastructure',
  },
  {
    n: '04',
    name: 'Security & Audits',
    time: '2–6 weeks',
    description: 'Review, testing and hardening before and after launch.',
    items: ['Code review', 'Fuzzing and invariant tests', 'Post-launch monitoring'],
    type: 'Audit',
  },
]

export const serviceTypes: ServiceType[] = ['Smart contracts', 'dApp / frontend', 'Infrastructure', 'Audit', 'Other']

export const budgets = ['< $50k', '$50–150k', '$150k+', 'Not sure']

export const processSteps = [
  { n: '01', name: 'Discover', description: 'Scope the product, the chain and the token model.' },
  { n: '02', name: 'Prototype', description: 'A working testnet build in weeks, not quarters.' },
  { n: '03', name: 'Build & audit', description: 'Production contracts, apps and independent review.' },
  { n: '04', name: 'Launch', description: 'Mainnet release, monitoring and ongoing support.' },
]
