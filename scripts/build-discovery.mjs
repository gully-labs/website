// Builds the machine-readable discovery files the server serves, from the typed catalogs (the server cannot import
// TypeScript, so the output is committed, like server/data/ask-index.json):
//   server/data/contracts.json   served at /.well-known/contracts.json
//   server/data/llms.txt         served at /llms.txt       (the llms.txt convention: a short index of links)
//   server/data/llms-full.txt    served at /llms-full.txt  (features, products, docs and every contract)
// Sources: src/content/{contracts,features,projects}.ts and src/docs/nav.ts. npm run test:contracts fails when the
// committed files are stale, so run `node scripts/build-discovery.mjs` after changing any of them.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'server/data')
const SITE = 'https://gullylabs.xyz'
const DOCS = 'https://docs.gullylabs.xyz'

async function load(rel) {
  const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'))
}

/** Pure builder, also used by scripts/test-contracts.mjs. */
export async function build() {
  const { contracts, CONTRACT_CHAINS, VERIFIED_ON } = await load('src/content/contracts.ts')
  const { features } = await load('src/content/features.ts')
  const { projects } = await load('src/content/projects.ts')
  const navSrc = fs.readFileSync(path.join(ROOT, 'src/docs/nav.ts'), 'utf8')
  const docs = [...navSrc.matchAll(/\{ slug: '([a-z0-9-]*)', title: '([^']+)', group: '([^']+)' \}/g)].map((m) => ({ slug: m[1], title: m[2], group: m[3] }))

  const json = {
    name: 'Gully Labs contracts',
    description: 'Every on-chain address Gully Labs uses, per chain. Each entry names the file in our repositories that the address is quoted from. Third-party contracts are marked.',
    url: `${SITE}/.well-known/contracts.json`,
    docs: `${DOCS}/contracts`,
    verifiedOn: VERIFIED_ON,
    verificationSource: 'Sourcify (sourcify.dev); null means Sourcify holds no verified source for that address.',
    chains: CONTRACT_CHAINS.filter((c) => contracts.some((x) => x.chainId === c.id)),
    contracts: contracts.map(({ id, name, role, project, chainId, chain, address, owner, explorerUrl, verifiedSource, verification, audit, source, note }) => ({ id, name, role, project, chainId, chain, address, owner, explorerUrl, verifiedSource, verification, audit, source, ...(note ? { note } : {}) })),
  }

  const live = features.filter((f) => f.status === 'live' || f.status === 'beta' || f.status === 'testnet')
  const road = features.filter((f) => f.status === 'building' || f.status === 'planned')
  const line = (f) => `- [${f.name}](${f.url ?? SITE}) (${f.status}): ${f.summary}`
  const docLink = (d) => `- [${d.title}](${DOCS}${d.slug ? `/${d.slug}` : '/'}): ${d.group}`
  const head = [
    '# Gully Labs',
    '',
    '> Gully Labs builds onchain tools: a tracker of tokenised stocks against their fair price, the Holder Map, Gully Pay, Gully Security, Gully AI and a Telegram bot, plus the projects the team has shipped. Everything below is public.',
    '',
    `Site: ${SITE}. X: https://x.com/Gully_Labs. GitHub: https://github.com/gully-labs. Telegram news: https://t.me/GullyLabsNews. Bot: https://t.me/GullyLabsBot.`,
    '',
  ]
  const projLines = projects.map((p) => `- [${p.name}](${p.url}): ${p.tagline}. ${p.description} (${p.status}; ${p.chains.join(', ')})`)
  const contractsNote = `- [Contracts registry](${SITE}/.well-known/contracts.json): ${contracts.length} addresses on ${new Set(contracts.map((c) => c.chainId)).size} chains, JSON, open CORS. Docs: ${DOCS}/contracts`

  const llms = [
    ...head,
    '## Products and features (live)',
    '',
    ...live.map(line),
    '',
    '## Projects',
    '',
    ...projLines,
    '',
    '## Docs',
    '',
    ...docs.map(docLink),
    '',
    '## Contracts',
    '',
    contractsNote,
    `- [Full text for LLMs](${SITE}/llms-full.txt): this index with every feature fact, the roadmap and every contract address.`,
    '',
    '## Optional',
    '',
    '- [Roadmap](' + DOCS + '/roadmap): what is being built, with honest status',
    '- [Status](' + SITE + '/status): live uptime of every service',
    '',
  ].join('\n')

  const full = [
    ...head,
    'Statuses: live = running on the site, app or bot today; beta = running but unfinished; testnet = testnets only. Anything under Roadmap is NOT available yet.',
    '',
    '## Features available today',
    '',
    ...live.flatMap((f) => [`### ${f.name} (${f.product}, ${f.status})`, '', f.summary, '', ...f.facts.map((x) => `- ${x}`), ...(f.url ? ['', `URL: ${f.url}`] : []), '']),
    '## Roadmap (not available yet)',
    '',
    ...road.map((f) => `- ${f.name} (${f.status}): ${f.summary}`),
    '',
    '## Projects',
    '',
    ...projLines,
    '',
    '## Docs',
    '',
    ...docs.map(docLink),
    '',
    `## Contracts (${contracts.length}, verified against Sourcify on ${VERIFIED_ON})`,
    '',
    'Each line: chain, name, address, owner, Sourcify-verified source (or "no verified source"), file the address is quoted from. JSON: ' + `${SITE}/.well-known/contracts.json`,
    '',
    ...contracts.map((c) => `- ${c.chain} | ${c.name} | ${c.address} | ${c.owner} | ${c.verifiedSource ?? 'no verified source'} | ${c.source}`),
    '',
  ].join('\n')

  return { 'contracts.json': JSON.stringify(json, null, 1) + '\n', 'llms.txt': llms, 'llms-full.txt': full }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await build()
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(DATA, name), body)
  console.log(Object.entries(files).map(([n, b]) => `${n} ${b.length}B`).join(', '))
}
