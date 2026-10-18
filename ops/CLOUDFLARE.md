# Cloudflare: custom error pages and cache rules (gullylabs.xyz)

These are dashboard settings only the owner can change. This file is the click path and the exact values to
enter. Nothing here is applied automatically.

## 1. Custom error pages

There are two pages. Each is self-contained: inline CSS, the two brand fonts inlined, the wordmark as inline
SVG and no JavaScript. They therefore render even when our origin is down.

| Page | Source in repo | Published URL (after deploy) | Cloudflare slot | Placeholder it contains |
|---|---|---|---|---|
| Origin down / 500 / 502 / 503 / 504 / 52x | [`public/errors/5xx.html`](../public/errors/5xx.html) | `https://gullylabs.xyz/errors/5xx.html` | **5XX Errors** | `::CLOUDFLARE_ERROR_500S_BOX::` |
| Cloudflare 1000-class (DNS, host and access errors) | [`public/errors/1xxx.html`](../public/errors/1xxx.html) | `https://gullylabs.xyz/errors/1xxx.html` | **1XXX Errors** | `::CLOUDFLARE_ERROR_1000S_BOX::` |

**What each page contains:**

- a "Try again" button, which is a plain link to the current URL;
- links to X (`@Gully_Labs`) and Telegram (`GullyLabsNews`), which open in a new tab;
- a gold line that sweeps the card and a pulsing dot, both still under `prefers-reduced-motion`.

They are checked at 390 px and 1280 px with no horizontal scroll. The repo has no public status page, so
there is no status link. Add one to both pages if a status page is set up.

**How they get served.** `gully-web` serves them like any other file in `public/`: Vite copies `public/` into
`dist/`, and `server/server.mjs` serves any file that exists there. A `.html` path is never treated as an app
route. They answer `200 text/html` with `Cache-Control: no-cache` on every host, including
`https://gullylabs.xyz/errors/5xx.html`.

### Owner's click path (do this after the commit is deployed)

1. Check the page is live: open `https://gullylabs.xyz/errors/5xx.html`. You should see "Back in a moment" and
   the raw text `::CLOUDFLARE_ERROR_500S_BOX::` at the bottom.
2. Go to **Cloudflare dashboard → gullylabs.xyz → Error Pages** (older dashboards call it **Custom Pages**).
3. Find **5XX Errors** and click **Custom page**.
4. Enter `https://gullylabs.xyz/errors/5xx.html`.
5. Click **Publish**. Cloudflare fetches the page once and stores a copy. It does not fetch it again while the
   site is down.
6. Do the same for **1XXX Errors** with `https://gullylabs.xyz/errors/1xxx.html`, then **Publish**.
7. **Every time either file changes:** deploy first, then press **Publish** again on that slot. Cloudflare
   keeps the old copy until you do.

**Notes:**

- Cloudflare rejects a page without its placeholder (`::CLOUDFLARE_ERROR_500S_BOX::` /
  `::CLOUDFLARE_ERROR_1000S_BOX::`), and stores at most about 1.4 MB. Each page is about 55 KB.
- If the dashboard says 5XX pages need a higher plan, use the Free-plan fallbacks in
  [DEPLOY.md, "When the origin is down"](DEPLOY.md#when-the-origin-is-down-cloudflares-error-page) (a Worker,
  or Always Online). The same `5xx.html` works as the Worker's body once the placeholder line is removed.
- These pages replace `maintenance.html` in the 5XX slot. `public/maintenance.html` stays published so
  existing links keep working.

## 2. Cache rules

Add these under **Cloudflare dashboard → gullylabs.xyz → Caching → Cache Rules → Create rule**. Each rule uses
**Edit expression**, and its settings are listed below it. Keep them in this order:

- when two rules set the same thing, the later one wins;
- **Rule C (Bypass) must stay last** so nothing under `/api/` or on admin/analytics can ever be cached by an
  earlier rule.

The hosts are `gullylabs.xyz` (the main site), `app.gullylabs.xyz` (the app), `docs.gullylabs.xyz` (the docs),
`blog.gullylabs.xyz` (Ghost), `admin.gullylabs.xyz` and `analytics.gullylabs.xyz`.

### Rule A: static files on the main, app and docs hosts (eligible, respect origin)

```
(http.host in {"gullylabs.xyz" "app.gullylabs.xyz" "docs.gullylabs.xyz"}
 and (starts_with(http.request.uri.path, "/assets/")
   or starts_with(http.request.uri.path, "/chains/")
   or starts_with(http.request.uri.path, "/logos/")
   or starts_with(http.request.uri.path, "/fonts/")))
```

- **Cache eligibility:** Eligible for cache.
- **Edge TTL:** *Use cache-control header if present, use default Cloudflare caching behavior if not*.
- **Browser TTL:** *Respect origin TTL*.

**What the origin sends today (`server/server.mjs`, `serveFile`):**

- Hashed build files (`/assets/*-xxxxxxxx.*`) are `public, max-age=31536000, immutable`.
- `/chains/`, `/tokens/` and `/social/` are `public, max-age=86400`.
- Everything else is `no-cache`, which the rule respects. That includes unhashed files in `/assets/` such as
  the brand images.
- `/logos/` and `/fonts/` do not exist yet: the fonts are bundled into `/assets/`. They are in the rule so a
  later move needs no dashboard change.

### Rule B: the blog's images and theme assets (one month)

```
(http.host eq "blog.gullylabs.xyz"
 and (starts_with(http.request.uri.path, "/content/images/")
   or starts_with(http.request.uri.path, "/assets/")))
```

- **Cache eligibility:** Eligible for cache.
- **Edge TTL:** *Ignore cache-control header and use this TTL*, **1 month**.
- **Browser TTL:** *Respect origin TTL*.

Ghost's theme assets carry a `?v=` version, so a theme change is picked up at once.

**Purging an image:** an uploaded image that is replaced under the same name stays at the edge for up to a
month. To clear it: *Caching → Configuration → Custom Purge* with its URL.

### Rule C: never cache the API, admin, analytics or the Ghost admin (bypass, keep last)

```
(starts_with(http.request.uri.path, "/api/")
 or http.host in {"admin.gullylabs.xyz" "analytics.gullylabs.xyz"}
 or starts_with(http.request.uri.path, "/ghost/"))
```

- **Cache eligibility:** Bypass cache.

**Why each part is there:**

- `/api/` is matched on every host. It covers the public API, the app's session calls and Gully Pay.
- `/ghost/` covers the blog's admin and its Content and Admin APIs.
- All of these must never be shared between visitors. The public API already sends short `s-maxage` values
  for its read-only GETs. If edge caching of `/api/tracker` is wanted later, add a narrow rule for it after
  this one, deliberately.

### After adding the rules: check

```sh
curl -sI https://gullylabs.xyz/api/tracker | grep -i cf-cache-status           # DYNAMIC or BYPASS
curl -sI https://admin.gullylabs.xyz/ | grep -i cf-cache-status                # DYNAMIC or BYPASS
curl -sI "https://gullylabs.xyz$(curl -s https://gullylabs.xyz/ | grep -o '/assets/index-[^"]*\.js' | head -1)" | grep -i 'cf-cache-status\|cache-control'
                                                                                 # HIT after the second request
curl -sI https://blog.gullylabs.xyz/ghost/ | grep -i cf-cache-status           # DYNAMIC or BYPASS
```
