# Audits & Security: research

Collected 2026-10-18 for the Gully Security plan (`PLAN.md`). Primary sources first. Every claim has a URL.
Marks: **[F]** the page was fetched and read; **[S]** seen only in search results or a snippet, so check it
before quoting it publicly. Nearly everything about CertiK comes from CertiK's own pages; no independent
study of how the Skynet Score behaves was found.

## 1. CertiK

### 1.1 Smart contract audit
- Every audit is a manual review by CertiK staff plus an automated, AI-assisted review; formal verification is an
  optional extra. [F] https://www.certik.com/products/smart-contract-audit
- The published process ("How We Audit"; dated 2024-02-23 but quoting data "as of 2026-07-31", so it has been
  updated): environment setup (compile, deploy) → architecture review (including fork detection) → threat model
  (STRIDE adapted for Web3, giving a checklist) → static analysis and formal verification, false positives removed
  by hand → manual line-by-line review, per function and system-wide → report → remediation loop (client sends
  fixes, findings updated, updated report published, repeated "until the client is satisfied") → final report.
  [F] https://www.certik.com/blog/how-we-audit-a-comprehensive-guide-to-certiks-auditing-methodology
- No separately named "re-audit" product was found; the fix review is that remediation loop (unconfirmed beyond this).
- Each finding has a title, category, severity, file location and alleviation status, then Description,
  Scenario, Proof of Concept and Recommendation. [F] same post
- Severity: Critical ("must be addressed before launch"), Major (centralisation or logic errors that can lose funds
  or control), Medium, Minor, Informational. [F] https://skynet.certik.com/skynet-101/code-security
- Finding status on Skynet: Acknowledged, Partially Acknowledged, Resolved; unresolved items are documented with
  impact and the team's justification. [F] same page; [F] https://www.certik.com/products/smart-contract-audit
- Reports are public: "Completed smart contract audit reports are publicly available" [F] https://certik.com/faq ,
  with "View Findings" and "View PDF" on each Skynet project page [F] https://skynet.certik.com/skynet-101/code-security
- Formal verification: per-project machine-readable specifications; standard ERC-20 and ERC-721 properties checked
  automatically; each property shows True, False, Inapplicable or Inconclusive. [F] https://certik.com/faq ;
  [F] https://skynet.certik.com/skynet-101/code-security
- CertiK's own counts: 6,215+ projects audited, 93,501+ findings, 1,234+ formally verified projects.
  [F] https://www.certik.com/products/smart-contract-audit
- "Audit Coverage" and "Audit Freshness": Skynet compares deployed bytecode with audited code and tracks code
  deployed since the last audit. [F] https://skynet.certik.com/skynet-101/code-security

### 1.2 KYC / team verification
- KYC badges in Gold, Silver and Bronze (announced 2022-10-06); the tier depends on how much verifiable information
  the team gives; re-evaluated every 90 days. Inputs: geographic risk tier (1-3), core team members, project start
  date, KYC timeline. [F] https://www.certik.com/resources/blog/introducing-kyc-badge-awards . The exact tier
  criteria are in an image table: unconfirmed.
- Founders are interviewed and identity data cross-checked against public databases; public profiles show no
  personal data. [S] same post. KYC data handled under ISO 27001 / SOC 2-aligned controls. [F] https://certik.com/faq
- Skynet shows badge type, issue date, number of verified members, geographic risk and timeline; "Team
  Verification" and "Team Identity" are Medium-weight score signals.
  [F] https://skynet.certik.com/skynet-101/fundamental-health ; [F] https://skynet.certik.com/skynet-score-methodology

### 1.3 Skynet
- **Security Score**: 0-100, "may be accompanied by a letter grade (e.g., AAA, AA, A, BBB…)"; grade bands not
  defined. Six categories, each signal weighted only by a word (High … Low), not a number; "aggregation algorithms
  are proprietary". [F] https://skynet.certik.com/skynet-score-methodology

  | Category | Signals (published weight) |
  |---|---|
  | Code Security | Audit History (High), Audit Analysis (High), Token Scan (High), Audit Coverage (Medium-High), Audit Freshness (Medium-High), GitHub Monitoring (Medium-Low) |
  | Fundamental Health | Quality Assessment (Medium), Team Verification (Medium), Team Identity (Medium), Funding Profile (Medium-Low) |
  | Operational Resilience | Website Scan (High), Bug Bounty (High), Incidents History (Medium-High), Project Maturity (Medium-Low), Exchange Operation (Medium-Low), dApp Usage (Medium-Low), Public Events (Low) |
  | Governance Strength | Centralization Risk (Medium-High), Holder Distribution (Medium), Token Activity (Medium-Low), Governance Proposal (Low) |
  | Market Dynamic | Market Capitalization (Medium-High), Trading Volume (Medium-High), CEX Holding (Medium) |
  | Community Trust | Social Audience (Medium), Community Activity (Medium), Community Sentiment (Low), Community Engagement (Low) |

  An older guide calls the fifth category "Market Stability". [S] https://skynet.certik.com/skynet-101/skynet-security-score
- Computation, as described: data collection → signals → weighting → raw score → risk deductions (e.g. slippage,
  anonymous team) → normalisation with incident adjustments → rating; projects profiled as Pre-Launch, Standard or
  Non-Token; normalisation daily, token scans near real-time; analysts judge some inputs; projects may submit
  evidence "under NDA" for re-evaluation. [F] https://skynet.certik.com/skynet-score-methodology
- Signal count is inconsistent across CertiK's pages: 28 on the methodology page, "20+" on the FAQ and product page.
  [F] https://certik.com/faq ; [F] https://certik.com/products/skynet
- CertiK states the score is "unaffected by project affiliations". [S] https://www.certik.com/products/skynet-score
- Predecessor: the "Skynet Trust Score" (June 2022) with Security and Community & Market subscores.
  [F] https://www.certik.com/blog/introducing-the-skynet-trust-score
- **Leaderboard**: ranks projects by type, ecosystem, stage and security; completed audits and pentests are listed.
  [F] https://certik.com/products/skynet ; category boards (Pre-Launch, Memes, DeFi)
  [S] https://www.certik.com/blog/skynet-empowering-users-with-advanced-security-tools
- **Monitoring and alerts**: claims 24/7 monitoring of 17,000+ projects [F] https://certik.com/products/skynet ;
  Skynet Alerts (rug pulls, exploits, phishing, flash loans, Tornado Cash deposits) on the Skynet for Community
  dashboard and the @CertiKAlert account on X [F] https://www.certik.com/blog/top-tips-for-keeping-up-with-the-latest-crypto-security-events
  (2023 post; whether @CertiKAlert is still active: unconfirmed).
- **Badges and Emblem**: KYC, contract verification and audit badges [F] https://certik.com/products/skynet ; the
  Emblem is an embeddable widget showing badges, audit status and score on the project's own site, obtained by
  contacting CertiK [F] https://www.certik.com/blog/introducing-emblem-for-project-teams ; a "Top 10% Security
  Score" honour [S] https://www.certik.com/blog/introducing-badges-and-honors-on-certiks-security-leaderboard
- **APIs and scanners**: Skynet Score API, Token Scan API (honeypots, owner privileges) [F] https://certik.com/products/skynet ;
  Token Scan in Binance Wallet (July 2025) [S] https://www-cn.certik.com/blog/binance-wallet-integrates-certiks-skynet-token-scan
- **Security Oracle**: a CertiK Chain (now Shentu Chain) feature where decentralised operators served security
  scores [S] https://www-cn.certik.com/blog/certiKturnsthree ; not on the current Skynet product page [F]. Treat as
  legacy; current status unconfirmed.

### 1.4 Bug bounty
- CertiK Hunt (launched 2026-07-01): invite-only platform for vetted researchers (bug bounties, audit
  competitions, AI security challenges); no published prices. [F] https://www.certik.com/blog/introducing-certik-hunt ;
  framed as an Immunefi / Sherlock / Cantina / HackenProof competitor [S] https://cryptobriefing.com/certik-debuts-invite-only-bug-bounty-platform-for-web3-researchers/
- The FAQ describes a fully managed bounty with 0% fees on payouts. [F] https://certik.com/faq . Having a bounty is
  a High-weight score signal. [F] https://skynet.certik.com/skynet-score-methodology

### 1.5 Pentest / web2 code
- Scope: applications (web, mobile, desktop, browser extensions, APIs), networks (including RPC), cloud
  (AWS/Azure/GCP), AI/ML (prompt injection), SDKs, source code. Phases: Prepare → Explore → Exploit → Escalate →
  Improve. Deliverables: executive summary, threat model, technical report, findings Critical-Informational with
  reproduction steps and PoC. References OWASP, MASVS/MASTG, CVSS, NIST, PTES, CREST; reports tailorable to SOC 2,
  ISO 27001, MiCA, DORA; completed pentests feed the score. [F] https://www.certik.com/products/pentest ; [F] https://certik.com/faq

### 1.6 Pricing
- Not public: audit, pentest and Skynet pages and the FAQ say "request a quote". [F] the product pages above and
  https://certik.com/faq

## 2. Peers (one line each)
- **PeckShield**: audits and security monitoring, best known for exploit alerts on X; its own publications repo holds
  only 9 PDFs (2019-2022), most reports live in client docs. [F] https://github.com/peckshield/publications
- **OpenZeppelin**: audits (Solidity, Cairo, Rust, Go), ZK audits and a continuous security programme
  (pre-audit → audit → fix review → support); reports published at openzeppelin.com/research.
  [F] https://www.openzeppelin.com/security-audits
- **Trail of Bits**: security reviews across blockchain, cryptography, AI/ML and cloud; publishes a subset as PDFs
  (some with fix reviews) in a GitHub repo, "many more remain confidential". [F] https://github.com/trailofbits/publications
- **Cyfrin**: audits, formal verification, pentests, incident response, plus Solodit, Aderyn, CodeHawks and Updraft;
  ~269 reports indexed on GitHub with severity counts. [F] https://www.cyfrin.io/ ; [F] https://github.com/Cyfrin/cyfrin-audit-reports
- **Hacken**: contract, protocol, dApp, wallet and bridge audits, pentests, proof of reserves, HackenProof bug
  bounties; one remediation check included; public report portal (~2,161 audits) and results on CER.live.
  [S] https://hacken.io/audits/reports/2/ ; [S] https://hacken.io/common/files/HackenOP.pdf

## 3. Criticism of scores, badges and audits

### 3.1 Scores high before failures; opaque method
- Merlin DEX (April 2023): CertiK audit score 90; after a $1.82M rug it was cut to 38 while posts showing 90 stayed
  up; critics said the backdoor should have been flagged and reports read like "automatically generated
  flowcharts"; CertiK: "An audit is not a stamp of approval". [F] https://www.dlnews.com/articles/defi/merlin-heist-highlights-auditor-certik-role-in-defi-security/
- CertiK's post-mortem: "private key privileges are outside the scope of a smart contract audit"; 2 of 4 core
  members had refused KYC; CertiK offered compensation. [S] https://www.certik.com/blog/certiks-update-on-the-merlin-dex-rugpull ;
  [S] https://www.theblock.co/post/228485/merlin-scam-certik-refund
- Skynet weights are words, aggregation is proprietary, some inputs are analyst judgements, and NDA evidence can
  change a score. [F] https://skynet.certik.com/skynet-score-methodology
- No independent study proving score inflation or pay-to-rank was found: **unconfirmed**. We do not claim it.

### 3.2 Paid badges and conflicts of interest
- Swaprum (May 2023, ~$3M): the deployer used an upgradeable proxy CertiK had rated "major" to swap in malicious
  code; critics: "audit firms are free to choose their clients". [F] https://decrypt.co/140744/certik-taking-heat-as-another-project-it-audited-swaprum-gets-rugged
- Hacken's CEO: auditors "take no accountability" when audited tokens are hacked.
  [S] https://cointelegraph.com/interview/lack-of-transparency-among-project-auditors-a-big-problem-hacken-ceo
- The SEC's chief accountant warned about reports marketed as "audits" (e.g. proof of reserves).
  [S] https://decrypt.co/150491/sec-warning-over-misleading-crypto-audits
- Former clients questioning CertiK's thoroughness (headline only read). [F] https://thedefiant.io/news/hacks/former-certik-clients-question-security-firm-s-stronghold-on-protocol-audits

### 3.3 Audited, then hacked or rugged
- Arbix Finance (Jan 2022, ~$10M): CertiK-audited; exploited contract "not in the audit scope" (new token with
  mint functions). [S] https://www.malwarebytes.com/blog/news/2022/01/10m-of-funds-goes-missing-in-what-appears-to-be-a-cryptocurrency-rug-pull
- Rekt.news names the auditor in each leaderboard entry; CertiK appears on several (Gala Games, Woofi, ZKasino,
  Arbix, Merlin, Akropolis). Most top-20 entries are unaudited. [F] https://rekt.news/leaderboard/
- Kokomo Finance was audited by 0xGuard (token only), not CertiK [S] https://rekt.news/kokomo-finance-rekt ; a
  CertiK audit of Meter is unconfirmed [S] https://forklog.com/en/hacker-siphons-4-3-million-from-meter-cross-chain-bridge/
- How common audited hacks are (sources disagree): 4.09% of 563 audited vs 15.49% of 213 unaudited protocols
  attacked [S] https://arxiv.org/pdf/2208.13035 ; audited protocols 20% of top-100 hacks [S] https://halborn.com/blog/post/halborn-all-time-top-100-defi-hacks-report-summary ;
  12 of 78 Q3 2023 rug pulls had any audit [F] https://cointelegraph.com/news/rug-pulls-audits-report-hacken

### 3.4 Controversies
- CertiK vs Kraken (June 2024): ~$3M withdrawn through a Kraken bug; Kraken called it extortion, CertiK called it
  white-hat testing; funds returned minus fees. [F] https://www.theblock.co/post/300904/certik-kraken-bug ;
  [S] https://blockworks.com/news/krakens-cso-confirms-certik-returned-funds-with-a-small-amount-lost-to-fees
- KYC badge failure: Zoro Inu, KYC'd by CertiK in May 2022, rugged in June 2022.
  [F] https://www.certik.com/skynet-report/certiks-response-to-kyc-rugs-zoro-inu

### 3.5 Models of credible scoring
- L2BEAT Stages: published requirements per stage, spec in a public forum post, changes discussed openly, says it
  measures maturity, not bug-freedom. [F] https://l2beat.com/stages
- DefiLlama asks for audit links but does not verify them; says it "doesn't audit nor endorse" protocols.
  [F] https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/pull_request_template.md
- Solodit: searchable findings database, filterable by firm, so track records are comparable. [S] https://docs.solodit.cyfrin.io

## 4. Design rules we take from this (used in PLAN.md and the public roadmap)
1. Publish the method with numeric weights and a changelog; no proprietary aggregation (Skynet vs L2BEAT).
2. No pay-to-rank, no paid badges; if a scored project is a client, say so on its page.
3. "Audited" only as a link to a public report with auditor, date, commit hash and contracts in scope; flag deployed
   code that differs (Arbix, Swaprum).
4. Admin powers count as top risks, never "out of scope" (Merlin).
5. Show fix status and audit age; no single pass/fail.
6. KYC is identity only, never a safety signal (Zoro Inu, Merlin).
7. After an incident the old score stays visible, marked (Merlin's 90).
8. Plain disclaimer: information, not endorsement; link independent sources (Rekt, Solodit, DefiLlama).
