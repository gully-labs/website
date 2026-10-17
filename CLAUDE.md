# Gully Labs website

Marketing site for Gully Labs, a blockchain development company that builds and releases its own Web3 projects and takes on partner work.

## Source of truth for design
The design kit lives at `C:\Users\Admin\Downloads\Gully Labs landing directions (1)\gully-labs-kit\`. It is the spec; do not redesign it.
- `README.md`: every screen, measurement, colour, copy string, interaction and validation rule.
- `BRAND.md`: tokens, typography, motion.
- `screenshots/`: visual targets (desktop 1440px, mobile 390px).
- `design-files/Gully Labs Portfolio Wall.dc.html`: prototype source. Its inline styles are the exact values when the README is ambiguous.

Pages: Home, Project detail (x4), Services, About, plus a global contact modal. Do not add sections, stats, testimonials, pricing, icons or copy that aren't in the kit. Exception (requested by the user): nav menus (header, mobile menu, footer) have lucide-react icons plus brand icons for socials.

## Paid API tiers (owner-approved, 2026-10-16; an exception to "no pricing" above)
- Limits and prices live ONLY in `server/plans.mjs` (owner-editable); pages read `GET /api/plans`. Enforced in `access.mjs` (rate), `alerts.mjs` (alert count) and the history endpoint (`?days=`).
- Checkout (Gully Pay, 2026-10-16): prices in USD, paid in ETH, BNB, USDC or USDT on Base, Ethereum, BNB Chain or Arbitrum straight to `GULLY_TREASURY_ADDRESS` (env; the same EVM address on every chain). Unset = checkout off and every page says so; never a fallback address. Chains, assets, Chainlink feeds and default public RPCs live in `server/payments.mjs` (every address checked on chain; never add one unchecked); `GULLY_RPC_<chainId>` overrides RPCs (`GULLY_BASE_RPC` still works). Quotes (20 min, unique tag; coins priced by the same-chain Chainlink USD feed, refused when older than 2 h) and verification (receipt + tx agree, right chain, treasury paid in the quoted asset, signed-in wallet >= price or exact quoted amount, mined within the quote, unused `chainId:hash`, confirmations Ethereum 6 / Base 10 / Arbitrum 10 / BNB 15) in `server/billing.mjs`. General invoices (admin create/cancel, public `/pay/<id>` + `/pay/<id>/receipt`, exact amount only) in `server/invoices.mjs`. UI in `src/components/pay/`. Data: `DATA_DIR/billing.json` (`payments`, `quotes`, `invoices`; old USDC-only records migrate on load), plan on the account in `developers.json`.
- Gap alerts: `server/alerts.mjs`, evaluated on each tracker snapshot (`onSnapshot`). Webhooks https + public IPs only (SSRF guard); Telegram only with `TELEGRAM_BOT_TOKEN`. Data: `DATA_DIR/alerts.json`.
- Long history: `DATA_DIR/history/YYYY-MM-DD/<chain>-<TICKER>.ndjson`, pruned at 365 days.
- Test: `npm run test:paid` (in-process server on port 8791, stub RPC, no upstream calls) and `npm run test:pay` (port 8792, a stub RPC per chain: native and token payments, stale feed, wrong chain, reuse, expiry, invoices). `TEST_PORT` overrides either port.

## Stack
- React + Vite + TypeScript, run with `npm run dev`.
- React Router for `/`, `/projects/:slug`, `/services`, `/about`.
- Tailwind CSS v4. Colours, radii and fonts come from the BRAND.md tokens in `src/index.css`; no colours outside that set.
- Framer Motion (`motion` package) for modal, menu and page transitions. Looping brand animations (float, spin, glow, shimmer, blink, sweep) are CSS keyframes matching the prototype.
- Charts are hand-written SVG to match the prototype exactly (not Recharts).
- Fonts via @fontsource: Barlow Condensed 700/800, Hanken Grotesk 400/500/600, IBM Plex Mono 400/500.
- Content (projects, services, stats) is typed data in `src/content/`, so real numbers can be swapped in later.
- Contact form posts to `/api/contact` (Vercel function in `api/contact.ts`; mocked by a Vite plugin in dev).

## Quality bar
- Match the screenshots closely; check spacing and type against the prototype's inline values, not by eye.
- Responsive: nav collapses below 860px; grids use `repeat(auto-fit, minmax(min(100%, X), 1fr))`; 44px minimum tap targets.
- Accessibility: semantic landmarks, real buttons and links, focus trap + Esc in the modal, visible gold focus rings, alt text on logos.
- Respect `prefers-reduced-motion` (disable all animation).
- SEO: per-page titles and descriptions, og/twitter image `/social/og-image-1200x630.png`.
- Clean, reusable components; production build must pass `npm run build` with no type errors.

## NEVER TOUCH ANY CONTAINER BUT OURS — owner rule, 2026-10-16

> "DONT EVER TUCH NO CONTAINER OTHER THEN YOURS"

On the shared box (`40.160.136.124`) the ONLY containers Claude may act on are this site's own: `gully-web`
(compose project `gully`, directory `~/gully-web`). Every other container and project on that host is off limits,
whatever its owner and however broken it is: peddleswap*, peddles*, peddlepro*, cf-* (Cartel Family), latch-*,
deepcore, and anything else.

- **Forbidden on anything that is not `gully-web`:** `docker start/stop/restart/kill/rm`, `compose up/down/build`,
  running another project's deploy script, editing its files or compose config, pruning its images or volumes.
- **Allowed:** read-only inspection for diagnosis (`docker ps`, `docker logs`, `docker inspect`, `df`).
- **When another project is broken:** report the cause and the exact command that would fix it, then stop. The
  owner decides and acts.
- **A broad request ("fix all gaps", "sync the stack") does NOT lift this rule.** It was broken once that way on
  2026-10-15/16 (PeddleSwap databases started, cf-uptime recreated, a PeddleSwap deploy begun and then reverted),
  and that is why this section exists.

## Server and domain
- `gullylabs.xyz` points to `40.160.136.124`, proxied through Cloudflare. Cloudflare Origin Rule "gully-web port 2053" (all requests on the zone) rewrites the destination port to 2053. SSL mode is Full (not strict) because the origin cert is self-signed; install a Cloudflare Origin Certificate in `~/gully-web/certs/` before switching back to Full (strict).
- **On the server, only work in our own containers and ports.** Do not stop, modify, reconfigure or remove any other container, service, port, volume, network, firewall rule or system config that we did not create. Name everything we create with a `gully-` prefix so it is clearly ours.
- Before binding a port, check it is free; never take over a port used by something else.
- Deploy: `Dockerfile` + `compose.yaml` (project `gully`, container `gully-web`, image `gully-web`). `server/server.mjs` serves `dist/` with SPA fallback and handles `/api/contact` (replaces the Vercel function when self-hosting). Run with `GULLY_WEB_PORT=<free port> docker compose up -d --build`.
- Live deployment: SSH `ubuntu@40.160.136.124`, source in `~/gully-web`, container `gully-web` on `127.0.0.1:8099` (local checks) and public `0.0.0.0:2053` (HTTPS + HTTP on one port, self-signed cert in `~/gully-web/certs/`, for Cloudflare via an Origin Rule rewriting the destination port to 2053), network `gully_default`. Redeploy: `rm -rf ~/gully-web/{src,public,server,api,compare,scripts}` FIRST, then upload the commit (`git archive --format=tar.gz HEAD | ssh … tar -xzf - -C ~/gully-web`), then `cd ~/gully-web && GULLY_WEB_PORT=8099 docker compose up -d --build web`, and write the short SHA to `~/gully-web/DEPLOYED_SHA`. Extracting over the old tree leaves files that git deleted in place; on 2026-10-15 a stale `MetricsPanel.tsx` broke `tsc` inside the image build while the local build passed, and `docker compose up` kept the OLD container running with no error shown (it printed "Up 24 minutes"). After every deploy, fetch the public bundle and grep for a string the commit added; a healthy container is not a deployed commit. Never set `umask 077` (or any restrictive umask) in the same shell that extracts the source: on 2026-10-16 it made every file 600, the image's `node` user could not read `/app/server.mjs`, and the site was down (Cloudflare 521) for about two minutes. Secrets in `~/gully-web/.env` get `chmod 600` on their own; the source must stay world-readable.
- **Compose services (project `gully`): `web` (container `gully-web`), `blog` (`gully-blog`, open-source Ghost 6) and `blog-db` (`gully-blog-db`, MySQL 8.4).** A site deploy rebuilds `web` only: `docker compose up -d --build web`. The blog has no host port: every request on `blog.gullylabs.xyz` reaches gully-web through the zone's Origin Rule and `server/blog.mjs` forwards it to `gully-blog:2368`. Its volumes are `gully-blog-content` and `gully-blog-mysql`. `BLOG_DB_PASSWORD` and `BLOG_SETUP_TOKEN` live in `~/gully-web/.env` and compose refuses to start without the password.
- **The blog's branding lives in its database, not in this repo** (2026-10-16): title, description, accent `#E8C060`, icon, `@Gully_Labs`, share image, navigation, members sign-up `none`, comments `off`, the Source theme's dark background, and `codeinjection_head`/`codeinjection_foot` (brand fonts and colours, plus an honest "first posts are on the way" intro that shows only while there are no posts). Ghost's sample "Coming soon" post and "About" page were set to draft, not deleted. Changes are SQL against `gully-blog-db` followed by `docker compose restart blog` (Ghost caches settings). Once the owner has an account, the admin UI is the place for this instead.
- **`bg-white`, `text-white` and friends do not exist in this Tailwind theme** (it defines its own colour tokens). A class using them renders nothing and fails silently: every stock logo's white disc was transparent until 2026-10-16. Use `bg-[#fff]` or a theme token.
- **Ghost's first-run setup is locked** (2026-10-16): the setup call is refused unless the browser first visits `https://blog.gullylabs.xyz/__blog-setup?token=<BLOG_SETUP_TOKEN>`, which sets a one-hour cookie. Ghost refuses a second setup on its own once the owner account exists. Ghost sends no email yet (no SMTP set), so staff invites and member sign-in mails do not work until `mail__*` is configured on the `blog` service.
- The server is shared with many other projects (peddles-*, peddleswap-*, latch-*, cf-*, peddlepro-*). Ports 80/443 belong to `peddles-caddy-1`, and `latch-cloudflared` is Latch's tunnel: none of these are ours, so don't touch them.

## Live figures: nothing numeric is typed into the site (owner, 2026-10-15)
Every volume, TVL and fee figure, every sparkline and the home chart are read live from
`GET /api/stats`, answered by `server/stats.mjs` (the self-hosted server, a Vite middleware in dev,
and `api/stats.ts` on Vercel). It reads each project's OWN public API once a minute and adds up
what agrees in USD, keeping the source beside every number:

| Project | Source | Publishes |
|---|---|---|
| Cartel Family | `cartel.family/api/platform/landing-stats` | volume 24h, all-time, daily series |
| DeepCore | `deepcore.fun/v1/overview` (cross-chain) | volume 24h, TVL, fees, daily series |
| PeddleSwap | `api{,-base,-arc}.peddleswap.xyz/v1/stats/overview` | TVL, volume, fees, locked, daily series |
| Peddles | `api.peddles.xyz/api/v1/analytics/platform` + `/windows`, plus DefiLlama `summary/dexs/peddles` and `summary/fees/peddles` | TVL, volume 24h from Peddles; all-time volume and fees in USD from DefiLlama; creator fees in ETH |
| PeddleQuest | DefiLlama `protocol/peddlequest` + `summary/fees/peddlequest` | escrowed reward pools as TVL, fees; no volume |

DefiLlama state (checked 2026-10-15): DeepCore, Peddles (dexs + fees; its merged TVL adapter errors and reports
nothing), PeddleQuest and the retired Latch Protocol are listed; PeddleSwap's adapter PR #21383 was closed by
DefiLlama for having no liquidity ("reopen once there are active pools"); Cartel Family is not a DeFi protocol
and is not listed. PeddleSwap's own stats API answered 500 on 2026-10-15 because its Postgres containers had exited
after the box ran out of disk; `docker start` on them fixed it the same day, and this site reads it again. DefiLlama figures lag a day and are always named as the source where used.

Rules: a venue that cannot be read is `state: error` and renders as unreadable, never as zero; a
figure a venue does not publish is `null` and the totals say which venues they cover; a figure in a
token (Peddles' creator fees) is shown but never added to a dollar total; fewer than two points is
"not enough for a series yet", not a flat line. Peddles' and PeddleQuest's APIs refuse a foreign
browser origin, which is why the read is server-side. Remaining placeholders: social links; the
email provider in `api/contact.ts`; the notify-me button.

The project list is `src/content/projects.ts` (Cartel Family, DeepCore, PeddleSwap, Peddles,
PeddleQuest; one slot in the lab). Latch Protocol was removed on 2026-10-15 (its repo is retired);
DeepCore replaces it. Logos come from each project's own brand kit or live site identity, never
drawn here.
