// Submits every URL in each Gully host's sitemap to IndexNow (api.indexnow.org shares them with Bing,
// Yandex, Seznam, Naver and the other participants). Follows sitemap indexes (Ghost's blog uses one).
//   INDEXNOW_KEY=<key> node scripts/indexnow-submit.mjs [host ...]
// The key must already be served at https://<host>/<key>.txt (server/indexnow.mjs). Prints counts and
// HTTP statuses only.

const key = String(process.env.INDEXNOW_KEY ?? '').trim()
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error('Set INDEXNOW_KEY (8–128 characters of A-Z, a-z, 0-9, -).')
  process.exit(1)
}
const hosts = process.argv.slice(2).length ? process.argv.slice(2) : ['gullylabs.xyz', 'docs.gullylabs.xyz', 'app.gullylabs.xyz', 'blog.gullylabs.xyz']

async function locs(url, depth = 0) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  const xml = await r.text()
  const found = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  if (/<sitemapindex/i.test(xml) && depth < 2) return (await Promise.all(found.map((u) => locs(u, depth + 1)))).flat()
  return found
}

for (const host of hosts) {
  try {
    const check = await fetch(`https://${host}/${key}.txt`, { signal: AbortSignal.timeout(15_000) })
    if (!check.ok || (await check.text()).trim() !== key) {
      console.log(`${host}: key file not served yet (HTTP ${check.status}); skipped`)
      continue
    }
    const urls = [...new Set((await locs(`https://${host}/sitemap.xml`)).filter((u) => new URL(u).host === host))]
    if (!urls.length) {
      console.log(`${host}: sitemap has no URLs; skipped`)
      continue
    }
    for (let i = 0; i < urls.length; i += 10_000) {
      const r = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls.slice(i, i + 10_000) }),
        signal: AbortSignal.timeout(30_000),
      })
      console.log(`${host}: ${urls.slice(i, i + 10_000).length} URLs -> IndexNow HTTP ${r.status}`)
    }
  } catch (e) {
    console.log(`${host}: failed: ${e.message}`)
  }
}
