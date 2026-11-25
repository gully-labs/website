/* Swoop spot flags for gullylabs.xyz, docs.gullylabs.xyz and holdermaps.xyz (design/swoop-spots-2026-11-23/SPOT-RULES.md).
   testnet=true means house promos only, labelled "From Gully Labs · Demo" (no Swoop tag, no sponsor). House promos are on
   since 2026-11-25 (owner "go swoop"); Holder Map results are off (SPOT-RULES deny list: a token the visitor is judging); sponsor units (testnet=false) stay off until the owner decides. Kill switch: enabled=false. */
window.GULLY_SPOTS = { enabled: true, testnet: true, page: 'tool', promos: [], docsAllow: ['/*'], siteAllow: ['/tracker/*'], promosUrl: '/spots/house-promos.json',
  // Swoop house banners (2026-11-25): exact-size banners picked by the Swoop API for this surface (utm_source=website)
  house: { api: 'https://offers.kre8.fun', property: 'website', script: '/spots/spot-house.js' } }
