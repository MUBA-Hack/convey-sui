# Convey product roadmap

Convey is a protected-intent financial companion: a person describes a
financial outcome, Convey interprets it and applies deterministic policy, and
the person approves an enforceable Sui agreement. The same front door can
prepare a local or cross-border payment, turn a receipt into obligations, carry
a request between devices, protect conditional funding, or define a tightly
capped treasury policy. Remittance is one deep settlement journey, not the
product definition.

This roadmap is ordered around one coherent customer journey, not around sponsor
logos. Each phase has a customer outcome and a proof threshold. A feature is not
complete because a screen exists; it is complete when the stated evidence can be
reproduced.

## Implementation snapshot

- **Protected intent is now Pay's flagship path.** An executable quote defaults
  to **Protect outcome**. The pre-wallet review shows the original request,
  Gonka model or deterministic fallback, release checks, reviewer, deadline,
  amount, and Sui commitment. Direct send remains one tap away.
- **The AI and policy decision is bound to the agreement.** The quote HMAC and
  outer BLAKE2b-256 commitment preserve the normalized request, live Gonka
  request/model identity or deterministic provenance, deterministic policy
  result, recipient, amount, purpose, workflow, evidence requirements,
  reviewer, expiry, and review note. When private evidence is enabled, the
  canonical artifact is encrypted by a 2-of-2 Seal policy, only ciphertext is
  stored on Walrus, and the locator, digests, Seal identity, and reader set join
  the same commitment. After exact `Created` verification, a bounded local copy
  is retained and the shared Sui object exposes its 32-byte commitment.
- **Six workflows share one contract spine.** Family support, medicine pickup,
  tuition, relief funding, purpose allowance, and refundable link all use the
  same Protected Transfer object, release/refund lifecycle, and receipt
  verifier. The canonical package now also contains `ApprovalCollection<T>` for
  unique M-of-N authorization and `RecurringCap<T>` for per-payment, cumulative,
  interval, expiry, and revocation enforcement. Both have public testnet proofs;
  customer-facing creation flows remain future work.
- **QR has a connected settlement boundary.** QR carries a request across weak
  signal; the connected device reviews it, the wallet approves, Sui settles,
  and Receipts verifies. The transport envelope is not described as payer
  authorization.
- **Enoki sponsorship is public and wallet-controlled.** A private testnet key
  is server-only. The sponsor route re-verifies the quote and exact command
  graph before Enoki pays gas; the customer still signs. Public transaction
  `BWiZmTbtNU6Tm9g3SDNrD6RbmxHsTyjgmssqJxamRM4P` proves distinct payer and gas
  owner. Production budgets, abuse controls, zkLogin restoration, and recovery
  remain future work.
- **Walrus and Seal are integrated into protected planning.** Encryption or
  storage failure stops plan issuance. The wallet atomically creates the funds
  object and matching Seal access policy; the public reference ciphertext
  re-downloads with the exact committed BLAKE2b-256 digest. Reviewer decryption
  UI, reader rotation, and production retention remain future work.

- **The public landing and companion workspace are separate.** `/` tells the
  product story and `/app` provides a full-height text, voice, and receipt
  workspace with desktop context rail and mobile safe-area navigation. Personal,
  NGO operations, and Club treasury are persistent device-local contexts with
  distinct starter requests, operational briefs, main actions, and destination
  rails. Emergency response remains a plain-language request inside Personal.
  Customers can create up to eight device-local NGO, club, business, or
  community workspaces. Bounded workspace and organization context enter the
  redacted Gonka manifest for routing but grant no authority. Requests route
  through a strict Gonka candidate contract with
  pinned-model no-fallback routing and deterministic rebind. The public build
  labels Dave as sample context until the user deliberately remembers it.
  Bounded device-local Agentic Memory is integrated with schema validation,
  inspect, forget, and clear controls. Encrypted multi-device sync, production
  server-backed organization membership, invitations, role-based authorization,
  encrypted cross-device sync, and contact onboarding
  remain future work.
- **Payment risk checks are implemented as advisory policy.** Known/new
  recipient, changed address, unusual amount, duplicate invoice, QR mismatch,
  expiry/replay, urgency, and prompt-injection signals produce explicit hold or
  reject questions. AI disagreement can hold a request but cannot reject it
  without a blocking deterministic fact. The companion now calls the bounded
  two-model route and presents live, partial, local, or unavailable review
  states without exposing model jargon in the primary action.
- **Receipt obligations are implemented as a strict domain core.** Confirmed
  receipt candidates must reconcile item subtotal, tax, service and total;
  shared items use deterministic rounding; duplicate names remain ambiguous;
  chat acknowledgement cannot mark anything paid; settlement requires an
  independent transaction check. Home now includes browser-local photo preview,
  editable receipt lines, duplicate-name disambiguation, explicit confirmation,
  reconciled obligation previews, and honest requested—not settled—status.
  Connected OCR, persistence, messaging, and settlement remain pending.
- **Overnight protection policy is implemented without autonomous execution.**
  A canonical policy hash binds underlying, option side/type, objective,
  premium and loss caps, trade count, expiry, quote age, slippage, active
  window, authority mode and kill switch. Evaluation fails closed and only
  declares eligibility; an explicit execution path plus independent Thetanuts
  `OrderFilled` verification is still required.
- **The companion exposes honest end-to-end journey replays.** Protected
  support invokes a typed create, evidence-review, release, expiry, and refund
  state machine with authority and replay defenses. Overnight protection
  invokes a typed policy, exact approval, order-check, and outcome-verification
  journal with cap, stale-order, pending-submit, and retry defenses. Both are
  deterministic simulations disclosed in their evidence details; neither
  connects a wallet, submits a transaction, broadcasts an order, or replaces
  the live proof thresholds below.
- **Public Gonka provenance lookup is implemented.** Live companion results can
  expose a compact verification link backed by Gonka's unauthenticated receipt
  endpoint. The strict proxy returns request ID, devshard, exact model,
  timestamp, outcome, status, streaming flag, tokens, TTFT and duration only.
  Device-local Activity retains at most 20 bounded request/model/timestamp
  records and re-verifies the exact request and model into explicit verified,
  mismatch, not-found, or unavailable states. This is metadata provenance, not
  a gateway signature.
- **Public claim verification is first-class.** `/verify` accepts pasted text or
  a bounded public page, freezes one exact source claim through Gonka, runs two
  distinct-model Gonka reviews, and shows a 0–100 score, verdict, disagreement,
  separate reasoning, exact source evidence, limitations, model identities, and
  all three request IDs. Unsafe sources, malformed model output, repeated model
  or request identity, and provider failure fail closed. Current live attempts
  returned gateway errors, so a successful hosted report artifact remains a
  delivery gate rather than a claimed outcome.

The current source implements the Ana remittance **quote-to-wallet software
path** on Sui testnet — from natural-language request through a signed
reference quote, connected verification, and client-built testnet-USDC
execution. This is not an end-to-end payout: there is no MYR collection, live
FX, fiat funding, or bank disbursement in this path.

- **Send abroad / Family Rule** is Pay's primary surface. It produces a
  deterministic MYR-to-PHP reference quote, binds an optional purpose and
  per-transfer maximum (the Family Rule) into the HMAC canonical message, and
  guards a testnet-USDC transfer of USDC the wallet already holds. It does not
  charge MYR, obtain live FX, or complete PHP payout. No live USDC digest is
  claimed by this document; release validation and transaction evidence remain
  required.
- **Gonka remittance interpretation is implemented.** GonkaRouter can interpret
  the mixed-language remittance request when configured, behind strict candidate
  schema and deterministic rebind/policy. An honest local fallback is used when
  Gonka is absent, fails, or the candidate is rejected.
- **Family Rule purpose/max binding is implemented.** Purpose and per-transfer
  maximum are included in the quote HMAC, verified before execution, bound at
  the transfer boundary, and shown as **Rule verified** in the terminal receipt.
- **Family Guardian Transfer checks are implemented.** The quote review derives
  recipient, corridor, freshness, family-limit, purpose, and wallet-approval
  findings locally. Missing facts remain **Not stated** and failed checks stop
  the primary action; the panel never claims recipient identity or transfer
  safety.
- **Family Steward advisory message review is implemented.** An optional check
  sends only one bounded payment solicitation to two distinct configured Gonka
  models. Models return exact evidence text plus an occurrence selector; the
  server resolves Unicode code-point spans and preserves distinct model/request
  provenance. The result cannot alter the quote, choose direct/hold, invoke a
  wallet, or authorize value. Unsigned unmapped display quotes are eligible only
  when both recipient address and attestation are null; mapped executable quotes
  require a valid attestation. Honest partial/local fallback remains available.
  A hosted `live_council` run was captured on **2026-09-02** with two distinct
  models and request IDs. Both outcomes independently verify against Gonka's
  public receipt endpoint. A live Created-receipt Evidence Council artifact is
  still outstanding.
- **Protected Transfer Evidence Council is implemented.** It appears only in a
  freshly verified Created receipt and accepts bounded pasted evidence. The
  server repeats the fixed-testnet Created check, sends the same text to two
  distinct configured Gonka models, resolves their exact Unicode evidence
  spans, and independently checks recipient, purpose when present, and an exact
  bound MYR or PHP amount. Results remain strictly separated as
  `ready_for_human_review`, `questions_needed`, `disputed`, `unavailable`, or
  `rejected`. The canonical artifact
  carries two-model/request provenance and stable evidence/artifact digests,
  but is advisory only: the assigned human reviewer and connected wallet remain
  the release authority. No successful live council artifact is claimed.
- **Medicine pickup is implemented as a bounded Protected Transfer mission.**
  Selecting the purpose progressively reveals three fictional reference
  pharmacy names and a bounded pharmacy order-number field. The client derives
  the next Manila 09:00–17:00 PHT pickup window from the quote's `issuedAt`,
  threads the beneficiary reference from the quote, and binds a strict
  `pharmacy_order` manifest digest into the existing escrow evidence commitment.
  Its deadline policy exposes only `three_days`, while the general
  family-support mission retains the three bounded presets. This is an initial
  order commitment only: it does not prove partnership, prescription validity,
  medicine authenticity, pickup, settlement, or release approval.
- **Signed-quote cross-device QR carry, camera scan, and connected verify/review
  are implemented.** A discriminated handoff wrapper carries the existing strict
  QuoteEnvelope; the camera scanner uses `@zxing/browser` and feeds both
  commerce and remittance payloads into the same strict import discrimination;
  the connected device re-runs verification before the wallet opens.
- **Commerce QR envelope remains checksum/device-local replay and distinct.** It
  is not relabeled as the remittance handoff and adds no payer signature or
  cross-device replay authority.
- **Buy nearby** (River Cafe native-SUI commerce) remains a separate secondary
  capability, never relabeled as the Ana remittance.
- **Treasury Purchase Power Shield purchase and proof are implemented.** A
  strict deterministic goal parser extracts ETH/BTC asset, objective, and
  integer horizon (1..365 days). The actionable path enforces an exact-micro
  0.000001–3 USDC premium cap, discovers and previews bounded Base-mainnet orders, and
  requires review before an external wallet is connected. A short-lived plan
  refetches the exact signed order, checks current allowance, and returns exact
  approval or fill calldata. The order is refetched after approval and again
  immediately before fill. Only the customer can approve and submit through the
  Base wallet; the server holds no key. Durable intent/hash recovery and a
  browser-wide lock prevent silent duplicate submission. Independent
  verification binds the transaction, decoded signed order, signature, both
  expiries, and exactly one matching `OrderFilled` event before `/proof?o=` is
  created. Family Watch remains contextual only: this is not an FX hedge and
  does not protect the MYR→PHP rate or payout. The official live order index is
  currently unavailable, and no real transaction was submitted or captured in
  this work.
- **Receipts** accepts local, asset-aware native-SUI commerce and confirmed Sui
  testnet-USDC remittance receipts. Remittance receipts bind settlement
  evidence to the signed quote, independently check the digest, successful
  transaction, pinned USDC type, recipient, and exact amount through a
  server-only read-only testnet lookup, expose share/export only after that
  check confirms, and re-check quote attestation server-side including a
  historical evidence mode for expired-but-genuine quotes. Checking, verified,
  rejected, not-found, and unavailable remain distinct states. A carried receipt
  alone is not proof; the surface does not prove bank or cash payout, and the
  quote HMAC is server-held symmetric integrity, not public non-repudiation.
  It also accepts strict Protected Transfer Created and terminal receipts.
  `/proof?t=...` binds the terminal receipt locally, repeats exact Created and
  `Released`/`Refunded` checks, and uses a separate strict open-object read only
  when the terminal event is not found. Only that live open match can show the
  transfer as still protected. Verified, pending, rejected, and unavailable
  remain distinct; terminal share/export requires verified lifecycle evidence.
  `/proof?o=...` locally binds a portable protection-purchase receipt and repeats
  direct Base verification before enabling share/export.
- **Activity is a bounded device-local convenience surface.** A no-query
  `/proof` view strictly parses up to 20 local receipt links, orders them by
  update time, and fails closed to an empty state on malformed storage. Opening
  an item reuses the existing receipt verifier; local history never upgrades a
  receipt into settlement or chain evidence. A Protected Transfer is recorded
  only after its submitted transaction passes the exact independent `Created`
  event check. Submitted, unknown, rejected, malformed, sample, and imported
  receipts are not recorded. Verified direct remittance, terminal Protected
  Transfer, and Treasury protection-purchase receipts now record their native
  proof links. Nearby commerce remains pending.
- **Seedless Sui onboarding (zkLogin via Enoki) is implemented.** Enoki wallet
  registration and Google sign-in are wired through dApp Kit, with the
  registered redirect URI pinned to the origin. Live session restoration,
  salt/prover handling, and captured restoration evidence remain pending, so
  the feature is not yet presented as a proven onboarding path.

Fiat on/off-ramp, payout, recipient intelligence, nearby-commerce Activity, a production
signed offline envelope, a captured real Thetanuts fill and Sui Earn remain
future evidence, not shipped outcomes. Protected Transfer now leads a canonical
four-module Move package with a tested single-milestone agreement, pinned
TypeScript transaction core, bounded plan and Created-event
verification endpoints, an integrated Pay creation path, terminal action/event
verification, and a `/proof?t=` terminal receipt lifecycle. After wallet
submission, only an exact independent Created-event match can produce the
portable receipt and the **Agreement live on Sui** state; Receipts repeats that
check before share/export. Terminal builders, fixed-testnet `Released`/
`Refunded` verification, open-state checking, terminal receipt binding, and the
customer-first receipt states are implemented. A fresh-verified Created receipt
offers release to the connected reviewer through the deadline or refund to the
connected payer after it. The eligible wallet signs and submits; strict terminal
verification must match before the product builds the receipt and navigates to
`/proof?t=...`. After a valid digest returns, the action stays locked against
resubmission; `not_found`/`unavailable` retain an explorer link and can retry
verification only, while mismatched evidence remains review-needed. The
package is published on Sui testnet; public native-SUI release and
expiry-refund lifecycles exist, and a public Enoki-sponsored 1 testnet-USDC
lifecycle proves Created, a distinct gas owner, independent-reviewer Released,
exact beneficiary credit, and terminal escrow consumption. This is a public
testnet transaction proof, not a fiat payout artifact. The freshly verified Created receipt also embeds the shipped
Evidence Council: bounded pasted text, a repeated Sui Created check, two
distinct configured Gonka models, server-resolved exact spans, deterministic
recipient/purpose/bound-MYR-or-PHP checks, and a stable advisory artifact for the human
reviewer. It has no signing or release authority, and no successful live
Evidence Council artifact has been captured. The canonical package passes 29/29
tests with Sui CLI v1.79.0.
The signed-quote handoff wrapper in the tree is a transport envelope
with no outer signature; a production signed offline envelope with cross-device
replay authority is future work.

## Product principles

- Use one primary customer promise: **describe an outcome and approve an
  enforceable Sui agreement**. Chat, voice, QR, workflow templates, and Receipts
  are entry points or proof surfaces around that promise. Keep Treasury visibly separate.
- Abstract wallet complexity without hiding user authority or transaction risk.
- Separate the states **draft**, **reviewed**, **authorized**, **submitted**,
  **settled**, and **failed**.
- Treat AI output as a typed proposal. Deterministic code validates recipients,
  amounts, assets, networks, limits, expiries, the Family Rule, and transaction
  bytes.
- Keep Sui payment activity and Base options activity visibly and technically
  separate.
- Never call a QR intent, local receipt, or provider quote a completed payment.
- Prefer one trustworthy end-to-end corridor over many unsupported country or
  payout claims.

## Now — send reliably

### 1. Conversational remittance with a Family Rule

Turn a spoken or typed request into a transparent cross-border payment review
with a signed Family Rule.

**Status: software implementation complete; protected testnet-USDC lifecycle
captured.** The source has a single
MYR-to-PHP reference corridor, integer fee/FX calculations, expiring quote
envelopes, server-only attestation and verification, explicit recipient
mapping, Family Rule (purpose and per-transfer maximum) binding, and
client-built testnet-USDC execution. It also has an independent receipt verifier
for exact Sui testnet settlement evidence. The published contract now has a
public 1 testnet-USDC Created → reviewer Released artifact. Live pricing and
fiat funding/payout remain outstanding.

Customer flow:

1. Say or type the recipient, destination, amount, purpose, and optional
   per-transfer maximum.
2. Resolve ambiguities before showing a transaction.
3. Display source amount, exchange rate, fees, stablecoin settlement amount,
   payout method, arrival estimate, and the Family Rule row.
4. Review the recipient and route independently from the AI interpretation.
5. Approve the Sui transaction in the user's wallet.
6. Track on-chain settlement separately from bank or cash payout, with a
   **Rule verified** receipt row.

Implementation boundary:

- The current execution increment pins six-decimal USDC to Sui testnet in
  `lib/remittance/constants.ts`. Keep asset, network, and decimal checks
  independent of model or quote-response fields. Mainnet asset/corridor approval
  is a separate decision.
- Keep payout-provider and regulated-corridor claims behind real provider access.
- Reference MYR/PHP amounts are not funds collected or disbursed. A testnet USDC
  receipt must retain **Awaiting family payout** until a real payout integration
  provides separate evidence.
- Receipts now accepts an asset-aware remittance receipt schema after confirmed
  settlement; it checks local structure and quote binding, re-verifies the
  quote server-side, and independently checks Sui settlement through a bounded
  read-only testnet lookup. Payout verification remains separate.
- `POST /api/remittance/settlement/verify` fixes Sui testnet, its RPC, and the
  pinned USDC server-side; accepts the whole strict receipt through a 16 KiB
  streaming cap; makes at most one `getTransaction`; aborts after six seconds;
  returns a strict safe union with `no-store`; and never signs or submits.
- Verified requires a successful transaction plus exact digest, pinned USDC,
  canonical recipient, and micro amount. The shared client-safe schema binds the
  response to the active receipt; malformed, extra, stale, or mismatched evidence
  cannot unlock share/export.

Exit evidence:

- A real wallet approval and reproducible Sui transaction digest artifact,
  independently re-checked through the receipt verifier.
- A reproducible quote with itemized fees and no hidden exchange-rate spread.
- Explicit recipient, asset, network, Family Rule, and payout-state binding.
- A provider response for the payout leg, or a clear on-chain-only boundary.

### 2. Gonka-powered remittance interpretation

Use **GonkaRouter** for multilingual intent extraction and accessible
explanations across the remittance journey. Gonka is the decentralized inference
network; GonkaRouter is the hosted router used by the product.

**Status: implemented for remittance, commerce, and advisory Family Steward;
publicly verified Family Steward evidence captured.**
Both Send abroad and Buy nearby use the Gonka candidate/policy path when
configured. The remittance candidate is untrusted and re-resolved against the
original text and the canonical manifest by
`resolveGonkaRemittanceCandidate`. This workspace has a local gitignored key;
a successful captured multilingual request with matching live provenance remains
required. Family Steward asks two distinct configured models to inspect only a
bounded solicitation message. The **2026-09-02** live council returned distinct
request/model provenance, and both public Gonka receipts verify successfully.

The model may propose:

- action and payment purpose;
- recipient reference and destination;
- source or target amount and currency;
- missing fields and ambiguity;
- bounded warning-signal IDs and exact evidence text plus a one-based occurrence
  selector for the optional message review;
- fixed verification-question IDs.

The model may not:

- invent or silently replace a recipient;
- construct arbitrary transaction bytes;
- bypass amount, asset, network, balance, expiry, Family Rule, or policy checks;
- label a sender or message safe or fraudulent, change the deterministic
  direct/hold paths, or select the hold option;
- sign, settle, release escrow, or trade options.

The server, not the model, resolves evidence spans in Unicode code-point space.
Missing or out-of-range occurrences are rejected. A live council requires two
different configured model IDs plus distinct response model and request IDs;
otherwise the endpoint returns a truthful partial review, local fallback, or
rejection. A fresh unsigned/unmapped display quote is accepted only when both
`recipientAddress` and `attestation` are null. A mapped quote must have a valid
attestation. This is message-review eligibility, never payment authorization.

Exit evidence:

- A real GonkaRouter request in the primary remittance path with model and
  request metadata.
- A successful Family Steward council with two distinct model IDs, two distinct
  request IDs, server-resolved exact evidence, and captured safe response.
- Malformed-output, timeout, model-mismatch, and fallback tests.
- At least one mixed-language remittance request that stops for clarification
  when uncertain.
- A deterministic policy decision between model output and wallet approval.

### 3. Signed-quote cross-device handoff

Carry the exact signed quote by QR to a connected device, scan it, verify it,
and approve it.

**Status: implemented; cross-device replay authority outstanding.** A
discriminated handoff wrapper carries the existing strict QuoteEnvelope; the
camera scanner uses `@zxing/browser` and feeds both commerce and remittance
payloads into the same strict import discrimination; the connected device
re-runs verification before the wallet opens. The wrapper adds no outer
signature, checksum, or replay promise; quote attestation/expiry and the
connected verify endpoint remain authoritative. Its server-only verification
evaluator uses the exact freshness interval `issuedAt <= now < expiresAt` and
fails closed for invalid or pre-issuance clock input, with deterministic tests
covering both boundaries and historical-evidence separation.

Customer flow:

1. Get a signed quote on Pay.
2. Choose **Carry quote** to render a QR of the signed quote envelope.
3. On a connected device, open **Scan and Pay** and tap **Scan QR**.
4. The connected device discriminates kind, decodes the handoff, verifies
   attestation/recipient/corridor/amount/expiry, and shows a **Quote carried —
   Not paid yet** review card.
5. Choose **Protect outcome** or **Send now**, approve the exact Sui transaction
   in the wallet, and keep the independently checked receipt.

Exit evidence:

- Signed quote creation while connected, followed by network-free carry and
  connected verification and approval on the destination device.
- Rejection tests for tampered quotes, wrong recipient, wrong network, expired
  quotes, and clock skew.
- A clear no-funds-move boundary during the carry.

### 4. Resilient offline commerce handoff

The offline commerce envelope transports a native-SUI purchase intent across
an air gap. It is an offline transport mechanism, not offline blockchain
settlement.

**Status: implemented as checksum/device-local replay; cross-device authority
outstanding.** The commerce envelope provides a checksum, expiry, and
device-local nonce registry, but no payer signature, shared nonce authority, or
cross-device replay registry. It is distinct from the signed-quote remittance
handoff and is not relabeled as it.

Every commerce intent binds:

- exact amount and asset;
- chain and network;
- merchant or recipient;
- order identifier and nonce;
- issued-at time and expiry.

The current connected-device flow validates the checksum and expiry, shows an
exact human review, and consumes the nonce in device-local storage before the
guarded checkout can continue to wallet approval and Sui receipt verification.
The QR carries the request; it does not authorize the payer. A payer-signed redemption envelope, shared
authoritative nonce registry, and cross-device reconciliation remain future
exit gates, not properties of the current transport.

Exit evidence:

- Offline creation followed by online verification and redemption.
- Rejection tests for replay, expiry, tampering, wrong recipient, wrong network,
  copied screenshots, and clock skew.
- Conservative offline value and lifetime limits.
- Distinct visible states for intent created, verified, submitted, and settled.

### 5. Seedless Sui onboarding

Add **Sui zkLogin**, optionally through **Enoki**, so customers can create a
self-custodial Sui account with a familiar OAuth identity instead of a seed
phrase. Sponsored gas is a separate capability and must use an allowlisted
backend policy.

**Status: implemented; live restoration/evidence pending.** Enoki wallet
registration and Google sign-in are wired through dApp Kit, with the registered
redirect URI pinned to the origin so a deep-route sign-in does not send an
unregistered `redirect_uri`. The wallet is identified by Enoki's metadata
feature, never by display name. When Google is available, the sign-in dialog
explains the seedless Sui account and per-agreement approval boundary. Live
session restoration across sessions, salt/prover lifecycle handling, and
captured restoration evidence remain outstanding, so zkLogin restoration is
not yet a proven onboarding path. Testnet gas sponsorship is separately live:
an exact command-graph policy, server-only Enoki key, customer signature, and
public sponsored transaction prove the boundary. Production sponsor budgets,
origins, rate limits, monitoring, and abuse controls remain exit evidence.

This feature does not provide credit-card funding, off-ramping, or autonomous
control of the customer's funds.

Exit evidence:

- OAuth sign-in creates or restores the same Sui address reliably.
- The customer still approves value-moving transactions.
- Recovery, logout, session expiry, salt/prover handling, and sponsor-budget
  failure states are tested.
- No OAuth token, salt, sponsor key, or wallet secret reaches browser logs or
  repository history.

## Next — protect recipients

### 6. Protected Transfer

Complete the narrow, human-reviewed escrow lifecycle already initiated inside
the existing Pay journey.

**Status: canonical four-module contract published; intent-bound transaction
core, strict Enoki sponsorship, 2-of-2 Seal encryption, Walrus ciphertext
storage, same-transaction access policy, bounded verification endpoints,
creation path, advisory Evidence Council, role/deadline-gated terminal wallet
bridge, M-of-N collection, recurring hard caps, and portable Created/terminal
receipt lifecycle implemented. Public sponsored testnet-USDC release,
threshold-release, recurring-collection, native-SUI release, and expiry-refund
references are captured; a product-generated live Evidence Council artifact and
customer screens for collection/mandate creation remain incomplete.** Executable quotes now default to **Protect outcome** with
**Send now** one tap away inside Pay. The protected path requests a strict plan, builds the
pinned `create_escrow` transaction client-side, requires a connected Sui
testnet wallet, and locks duplicate submission. It remains pending after wallet
submission until the fixed-testnet verifier matches the exact Created event;
only then does Pay show the held state and open the bound portable receipt. The
current Move package supports one full-balance release or
post-deadline refund. It does not implement multiple milestones, automated
delivery verification, disputes, early cancellation, matched grants, or model
authority. The server endpoint authors the plan from a verified quote,
workflow-allowed deadline preset, server-derived evidence requirements, review
note, and configured candidate coordinates, but its unsigned
response cannot prove publication, deployment, immutability, or on-chain state.
The Created verifier performs one fixed-testnet read and exact BCS event binding.
Pay binds a verified response to the plan and transaction metadata; Receipts
strictly parses that document and independently repeats the Created check before
enabling share/export. This proves creation only. Terminal transaction builders
and strict `Released`/`Refunded` event/open-state evaluators feed the terminal
receipt flow at `/proof?t=...`. It strictly binds the carried Created and
terminal evidence, independently repeats both event checks, and queries exact
open object state only after terminal `not_found`. Verified release/refund,
live-open pending, rejected, and unavailable are separate customer states;
share/export requires verified terminal evidence. A fresh-verified Created
receipt selects exactly one action: reviewer release at or before the deadline,
or payer refund after it, only for a connected Sui testnet wallet matching that
role. The wallet signs and submits the pinned call; the bridge verifies the
exact terminal digest/event, builds the bound receipt, and navigates to
`/proof?t=...`. A valid submitted digest keeps that action attempt locked
against resubmission and preserves its explorer link. Only `not_found` or
`unavailable` can retry strict verification; mismatched evidence stays
review-needed. Command-line wallets produced the public native-SUI release
artifact `D8fXy9g89WqhKKRYQmsxpEdprqSJCtvh24XKsmiFqoi1` and
deadline-refund artifact `7x5YRgTCSQMadUmswaBqXkfk8EARUwnE7CYkija5GKCv`;
no bank/cash payout is claimed. The Move package passes 29/29 tests with Sui CLI
v1.79.0.

The canonical agreement commitment now covers the original request, live Gonka
request/model identity or deterministic fallback, policy result, exact payment
terms, workflow, evidence checklist, reviewer, expiry, and review note. The full
artifact is Seal-encrypted and its ciphertext stored on Walrus before plan
issuance; a bounded device-local copy is retained only after exact Created
verification. Family support, medicine pickup, tuition, relief, purpose
allowance, and refundable link use the same object spine. Multi-approver
collections and recurring mandates are distinct on-chain objects in the same
package, with public proofs rather than relabeled screens.

The implemented Sui Move escrow object records:

- payer and beneficiary;
- asset and amount;
- one deadline;
- reviewer or arbiter;
- evidence commitment;
- release and refund paths.

Evidence Council now extracts bounded facts from pasted evidence with two
distinct configured Gonka models, resolves exact spans server-side, and combines
them with deterministic recipient, purpose, and exact MYR/PHP amount checks.
It runs only after a fresh Created re-check and produces a digested advisory
artifact with provenance. It never releases funds. The assigned human reviewer
remains the only release authority, and the payer refund becomes valid strictly
after the deadline. The on-chain evidence commitment and the advisory artifact
digest record exact metadata; neither validates the underlying evidence nor
authorizes an on-chain action.

Next implementation sequence:

1. Preserve the published package, upgrade authority, source, bytecode, and
   explorer evidence without claiming immutability prematurely.
2. Keep both bounded endpoints configured to the published package and reviewer; retain strict quote,
   package, reviewer, event-field, and response binding.
3. Capture a product-generated real testnet-USDC Created receipt showing the
   escrow object, payer, beneficiary, reviewer, asset, amount, deadline,
   evidence commitment, and independent re-check result.
4. From that freshly verified receipt, capture a successful live Evidence
   Council artifact with two distinct model/request identifiers, exact spans,
   deterministic checks, and a reproducible artifact digest.
5. Exercise both terminal paths through product wallets; the native-SUI
   command-line release and post-deadline refund are done.
6. Capture reproducible product-generated terminal receipts for `Released` and
   `Refunded`, plus the verified-open state; keep every escrow state separate
   from bank or cash payout.

Exit evidence:

- A deployed Sui Move package and one complete on-chain lifecycle.
- Tests for unauthorized release/refund, duplicate terminal action, exact
  deadline boundaries, zero funding, commitment length, and destination binding.
- An audit trail connecting the evidence hash, model assessment, reviewer
  decision, and Sui action.
- A visible human decision that cannot be bypassed by model output.

### 7. Safer recipients and shared expenses

Make everyday payments safer and more useful without adding new top-level
navigation.

- **Recipient check:** explain concrete warning signals such as a changed
  destination, first-time recipient, unusual amount, expired handoff, replayed
  nonce, or merchant mismatch.
- **Receipt split:** a confirmed remittance receipt now supports an exact
  integer-USDC split for two to eight people. Every participant and allocation
  must be confirmed and reconcile to the source before copyable request text is
  produced. Receipt scanning and AI-proposed line items remain future work.
- **Family payout:** save a verified recipient and payout preference, but
  require step-up review when account details change.
- **Guardrails:** let customers set a spending envelope for a card, recipient,
  merchant category, amount band, date window, and destination country so a
  payment stays inside an explicit policy.
- **Split request:** convert a bill, dinner, or trip receipt into confirmable
  split requests that reconcile exactly before any money moves.
- **Proof-first history:** keep the original intent, edits, approvals, and
  settlement evidence together so the receipt can be explained later without
  implying hidden automation.

Exit evidence:

- Risk explanations cite deterministic signals and never invent fraud claims.
- Receipt totals, tax, tip, rounding, and participant allocations reconcile
  exactly.
- Changed-recipient and unusual-amount flows stop before authorization.
- Spending envelopes reject out-of-policy requests before wallet approval.
- Split requests produce exact totals and preserve each participant decision.

## Then — manage treasury deliberately

### 8. Treasury protection with Thetanuts Finance

Use the official **Thetanuts Finance** SDK for a separate Base-mainnet workflow
that protects a future ETH purchase or treasury exposure. This is not a Sui
settlement feature and does not protect the MYR→PHP rate.

**Status: bounded external-wallet purchase, independent verification, and
portable proof implemented; live transaction evidence remaining.** Discovery
uses a deterministic goal parse and a bounded Base-mainnet order read. The
purchase boundary enforces a strict exact-micro 0.000001–3 USDC cap. Preparation
refetches the selected signed order, checks its identity and freshness, previews
the exact cap, reads allowance, and returns exact approval or fill calldata in a
short-lived plan. The server has no key and cannot approve or submit. The
customer's external wallet is the only transaction authority. The linked
remittance context remains informational only and never implies an FX hedge or
payout protection. The official live order index is currently unavailable, so
no real order, approval, fill, or verified receipt was captured in this work.

Customer flow:

1. Describe a protective-put goal in natural language and choose a 0.000001–3 USDC
   premium cap.
2. Strict deterministic parse extracts ETH/BTC asset, objective, and integer
   horizon 1..365; fractional or oversized horizons return a safe
   clarification. The cap is a separate exact-micro field; the parser never
   extracts or implies it from goal text.
3. Fetch live Thetanuts OptionBook orders (one bounded call, at most 200
   inspected).
4. Deterministically select the lowest-price maker-sell put matching the asset
   and binding horizon; reject stale, wrong-side, wrong-type, wrong-asset, or
   wrong-collateral orders to `no_match`.
5. Show floor, expiry, premium cap, and Base network for explicit customer
   review.
6. Connect an external wallet, refetch the exact signed order, validate maker,
   taker, signature, collateral, asset, option type, nonce, strikes, price,
   available amount, signed-order runway, option expiry, and preview economics.
7. Read current allowance and prepare either the exact USDC approval calldata or
   the exact OptionBook fill calldata. Bind the wallet, chain, targets, zero
   value, signed terms, and fill-data hash into a plan valid for at most 30
   seconds.
8. Require explicit wallet approval. After an approval confirms, refetch the
   order. Immediately before fill, prepare and compare it again so stale terms
   never reach the wallet.
9. Persist durable intent before each wallet request and the returned hash after
   submission under an exclusive browser lock. Reloads and other tabs recover
   into confirmation or verification instead of sending again; an uncertain
   lost hash stops for manual wallet review.
10. Verify the fill directly from Base: exact transaction, decoded signed
    `fillOrder`, signature hash, execution before signed-order and option expiry,
    and exactly one matching `OrderFilled` event.
11. Build `/proof?o=` only after verification. Reopening the portable receipt
    validates local bindings and repeats the Base check. Premium, fee, and
    referral fee remain separate fields; there is no fee-inclusive total-cost
    claim.

Exit evidence:

- Bounded order read, deterministic selection, exact preview and calldata,
  strict 0.000001–3 USDC cap, allowance branching, live refetch, and fail-closed tests.
- External Base-wallet approval and fill submission with no server key.
- Durable reload/cross-tab no-double-submit recovery.
- Direct transaction, signed-order, dual-expiry, and unique `OrderFilled`
  verification plus portable `/proof?o=` proof.
- A small customer-approved Base-mainnet fill and verified receipt remains an
  evidence gate. No real transaction was submitted or captured in this work;
  the official live order index is currently unavailable.

## Later — Sui-native savings

### 9. Convey Earn

Build the useful product idea behind risk-tranched stablecoin savings directly
on Sui instead of adding a cross-chain dependency. Convey Earn would let
customers explicitly move idle Sui stablecoins into transparent Move vaults
with two risk positions:

- **Steady pool:** receives a lower target return and is protected by the risk
  pool's first-loss capital up to the disclosed coverage limit.
- **Risk pool:** receives a larger share of yield in exchange for absorbing
  losses first.

This is configurable risk allocation, not guaranteed yield or principal
protection. The interface must show where yield comes from, utilization,
variable APY, available liquidity, fees, withdrawal timing, current first-loss
coverage, and the exact loss waterfall before a deposit is authorized.

Proposed Sui architecture:

- A shared Move vault object holds one pinned Sui stablecoin type.
- Steady and risk pool shares are separate typed receipt objects or fungible
  share assets.
- Deposits and withdrawals use deterministic share accounting with explicit
  rounding rules.
- A strategy adapter may allocate capital only to allowlisted Sui protocols and
  within on-chain exposure limits.
- Yield and losses are realized into the vault before share prices are updated.
- The risk pool absorbs losses first; the steady pool is affected after
  first-loss capital is exhausted.
- Emergency pause stops new deposits and strategy allocation without blocking
  safe withdrawals unnecessarily.
- Governance changes use a timelock and emit events that the product can explain
  before they take effect.

Customer safeguards:

- Never sweep a payment balance into Earn automatically.
- Require explicit, revocable authorization for every deposit or recurring rule.
- Keep payment funds, Protected Transfer funds, and Earn vault shares visibly
  separate.
- Display smart-contract, stablecoin, liquidity, oracle, strategy, and
  principal-loss risk.
- Do not label the steady pool "safe," "insured," or "guaranteed."

Exit evidence:

- Move unit tests for deposits, withdrawals, share pricing, rounding, yield
  distribution, first-loss allocation, depleted coverage, pause, and
  unauthorized administration.
- Invariant or property tests proving assets equal liabilities through
  randomized deposit/loss/withdrawal sequences.
- A deployed Sui testnet vault with explorer-linked deposit and withdrawal
  receipts.
- A transparent strategy allowlist and a reproducible loss-waterfall example.
- Independent contract review before any mainnet or real-value claim.

## Track alignment

Each track lists which load-bearing capabilities are **current** (implemented in
this source) and which are **future** (still required for a complete submission).

| Track | Current capability | Future capability | Evidence judges should see |
| --- | --- | --- | --- |
| Sui Payments & Stablecoins | Canonical four-module package; pinned testnet-USDC execution; public Enoki-sponsored 1 USDC creation/release; same-transaction Seal policy; verified Walrus ciphertext; 2-of-2 collection release; recurring per-payment/cumulative cap; portable receipts | Production audit, sponsor abuse controls, compliant FX/funding/KYC/payout, and customer collection/mandate screens | Package, sponsored gas owner, USDC terminal digests, ciphertext digest, threshold approvals, cap event, exact beneficiary delivery |
| Sui AI x Sui | Gonka-interpreted intent behind deterministic policy; model/request provenance in the wallet-signed commitment; public human-reviewed Sui release; contract-family policies reuse the committed-intent model | Live Evidence Council artifact joined to a product-generated Created receipt | Distinct model/request provenance, policy digest, wallet signature, sponsor, Sui objects, and verified terminal action |
| Thetanuts Best Product Built on the SDK | Bounded Base-mainnet discovery; strict 0.000001–3 USDC plan; exact allowance, approval and fill requests; external-wallet authority; durable recovery; direct fill verification; portable `/proof?o=` receipt | Restore official live order-index access and capture a minimal customer-approved fill plus verified receipt | Exact wallet prompts, Base transaction, unique `OrderFilled` evidence, and portable verified receipt |
| Thetanuts AI x Options | Natural-language risk goal with deterministic rebind, signed-order selection, reviewed wallet boundary, and independently checked outcome | Model-routed constraint extraction and captured live transaction evidence | Bound goal, reviewed terms, customer authorization, and verified Base outcome |
| GonkaRouter AI For Society | First-class text/link claim verification with extraction, two distinct model reviews, score, reasoning, exact evidence, consensus state, and request IDs; mixed-language remittance, Family Steward, and AI-decision provenance remain tied to enforceable Sui agreements | One successful hosted verification report, captured multilingual remittance evidence, and a live Created-receipt Evidence Council artifact | Three public request IDs, visible model disagreement, exact evidence, uncertainty handling, committed decision, and social-impact payment path |

## Delivery gates

Every roadmap increment must pass the same gates before it is presented as
complete:

1. **Product truth:** every status and receipt corresponds to an observed state.
2. **Authority:** AI cannot sign, redirect, release, or trade.
3. **Security:** secrets remain server-side; replay, expiry, recipient, network,
   amount, and Family Rule checks are tested.
4. **Accessibility:** keyboard, screen-reader, reduced-motion, narrow-screen,
   and low-connectivity paths remain usable.
5. **Visual quality:** the primary task is obvious, review precedes authority,
   and technical detail appears only when it helps a customer decide.
6. **Evidence:** tests, chain receipts, provider metadata, and limitations are
   reproducible.
7. **Documentation:** README and product copy match the implemented behavior
   exactly.

## Decisions still required

- Replace the reference payout boundary with a live, compliant funding and
  payout partner; preserve explicit pending, failed, refunded, and settled
  states without treating an on-chain transfer as proof of bank disbursement.
- Production corridor approval, payout partner, KYC flow, refund policy, and
  jurisdiction coverage; MYR-to-PHP is currently a reference corridor only.
- Mainnet stablecoin and execution approval. The current testnet increment
  already pins six-decimal Sui USDC; it does not authorize production deployment.
- Bridge commercial access and supported payout geography.
- Production zkLogin prover/salt/session recovery, Enoki origin and budget
  controls, sponsor rate limiting, monitoring, and key rotation. Testnet
  sponsorship and a public sponsored transaction are complete.
- GonkaRouter production key policy, distinct Family Steward/Evidence Council model pair,
  provider availability/timeout policy, data policy, and latency target.
- Protected Transfer policies, reviewer authority, evidence retention, and
  dispute process.
- Offline commerce value limit, maximum age, nonce authority,
  merchant-loss allocation, and clock-skew tolerance.
- Supported option-market policy, production RPC/index availability, wallet
  support policy, and evidence procedure for the existing 0.000001–3 USDC
  Base-mainnet purchase cap.
- Convey Earn stablecoin type, yield source, strategy allowlist, tranche
  parameters, oracle policy, governance, and loss-coverage disclosure.
