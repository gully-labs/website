# Gully IPFS paid tiers: how the plumbing works and how to switch it on (OFF today)

No price exists. Nothing here is switched on. This is for the owner, when prices are decided.

## What is built

- Plans live in `server/plans.mjs`. The free tier ("Early access") reads server env: `IPFS_FREE_STORAGE_GB` (1),
  `IPFS_FREE_MAX_FILE_MB` (100), `IPFS_FREE_MAX_PINS` (500), `IPFS_FREE_TRANSFER_GB` (5, uploaded or pinned bytes a UTC
  month). Every page (hub, docs, `GET /api/plans`) reads those; nothing is typed in a page.
- Paid tiers come from `IPFS_PAID_PLANS_JSON`, for example
  `[{"id":"pro","name":"Pro","priceUsdPerGbMonth":0.05,"storageGb":100,"maxFileMb":1024,"maxPins":10000,"transferGb":500,"egressGb":500}]`.
  A tier with no price is dropped (there is no default price). One month costs `priceUsdPerGbMonth x storageGb`.
- Checkout opens only when `IPFS_PAID_ENABLED=1` AND at least one priced tier exists AND Gully Pay is configured
  (`GULLYPAY_STORE_ID`, `GULLYPAY_API_KEY`, `GULLYPAY_WEBHOOK_SIGNING_KEY`, the same store as the Holder Map checks, or
  a store of its own through the box's Gully Pay settings file).
- Buying: the hub's Plans panel calls `POST /api/developer/ipfs/subscribe { plan }`, which opens a Gully Pay hosted
  checkout (`clientReferenceId = ipfs:<nonce>:<plan>`). The tier unlocks only on a verified Gully Pay webhook
  `checkout.session.completed` for that session with the exact amount in USD, paid on a mainnet (cards only with
  `IPFS_ACCEPT_CARDS=1`). One payment buys 30 days; paying again before it ends adds 30 days. There is no
  auto-renewal and nothing is ever deleted when a month lapses: the account falls back to the free limits and new pins
  are refused while it is over them.
- Metering: storage (per CID, once), pin count, file size, monthly bytes uploaded or newly pinned (`usage.transferBytes`)
  and monthly gateway bytes (`usage.egressBytes`). Uploads and pins are refused with a reason at a limit.

## What is NOT built

- The gateway does not report traffic yet. `POST /api/ipfs/internal/egress` (Bearer `IPFS_SYNC_TOKEN`, body
  `{"bytesByCid":{"<cid>":<bytes>}}`) is ready to take a report from the edge, attributed to the accounts that hold the
  CID, but nothing sends one. Until an edge job (for example a Caddy log reader on the gully box) posts to it, the
  free tier has no gateway limit (`egressBytesMonth` is null) and a paid tier's `egressGb` meters at zero.
- Hard-throttling the gateway for an account over its traffic limit (needs per-owner routing, which a content
  addressed gateway does not have). Today over-limit means new uploads and pins are refused.
- Tax, invoices, refunds, annual plans and subscriptions (Gully Pay's subscription API exists; this uses one-time
  monthly checkouts so no price has to be committed to a recurring plan).

## To switch it on (owner)

1. Decide the free tier and the prices, with counsel for the Terms.
2. Set the env on the gully-web container: `IPFS_PAID_PLANS_JSON`, `IPFS_PAID_ENABLED=1`, Gully Pay settings, and
   make sure the Gully Pay store's webhook points at `https://gullylabs.xyz/api/gullypay/webhook`.
3. Restart gully-web. The hub shows the Plans panel; the docs plans table lists the tier.
4. Switch off again with `IPFS_PAID_ENABLED=0` (paid months already bought keep working only while the flag is on).
