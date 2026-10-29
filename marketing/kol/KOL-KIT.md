# Gully Labs KOL kit

Everything a KOL (or the @GullyLabsNews admin) needs to post about Gully Labs: the animated banner, ready-to-paste
copy and the tracked links. Every claim here is taken from the live site, the docs or the server's own settings.
There are no prices, returns or figures that could go stale, except the Gully Pay fee, which is read live from
`GET https://gullylabs.xyz/api/pay/m/config` (0.5% after the first $5,000 on 2026-10-18). Check it again before
you post if the post goes out much later.

## Media

| File | Use | Notes |
|---|---|---|
| `announce-1280x720.mp4` | Telegram channel post, X, YouTube community | H.264, 7 s loop, under 2 MB |
| `announce-1080x1080.mp4` | X / Instagram / LinkedIn square | H.264, 7 s loop |
| `announce-1080x1920.mp4` | Stories, Reels, Shorts, TikTok | content kept out of the top and bottom 250 px |
| `announce-*.gif` | where video is not accepted | half size, 15 fps |
| `announce-*-poster.png` | static image or video cover | frame 0, full size |

Rebuild them with `node scripts/build-kol-banner.mjs` (see the header of that script). Everything in the banner
comes from the Gully Labs brand kit: the lockup, mascot, colours and fonts are the kit's own files.

Hosted copy for the channel composer: `https://gullylabs.xyz/brand/kol/announce-1280x720.mp4` (live once this
branch is deployed).

---

## (a) @GullyLabsNews launch post (Telegram HTML caption)

Post it with `announce-1280x720.mp4` attached. Caption length: 692 of 1024 characters (checked with the admin
composer's own sanitizer). The admin can load the whole post, media and buttons included, from
`channel-launch-post.json`.

```html
<b>🧪 Meet the Gully Labs line-up</b>

Tools for on-chain markets, built and run by Gully Labs:

📊 <b>Stock tracker</b>: every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, every minute
🔁 <b>Swap</b> any stock token from its page
🔔 <b>Alerts</b> by Telegram or webhook, for stock gaps and token holders
🤖 <b>Gully AI</b>: questions about any Gully product, answered from our docs with sources
📈 <b>Gully Analytics</b>: web analytics that see the wallet
💳 <b>Gully Pay</b>: non-custodial crypto checkout and pay links. 0.5% per payment after your first $5,000, no monthly fee

Coming next: <b>Holder Map</b> (coming soon) and the <b>Gully L3</b> on our roadmap.

📚 <a href="https://docs.gullylabs.xyz/?utm_source=kol&amp;utm_medium=telegram&amp;utm_campaign=launch">Read the docs</a>

<i>Information only, not advice.</i>
```

**CTA buttons** (one per row):

| Button | URL |
|---|---|
| 🚀 Open the App | `https://app.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch` |
| 📊 Live tracker | `https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=telegram&utm_campaign=launch` |
| 🤖 Open the bot | `https://t.me/GullyLabsBot` |
| 📚 Docs | `https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch` |

The admin channel composer allows three buttons per post, so in `channel-launch-post.json` Docs is the
"Read the docs" link in the caption instead of a fourth button. A KOL posting from their own channel can use all four.

---

## (b) X posts (one each, under 280 characters)

X counts every link as 23 characters; the counts below include that. Add the square video
(`announce-1080x1080.mp4`) or the 16:9 one. Keep `#ad` if you were paid or given anything for the post.

**Degen** (234 / 280)

```text
Stock tokens don't always trade at the real share price. @Gully_Labs tracks the gap live on Robinhood Chain, BNB Chain and Solana, and its Telegram bot pings you when it moves. Information only, not advice. #ad
https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=x&utm_campaign=launch
```

**Builder** (232 / 280)

```text
Building on-chain? @Gully_Labs has the parts: a free stock token API + SDK, wallet-aware web analytics, Gully Pay for non-custodial crypto checkout (0.5% after your first $5k) and branded block explorers. #ad
https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch
```

**Normie** (231 / 280)

```text
Ever wondered if a stock token is priced fairly? Gully Labs shows how far each one trades from the real share price, updated every minute, and can message you on Telegram when that changes. Free to look. #ad
https://gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch
```

---

## (c) Telegram KOL message (for your own channel or group)

Paste as is (Telegram keeps the line breaks). Attach `announce-1280x720.mp4`.

```text
🧪 Gully Labs: tools for on-chain markets

Gully Labs builds and runs its own Web3 products. What you can use today:

📊 Stock tracker: every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, every minute
https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=telegram&utm_campaign=launch

🔁 Swap any stock token from its own page on the tracker

🔔 Alerts: set a gap rule once and get a Telegram message or a signed webhook. Holder Map alerts too.
https://app.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch

🤖 Telegram bot + Mini App: the tracker, Holder Map, your alerts and Gully AI inside Telegram
https://t.me/GullyLabsBot

🧠 Gully AI: ask anything about a Gully product, answered from the docs with sources
https://gullylabs.xyz/ask?utm_source=kol&utm_medium=telegram&utm_campaign=launch

📈 Gully Analytics: page views next to wallet connects, chains and transactions. Cookie-free, sign up with your wallet.
https://gullylabs.xyz/analytics?utm_source=kol&utm_medium=telegram&utm_campaign=launch

💳 Gully Pay: non-custodial crypto checkout, pay links and invoices in ETH, BNB, USDC or USDT on Base, Ethereum, BNB Chain and Arbitrum. Payments go straight to your wallet. 0.5% per payment after your first $5,000, no monthly fee.
https://docs.gullylabs.xyz/gully-pay-merchants?utm_source=kol&utm_medium=telegram&utm_campaign=launch

🧱 Chain Kit: a branded block explorer for your chain, run by Gully Labs
https://gullylabs.xyz/chain-kit?utm_source=kol&utm_medium=telegram&utm_campaign=launch

🗺 Coming soon: Holder Map. On the roadmap: the Gully L3.
https://docs.gullylabs.xyz/roadmap-l3?utm_source=kol&utm_medium=telegram&utm_campaign=launch

Plans and prices: https://gullylabs.xyz/pricing?utm_source=kol&utm_medium=telegram&utm_campaign=launch
Docs: https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch
Blog: https://blog.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch
News: https://t.me/GullyLabsNews
X: https://x.com/Gully_Labs
GitHub: https://github.com/gully-labs

Information only, not advice. #ad
```

---

## (d) X thread (5 posts)

Each post is under 280 characters with links counted as 23.

**1/5**

```text
Gully Labs builds and runs its own Web3 tools. Here's the line-up, in one thread 🧵 #ad
```

**2/5**

```text
📊 The stock tracker: every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, every minute. Swap any of them from its page, and set Telegram or webhook alerts on the gap.
https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=x&utm_campaign=launch
```

**3/5**

```text
🤖 In Telegram: @GullyLabsBot and its Mini App bring the tracker, Holder Map, your alerts and Gully AI into chat. Gully AI answers questions about any Gully product from the docs, with sources.
https://t.me/GullyLabsBot
```

**4/5**

```text
🛠 For builders: Gully Analytics (web analytics that see the wallet), Gully Pay (non-custodial crypto checkout and pay links, 0.5% after your first $5k), Chain Kit explorers, and a free API + SDK.
https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch
```

**5/5**

```text
Next: Holder Map (coming soon) and the Gully L3 on the roadmap. Follow @Gully_Labs and t.me/GullyLabsNews for updates. Information only, not advice.
https://gullylabs.xyz/links?utm_source=kol&utm_medium=x&utm_campaign=launch
```

---

## (e) Do and don't for KOLs

**Do**

- Say what the products do, in your own words, using the facts in this kit.
- Say "information only, not advice" whenever you mention prices, gaps or tokens.
- Disclose a paid partnership: put `#ad` (or your platform's paid-partnership label) in every paid post, thread
  and story, and keep it visible (not hidden among hashtags at the end of a long caption).
- Use your tracked link from the list below, so we can see what your audience used (no personal data is collected
  beyond normal web analytics).
- Use the banner files as they are. If you need another size, ask us.
- Link to @GullyLabsNews and @Gully_Labs as the official sources.

**Don't**

- Don't promise or hint at price moves, profits, returns, "gains", "100x", "free money" or "easy money".
- Don't present a gap on the tracker as a trade signal or a sure thing. It is a reading of on-chain and fair
  prices, nothing more.
- Don't call products live that are not: Holder Map is "coming soon" and the Gully L3 is a roadmap item.
- Don't invent figures (users, volume, TVL, partners). If you want a number, ask us for a current, sourced one.
- Don't edit, recolour, stretch or redraw the logo or the mascot, and don't put them on mid-tone backgrounds.
- Don't share the admin's links, invite codes or anything marked private.

---

## (f) Links with UTM, per channel

UTM pattern: `?utm_source=kol&utm_medium=<channel>&utm_campaign=launch`. Gully Analytics reads all three.
KOLs may add `&utm_content=<your-handle>` so their own traffic shows separately. t.me, x.com and github.com links
carry no UTM (those sites drop it).

| Page | X (`utm_medium=x`) | Telegram (`utm_medium=telegram`) | Instagram / stories (`utm_medium=instagram`) |
|---|---|---|---|
| Website | `https://gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://gullylabs.xyz/?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |
| Link hub | `https://gullylabs.xyz/links?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://gullylabs.xyz/links?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://gullylabs.xyz/links?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |
| App | `https://app.gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://app.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://app.gullylabs.xyz/?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |
| Tracker | `https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://gullylabs.xyz/tracker?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |
| Pricing | `https://gullylabs.xyz/pricing?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://gullylabs.xyz/pricing?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://gullylabs.xyz/pricing?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |
| Docs | `https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://docs.gullylabs.xyz/?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |
| Blog | `https://blog.gullylabs.xyz/?utm_source=kol&utm_medium=x&utm_campaign=launch` | `https://blog.gullylabs.xyz/?utm_source=kol&utm_medium=telegram&utm_campaign=launch` | `https://blog.gullylabs.xyz/?utm_source=kol&utm_medium=instagram&utm_campaign=launch` |

No UTM (same on every channel):

| Page | Link |
|---|---|
| Telegram bot + Mini App | `https://t.me/GullyLabsBot` |
| News channel | `https://t.me/GullyLabsNews` |
| X | `https://x.com/Gully_Labs` |
| GitHub | `https://github.com/gully-labs` |

Every link above was checked on 2026-10-18 (HTTP 200, or a valid t.me / x.com page). `/links` answers once this
branch is deployed.
