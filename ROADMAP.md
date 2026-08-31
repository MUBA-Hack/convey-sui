# Convey product roadmap

Convey is one Ana-centered remittance journey: a spoken or typed MYR-to-PHP
request becomes a signed reference quote carrying a Family Rule, then a guarded
Sui testnet-USDC wallet transfer of USDC the wallet already holds. The exact
signed quote can be carried by QR to a connected device, camera-scanned,
server-verified, and explicitly approved. A separate Treasury workspace can map
an explicitly declared ETH or BTC exposure without implying that it protects
the transfer.

This roadmap is ordered around one coherent customer journey, not around sponsor
logos. Each phase has a customer outcome and a proof threshold. A feature is not
complete because a screen exists; it is complete when the stated evidence can be
reproduced.

## Implementation snapshot

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
- **Treasury remains conceptual/read-only.** The payoff workspace covers
  protective-put, covered-call, and collar shapes for explicit ETH/BTC goals,
  with market context kept separate from the unpriced shape. Family Watch can
  summarize a declared remittance obligation beside an explicitly selected
  treasury strategy, but there is no FX hedge, MYR→PHP protection, contract
  selection, or trade execution.
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
- **Seedless Sui onboarding (zkLogin via Enoki) is implemented.** Enoki wallet
  registration and Google sign-in are wired through dApp Kit, with the
  registered redirect URI pinned to the origin. Live session restoration,
  salt/prover handling, and captured restoration evidence remain pending, so
  the feature is not yet presented as a proven onboarding path.

Fiat on/off-ramp, payout, recipient intelligence, receipt splits, a production
signed offline envelope, real Thetanuts trade, and Sui Earn remain future work,
not shipped capabilities. Protected Transfer now has a tested single-milestone
Move package, pinned TypeScript transaction core, and bounded server plan
endpoint plus an integrated Pay creation path. Executable quotes offer **Send
directly** or **Hold for family review**; the hold path requests the strict plan,
builds the pinned `create_escrow` transaction client-side, requires a connected
Sui testnet wallet, and locks duplicate submission. The endpoint remains
unconfigured and unsigned by default, the package is not published, and the UI
reports only submitted or unknown—not Created, Released, or Refunded. No
lifecycle receipts or reviewer release/refund workflow exist.
The signed-quote handoff wrapper in the tree is a transport envelope
with no outer signature; a production signed offline envelope with cross-device
replay authority is future work.

## Product principles

- Use one primary customer job—**Pay**—with **Continue elsewhere** and
  **Receipts** as contextual branches. Keep **Treasury** visibly separate.
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

**Status: software implementation complete; live artifact exit evidence
incomplete.** The source has a single
MYR-to-PHP reference corridor, integer fee/FX calculations, expiring quote
envelopes, server-only attestation and verification, explicit recipient
mapping, Family Rule (purpose and per-transfer maximum) binding, and
client-built testnet-USDC execution. It also has an independent receipt verifier
for exact Sui testnet settlement evidence. Live pricing, fiat funding/payout,
and a reproducible real-digest settlement artifact remain outstanding.

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
connected verify endpoint remain authoritative. Its server-only verification
evaluator uses the exact freshness interval `issuedAt <= now < expiresAt` and
fails closed for invalid or pre-issuance clock input, with deterministic tests
covering both boundaries and historical-evidence separation.

Customer flow:

1. Get a signed quote on Pay.
2. Choose **Carry quote** to render a QR of the signed quote envelope.
3. On a connected device, open **Continue elsewhere** and tap **Scan QR**.
4. The connected device discriminates kind, decodes the handoff, verifies
   attestation/recipient/corridor/amount/expiry, and shows a **Quote carried —
   Not paid yet** review card.
5. Approve the exact USDC transfer in the wallet.

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
guarded checkout can continue. A payer-signed redemption envelope, shared
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
feature, never by display name. Live session restoration across sessions,
salt/prover lifecycle handling, and captured restoration evidence remain
outstanding, so this is not yet a proven onboarding path.

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

**Status: contract, transaction core, bounded plan endpoint, and Pay creation
path implemented; on-chain lifecycle incomplete.** Executable quotes now offer
**Send directly** or **Hold for family review** inside the existing Pay surface.
The direct path is unchanged. The hold path requests a strict plan, builds the
pinned `create_escrow` transaction client-side, requires a connected Sui
testnet wallet, locks duplicate submission, and shows only submitted or unknown
outcomes. The current Move package supports one full-balance release or
post-deadline refund. It does not implement multiple milestones, automated
delivery verification, disputes, early cancellation, matched grants, or model
authority. The server endpoint authors the plan from a verified quote, deadline
preset, review note, and configured candidate coordinates, but its unsigned
response cannot prove publication, deployment, immutability, or on-chain state.

The implemented Sui Move escrow object records:

- payer and beneficiary;
- asset and amount;
- one deadline;
- reviewer or arbiter;
- evidence commitment;
- release and refund paths.

GonkaRouter may later extract bounded facts from submitted evidence and explain
an advisory assessment. It never releases funds. The assigned human reviewer
remains the only release authority, and the payer refund becomes valid strictly
after the deadline. The on-chain evidence commitment records exact metadata; it
does not validate the underlying evidence.

Next implementation sequence:

1. Publish the package on Sui testnet and record the package, upgrade authority,
   source, and bytecode evidence without claiming immutability prematurely.
2. Configure the implemented bounded plan endpoint after publication; retain its
   strict quote binding and server-only package/reviewer policy.
3. Independently verify the `Created` event and bind the escrow object, payer,
   beneficiary, reviewer, asset, amount, deadline, and evidence commitment to a
   lifecycle receipt before showing a held state.
4. Add the authorized reviewer release and post-deadline payer refund workflows.
5. Verify `Released` and `Refunded` as distinct terminal receipt states; keep
   every escrow state separate from bank or cash payout.

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

## Then — manage treasury deliberately

### 8. Treasury protection with Thetanuts Finance

Use the official **Thetanuts Finance** SDK for a separate Base-mainnet workflow
that protects a future ETH purchase or treasury exposure. This is not a Sui
settlement feature and does not protect the MYR→PHP rate.

**Status: read-only mapping and market-data adapter implemented; remittance
context linked.** Model-based constraint extraction, actionable order review,
allowance, signer, and real trade evidence remain outstanding. The linked
remittance context is a conceptual ETH treasury preview only — it does not
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

Each track lists which load-bearing capabilities are **current** (implemented in
this source) and which are **future** (still required for a complete submission).

| Track | Current capability | Future capability | Evidence judges should see |
| --- | --- | --- | --- |
| Sui Payments & Stablecoins | Remittance quote, Family Rule binding, pinned testnet-USDC execution path, signed-quote carry, offline commerce handoff, portable receipt proof, independent read-only settlement verification, and an in-Pay Protected Transfer creation path over tested Move/TypeScript/plan cores | Protected Transfer publication/configuration, independent lifecycle verification, reviewer release/refund workflow, Convey Earn, reproducible real USDC digest artifact, live FX/funding/payout | Real Sui digest or contract state, exact asset, explorer-linked receipt or vault share state |
| Sui AI x Sui | Gonka-interpreted remittance intent behind deterministic rebind/policy; bounded protected-plan issuance and in-Pay client construction from verified quotes; commerce intent candidate path | Advisory evidence review, protected lifecycle evidence, and live Gonka request evidence | Live model metadata, validated schema, policy gate, Family Rule binding, Sui action |
| Thetanuts Best Product Built on the SDK | Pinned SDK, Base mainnet read adapter, market/order evidence surface | Quote selection, approval, signing, and a real Base-mainnet trade | Live SDK orders and a useful options workflow |
| Thetanuts AI x Options | Natural-language risk-goal interface plus SDK market context | Model-routed constraint extraction plus deterministic payoff and real fill | OptionBook or OptionFactory Base-mainnet transaction |
| GonkaRouter AI For Society | Mixed-language remittance interpretation, deterministic rebind, Family Rule, visible provenance, honest local fallback | A live key/request and captured multilingual remittance evidence | Real router request, uncertainty handling, social-impact user path |

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
- Offline commerce value limit, maximum age, nonce authority,
  merchant-loss allocation, and clock-skew tolerance.
- Thetanuts signer, allowance policy, supported option market, and small
  Base-mainnet trade budget.
- Convey Earn stablecoin type, yield source, strategy allowlist, tranche
  parameters, oracle policy, governance, and loss-coverage disclosure.
