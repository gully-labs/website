# Explorer submissions: name tags, token info, public tags

What to submit to each block explorer so the Gully Labs addresses are labelled. The address list is
`src/content/contracts.ts` (also `/.well-known/contracts.json`); the numbers below come from it.
Nothing here has been submitted. The owner submits, because every explorer wants a proof only the
address owner can give.

Status of this research (2026-10-18): **CONFIRMED** = read in the explorer's current docs this session;
**UNCONFIRMED** = from memory of how the form worked, re-check the form before relying on it.

Logo source: `C:/Users/Admin/Desktop/GRAPHICS/Gully Labs` (`gully-labs-kit/brand`). Use the mark, square,
transparent PNG; the website's copy is `public/brand/gully-mark-512.png`. Check each form's size rule (Etherscan
asks for a square PNG, 256 x 256, UNCONFIRMED) and export from the kit, do not resize a web copy.

## What we have to tag

| Address | Chains | Tag to ask for |
| --- | --- | --- |
| Treasury Safe `0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6` (2-of-3, same on every chain) | Ethereum, Base, BNB Chain, Arbitrum One, Robinhood Chain, Arc | `Gully Labs: Treasury` |
| Request Network ERC20FeeProxy (third party) | Ethereum, OP Mainnet, BNB Chain, Arbitrum One, Base | Do NOT tag as ours. Request Network owns it. |
| Our project contracts (DeepCore, Peddles, PeddleSwap, PeddleQuest, Cartel Family) | see registry | Tag by project, e.g. `Peddles: Launchpad`, from the registry `name` |

The Safe is a proxy contract, not a token: **token-info forms do not apply to it**. Only a name tag does.
Token-info forms apply to ERC-20 tokens we deploy (none are in the registry; add them to the registry first).

## Etherscan family (Etherscan, BscScan, BaseScan, Arbiscan, Optimism Etherscan, HyperEVMScan, Robinhood Chain)

### Ownership proof (CONFIRMED)
Etherscan lets the owner tie an address to their account by signing a message with the wallet
(*Verify Address Ownership*, support article "How to Verify Contract Address Ownership?"): connect the wallet,
sign the message, press Verify Ownership. Needs a free Etherscan account (one per explorer; accounts are not
shared across chains' explorers, UNCONFIRMED). **For the Safe this is the hard part:** a Safe cannot sign with an
EOA key directly. Ask support for the Safe path (EIP-1271 / a Safe message signed by 2 of 3 owners) before
paying anyone to try; UNCONFIRMED whether each explorer accepts it.

### Token info (CONFIRMED, only for ERC-20 tokens)
Source: Etherscan "How to update Token Information?". Needs: ownership verified, contract source verified.
Token page, More, **Update Token Info**, Request Type "New/First Time Token Update". Every request is reviewed.
Text to paste, per token: name, symbol, official site `https://gullylabs.xyz`, X `https://x.com/Gully_Labs`,
Telegram `https://t.me/GullyLabsNews`, GitHub `https://github.com/gully-labs`, logo from the kit,
one-line description from `src/content/projects.ts`.

### Name tag / label (UNCONFIRMED)
Etherscan has a contact form (*Contact Us*, subject "Update Address Name Tag / Label") and does not publish a
rule. Practice: ask for a label on an address that has a verified contract and an owner proof; they reply by
email and may ask for a message sent from the project's domain email. Text to paste:

```
Subject: Address name tag request: Gully Labs: Treasury
Address: 0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6 (Safe 1.5.0, 2-of-3)
Chains: Ethereum, Base, BNB Chain, Arbitrum One (same address on each)
Requested name tag: Gully Labs: Treasury
Label: Treasury / Gully Labs
Official site: https://gullylabs.xyz
The list of every address we use, with the repo file each is quoted from: https://gullylabs.xyz/.well-known/contracts.json (docs: https://docs.gullylabs.xyz/contracts)
Proof: Safe-signed message from the owners, plus an email from our site domain. Contact: hello@gullylabs.xyz
```

Repeat per explorer. The contact email must be one the owner confirms exists before sending.

## Blockscout instances (Robinhood Chain via robin.etherscan.io is Etherscan-style; Arc explorer is UNCONFIRMED)

### Public tags (CONFIRMED)
Source: Blockscout docs, "Public tags". Log in to **My Account**, **Public tags**, **Request to add public tag**.
Fields: your name, e-mail, company name (`Gully Labs`), company website (`https://gullylabs.xyz`), request type
"Add tags for your project", **Public tags** (up to 2, each 35 characters or fewer, separated by `;`),
Smart contract / Address (0x..., the + button adds more), Reason and description (with preferred tag colour).
Admins review by hand in order received. The docs do not mention a proof of ownership, so none is known to be
required; expect a follow-up question.

Paste:
```
Public tags: Gully Labs: Treasury;Treasury
Address: 0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6
Reason: Treasury Safe of Gully Labs (https://gullylabs.xyz), the same address on every chain. Source list: https://gullylabs.xyz/.well-known/contracts.json
Colour: gold (#D9B563)
```

### Token icon (UNCONFIRMED)
Blockscout instances usually take token logos through the instance's admin or a pull request to its
`blockscout/frontend` / chain-specific repo; ask the chain's team. Not applicable until we have a token.

## Sourcify (not an explorer, but it feeds the verified-source column)
324 of 377 registry entries have a Sourcify match (checked 2026-10-18). The 53 without one are listed as
"no verified source" in the registry; verifying them on Sourcify (`forge verify-contract --verifier sourcify`)
makes the explorers' "verified" tick and the registry's `verifiedSource` fill in. Re-run
`node scripts/gen-contracts.mjs` then `node scripts/build-discovery.mjs`.

## Order of work
1. Owner confirms the contact email and which Safe signers sign the ownership proof.
2. Treasury Safe name tag on Etherscan, BaseScan, BscScan, Arbiscan; Blockscout public tag on the Blockscout chains.
3. Project contracts, one project at a time, after their sources are verified.
4. Token info only when we have our own ERC-20.
