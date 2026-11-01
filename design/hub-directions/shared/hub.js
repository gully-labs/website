/*!
 * Gully Labs hub landing: content + live data layer shared by both design directions.
 * Content: the eight products, their layer in the suite, what is live / testnet / beta / building / coming soon
 * (each claim checked against the live product on 2026-10-27), the dated "What's new" and the studio services.
 * Data: every number comes from a real public endpoint, fetched through the preview server's /live/<name> proxy
 * (production: the same origins directly, all of them already answer the hub). A source that is down or has no data
 * yet gives { state: 'down' | 'empty', reason }, and the page says so; no number is ever invented.
 * Toasts fire only on real events seen between two polls (a new Gully ID sign-in, a quest completion, a new on-chain
 * trade or launch, a new holder map), never on page load.
 */
(function () {
  'use strict'
  var K = window.GullyCharts

  // ---------------------------------------------------------------- the suite, in story order
  var LAYERS = [
    { key: 'identity', n: '01', name: 'Identity', verb: 'Sign in', icon: 'fingerprint-pattern' },
    { key: 'payments', n: '02', name: 'Payments', verb: 'Pay', icon: 'credit-card' },
    { key: 'chain', n: '03', name: 'Chain', verb: 'Settle', icon: 'blocks' },
    { key: 'data', n: '04', name: 'Data & security', verb: 'See', icon: 'radar' },
    { key: 'play', n: '05', name: 'Games & AI', verb: 'Play', icon: 'gamepad-2' },
  ]

  // status: live | testnet | beta | building | soon     (labels are what the product itself says publicly)
  var PRODUCTS = [
    {
      key: 'id', name: 'Gully ID', domain: 'gullyid.xyz', url: 'https://gullyid.xyz', layer: 'identity', status: 'live', color: '#00D2FF',
      logo: '/shared/logos/labs.png', logoNote: 'Gully ID has no kit yet: Gully Labs icon',
      line: 'Passwordless sign-in for any app.',
      about: 'Passkeys, wallets (SIWE) and email codes over standard OpenID Connect, with per-app consent and slow, visible recovery. Free up to 1,000 monthly active users.',
      live: ['Passkey, wallet and email sign-in', 'Sign in with Gully SDK for any site', 'Developer console (gullyid.xyz/developers/console)', 'Used by the Gully Chain faucet, Gully Pay and Gully RPC'],
      next: ['Google and X sign-in (keys pending)'],
      links: [['Developers', 'https://gullyid.xyz/developers'], ['Console', 'https://gullyid.xyz/developers/console']],
    },
    {
      key: 'pay', name: 'Gully Pay', domain: 'gullypay.xyz', url: 'https://gullypay.xyz', layer: 'payments', status: 'live', color: '#3479FD',
      logo: '/shared/logos/pay.png',
      line: 'Checkout, payment links and x402 for merchants and AI agents.',
      about: 'Accept cards, Apple Pay and USDC on Base, Ethereum, BNB Chain, Solana and Gully Chain, and let AI agents pay your API over x402. On Gully Chain testnet it settles in USDC.e (bridged USDC).',
      live: ['Hosted checkout and payment links', 'Store plugins: WooCommerce, Magento 2, OpenCart 4, PrestaShop; Shopify connector (beta)', 'x402 facilitator on 6 networks incl. Gully Chain', 'USDC.e on Gully Chain testnet', 'Merchant review: KYB checks + Stripe Connect verification (new)', 'Creator tip pages at pay.gullypay.xyz (rolling out)'],
      next: ['Agent Wallets', 'One-tap passkey checkout', 'Pay with any token', 'Splits and escrow', 'Tap to pay', 'Non-custodial wallet', 'iOS and Android apps'],
      links: [['Docs', 'https://gullypay.xyz/docs'], ['x402 status', 'https://gullypay.xyz/x402/status']],
    },
    {
      key: 'chain', name: 'Gully Chain', domain: 'gullychain.xyz', url: 'https://gullychain.xyz', layer: 'chain', status: 'testnet', color: '#00B2FA',
      logo: '/shared/logos/chain.png',
      line: 'The social L3 where your profile is your wallet.',
      about: 'An Arbitrum Orbit L3 (testnet, chain 485590): one passkey, one .gully name, sponsored gas. Launch, swap, copy trades, run quests and bridge in a minute.',
      live: ['Gully Street app + social feed', 'Quests with on-chain rewards', 'Gully launchpad + Gully Swap', 'Bridge, faucet (Gully ID), explorer', 'Gully Safe and token lists', 'Contract verification (verify.gullychain.xyz)', 'Sentry Node Keys: testnet contracts'],
      next: ['Mainnet', 'Sentry Node Keys site'],
      links: [['App', 'https://app.gullychain.xyz'], ['Docs', 'https://docs.gullychain.xyz'], ['Verify', 'https://verify.gullychain.xyz']],
    },
    {
      key: 'rpc', name: 'Gully RPC', domain: 'gullyrpc.xyz', url: 'https://gullyrpc.xyz', layer: 'chain', status: 'beta', color: '#FF7300',
      logo: '/shared/logos/rpc.png',
      line: 'One API key for Gully Chain, Ethereum, Base and more.',
      about: 'Multi-chain RPC with failover, live usage per key and a free tier. Gully Chain is served from Gully nodes; other chains through a partner network while Gully nodes are built.',
      live: ['API keys (open sign-up, free tier)', 'Usage metering (beta)', '6 networks incl. Gully Chain', 'Keyless Gully Chain endpoint'],
      next: ['Archive + trace', 'Paid plans through Gully Pay', 'HyperEVM, X Layer, Ink, Unichain'],
      links: [['Portal', 'https://app.gullyrpc.xyz'], ['Status', 'https://gullyrpc.xyz/status']],
    },
    {
      key: 'holdermaps', name: 'HolderMaps', domain: 'holdermaps.xyz', url: 'https://holdermaps.xyz', layer: 'data', status: 'live', color: '#FFD52E',
      logo: '/shared/logos/holdermaps.png',
      line: 'Who really holds a token? Bubble maps, read live.',
      about: 'Map any token’s holders on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana: top wallets, linked clusters and launch health.',
      live: ['Any-token holder maps on 6 chains', 'Gully Chain maps', 'Replay, live updates, CSV export'],
      next: [],
      links: [['Open a map', 'https://holdermaps.xyz']],
    },
    {
      key: 'security', name: 'Gully Security', domain: 'gullysecurity.xyz', url: 'https://gullysecurity.xyz', layer: 'data', status: 'live', color: '#F2B232',
      logo: '/shared/logos/security.png',
      line: 'Review. Validate. Defend.',
      about: 'AI security scans of smart contracts on seven mainnets and Gully Chain, published reports, contract monitors and human Security Reviews. A scan is not an audit.',
      live: ['AI Security Scan', 'Published reports', 'Gully Score + contract monitors'],
      next: ['Security Review by people: quoted on request'],
      links: [['Scan a contract', 'https://gullysecurity.xyz']],
    },
    {
      key: 'studio', name: 'Gully Studio', domain: 'gullystudio.xyz', url: 'https://gullystudio.xyz', layer: 'play', status: 'live', color: '#1E8BFF',
      logo: '/shared/logos/studio.png',
      line: 'Unity 3D games with Gully ID, Gully Pay and Gully Chain inside.',
      about: 'The Gully Labs game studio: Unity 6 games with Gully ID sign-in, Gully Pay purchases, and scores, quests and prizes on Gully Chain.',
      live: ['Frog Hop (testnet)', 'Open-source Gully Game SDK', 'Developer portal + docs', 'Offerwall contracts on testnet'],
      next: ['More games'],
      links: [['Dev portal', 'https://dev.gullystudio.xyz'], ['Docs', 'https://docs.gullystudio.xyz']],
    },
    {
      key: 'ai', name: 'Gully AI', domain: 'gullyai.xyz', url: 'https://gullyai.xyz', layer: 'play', status: 'soon', color: '#00F0F2',
      logo: '/shared/logos/ai.png',
      line: 'Open-weight LLM API, coming online.',
      about: 'Qwen3.6-27B open weights served by vLLM behind an OpenAI-compatible API, with per-product keys, rate limits and token metering. The site is up; the API comes online when its GPU box does.',
      live: ['Site and docs'],
      next: ['OpenAI-compatible API (GPU box pending)', '131K context, tool calling, reasoning'],
      links: [['Docs', 'https://gullyai.xyz/docs/']],
    },
  ]
  var STATUS = { live: 'Live', testnet: 'Testnet', beta: 'Open beta', building: 'Building', soon: 'Coming online' }

  // Hub uptime services that belong to each product (keys of /api/hub services)
  var SERVICE_KEYS = {
    id: [], pay: ['pay', 'x402', 'pay-admin'], chain: ['chain-site', 'street', 'explorer', 'faucet', 'bridge', 'indexer', 'rpc-public', 'safe', 'copy', 'docs', 'devportal'],
    rpc: ['rpc-site', 'rpc-app', 'rpc-gateway'], holdermaps: ['holders'], security: ['security'], studio: ['studio', 'studio-dev', 'studio-docs'], ai: ['gullyai', 'ai-api'],
  }

  // ---------------------------------------------------------------- What's new (dated; each item checked live or on main)
  var NEWS = [
    { d: '2026-10-27', p: 'id', t: 'Gully ID moves to gullyid.xyz, with a developer console', s: 'live', href: 'https://gullyid.xyz/developers' },
    { d: '2026-10-27', p: 'chain', t: 'Contract verification for Gully Chain: self-hosted Sourcify, 218 contracts verified', s: 'live', href: 'https://verify.gullychain.xyz' },
    { d: '2026-10-27', p: 'rpc', t: 'Keyless Gully Chain endpoint on the gateway: rpc.gullyrpc.xyz/gullychain/evm/485590', s: 'live', href: 'https://gullyrpc.xyz' },
    { d: '2026-10-27', p: 'pay', t: 'Merchant review: KYB application, automated checks and Stripe Connect verification', s: 'new', href: 'https://gullypay.xyz' },
    { d: '2026-10-27', p: 'pay', t: 'Creator tip pages at pay.gullypay.xyz/<username>', s: 'rolling out', href: 'https://gullypay.xyz' },
    { d: '2026-10-27', p: 'chain', t: 'Faucet drain protection: Gully ID sign-in, budgets and limits', s: 'live', href: 'https://faucet.gullychain.xyz' },
    { d: '2026-10-27', p: 'chain', t: 'Gully Chain token lists 2.0.1 (default + extended) on gullychain.xyz', s: 'live', href: 'https://gullychain.xyz/tokenlist.json' },
    { d: '2026-10-27', p: 'chain', t: 'Sentry Node Keys: testnet contracts deployed (free tier only, sale closed)', s: 'testnet', href: 'https://docs.gullychain.xyz' },
    { d: '2026-10-27', p: 'studio', t: 'Gully Offerwall contracts on Gully Chain testnet', s: 'testnet', href: 'https://docs.gullystudio.xyz' },
    { d: '2026-10-26', p: 'chain', t: 'Gully Quests on testnet: on-chain quests with ETH rewards', s: 'testnet', href: 'https://app.gullychain.xyz/quests' },
    { d: '2026-10-26', p: 'pay', t: 'Magento 2 and OpenCart 4 plugins, Shopify connector (beta), WooCommerce 1.1', s: 'live', href: 'https://gullypay.xyz' },
    { d: '2026-10-26', p: 'holdermaps', t: 'HolderMaps on its own domain, with Gully Chain maps', s: 'live', href: 'https://holdermaps.xyz' },
    { d: '2026-10-26', p: 'rpc', t: 'Gully RPC: open sign-up, free tier, live gateway metrics', s: 'beta', href: 'https://gullyrpc.xyz' },
    { d: '2026-10-25', p: 'rpc', t: 'Gully Chain testnet served on the Gully RPC gateway (alias gully-testnet)', s: 'live', href: 'https://gullyrpc.xyz' },
  ]

  var SERVICES = [
    { icon: 'file-code-2', name: 'Smart contracts', time: '6–12 weeks', d: 'Solidity and Rust contracts designed, tested and deployed.', type: 'Smart contracts' },
    { icon: 'monitor-smartphone', name: 'dApps & frontends', time: '8–16 weeks', d: 'Wallet-connected web and mobile apps people can use.', type: 'dApp / frontend' },
    { icon: 'server', name: 'Chain infrastructure', time: '8–20 weeks', d: 'Nodes, L3s, bridges and the plumbing underneath.', type: 'Infrastructure' },
    { icon: 'shield-check', name: 'Security', time: 'Quoted', d: 'Scans, reviews and monitors. A scan is not an audit.', type: 'Security' },
  ]
  var STEPS = [
    { icon: 'compass', name: 'Discover', d: 'Scope the product, the chain and the token model.' },
    { icon: 'flask-conical', name: 'Prototype', d: 'A working testnet build in weeks, not quarters.' },
    { icon: 'shield-check', name: 'Build & test', d: 'Production contracts and apps, tested before launch.' },
    { icon: 'rocket', name: 'Launch', d: 'Mainnet release, monitoring and ongoing support.' },
  ]
  var TYPES = ['Smart contracts', 'dApp / frontend', 'Infrastructure', 'Security', 'Other']
  var BUDGETS = ['< $50k', '$50–150k', '$150k+', 'Not sure']

  // ---------------------------------------------------------------- live sources
  var SOURCES = {
    hub: { url: '/live/hub', name: 'gullylabs.xyz/api/hub' },
    products: { url: '/live/products', name: 'gullylabs.xyz/api/hub/products' },
    stats: { url: '/live/stats', name: 'gullylabs.xyz/api/stats' },
    id: { url: '/live/id', name: 'gullyid.xyz/v1/stats/public' },
    pay: { url: '/live/pay', name: 'gullypay.xyz/api/status' },
    x402: { url: '/live/x402', name: 'gullypay.xyz/x402/status' },
    rpc: { url: '/live/rpc', name: 'gullyrpc.xyz/status.json' },
    head: { url: '/live/head', name: 'indexer.gullychain.xyz/head' },
    feed: { url: '/live/feed', name: 'indexer.gullychain.xyz/feed' },
  }
  function get(key) {
    var s = SOURCES[key]
    return K.json(s.url, { timeout: 14000 }).then(function (d) { return { state: 'ok', data: d, source: s.name } }, function (e) { return { state: 'down', reason: s.name + ' unreachable', source: s.name } })
  }
  /** fetch every source; onPartial(all) runs as each one lands (sources still in flight keep their last reading,
   *  or { state: 'wait' } on the first load), so the page fills in progressively. Resolves with the full set. */
  var last = null
  function loadAll(onPartial) {
    var keys = Object.keys(SOURCES), o = { at: new Date() }
    keys.forEach(function (k) { o[k] = last && last[k] ? last[k] : { state: 'wait', reason: 'Loading…', source: SOURCES[k].name } })
    return Promise.all(keys.map(function (k) { return get(k).then(function (r) { o[k] = r; o.at = new Date(); if (onPartial) onPartial(o) }) })).then(function () { last = o; return o })
  }

  // ---------------------------------------------------------------- per-product live readings
  // Each: { up: true|false|null, state: 'up'|'down'|'coming'|'unknown', kpi: { v, unit, label } | null, why, series: { kind, vals, xs, name, unit } | null, extra: [[label, value]], source }
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null }
  function hourLabel(t) { var d = new Date(typeof t === 'number' ? t * 1000 : t); return ('0' + d.getUTCHours()).slice(-2) + ':00' }
  function dayLabel(s) { var d = new Date(s + (String(s).length === 10 ? 'T00:00:00Z' : '')); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }
  function services(all, key) {
    var hub = all.hub.state === 'ok' ? all.hub.data.services || [] : []
    return hub.filter(function (s) { return SERVICE_KEYS[key].indexOf(s.key) >= 0 })
  }
  function latency(svc) { return svc ? (svc.history || []).map(function (h) { return { v: h.ms, x: new Date(h.t).toISOString().slice(11, 16) + ' UTC' } }).filter(function (r) { return num(r.v) != null }) : [] }
  function upState(svcs) { if (!svcs.length) return null; var real = svcs.filter(function (s) { return s.state !== 'coming' }); if (!real.length) return null; return real.every(function (s) { return s.up }) }

  function reading(all, key) {
    var svcs = services(all, key), up = upState(svcs), r = { up: up, state: up == null ? 'unknown' : up ? 'up' : 'down', kpi: null, series: null, extra: [], services: svcs }
    var hub = all.hub.state === 'ok' ? all.hub.data : null, prod = all.products.state === 'ok' ? all.products.data : null
    if (key === 'id') {
      if (all.id.state !== 'ok') { r.why = all.id.state === 'wait' ? 'Loading…' : 'Gully ID stats offline'; r.state = all.id.state === 'wait' ? 'unknown' : 'down'; return r }
      var d = all.id.data; r.up = true; r.state = 'up'; r.source = SOURCES.id.name
      r.kpi = { v: num(d.signins24h), label: 'sign-ins, last 24 h' }
      r.series = { kind: 'bars', name: 'Gully ID sign-ins per hour (UTC)', unit: 'sign-ins', rows: (d.hourly || []).map(function (h) { return { v: h.n, x: hourLabel(h.hour) } }) }
      r.extra = [['Accounts', d.totals && d.totals.users], ['Passkeys', d.totals && d.totals.passkeys], ['Apps signed into, 30 d', d.appsActive30d]]
      r.mix = d.methods30d
    } else if (key === 'pay') {
      r.source = SOURCES.pay.name
      if (all.pay.state === 'ok') { var ss = all.pay.data.services || {}, names = Object.keys(ss), ok = names.filter(function (n) { return ss[n] === 'operational' }).length; r.kpi = { v: ok, of: names.length, label: 'services operational' }; r.payServices = ss; if (r.up == null) { r.up = ok === names.length; r.state = r.up ? 'up' : 'down' } }
      var px = svcs.filter(function (s) { return s.key === 'pay' })[0]
      r.series = { kind: 'line', name: 'gullypay.xyz response time', unit: 'ms', rows: latency(px) }
      if (all.x402.state === 'ok') r.extra.push(['x402 networks', (all.x402.data.supportedNetworks || []).length]), r.extra.push(['x402 assets', (all.x402.data.supportedAssets || []).join(' · ')])
    } else if (key === 'chain') {
      r.source = SOURCES.head.name + ' + ' + SOURCES.products.name
      var head = all.head.state === 'ok' ? num(all.head.data.block) : hub && hub.chain ? num(hub.chain.head) : null
      r.kpi = { v: head, label: 'latest block, chain 485590', mono: true }
      if (prod && prod.chain) r.series = { kind: 'bars', name: 'Gully Chain transactions per hour (UTC)', unit: 'txs', rows: prod.chain.hourly.map(function (h) { return { v: h.txs, x: hourLabel(h.t) } }) }
      if (hub && hub.quests) r.extra.push(['Quest completions, 24 h', hub.quests.completions24h], ['Active quests', hub.quests.active])
      if (prod && prod.activity) { var a = prod.activity.hourly.reduce(function (s, h) { return { l: s.l + h.launches, t: s.t + h.trades, w: s.w + h.swaps } }, { l: 0, t: 0, w: 0 }); r.extra.push(['Launches · trades · swaps, 24 h', a.l + ' · ' + a.t + ' · ' + a.w]) }
      if (head == null && !r.series) r.why = 'Indexer offline'
    } else if (key === 'rpc') {
      r.source = SOURCES.hub.name
      if (hub && hub.gateway) { r.kpi = { v: hub.gateway.ok, of: hub.gateway.total, label: 'gateway networks OK' }; r.networks = hub.gateway.networks }
      r.series = { kind: 'line', name: 'rpc.gullyrpc.xyz response time', unit: 'ms', rows: latency(svcs.filter(function (s) { return s.key === 'rpc-gateway' })[0]) }
      if (all.rpc.state === 'ok') { var f = all.rpc.data.features || []; r.extra.push(['Live features', f.filter(function (x) { return x.status === 'live' }).map(function (x) { return x.name }).join(', ') || '–']) }
    } else if (key === 'holdermaps') {
      r.source = SOURCES.products.name
      if (prod && prod.holders) { r.kpi = { v: num(prod.holders.today), label: 'holder maps opened today' }; r.series = { kind: 'bars', name: 'Holder maps opened per day', unit: 'maps', rows: prod.holders.daily.map(function (h) { return { v: h.maps, x: dayLabel(h.day) } }) }; r.extra.push(['Tokens mapped today', prod.holders.tokens]); r.top = prod.holders.top }
    } else if (key === 'security') {
      r.source = SOURCES.products.name
      if (prod && prod.security) { var tot = prod.security.daily.reduce(function (s, h) { return s + h.scans }, 0); r.kpi = { v: tot, label: 'scans in the last ' + prod.security.daily.length + ' days' }; r.series = { kind: 'bars', name: 'Security scans per day', unit: 'scans', rows: prod.security.daily.map(function (h) { return { v: h.scans, x: dayLabel(h.day) } }) }; r.extra.push(['Published reports', prod.security.published]) }
    } else if (key === 'studio') {
      r.source = SOURCES.hub.name
      if (hub && hub.quests) {
        var fq = (hub.quests.quests || []).filter(function (q) { return /frog hop/i.test(q.title) })
        var fr = (hub.quests.recent || []).filter(function (q) { return /frog hop/i.test(q.title) })[0]
        if (fq.length) r.kpi = { v: fq.reduce(function (s, q) { return s + (q.completions || 0) }, 0), label: 'Frog Hop quest completions (testnet)' }
        else if (fr) { r.why = 'Last Frog Hop quest win ' + ago(fr.at); r.lastPlay = fr }
        else r.why = 'No Frog Hop quest runs in the feed yet'
      }
      r.series = { kind: 'line', name: 'gullystudio.xyz response time', unit: 'ms', rows: latency(svcs.filter(function (s) { return s.key === 'studio' })[0]) }
    } else if (key === 'ai') {
      r.source = SOURCES.hub.name
      var api = svcs.filter(function (s) { return s.key === 'ai-api' })[0]; var site = svcs.filter(function (s) { return s.key === 'gullyai' })[0]
      r.state = 'coming'; r.up = site ? site.up : null
      r.kpi = null; r.why = api && api.state === 'coming' ? 'API coming online: GPU box pending' : 'API not reporting yet'
      r.series = { kind: 'line', name: 'gullyai.xyz response time', unit: 'ms', rows: latency(site) }
    }
    if (r.kpi && r.kpi.v == null) { r.why = r.why || 'No data yet'; r.kpi = null }
    return r
  }

  // suite-wide numbers
  function suite(all) {
    var hub = all.hub.state === 'ok' ? all.hub.data : null
    var o = {}
    if (hub) {
      var svcs = (hub.services || []).filter(function (s) { return s.state !== 'coming' })
      o.servicesUp = svcs.filter(function (s) { return s.up }).length; o.servicesTotal = svcs.length
      if (hub.statusPage) { o.checksUp = hub.statusPage.up; o.checksTotal = hub.statusPage.total; o.checksDown = (hub.statusPage.services || []).filter(function (s) { return s.state !== 'up' }) }
      o.quests = hub.quests
    }
    if (all.stats.state === 'ok') { var t = all.stats.data.totals || {}; o.tvl = t.tvlUsd; o.volumeAll = t.volumeAllUsd; o.feesAll = t.feesAllUsd; o.venues = (all.stats.data.venues || []).map(function (v) { return v.key }) }
    return o
  }

  // latest real events across the suite, newest first (for the live line in What's new)
  function liveEvents(all) {
    var ev = []
    if (all.hub.state === 'ok' && all.hub.data.quests) (all.hub.data.quests.recent || []).forEach(function (q) { ev.push({ at: q.at, p: 'chain', t: 'Quest completed: ' + q.title, who: q.who }) })
    if (all.id.state === 'ok') (all.id.data.recent || []).slice(0, 5).forEach(function (s) { ev.push({ at: s.at, p: 'id', t: 'Gully ID sign-in with ' + ({ passkey: 'a passkey', wallet: 'a wallet', email: 'an email code', social: 'Google / X' }[s.method] || s.method) }) })
    if (all.feed.state === 'ok') (all.feed.data.items || []).slice(0, 6).forEach(function (f) { var kind = { trade: 'Trade', launch: 'Token launch', swap: 'Swap', wrap: 'ETH wrapped', unwrap: 'ETH unwrapped', transfer: 'Transfer' }[f.kind] || f.kind; ev.push({ at: new Date(Number(f.timestamp) * 1000).toISOString(), p: 'chain', t: kind + ' on Gully Chain, block ' + f.block, href: 'https://testnet-explorer.gullychain.xyz/tx/' + f.txHash }) })
    return ev.sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at) }).slice(0, 8)
  }

  // ---------------------------------------------------------------- real-event toasts
  function eventWatcher(toast) {
    var seen = null
    return function (all) {
      var now = {
        quest: all.hub.state === 'ok' && all.hub.data.quests ? all.hub.data.quests.completions : null,
        idAt: all.id.state === 'ok' && all.id.data.recent && all.id.data.recent[0] ? Date.parse(all.id.data.recent[0].at) : null,
        idMethod: all.id.state === 'ok' && all.id.data.recent && all.id.data.recent[0] ? all.id.data.recent[0].method : null,
        feedId: all.feed.state === 'ok' && all.feed.data.items && all.feed.data.items[0] ? all.feed.data.items[0].id : null,
        feedKind: all.feed.state === 'ok' && all.feed.data.items && all.feed.data.items[0] ? all.feed.data.items[0].kind : null,
        maps: all.products.state === 'ok' && all.products.data.holders ? all.products.data.holders.today : null,
      }
      if (seen) {
        if (now.quest != null && seen.quest != null && now.quest > seen.quest) toast('Quest completed', (now.quest - seen.quest) + ' new completion' + (now.quest - seen.quest > 1 ? 's' : '') + ' on Gully Chain', 'trophy')
        if (now.idAt && seen.idAt && now.idAt > seen.idAt) toast('New Gully ID sign-in', 'Signed in with ' + now.idMethod, 'fingerprint-pattern')
        if (now.feedId && seen.feedId && now.feedId !== seen.feedId) toast('New on Gully Chain', 'A ' + now.feedKind + ' just landed on chain 485590', 'blocks')
        if (now.maps != null && seen.maps != null && now.maps > seen.maps) toast('Holder map opened', (now.maps - seen.maps) + ' new on HolderMaps today', 'bubbles')
      }
      seen = now
    }
  }

  // ---------------------------------------------------------------- UI helpers
  function icon(name, cls) { return '<svg class="' + (cls || 't-ic') + '" aria-hidden="true"><use href="/shared/icons.svg#i-' + name + '"/></svg>' }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  /** links to another site open in a new tab (owner rule) */
  function ext(href, label, cls, inner) { return '<a class="' + (cls || '') + '" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + (inner || esc(label)) + '<span class="t-sr"> (opens in a new tab)</span></a>' }
  var toastBox = null
  function toast(title, text, ic) {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 't-toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.appendChild(toastBox) }
    var t = document.createElement('div'); t.className = 't-toast'
    t.innerHTML = icon(ic || 'activity') + '<div><b></b><span></span></div><button class="t-btn t-btn--xs t-btn--quiet" aria-label="Dismiss">' + icon('x') + '</button>'
    t.querySelector('b').textContent = title; t.querySelector('span').textContent = text
    t.querySelector('button').onclick = function () { t.remove() }
    toastBox.appendChild(t); while (toastBox.children.length > 3) toastBox.firstChild.remove()
    setTimeout(function () { t.remove() }, 7000)
  }
  function ago(iso) { var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago' }
  function fmtDate(d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
  /** tabs: [role=tablist] with [role=tab][aria-controls]; arrows move; optional hash sync */
  function tabs(list, onShow) {
    var bs = Array.prototype.slice.call(list.querySelectorAll('[role=tab]'))
    function show(b, focus) {
      bs.forEach(function (x) { var on = x === b; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; var p = document.getElementById(x.getAttribute('aria-controls')); if (p) p.hidden = !on })
      if (focus) b.focus(); if (onShow) onShow(b.getAttribute('aria-controls'), b)
    }
    bs.forEach(function (b, i) {
      b.addEventListener('click', function () { show(b) })
      b.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { e.preventDefault(); show(bs[(i + d + bs.length) % bs.length], true) } })
    })
    var byHash = bs.filter(function (b) { return '#' + b.getAttribute('aria-controls') === location.hash || '#' + b.dataset.hash === location.hash })[0]
    show(byHash || bs[0])
    return { show: function (id) { var b = bs.filter(function (x) { return x.getAttribute('aria-controls') === id })[0]; if (b) show(b) } }
  }
  /** stepper: root holds [data-go] heads and [data-step] panes, plus [data-prev]/[data-next] */
  function stepper(root) {
    var steps = Array.prototype.slice.call(root.querySelectorAll('[data-step]')), heads = Array.prototype.slice.call(root.querySelectorAll('[data-go]')), cur = 0
    function go(i) {
      cur = Math.max(0, Math.min(steps.length - 1, i))
      steps.forEach(function (s, j) { s.hidden = j !== cur })
      heads.forEach(function (h, j) { h.classList.toggle('is-on', j === cur); h.classList.toggle('is-done', j < cur); h.setAttribute('aria-current', j === cur ? 'step' : 'false') })
      var p = root.querySelector('[data-prev]'), n = root.querySelector('[data-next]'); if (p) p.disabled = cur === 0; if (n) n.disabled = cur === steps.length - 1
    }
    heads.forEach(function (h, j) { h.addEventListener('click', function () { go(j) }) })
    var p = root.querySelector('[data-prev]'), n = root.querySelector('[data-next]')
    if (p) p.addEventListener('click', function () { go(cur - 1) }); if (n) n.addEventListener('click', function () { go(cur + 1) })
    go(0); return { go: go }
  }
  /** the contact form (POST /api/contact, the same contract as gullylabs.xyz) */
  function contactForm(form) {
    var types = form.querySelector('[data-types]'), budgets = form.querySelector('[data-budgets]'), msg = form.querySelector('[data-msg]'), picked = [], budget = ''
    types.innerHTML = TYPES.map(function (t) { return '<button type="button" class="chip" aria-pressed="false" data-v="' + esc(t) + '">' + esc(t) + '</button>' }).join('')
    budgets.innerHTML = BUDGETS.map(function (t) { return '<button type="button" class="chip" aria-pressed="false" data-v="' + esc(t) + '">' + esc(t) + '</button>' }).join('')
    types.addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; var v = b.dataset.v, on = picked.indexOf(v) < 0; picked = on ? picked.concat(v) : picked.filter(function (x) { return x !== v }); b.setAttribute('aria-pressed', on) })
    budgets.addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; budget = b.dataset.v; Array.prototype.forEach.call(budgets.children, function (x) { x.setAttribute('aria-pressed', x === b) }) })
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var f = new FormData(form), email = String(f.get('email') || '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Add an email so we can reply.'; return }
      if (!picked.length) { msg.textContent = 'Pick at least one thing you need.'; return }
      var btn = form.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = 'Sending…'
      fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.get('name') || '', email: email, message: f.get('message') || '', types: picked, budget: budget, website: f.get('website') || '' }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || 'HTTP ' + r.status); return d }) })
        .then(function (d) { form.reset(); msg.textContent = d.preview ? 'Preview: the form works, nothing was sent (set CONTACT_LIVE=1 to send).' : 'Sent. We reply within one working day.'; toast('Message sent', d.preview ? 'Preview mode: not delivered' : 'We reply within one working day', 'send') })
        .catch(function (err) { msg.textContent = (err && err.message && !/^HTTP/.test(err.message) ? err.message : 'Could not send. Write to us on Telegram: t.me/GullyChain') })
        .then(function () { btn.disabled = false })
    })
  }
  function prefill(form, type) { var b = form.querySelector('[data-types] .chip[data-v="' + type + '"]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click() }

  window.GullyHub = {
    LAYERS: LAYERS, PRODUCTS: PRODUCTS, STATUS: STATUS, NEWS: NEWS, SERVICES: SERVICES, STEPS: STEPS, SOURCES: SOURCES,
    loadAll: loadAll, reading: reading, suite: suite, liveEvents: liveEvents, eventWatcher: eventWatcher,
    icon: icon, esc: esc, ext: ext, toast: toast, ago: ago, fmtDate: fmtDate, tabs: tabs, stepper: stepper, contactForm: contactForm, prefill: prefill,
    product: function (k) { return PRODUCTS.filter(function (p) { return p.key === k })[0] },
  }
})()
