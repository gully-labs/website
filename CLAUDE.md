# Gully Labs website

Marketing site for Gully Labs, a blockchain development company that builds and releases its own Web3 projects and takes on partner work.

## Source of truth for design
The design kit lives at `C:\Users\Admin\Downloads\Gully Labs landing directions (1)\gully-labs-kit\`. It is the spec; do not redesign it.
- `README.md`: every screen, measurement, colour, copy string, interaction and validation rule.
- `BRAND.md`: tokens, typography, motion.
- `screenshots/`: visual targets (desktop 1440px, mobile 390px).
- `design-files/Gully Labs Portfolio Wall.dc.html`: prototype source. Its inline styles are the exact values when the README is ambiguous.

Pages: Home, Project detail (x4), Services, About, plus a global contact modal. Do not add sections, stats, testimonials, pricing, icons or copy that aren't in the kit. Exception (requested by the user): nav menus (header, mobile menu, footer) have lucide-react icons plus brand icons for socials.

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

## Server and domain
- `gullylabs.xyz` points to `40.160.136.124`, proxied through Cloudflare. Cloudflare Origin Rule "gully-web port 2053" (all requests on the zone) rewrites the destination port to 2053. SSL mode is Full (not strict) because the origin cert is self-signed; install a Cloudflare Origin Certificate in `~/gully-web/certs/` before switching back to Full (strict).
- **On the server, only work in our own containers and ports.** Do not stop, modify, reconfigure or remove any other container, service, port, volume, network, firewall rule or system config that we did not create. Name everything we create with a `gully-` prefix so it is clearly ours.
- Before binding a port, check it is free; never take over a port used by something else.
- Deploy: `Dockerfile` + `compose.yaml` (project `gully`, container `gully-web`, image `gully-web`). `server/server.mjs` serves `dist/` with SPA fallback and handles `/api/contact` (replaces the Vercel function when self-hosting). Run with `GULLY_WEB_PORT=<free port> docker compose up -d --build`.
- Live deployment: SSH `ubuntu@40.160.136.124`, source in `~/gully-web`, container `gully-web` on `127.0.0.1:8099` (local checks) and public `0.0.0.0:2053` (HTTPS + HTTP on one port, self-signed cert in `~/gully-web/certs/`, for Cloudflare via an Origin Rule rewriting the destination port to 2053), network `gully_default`. Redeploy: upload source to `~/gully-web`, then `cd ~/gully-web && GULLY_WEB_PORT=8099 docker compose up -d --build`.
- The server is shared with many other projects (peddles-*, peddleswap-*, latch-*, cf-*, peddlepro-*). Ports 80/443 belong to `peddles-caddy-1`, and `latch-cloudflared` is Latch's tunnel: none of these are ours, so don't touch them.

## Placeholders (keep marked as TODO)
Sample TVL, volume, member and holder numbers; project "Visit" URLs; social links; the email provider in `api/contact.ts`.
