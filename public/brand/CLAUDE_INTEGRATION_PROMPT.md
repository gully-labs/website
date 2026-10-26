# Gully Labs — Brand Kit Integration Prompt

Paste everything below the line into Claude (Claude Code, or a chat with your repo attached). Copy the `brand-kit/` folder into your project first.

---

You are integrating the Gully Labs brand kit into this project. The assets are already in `brand-kit/`. Integrate them pixel-perfect: never re-draw, re-colour, crop, stretch or re-compress any asset. Always render at the exact intrinsic aspect ratio, and serve `-2x` / `-3x` files to high-DPI screens via `srcset`.

## 1. Copy assets
Move `brand-kit/` to the public/static folder (e.g. `public/brand/`). Keep file names unchanged.

```
logo/   gully-labs-logo.png (928×372, transparent)   gully-labs-logo-2x.png   gully-labs-logo.svg
        gully-labs-logo-on-light.png / -2x.png / .svg   (dark "GULLY" + tagline, for white backgrounds)
        gully-labs-wordmark-horizontal(.png|.svg) (1171×116)   gully-labs-wordmark-horizontal-on-light(.png|.svg)
        gully-labs-wordmark-stacked.png
icon/   gully-labs-icon.png (343×372 trimmed, transparent)   gully-labs-icon.svg   gully-labs-icon-512.png   gully-labs-icon-1024.png
        app-icon-1024/512/192/180.png (rounded, dark)   favicon-16/32/48.png
social/ og-image-1200x630.png   x-banner-1500x500.png   x-pfp-400x400.png   x-pfp-1000x1000.png
        facebook-cover-1640x624.png   facebook-pfp-720x720.png   youtube-banner-2560x1440.png   youtube-pfp-800x800.png
telegram/ telegram-main-640x640.png   telegram-news-640x640.png   telegram-buybot-640x640.png
badges/ powered-by-gully-labs-{dark|light}.png (254×64) + -2x.png + -3x.png + .svg
        secured-by-gully-labs-{dark|light}.png (254×64) + -2x.png + -3x.png + .svg
mascots/ mascot-{1-building|2-planning|3-coding|4-deploying|5-success}-feathered.png
```

## 2. Brand tokens (add to CSS / Tailwind config)
```css
:root{
  --gl-bg:        #06050D;   /* page background */
  --gl-surface:   #0B0A16;   /* cards, badges */
  --gl-cyan:      #00D2FF;
  --gl-blue:      #248BFF;
  --gl-violet:    #7B3BFF;
  --gl-magenta:   #C02CFF;
  --gl-text:      #FFFFFF;
  --gl-text-muted:#A3A8C3;
  --gl-ink:       #0B0A16;   /* text on light */
  --gl-gradient:  linear-gradient(90deg,#00D2FF 0%,#248BFF 33%,#7B3BFF 66%,#C02CFF 100%);
  --gl-font: 'Poppins', system-ui, sans-serif;  /* weights 500/600/700 from Google Fonts */
}
```
Tagline (verbatim): **You Think It, We Ship It.**

## 3. `<head>` — favicons, app icons, Open Graph, X card
```html
<link rel="icon" type="image/png" sizes="16x16" href="/brand/icon/favicon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/icon/favicon-32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/brand/icon/favicon-48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/brand/icon/app-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#06050D">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Gully Labs">
<meta property="og:title" content="Gully Labs — You Think It, We Ship It.">
<meta property="og:image" content="https://YOUR-DOMAIN/brand/social/og-image-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Gully Labs logo with mascot">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://YOUR-DOMAIN/brand/social/og-image-1200x630.png">
```
OG / Twitter image URLs must be absolute. Create `site.webmanifest` with icons `app-icon-192.png` (192×192) and `app-icon-512.png` (512×512), `background_color` and `theme_color` `#06050D`.

## 4. Logo usage
```html
<!-- dark backgrounds -->
<img src="/brand/logo/gully-labs-logo.png"
     srcset="/brand/logo/gully-labs-logo.png 1x, /brand/logo/gully-labs-logo-2x.png 2x"
     width="232" height="93" alt="Gully Labs — You Think It, We Ship It.">
<!-- light backgrounds -->
<img src="/brand/logo/gully-labs-logo-on-light.png"
     srcset="/brand/logo/gully-labs-logo-on-light.png 1x, /brand/logo/gully-labs-logo-on-light-2x.png 2x"
     width="232" height="93" alt="Gully Labs">
<!-- compact nav: icon + horizontal wordmark -->
<a href="/" style="display:flex;align-items:center;gap:10px">
  <img src="/brand/icon/gully-labs-icon.png" width="30" height="33" alt="">
  <img src="/brand/logo/gully-labs-wordmark-horizontal.png" width="170" height="17" alt="Gully Labs">
</a>
```
Rules:
- Keep aspect ratio exact: full logo 2.495:1, icon 0.922:1, horizontal wordmark 10.09:1. Always set both `width` and `height` from these ratios.
- Clear space around the logo = height of the flask's top bubble (≈ 12% of logo height) on all sides.
- Minimum sizes: full logo 140px wide, icon 20px tall, horizontal wordmark 100px wide.
- White "GULLY" files only on dark (`#06050D`–`#1A1830`) backgrounds; use the `-on-light` files on white/light grey.
- Never add drop shadows, outlines, recolours or rotate any mark. Never place on busy photos without a `#06050D` scrim at ≥70% opacity.

## 5. Badges ("Powered by" / "Secured by")
Intrinsic size 254×64. Use the SVG where possible (font + images embedded, scales cleanly); otherwise PNG with srcset.
```html
<a href="https://YOUR-DOMAIN" target="_blank" rel="noopener" aria-label="Powered by Gully Labs">
  <img src="/brand/badges/powered-by-gully-labs-dark.png"
       srcset="/brand/badges/powered-by-gully-labs-dark.png 1x,
               /brand/badges/powered-by-gully-labs-dark-2x.png 2x,
               /brand/badges/powered-by-gully-labs-dark-3x.png 3x"
       width="254" height="64" alt="Powered by Gully Labs">
</a>
```
Allowed display sizes: 254×64 (default), 190×48 (compact), 127×32 (minimum). Use `-dark` on dark footers, `-light` on light footers. Corners are transparent.

## 6. Social / channel uploads (manual, not code)
- X: profile `social/x-pfp-400x400.png` (or 1000), header `social/x-banner-1500x500.png`.
- Facebook: profile `social/facebook-pfp-720x720.png`, cover `social/facebook-cover-1640x624.png` (logo sits in the mobile-safe centre).
- YouTube: profile `social/youtube-pfp-800x800.png`, banner `social/youtube-banner-2560x1440.png` (logo + mascots inside the 1546×423 safe area).
- Telegram: main channel `telegram/telegram-main-640x640.png`, news channel `telegram/telegram-news-640x640.png`, buy-bot `telegram/telegram-buybot-640x640.png`. All are circle-safe.
- Upload the PNGs as-is. Do not let any tool re-crop them.

## 7. Verify
After integrating, check: favicon shows in the tab; `og:image` validates in an OG debugger at 1200×630; every `<img>` has explicit width/height matching the ratios above; no asset is scaled with CSS `object-fit: cover`; logo, icon and badges look crisp on a 2× display.
