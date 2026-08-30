# Convey product roadmap

Convey is one Ana-centered remittance journey: a spoken or typed MYR-to-PHP
request becomes a signed reference quote carrying a Family Rule, then a guarded
Sui testnet-USDC wallet transfer of USDC the wallet already holds. The exact
signed quote can be carried by QR to a connected device, camera-scanned,
server-verified, and explicitly approved. An optional ETH treasury preview is
related planning context only.

This roadmap is ordered around one coherent customer journey, not around sponsor
logos. Each phase has a customer outcome and a proof threshold. A feature is not
complete because a screen exists; it is complete when the stated evidence can be
reproduced.

## Implementation snapshot

The current source implements the Ana remittance journey end to end on Sui
testnet:

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
- **Protect remains read-only/educational.** The linked remittance context is
  implemented (an optional ETH treasury preview reachable from a quote), but
  there is no FX hedge, no MYR→PHP protection, and no trade execution.
- **Verify** remains a local, native-SUI commerce-receipt verifier; USDC
  remittance receipts are not yet supported there.

Fiat on/off-ramp, payout, zkLogin, Move escrow, recipient intelligence, receipt
splits, real Thetanuts trade, and Sui Earn remain future work, not shipped
capabilities.

## Product principles

- Use customer jobs as the interface: **Pay**, **Pay offline**, **Protect**, and
  **Verify**.
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

## Now — the Ana remittance journey

### 1. Conversational remittance with a Family Rule

Turn a spoken or typed request into a transparent cross-border payment review
with a signed Family Rule.

**Status: implemented; exit evidence incomplete.** The source has a single
MYR-to-PHP reference corridor, integer fee/FX calculations, expiring quote
envelopes, server-only attestation and verification, explicit recipient
mapping, Family Rule (purpose and per-transfer maximum) binding, and
client-built testnet-USDC execution. Live pricing, fiat funding/payout, and a
reproducible real settlement receipt remain outstanding.

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
- Use **Bridge, a Stripe company**, as the Sui-compatible fiat/stablecoin
  integration candidate. Stripe's general crypto onramp does not currently
  document Sui support.
- Keep payout-provider and regulated-corridor claims behind real provider access.
- Reference MYR/PHP amounts are not funds collected or disbursed. A testnet USDC
  receipt must retain **Awaiting payout partner** until a real payout integration
  provides separate evidence.
- Extend Verify with an asset-aware remittance receipt schema before claiming
  portable USDC proof support.

Exit evidence:

- A real wallet approval and Sui transaction digest.
- A reproducible quote with itemized fees and no hidden exchange-rate spread.
- Explicit recipient, asset, network, Family Rule, and payout-state binding.
- A provider response for the payout leg, or a clear on-chain-only boundary.

### 2. Gonka-powered remittance interpretation

Use **GonkaRouter** for multilingual intent extraction and accessible
explanations across the remittance journey. Gonka is the decentralized inference
network; GonkaRouter is the hosted router used by the product.

**Status: implemented for remittance and commerce; live evidence outstanding.**
Both Send abroad and Buy nearby use the Gonka candidate/policy path when
configured. The remittance candidate is untrusted and re-resolved against the
original text and the canonical manifest by
`resolveGonkaRemittanceCandidate`. A live key/request and captured multilingual
evidence remain required.

The model may propose:

- action and payment purpose;
- recipient reference and destination;
- source or target amount and currency;
- missing fields and ambiguity;
- evidence-backed risk explanations.

The model may not:

- invent or silently replace a recipient;
- construct arbitrary transaction bytes;
- bypass amount, asset, network, balance, expiry, Family Rule, or policy checks;
- sign, settle, release escrow, or trade options.

Exit evidence:

- A real GonkaRouter request in the primary remittance path with model and
  request metadata.
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
connected verify endpoint remain authoritative.

Customer flow:

1. Get a signed quote on Pay.
2. Choose **Carry quote** to render a QR of the signed quote envelope.
3. On a connected device, open **Pay offline** and tap **Scan QR**.
4. The connected device discriminates kind, decodes the handoff, verifies
   attestation/recipient/corridor/amount/expiry, and shows a **Quote carried —
   Not paid yet** review card.
5. Approve the exact USDC transfer in the wallet.

Exit evidence:

- Offline quote creation followed by online verification and approval.
- Rejection tests for tampered quotes, wrong recipient, wrong network, expired
  quotes, and clock skew.
- A clear no-funds-move boundary during the carry.

### 4. Resilient offline commerce handoff

The Pay offline commerce envelope transports a native-SUI purchase intent across
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

The target connected-device flow verifies the signed envelope, shows an exact
human review, submits once, consumes the authoritative nonce, and records the
final digest. These signed-redemption and cross-device reconciliation
requirements remain exit gates, not claims about the current checksum-only
transport.

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

This feature does not provide credit-card funding, off-ramping, or autonomous
control of the customer's funds.

Exit evidence:

- OAuth sign-in creates or restores the same Sui address reliably.
- The customer still approves value-moving transactions.
- Recovery, logout, session expiry, salt/prover handling, and sponsor-budget
  failure states are tested.
- No OAuth token, salt, sponsor key, or wallet secret reaches browser logs or
  repository history.

## Next — protected money movement

### 6. Protected Transfer

Add programmable escrow for milestones, delivery confirmation, matched grants,
and human-reviewed edge cases.

The Sui Move escrow object records:

- payer and beneficiary;
- asset and amount;
- condition policy and deadline;
- reviewer or arbiter;
- evidence commitment;
- release and refund paths.

GonkaRouter may extract facts from submitted evidence and explain its
assessment. Deterministic rules and an authorized human or contract policy make
the release decision. High-value or ambiguous cases always require human review.

Exit evidence:

- A deployed Sui Move package and one complete on-chain lifecycle.
- Tests for unauthorized release, duplicate release, deadline, cancellation,
  refund, and mismatched evidence.
- An audit trail connecting the evidence hash, model assessment, reviewer
  decision, and Sui action.
- A visible human override that cannot be bypassed by model output.

### 7. Safer recipients and shared expenses

Make everyday payments safer and more useful without adding new top-level
navigation.

- **Recipient check:** explain concrete warning signals such as a changed
  destination, first-time recipient, unusual amount, expired handoff, replayed
  nonce, or merchant mismatch.
- **Receipt split:** scan or paste a receipt, let AI propose line items, then
  require each person and amount to be confirmed before producing payment
  requests.
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

## Then — useful treasury protection

### 8. Protect with Thetanuts Finance

Use the official **Thetanuts Finance** SDK for a separate Base-mainnet workflow
that protects a future ETH purchase or treasury exposure. This is not a Sui
settlement feature and does not protect the MYR→PHP rate.

**Status: read-only mapping and market-data adapter implemented; remittance
context linked.** Model-based constraint extraction, actionable order review,
allowance, signer, and real trade evidence remain outstanding. The linked
remittance context is an educational ETH position preview only — it does not
protect the MYR→PHP rate, guarantee Ana's payout, or execute a trade.

Customer flow:

1. Describe a floor, expiry, or coverage goal.
2. Use GonkaRouter to extract constraints.
3. Fetch live Thetanuts orders.
4. Reject stale or unactionable orders and calculate payoff deterministically.
5. Show premium, maximum loss, expiry, underlying asset, collateral, allowance,
   and Base network before approval.
6. Fill through OptionBook or create a custom RFQ through OptionFactory.

Exit evidence:

- Live SDK market data and deterministic payoff tests.
- An explicit signer and allowance flow.
- A small real Base-mainnet trade with a BaseScan receipt.
- Clear separation between an AI recommendation and the customer's trade
  approval.

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

| Track | Load-bearing product capability | Evidence judges should see |
| --- | --- | --- |
| Sui Payments & Stablecoins | Remittance, Family Rule, stablecoin settlement, signed-quote carry, Pay offline, Protected Transfer, Convey Earn | Real Sui digest or contract state, exact asset, explorer-linked receipt or vault share state |
| Sui AI x Sui | Gonka-interpreted remittance intent followed by deterministic rebind and Sui action | Live model metadata, validated schema, policy gate, Family Rule binding, Sui action |
| Thetanuts Best Product Built on the SDK | Base-native future-purchase or treasury protection | Live SDK orders and a useful options workflow |
| Thetanuts AI x Options | AI constraint extraction plus deterministic payoff and real fill | OptionBook or OptionFactory Base-mainnet transaction |
| GonkaRouter AI For Society | Accessible multilingual remittance interpretation, Family Rule, and evidence review | Real router request, uncertainty handling, social-impact user path |

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
- OAuth provider, zkLogin prover/salt strategy, Enoki use, and sponsored-gas
  policy.
- GonkaRouter production key, selected model, data policy, and latency target.
- Protected Transfer policies, reviewer authority, evidence retention, and
  dispute process.
- Pay offline commerce value limit, maximum age, nonce authority,
  merchant-loss allocation, and clock-skew tolerance.
- Thetanuts signer, allowance policy, supported option market, and small
  Base-mainnet trade budget.
- Convey Earn stablecoin type, yield source, strategy allowlist, tranche
  parameters, oracle policy, governance, and loss-coverage disclosure.
