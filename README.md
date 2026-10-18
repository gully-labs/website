<!-- gully-header:start -->
<a href="https://gullylabs.xyz"><img src="https://gullylabs.xyz/social/og-home.png" alt="Gully Labs" width="100%"></a>

<p align="center">
  <a href="https://gullylabs.xyz"><img src="https://img.shields.io/badge/gullylabs.xyz-E8C060?style=for-the-badge&labelColor=0B0E13&logo=googlechrome&logoColor=E8C060" alt="Website"></a>
  <a href="https://x.com/Gully_Labs"><img src="https://img.shields.io/badge/@Gully__Labs-0B0E13?style=for-the-badge&labelColor=0B0E13&logo=x&logoColor=white" alt="X"></a>
  <a href="https://t.me/GullyLabsNews"><img src="https://img.shields.io/badge/Telegram-0B0E13?style=for-the-badge&labelColor=0B0E13&logo=telegram&logoColor=26A5E4" alt="Telegram"></a>
  <a href="https://docs.gullylabs.xyz"><img src="https://img.shields.io/badge/Docs-0B0E13?style=for-the-badge&labelColor=0B0E13&logo=readthedocs&logoColor=E8C060" alt="Docs"></a>
  <a href="https://blog.gullylabs.xyz"><img src="https://img.shields.io/badge/Blog-0B0E13?style=for-the-badge&labelColor=0B0E13&logo=ghost&logoColor=E8C060" alt="Blog"></a>
  <a href="https://github.com/gully-labs"><img src="https://img.shields.io/badge/GitHub-0B0E13?style=for-the-badge&labelColor=0B0E13&logo=github&logoColor=white" alt="GitHub"></a>
</p>

<p align="center"><b>The source of gullylabs.xyz: the ledger, the stock token tracker, the docs and the app dashboard.</b></p>

<p align="center"><sub>Part of <a href="https://gullylabs.xyz">Gully Labs</a>, a blockchain development company that builds, launches and runs its own Web3 projects.</sub></p>

---
<!-- gully-header:end -->
# Gully Labs website

## What this is

The source of [gullylabs.xyz](https://gullylabs.xyz) and the sites that share its code:

| Host | What it serves |
|---|---|
| [gullylabs.xyz](https://gullylabs.xyz) | The ledger: volume, value locked and fees across every Gully Labs project, read live from each project's own API |
| [gullylabs.xyz/tracker](https://gullylabs.xyz/tracker) | The stock token tracker: every tokenised stock on Robinhood Chain and BNB Chain against its Chainlink fair price |
| [docs.gullylabs.xyz](https://docs.gullylabs.xyz) | Methodology, API reference, widget guide, SDK, plans and alerts |
| [app.gullylabs.xyz](https://app.gullylabs.xyz) | The Gully Labs App (app dashboard): sign in with a wallet; API keys, usage, alerts, analytics, payments, and every service (tracker, Gully Pay, Chain Kit, Gully AI, DeepCore launches, widgets, Telegram) |
| [gullylabs.xyz/widget](https://gullylabs.xyz/widget) | The embeddable widget and its builder |

One React bundle renders the right app for each host. A dependency-free Node server (`server/`) serves it, answers the public API (`/api/tracker`, `/api/stats`, `/api/plans`) and forwards the blog and analytics hosts to their own containers.

## Stack

React 19 · Vite · TypeScript · Tailwind CSS v4 · React Router · ECharts · wagmi + RainbowKit (app dashboard only) · Node (no runtime dependencies) · Docker Compose.

## Run it locally

```bash
npm ci
npm run dev               # the site, with the API served by a Vite middleware
npm run build             # type-check and build to dist/
node server/server.mjs    # serve dist/ and the API as production does (PORT, default 8080)
```

## Related

- [gully-labs/sdk](https://github.com/gully-labs/sdk): `@gullylabs/tracker` and `@gullylabs/widget`
- [gully-labs/umami](https://github.com/gully-labs/umami/tree/gully/analytics): Gully Analytics
- [gully-labs/blockscout](https://github.com/gully-labs/blockscout/tree/gully/chain-kit): Chain Kit

Information on these sites is not investment advice.