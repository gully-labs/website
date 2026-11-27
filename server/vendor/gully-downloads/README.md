# Gully downloads kit

Framework-agnostic (vanilla ESM + CSS tokens). One manifest per product, rendered into platform cards.

- `downloads.mjs`: `validate`, `render`, `mount`, `detectPlatform` (UA hints, nothing stored), `order`, `jsonLd`. A React wrapper is not needed: call `render(manifest)` and set it with `dangerouslySetInnerHTML`, or `mount(ref.current, manifest)` in an effect (kre8: lazy chunk on `/downloads` only, nothing on the `/` path).
- `downloads.css`: maps to the host's `--surface --fg --muted --edge --accent --on-accent`, Light/Dark via `[data-theme=dark]`, 44 px targets.
- `qr.mjs`: local QR encoder (no network). `gully-downloads.json`: hub manifest. `link-gate.mjs <manifest> [--offline]`: gate. `demo.html`: mockup (serve the folder).
- Tests: `node --test test/downloads.test.mjs`.

## Item shape
`id, platform, state (live|soon|beta), name, url, version, sha256, size, minOS, releasedAt, summary, install, notes, docs, permissions[{name,why}], file:true` (a downloadable file must carry `sha256`). A `soon` item needs `willDo` and `today`, and must have no `url`, email or waitlist.

## Rules enforced in code
1. `soon` = neutral dashed tile with the platform's plain name, never an official badge, no link, no email capture.
2. A store badge appears only when `state: live` AND the official file is on record in `PLATFORMS[..].badge`. Stores without a recorded official asset get a plain text button, never a lookalike.
3. Only live/beta items enter the SoftwareApplication JSON-LD.

## Official badges on record (`badges/SHA256SUMS`, fetched 2026-11-23, unmodified)
| File | Source | Rules read |
|---|---|---|
| app-store-black-en.svg, app-store-white-en.svg | https://tools.applemediaservices.com/api/badges/download-on-the-app-store/{black,white}/en-us | https://developer.apple.com/app-store/marketing/guidelines/ : use the preferred black badge, do not modify (gray border is part of the art), black badge when other platform badges appear, App Store badge first, never translate "App Store". Licence agreement itself NOT read (the guidelines page links it): owner/counsel to accept in Apple's badge generator. |
| google-play-en.png | https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png | https://play.google.com/intl/en_us/badges/ : no stretching or effects, keep clear space (1/4 badge height), "Pre-register" badge only for real pre-registration. Google trademark terms linked from that page not read in full. |

NOT READ / not stored (manual step for the owner, no lookalikes made): Chrome Web Store badge (developer.chrome.com/docs/webstore/branding, page answers 200 but assets/terms not extracted), Firefox "Get the Add-on" (Mozilla), Microsoft Edge Add-ons and Microsoft Store, Mac App Store, Opera add-ons. Download each from its owner's branding page, add to `badges/`, record the hash, set `badge` in `PLATFORMS`.

Badges are shown only once the app is live in that store. Localised variants (Apple has 50) are not stored; English only.
