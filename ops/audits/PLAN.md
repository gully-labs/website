# Gully Security: plan

Written 2026-10-18. Status: **planned, nothing offered**. Research and sources: `RESEARCH.md`. Tooling and the
reputation steps follow the playbook already given to the owner (Gully-Security-Audits-Playbook.txt); this plan
reuses it and does not change it.

Ground rules, from day one:
- Today's public service stays **Security & Testing** (code review, fuzzing, invariant tests, post-launch
  monitoring). The word "audit" appears on the site only on the roadmap, as planned, until month 6-12 below.
- Every public claim is backed by a link: a report with a commit hash, a contest result, a paid bounty.
- AI never signs off a finding. Every finding is reproduced by a human with a failing test.

## 1. Products

### (a) AI Security Scan (self-serve)
- Input: a public or private Git repo (Solidity first), a commit hash.
- Runs: Slither, Aderyn, Foundry fuzz and invariant runs (the client's tests plus our generic invariants: ERC-20/4626
  properties, access control, reentrancy guards), optionally Medusa/Echidna; Claude triages the output (removes
  false positives, ranks severity, explains each item, drafts a fix) and cross-checks Solodit for known patterns.
- Output: a private report labelled **"Automated scan, not a review or an audit"**, pinned to the commit.
- Paid with Gully Pay (one-off per scan, or a plan); runs in the developer portal like every other product.
- Sandbox: each scan in a throwaway container with no secrets and no network beyond package registries; repos
  deleted after the scan.

### (b) Smart-contract Security Review, then Audit
- Two independent human reviewers read every line in scope, then cross-check.
- Flow (playbook Part 2): scoping → nSLOC → quote → agreement → frozen commit → threat model → manual review →
  tooling pass → Foundry PoC per finding → draft → client fixes → **fix review of every fix commit** → final report.
- Public report (with consent) in `gully-labs/audits` on GitHub and on the site: scope, commit hash, files, nSLOC,
  dates, reviewers, method, severity scale (Critical/High/Medium/Low/Informational, likelihood x impact), each
  finding with status, fix-review result, disclaimer.
- "Review" until the public record is strong; the premium tier (review + formal checks with Halmos/Certora + full
  fix review + publication) is called an **Audit** only after 10+ public reports and contest results (playbook).

### (c) Code audit for web2 parts
- Scope: dApp frontends, backends and APIs, key and secret management, wallet-connect and signing flows (what the
  user is asked to sign, chain/contract checks, phishing-resistant UX), infrastructure (hosts, containers, DNS,
  CDN, headers) and CI/CD (secrets, supply chain, branch protection, dependency pinning).
- Checklist based on OWASP ASVS (https://owasp.org/www-project-application-security-verification-standard/),
  levels 1-2 by default, plus a Web3 appendix: signature replay, EIP-712 domains, RPC trust, approval scopes,
  hot-key storage, admin-panel exposure.
- Same report shape and publication rules as (b).

### (d) Gully Score (Skynet-style public page per project)
Fully transparent, by design (RESEARCH.md §4):
- Every component, its **numeric** weight and its data source are on the page; the method is versioned with a
  public changelog. Weights are set and published before the first score is shown; none are chosen in this plan.
- **No pay-to-rank.** Payment never changes a score or position; client relationships are disclosed on the page.
- Audit status is only a link to a public report (auditor, date, commit, contracts in scope). If deployed bytecode
  differs from the reviewed commit, the page says so.
- Unreadable inputs show as unreadable, never as a pass or zero. After an incident the previous score stays,
  marked. Identity checks (if ever) are shown as identity only.
- Inputs we already compute or are building:
  - Tracker (live): pools, liquidity, price against fair value, staleness.
  - DeepCore launch and lock data (live via api.deepcore.fun): launch age, liquidity locks and their unlock dates.
  - Holder Map Launch Health (in development on `feat/holder-map`, not on main yet): holder concentration,
    clusters, launch forensics.
  - Admin-key and ownership monitors (product (e) below): owner/admin type (EOA, Safe with threshold, timelock),
    upgradeability, pause powers, mint powers.
- Disclaimer on every page: information, not an endorsement and not investment advice; links to Rekt, Solodit,
  DefiLlama.

### (e) Monitoring
- Events: admin-key changes (`AdminChanged`, role grants/revokes), ownership transfers, large outflows (threshold
  per contract, in USD via the same price feeds as Gully Pay), pauses, proxy upgrades (`Upgraded`), Safe owner or
  threshold changes.
- Delivery: Telegram and signed webhooks, reusing `server/alerts.mjs` (SSRF guard, signing, mute buttons).
- Paid monthly, through the existing plans and Gully Pay; feeds the Gully Score.

### (f) Bug bounty hosting (later)
- Only after (b) has a public record. Until then, point clients to Immunefi or similar.

## 2. Reputation path (playbook Part 3)
1. Public contests every month under the Gully Labs name: Code4rena, Sherlock, Cantina, CodeHawks.
2. Immunefi bounty hunting; paid criticals are the strongest proof.
3. One public repo, `gully-labs/audits`, every publishable report with its commit hash.
4. A few free or discounted reviews for small real projects (e.g. DeepCore launches) in exchange for publication.
5. Listings: DefiLlama audit links for client protocols, Solodit, ecosystem auditor lists (Arbitrum, Base, BNB,
   Solana programmes).
6. SEAL membership and Safe Harbor; honest post-mortems of public hacks, including any client we reviewed.

## 3. Team and tooling
- **Tooling**: exactly the playbook's Part 1 (Foundry, Slither, Aderyn, Echidna, Medusa, Halmos, Certora Prover,
  Mythril, Semgrep + Decurity rules, Wake, Heimdall-rs, Solodit; Trident/cargo-audit for Solana; later Tenderly,
  Dedaub, an AI analyzer as triage only, explorer keys, paid RPC). Reports via Pandoc + LaTeX.
  For (c) add: Semgrep web rulesets, OWASP ZAP, dependency audit (npm audit / osv-scanner), gitleaks or trufflehog,
  and a cloud/container config scanner (Trivy).
- **People**: 1-2 contract reviewers with public contest records first; then a web/app security reviewer for (c);
  two reviewers per engagement minimum.
- **Ops**: legal entity, services agreement, E&O insurance, security@ address with PGP, disclosure policy.

## 4. Milestones
| When | Deliverables |
|---|---|
| Month 0-1 | Toolkit, report and agreement templates, security@ and disclosure policy. AI Security Scan built internally and run on our own contracts (Gully Pay fee proxies, venues). Gully Score method drafted and published as a draft for comment. Public roadmap entry (done: docs /roadmap). |
| Month 1-3 | 1-2 reviewers contracted; monthly contests; 3-5 free/discounted public reviews with commit hashes; `gully-labs/audits` repo. AI Security Scan opens self-serve (paid with Gully Pay), labelled automated. Monitoring alpha on our own contracts. |
| Month 3-6 | Paid Security Reviews (contracts) and the first code audits (web2 parts, ASVS checklist). Monitoring as a monthly product. Gully Score pages for projects whose inputs we already read. Ecosystem auditor list applications. |
| Month 6-12 | Formal verification offering; the premium tier is called an Audit once there are 10+ public reports and contest results; rates raised; bug bounty hosting evaluated. |

## 5. Risks and legal
- **Liability cap** in every agreement: limited to fees paid for the engagement; no liability for losses from code
  out of scope, changed after the reviewed commit, or for admin-key misuse.
- **E&O / professional indemnity insurance** before the first paid review (broker that covers tech and crypto).
- **Disclaimers** on every report, scan and score: point-in-time review of the stated commit; not a guarantee, an
  endorsement or investment advice; scans are automated and not a review.
- **Wording risk**: regulators have warned against reports marketed as "audits" (RESEARCH.md §3.2). We use "audit"
  only for the premium tier, only once earned, and always with scope and commit.
- **Reputation risk** when a reviewed project is hacked: publish an honest analysis, keep the old score marked.
- **Conflict of interest**: Gully Labs runs its own venues and DeepCore; their scores show the relationship, and
  reviews of our own code are labelled internal.
- **Data handling**: private repos under NDA, deleted after engagement; scan sandboxes have no secrets.
- **Capacity**: no engagement accepted without two available reviewers.
