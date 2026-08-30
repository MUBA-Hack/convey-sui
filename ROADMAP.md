# Convey product roadmap

Convey is a remittance and protected-payments product that turns plain speech into a reviewed stablecoin transfer, keeps AI suggestions inside deterministic financial controls, and remains useful when connectivity is unreliable.

This roadmap is ordered around one coherent customer journey, not around sponsor logos. Each phase has a customer outcome and a proof threshold. A feature is not complete because a screen exists; it is complete when the stated evidence can be reproduced.

## Implementation snapshot

The current source includes **Send abroad** as Pay's default mode and **Buy nearby** as its catalog-purchase mode. Send abroad supports deterministic MYR-to-PHP reference quotes and a guarded Sui testnet-USDC transfer path. It transfers USDC already held in the customer's wallet: it does not charge MYR, obtain live FX, or complete PHP payout. No live USDC digest is claimed by this document; release validation and transaction evidence remain required.

GonkaRouter currently serves Buy nearby, not Send abroad. Relay remains a tamper-evident but unsigned commerce envelope with device-local replay protection. Verify remains a local, native-SUI commerce-receipt verifier; USDC remittance receipts are not yet supported there. Protect remains read-only. Protected Transfer, receipt splitting, full options execution, and Convey Earn are roadmap work, not shipped capabilities.

## Product principles

- Use customer jobs as the interface: **Pay**, **Relay**, **Protect**, and **Verify**.
- Abstract wallet complexity without hiding user authority or transaction risk.
- Separate the states **draft**, **reviewed**, **authorized**, **submitted**, **settled**, and **failed**.
- Treat AI output as a typed proposal. Deterministic code validates recipients, amounts, assets, networks, limits, expiries, and transaction bytes.
- Keep Sui payment activity and Base options activity visibly and technically separate.
- Never call a QR intent, local receipt, or provider quote a completed payment.
- Prefer one trustworthy end-to-end corridor over many unsupported country or payout claims.

## Now — trustworthy payment core

### 1. Conversational remittance

Turn a spoken or typed request into a transparent cross-border payment review.

**Status: partially implemented; exit evidence incomplete.** The source has a single MYR-to-PHP reference corridor, integer fee/FX calculations, expiring quote envelopes, server-only attestation and verification, explicit recipient mapping, and client-built testnet-USDC execution. Purpose extraction, live pricing, fiat funding/payout, and a reproducible real settlement receipt remain outstanding.

Customer flow:

1. Say or type the recipient, destination, amount, and purpose.
2. Resolve ambiguities before showing a transaction.
3. Display source amount, exchange rate, fees, stablecoin settlement amount, payout method, and arrival estimate.
4. Review the recipient and route independently from the AI interpretation.
5. Approve the Sui transaction in the user's wallet.
6. Track on-chain settlement separately from bank or cash payout.

Implementation boundary:

- The current execution increment pins six-decimal USDC to Sui testnet in `lib/remittance/constants.ts`. Keep asset, network, and decimal checks independent of model or quote-response fields. Mainnet asset/corridor approval is a separate decision.
- Use **Bridge, a Stripe company**, as the Sui-compatible fiat/stablecoin integration candidate. Stripe's general crypto onramp does not currently document Sui support.
- Keep payout-provider and regulated-corridor claims behind real provider access.
- Reference MYR/PHP amounts are not funds collected or disbursed. A testnet USDC receipt must retain **Awaiting payout partner** until a real payout integration provides separate evidence.
- Extend Verify with an asset-aware remittance receipt schema before claiming portable USDC proof support.

Exit evidence:

- A real wallet approval and Sui transaction digest.
- A reproducible quote with itemized fees and no hidden exchange-rate spread.
- Explicit recipient, asset, network, and payout-state binding.
- A provider response for the payout leg, or a clear on-chain-only boundary.

### 2. Gonka-powered payment assistant

Use **GonkaRouter** for multilingual intent extraction and accessible explanations. Gonka is the decentralized inference network; GonkaRouter is the hosted router used by the product.

**Status: commerce adapter implemented; remittance integration outstanding.** Buy nearby uses the Gonka candidate/policy path when configured. Send abroad currently uses deterministic parsing, so commerce inference evidence must not be presented as primary remittance inference evidence.

The model may propose:

- action and payment purpose;
- recipient reference and destination;
- source or target amount and currency;
- missing fields and ambiguity;
- evidence-backed risk explanations.

The model may not:

- invent or silently replace a recipient;
- construct arbitrary transaction bytes;
- bypass amount, asset, network, balance, expiry, or policy checks;
- sign, settle, release escrow, or trade options.

Exit evidence:

- A real GonkaRouter request in the primary payment path with model and request metadata.
- Malformed-output, timeout, model-mismatch, and fallback tests.
- At least one mixed-language payment request that stops for clarification when uncertain.
- A deterministic policy decision between model output and wallet approval.

### 3. Seedless Sui onboarding

Add **Sui zkLogin**, optionally through **Enoki**, so customers can create a self-custodial Sui account with a familiar OAuth identity instead of a seed phrase. Sponsored gas is a separate capability and must use an allowlisted backend policy.

This feature does not provide credit-card funding, off-ramping, or autonomous control of the customer's funds.

Exit evidence:

- OAuth sign-in creates or restores the same Sui address reliably.
- The customer still approves value-moving transactions.
- Recovery, logout, session expiry, salt/prover handling, and sponsor-budget failure states are tested.
- No OAuth token, salt, sponsor key, or wallet secret reaches browser logs or repository history.

## Next — resilient and protected money movement

### 4. Relay: offline payment handoff

The target Relay design carries a signed, typed, expiring payment intent between devices when one device has poor connectivity. It is an offline transport mechanism, not offline blockchain settlement. The current commerce envelope provides a checksum, expiry, and device-local nonce registry, but no payer signature, shared nonce authority, or USDC remittance handoff.

Every intent binds:

- exact amount and asset;
- chain and network;
- merchant or recipient;
- order identifier and nonce;
- issued-at time and expiry;
- canonical signed bytes.

The target connected-device flow verifies the signed envelope, shows an exact human review, submits once, consumes the authoritative nonce, and records the final digest. These signed-redemption and cross-device reconciliation requirements remain exit gates, not claims about the current checksum-only transport.

Exit evidence:

- Offline creation followed by online verification and redemption.
- Rejection tests for replay, expiry, tampering, wrong recipient, wrong network, copied screenshots, and clock skew.
- Conservative offline value and lifetime limits.
- Distinct visible states for intent created, verified, submitted, and settled.

### 5. Protected Transfer

Add programmable escrow for milestones, delivery confirmation, matched grants, and human-reviewed edge cases.

The Sui Move escrow object records:

- payer and beneficiary;
- asset and amount;
- condition policy and deadline;
- reviewer or arbiter;
- evidence commitment;
- release and refund paths.

GonkaRouter may extract facts from submitted evidence and explain its assessment. Deterministic rules and an authorized human or contract policy make the release decision. High-value or ambiguous cases always require human review.

Exit evidence:

- A deployed Sui Move package and one complete on-chain lifecycle.
- Tests for unauthorized release, duplicate release, deadline, cancellation, refund, and mismatched evidence.
- An audit trail connecting the evidence hash, model assessment, reviewer decision, and Sui action.
- A visible human override that cannot be bypassed by model output.

### 6. Safer recipients and shared expenses

Make everyday payments safer and more useful without adding new top-level navigation.

- **Recipient check:** explain concrete warning signals such as a changed destination, first-time recipient, unusual amount, expired Relay intent, replayed nonce, or merchant mismatch.
- **Receipt split:** scan or paste a receipt, let AI propose line items, then require each person and amount to be confirmed before producing payment requests.
- **Family payout:** save a verified recipient and payout preference, but require step-up review when account details change.
- **Guardrails:** let customers set a spending envelope for a card, recipient, merchant category, amount band, date window, and destination country so a payment stays inside an explicit policy.
- **Split request:** convert a bill, dinner, or trip receipt into confirmable split requests that reconcile exactly before any money moves.
- **Proof-first history:** keep the original intent, edits, approvals, and settlement evidence together so the receipt can be explained later without implying hidden automation.

Exit evidence:

- Risk explanations cite deterministic signals and never invent fraud claims.
- Receipt totals, tax, tip, rounding, and participant allocations reconcile exactly.
- Changed-recipient and unusual-amount flows stop before authorization.
- Spending envelopes reject out-of-policy requests before wallet approval.
- Split requests produce exact totals and preserve each participant decision.

### 7. Offline QR Ferry

Build a compact offline handoff flow for the moments when connectivity is unreliable.

This is a transport layer for payment intent, not offline settlement. It should feel native to Convey: one intent, one scan, one expiry, one redemption path, one receipt.

Customer flow:

1. Create a payment or checkout intent on one device.
2. Display a compact QR handoff token with exact amount, asset, recipient, expiry, and nonce.
3. Let the second device scan and verify the intent locally before any online submission.
4. Submit once connectivity returns, then persist the resulting digest and proof.

Exit evidence:

- Replay, expiry, tamper, wrong-recipient, wrong-network, and clock-skew rejections are tested.
- The handoff token binds exact amount, asset, recipient, destination, and expiry.
- The handoff path fails closed when proof is incomplete or stale.
- The UI remains readable on a small screen and does not claim settlement before the network confirms it.

## Then — useful treasury protection

### 8. Protect with Thetanuts Finance

Use the official **Thetanuts Finance** SDK for a separate Base-mainnet workflow that protects a future purchase or treasury exposure. This is not a Sui settlement feature.

**Status: read-only mapping and market-data adapter implemented.** Model-based constraint extraction, actionable order review, allowance, signer, and real trade evidence remain outstanding.

Customer flow:

1. Describe a floor, expiry, or coverage goal.
2. Use GonkaRouter to extract constraints.
3. Fetch live Thetanuts orders.
4. Reject stale or unactionable orders and calculate payoff deterministically.
5. Show premium, maximum loss, expiry, underlying asset, collateral, allowance, and Base network before approval.
6. Fill through OptionBook or create a custom RFQ through OptionFactory.

Exit evidence:

- Live SDK market data and deterministic payoff tests.
- An explicit signer and allowance flow.
- A small real Base-mainnet trade with a BaseScan receipt.
- Clear separation between an AI recommendation and the customer's trade approval.

## Later — Sui-native savings

### 9. Convey Earn

Build the useful product idea behind risk-tranched stablecoin savings directly on Sui instead of adding a cross-chain dependency. Convey Earn would let customers explicitly move idle Sui stablecoins into transparent Move vaults with two risk positions:

- **Steady pool:** receives a lower target return and is protected by the risk pool's first-loss capital up to the disclosed coverage limit.
- **Risk pool:** receives a larger share of yield in exchange for absorbing losses first.

This is configurable risk allocation, not guaranteed yield or principal protection. The interface must show where yield comes from, utilization, variable APY, available liquidity, fees, withdrawal timing, current first-loss coverage, and the exact loss waterfall before a deposit is authorized.

Proposed Sui architecture:

- A shared Move vault object holds one pinned Sui stablecoin type.
- Steady and risk pool shares are separate typed receipt objects or fungible share assets.
- Deposits and withdrawals use deterministic share accounting with explicit rounding rules.
- A strategy adapter may allocate capital only to allowlisted Sui protocols and within on-chain exposure limits.
- Yield and losses are realized into the vault before share prices are updated.
- The risk pool absorbs losses first; the steady pool is affected after first-loss capital is exhausted.
- Emergency pause stops new deposits and strategy allocation without blocking safe withdrawals unnecessarily.
- Governance changes use a timelock and emit events that the product can explain before they take effect.

Customer safeguards:

- Never sweep a payment balance into Earn automatically.
- Require explicit, revocable authorization for every deposit or recurring rule.
- Keep payment funds, Protected Transfer funds, and Earn vault shares visibly separate.
- Display smart-contract, stablecoin, liquidity, oracle, strategy, and principal-loss risk.
- Do not label the steady pool “safe,” “insured,” or “guaranteed.”

Exit evidence:

- Move unit tests for deposits, withdrawals, share pricing, rounding, yield distribution, first-loss allocation, depleted coverage, pause, and unauthorized administration.
- Invariant or property tests proving assets equal liabilities through randomized deposit/loss/withdrawal sequences.
- A deployed Sui testnet vault with explorer-linked deposit and withdrawal receipts.
- A transparent strategy allowlist and a reproducible loss-waterfall example.
- Independent contract review before any mainnet or real-value claim.

## Track alignment

| Track | Load-bearing product capability | Evidence judges should see |
| --- | --- | --- |
| Sui Payments & Stablecoins | Remittance, stablecoin settlement, Relay, Protected Transfer, Convey Earn | Real Sui digest or contract state, exact asset, explorer-linked receipt or vault share state |
| Sui AI x Sui | Gonka-interpreted intent or evidence followed by deterministic Sui action | Live model metadata, validated schema, policy gate, Sui action |
| Thetanuts Best Product Built on the SDK | Base-native future-purchase or treasury protection | Live SDK orders and a useful options workflow |
| Thetanuts AI x Options | AI constraint extraction plus deterministic payoff and real fill | OptionBook or OptionFactory Base-mainnet transaction |
| GonkaRouter AI For Society | Accessible multilingual remittance and evidence review | Real router request, uncertainty handling, social-impact user path |

## Delivery gates

Every roadmap increment must pass the same gates before it is presented as complete:

1. **Product truth:** every status and receipt corresponds to an observed state.
2. **Authority:** AI cannot sign, redirect, release, or trade.
3. **Security:** secrets remain server-side; replay, expiry, recipient, network, and amount checks are tested.
4. **Accessibility:** keyboard, screen-reader, reduced-motion, narrow-screen, and low-connectivity paths remain usable.
5. **Visual quality:** the primary task is obvious, review precedes authority, and technical detail appears only when it helps a customer decide.
6. **Evidence:** tests, chain receipts, provider metadata, and limitations are reproducible.
7. **Documentation:** README and product copy match the implemented behavior exactly.

## Decisions still required

- Replace the home-screen bank payout simulation with a live, compliant funding
  and payout partner; preserve explicit pending, failed, refunded, and settled
  states without treating an on-chain transfer as proof of bank disbursement.
- Production corridor approval, payout partner, KYC flow, refund policy, and jurisdiction coverage; MYR-to-PHP is currently a reference corridor only.
- Mainnet stablecoin and execution approval. The current testnet increment already pins six-decimal Sui USDC; it does not authorize production deployment.
- Bridge commercial access and supported payout geography.
- OAuth provider, zkLogin prover/salt strategy, Enoki use, and sponsored-gas policy.
- GonkaRouter production key, selected model, data policy, and latency target.
- Protected Transfer policies, reviewer authority, evidence retention, and dispute process.
- Relay value limit, maximum age, nonce authority, merchant-loss allocation, and clock-skew tolerance.
- Thetanuts signer, allowance policy, supported option market, and small Base-mainnet trade budget.
- Convey Earn stablecoin type, yield source, strategy allowlist, tranche parameters, oracle policy, governance, and loss-coverage disclosure.
