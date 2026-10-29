# Token logos: adoption plan

The logo service is in place on branch `feat/token-logos`. No page uses it yet: the pages below belong to
branches that are open right now (B, D, the Holder Map motion branch). This file lists every place a token
is drawn today and how each one should switch. Line numbers are from `feat/status-docs-seo-analytics` at
a9c2016.

## What exists

- **Server:** `server/token-logos.mjs`
  - `GET /api/logo/:chain/:address(.png)?s=64|128|256` returns a PNG. It is public and CORS `*`, cached
    for a day, with an ETag. If no logo is found it returns the kit's neutral token glyph.
  - `resolveTokenLogo(chain, address, { symbol })` returns `{ source, sizes: { 64, 128, 256 } }`, each size
    as PNG bytes, for server-side images (OG cards, Telegram).
  - `logoCoverage()` returns resolved and fallback counts per chain and per source, for admin and `/status`.
- **Front end:** `<TokenLogo symbol chain address size />` in `src/components/logos/TokenLogo.tsx`.
  - Without `chain`/`address` it behaves exactly as before: the bundled ETH, BNB, USDC, USDT, SOL, POL or
    AVAX mark, chosen by symbol. Existing callers keep working unchanged.
  - With `chain` and `address` it shows a lazy `<img>` from `/api/logo` (1x/2x srcset), masked round with
    a slate hairline ring and alt text `"{symbol} logo"`. It carries `data-logo="token"` and has a fixed size.
  - If the request fails it shows the same neutral glyph. It never shows a letter tile.
  - Sizes: 10, 12, 14, 16, 20, 24, 32, 40, 48, 64. Use 16 or more for the service; 10 to 14 are for badges.
- **Chain keys:** robinhood, bsc, base, hyperevm, solana, ethereum, arbitrum, optimism, polygon, avalanche.
  The service also accepts the aliases bnb, eth, avax, matic and op. Solana mints are case-sensitive: pass
  them as they are and never lowercase them.

## Rules for switching

1. **Stock tokens (tracker):** keep `StockLogo` while the company mark is the better picture.
   - Robinhood's tokens all carry the same feather logo, and the bsc bStocks logos come from the issuer.
     For these, `logoByToken` / `logoByTicker` stay first.
   - Use `/api/logo` only where `StockLogo` falls back to its Building2 glyph.
   - This mainly fixes **28 of the 49 Solana xStocks**, which have no logo today: HOOD, GLD, AVGO, MCD,
     STRC, BRK.B, TQQQ, DFDV, VIDA, KO, PEP, XOM, NFLX, UNH, LLY, BMNR, NVO, WMT, CVX, AZN, IBM, PG, SKHY, JPM,
     PFE, ABT, VTI and UBER.
   - The service's `xstocks` source returns Backed's official xStocks logo for every tracked ticker.
   - **Change:** in `StockLogo.tsx:19`, when `src` is missing, render
     `<TokenLogo chain={row.chain} address={row.token} symbol={row.ticker} size={…} />` in place of the
     glyph.
   - **Fix with it:** `StockLogo.tsx:19` lowercases `row.token`, which breaks Solana mints. Lowercase only
     EVM addresses.
2. **Everything else that has a chain and an address:** use `<TokenLogo chain address symbol size />`.
3. **Server-rendered images:** use `resolveTokenLogo(...).sizes[128]`, embedded as
   `<image href="data:image/png;base64,…">` with a round clipPath and a 1 px `#2a3542` ring.
4. **Telegram:** `sendPhoto` needs a URL Telegram can fetch, so pass
   `https://gullylabs.xyz/api/logo/<chain>/<address>.png?s=256`. The logo service never exposes upstream URLs.
5. **Tests:** e2e can select `[data-logo="token"]`. Keep the 11 px minimum for any text next to a logo.

## Inventory

### 1. Tracker table and tracker components (owner: tracker / branch B)

| Where | Today | Fallback today | Switch |
|---|---|---|---|
| `src/components/tracker/TrackerTable.tsx:149` (row, 30) and `:218` (mobile card, 32) | `StockLogo` (stockLogos.ts by token, then by ticker) | lucide Building2 disc | Rule 1. `r.chain`, `r.token` |
| `src/pages/Tracker.tsx:200` (selected panel, 44) | `StockLogo` | Building2 | Rule 1. `sel.chain`, `sel.token` |
| `src/components/tracker/GapBars.tsx:153` (16) | `StockLogo` | Building2 | Rule 1 |
| `src/components/tracker/TopMovers.tsx:100` (30) | `StockLogo` | Building2 | Rule 1. `m.chain`, `m.token` |
| `src/components/tracker/StockSearch.tsx:44` (26) | `StockLogo` | Building2 | Rule 1. 26 is not a LogoSize: use 24 |
| `src/pages/developers/services/TrackerView.tsx:160` (app) | `StockLogo` | Building2 | Rule 1 |
| `src/components/demos/TrackerDemo.tsx:211`, `:228` header | `StockLogo` / ticker text | Building2 / none | Rule 1; add a 24 px logo in the header |
| `src/components/demos/WidgetDemo.tsx:64,121,174` | `StockLogo` | Building2 | Rule 1 |
| `GapHeatmap.tsx:62,86`, `MoreCharts.tsx:103`, `LiveTopGaps.tsx` | ECharts text labels | none | Leave: chart labels. An ECharts rich-text image could use `/api/logo/...?s=64` later |
| `src/pages/developers/Alerts.tsx:195` (`<option>`), `services/MarketBand.tsx:130` | text | none | Leave (native select / chart) |

### 2. Stock pages (owner: tracker / branch B)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/pages/StockPage.tsx:127` hero (72) | `StockLogo` | Building2 | Rule 1 at 64 (or keep 72 and use `?s=256`) |
| `src/pages/StockPage.tsx:262` sibling chips (22) | `StockLogo` | Building2 | Rule 1 at 20 or 24 |
| `src/pages/StockPage.tsx:226` "elsewhere" links | ChainLogo 16 + ticker, no token logo | none | Add `TokenLogo` 16 per chain (`chain`, that chain's `token`) |

### 3. MoversRow (owner: tracker / branch B)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/components/tracker/MoversRow.tsx:45` (22) | `StockLogo`, no badge | Building2 | Rule 1 (`m.chain`, `m.token`) at 20 or 24 |

### 4. Swap (owner: swap / branch B)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/components/swap/SwapWidget.tsx:49-69` (LiFi) | LiFi's own token list | LiFi's letter avatar for stock tokens | Pass `tokens.include: [{ chainId, address: row.token, symbol, decimals, name, logoURI: 'https://gullylabs.xyz/api/logo/<chain>/<token>.png?s=128' }]` |
| `src/components/swap/JupiterSwap.tsx:107-140` USDC/SOL toggles and `{sym}` | text | none | `TokenLogo` 16 by symbol (USDC, SOL); the stock side gets `chain="solana" address={row.token}` |
| `src/components/swap/StockSwap.tsx` | text | none | As above |

### 5. Launch lists (owners: site and app, branch D; bot and Mini App, the Telegram branches)

The third-party launch feed these rows were planned for was retired on 2026-10-29 (DeepCore partnership ended); the rows below that still exist take a `TokenLogo` from their own chain and token.

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/components/holders/LaunchHolders.tsx:76` (site: ProjectDetail `:166`; app: Products `:395`, HoldersView `:37`) | symbol text | none | `TokenLogo` 20 with `l.chainKey`, `l.token` |
| `src/pages/HoldersLanding.tsx:343` feed row | ScoreRing, no token image | none | `TokenLogo` 24 next to the ring |
| `src/pages/HoldersLanding.tsx:378` top scanned, `:199` resolve matches | text | none | `TokenLogo` 20 with `x.chain`/`x.token`, `m.chain`/`m.token` |
| `src/pages/developers/services/MarketBand.tsx:166` | text | none | `TokenLogo` 16 |
| **Mini App** `src/pages/tg/screens.tsx:445-447` | **letter tile**: the first 3 letters of the symbol on a chain-colour disc | the letter tile | **Replace now that the service exists** (no letter tiles): `TokenLogo` 32 with `l.chainKey`, `l.token`. The Mini App is served by gully-web, so `/api/logo` is same-origin |
| Bot `server/telegram-ui.mjs:469` `launchBlock`, `:480` `launchesView`, `:497` `launchCardView` (sent by `telegram.mjs:617`) | text messages | none | Optional: the launch card as `sendPhoto` with photo `…/api/logo/<chainKey>/<token>.png?s=256` and the card as caption. Lists stay text |
| Launch alerts `server/alerts.mjs:369-381` → `telegram-ui.mjs:690-694` → `telegram.mjs:423-430` | text | none | Optional: for a single launch, `sendPhoto` as above. Keep text for batches |
| Channel auto-post `server/telegram-channel.mjs:657-659` `launchPost` → `buildAuto(type, vars, link, media=null)` (`:589`) | text post | none | **Best slot:** pass `media = { kind: 'photo', url: '<site>/api/logo/<chainKey>/<token>.png?s=256' }`. `sendContent` (`:353-384`) already sends it with `sendPhoto` |

### 6. Holder Map bubbles and lists (owner: Holder Map motion branch)

Bubbles are wallets, not tokens, so they keep their colours. The token appears in the header and the lists.

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/components/holders/HolderMap.tsx:591-605` header "Who holds {symbol}" | Mascot image, no token logo | none | `TokenLogo` 32 with `m.chain.key`, `m.token.address` before the title (the mascot stays kit art) |
| `HolderMap.tsx:1073-1075` the wallet's other launches | text | none | `TokenLogo` 16 with `o.chainKey`, `o.token` |
| `src/components/holders/parts.tsx:140` deployer history | text | none | `TokenLogo` 16 with `l.chainKey`, `l.token` |
| `src/components/holders/parts.tsx:170` cross-token chips | text | none | `TokenLogo` 16 with `t.chainKey`, `t.token` |
| `src/pages/HoldersPage.tsx:42` h1 | text | none | `TokenLogo` 32 with `chain`, `token` |
| `src/pages/EmbedHolders.tsx` | via HolderMap | none | Inherits. CORS and `Cross-Origin-Resource-Policy: cross-origin` are already set on `/api/logo` |
| `server/holders.mjs:755` token shape | `{address, symbol, name, decimals, supply, url}` | none | No change needed: the client builds the URL from chain + address |

### 7. Score pages (owner: gully-score)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/pages/score/ScorePage.tsx:104-106` h1 `name (symbol)` | text | none | `TokenLogo` 40 with `r.chainKey`, `r.address` |
| `src/pages/score/ScoreIndex.tsx:110-118` rows | text | none | `TokenLogo` 20 |
| `server/gully-score.mjs:533-553` `badgeSvg` | kit mark (`mark-64.png`), not the token | n/a | Leave: the badge is Gully's mark by design |

### 8. Security scan target headers (owner: sec-ui)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/pages/security/ReportPages.tsx:22-28` `Subject` (used at `:87`, `:151`) | ChainLogo + title | none | `TokenLogo` 24 with `r.input.chain`, `r.input.address`, and the ChainLogo as a 10 px badge. Contracts that are not tokens show the neutral glyph, which is acceptable; or show it only when the scan says ERC-20 |
| `src/pages/developers/security/ScanDetail.tsx:34-37` `TargetMark` (`:104`, `SecurityTab.tsx:81`) | ChainLogo only | none | Same |
| `src/pages/developers/security/Monitors.tsx:205-207` | text | none | `TokenLogo` 16 |
| `server/security/report.mjs:115-117` (HTML report) | Gully logo + target text | none | Optional: `<img src="/api/logo/<chain>/<address>.png?s=64">` beside the target |

### 9. Gully Pay asset picker and receipts (owner: pay / branch B)

`PayAsset` (`src/pages/developers/api.ts:74-88`) has `chainKey`, `symbol` and `address`, where `address` is
null for a native coin.

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/components/pay/AssetPicker.tsx:15-24` `AssetMark` (24) and `:53` buttons (20); used by `Checkout.tsx:415,457`, `QuotePay.tsx:179,198`, `merchant/parts.tsx:71` | `TokenLogo` by symbol | CircleDollarSign disc for unknown symbols | Pass `chain={a.chainKey} address={a.address ?? undefined}`. A native coin keeps the bundled mark; a token gets the service (USDC and USDT resolve via CoinGecko or Trust Wallet). Or keep symbol-only for the bundled set and add the address only for other assets |
| `src/pages/pay/Receipt.tsx:153` | text | none | `TokenLogo` 20, by the asset id resolved to an asset |
| `src/pages/pay/Checkout.tsx:170-177` paid state | text | none | `TokenLogo` 20 with `paidAsset` |
| `src/pages/developers/PortalReceipt.tsx:98,113,117` | ChainLogo / text | none | `TokenLogo` 20 |
| `src/pages/developers/merchant/LinksInvoices.tsx:306`, `Analytics.tsx:483`, `src/pages/pay/PayCharts.tsx:147` | text / ChainLogo | none | `TokenLogo` 16 where a row has one asset |
| Symbol-only today, with no address in the data: `services/PayView.tsx:88`, `Billing.tsx:366`, `PayFlow.tsx:43`, `merchant/Charts.tsx:174`, `docs/LiveCharts.tsx:322`, `demos/PayDemo.tsx:196` | `TokenLogo` by symbol | glyph | Leave as is (bundled marks). Add `chain`/`address` only if the data gains them |
| `server/invoices.mjs:237,279` | symbol / assetId only | n/a | No server image today |

### 10. Admin (owner: admin)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `src/pages/admin/AdminCharts.tsx:237` | `TokenLogo` by symbol (`l.name`) | glyph | Leave (no address in `admin-charts.mjs:86`) |
| `src/pages/admin/AdminPage.tsx:380` payments, `:658` accepted-asset checkboxes (`a.address` known), `:704` | text | none | `TokenLogo` 16 with `chainKey`/`address` at `:658` |
| `src/pages/admin/PayLinks.tsx:310,393`, `FeeProxyCard.tsx:34,80` | text | none | `TokenLogo` 16 |
| **New:** the Logos card | n/a | n/a | Show `logoCoverage()` (resolved vs fallback per chain and per source, cache size, paused upstreams). It needs a small admin API route in `server/admin.mjs`, owned by admin |

### 11. widget.js (owner: widget)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `public/widget.js:115-121` `logo(r, size, withChain)`; used at `:191` (20), `:262` (40), `:327` (26) | the API's `r.logo` / `r.chainLogo` | **letter tile** (`ticker.slice(0,4)`), and the same on img error (`:360-368`) | When `r.logo` is null, use `https://gullylabs.xyz/api/logo/${r.chain}/${r.token}.png?s=64` (or `s=128` for 40 px). On error, draw the neutral glyph as an inline SVG data URI (the same disc and icon as `fallbackSvg()` in `server/token-logos.mjs`), never letters |
| `public/widget.js:558-700` Gully Score widget | kit mark + name | n/a | Optional: a token logo from `data-chain` / `data-address` (`:662-663`) |
| Server: `server/tracker.mjs:587-606` `logosFor()` (rows' `logo` field) | absolute site URLs or null | null | Optional: return `https://gullylabs.xyz/api/logo/<chain>/<token>.png?s=128` instead of null. This fixes the Solana gap for every API client (documented at `src/docs/pages/ApiReference.tsx:139-140`) |

### 12. OG cards (owners: holders / seo)

| Where | Today | Fallback | Switch |
|---|---|---|---|
| `server/holders-card.mjs:158-170` Holder Map card | symbol title, kit wordmark, mascot `<image>` at `:160` | n/a | Add `resolveTokenLogo(map.chain.key, map.token.address).sizes[128]` as a round `<image>` beside the title. Keep the mascot |
| `server/holders-card.mjs:197-242` status card (mascot `:236`, title `:242`) | same | n/a | Same |
| `scripts/gen-og.mjs:22-25,139-158` tracker OG (build time, robinhood + bsc only) | `/tokens/logos/<T>.*` | n/a | **Gap:** `server/seo.mjs:53-61,203` points `/tracker/solana/<T>` at `/social/og-tracker/solana/<T>.png`, which does not exist. Either generate them at build time from `resolveTokenLogo('solana', mint)`, or render them at request time like the Holder Map card |
| `server/og.mjs` | blog only | n/a | Not applicable |
| Score and security OG (`seo.mjs:194,198`) | static `og-score.png` / `og-security.png` | n/a | Optional per-token card later |

### 13. Telegram cards (owner: telegram branches)

All of these are text today. `sendPhoto` with a 256 px logo is worth it where one token is the subject.

| Card | Built at | Sent by | Suggested |
|---|---|---|---|
| Stock card | `server/telegram-ui.mjs:327` `cardView` ← `telegram.mjs:602-614` | `show()` `telegram.mjs:250-257` (`editMessageText`) | Keep text: menus edit in place and a photo would need `editMessageMedia`. Alternatively use `link_preview_options` with `url` set to the logo and `show_above_text` |
| Launch card | `telegram-ui.mjs:497` | same | Same as the stock card |
| Gap, holders and launch alert deliveries | `telegram-ui.mjs:673-712` | `telegram.mjs:428` `sendAlertTelegram` | Single event: `sendPhoto` (logo of `e.chain`/`e.token`, where a gap event uses its tracked stock's token) with the text as caption (1,024 character limit; fall back to text when longer) |
| Channel launch auto-post | `telegram-channel.mjs:657` | `sendContent` (`sendPhoto` exists) | Pass `media` (see area 5) |
| Daily gaps / weekly movers posts | `telegram-channel.mjs:660-688` | text lists | Leave |
| Bot banner | `telegram.mjs:524-531` | `sendAnimation` | Kit art, not a token: leave |

## Notes for the owners of admin and /status

- `logoCoverage()` from `server/token-logos.mjs` returns:
  `{ resolved, fallback, chains: { <chain>: { resolved, fallback, sources } }, sources, cache: { entries, bytes, maxEntries, maxBytes }, upstreams: { <source>: { pausedUntil } }, since: { resolvedThisProcess, missesThisProcess, rejected, sourceErrors } }`.
  It never contains upstream URLs.
- `/status` could show "Token logos: N resolved, M fallback" and flag an upstream whose `pausedUntil` is
  set.
- In dev, Vite has no `/api/logo` middleware (vite.config.ts is not touched on this branch), so the
  component shows its glyph in `npm run dev` unless the dev server proxies to `node server/server.mjs`.
