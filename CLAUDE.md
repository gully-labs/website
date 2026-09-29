# Gully Labs website

Marketing site for Gully Labs, a blockchain development company that builds and releases its own Web3 projects and takes on partner work.

## Source of truth for design
The design kit lives at `C:\Users\Admin\Downloads\Gully Labs landing directions (1)\gully-labs-kit\`. It is the spec; do not redesign it.
- `README.md`: every screen, measurement, colour, copy string, interaction and validation rule.
- `BRAND.md`: tokens, typography, motion.
- `screenshots/`: visual targets (desktop 1440px, mobile 390px).
- `design-files/Gully Labs Portfolio Wall.dc.html`: prototype source. Its inline styles are the exact values when the README is ambiguous.

Pages: Home, Project detail (x4), Services, About, plus a global contact modal. Do not add sections, stats, testimonials, pricing, icons or copy that aren't in the kit.

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

## Placeholders (keep marked as TODO)
Sample TVL, volume, member and holder numbers; project "Visit" URLs; social links; the email provider in `api/contact.ts`.
