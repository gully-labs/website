<!-- gully-header:start -->
<p align="center">
  <a href="https://gullylabs.xyz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/gully-labs-logo.png">
      <img alt="Gully Labs" src=".github/assets/gully-labs-logo-on-light.png" width="300">
    </picture>
  </a>
</p>

<p align="center"><b>You Think It, We Ship It.</b></p>

<p align="center">The source of gullylabs.xyz: the hub for every Gully product, the docs and the app.</p>

<p align="center">
  <a href="https://gullylabs.xyz"><img src="https://img.shields.io/badge/gullylabs.xyz-00D2FF?style=for-the-badge&labelColor=06050D&logo=googlechrome&logoColor=06050D" alt="Website"></a>
  <a href="https://docs.gullylabs.xyz"><img src="https://img.shields.io/badge/Docs-0B0A16?style=for-the-badge&labelColor=06050D&logo=readthedocs&logoColor=00D2FF" alt="Docs"></a>
  <a href="https://discord.com/invite/tY2ErsNNBp"><img src="https://img.shields.io/badge/Discord-0B0A16?style=for-the-badge&labelColor=06050D&logo=discord&logoColor=5865F2" alt="Discord"></a>
  <a href="https://x.com/Gully_Labs"><img src="https://img.shields.io/badge/@Gully__Labs-0B0A16?style=for-the-badge&labelColor=06050D&logo=x&logoColor=white" alt="X"></a>
</p>

<p align="center"><sub>Built and run by <a href="https://gullylabs.xyz">Gully Labs</a>. You Think It, We Ship It.</sub></p>

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
  stats.mjs, status.mjs, ecosystem.mjs   ledger and status
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


<!-- gully-footer:start -->
---

<p align="center">
  <a href="https://gullylabs.xyz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/powered-by-gully-labs-dark-2x.png">
      <img alt="Powered by Gully Labs" src=".github/assets/powered-by-gully-labs-light-2x.png" width="254" height="64">
    </picture>
  </a>
</p>
<!-- gully-footer:end -->
