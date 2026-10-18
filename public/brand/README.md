# Handoff: Gully Labs Brand Kit

## Overview
This is the complete brand kit for **Gully Labs** (gullylabs.xyz, X: @Gully_Labs), a Web3 developer company building next-gen multi-chain dApps and tools. Tagline: **Building the Next GEN Multi-Chain dApps & Tools**.

The kit contains logos (vector SVG and transparent PNG), social images at exact platform sizes for X, YouTube and Telegram, an announcement post template, design tokens, and mascot pose prompts.

## About the design files
`source/Gully Labs Brand Kit.dc.html` is a **design reference built in HTML**. Open it in a browser to see every asset in context. It is not production code: rebuild the logo and tokens in your target stack (React, Next.js, Tailwind, etc.) using the files in `svg/` and `tokens/`.

## Fidelity
High-fidelity and final. Colors, type, sizes and spacing are exact. Use the ready-made PNGs as they are for social uploads.

## Folder map
```
png/
  social/x/          x-pfp 400x400 · x-header 1500x500 · x-announcement 1600x900
  social/youtube/    youtube-pfp 800x800 · youtube-banner 2560x1440
  social/telegram/   channel 640x640 · group 640x640 · channel-post 1280x720 · group-welcome 1280x720
  logo/              horizontal on dark 1600x640 · horizontal on light 1600x640 · stacked 1000x1000
  transparent/       every logo + mascot bust, transparent background, @1x and -2x
  mascot/            00-scientist 1024x1024 (master render)
svg/                 wordmark, horizontal, stacked (on-dark / on-light), mascot-bust
tokens/              tokens.css · tokens.json
source/              HTML design reference + assets
CLAUDE_PROMPT.md     paste into Claude Code to implement the brand in a site/app
MASCOT_PROMPTS.md    prompts for generating the 4 remaining mascot poses
```

## SVG notes
- The **wordmark** ("GULLY LABS" + underline bar) is fully vector. The text has been converted to outlined paths (Barlow Condensed Bold 700), so no font needs to be installed. It scales to any size.
- The **mascot** is a photoreal 3D render and can't be turned into true vector art. Each SVG that includes the mascot links to `svg/gullylabs-mascot-bust.png`, which sits in the same folder. Keep them together. If you need a single file with nothing linked, use the PNGs in `png/transparent/`.
- **on-dark** files are for dark backgrounds, where GULLY is Bone `#F4F2EC`. **on-light** files are for light backgrounds, where GULLY is Lab Night `#0D141C`.

## Logo construction (S = wordmark font size)
- Font: Barlow Condensed 700, uppercase. "GULLY" and "LABS" are separated by a gap of 0.22 S.
- LABS fill: 180° linear gradient `#F6E1A0 0% → #D9B563 38% → #8C8150 70% → #3C553B 100%` (on light backgrounds: `#D9B563 → #A07C3A → #5C6440 → #2F4A33`).
- Underline bar: sits 0.12 S below the baseline, is 0.06 S tall and spans the full width of the wordmark. Fill: 90° `#2A3542 0% → #6F7560 40% → #D9B563 85% → #F2D58A 100%`.
- Horizontal lockup: mascot bust width = 2.7 S, gap to the wordmark = 0.38 S, both centered vertically.
- Stacked lockup: mascot bust width = 3.8 S, gap = 0.41 S, wordmark centered below.
- Clear space: at least the wordmark cap height (x) on every side. Minimum size: lockup 180 px wide, mascot mark 32 px.
- Don't: recolor the LABS gradient, stretch the logo, place it on mid-tone backgrounds, or flip or rearrange the mascot.

## Design tokens
| Token | Hex | Use |
|---|---|---|
| lab-night | #0D141C | primary background |
| midnight | #151D28 | surfaces, cards |
| slate | #2A3542 | lines, borders |
| bone | #F4F2EC | GULLY, primary text |
| lab-gold | #D9B563 | accent, links |
| pale-gold | #F2D58A | highlights, hover |
| frog-green | #2F6B35 | mascot accent (use sparingly) |
| moss | #3C553B | gradient base |
| text-muted | #AEB5BE | secondary text |
| text-dim | #7D8794 | captions |

Background treatment used across the social assets: `radial-gradient(ellipse at 70% 40%, #1D2836 0%, #111923 50%, #0B1118 100%)`, overlaid with a 1 px grid line in `rgba(244,242,236,0.035)` every 50–80 px, plus a gold glow behind the mascot: `radial-gradient(circle, rgba(217,181,99,0.16), transparent 65%)`.

Type:
- Display: Barlow Condensed 700, uppercase, line-height 0.86–0.92
- Body: Barlow 400/500/600, line-height 1.4
- Utility (URLs, handles, labels): JetBrains Mono 500, labels tracked at 0.14em

Radii: buttons 6 px, cards 16 px. No shadows.

## Platform notes
- **X header:** keep the bottom-left 16–150 px clear, because the profile photo overlaps it. The top and bottom 60 px can be cropped on mobile.
- **YouTube banner:** all key content sits inside the 1546 × 423 safe area, centered at x 507, y 508.5. The rest of the image only shows on TV.
- **Profile photos:** every platform crops them to a circle, and the compositions are built for that crop.
- **Telegram:** use the navy image for the Channel and the gold one for the Group, so the two are easy to tell apart in the chat list.

## Assets
- `gully-bust.png`: cut out from the supplied lockup artwork, 440 × 420, with a transparent background.
- `gully-flask.png`: the supplied mascot action render, 1024 × 1024, on its original dark background. A clean transparent cut-out of this image needs a dedicated background-removal tool, because of the holographic charts and glow.
- Mascot poses 01–04 are not made yet. Generate them from `MASCOT_PROMPTS.md`.
