// The feature catalog: the single source of truth for every Gully Labs feature, used to build Gully AI's index
// and the marketing-draft rules. Each entry is checked by scripts/test-features.mjs (npm run test:features).
//
// Status rules: 'live' only if it is on main and served by the site, app or bot; 'testnet' if it only runs on
// testnets; 'building' if it exists only on an unmerged branch or in development; 'planned' for roadmap items
// with nothing running. Never present planned or building as live. Prices and limits are quoted from config
// (server/plans.mjs and the like), so change a number there and update the fact here.
// Sources are 'website:<path>' (this repo on main), 'website:<branch>:<path>' (an unmerged branch) or
// '<repo>:<path>' (a sibling repo under PROJECTS).

export type FeatureStatus = 'live' | 'beta' | 'testnet' | 'building' | 'planned'

export interface Feature {
  /** Kebab-case, unique. */
  id: string
  /** The product or project it belongs to, e.g. 'Holder Map', 'Gully Pay', 'DeepCore'. */
  product: string
  /** Short feature name. */
  name: string
  status: FeatureStatus
  /** One or two plain British-English sentences: what it does for the user. */
  summary: string
  /** Concrete, checkable facts (chains, limits, prices from config, endpoints); each one true in code. */
  facts: string[]
  /** The public page or docs URL where a user sees it. */
  url?: string
  /** Repo paths proving it. */
  source: string[]
}

export const features: Feature[] = [
  {
    id: "tracker-fair-price-gap",
    product: "Tracker",
    name: "Stock token fair-price gap",
    status: "live",
    summary: "Shows every tracked tokenised stock at its onchain price next to its fair price and the percentage gap between them, read live.",
    facts: [
      "Chains: Robinhood Chain (33 stock tokens in server/data/robinhood-stocks.json), BNB Chain (14 Binance bStocks in bsc-stocks.json) and Solana (49 xStocks in solana-stocks.json).",
      "Fair price is a Chainlink feed read on chain with latestRoundData(); on BNB Chain it is the feed times the token's uiMultiplier(); on Solana, where a share has no Chainlink feed, it is the issuer's xStocks quote.",
      "Onchain price is read from each token's deepest pool; DexScreener or GeckoTerminal only find the pool.",
      "A pool under MIN_LIQUIDITY_USD (10,000) is shown but never flagged; a gap under IN_LINE_PCT (1) is \"in line\"; a gap of IMPLAUSIBLE_PCT (15) or more is withheld as unverified unless the pool holds TRUST_LIQUIDITY_USD (1,000,000) or more and was read on chain.",
      "A price that cannot be read is reported as unreadable, never as zero.",
      "History snapshots are taken every 5 minutes and kept for 7 days."
    ],
    url: "https://gullylabs.xyz/tracker",
    source: [
      "website:server/tracker.mjs",
      "website:server/data/robinhood-stocks.json",
      "website:server/data/bsc-stocks.json",
      "website:server/data/solana-stocks.json",
      "website:src/pages/Tracker.tsx",
      "website:src/docs/pages/Methodology.tsx"
    ]
  },
  {
    id: "tracker-movers-gap-index",
    product: "Tracker",
    name: "Gap movers and gap index",
    status: "live",
    summary: "Lists the stock tokens whose gap has moved most over the last hour or day, and a single gap index across the tracker.",
    facts: [
      "Mover windows are 1h and 24h (MOVER_WINDOWS in server/movers.mjs).",
      "Endpoints: GET /api/tracker/movers and GET /api/tracker/gap-index.",
      "Movers are in percentage points of gap, with the gap then and now."
    ],
    url: "https://docs.gullylabs.xyz/api",
    source: [
      "website:server/movers.mjs",
      "website:server/tracker.mjs",
      "website:src/docs/pages/ApiReference.tsx"
    ]
  },
  {
    id: "tracker-stock-pages",
    product: "Tracker",
    name: "Stock pages",
    status: "live",
    summary: "Gives every tracked stock token its own page with price against fair price, the gap chart, pool depth, contracts, swap, alerts and its Holder Map.",
    facts: [
      "Pages live at /tracker/<chain>/<TICKER>; the chain keys are robinhood, bsc and solana.",
      "The gap chart shows 24 hours or 7 days from the tracker's five-minute snapshots, with drag-to-zoom.",
      "The page links to the app's Alerts tab with the token preset, and copies an embeddable badge.",
      "A value that could not be read shows a dash, never zero."
    ],
    url: "https://gullylabs.xyz/tracker",
    source: [
      "website:src/pages/StockPage.tsx",
      "website:src/docs/pages/StockPagesDocs.tsx",
      "website:src/router.tsx"
    ]
  },
  {
    id: "tracker-history-api",
    product: "Tracker",
    name: "Public tracker API",
    status: "live",
    summary: "A read-only JSON API for the tracker, open without a key; a key raises the rate limit.",
    facts: [
      "Endpoints include GET /api/tracker, /api/tracker/history, /api/tracker/movers, /api/tracker/gap-index, /api/plans, /api/status and /api/stats.",
      "Anonymous callers get ANONYMOUS.perMin (60) requests a minute per IP and 7 days of history (server/plans.mjs).",
      "Keys are Bearer tokens that start gl_live_."
    ],
    url: "https://docs.gullylabs.xyz/api",
    source: [
      "website:server/access.mjs",
      "website:server/plans.mjs",
      "website:server/server.mjs",
      "website:src/docs/pages/ApiReference.tsx",
      "website:src/docs/pages/ApiKeys.tsx"
    ]
  },
  {
    id: "tracker-swaps",
    product: "Tracker",
    name: "In-page stock token swaps",
    status: "live",
    summary: "Lets a visitor swap into or out of a stock token from its page, routed by LI.FI on Robinhood Chain and BNB Chain and by Jupiter on Solana. The visitor's own wallet signs everything.",
    facts: [
      "Solana quotes and swap transactions go through GET /api/solana/jupiter/quote and POST /api/solana/jupiter/swap; the server returns an unsigned transaction and holds no key.",
      "A region check (GET /api/geo, from Cloudflare's CF-IPCountry header) can close the swap card; the list is in server/geo.mjs."
    ],
    url: "https://docs.gullylabs.xyz/swaps",
    source: [
      "website:server/jupiter.mjs",
      "website:server/geo.mjs",
      "website:src/docs/pages/SwapsDocs.tsx"
    ]
  },
  {
    id: "tracker-solana",
    product: "Tracker",
    name: "Solana xStocks coverage",
    status: "live",
    summary: "Extends the tracker to Solana xStocks, with the Holder Map, Solana Pay payments and Jupiter swaps on the same chain.",
    facts: [
      "49 xStocks are followed (those with a DEX pool of at least $1,000 per DexScreener, server/data/solana-stocks.json).",
      "Gully Pay accepts SOL, USDC and USDT on Solana."
    ],
    url: "https://docs.gullylabs.xyz/solana",
    source: [
      "website:server/solana-tracker.mjs",
      "website:server/solana.mjs",
      "website:server/data/solana-stocks.json",
      "website:src/docs/pages/SolanaDocs.tsx"
    ]
  },
  {
    id: "alerts-gap-webhook-telegram",
    product: "Tracker",
    name: "Gap alerts",
    status: "live",
    summary: "Tells a signed-in user, by signed webhook or Telegram, when a stock token's gap crosses a line they set.",
    facts: [
      "Conditions: a gap percentage above, below or either way, or a status of premium, discount or either; the target is one stock or any stock.",
      "Alert counts by plan come from PLANS in server/plans.mjs: Free 1, Pro 10, Business 100.",
      "Webhooks are signed with HMAC-SHA256 in X-Gully-Signature (sha256=<hex>) with an X-Gully-Timestamp header.",
      "Alerts can also be created from the Telegram Mini App."
    ],
    url: "https://docs.gullylabs.xyz/plans-alerts",
    source: [
      "website:server/alerts.mjs",
      "website:server/plans.mjs",
      "website:src/docs/pages/PlansAlerts.tsx",
      "website:src/pages/developers/Alerts.tsx"
    ]
  },
  {
    id: "api-plans",
    product: "Tracker",
    name: "API plans (Free, Pro, Business)",
    status: "live",
    summary: "Paid tiers of the tracker API that raise the per-key rate limit, add alerts and monitors, and lengthen history. Paid by crypto, with no custody.",
    facts: [
      "Free: $0, 600 requests a minute, 1 alert, 7 days of history, 1 contract monitor (PLANS.free).",
      "Pro: $49 per 30 days, 3,000 requests a minute, 10 alerts, 90 days of history, 10 monitors (PLANS.pro).",
      "Business: $199 per 30 days, 10,000 requests a minute, 100 alerts, 365 days of history, 50 monitors (PLANS.business).",
      "Each wallet may hold up to 5 keys on every plan; one payment buys PERIOD_DAYS (30) days.",
      "All prices and limits are read from server/plans.mjs and served at GET /api/plans."
    ],
    url: "https://gullylabs.xyz/pricing",
    source: [
      "website:server/plans.mjs",
      "website:src/pages/Pricing.tsx",
      "website:src/docs/pages/PlansAlerts.tsx"
    ]
  },
  {
    id: "widget-tracker",
    product: "Widget",
    name: "Embeddable tracker widget",
    status: "live",
    summary: "Puts live tracker data on any web page from one script tag: a ticker, a one-stock badge, a table of the widest gaps, or a Holder Map frame.",
    facts: [
      "Kinds via data-gully-widget: ticker, badge, table and holders.",
      "Themes: dark and light (data-theme); the script is public/widget.js, served from gullylabs.xyz/widget.js.",
      "One request per API base per minute, however many widgets are on the page.",
      "A widget builder is at /widget."
    ],
    url: "https://gullylabs.xyz/widget",
    source: [
      "website:public/widget.js",
      "website:src/pages/widget/WidgetPage.tsx",
      "website:src/docs/pages/WidgetGuide.tsx"
    ]
  },
  {
    id: "holder-map-core",
    product: "Holder Map",
    name: "Holder Map",
    status: "live",
    summary: "Shows who really holds a token: the biggest wallets as bubbles, wallets that trade with each other linked as clusters, and a plain-words summary.",
    facts: [
      "Supported tokens on main are DeepCore launches and the tracker's stock tokens, on Robinhood Chain, BNB Chain, Base, HyperEVM and Solana (HOLDER_CHAINS in server/holders.mjs).",
      "Pools, locks, burn addresses, exchanges and the token contract are labelled grey and never counted as wallets or put in a cluster.",
      "A chain without a data source says holder data is not available; it never draws an empty or invented map.",
      "Per-tier limits come from HOLDER_MAP in server/plans.mjs: Free lists 50 holders, Pro and Business 500; the map draws at most 120.",
      "HOLDER_MAP.gated is false today, so every visitor gets the Pro features; safety warnings are never gated."
    ],
    url: "https://gullylabs.xyz/holders",
    source: [
      "website:server/holders.mjs",
      "website:server/plans.mjs",
      "website:src/pages/HoldersPage.tsx",
      "website:src/pages/HoldersLanding.tsx",
      "website:src/docs/pages/HolderMapDocs.tsx"
    ]
  },
  {
    id: "holder-map-launch-health",
    product: "Holder Map",
    name: "Launch Health score",
    status: "live",
    summary: "Scores a DeepCore launch from 0 to 100 on liquidity, bundled buyers, the deployer's share and record, top-10 concentration and snipers. It is never behind a paywall.",
    facts: [
      "Weights (server/holders-intel.mjs): liquidity 20, bundle 20, deployer 20, top10 15, snipers 10, record 15.",
      "A part that cannot be read is left out and the score is computed over the rest."
    ],
    url: "https://docs.gullylabs.xyz/holder-map",
    source: [
      "website:server/holders-intel.mjs",
      "website:src/docs/pages/HolderMapDocs.tsx"
    ]
  },
  {
    id: "holder-map-replay-live-csv",
    product: "Holder Map",
    name: "Replay, live view and CSV",
    status: "live",
    summary: "Replays a holder map over time with a scrubber, keeps it updating live while open, and exports the holder list as CSV.",
    facts: [
      "Live updates for an open map are polled from the server and shared per token for 10 seconds.",
      "CSV is GET /api/holders/:chain/:token.csv, controlled by HOLDER_MAP.tiers.*.csv.",
      "Free-tier live view lasts liveMinutes 5; Pro and Business have no limit (HOLDER_MAP in plans.mjs).",
      "A share card is served at /card.png (1200 x 630)."
    ],
    url: "https://docs.gullylabs.xyz/holder-map",
    source: [
      "website:server/holders-intel.mjs",
      "website:server/holders-card.mjs",
      "website:server/plans.mjs"
    ]
  },
  {
    id: "holder-map-alerts",
    product: "Holder Map",
    name: "Holder Map alerts",
    status: "live",
    summary: "Alerts when the largest cluster or the top-10 share of a token reaches a level or drops, by Telegram or webhook.",
    facts: [
      "Metric is cluster or top10; fires at an \"above\" percentage or after a drop of dropPts points from its high (server/alerts.mjs).",
      "Alerts count against the plan's alert limit."
    ],
    url: "https://docs.gullylabs.xyz/holder-map",
    source: [
      "website:server/alerts.mjs",
      "website:server/holders.mjs"
    ]
  },
  {
    id: "holder-map-deep-check",
    product: "Holder Map",
    name: "Deep check",
    status: "live",
    summary: "A paid, bounded investigation of one token that traces where top holders were funded from, shared funders, the deployer's record and snipers.",
    facts: [
      "Price $9 per token (HOLDER_DEEP.priceUsd); free checks a month: Free 0, Pro 3, Business 3.",
      "A 20% discount applies when bought with a paid Gully Security scan of the same contract.",
      "Budgets per check: 150 RPC calls, 12 log spans, 60 explorer calls, 120,000 ms, 12 holders traced, 3 hops. A check that hits a limit finishes \"partial\" with the reason.",
      "Up to 3 checks per workspace may be active and 2 run at once on the server."
    ],
    url: "https://docs.gullylabs.xyz/holder-map",
    source: [
      "website:server/holders-deep.mjs",
      "website:server/holders-deep-routes.mjs",
      "website:server/plans.mjs"
    ]
  },
  {
    id: "holder-map-partner-webhooks",
    product: "Holder Map",
    name: "Launchpad partner webhooks",
    status: "live",
    summary: "Lets a launchpad tell Gully Labs about a new token and receive a signed risk flag when the pre-built Holder Map shows warning signs.",
    facts: [
      "Inbound: POST /api/partners/launch with a Bearer API key; 30 launch events a minute and 1,000 a day per key; the same token is queued once per workspace per 24 hours.",
      "Outbound: launch.flagged is sent only when risk signals exist, signed with a whsec_ secret.",
      "Registered per workspace with POST /api/developer/partners/webhook."
    ],
    url: "https://docs.gullylabs.xyz/holder-map",
    source: [
      "website:server/holders-partners.mjs",
      "website:scripts/test-holders-partners.mjs"
    ]
  },
  {
    id: "pay-invoices-links",
    product: "Gully Pay",
    name: "Invoices and pay links",
    status: "live",
    summary: "Non-custodial crypto billing: invoices and reusable pay links where the payer sends a plain transfer straight to the treasury (or the merchant), read back from the chain.",
    facts: [
      "EVM chains: Base (8453), Ethereum (1), BNB Chain (56), Arbitrum (42161), OP Mainnet (10), Polygon (137), Avalanche (43114), plus Solana; each is offered only while the Safe treasury is deployed there (server/treasury-chains.mjs).",
      "Confirmations required: Base 10, Ethereum 6, BNB Chain 15, Arbitrum 10, OP Mainnet 10, Polygon 64, Avalanche 2 (server/payments.mjs).",
      "A pay link is a fixed USD amount or an open amount between a minimum and maximum; a link makes at most LINK_INVOICES_PER_HOUR (10) invoices per IP per hour.",
      "Gully Labs never holds funds; a chainId:hash can be used once only."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay",
    source: [
      "website:server/payments.mjs",
      "website:server/paylinks.mjs",
      "website:server/invoices.mjs",
      "website:server/treasury-chains.mjs",
      "website:src/docs/pages/GullyPayDocs.tsx"
    ]
  },
  {
    id: "pay-solana-pay",
    product: "Gully Pay",
    name: "Solana Pay",
    status: "live",
    summary: "Takes SOL, USDC and USDT on Solana through Solana Pay transfer requests with a per-quote reference key.",
    facts: [
      "A payment counts only when the transaction is finalized.",
      "Found by reference with GET /api/solana/pay/find, or by a pasted signature."
    ],
    url: "https://docs.gullylabs.xyz/solana-pay",
    source: [
      "website:server/solana-pay.mjs",
      "website:server/solana-routes.mjs",
      "website:src/docs/pages/SolanaPayDocs.tsx"
    ]
  },
  {
    id: "pay-webhooks",
    product: "Gully Pay",
    name: "Signed payment webhooks",
    status: "live",
    summary: "Sends signed events when an invoice is paid, expires or is cancelled.",
    facts: [
      "Events: invoice.paid, invoice.expired, invoice.cancelled and webhook.test.",
      "Signed with HMAC-SHA256 in X-Gully-Signature with X-Gully-Timestamp, using the endpoint's own whsec_ secret."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay",
    source: [
      "website:server/pay-webhooks.mjs",
      "website:src/docs/pages/GullyPayDocs.tsx"
    ]
  },
  {
    id: "pay-button-checkout",
    product: "Gully Pay",
    name: "Pay with crypto button",
    status: "live",
    summary: "An optional script that opens a Gully Pay checkout in a popup from a normal link.",
    facts: [
      "Add data-gully-pay=\"popup\" to a link to a pay URL; \"tab\" or no script opens a new tab.",
      "The checkout cannot be put in an iframe; the script sets no cookies."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay",
    source: [
      "website:public/pay-button.js",
      "website:src/pages/pay/PayPage.tsx"
    ]
  },
  {
    id: "pay-gas-estimates",
    product: "Gully Pay",
    name: "Live gas costs per chain",
    status: "live",
    summary: "Shows what a Gully Pay payment costs in gas right now on each payment chain.",
    facts: [
      "GET /api/pay/gas; costs assume 106k gas for a fee-proxy payment and 65k for a plain ERC-20 transfer, including the L1 data fee on OP Stack chains and Arbitrum.",
      "A chain that cannot be read says unavailable."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay",
    source: [
      "website:server/gas.mjs"
    ]
  },
  {
    id: "pay-merchant-checkout",
    product: "Gully Pay",
    name: "Merchant checkout",
    status: "live",
    summary: "Lets any workspace run its own non-custodial crypto checkout, paid straight into its own wallets, for a transaction fee only.",
    facts: [
      "Default fee is DEFAULT_FEE_BPS 50 (0.5%) of payment value above a lifetime free allowance of DEFAULT_FREE_USD ($5,000), both env-overridable (server/merchant-fees.mjs).",
      "Fee statements are issued every Monday 00:00 UTC to merchants owing at least $1; unpaid after PAUSE_AFTER_DAYS (7) the merchant's checkouts pause until paid.",
      "Merchants get pay links, invoices, signed webhooks, CSV export and a branded profile.",
      "Supports USDC, USDT and each chain's own coin on Base, Ethereum, BNB Chain, Arbitrum, OP Mainnet, Polygon and Avalanche."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay-merchants",
    source: [
      "website:server/merchants.mjs",
      "website:server/merchant-fees.mjs",
      "website:src/docs/pages/GullyPayMerchantsDocs.tsx",
      "website:src/pages/merchant-pay/MerchantPay.tsx"
    ]
  },
  {
    id: "pay-fee-split-safety",
    product: "Gully Pay",
    name: "Fee split and no-stuck-funds guards",
    status: "live",
    summary: "Collects the merchant fee inside the payment through Request Network's ERC20FeeProxy on stablecoins, with guards so funds can never end up stuck in the proxy.",
    facts: [
      "A plain transfer, QR code or link never names a fee proxy as recipient on any chain (server/fee-proxy-guard.mjs).",
      "Split calls use only USDC or USDT, with the fee strictly between 0 and the amount.",
      "An hourly monitor reads every known proxy's balance and raises an admin alert on a non-zero balance (server/fee-proxy-monitor.mjs)."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay-merchants",
    source: [
      "website:server/fee-proxy-guard.mjs",
      "website:server/fee-proxy-monitor.mjs",
      "website:server/pay-guard.mjs"
    ]
  },
  {
    id: "pay-safe-deploy",
    product: "Gully Pay",
    name: "One-click Safe deployment",
    status: "live",
    summary: "Deploys a Safe multisig at the same address on another chain from inside the app, with the user's own wallet signing.",
    facts: [
      "The server works out the factory call and never holds a key or sends a transaction.",
      "Uses Safe's CREATE2 proxy factory so the address matches across chains."
    ],
    url: "https://docs.gullylabs.xyz/gully-pay-merchants",
    source: [
      "website:server/safe-deploy.mjs"
    ]
  },
  {
    id: "security-ai-scan",
    product: "Gully Security",
    name: "AI Security Scan",
    status: "live",
    summary: "A self-serve automated scan of a deployed contract, a Solidity repository, an upload or a web2 codebase. It is an AI review only until the static-tools worker runs, and is never called an audit.",
    facts: [
      "Inputs: deployed address, GitHub repo and commit, uploaded file, or web2 repo (checklist mode).",
      "Chains: Ethereum, Base, Arbitrum, OP Mainnet, BNB Chain, Polygon, Avalanche, Sepolia and Base Sepolia (server/security/chains.mjs).",
      "Price $99 per scan beyond the monthly allowance (SECURITY.scan.priceUsd); free scans a month: Free 1, Pro 3, Business 10; up to 2 active scans; uploads up to 2,000,000 bytes (server/plans.mjs).",
      "Every report is labelled \"AI review only — static tools unavailable\" and every finding has verifiedByHuman false."
    ],
    url: "https://gullylabs.xyz/security",
    source: [
      "website:server/security/index.mjs",
      "website:server/security/chains.mjs",
      "website:server/security-routes.mjs",
      "website:server/plans.mjs",
      "website:src/pages/security/SecurityPage.tsx",
      "website:src/docs/pages/GullySecurityDocs.tsx"
    ]
  },
  {
    id: "security-reports",
    product: "Gully Security",
    name: "Published scan reports",
    status: "live",
    summary: "Scan reports can be published and read as web pages, with findings, locations and draft proofs of concept.",
    facts: [
      "Pages at /security/reports and /security/reports/:id; API under /api/security/reports.",
      "Reports state the target, tools run or not run, the commit or address and a point-in-time disclaimer."
    ],
    url: "https://gullylabs.xyz/security/reports",
    source: [
      "website:server/security/reports.mjs",
      "website:src/pages/security/ReportPages.tsx"
    ]
  },
  {
    id: "security-monitors",
    product: "Gully Security",
    name: "Contract monitors",
    status: "live",
    summary: "Watches a contract and tells you by Telegram or signed webhook when a privileged change happens.",
    facts: [
      "Watches ownership transfers, ERC-1967 admin and upgrade changes, role grants and revokes, pauses, large outflows, and Safe owner or threshold changes.",
      "One pass per chain every LOOP_MS (60,000 ms); each event is delivered at most once.",
      "Monitors per plan come from PLANS: Free 1, Pro 10, Business 50."
    ],
    url: "https://docs.gullylabs.xyz/gully-security",
    source: [
      "website:server/sec-monitor.mjs",
      "website:server/plans.mjs",
      "website:src/pages/developers/security/Monitors.tsx"
    ]
  },
  {
    id: "security-review",
    product: "Gully Security",
    name: "Security Review",
    status: "live",
    summary: "People on the team read the code in scope and write up what they find. Quoted per project after a request.",
    facts: [
      "SECURITY.review is quoted with no list price and available (server/plans.mjs).",
      "Requested through the form at /security (POST /api/security/review-requests)."
    ],
    url: "https://gullylabs.xyz/security",
    source: [
      "website:server/plans.mjs",
      "website:server/security-routes.mjs"
    ]
  },
  {
    id: "security-audit",
    product: "Gully Security",
    name: "Audit",
    status: "planned",
    summary: "A premium audit tier is not offered yet. Gully Labs has published no audit reports.",
    facts: [
      "SECURITY.audit has available: false (server/plans.mjs).",
      "The roadmap says audits open only once the people, process and public record exist."
    ],
    url: "https://docs.gullylabs.xyz/roadmap",
    source: [
      "website:server/plans.mjs",
      "website:src/docs/pages/Roadmap.tsx"
    ]
  },
  {
    id: "score-contract-score",
    product: "Gully Score",
    name: "Gully Score",
    status: "live",
    summary: "A 0 to 100 reading of how a contract is controlled and how it has behaved, from public evidence only, with every component, weight and source shown.",
    facts: [
      "Nine components with weights: code verified 15, who controls it 20, delay on changes 10, can the code change 10, recent privileged changes 10, liquidity locked 10, holder spread 10, Gully Security review 10, age 5 (COMPONENTS in server/gully-score.mjs).",
      "A component that cannot be read is left out, never scored as zero; below MIN_COVERAGE (40) of the 100 weight points no score is given.",
      "Paying Gully Labs never changes a score. Methodology at GET /api/score/methodology."
    ],
    url: "https://gullylabs.xyz/score",
    source: [
      "website:server/gully-score.mjs",
      "website:src/pages/score/ScorePage.tsx",
      "website:src/docs/pages/GullyScore.tsx"
    ]
  },
  {
    id: "score-badge",
    product: "Gully Score",
    name: "Score badge",
    status: "live",
    summary: "An SVG badge of a contract's score that a project can embed on its own site.",
    facts: [
      "Rendered by server/gully-score.mjs as an SVG labelled GULLY SCORE."
    ],
    url: "https://docs.gullylabs.xyz/gully-score",
    source: [
      "website:server/gully-score.mjs",
      "website:src/docs/pages/GullyScore.tsx"
    ]
  },
  {
    id: "ai-ask",
    product: "Gully AI",
    name: "Gully AI assistant",
    status: "live",
    summary: "Answers questions about Gully Labs from its own docs and live data, cites its sources and says it does not know when it does not.",
    facts: [
      "Retrieval is hybrid: BM25, a synonym-expanded BM25 and, when VOYAGE_API_KEY is set, embeddings, fused by reciprocal-rank fusion.",
      "Live tools include get_plans, get_stock, get_top_gaps, deepcore_launches, deepcore_pool, get_holders, get_gully_score, get_published_reports, get_pay_chains, get_status and get_pay_gas; signed-in users also get get_my_store, get_my_usage and get_my_alerts.",
      "Default answer model is claude-haiku-5-5 (ASK_MODEL); the log keeps a salted IP hash only, for 90 days.",
      "Per-visitor limits default to 6 a minute and 60 a day; ASK_DAILY_LIMIT caps all surfaces at 2000 a day.",
      "It runs on the site (/ask), the docs, the app, ⌘K and Telegram (/ask)."
    ],
    url: "https://gullylabs.xyz/ask",
    source: [
      "website:server/ask.mjs",
      "website:server/ask-index.mjs",
      "website:src/pages/ask/AskPage.tsx",
      "website:src/docs/pages/GullyAiDocs.tsx"
    ]
  },
  {
    id: "telegram-bot-commands",
    product: "Telegram bot",
    name: "@GullyLabsBot commands and alerts",
    status: "live",
    summary: "A Telegram bot with a menu for gaps, movers, new DeepCore launches, Holder Map, contract scans, Gully Score and Gully AI, plus alert delivery.",
    facts: [
      "Private-chat commands: start, app, gap, top, movers, launches, holders, alerts, security, score, ask, help, stop. Groups get gap, top, launches and help.",
      "Alerts can be paused, muted for 24 hours, tested or deleted from the chat.",
      "A chat is connected to a wallet account from the app dashboard."
    ],
    url: "https://docs.gullylabs.xyz/telegram",
    source: [
      "website:server/telegram.mjs",
      "website:server/telegram-ui.mjs",
      "website:src/docs/pages/TelegramDocs.tsx"
    ]
  },
  {
    id: "telegram-news-gate",
    product: "Telegram bot",
    name: "News channel gate",
    status: "live",
    summary: "Asks users to follow @GullyLabsNews to use the bot's features, while leaving alerts, mute, pause, delete and unlink open.",
    facts: [
      "If membership cannot be checked, the gate lets people through.",
      "The same gate applies in the Mini App."
    ],
    url: "https://docs.gullylabs.xyz/news-gate",
    source: [
      "website:server/telegram.mjs",
      "website:server/telegram-miniapp.mjs",
      "website:src/docs/pages/NewsGateDocs.tsx"
    ]
  },
  {
    id: "telegram-mini-app",
    product: "Mini App",
    name: "Telegram Mini App",
    status: "live",
    summary: "The Gully app inside Telegram, with stock gaps, DeepCore launches and alerts for the account linked to your chat.",
    facts: [
      "Served at gullylabs.xyz/tg; each request carries Telegram initData, validated with HMAC-SHA256 and refused after 24 hours.",
      "Routes: /api/tg/me, /sparks, /launches, /alerts and /announcements."
    ],
    url: "https://gullylabs.xyz/tg",
    source: [
      "website:server/telegram-miniapp.mjs",
      "website:src/pages/tg/TgApp.tsx",
      "website:src/docs/pages/TelegramMiniAppDocs.tsx"
    ]
  },
  {
    id: "telegram-deepcore-launch-alerts",
    product: "Telegram bot",
    name: "New DeepCore launch alerts",
    status: "live",
    summary: "Alerts when a new token launches on DeepCore, on any chain or one you pick.",
    facts: [
      "DeepCore chains: BNB Chain (56), HyperEVM (999), Robinhood Chain (4663) and Base (8453)."
    ],
    url: "https://docs.gullylabs.xyz/telegram",
    source: [
      "website:server/deepcore.mjs",
      "website:server/telegram-miniapp.mjs"
    ]
  },
  {
    id: "analytics-self-serve",
    product: "Gully Analytics",
    name: "Gully Analytics",
    status: "live",
    summary: "Privacy-friendly web analytics with Web3 events, a fork of Umami, that a wallet signs up for in the app and pays for with Gully Pay.",
    facts: [
      "Free trial of ANALYTICS_TRIAL_DAYS (14) days with 1 site and 10,000 events a month.",
      "Starter: $19, 3 sites, 100,000 events a month. Growth: $79, 10 sites, 1,000,000 events a month (ANALYTICS_PLANS; the prices are placeholders until the owner sets them).",
      "After a lapse, events are refused but the dashboard stays readable for ANALYTICS_GRACE_DAYS (30) days.",
      "Events over quota are answered 402 by the proxy at analytics.gullylabs.xyz."
    ],
    url: "https://gullylabs.xyz/analytics",
    source: [
      "website:server/analytics.mjs",
      "website:server/analytics-accounts.mjs",
      "website:server/plans.mjs",
      "website:src/docs/pages/AnalyticsDocs.tsx"
    ]
  },
  {
    id: "app-dashboard",
    product: "App",
    name: "Gully Labs App dashboard",
    status: "live",
    summary: "A wallet-signed-in dashboard at app.gullylabs.xyz for keys, alerts, usage, billing, analytics, security, Gully Pay and the other services.",
    facts: [
      "Sign-in is Sign-In with Ethereum (EIP-4361), including smart-contract wallets via EIP-1271 and ERC-6492.",
      "The old developers host was retired on 2026-10-17; /app and /developers on the main site redirect to the app."
    ],
    url: "https://app.gullylabs.xyz/",
    source: [
      "website:server/hosts.mjs",
      "website:server/siwe.mjs",
      "website:src/pages/developers/DevelopersPage.tsx"
    ]
  },
  {
    id: "app-teams-workspaces",
    product: "App",
    name: "Teams and workspaces",
    status: "live",
    summary: "Every wallet is a workspace; owners invite teammates by wallet or link with roles, and an activity log records changes.",
    facts: [
      "Roles: owner, admin, developer, billing, viewer (server/workspaces.mjs).",
      "CSV exports of usage and payments: GET /api/developer/export/usage.csv and payments.csv.",
      "Usage notices fire at 80% and 100% of a key's per-minute limit."
    ],
    url: "https://docs.gullylabs.xyz/teams",
    source: [
      "website:server/workspaces.mjs",
      "website:server/activity.mjs",
      "website:server/exports.mjs",
      "website:src/docs/pages/Teams.tsx"
    ]
  },
  {
    id: "status-page",
    product: "Docs",
    name: "Public status page",
    status: "live",
    summary: "A public page and JSON endpoint showing the health of the API, tracker data, DeepCore poller, Telegram bot, payment RPCs, Gully AI, the scan engine, monitors and Holder Map sources.",
    facts: [
      "Checks run every 60 seconds with 24 hours of samples kept; incidents open and close on state changes.",
      "Endpoint: GET /api/status."
    ],
    url: "https://gullylabs.xyz/status",
    source: [
      "website:server/status.mjs",
      "website:src/pages/Status.tsx",
      "website:src/docs/pages/StatusDocs.tsx"
    ]
  },
  {
    id: "docs-site",
    product: "Docs",
    name: "Docs site and changelog",
    status: "live",
    summary: "Documentation for every product at docs.gullylabs.xyz, with a searchable sidebar, an API reference, a roadmap and a dated changelog.",
    facts: [
      "Pages cover the tracker, API, widget, SDK, Holder Map, Gully Pay, Gully Security, Gully Score, Gully AI, Telegram, Solana, Chain Kit, status, roadmap and changelog (src/docs/nav.ts)."
    ],
    url: "https://docs.gullylabs.xyz/",
    source: [
      "website:src/docs/nav.ts",
      "website:src/docs/routes.tsx",
      "website:src/docs/pages/Changelog.tsx"
    ]
  },
  {
    id: "site-home-stats",
    product: "Gully Labs",
    name: "Cross-venue live stats",
    status: "live",
    summary: "The home page shows live figures read from each Gully Labs project's own public API, each with its source.",
    facts: [
      "Venues read: Cartel Family, DeepCore, PeddleSwap, Peddles and PeddleQuest (server/stats.mjs).",
      "A venue that cannot be read is reported as an error, never as zeros; a token-denominated figure is never added to a dollar total."
    ],
    url: "https://gullylabs.xyz/",
    source: [
      "website:server/stats.mjs",
      "website:src/content/projects.ts"
    ]
  },
  {
    id: "services-engineering",
    product: "Gully Labs",
    name: "Engineering services",
    status: "live",
    summary: "Gully Labs takes on smart contract, dApp, chain infrastructure and security work on request.",
    facts: [
      "Smart Contracts (6-12 weeks), dApps and Frontends (8-16 weeks), Chain Infrastructure (8-20 weeks) and Gully Security (quoted) are listed in src/content/services.ts.",
      "Enquiries go through POST /api/contact."
    ],
    url: "https://gullylabs.xyz/services",
    source: [
      "website:src/content/services.ts",
      "website:src/pages/Services.tsx"
    ]
  },
  {
    id: "site-blog",
    product: "Gully Labs",
    name: "Blog",
    status: "live",
    summary: "A self-hosted Ghost blog at blog.gullylabs.xyz with generated share images.",
    facts: [
      "Share images are 1200 x 630 PNGs rendered at /og/blog/<slug>.png.",
      "New posts can auto-post to the @GullyLabsNews channel."
    ],
    url: "https://blog.gullylabs.xyz/",
    source: [
      "website:server/blog.mjs",
      "website:server/og.mjs",
      "website:server/telegram-channel.mjs"
    ]
  },
  {
    id: "site-token-logos",
    product: "Gully Labs",
    name: "Token logo service",
    status: "live",
    summary: "Serves token logos by chain and address for the whole stack, from the first source that returns a valid image.",
    facts: [
      "GET /api/logo/:chain/:address at 64, 128 or 256 px.",
      "Sources in order: DeepCore, DexScreener, Jupiter or the xStocks logo, CoinGecko, Trust Wallet."
    ],
    url: "https://gullylabs.xyz/",
    source: [
      "website:server/token-logos.mjs"
    ]
  },
  {
    id: "chain-kit-explorer",
    product: "Chain Kit",
    name: "Chain Kit managed explorer",
    status: "live",
    summary: "A branded Blockscout block explorer for your EVM chain, deployed and run by Gully Labs. Available on request.",
    facts: [
      "Requested from the app (POST /api/developer/chain-kit/request) or the contact form.",
      "Blockscout and our deployment layer are GPL-3.0.",
      "Rollup profiles cover Arbitrum Nitro and Orbit chains."
    ],
    url: "https://gullylabs.xyz/chain-kit",
    source: [
      "website:server/developer.mjs",
      "website:src/docs/pages/ChainKitDocs.tsx",
      "website:src/pages/developers/Products.tsx"
    ]
  },
  {
    id: "chains-devnet-waitlist",
    product: "Gully Chains",
    name: "Gully Chains waitlist",
    status: "live",
    summary: "A waitlist in the app for Gully Chains devnet news. No chain is running yet.",
    facts: [
      "POST /api/developer/chains-waitlist saves an email against the wallet.",
      "The home console labels Gully Chains as SOON."
    ],
    url: "https://gullylabs.xyz/",
    source: [
      "website:server/developer.mjs",
      "website:server/store.mjs",
      "website:src/components/landing/ProductConsole.tsx"
    ]
  },
  {
    id: "l3-gully-l3",
    product: "Gully Chains",
    name: "Gully L3 (Arbitrum chain)",
    status: "planned",
    summary: "A planned Arbitrum chain settling to Arbitrum One with Chain Kit as explorer, Gully Pay native and Hyperlane interop. Spec written, nothing running.",
    facts: [
      "Stages: S0 light devnet (Nitro dev mode, chain id 412346, prepared but not started), S1 public devnet on Arbitrum Sepolia, S2 production L3.",
      "Recommended: Rollup data availability and ETH as gas token; Hyperlane Warp Routes for USDC and ETH.",
      "There is no public RPC, explorer, faucet, bridge or Hyperlane deployment."
    ],
    url: "https://docs.gullylabs.xyz/roadmap-l3",
    source: [
      "website:src/docs/pages/RoadmapL3.tsx",
      "website:ops/l3/SPEC.md",
      "website:ops/devnet/README.md"
    ]
  },
  {
    id: "roadmap-bug-bounty-hosting",
    product: "Gully Security",
    name: "Bug bounty hosting",
    status: "planned",
    summary: "Hosting bug bounty programmes for reviewed projects is a later item on the security roadmap.",
    facts: [
      "Listed as \"Later\" in the roadmap; nothing is built."
    ],
    url: "https://docs.gullylabs.xyz/roadmap",
    source: [
      "website:src/docs/pages/Roadmap.tsx"
    ]
  },
  {
    id: "holder-map-any-token",
    product: "Holder Map",
    name: "Map any token",
    status: "building",
    summary: "Holder Map would accept any ERC-20 on four EVM chains and any SPL token on Solana, not only DeepCore launches and tracked stock tokens. A pasted address is checked to be a token first, and a plain token gets holders, clusters and concentration.",
    facts: [
      "Chains in HOLDER_CHAINS: Robinhood Chain (4663), BNB Chain (56), Base (8453), HyperEVM (999) and Solana.",
      "An address is probed before anything is built: an ERC-20 must answer decimals() and totalSupply(); on Solana it must be a mint. With no chain given, every supported chain is checked at once and a token found on several chains gives a picker.",
      "Holder sources in order: own Transfer-log index on an archive node (exact balances), then Blockscout, then Moralis (top holders only, labelled).",
      "Tokens nobody listed are capped at 40,000 transfers (anyCap) and 300 log-read calls (anyMaxCalls); past a cap the map is labelled 'top holders only' or 'unavailable'. Listed DeepCore tokens keep a 15,000-transfer rebuild cap.",
      "Limits for non-listed tokens: 5 new maps per IP per minute, 30 per minute across all IPs, 2 built at once; address checks 8 per IP per minute and 60 per minute overall. Maps already built are free.",
      "Launch checks and the health score stay limited to DeepCore launches and launchpads in the registry; a plain token gets holders, clusters and concentration.",
      "GET /api/holders/sources reports per chain whether any token maps with full history, top holders or not yet; the /holders page shows the same as chips.",
      "A map still being read returns a progress value (0 to 1) and the page asks again every 8 seconds."
    ],
    url: "https://gullylabs.xyz/holders",
    source: [
      "website:feat/holder-map-any-token:server/holders-any.mjs",
      "website:feat/holder-map-any-token:server/holders.mjs",
      "website:feat/holder-map-any-token:server/holders-logs.mjs",
      "website:feat/holder-map-any-token:src/pages/HoldersLanding.tsx",
      "website:feat/holder-map-any-token:src/docs/pages/HolderMapDocs.tsx",
      "website:feat/holder-map-any-token:src/lib/holders.ts"
    ]
  },
  {
    id: "holder-map-launchpad-detection",
    product: "Holder Map",
    name: "Launchpad launch detection (Peddles, PeddleSwap)",
    status: "building",
    summary: "A registry of launchpads lets the Holder Map recognise a token as a launch from a known launchpad. Peddles and PeddleSwap are the first two entries.",
    facts: [
      "Peddles: Robinhood Chain 4663, Base 8453, BNB Chain 56; looked up via api.peddles.xyz (/api/v1/tokens/:chainId/:token, kind LAUNCH) with the PoolRegistered fee-hook event as fallback.",
      "PeddleSwap: Robinhood Chain 4663 (api.peddleswap.xyz) and Base 8453 (api-base.peddleswap.xyz); looked up via /v1/launches/:token.",
      "Positive results are cached for a day, 'not a launch' for 10 minutes; calls time out at 6 s, 4 lookups at a time, 120 uncached lookups a minute.",
      "The registry is read-only and an unknown or unreachable result degrades to a generic token map. Wiring into the map endpoint (knownLaunch) is in feat/holder-map-any-token; the launchpads branch adds only the module and tests."
    ],
    url: "https://gullylabs.xyz/holders",
    source: [
      "website:feat/holder-map-launchpads:server/holders-launchpads.mjs",
      "website:feat/holder-map-launchpads:scripts/test-launchpads.mjs",
      "website:feat/holder-map-integrations:server/holders-launchpads.mjs",
      "website:feat/holder-map-any-token:server/holders.mjs"
    ]
  },
  {
    id: "holder-map-integrate-docs",
    product: "Holder Map",
    name: "Integrate the Holder Map: docs and launchpad partner guide",
    status: "building",
    summary: "A new docs page, 'Integrate the Holder Map', explains the embed, the iframe, the public API and the share card, and invites launchpads to be listed. A partner guide describes what a launchpad must supply.",
    facts: [
      "New docs page slug holder-map-integrate, in the Products group, with sections: overview, embed, frame, API, response, card, SDK, launchpads.",
      "Embed: a div with data-gully-widget=\"holders\", data-chain (robinhood|bsc|base|hyperevm|solana), data-token and data-height (360 to 2000, default 760), plus widget.js; a 'Powered by Gully Labs' credit shows on the free embed.",
      "API: GET /api/holders/:chain/:token (CORS open, no key to start), /:token.csv (needs a plan that includes it, otherwise 403), /card.png (1200 x 630 share card, free).",
      "Partner guide ops/LAUNCHPAD-INTEGRATION.md: a launchpad supplies either a token API (404 when not theirs) or a factory event; at most 120 calls a minute, 6 s timeout, a day's cache; contact hello@gullylabs.xyz.",
      "Part 1 of the kit: the registry is not yet wired into the map in this branch (only in feat/holder-map-any-token)."
    ],
    url: "https://docs.gullylabs.xyz/holder-map-integrate",
    source: [
      "website:feat/holder-map-integrations:src/docs/pages/HolderMapIntegrateDocs.tsx",
      "website:feat/holder-map-integrations:src/docs/nav.ts",
      "website:feat/holder-map-integrations:src/docs/routes.tsx",
      "website:feat/holder-map-integrations:ops/LAUNCHPAD-INTEGRATION.md",
      "website:feat/holder-map-integrations:server/holders-launchpads.mjs"
    ]
  },
  {
    id: "peddles-onchain-ledger",
    product: "Ecosystem",
    name: "Peddles and PeddleQuest read on chain",
    status: "building",
    summary: "Peddles and PeddleQuest figures would be read straight from their contracts instead of only from the venues' APIs, with a live ledger series and an on-chain panel on their project pages.",
    facts: [
      "Chains read: Base 8453, Robinhood Chain 4663, Arc 5042 and BNB Chain 56.",
      "Reads PoolRegistered, FeeAccrued, SniperFeeAccrued, CreatorSwept, HoldersSwept, LaunchFeePaid, FeeCollected, CollectionCreated, BuybackAndBurn (Base), PeddleQuest escrow, promotion market and badge events, and Uniswap v4 PoolManager Swap, ModifyLiquidity and Initialize events.",
      "PeddleQuest contracts are at the same addresses on all four chains: escrow 0x16267bE6D067b3d411bf779B5aD041f9eba4CadE, market 0x704E5eA6752EbfcEDB377512b67c0138461f4849, badge 0x6DA219d4072A91665F702e34ca6CcaCd3eA7AE91.",
      "Backfills once from the fee hook's deploy block, then updates every 30 seconds (PEDDLES_LOOP=off disables it). Contracts are re-checked for code at runtime.",
      "Endpoint GET /api/peddles/onchain (cache 20 s); also available as a Vercel function.",
      "DefiLlama stays as a cross-check; if our all-time differs by more than 10% ours is shown with a footnote. An asset with no price feed is counted as unpriced, never as $0.",
      "The home hero ledger gains a pulsing live dot and a LIVE swap counter; project pages for peddles and peddlequest gain an on-chain panel listing each contract with a link to the explorer."
    ],
    url: "https://gullylabs.xyz/projects/peddles",
    source: [
      "website:feat/peddles-onchain:server/peddles.mjs",
      "website:feat/peddles-onchain:api/peddles/onchain.ts",
      "website:feat/peddles-onchain:src/components/OnchainPanel.tsx",
      "website:feat/peddles-onchain:src/components/landing/HeroLedger.tsx",
      "website:feat/peddles-onchain:src/pages/ProjectDetail.tsx",
      "website:feat/peddles-onchain:server/stats.mjs"
    ]
  },
  {
    id: "home-console-holder-map-tab",
    product: "Holder Map",
    name: "Holder Map tab in the home console",
    status: "building",
    summary: "The home page product console gains a Holder Map tab showing the live mini map of the newest DeepCore launch with the latest launches under it.",
    facts: [
      "Data comes from GET /api/deepcore/launches; a quiet feed is said to be quiet.",
      "The Security tab also gains a ring chart of the Gully Score weights read from /api/score.",
      "The tracker tab is renamed 'Stock tracker' with the button 'Open the Stock tracker'."
    ],
    url: "https://gullylabs.xyz/",
    source: [
      "website:fix/design-site:src/components/landing/HolderPane.tsx",
      "website:fix/design-site:src/components/landing/ProductConsole.tsx"
    ]
  },
  {
    id: "token-logos-tracker-swap-score-widget",
    product: "Brand",
    name: "Token logos on tracker, swap, score and widget",
    status: "building",
    summary: "Stock rows, stock pages, the swap and the widget would show token logos from the logo service instead of a generic building icon, and the stock page keeps the self-gating Holder Map.",
    facts: [
      "Only valid EVM addresses or Solana mints are sent to the logo service; anything else gets the neutral token glyph with no request.",
      "The widget uses the embed's API base for logos (public/widget.js).",
      "Status board contrast and a ghost chart for empty states are also fixed in this branch."
    ],
    url: "https://gullylabs.xyz/tracker",
    source: [
      "website:fix/design-site:src/components/tracker/StockLogo.tsx",
      "website:fix/design-site:src/pages/StockPage.tsx",
      "website:fix/design-site:public/widget.js",
      "website:fix/design-site:src/components/swap/JupiterSwap.tsx",
      "website:fix/design-site:src/pages/score/ScorePage.tsx"
    ]
  },
  {
    id: "sdk-tracker-client",
    product: "SDK",
    name: "Tracker API client",
    status: "beta",
    summary: "@gullylabs/tracker is a typed client for the stock token tracker API, with no dependencies. It runs anywhere fetch exists.",
    facts: [
      "Package @gullylabs/tracker, version 0.1.0 in package.json",
      "Methods include getTracker, getStock, getRows, widestGaps, getHistory and watch",
      "Covers tokenised stocks on Robinhood Chain and BNB Chain (chain keys 'robinhood' and 'bsc')",
      "Anonymous calls are limited to 60 a minute per IP; an API key raises that to 600",
      "watch() polls every 60 seconds by default, matching the tracker refresh",
      "isTrusted(row) keeps rows with a readable gap and status in-line, drifting, premium or discount",
      "A price that cannot be read is null, never zero",
      "Failures raise GullyApiError with a status (0 for network error or timeout) and retryAfter on a 429"
    ],
    url: "https://docs.gullylabs.xyz/api",
    source: [
      "gully-sdk:README.md",
      "gully-sdk:packages/tracker/README.md",
      "gully-sdk:packages/tracker/src/index.ts",
      "gully-sdk:packages/tracker/package.json"
    ]
  },
  {
    id: "sdk-widget",
    product: "SDK",
    name: "Embeddable tracker widget",
    status: "beta",
    summary: "@gullylabs/widget puts the tracker on any page as a ticker, a one-stock badge or a sortable table. It ships a loader script and a React component.",
    facts: [
      "Package @gullylabs/widget, version 0.1.0",
      "Widget types are ticker, badge and table",
      "Drawn in its own shadow root so it does not clash with page styles",
      "Script-tag install via https://gullylabs.xyz/widget.js and a data-gully-widget attribute",
      "React component GullyWidget is exported from @gullylabs/widget/react",
      "Badge shows a 24-hour gap chart for one stock; table and ticker take a limit option",
      "Supports a light theme option"
    ],
    url: "https://gullylabs.xyz/tracker",
    source: [
      "gully-sdk:README.md",
      "gully-sdk:packages/widget/README.md",
      "gully-sdk:packages/widget/src/index.ts",
      "gully-sdk:packages/widget/src/react.tsx",
      "gully-sdk:packages/widget/package.json"
    ]
  },
  {
    id: "sdk-holders",
    product: "SDK",
    name: "Holder Map client and component",
    status: "beta",
    summary: "@gullylabs/holders is a typed client for the Holder Map API plus a React component that frames the live map.",
    facts: [
      "Package @gullylabs/holders, version 0.1.0",
      "createHoldersClient().getMap(chain, tokenOrTicker) returns the map or a state of unavailable, not-found, busy or error",
      "Chains supported: robinhood, bsc, base, hyperevm, solana",
      "cardUrl() builds a 1200 x 630 share card image URL",
      "getCsv needs a plan that includes CSV export",
      "React HolderMap component frames gullylabs.xyz/embed/holders/:chain/:token; height is 360 to 2000, default 760",
      "A 'Powered by Gully Labs' credit always shows in the frame"
    ],
    url: "https://gullylabs.xyz/holders",
    source: [
      "gully-sdk:packages/holders/README.md",
      "gully-sdk:packages/holders/src/index.ts",
      "gully-sdk:packages/holders/src/react.tsx",
      "gully-sdk:packages/holders/package.json"
    ]
  },
  {
    id: "sdk-licence-keys",
    product: "SDK",
    name: "API keys and licence",
    status: "beta",
    summary: "The SDK is MIT licensed. Keys come from the developer portal and raise the rate limit tenfold.",
    facts: [
      "Repository licence is MIT (LICENSE file present)",
      "Keys are issued at developers.gullylabs.xyz by signing in with a wallet",
      "createTrackerClient accepts an apiKey option"
    ],
    url: "https://developers.gullylabs.xyz",
    source: [
      "gully-sdk:README.md",
      "gully-sdk:LICENSE",
      "gully-sdk:packages/tracker/src/index.ts"
    ]
  },
  {
    id: "chainkit-explorer",
    product: "Chain Kit",
    name: "Hosted Blockscout explorer",
    status: "building",
    summary: "A branded Blockscout explorer for an EVM chain, configured and run by Gully Labs. The deployment layer exists in the fork; no hosted explorer is confirmed in the repo.",
    facts: [
      "Lives in gully-blockscout/gully on branch gully/chain-kit",
      "Upstream Blockscout code is unchanged; the fork adds a pinned compose stack, chain profiles, branding and a provisioning script",
      "Stack is backend, frontend, stats, visualizer, sig-provider and optional user-ops-indexer images, with Postgres 17, Redis and a Caddy proxy",
      "Caddy gives automatic Let's Encrypt TLS on one hostname",
      "Footer credit reads 'Explorer by Gully Labs'",
      "Service level targets in the README are marked 'to be set by Gully Labs'"
    ],
    url: "https://gullylabs.xyz/chain-kit",
    source: [
      "gully-blockscout:gully/README.md",
      "gully-blockscout:gully/compose/docker-compose.yml",
      "gully-blockscout:gully/branding/gully-frontend.env",
      "gully-blockscout:README.md"
    ]
  },
  {
    id: "chainkit-chain-profiles",
    product: "Chain Kit",
    name: "Chain profiles",
    status: "building",
    summary: "Each chain is one env file. Profiles exist for Robinhood Chain and Arc, plus a template for any EVM chain.",
    facts: [
      "Profiles: chains/robinhood.env (chain ID 4663, Arbitrum Nitro/Orbit, ETH gas), chains/arc.env (chain ID 5042, USDC native gas with 18 decimals), chains/template.env for any geth-compatible chain",
      "Both shipped profiles start with internal transactions turned off because the public RPCs offered no debug_* methods on 2026-10-16",
      "Robinhood profile also has archive balances off",
      "Hardware tiers documented: Small 4 vCPU / 16 GB / 250 GB, Standard 8 / 32 GB / 1-2 TB, High throughput 16-32 vCPU / 64-128 GB / 4-8 TB"
    ],
    source: [
      "gully-blockscout:gully/README.md",
      "gully-blockscout:gully/chains/robinhood.env",
      "gully-blockscout:gully/chains/arc.env",
      "gully-blockscout:gully/chains/template.env"
    ]
  },
  {
    id: "chainkit-provisioning",
    product: "Chain Kit",
    name: "One-command provisioning",
    status: "building",
    summary: "provision.sh sets up a server for a chosen chain profile and is safe to re-run.",
    facts: [
      "Command: sudo ./gully/provision.sh --chain arc (or robinhood)",
      "Targets Ubuntu 24.04; installs Docker and the compose plugin if missing",
      "Writes /opt/gully-chain-kit/<chain>/.env with mode 600 and generates database passwords and SECRET_KEY_BASE; existing secrets are never rotated",
      "Calls eth_chainId on the RPC and stops if it does not match CHAIN_ID",
      "Options include --no-up, --profile user-ops, --deploy-dir and --skip-rpc-check",
      "--reset-data deletes the chain's volumes and only runs with --yes-destroy-data"
    ],
    source: [
      "gully-blockscout:gully/README.md",
      "gully-blockscout:gully/provision.sh"
    ]
  },
  {
    id: "chainkit-apis-verification",
    product: "Chain Kit",
    name: "Explorer APIs and contract verification",
    status: "building",
    summary: "The explorer exposes the standard Blockscout interfaces and contract verification.",
    facts: [
      "REST API v2, Etherscan-compatible API, JSON-RPC proxy, GraphQL and WebSocket updates are listed",
      "Verification covers Solidity and Vyper (standard JSON, flattened, multi-part, Sourcify)",
      "Rollup views (batches, L1/L2 messages) for Arbitrum Orbit chains once parent-chain tracking is on",
      "Health endpoints: /api/health, /api/health/liveness, /api/health/readiness, /api/v2/main-page/indexing-status"
    ],
    source: [
      "gully-blockscout:gully/README.md"
    ]
  },
  {
    id: "chainkit-operations",
    product: "Chain Kit",
    name: "Operations runbook",
    status: "building",
    summary: "An operator runbook covers upgrades, reindexing, backups and disk sizing for hosted explorers.",
    facts: [
      "OPERATIONS.md sections: day-to-day checks, upgrades, reindexing, backup and restore, sizing, disk growth, common failures",
      "Nightly logical pg_dump with off-host shipping is described; retention is still to be set",
      "Docker logs capped at 5 x 50 MB per container",
      "Versions are pinned in the chain env and upgraded together"
    ],
    source: [
      "gully-blockscout:gully/OPERATIONS.md",
      "gully-blockscout:gully/README.md"
    ]
  },
  {
    id: "analytics-web3-tracking",
    product: "Gully Analytics",
    name: "Web3 tracking",
    status: "live",
    summary: "An opt-in tracker mode that records wallet connects, chain switches and transactions on top of normal Umami analytics.",
    facts: [
      "Enabled with data-web3=\"true\" on the tracker script; without it the script behaves like the Umami tracker",
      "Events: wallet-connect, wallet-disconnect, chain-switch, tx-sent",
      "Finds wallets through EIP-6963 and window.ethereum, and never calls a wallet method itself",
      "Adds about 2.4 KB to script.js (about 1 KB gzipped)",
      "Code lives in src/tracker/web3.ts"
    ],
    url: "https://gullylabs.xyz/analytics",
    source: [
      "gully-umami:docs/gully/README.md",
      "gully-umami:src/tracker/web3.ts",
      "gully-umami:src/tracker/index.ts"
    ]
  },
  {
    id: "analytics-privacy-modes",
    product: "Gully Analytics",
    name: "Wallet address privacy modes",
    status: "live",
    summary: "The site owner chooses how wallet addresses are stored: hashed, in full, or not at all.",
    facts: [
      "data-web3-address accepts hash (default), full or none",
      "hash stores the first 16 hex characters of the SHA-256 of the lowercase address",
      "On plain HTTP the address is dropped rather than sent in clear",
      "Telemetry and update checks to Umami's servers are turned off (DISABLE_TELEMETRY, DISABLE_UPDATES) in the Gully compose file"
    ],
    source: [
      "gully-umami:docs/gully/README.md",
      "gully-umami:docker-compose.gully.yml",
      "gully-umami:src/tracker/web3.ts"
    ]
  },
  {
    id: "analytics-web3-dashboard",
    product: "Gully Analytics",
    name: "Web3 dashboard",
    status: "live",
    summary: "A per-website Web3 page shows unique wallets, connect rate, transactions and a funnel.",
    facts: [
      "Shows unique wallets, connect rate, transactions, tx per wallet, a visit-connect-transaction funnel, chains, wallet apps and top pages by connects",
      "API: GET /api/websites/{websiteId}/web3",
      "Named chains: Ethereum 1, Optimism 10, BNB Chain 56, Polygon 137, HyperEVM 999, Robinhood Chain 4663, Arc 5042, Base 8453, Arbitrum 42161",
      "Runs on PostgreSQL only; ClickHouse answers 501 not-implemented"
    ],
    source: [
      "gully-umami:docs/gully/README.md",
      "gully-umami:src/lib/web3.ts",
      "gully-umami:src/queries/sql/web3/getWeb3Metrics.ts"
    ]
  },
  {
    id: "analytics-self-host",
    product: "Gully Analytics",
    name: "Self-hosting and fork licence",
    status: "live",
    summary: "A Docker Compose file runs the app with PostgreSQL. The fork is MIT licensed, like Umami.",
    facts: [
      "docker-compose.gully.yml defines app and db services; app binds 127.0.0.1:3000",
      "TRACKER_SCRIPT_NAME can rename the tracker script",
      "Healthcheck calls /api/heartbeat",
      "Fork of Umami (MIT, Umami Software, Inc.); Gully's changes are MIT too",
      "Gully Labs look: dark theme by default with a gold accent"
    ],
    url: "https://analytics.gullylabs.xyz",
    source: [
      "gully-umami:docker-compose.gully.yml",
      "gully-umami:docs/gully/README.md",
      "gully-umami:README.md"
    ]
  },
  {
    id: "chains-launch-ui",
    product: "Gully Chains",
    name: "Chain launch interface",
    status: "building",
    summary: "A rebranded Arbitrum Orbit deployment UI. It is not deployed and currently targets Arbitrum Sepolia only.",
    facts: [
      "Fork of OffchainLabs/arbitrum-orbit-deployment-ui on branch gully/brand; not deployed, not pushed per GULLY.md",
      "Parent chain is hard-wired to Arbitrum Sepolia (421614); there is no mainnet path",
      "Upstream repository has no licence file, so Gully Labs does not ship a modified version until that is clarified",
      "Deployment logic, contract addresses and parameter defaults are unchanged",
      "Wizard lets the user set chain parameters, then add batch posters or validators after deployment",
      "Fee and data-availability defaults (Rollup vs AnyTrust) are not yet chosen by Gully Labs; default chain name is 'My Arbitrum L3 Chain'"
    ],
    url: "https://gullylabs.xyz/chain-kit",
    source: [
      "gully-chains-launch:README.md",
      "gully-chains-launch:GULLY.md",
      "gully-chains-launch:package.json"
    ]
  },
  {
    id: "chains-bridge-ui",
    product: "Gully Chains",
    name: "Gully Bridge",
    status: "building",
    summary: "A fork of the Arbitrum token bridge for moving assets between a Gully chain and its parent chain. Only the README header is changed so far.",
    facts: [
      "Fork of OffchainLabs/arbitrum-token-bridge on branch gully/brand, used under Apache-2.0",
      "The only Gully commit on top of upstream is the README branding header",
      "Upstream test setup covers Orbit chains, a custom fee token and CCTP",
      "Not affiliated with or endorsed by Offchain Labs or the Arbitrum Foundation"
    ],
    url: "https://gullylabs.xyz/chain-kit",
    source: [
      "gully-bridge:README.md",
      "gully-bridge:package.json",
      "gully-bridge:LICENSE"
    ]
  },
  {
    id: "deepcore-launchpad",
    product: "DeepCore",
    name: "Launchpad",
    status: "live",
    summary: "A token, its pool and locked liquidity are created in one transaction, with a decaying anti-snipe fee at the open.",
    facts: [
      "LaunchpadKitV2 opens a launch on a concentrated-liquidity range or a shaped Bin distribution",
      "Liquidity is locked forever via DeepCoreLPLocker / DeepCoreBinLPLocker",
      "Anti-snipe fee: LaunchGuardHook caps the initial fee at 50% (MAX_INITIAL_FEE) and the final fee at 10%; README states 50% at the open, 10% on Bin, decaying over at least 60 seconds",
      "Optional creator tax is capped at 10% (MAX_TAX_BPS = 1000) and expires by itself, at most 180 days",
      "LaunchpadKitV2 is recorded in the SDK address book on Base, BNB Chain, HyperEVM and Robinhood Chain at the same address 0x78781DC6...",
      "Wizard is market-cap-first with a $3.5K-equivalent default per the README"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:README.md",
      "deepcore:packages/launchpad/src/LaunchpadKitV2.sol",
      "deepcore:packages/hooks/src/launch/LaunchGuardHook.sol",
      "deepcore:packages/hooks/src/launch/LaunchTaxModule.sol",
      "deepcore:packages/sdk/src/deployments/index.ts"
    ]
  },
  {
    id: "deepcore-hosted-pads",
    product: "DeepCore",
    name: "Hosted Launchpads and DEXes",
    status: "live",
    summary: "Anyone can open their own Launchpad or DEX on the core in one transaction, with a share of fees going to the site.",
    facts: [
      "DeepCorePadFactory clones a pad at the same address on every chain (0x7878647B... in the address book)",
      "Owner, name, brand and terms are stored on chain",
      "Hosted site can use a deepcore.fun subdomain or the owner's own domain, with a theme pack and its own fee share (README)",
      "Contracts: DeepCorePad, DeepCorePadFactory in packages/launchpad/src/pad"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:README.md",
      "deepcore:packages/launchpad/src/pad/DeepCorePadFactory.sol",
      "deepcore:packages/sdk/src/deployments/index.ts",
      "deepcore:docs/custom-domains.md"
    ]
  },
  {
    id: "deepcore-router",
    product: "DeepCore",
    name: "Best-price router",
    status: "live",
    summary: "Swaps route across DeepCore pools and other venues. DeepCore pools carry no router fee; fills on other venues pay a small capped fee.",
    facts: [
      "DeepCoreFillRouter charges feeBps() on fills elsewhere; README states 0.15%",
      "The fee is bounded in the contract by ABSOLUTE_MAX_FEE_BPS = 100 (1%)",
      "Fee changes use a notice period of up to MAX_FEE_NOTICE_SECONDS = 30 days",
      "fillRouter is 0x78786244... on all four chains in the SDK address book"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:README.md",
      "deepcore:packages/routing/src/DeepCoreFillRouter.sol",
      "deepcore:packages/sdk/src/deployments/index.ts"
    ]
  },
  {
    id: "deepcore-locks-airdrops-splits",
    product: "DeepCore",
    name: "Locks, vesting, airdrops, splits and multisend",
    status: "live",
    summary: "Utility contracts for locking liquidity or tokens, distributing tokens and splitting revenue.",
    facts: [
      "Contracts: DeepCorePositionLock, DeepCoreTokenLock, DeepCoreMerkleDrop with DeepCoreDropFactory, DeepCoreSplit with DeepCoreSplitFactory, DeepCoreMultisend",
      "positionLock, tokenLock, splitFactory and multisend are recorded at the same address on HyperEVM, BNB Chain, Robinhood Chain and Base",
      "Airdrops are Merkle-based"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:README.md",
      "deepcore:packages/launchpad/src/lock/DeepCoreTokenLock.sol",
      "deepcore:packages/launchpad/src/lock/DeepCorePositionLock.sol",
      "deepcore:packages/launchpad/src/drop/DeepCoreMerkleDrop.sol",
      "deepcore:packages/launchpad/src/drop/DeepCoreMultisend.sol",
      "deepcore:packages/launchpad/src/split/DeepCoreSplit.sol",
      "deepcore:packages/sdk/src/deployments/index.ts"
    ]
  },
  {
    id: "deepcore-limit-orders-dca",
    product: "DeepCore",
    name: "Limit orders and DCA",
    status: "live",
    summary: "On-chain range (limit) orders and dollar-cost averaging contracts, deployed on three of the four chains.",
    facts: [
      "Contracts: DeepCoreRangeOrders and DeepCoreDCA",
      "In the SDK address book rangeOrders and dca have addresses on HyperEVM, Robinhood Chain and Base, and are null on BNB Chain",
      "Also in the repo but not in the README feature list: DeepCoreManagedVault and DeepCoreVaultFactory (vaultFactory set on HyperEVM, Robinhood Chain and Base) and a liquidity-rewards hook"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:packages/orders/src/DeepCoreRangeOrders.sol",
      "deepcore:packages/orders/src/DeepCoreDCA.sol",
      "deepcore:packages/sdk/src/deployments/index.ts",
      "deepcore:packages/vaults/src/DeepCoreVaultFactory.sol"
    ]
  },
  {
    id: "deepcore-four-chains",
    product: "DeepCore",
    name: "Same addresses on four chains",
    status: "live",
    summary: "The core is deployed at the same contract addresses on HyperEVM, BNB Chain, Robinhood Chain and Base.",
    facts: [
      "Chain IDs in the SDK address book: 999, 56, 4663, 8453",
      "Address book is packages/sdk/src/deployments/index.ts; null means not deployed, never zero",
      "Contracts are owned by a 2-of-3 Safe multisig and renounceOwnership is disabled on DeepCore's own contracts (README)",
      "Built on the PancakeSwap Infinity architecture (GPL-2.0-or-later forks); SDK, widgets and tooling are MIT"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:README.md",
      "deepcore:packages/sdk/src/deployments/index.ts",
      "website:src/content/projects.ts"
    ]
  },
  {
    id: "deepcore-dev-tools",
    product: "DeepCore",
    name: "SDK, widgets and scaffolders",
    status: "beta",
    summary: "An MIT SDK, swap widgets and project scaffolders for builders. The README says npm publication is pending.",
    facts: [
      "Packages in the repo: sdk, widgets, connect, cli, create-deepcore-app, create-deepcore-hook, router-core, tokenlists",
      "npm scope @deepcoreprotocol; the README says publication is pending",
      "Dynamic-fee hooks exist for CL and Bin pools (DeepCoreDynamicFeeHook, DeepCoreBinDynamicFeeHook)"
    ],
    url: "https://deepcore.fun",
    source: [
      "deepcore:README.md",
      "deepcore:packages/sdk/src/deployments/index.ts",
      "deepcore:packages/hooks/src/dex/DeepCoreDynamicFeeHook.sol"
    ]
  },
  {
    id: "peddleswap-swap",
    product: "PeddleSwap",
    name: "Swap",
    status: "live",
    summary: "V2 and V3 liquidity behind one router, with an Auto mode that picks the better venue.",
    facts: [
      "Auto mode races V2 against all four V3 fee tiers (0.01%, 0.05%, 0.30%, 1.00%)",
      "Exact-input and exact-output swaps, multi-hop paths, native ETH on both sides, Permit2",
      "TokenValidator flash-borrows a pasted token to detect fee-on-transfer and honeypot behaviour, and separates 'tested clean' from 'could not be tested'",
      "Contracts deployed per deployments files on Robinhood Chain (4663), Arc (5042) and Base (8453), plus Sepolia",
      "The README still says 'live on Sepolia'; the repo's mainnet deployment files and projects.ts list Robinhood, Base and Arc"
    ],
    url: "https://peddleswap.xyz",
    source: [
      "peddleswap:README.md",
      "peddleswap:contracts/deployments/4663.json",
      "peddleswap:contracts/deployments/5042.json",
      "peddleswap:contracts/deployments/8453.json",
      "peddleswap:web/src/lib/contracts.ts"
    ]
  },
  {
    id: "peddleswap-dynamic-fee",
    product: "PeddleSwap",
    name: "Volatility-aware dynamic fee",
    status: "live",
    summary: "A V3 pool can attach a fee module that raises the swap fee as spot drifts from the pool's TWAP.",
    facts: [
      "Dynamic fee module address recorded in deployment files for 4663, 5042, 8453 and Sepolia",
      "README reports a Sepolia measurement of 11124 vs 3000 fee units on two otherwise identical 0.30% pools"
    ],
    url: "https://peddleswap.xyz",
    source: [
      "peddleswap:README.md",
      "peddleswap:contracts/deployments/4663.json",
      "peddleswap:contracts/deployments/8453.json"
    ]
  },
  {
    id: "peddleswap-locker",
    product: "PeddleSwap",
    name: "Token and LP locker",
    status: "live",
    summary: "Locks tokens, V2 LP and V3 positions with no admin unlock. Locked V3 positions keep earning fees.",
    facts: [
      "PeddleLockerERC20 for fungible tokens and V2 LP; PeddleLockerERC721 for V3/V4 positions and NFTs",
      "No admin unlock, no emergency withdraw, no upgrade path; unlock times can only be extended",
      "Locks are transferable and splittable; a split inherits the parent's unlock time",
      "Locker addresses recorded for 4663, 5042 and 8453"
    ],
    url: "https://peddleswap.xyz",
    source: [
      "peddleswap:README.md",
      "peddleswap:contracts/src/locker/PeddleLockerERC20.sol",
      "peddleswap:contracts/src/locker/PeddleLockerERC721.sol",
      "peddleswap:contracts/deployments/4663.json"
    ]
  },
  {
    id: "peddleswap-bridge",
    product: "PeddleSwap",
    name: "Bridge",
    status: "live",
    summary: "A bridge page that uses Relay's quote service to move native ETH and ERC-20s between chains.",
    facts: [
      "Uses Relay request-for-quote (web/src/app/api/relay/quote/route.ts)",
      "Page at web/src/app/bridge/page.tsx",
      "Destination resolved to the same asset on the far chain; changing asset is a swap"
    ],
    url: "https://peddleswap.xyz",
    source: [
      "peddleswap:README.md",
      "peddleswap:web/src/app/bridge/page.tsx",
      "peddleswap:web/src/app/api/relay/quote/route.ts"
    ]
  },
  {
    id: "peddleswap-limit-orders",
    product: "PeddleSwap",
    name: "Limit orders",
    status: "live",
    summary: "Escrowed limit orders filled by a keeper through V2 or V3 pools.",
    facts: [
      "PeddleLimitOrders: the maker escrows tokenIn and names a floor, a deadline and a tip in tokenOut",
      "The keeper takes exactly the tip and the maker keeps the surplus",
      "No owner and no pause; partial fills, native ETH and mixed V2/V3 routes are not built",
      "limitOrders address is present in the 4663, 5042 and 8453 deployment files"
    ],
    url: "https://peddleswap.xyz",
    source: [
      "peddleswap:README.md",
      "peddleswap:contracts/src/orders/PeddleLimitOrders.sol",
      "peddleswap:contracts/deployments/4663.json",
      "peddleswap:contracts/deployments/8453.json"
    ]
  },
  {
    id: "peddleswap-launchpad-creator-fees",
    product: "PeddleSwap",
    name: "Token launcher and creator fees",
    status: "live",
    summary: "An ownerless token factory with a fixed-supply token, and a fee router that pays a share of swaps back to the token's project.",
    facts: [
      "PeddleToken has no mint, owner, pause, blocklist or proxy (ADR 0006)",
      "PeddleTokenFactory deploys with CREATE2 under a caller-derived salt",
      "tokenFactory has a non-zero address on Robinhood Chain (4663) and Sepolia; it is the zero address in the Base (8453) and Arc (5042) files",
      "PeddleFeeRouter pays a creator share; registering one is an owner-only call"
    ],
    url: "https://peddleswap.xyz",
    source: [
      "peddleswap:README.md",
      "peddleswap:contracts/src/launchpad/PeddleToken.sol",
      "peddleswap:contracts/src/launchpad/PeddleTokenFactory.sol",
      "peddleswap:contracts/src/fees/PeddleFeeRouter.sol",
      "peddleswap:contracts/deployments/4663.json",
      "peddleswap:contracts/deployments/8453.json"
    ]
  },
  {
    id: "peddles-stock-launches",
    product: "Peddles",
    name: "Stock-paired token launches",
    status: "live",
    summary: "Launch a token whose pool is quoted in a tokenised stock. All supply goes to liquidity locked from block zero.",
    facts: [
      "Built on Uniswap v4 single-sided liquidity; the liquidity position is permanently locked and there is no bonding curve or migration",
      "Deployed default allocation is 100% liquidity; setAllocation refuses a non-zero burn leg",
      "Live on Base 8453, Robinhood Chain 4663, BNB Smart Chain 56 and Arc 5042 since 2026-10-01 per CLAUDE.md",
      "Launch fee is about $2 on every launch type, paid in the chain's native currency",
      "Starting market cap is about $3.5K on every launch type and chain",
      "Anti-sniper opening-tax window defaults to 3 minutes of wall-clock time on every chain; Arc stock pairs stay hidden until issuer tokens are verified"
    ],
    url: "https://peddles.xyz",
    source: [
      "peddles-launchpad:CLAUDE.md",
      "peddles-launchpad:README.md",
      "peddles-launchpad:contracts/src/PeddlesStockLaunchpad.sol",
      "peddles-launchpad:contracts/deployments/4663.json",
      "peddles-launchpad:contracts/deployments/56.json"
    ]
  },
  {
    id: "peddles-holder-rewards",
    product: "Peddles",
    name: "Holder rewards",
    status: "live",
    summary: "A distributor pays launched-token holders from the token's fee stream, notified on every transfer.",
    facts: [
      "PeddlesHolderRewards and PeddlesHolderRewardsFactory in contracts/src",
      "Launched tokens hold a write-once holderRewards address and send a notification after every transfer, mint and burn, with a fixed gas stipend",
      "The notification moves no value",
      "PeddlesNftHolderRewards does the same for NFT collection holders"
    ],
    url: "https://peddles.xyz",
    source: [
      "peddles-launchpad:contracts/src/PeddlesHolderRewards.sol",
      "peddles-launchpad:contracts/src/PeddlesHolderRewardsFactory.sol",
      "peddles-launchpad:contracts/src/PeddlesNftHolderRewards.sol"
    ]
  },
  {
    id: "peddles-launch-types",
    product: "Peddles",
    name: "Other launch types",
    status: "live",
    summary: "Beyond stock pairs: WETH-paired, Clog, handle and NFT launches.",
    facts: [
      "Clog: PeddlesClogVault sells a marketing allocation into the pool in capped slices and the creator pulls the proceeds",
      "Handle launches: PeddlesHandleLauncher launches a coin whose creator fees go to an X account's pot; deployment files exist for 8453, 4663, 5042, 56",
      "NFT launchpad: bonding-curve collections that graduate into tokens (PeddlesNFTFactory, graduation orchestrators)",
      "Solana launchpad and deploy-from-a-tweet are marked coming soon in CLAUDE.md"
    ],
    url: "https://peddles.xyz",
    source: [
      "peddles-launchpad:CLAUDE.md",
      "peddles-launchpad:contracts/src/PeddlesClogVault.sol",
      "peddles-launchpad:contracts/src/PeddlesHandleLauncher.sol",
      "peddles-launchpad:contracts/src/PeddlesNFTFactory.sol",
      "peddles-launchpad:contracts/deployments/handle-4663.json"
    ]
  },
  {
    id: "peddles-perps",
    product: "Peddles",
    name: "Perps",
    status: "live",
    summary: "Perpetual markets via a factory and hook, live on all four mainnets.",
    facts: [
      "Deployment files 4663-perp.json, 8453-perp.json, 56-perp.json and 5042-perp.json each have status 'live'",
      "Robinhood perp deployment dated 2026-09-30",
      "Contracts: PeddlesPerpFactory, PeddlesPerpHookDeployer, PeddlesPerpTreasury, PeddlesPerpHook"
    ],
    url: "https://peddles.xyz",
    source: [
      "peddles-launchpad:contracts/deployments/4663-perp.json",
      "peddles-launchpad:contracts/deployments/8453-perp.json",
      "peddles-launchpad:contracts/deployments/56-perp.json",
      "peddles-launchpad:contracts/deployments/5042-perp.json",
      "peddles-launchpad:contracts/src/perp/PeddlesPerpFactory.sol"
    ]
  },
  {
    id: "peddles-terminal-bot",
    product: "Peddles",
    name: "Terminal and Telegram trade bot",
    status: "live",
    summary: "A multi-chain token terminal at peddles.xyz/terminal and a Telegram trade bot that uses the same API.",
    facts: [
      "Terminal API chain slugs: ethereum, bsc, base, robinhood, arc, solana",
      "Terminal is served at peddles.xyz/terminal (CLAUDE.md domain table)",
      "Trade bot wallets are custodial: keys are created and held by the bot, encrypted with AES-256-GCM",
      "Prediction games are non-wagering; bots default to paper trading"
    ],
    url: "https://peddles.xyz",
    source: [
      "peddles-launchpad:docs/TERMINAL_API.md",
      "peddles-launchpad:docs/TRADE_BOT.md",
      "peddles-launchpad:CLAUDE.md",
      "peddles-launchpad:README.md"
    ]
  },
  {
    id: "peddles-arcade",
    product: "Peddles",
    name: "Arcade",
    status: "beta",
    summary: "A launchpad for browser games, with server-validated XP and leaderboards. Holders of a coin get ranked play on its game.",
    facts: [
      "Repo status says 'phase 2': creator platform with a 9-step game wizard, uploads and a build pipeline",
      "Game templates in the repo: endless-runner, racing, party-arena, arena-shooter, retro-fps, candle-runner, puzzle",
      "A coin's game is materialised on first open; a run is 'ranked' only if a verified wallet holds the coin",
      "Non-wagering: XP, points, badges and leaderboards only",
      "CLAUDE.md of peddles-launchpad places the Arcade app at peddles.xyz/arcade",
      "peddles-arcade-shooters is a near-copy of the same repo without the party-arena template"
    ],
    url: "https://peddles.xyz/arcade",
    source: [
      "peddles-arcade:README.md",
      "peddles-arcade:CLAUDE.md",
      "peddles-arcade:docs/architecture.md",
      "peddles-launchpad:CLAUDE.md"
    ]
  },
  {
    id: "peddlequest-escrow",
    product: "PeddleQuest",
    name: "Quest reward escrow",
    status: "live",
    summary: "Quest reward pools are escrowed on chain first and paid out by Merkle proof.",
    facts: [
      "PeddlesQuestEscrow holds reward pools; creator deposits gross and the fee is taken once at deposit, never from participants",
      "Participants claim by Merkle proof; the operator publishes the root",
      "Same contract addresses on Base 8453, Robinhood Chain 4663, BSC 56 and Arc 5042 per docs/monetization.md (escrow 0x16267bE6...)",
      "Contracts are described as unaudited; the repo says never to claim an audit",
      "Starting fee model: quest creation free, deposit fee 3% (permanent cap 10%), per-quest pool cap $100,000"
    ],
    url: "https://peddlequest.xyz",
    source: [
      "peddles-quest:contracts/src/PeddlesQuestEscrow.sol",
      "peddles-quest:docs/monetization.md",
      "peddles-quest:CLAUDE.md"
    ]
  },
  {
    id: "peddlequest-badges",
    product: "PeddleQuest",
    name: "Soulbound badges",
    status: "live",
    summary: "An optional non-transferable proof-of-completion badge minted after a quest.",
    facts: [
      "PeddlesQuestBadge is soulbound; transfers revert with a Soulbound error",
      "Badge mint fee starts at $0.30 with a $10 permanent cap",
      "PeddlesQuestBadge address 0x6DA219d4... is the same on all four chains per docs/monetization.md"
    ],
    url: "https://peddlequest.xyz",
    source: [
      "peddles-quest:contracts/src/PeddlesQuestBadge.sol",
      "peddles-quest:docs/monetization.md",
      "peddles-quest:docs/badges.md"
    ]
  },
  {
    id: "peddlequest-promotion",
    product: "PeddleQuest",
    name: "Promotion slots",
    status: "live",
    summary: "Trending and banner placement is sold on chain, so what was bought is publicly recorded.",
    facts: [
      "PeddlesPromotionMarket sells time-boxed trending slots and banners for native currency, flat rate per day",
      "Starting rate is $3 per day with a $500 per day cap",
      "Proceeds go to the treasury"
    ],
    url: "https://peddlequest.xyz",
    source: [
      "peddles-quest:contracts/src/PeddlesPromotionMarket.sol",
      "peddles-quest:CLAUDE.md",
      "peddles-quest:docs/monetization.md"
    ]
  },
  {
    id: "peddlequest-verification-sybil",
    product: "PeddleQuest",
    name: "Task verification and eligibility rules",
    status: "live",
    summary: "Off-chain checks for X, Discord and wallet tasks, with eligibility and sybil rules set in the quest wizard.",
    facts: [
      "Docs cover X verification, Discord verification and general verification",
      "Quest wizard has an Eligibility step (src/modules/quest/pq-wizard/steps/EligibilityStep.tsx) that references sybil rules",
      "Frontend routes include quest, leaderboard, loyalty, referral-invite and profile",
      "Production builds carry the four mainnets only (testnets disabled)"
    ],
    url: "https://peddlequest.xyz",
    source: [
      "peddles-quest:docs/verification.md",
      "peddles-quest:docs/x-verification.md",
      "peddles-quest:docs/discord-verification.md",
      "peddles-quest:src/modules/quest/pq-wizard/steps/EligibilityStep.tsx",
      "peddles-quest:CLAUDE.md"
    ]
  },
  {
    id: "cartel-social-trading",
    product: "Cartel Family",
    name: "Social feed and copy trading",
    status: "live",
    summary: "A wallet-native social trading app with a public feed, follows and copy-trade tracking.",
    facts: [
      "Public feed with posts, trades and token calls; follows, reactions, replies and direct messages (README)",
      "Copy-trade tracking and trader profiles with win rate and PnL (README)",
      "Domain cartel.family is defined in site_config.py per CLAUDE.md",
      "Python/Flask backend with SQLite, deployed from a Dockerfile (README says Railway)"
    ],
    url: "https://cartel.family/",
    source: [
      "Cartel-Family:README.md",
      "Cartel-Family:CLAUDE.md",
      "Cartel-Family:app_entry.py"
    ]
  },
  {
    id: "cartel-multichain-bot",
    product: "Cartel Family",
    name: "Multi-chain automated trading bot",
    status: "live",
    summary: "An AI-scored bot trades on a user's behalf with configurable limits.",
    facts: [
      "Chains: Solana plus five EVM chains (BNB Chain, Base, Arbitrum, Polygon, Robinhood Chain)",
      "Solana swaps use Jupiter; EVM swaps use the 0x API",
      "Bot scores tokens every 30 seconds; user sets take-profit, stop-loss, trade size and a daily loss limit",
      "Performance fee on profitable trades only (README); CLAUDE.md records a 0.80% per-leg revenue rate set on 2026-10-10",
      "Private keys are encrypted (Fernet with a wallet-derived HMAC)"
    ],
    url: "https://cartel.family/",
    source: [
      "Cartel-Family:README.md",
      "Cartel-Family:CLAUDE.md",
      "Cartel-Family:multichain_auto_bot.py",
      "Cartel-Family:bot_core.py"
    ]
  },
  {
    id: "cartel-live-market-wallet",
    product: "Cartel Family",
    name: "Live market and one-send wallet",
    status: "live",
    summary: "Live market discovery with a launches tab, plus a single send path across all chains.",
    facts: [
      "Live Market page with Trending, New Pairs and Gainers; a Launches tab (New / Hot / Near graduation) is described in CLAUDE.md",
      "wallet_send.send_funds is the only way money leaves a wallet: native coin or USDC on Solana and all five EVM chains, behind POST /api/send",
      "One EVM address works across the five EVM chains",
      "Gas sponsorship for empty EVM wallets is optional via GAS_SPONSOR_PRIVATE_KEY"
    ],
    url: "https://cartel.family/",
    source: [
      "Cartel-Family:CLAUDE.md",
      "Cartel-Family:README.md",
      "Cartel-Family:market_sources.py",
      "Cartel-Family:evm_wallet_parity.py"
    ]
  },
]
