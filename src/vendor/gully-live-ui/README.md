# Gully Live UI

One small kit of live components for every Gully surface, so each product shows real activity the same way: numbers
that count up, charts that draw in and tick, a live feed, honest empty states, toasts and signing that look alike.
Framework-free custom elements (ES modules, each under 4 KB gzipped) plus thin React wrappers. Themed only by `--gl-*`
CSS custom properties, so every product keeps its own brand kit. Canonical files live here; copy them byte-identical,
never edit a copy.

| File | Elements | What it does |
|---|---|---|
| `gl-core.js` | | number formatting, the never-empty fallback ladder, SSE parsing, the event schema, identicons, clean axis steps |
| `gl-stat.js` | `<gl-stat>` | stat tile: count-up value, delta chip that flashes, sparkline that draws in, skeleton or "No data yet" |
| `gl-chart.js` | `<gl-chart>` | area / line / bars on canvas, live `push()`, crosshair tooltip, table view for screen readers, never an empty frame |
| `gl-live.js` | `<gl-live-source>` `<gl-ticker>` `<gl-feed>` | one Server-Sent Events stream (polling fallback) feeding a marquee and a feed |
| `gl-chips.js` | `<gl-token>` `<gl-chain>` `<gl-live-badge>` `<gl-status-chip>` `<gl-skeleton>` | token mark with identicon fallback, chain chip with RPC health dot, small states |
| `gl-actions.js` | `toast()` `<gl-toast>` `<gl-stepper>` `<gl-sign-button>` | toasts, steppers, hold-to-sign with progress and states |
| `gl-brand.js` | `<gl-powered-by>` `<gl-mascot>` `renderShareCard()` | kit badge and mascot files at natural ratio (never redrawn), share-card renderer |
| `tokens.css` | | the token contract and one block per Gully kit |
| `react.js` | `Stat`, `Chart`, `Ticker`, … | React wrappers (props `data`, `value`, `spark`, `state` set through a ref) |
| `demo.html` | | every component, every kit (noindex catalogue; its numbers are synthetic) |

## Adopting it

1. Copy the files you need (or serve this folder) and load them as modules:
   `<script type="module" src="/assets/gully-live-ui/gl-stat.js"></script>`.
2. Put your kit's tokens on `:root` (copy a block from `tokens.css`, or add the class `gl-kit-labs|chain|kre8|id` to
   `<html>`). Charts read `--gl-series-1..3`, never the brand accent: those slots passed the dataviz validator in their
   mode. A new kit runs `validate_palette.js` before it ships.
3. Feed real data. A chart gets `{ series }`; when the series is thin give it `sampled` or `activity` and it labels what it
   shows; while the first request is in flight `loading: true`. With nothing, it prints one honest line.
4. Live feeds speak one schema: `{ ts, chainId, kind, title, amount, href }`.
5. The design-gap gate checks that a page showing money or activity uses `gl-stat` / `gl-chart` (or an equivalent with a
   `live` attribute), has no empty chart frame and no console error.

First adopter: the gullycore.xyz hero live panel (head block, seconds per block, transactions, bars per block).

Version 1.0.2 (2026-11-09): a flat or near-flat chart shows one axis label, not the same label repeated, and keeps a span of at least 1 % of the value. 1.0.1 (2026-11-09): numbers under 1 keep four significant digits (token prices). 1.0.0 (2026-11-09).
