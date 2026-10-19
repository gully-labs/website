# Launchpad integration: the Holder Map for your launchpad

For launchpads and token platforms that want the Gully Labs Holder Map (who holds a token, how the biggest wallets are
connected, launch checks) on their own pages, and want their launches recognised by it.

Public docs for the embed and the API: `https://docs.gullylabs.xyz/holder-map-integrate`.
Contact: hello@gullylabs.xyz.

## What we need from you

One of the two lookup types below, per chain you launch on.

Chains the Holder Map supports (keys used in the registry and in URLs): `robinhood` (Robinhood Chain, 4663),
`bsc` (BNB Chain, 56), `base` (Base, 8453), `hyperevm` (HyperEVM, 999). Solana is mapped but not part of the launchpad
registry yet.

### Always

- Your name and website (https).
- The chains you launch on.
- Optional, per chain: the address of the pool or pool manager that holds a launch's liquidity, so it can be labelled
  as a pool on the map instead of counted as a wallet.

### Option A: a token API (`lookup: 'api'`)

A public HTTPS endpoint that answers "is this address one of your launches?" for a chain and token:

- A URL we can fill in with the chain id and the lowercase token address, for example
  `https://api.yourpad.example/v1/tokens/{chainId}/{token}` (or one host per chain).
- `404` when the token is not yours. `200` with JSON otherwise.
- In the JSON: the chain id, the token address, and the creator address. Ideally also the creation block number; if
  you do not publish it we find the block ourselves on an archive node.
- If your API also returns non-launch tokens (for example tracked or listed tokens), a field that tells launches
  apart (we match one field to one value, such as `kind == "LAUNCH"`).
- Optional: an endpoint that gives the main pool address of a token.
- Reasonable limits: we call it at most 120 times a minute in total, 6 second timeout, results cached for a day.

### Option B: a factory event (`lookup: 'factory-event'`)

- Per chain, the address of the factory (or hook) contract that emits an event when a token is created.
- The event signature, for example `TokenCreated(address,address,uint256)`.
- Where the token address sits in it (which indexed topic, 1 to 3) and where the creator address sits (an indexed
  topic, or a data word number).
- We never guess these. We only use addresses that come from you or from your published deployments.

Both options can be combined: an API entry may also carry the factory event as a fallback for when your API is down.

## What you get

- **The embed**: one tag shows the Holder Map on any page of yours.

  ```html
  <div data-gully-widget="holders" data-chain="base" data-token="0x…" data-height="640"></div>
  <script src="https://gullylabs.xyz/widget.js" async></script>
  ```

  It frames `https://gullylabs.xyz/embed/holders/:chain/:token`, which can also be framed directly. `data-chain` is one of
  `robinhood|bsc|base|hyperevm|solana`; `data-height` is 360 to 2000 (default 760). A "Powered by Gully Labs" credit
  shows on the free embed.
- **The badge**: `GET https://gullylabs.xyz/api/holders/:chain/:token/card.png` is a 1200 x 630 share card that shows a
  token's holder picture; use it as an image link or as `og:image`. It leads to `https://gullylabs.xyz/holders/:chain/:token`.
- **The API**: `GET https://gullylabs.xyz/api/holders/:chain/:token` returns the whole map as JSON (CORS open). No key
  needed; a key raises the rate limit.
- **The SDK**: `@gullylabs/holders` (in the `gully-sdk` repo; not published yet) has a typed client
  (`createHoldersClient({ baseUrl, apiKey? })` with `getMap(chain, token)` and `cardUrl(chain, token)`) and a React
  `<HolderMap chain token height />` component that frames the embed.
- **Recognition**: once your entry is in the registry, `knownLaunch(chain, token)` recognises your launches by chain and token and returns the creator,
  creation block and pool for the Holder Map to use.

## For us: adding the entry

The registry is the `LAUNCHPADS` array in `server/holders-launchpads.mjs`. Adding a launchpad is adding one object;
`validateLaunchpad()` checks every entry when the module loads (a bad entry throws, so run the test first) and
`listLaunchpads()` exposes only `{ id, name, url, chains }` publicly.

```js
// lookup 'api'
{
  id: 'examplepad',                       // 2-32 chars of a-z 0-9 -; becomes `venue` in knownLaunch()
  name: 'ExamplePad',
  url: 'https://examplepad.example',
  lookup: 'api',
  api: {
    base: 'https://api.examplepad.example',   // chain.api overrides it per chain; baseEnv names an env override
    path: '/v1/tokens/{chainId}/{token}',     // 404 = not a launch of theirs
    okField: 'success',                       // optional: truthy field required, else the API counts as down
    root: 'data',                             // optional: where the launch object sits
    require: { field: 'kind', equals: 'LAUNCH' },
    fields: { chainId: 'chainId', address: 'address', creator: 'creatorAddress', block: 'blockNumber' },
    pool: { path: '/v1/pool/{token}', field: 'pool.address' },   // optional
  },
  chains: { base: { chainId: 8453 } },
}

// lookup 'factory-event'
{
  id: 'otherpad',
  name: 'OtherPad',
  url: 'https://otherpad.example',
  lookup: 'factory-event',
  event: {
    signature: 'TokenCreated(address,address,uint256)',
    topic0: '0x…',                          // keccak256 of the signature, 32 bytes, lowercase hex
    token: { topic: 1 },                    // indexed topic holding the token
    creator: { topic: 2 },                  // or { word: 0 } for a data word
  },
  chains: { base: { chainId: 8453, factory: '0x…', pool: '0x…' } },   // factory from the partner; pool optional
}
```

Steps:

1. Get the details above from the partner. Never fill in an address ourselves.
2. Add the entry to `LAUNCHPADS`. Check the chain ids against `HOLDER_CHAINS` in `server/holders.mjs`.
3. Add or extend a case in `scripts/test-launchpads.mjs` (it has a fake entry of each lookup type to copy), then run
   `npm run test:launchpads`.
4. Check against a real launch from the partner on the staging server (`knownLaunch(chain, token)` returns
   `{ venue, chainId, token, creationBlock, deployer, pool? }`), then ship it with the normal deploy.

Built-in entries for reference (addresses come from the venues' own deployments, listed in `server/holders-launchpads.mjs`):

| id | lookup | chains |
| --- | --- | --- |
| `peddles` | api, with the PeddlesFeeHook `PoolRegistered` event as the API-down fallback | robinhood, base, bsc |
| `peddleswap` | api (one host per chain) | robinhood, base |
