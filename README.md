<!-- gully-header:start -->
<a href="https://gullylabs.xyz"><img src="https://gullylabs.xyz/social/og-home.png" alt="Gully Labs" width="100%"></a>

<p align="center">
  <a href="https://gullylabs.xyz"><img src="https://img.shields.io/badge/gullylabs.xyz-D9B563?style=for-the-badge&labelColor=0D141C&logo=googlechrome&logoColor=D9B563" alt="Website"></a>
  <a href="https://x.com/Gully_Labs"><img src="https://img.shields.io/badge/@Gully__Labs-0D141C?style=for-the-badge&labelColor=0D141C&logo=x&logoColor=white" alt="X"></a>
  <a href="https://t.me/GullyLabsNews"><img src="https://img.shields.io/badge/Telegram-0D141C?style=for-the-badge&labelColor=0D141C&logo=telegram&logoColor=26A5E4" alt="Telegram"></a>
  <a href="https://docs.gullylabs.xyz"><img src="https://img.shields.io/badge/Docs-0D141C?style=for-the-badge&labelColor=0D141C&logo=readthedocs&logoColor=D9B563" alt="Docs"></a>
  <a href="https://blog.gullylabs.xyz"><img src="https://img.shields.io/badge/Blog-0D141C?style=for-the-badge&labelColor=0D141C&logo=ghost&logoColor=D9B563" alt="Blog"></a>
  <a href="https://github.com/gully-labs"><img src="https://img.shields.io/badge/GitHub-0D141C?style=for-the-badge&labelColor=0D141C&logo=github&logoColor=white" alt="GitHub"></a>
</p>

<p align="center"><b>The source of gullylabs.xyz: the ledger, the stock token tracker, the docs and the app dashboard.</b></p>

<p align="center"><sub>Part of <a href="https://gullylabs.xyz">Gully Labs</a>, a blockchain development company that builds, launches and runs its own Web3 projects.</sub></p>

---
<!-- gully-header:end -->
# Gully Labs website

## What this is

The source of [gullylabs.xyz](https://gullylabs.xyz) and the sites that share its code. One React bundle renders the right app for each host, and a dependency-free Node server serves it and answers the API.

| Host | What it serves |
|---|---|
| [gullylabs.xyz](https://gullylabs.xyz) | The home ledger (live figures from each project's own API), the stock tracker, Holder Map, Gully Security, Gully Score, Gully AI, Gully Analytics, the Gully Chains waitlist, widget, pricing and status pages |
| [docs.gullylabs.xyz](https://docs.gullylabs.xyz) | The docs host: methodology, API reference, products, SDK, plans, roadmap and changelog |
| [app.gullylabs.xyz](https://app.gullylabs.xyz) | The app host: sign in with a wallet; API keys, usage, alerts, analytics, payments, security and every other service |
| blog and analytics hosts | Self-hosted Ghost and Umami containers; the server forwards these hosts to them |

## Products

Status follows `src/content/features.ts`, the single source of truth (also published at [gullylabs.xyz/llms.txt](https://gullylabs.xyz/llms.txt)).

| Product | Status |
|---|---|
| Stock tracker (Robinhood Chain, BNB Chain, Solana), API, alerts, widget | Live |
| Holder Map, Launch Health score, Deep check, badges | Live |
| Gully Security (AI scan, monitors, reports, security review) | Live |
| Gully Score | Live |
| Gully Pay (invoices, pay links, merchant checkout, Solana Pay) | Live |
| Gully AI | Live |
| Telegram bot (@GullyLabsBot) and Mini App | Live |
| Gully Analytics (Umami fork) | Live |
| SDK (`@gullylabs/tracker`, `@gullylabs/widget`, `@gullylabs/holders`) | Beta |
| Gully Chains | Waitlist; no chain is running yet |
| Chain Kit | Waitlist; explorer licence being finalised |

## Architecture

```
src/                 React 19 + Vite front end, one bundle for every host
  main.tsx, router.tsx, site-host.ts   pick the app for the current host
  pages/             gullylabs.xyz pages
  docs/              the docs host (pages/, nav.ts, routes.tsx)
  components/ hooks/ lib/ content/      shared UI, helpers and features.ts
server/              Node ESM, no runtime dependencies
  server.mjs         entry point: static files, routing and the API
  hosts.mjs          app host name
  tracker.mjs, solana-tracker.mjs, movers.mjs   stock token gaps and history
  holders*.mjs       Holder Map, deep check, launchpad partners
  security*.mjs, security/   scan engine, monitors, reports
  payments.mjs, paylinks.mjs, invoices.mjs, solana-pay.mjs   Gully Pay
  telegram*.mjs      bot, Mini App, inline mode and broadcasts
  ask*.mjs           Gully AI
  access.mjs, plans.mjs, siwe.mjs, billing.mjs   keys, limits and wallet sign-in
  stats.mjs, status.mjs, deepcore.mjs, ecosystem.mjs   ledger and status
  data/              token lists and static data
scripts/             build, test, brand and e2e scripts
ghost/, ops/         blog theme and operations
compose.yaml         web, blog, analytics and their databases and backups
```

The server answers the public API (`/api/tracker`, `/api/stats`, `/api/plans`, `/api/status`) and the signed-in app API.

## Stack

React 19 · Vite · TypeScript · Tailwind CSS v4 · React Router · ECharts · wagmi + RainbowKit (app host only) · Node (no runtime dependencies) · Docker Compose.

## Run it locally

```bash
npm ci
npm run dev               # the site, with the API served by a Vite middleware
npm run build             # type-check and build to dist/
node server/server.mjs    # serve dist/ and the API as production does (PORT, default 8080)
npm run test:features     # check features.ts against the code
```

## Related

- [gully-labs/sdk](https://github.com/gully-labs/sdk): `@gullylabs/tracker`, `@gullylabs/widget` and `@gullylabs/holders`
- [gully-labs/umami](https://github.com/gully-labs/umami/tree/gully/analytics): Gully Analytics
- Contact: [team@gullylabs.xyz](mailto:team@gullylabs.xyz)

Information on these sites is not investment advice.
