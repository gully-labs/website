# Email to Offchain Labs: licence request (draft for the owner to send)

## Where to send it

Confirmed on Offchain Labs' own site (https://offchain.io, which the old offchainlabs.com redirects to): there is
no public licensing or legal email address. The site offers a **contact form at https://offchain.io/contact**
("Contact" and "Book a Discovery Call"; a "Partner with us" page at https://offchain.io/enterprise). Its legal pages
are only the privacy policy and terms of service. The docs' "Arbitrum chains" page (https://arbitrum.io/launch-chain)
is the launch entry point for teams building a chain, and Offchain Labs is on X as https://x.com/Offchain.

Recommended route: paste the email below into the https://offchain.io/contact form (partnership / Orbit), and also
open a short issue (same text, shortened) on the repository concerned, e.g. in
https://github.com/OffchainLabs/arbitrum-orbit-deployment-ui/issues, because that is where a missing LICENSE file is
normally fixed. A third-party directory lists partnerships@offchainlabs.com; **I could not confirm that address on any
official Offchain Labs page, so do not rely on it** without checking.

---

**Subject:** Licence request for four Offchain Labs repositories without a licence file (Gully Labs, Arbitrum Orbit builder)

Hello Offchain Labs team,

I'm writing from Gully Labs (https://gullylabs.xyz, X: @Gully_Labs). We build developer infrastructure and are building
on Arbitrum Orbit: chains that settle to Arbitrum, in the context of the Arbitrum Expansion Program. We are starting
with testnet chains settling to Arbitrum Sepolia.

We would like to build on your open tooling, but four repositories currently have no licence file, so we understand all
rights are reserved and we have not used or copied any of them:

- https://github.com/OffchainLabs/arbitrum-orbit-deployment-ui
- https://github.com/OffchainLabs/orbit-setup-script
- https://github.com/OffchainLabs/orbit-monitoring-tools
- https://github.com/OffchainLabs/arbitrum-token-lists

Two requests:

1. **Permission.** May Gully Labs use, modify and host branded versions of these four repositories for our customers'
   Orbit chains (for example a white-labelled chain launch UI, the setup script, the monitoring tools and token lists
   for chains we operate)? We would keep attribution to Offchain Labs and publish our changes where the licence asks.
2. **A licence going forward.** Would you consider adding an open-source licence to these repositories, for example
   Apache-2.0 as you did for arbitrum-token-bridge? That would let every Orbit builder use them with confidence, and
   we would be glad to contribute fixes back.

For what it is worth, we already build only on the licensed parts of the stack: the Arbitrum chain SDK
(@arbitrum/chain-sdk, Apache-2.0), viem (MIT) and the Nitro contracts under their Additional Use Grant for chains that
settle to Arbitrum Sepolia. Nothing we ship copies the unlicensed repositories.

If a different team or channel handles licensing, we would be grateful to be pointed to it. Happy to jump on a short
call as well.

Thank you for the work on Orbit.

Kind regards,

The Gully Labs team
https://gullylabs.xyz | X: @Gully_Labs
Reply to: labsgully@gmail.com

---

Notes for the owner (delete before sending):

- Sender and reply-to address: labsgully@gmail.com (owner-confirmed). The contact form asks for an email; use that one.
- The claims in the "for what it is worth" paragraph are true of the launch flow in `src/pages/developers/chains/`
  (see `ops/LAUNCH-FLOW-LICENCES.md`). Do not send this before that flow is merged if you want the sentence to be
  literally accurate in production.
- The "Arbitrum Expansion Program" is named only as context. We have not applied to it; do not imply that we have.
