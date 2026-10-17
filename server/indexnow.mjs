// IndexNow (Bing, Yandex, Seznam, Naver and others): each host serves the key file /<INDEXNOW_KEY>.txt so
// search engines can confirm submissions really come from us. scripts/indexnow-submit.mjs then sends every
// URL from each host's sitemap. Google does not use IndexNow (it uses Search Console).
//
// Env: INDEXNOW_KEY: 8–128 characters of [A-Za-z0-9-]; unset means no key file and no submissions.

export const indexNowKey = () => {
  const k = String(process.env.INDEXNOW_KEY ?? '').trim()
  return /^[A-Za-z0-9-]{8,128}$/.test(k) ? k : null
}

/** Serves /<key>.txt on any host; returns true when it answered. */
export function handleIndexNowKey(req, res, url) {
  const key = indexNowKey()
  if (!key || url.pathname !== `/${key}.txt`) return false
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
  res.end(key)
  return true
}
