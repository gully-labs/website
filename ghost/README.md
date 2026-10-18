# Blog theme (blog.gullylabs.xyz)

The Gully Labs blog runs on open-source Ghost 6 (compose service `blog`, see the project notes). Its
look is the custom theme in `theme/gully/`, built on Ghost's official **Source** theme v1.7.6 (MIT).

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

- **Header like the site:** GULLY LABS wordmark (to gullylabs.xyz, new tab) plus "Blog"; Products and
  Developers menus, Projects, Pricing, a gold Launch app button. Every item has an icon. Links to other
  Gully sites (gullylabs.xyz, developers., docs., analytics., github.com, x.com, t.me) open in a new tab
  with a ↗ marker, `rel="noopener noreferrer"` and hidden "(opens in a new tab)" text.
- **Blog sections bar** under it: Ghost's own navigation (admin > Settings > Navigation), each item with
  an icon picked by its label (home, tags, about, releases, changelog, news, engineering, guides,
  products, research, tracker, pay, chains, rss, contact, launches, authors; a page icon otherwise),
  plus search. No Sign in, Subscribe or Account buttons.
- **Mobile:** a Menu button opens a full-height sheet with the same groups as accordions.
- **Footer like the site:** Products / Developers / Company / Social columns, Start a project, the
  "Information only, not investment advice" line, Ghost's secondary navigation. No "Powered by Ghost".
- **Home:** masthead (site title and description), 01 the lead story (newest featured post, else the
  newest post), 02 a hairline grid of recent posts with topic chips, 03 "From the tracker" links to the
  live products. With no posts: "First posts coming soon" with links to the tracker and docs.
- **Post:** gold reading-progress hairline, kicker (tag, date, reading time), display title, share
  (X, Telegram, copy link with a toast), the generated banner, content with docs-style code blocks
  (language label and copy button), captions, author box, related posts (same primary tag, else latest).
- **Tag, author, 404 and error pages**, pagination.
- **No email opt-in or members UI**: no sign-in, subscribe, account or newsletter forms, no post-end
  sign-up box, no comments, no "Members" lock on cards, and partials/content-cta.hbs blanks Ghost's
  members-only upgrade box. Set Settings > Membership > Subscription access to "Nobody" so Ghost
  does not load Portal either.
- **Accessibility:** 44 px targets, gold focus rings, skip link, disclosure-button menus (Escape closes
  and returns focus, arrow keys move), focus-trapped mobile sheet, text contrast at or above 4.5:1
  (small text uses `#949daa` or lighter on `#0d141c`). Reduced motion follows the site's policy: fades
  and colour changes only.
- **No third-party scripts or fonts.** Everything is served from the theme's own assets.

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
  only frames it (gold corner ticks, a kicker) and moves in a band along the bottom that fades out
  upwards.
- Without JavaScript the banner shows a static hairline grid.

## Share images (og:image)

Social cards can't animate, so every post gets a still share image: `GET
https://gullylabs.xyz/og/blog/<slug>.png` on the main site's server (`server/og.mjs`), 1200 x 630 PNG.

- **What it shows:** the post's own banner (`banner.js`, variant `share`) frozen at its still frame
  `t0 = (seed % 997) / 31` s, the same frame reduced-motion visitors see; the kicker with the primary
  tag's name and the banner code (`NEWS / GL-1005`); the whole title, upper-cased, in Barlow Condensed 800
  at the largest of 88/78/68/60/52 px that fits three lines of 84% width (long words break; past that
  the third line ends in an ellipsis); `BLOG.GULLYLABS.XYZ` in IBM Plex Mono and the brand kit's wordmark (the kit's outlined paths, from
  `KIT_WORDMARK` in banner.js, written by `scripts/brand-from-kit.mjs`).
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
2. **Accent colour** (Design > Brand): `#D9B563`. The theme's gold is fixed, but Ghost's own cards,
   buttons and Portal use the accent.
3. **Publication icon** (Design > Brand): the Gully mark, `public/icon-192.png` in this repo (square,
   192 px; `public/brand/gully-mark-96.png` is the 96 px mark if a smaller one is wanted).
4. **Publication logo** (Design > Brand): optional. The theme sets the GULLY LABS wordmark in type and
   does not show the uploaded logo; Ghost uses the logo in emails and Portal, so upload the mark
   (`public/icon-192.png`) there.
5. **Publication cover** (Design > Brand): `public/social/og-home.png` (1200 x 630). The theme doesn't
   show it on the page; Ghost uses it as the default share image for the home page and posts without
   their own image.
6. **Navigation** (Navigation):
   - Primary (the blog sections bar): e.g. `Home` → `/`, `Releases` → `/tag/releases/`,
     `Engineering` → `/tag/engineering/`, `Tracker` → `/tag/tracker/`. Labels pick the icons (see above).
     Links to gullylabs.xyz, docs. etc. are allowed here and open in a new tab automatically.
   - Secondary (footer line): e.g. `RSS` → `/rss/`.
7. **Code injection** (Code injection): **clear both Site header and Site footer.** They currently hold
   the brand fonts, colours and the "first posts are on the way" intro that were added for Source; the
   theme now covers all of that (fonts self-hosted, empty state built in), and the old injection would
   load fonts twice and fight the theme's styles. Nothing needs injecting.
8. **Theme settings** (Design > Theme): Animated banners on; From the tracker strip on.
9. **No "Powered by Ghost" anywhere:** the theme renders none. Two places Ghost itself controls:
   - Newsletter emails: Settings > Newsletters > (newsletter) > Design > turn off "Promote independent
     publishing" (the "Powered by Ghost" badge).
   - Portal (sign-up / account pop-up), only if members are turned on: Ghost core draws its own footer
     inside an iframe the theme cannot style; check Settings > Membership > Portal settings for the badge
     option on this Ghost version.
10. **Twitter / X card** (General > Social accounts): `https://x.com/Gully_Labs`.
