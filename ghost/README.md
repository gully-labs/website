# Blog theme (blog.gullylabs.xyz)

The Gully Labs blog runs on open-source Ghost 6 (compose service `blog`, see the project notes). Its
look is the custom theme in `theme/gully/`, built on Ghost's official **Source** theme v1.7.6 (MIT), in the
**2026 Gully Labs brand kit** (`Desktop\GULLY LABS GRAPHICS\Gully Labs\brand-kit`, read its
`CLAUDE_INTEGRATION_PROMPT.md`): background `#06050D`, surfaces `#0B0A16`, cyan `#00D2FF` as the accent, blue
`#248BFF`, violet `#7B3BFF`, magenta `#C02CFF`, muted text `#A3A8C3`, Poppins 500/600/700 (self-hosted), the
tagline "You Think It, We Ship It." verbatim. The kit's files sit in `theme/gully/assets/brand/` byte for byte
(logo, horizontal wordmark, icon, favicons and app icons, the "Powered by" badge, the OG image, two mascots);
nothing is re-drawn, re-coloured or cropped, every `<img>` carries the kit's exact ratio. The kit's SVGs are
wrappers around an `<image>` with no data, so the PNGs (with `-2x`/`-3x` srcsets) are the masters. The owner's
UI rules apply too: minimal pages, a Lucide icon on every menu item, one signature pill button, toasts on real
events, and a continuously animated live element on every page (the stats ticker).

```
ghost/
  theme/gully/        the theme (templates, partials, assets)
  theme/gully.zip     the packaged theme (built by scripts/blog-theme-zip.mjs)
scripts/
  blog-theme-zip.mjs      packs theme/gully into theme/gully.zip (no dependencies)
  blog-theme-upload.mjs   uploads and activates the zip through Ghost's Admin API (no dependencies)
  blog-theme-preview.mjs  renders the theme to static HTML without Ghost (sample content)
  blog-theme-icons.mjs    regenerates the icon partials from lucide
```

## What the theme does

- **Header, one line from 1024 to 1920 px:** the kit's compact lockup (icon 30x33 + horizontal wordmark 170x17, to
  gullylabs.xyz, new tab) plus "Blog"; Products and App &amp; API menus, Projects, Pricing, the signature
  "Launch app" button (to app.gullylabs.xyz). Every item has a Lucide icon. Links to other
  Gully sites (gullylabs.xyz, app., docs., analytics., github.com, x.com, t.me) open in a new tab
  with a ↗ marker, `rel="noopener noreferrer"` and hidden "(opens in a new tab)" text.
- **Blog sections bar** under it: Ghost's own navigation (admin > Settings > Navigation), each item with
  an icon picked by its label (home, tags, about, releases, changelog, news, engineering, guides,
  products, research, tracker, pay, chains, rss, contact, launches, authors; a page icon otherwise),
  plus search. No Sign in, Subscribe or Account buttons.
- **Live stats ticker** under the header on every page (`partials/ticker.hbs`, `gully.js` section 7): all-time
  and 24 h volume, value locked, 24 h and all-time fees from `https://gullylabs.xyz/api/stats` (CORS open),
  refreshed every 60 s while the tab is visible; the numbers count up, the strip scrolls continuously, a
  gradient sparkline draws the last 30 days of volume, a pulsing cyan dot says "live". Reduced motion: no
  scroll, no count-up. If the API fails the last values stay and the dot goes dim (no toast: not the
  reader's action).
- **Signature button** (`.gl-btn`): a pill, left Lucide icon, the trailing arrow slides right on hover, a
  shine sweeps across, scale .98 when pressed, cyan focus ring. `--primary` cyan fill / black text,
  `--secondary` blue fill / white text, `--ghost` 1 px line.
- **Toasts** (`gully.js` section 5): bottom-right stack, night surface, 22 px corners, Lucide icon, a cyan
  gradient progress bar that is the toast's life (3.2 s, hover pauses), click to dismiss. Only real events:
  link copied, code copied, copy failed.
- **Mobile:** a Menu button opens a full-height sheet with the same groups as accordions.
- **Footer:** the kit's full logo (232x93, with its 2x file), the tagline, Products / App & API / Company /
  Social columns, Start a project, the "Information only, not investment advice" line, Ghost's secondary
  navigation and the kit's "Powered by Gully Labs" badge (190x48, 1x/2x/3x). No "Powered by Ghost".
- **Home, kept short:** masthead (site title, description, tagline), 01 the lead story (newest featured
  post, else the newest post), 02 the five latest posts in a hairline grid with the archive tile (two rows
  at 1024+) and topic chips, 03 "From the Stock tracker" links. `posts_per_page` is 6, so page 2 exists (and the
  tile links to it) as soon as there is a seventh post; every post is reachable. With no posts:
  "First posts coming soon" with the kit's "building" mascot and links to the app and docs.
- **Post:** gradient reading-progress hairline, kicker (tag, date, reading time), display title, share
  (X, Telegram, copy link with a toast), the generated banner, content with docs-style code blocks
  (language label and copy button), captions, author box, related posts (same primary tag, else latest).
- **Tag, author, 404 (with the kit's "planning" mascot) and error pages**, pagination.
- **No email opt-in or members UI**: no sign-in, subscribe, account or newsletter forms, no post-end
  sign-up box, no comments, no "Members" lock on cards, and partials/content-cta.hbs blanks Ghost's
  members-only upgrade box. Set Settings > Membership > Subscription access to "Nobody" so Ghost
  does not load Portal either.
- **Accessibility:** 44 px targets, cyan focus rings, skip link, disclosure-button menus (Escape closes
  and returns focus, arrow keys move), focus-trapped mobile sheet, text contrast at or above 4.5:1
  (small text uses `#A3A8C3` or lighter on `#06050D`, 8.6:1). Reduced motion follows the site's policy: fades
  and colour changes only.
- **No third-party scripts or fonts.** Fonts and brand files are served from the theme's own assets; the only
  network call is the stats ticker (gullylabs.xyz, our own API). `head`: favicons 16/32/48, apple-touch-icon
  180, `site.webmanifest` (192/512 app icons, `#06050D`), `theme-color #06050D`.

### Animated banners

Every post has an animated banner unique to it, drawn client-side by `assets/js/banner.js` into a
canvas the size of the banner box (aria-hidden). Five motifs: drifting chart lines, a gap band between a
price line and a fair-value line, a ticker tape of the post's own words, a block/chain graph with
travelling pulses, a grid of cells lit by a wave. The primary tag narrows the choice (tracker/stock/gap
tags lean to gap and lines, chain/infra tags to graph and cells, releases to ticker, and so on) and the
seed picks within it, along with every shape, speed and colour placement. A kicker (tag and a code like
`GL-0427`) and the short title or tag are set in the banner.

- Post and hero banners animate while on screen; card banners animate on hover or keyboard focus, and
  on touch screens while mostly in view. All pause off-screen (IntersectionObserver) and in background
  tabs. 30 fps (24 for cards), device pixel ratio capped at 2 (1.5 for cards).
- `prefers-reduced-motion: reduce`, or the theme setting **Animated banners** off: one still frame,
  faded in.
- **Posts with a feature image:** the image stays fully visible (with its alt text); the animated layer
  only frames it (cyan corner ticks, a kicker) and moves in a band along the bottom that fades out
  upwards.
- Without JavaScript the banner shows a static hairline grid.

## Share images (og:image)

**Owner rule (2026-10-25): every brand uses its own kit OG image.** The theme prints, before `{{ghost_head}}`
(crawlers take the first tag), `og:image` / `twitter:image` = the kit's `og-image-1200x630.png` at the
absolute blog URL (`{{@site.url}}{{asset "brand/social/og-image-1200x630.png"}}` →
`https://blog.gullylabs.xyz/assets/brand/social/og-image-1200x630.png?v=…`), with width, height, alt "Gully
Labs logo with mascot" and `twitter:card summary_large_image`, on every page that has no image of its own:
home, index, tag, author, 404, and posts/pages without a feature image or their own social image. A post's
feature image is the author's real content and stays its share image (Ghost prints it).

The generated per-post still below still exists on the main site and is opt-in: theme setting **Generated
post share images** (Design > Theme > Post, off by default) switches image-less posts to `GET
https://gullylabs.xyz/og/blog/<slug>.png` (`server/og.mjs`), 1200 x 630 PNG. Note that since the 2026 kit
has no vector wordmark, `banner.js` no longer draws one: the share still ends with the tagline bottom right.

- **What it shows:** the post's own banner (`banner.js`, variant `share`) frozen at its still frame
  `t0 = (seed % 997) / 31` s, the same frame reduced-motion visitors see; the kicker with the primary
  tag's name and the banner code (`NEWS / GL-1005`); the whole title, upper-cased, in Poppins 700
  at the largest of 88/78/68/60/52 px that fits three lines of 84% width (long words break; past that
  the third line ends in an ellipsis); `BLOG.GULLYLABS.XYZ` in IBM Plex Mono and the tagline "You Think It,
  We Ship It." in Poppins 600. (`scripts/brand-from-kit.mjs` and `server/og.mjs`'s `kitWordmark` still
  target the old kit's outlined wordmark; banner.js no longer carries the `kit-wordmark` markers, and
  `server/og.mjs`, Dockerfile `og/fonts` need Poppins instead of Barlow Condensed before the generated still
  is re-enabled.)
  Characters the brand fonts don't have (emoji) are left out of the image; the seed still uses the
  real title, so the art matches the blog's banner.
- **Seed:** `seedString = slug + "
" + title + "
" + primaryTagSlug`, FNV-1a 32-bit, mulberry32, exactly
  as in `banner.js` (the server `require()`s that same file). Same post, same bytes.
- **Renderer:** no native code. `og.mjs` has a small CanvasRenderingContext2D stand-in that records
  `banner.js`'s drawing as SVG and measures text from the fonts' own advance widths (the @fontsource
  WOFF files, unpacked with zlib); `@resvg/resvg-wasm` (2.6.2, pinned, MPL-2.0, no dependencies of its
  own) turns the SVG into the PNG. The production image copies only that package, `banner.js` and four
  font files from the build stage (Dockerfile).
- **Data:** Ghost's Content API over the project network
  (`/ghost/api/content/posts/slug/<slug>/?include=tags`, key `GHOST_CONTENT_KEY` in the box's `.env`),
  cached in memory 5 minutes (unknown slugs 1 minute). Unknown or unpublished slug: 404. No key: 503.
- **Cache:** PNGs on disk in `DATA_DIR/og-cache/<slug>.<key>.png`, key = hash of the post's
  `updated_at`, title, tag, `banner.js` and the renderer version; a slug's older images are removed
  when a new one is written; at most `OG_CACHE_MAX_FILES` (500) files and `OG_CACHE_MAX_BYTES` (64 MB),
  least recently used first out. Responses: `Cache-Control: public, max-age=86400`, an `ETag`, and
  `X-OG-Cache: hit|miss`.
- **Theme side:** `default.hbs` adds `og:image` / `twitter:image` (with size and alt) for posts **without
  a feature image** and without their own social image, before `{{ghost_head}}` (crawlers take the first).
  **Decision:** a post's feature image stays its share image. The owner's rule says the animated layer
  frames a feature image and never replaces real content, and that the generated still is there because
  cards can't animate; so the generated image is the share image whenever the post has no image of its
  own. An author can still override per post with Ghost's Facebook / X card image fields.
- **Test:** `npm run test:og` (stub Ghost, in-process server).

## Preview without Ghost

```
HANDLEBARS=<path to a handlebars 4.7.x package> node scripts/blog-theme-preview.mjs <out dir>
```

Renders home, empty home, page 2, post, post with feature image, tag, author, 404 and error pages
with labelled sample content (a "PREVIEW · SAMPLE CONTENT" ribbon on every page). The helper stand-ins
are simplified; Ghost itself is the reference. handlebars is not a site dependency: the copy npx fetches
with gscan works. Serve the folder over HTTP to see the fonts.

## Validate and package

```
npx gscan@6.6.1 ghost/theme/gully --v6         # must report no errors
node scripts/blog-theme-zip.mjs                # writes ghost/theme/gully.zip
npx gscan@6.6.1 --zip ghost/theme/gully.zip --v6
```

## Upload and activate (owner's session)

```
GHOST_ADMIN_KEY="<id>:<secret>" node scripts/blog-theme-upload.mjs
```

- `GHOST_ADMIN_KEY` is the Admin API key of a custom integration (Ghost admin > Settings > Integrations
  > Add custom integration > Admin API key). Read from the environment only; never printed or written.
- It signs a token with Node's crypto (HS256, header `kid` = key id, `aud` = `/admin/`, expires in 5
  minutes), POSTs `ghost/theme/gully.zip` to `https://blog.gullylabs.xyz/ghost/api/admin/themes/upload/`
  (replacing an existing "gully" theme), then PUTs
  `/ghost/api/admin/themes/gully/activate/`. It prints only `upload: HTTP <status>` and
  `activate: HTTP <status>`, plus Ghost's error message on failure.
- `--no-activate` uploads only. `GHOST_URL` points it at another Ghost (for a test instance).
- **Rollback:** Ghost admin > Settings > Design > Change theme > activate Source again (it stays installed).

## Settings the owner sets by hand in Ghost admin

The Admin API integration key can upload themes but cannot change site settings, so these are set in
Ghost admin (Settings):

1. **Title & description** (General): the title is now "Gully Labs LLC" and the description Ghost's
   default "Thoughts, stories and ideas.". Suggested:
   - Title: `Gully Labs Blog`
   - Description: `Building on-chain: stock token gaps, analytics, payments and the tools behind them.`
   The home masthead shows both.
2. **Accent colour** (Design > Brand): `#00D2FF` (the kit's cyan). The theme's accent is fixed, but Ghost's
   own cards and admin previews use the accent.
3. **Publication icon** (Design > Brand): the kit's `icon/app-icon-512.png` (square, rounded, dark; Ghost
   wants a square ≥ 60 px). The theme prints its own favicons from `assets/brand/icon` regardless.
4. **Publication logo** (Design > Brand): the kit's `logo/gully-labs-logo.png` (928x372, transparent). The
   theme shows the kit files from its own assets; Ghost uses the uploaded logo in emails.
5. **Publication cover** (Design > Brand): the kit's `social/og-image-1200x630.png`. The theme prints that
   same image (from its assets, absolute blog URL) as `og:image` on every page without an image of its own,
   so the cover only matters for Ghost's own tags and admin.
6. **Navigation** (Navigation):
   - Primary (the blog sections bar): e.g. `Home` → `/`, `Releases` → `/tag/releases/`,
     `Engineering` → `/tag/engineering/`, `Tracker` → `/tag/tracker/`. Labels pick the icons (see above).
     Links to gullylabs.xyz, docs. etc. are allowed here and open in a new tab automatically.
   - Secondary (footer line): e.g. `RSS` → `/rss/`.
7. **Code injection** (Code injection): **clear both Site header and Site footer.** They currently hold
   the brand fonts, colours and the "first posts are on the way" intro that were added for Source; the
   theme now covers all of that (fonts self-hosted, empty state built in), and the old injection would
   load fonts twice and fight the theme's styles. Nothing needs injecting.
8. **Theme settings** (Design > Theme): Animated banners on; From the Stock tracker strip on; Generated post
   share images **off** (the kit OG image is the rule).
9. **No "Powered by Ghost" anywhere:** the theme renders none. Two places Ghost itself controls:
   - Newsletter emails: Settings > Newsletters > (newsletter) > Design > turn off "Promote independent
     publishing" (the "Powered by Ghost" badge).
   - Portal (sign-up / account pop-up), only if members are turned on: Ghost core draws its own footer
     inside an iframe the theme cannot style; check Settings > Membership > Portal settings for the badge
     option on this Ghost version.
10. **Twitter / X card** (General > Social accounts): `https://x.com/Gully_Labs`.
