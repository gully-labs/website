/* Swoop spot flags for gullylabs.xyz, docs.gullylabs.xyz and holdermaps.xyz (design/swoop-spots-2026-11-23/SPOT-RULES.md).
   enabled=false in production until the owner turns it on; testnet=true means house promos only (no Swoop tag, no sponsor).
   With enabled=false nothing else is requested. */
window.GULLY_SPOTS = { enabled: false, testnet: true, page: 'tool', promos: [], docsAllow: ['/*'], siteAllow: ['/tracker/*', '/holders/*'], promosUrl: '/spots/house-promos.json' }
