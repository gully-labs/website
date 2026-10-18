# Gully Labs: Arbitrum ecosystem pitch

Prepared 2026-10-17. The program facts come from the Arbitrum Foundation's blog, forum and grants pages, read
that day (sources in [Links](#links)). The metrics were read from our live API the same day. Re-check both
before submitting: the Foundation's grants page has stale status labels, and our numbers move.

## The one-paragraph pitch

Gully Labs builds the developer and operator tooling around Arbitrum chains, and runs it in production. The
products are:

- **The gap tracker.** It prices every tokenised stock on **Robinhood Chain**, an Arbitrum Orbit chain, and on
  BNB Chain against its Chainlink fair value, every few minutes, read on chain. It is served as a free public
  API, a TypeScript SDK, an embeddable widget and Telegram and webhook gap alerts.
- **Chain Kit.** Our branded Blockscout explorer, with an Arbitrum/Orbit chain profile.
- **Gully Pay.** Crypto invoices and reusable pay links that settle in USDC or ETH on **Arbitrum One**,
  among other chains, checked on chain with no custodian.
- **Gully Analytics.** Web analytics that see the wallet.
- **Gully AI.** Answers questions about our products with sources, and indexes our forks of the Orbit and
  Stylus tooling.
- **The @GullyLabsBot Telegram bot.** It also carries DeepCore launch alerts.

Next we are launching **Gully Chains**: managed Orbit L3s, starting with a public **Gully Devnet** on Arbitrum
Sepolia with a Chain Kit explorer, a faucet and a bridge, then the **Gully L3** settling to Arbitrum One with
**Hyperlane** as its interop layer (Warp Routes for USDC and ETH from Arbitrum One, our own validator and relayer).
The consolidated spec is `ops/l3/SPEC.md`; the public summary is docs.gullylabs.xyz/roadmap-l3. The stack for it
is already forked and indexed:

- `arbitrum-orbit-deployment-ui`
- `orbit-setup-script`
- `orbit-monitoring-tools`
- `arbitrum-token-bridge`
- `stylus-sdk-rs`

We are asking the Arbitrum ecosystem for three things:

- visibility, to put the tracker and pay links in front of Arbitrum builders;
- gas sponsorship, to make Arbitrum One payments gasless;
- security support, for the L3 launch.

In return, every Orbit chain we launch arrives with an explorer, analytics, payments and alerts on day one.

## Which program fits, and why

The programs as of 2026-10-17:

| Program | Status | Fit for us | Verdict |
|---|---|---|---|
| **Arbitrum Builders form** ([tally.so/r/0QObE9](https://tally.so/r/0QObE9)) | Open, rolling, no deadline | The Foundation's general intake. One form, with checkboxes for audit, ArbiFuel, marketing or visibility, investment and mentorship or GTM. It routes us to whichever program fits. | **Recommended: submit first** |
| **ArbiFuel** gas sponsorship ([apply](https://airtable.com/appzb4GfqGfrnDXjW/shrulGIIp6l6ezAlt)) | Listed "Active", rolling, no deadline (not confirmed beyond the label) | Up to 1M sponsored transactions in year one, capped at $10K in credits, through Pimlico ERC-20 paymasters. It targets payment apps and stablecoin products, which is exactly Gully Pay on Arbitrum One. It asks for Arbitrum promotion (X, bio, in-app banner). | **Apply alongside** (also ticked on the Builders form) |
| **Arbitrum Security Program (ASP)** ([apply](https://tally.so/r/3xzEzv?program=aap)) | Open since 2026-09-29, rolling for 12 months (to about end of Sept 2027) | It subsidises part of a first audit. It is eligible for projects launching their own Arbitrum Chain or new features. It fits the Gully Devnet / Gully Chains contracts **once a contract scope exists**. Terms: a Commitment Agreement (possibly exclusivity), public acknowledgement, and probably ≥ 1 year of runway plus a co-pay. | **Apply later**, at milestone M3 (below) |
| Arbitrum D.A.O. Grant Program (Questbook, Domain Allocators) | **Closed** to new proposals since 2026-03-17. Only milestone reviews for existing grantees. Season 4 not announced. | It would be the best cash fit: the *Dev Tooling on One and Stylus* and *Orbit Chains* domains, up to $25K (one Domain Allocator) or $50K (two). | **Watch.** The ask below is written to drop straight in if Season 4 opens. |
| Arbitrum Foundation Grant Program | "Applications will open soon", no date | General grants. | Watch |
| Trailblazer 1.0 / 2.0 (AI agents) | **Closed**: both rounds complete, no 2026 round found | It would have fitted Gully AI and the bot. | n/a |
| Open House Singapore, Founder House (Oct 23–25, 2026) | Buildathon closed. Founder House open status not confirmed. | In person in Singapore, for Southeast Asian founders. | Only if the team is SEA-based and can travel |
| Stylus Sprint, Gaming Catalyst (AGV), STIP | Closed or wound down | n/a | n/a |
| Alchemy–Arbitrum grant | Active | Only for teams building or migrating Orbit rollups, paid in Alchemy credits | Revisit at M3 |

**Recommendation:** submit the **Arbitrum Builders form** now, ticking:

- marketing / visibility;
- the ArbiFuel gas subsidy;
- audit;
- mentorship / GTM.

File the **ArbiFuel** application the same day.

**Deadlines:** none. The Builders form, ArbiFuel and the ASP are all rolling. The ASP window runs about 12
months from 2026-09-29. Keep the milestone ask below ready for Questbook Season 4, which is the cash grant
that fits best and has no date yet.

## Eligibility check

| Requirement (from program pages) | Us |
|---|---|
| Building on Arbitrum (One, Nova or an Arbitrum chain) | Yes: Robinhood Chain (Orbit, chain id 4663) in the tracker, and Arbitrum One (42161) in Gully Pay. Gully Chains will be Orbit L3s. |
| Builders form: website, GitHub and X required | gullylabs.xyz, github.com/gully-labs, x.com/Gully_Labs |
| Builders form: deployment status | Live in production (choose the band by the first launch date, which **the owner must confirm**) |
| ArbiFuel: early stage, simple-UX, payments or stablecoins | Gully Pay: USDC and ETH pay links on Arbitrum One. Payers sign one transfer. |
| ArbiFuel: promote Arbitrum | We can add "Built on Arbitrum" to the pay pages and the bio, and post on X |
| ASP: audit-ready contract scope, runway, co-pay | **Not yet.** Gully Pay verifies plain transfers, so it has no contracts to audit. The scope arrives with the L3 contracts at M3 (chain configuration, bridge adapters) and M5 (Hyperlane ISM configuration, Warp Route ownership, Gully Pay settlement contracts). |
| Questbook (when open): open source, milestones, public reporting | The SDK is MIT. Our forks are public in github.com/gully-labs. We publish a changelog at docs.gullylabs.xyz/changelog. |

## The ask, with milestones

**Now (Builders form and ArbiFuel), no cash:**

- ArbiFuel: up to $10K in gas credits, for gasless USDC pay links on Arbitrum One;
- an ecosystem listing on the Arbitrum Portal;
- a spotlight or co-marketing for the tracker and widget;
- an introduction to the ASP for M3.

**When a cash program opens (Questbook Season 4 or the Foundation grants): $50,000, in four milestones.** This
is the two-Domain-Allocator ceiling. Cut it to M1 and M2 ($25,000) for a single-Domain-Allocator grant.

| # | Milestone | Deliverable anyone can check | Weeks | Amount |
|---|---|---|---|---|
| M1 | **Arbitrum One in the gap tracker** | Stock tokens on Arbitrum One priced against Chainlink in `/api/tracker`, history and movers, with the SDK, widget and alerts updated and the methodology documented on docs.gullylabs.xyz | 4 | $10,000 |
| M2 | **Chain Kit for Orbit, open source** | The Arbitrum/Orbit profile of our Blockscout fork (`gully-labs/blockscout`) documented as a one-command setup for any Orbit chain, with a public demo explorer | 6 | $15,000 |
| M3 | **Gully Devnet: a public Orbit L3 on Arbitrum Sepolia** | A public RPC, a Chain Kit explorer, a rate-limited faucet and the canonical token bridge, plus a runbook from `orbit-setup-script` and `orbit-monitoring-tools`; Rollup mode, ETH gas (`ops/l3/SPEC.md` §0–§8). This is also the ASP entry point. | 8 | $15,000 |
| M4 | **Gasless Gully Pay on Arbitrum One** | Pay links settled in USDC through an ERC-20 paymaster (ArbiFuel / Pimlico), with a public dashboard of sponsored payments | 4 | $10,000 |

**Stretch, when the L3 launches (not funded by the $50,000 above; written for a follow-on proposal or the Orbit
Chains domain):**

| # | Milestone | Deliverable anyone can check | Weeks | Amount |
|---|---|---|---|---|
| M5 | **Gully L3 on Arbitrum One with Hyperlane interop** | The production chain settling to Arbitrum One (Rollup, ETH gas); Hyperlane core on the L3 (Mailbox, multisig ISM with our 2-of-3 validators, IGP) and the agents from `ops/l3/hyperlane/` in production; **Warp Routes for USDC and ETH from Arbitrum One into the L3**, listed in the Hyperlane registry; Gully Pay native on the L3 and settling cross-chain from Arbitrum One through the Warp Route, verified on both chains; LI.FI and Relay listing requests filed with the chain's RPC, explorer and bridge. Spec: `ops/l3/SPEC.md` §9–§10. | 10 | $25,000 |

Why Hyperlane and why only at launch: the interop layer is an owner decision (2026-10-17). It gives the L3 a
permissionless bridge to Arbitrum One and Base on day one without waiting for an aggregator to list a new chain;
LI.FI and Relay remain the swap/bridge aggregators for the chains Gully Pay already offers, and are asked to list
the L3 once M5's artefacts (chain id, RPC, Chain Kit API, Warp Routes, DEX liquidity) exist.

Reporting: a monthly forum update, a changelog entry per milestone, and the metrics endpoints below.

## Metrics we can show, with live endpoints

All of these are public and keyless. The values were read on 2026-10-17. **Refresh them before submitting.**
Reviewers can call them themselves.

| Metric | Endpoint | Value on 2026-10-17 |
|---|---|---|
| Stock tokens priced live, by chain | [`/api/tracker`](https://gullylabs.xyz/api/tracker) | 47 tokens: 33 on Robinhood Chain (Orbit), 14 on BNB Chain |
| Rules and sources (Chainlink `latestRoundData`, on-chain pool prices) | `/api/tracker` → `rules`, `sources` | Published in the response |
| Gap history per token | [`/api/tracker/history?chain=robinhood&ticker=NVDA`](https://gullylabs.xyz/api/tracker/history?chain=robinhood&ticker=NVDA) | Points every few minutes |
| 24 h movers | [`/api/tracker/movers`](https://gullylabs.xyz/api/tracker/movers) | 41 eligible tokens |
| Gully Labs ledger (volume, value locked, fees across our venues) | [`/api/stats`](https://gullylabs.xyz/api/stats) | All-time volume $6.6K, value locked $26.2K, all-time fees $429. Small, so present it as live proof of the stack, not as traction. |
| Gully Pay chains and assets | [`/api/plans`](https://gullylabs.xyz/api/plans) | Arbitrum One USDC and ETH, plus Base, Ethereum and BNB Chain |
| Alert channels (Telegram bot, webhooks) | [`/api/alerts/channels`](https://gullylabs.xyz/api/alerts/channels) | Telegram (@GullyLabsBot) and webhook enabled |
| Gully AI | [`/api/ask/status`](https://gullylabs.xyz/api/ask/status) | Configured, 397 indexed chunks |

Not public, so the owner exports them if wanted:

- API key and usage counts (admin);
- Gully Analytics accounts;
- Telegram bot users;
- paid invoices.

## Links

- **Ours:**
  - Site: https://gullylabs.xyz
  - Tracker: https://gullylabs.xyz/tracker
  - Chain Kit: https://gullylabs.xyz/chain-kit
  - Docs and API reference: https://docs.gullylabs.xyz, https://docs.gullylabs.xyz/api
  - Changelog: https://docs.gullylabs.xyz/changelog
  - App: https://app.gullylabs.xyz
  - Analytics: https://analytics.gullylabs.xyz
  - Blog: https://blog.gullylabs.xyz
  - GitHub: https://github.com/gully-labs (SDK: https://github.com/gully-labs/sdk; explorer: https://github.com/gully-labs/blockscout)
  - X: https://x.com/Gully_Labs
  - Telegram news: https://t.me/GullyLabsNews
  - Bot: https://t.me/GullyLabsBot
- **Programs:**
  - Grants overview: https://arbitrum.foundation/grants
  - Builders form: https://tally.so/r/0QObE9
  - ArbiFuel: https://blog.arbitrum.foundation/arbifuel-is-live-arbitrum-builders-claim-your-gas-fee-sponsorship/ (form: https://airtable.com/appzb4GfqGfrnDXjW/shrulGIIp6l6ezAlt)
  - ASP: https://blog.arbitrum.foundation/introducing-the-arbitrum-security-program-apply-to-secure-your-smart-contracts/ (form: https://tally.so/r/3xzEzv?program=aap)
  - D.A.O. Grant Program thread: https://forum.arbitrum.foundation/t/arbitrum-d-a-o-grant-program-season-3-official-thread/28753
  - Questbook: https://arbitrum.questbook.app/
  - Portal listing form: https://docs.google.com/forms/d/e/1FAIpQLSc_v8j7sc4ffE6U-lJJyLMdBoIubf7OIhGtCqvK3cGPGoLr7w/viewform (linked from https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers)

## Arbitrum Builders form: filled in

These fields were verified on 2026-10-17 (page 1; page 2 was not visible). **Owner** marks the ones only you
can answer.

| Field | Answer |
|---|---|
| Company/Project name * | Gully Labs |
| Website URL * | https://gullylabs.xyz |
| GitHub * | https://github.com/gully-labs |
| X/Twitter URL | https://x.com/Gully_Labs |
| What are you building? * (max 50 chars) | `Tooling, explorers & payments for Arbitrum chains` (49) |
| Primary classification * | Infrastructure / Developer tooling (pick the closest in the dropdown) |
| Country * | **Owner** |
| Deployment status * | **Owner**: by the date gullylabs.xyz first went live (likely "6–12 months" or "under 6 months") |
| Chain * | Multichain including Arbitrum |
| Funding stage * | **Owner** (likely "None") |
| Support interests * | Audit; ArbiFuel gas subsidy; Marketing or visibility; Mentorship or GTM |
| Main contact name / email / Telegram * | **Owner** |
| Number of founders * | **Owner** |
| Founder X / LinkedIn | **Owner** |
| Attachments | This pitch as a PDF, and a screenshot of /tracker (Robinhood Chain rows) |
| Referral | **Owner**, if anyone at an Arbitrum Aligned Entity knows us |
| Additional comments | The one-paragraph pitch above, plus "ArbiFuel application filed the same day; ASP application planned at Gully Devnet (M3)." |

## Arbitrum Portal listing: filled in

The Portal listing is a Google Form. It asks for a sign-in, so its exact questions could not be read. The
fields below are the ones Portal entries display, in the order a listing form usually asks for them. Match
each to the form's real question and fill in anything extra it asks.

| Field | Value |
|---|---|
| Project name | Gully Labs |
| Short description (≈ 100 chars) | Live stock-token gap tracker, Orbit explorers (Chain Kit) and crypto pay links on Arbitrum. |
| Long description | Gully Labs builds and runs tooling for Arbitrum chains. The gap tracker prices every tokenised stock on Robinhood Chain against its Chainlink fair value, with a free API, SDK, widget and Telegram alerts. Chain Kit is a branded Blockscout explorer for Orbit chains. Gully Pay takes USDC and ETH on Arbitrum One through invoices and reusable pay links, verified on chain. Gully Analytics and Gully AI complete the stack. Next: Gully Devnet, a public Orbit L3 on Arbitrum Sepolia. |
| Category | Infrastructure (also: Developer Tools, Analytics, Payments) |
| Chains | Arbitrum One; Robinhood Chain (Arbitrum chain); Arbitrum Sepolia (Gully Devnet, coming soon) |
| Website | https://gullylabs.xyz |
| App URL | https://gullylabs.xyz/tracker |
| Docs | https://docs.gullylabs.xyz |
| X | https://x.com/Gully_Labs |
| Telegram | https://t.me/GullyLabsNews |
| GitHub | https://github.com/gully-labs |
| Discord | none |
| Logo (square) | **Owner** uploads: `public/brand/gully-mark-96.png` is too small. Export a 512 × 512 PNG of the mark. |
| Banner / cover | `https://gullylabs.xyz/social/og-home.png` |
| Contract addresses | None of our own on Arbitrum One. Gully Pay uses plain transfers to the receiving wallet. **Owner**: add the receiving address only if the form requires one. |
| Token | None |
| Contact email / Telegram | **Owner** |
| Launch date | **Owner** |

## Submission checklist (what the owner must do)

1. [ ] **Refresh the metrics table**: re-run the endpoints and update the values and the date.
2. [ ] **Decide the public story on traction**: the ledger numbers are small, so lead with the tracker's
   coverage and the live API rather than volume.
3. [ ] **Builders form** (https://tally.so/r/0QObE9). Fill in the **Owner** rows:
   - country;
   - deployment status band;
   - funding stage;
   - contact name, email and Telegram;
   - number of founders;
   - founder X and LinkedIn;
   - referral.

   Attach this pitch as a PDF and a /tracker screenshot. Complete page 2, whose fields could not be seen.
4. [ ] **ArbiFuel** (Airtable form). Use the same contact details. Use case: gasless USDC pay links on
   Arbitrum One. Agree to the promotion terms: an X post, the bio, and a "Built on Arbitrum" banner on the
   pay pages. Expected volume: **Owner** estimates the sponsored transactions per month.
5. [ ] **Arbitrum Portal form** (Google sign-in). Map the Portal table above to the real questions. Upload a
   512 × 512 logo and the banner. Add any fields the form asks that are not listed.
6. [ ] **Wallet for any grant payout**: a team multisig on Arbitrum One. **Owner** creates and supplies it.
   Never a hot key from the server.
7. [ ] **KYC / legal entity**: Foundation programs, the ASP agreement and Questbook payouts require them.
   **Owner** prepares the entity name, jurisdiction and signatory.
8. [ ] **Watch for Questbook Season 4** (forum category *DAO Grant Programs*) and the Foundation Grant Program
   opening. Submit the milestone table above as the proposal (Dev Tooling on One and Stylus, or Orbit Chains
   domain).
9. [ ] **ASP at M3**: once the Gully Devnet contracts are scoped, apply at https://tally.so/r/3xzEzv?program=aap
   with the scope, an audit firm quote and a budget. Confirm the runway and co-pay terms first.
10. [ ] **Telegram link check**: the README badge points at `t.me/GullyLabsNews`, while the site and this pitch
    use `t.me/GullyLabsNews` (`src/content/site.ts`). Confirm which is right before submitting.
