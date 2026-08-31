# Convey agent guide

This file applies to every coding agent working in this repository. `CLAUDE.md`
is the concise source of project truth; this guide expands it with coordination,
review, and evidence rules for parallel agents. It does not relax or override a
rule in `CLAUDE.md`. If the two files appear to conflict, stop, cite the exact
clauses, and let the integration owner reconcile them before editing code.

## Alignment with CLAUDE.md

Use this precedence order when instructions differ:

1. The current user request defines the goal and authorized scope.
2. `CLAUDE.md` defines the product, technical constraints, commands, and route
   map.
3. `AGENTS.md` defines how agents coordinate, review, prove, and hand off work.

`AGENTS.md` may make a `CLAUDE.md` rule more operational, but it may not weaken,
reinterpret, or silently extend it. Keep the product contract, commands, hard
technical rules, and repository map synchronized whenever `CLAUDE.md` changes.
Do not copy the generated `nextjs-agent-rules` block here; agents must read it
from `CLAUDE.md` and the installed Next.js documentation directly.

Before starting a lane, name the applicable `CLAUDE.md` rules in the task packet.
Before handoff, compare the changed behavior against both files. If a change
makes either guide stale, update the human-owned prose in the same integration
diff; never edit generated framework instructions merely to make the files look
identical.

## Product contract

Convey is a minimal black-and-white money app built around one coherent family
journey: express an intent, inspect the complete terms, approve in a wallet, and
keep a portable receipt. **Pay** is primary; **Continue elsewhere** and
**Receipts** are contextual branches. **Treasury** is visibly separate and must
never imply that an ETH/BTC strategy protects the transfer rate or payout.

Customer-facing screens must read like a finished financial product. Keep SDK
versions, server topology, mock flags, implementation notes, and competitor
research out of primary product UI. Put exact technical and trust boundaries in
receipts, expandable details, tests, and documentation.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

Run focused tests while editing. Before handing work back, run the relevant
focused suite plus typecheck. The integration owner runs the full suite, lint,
and production build before a commit.

## Non-negotiable technical rules

- Use ESM. `@noble/hashes` v2 subpath imports require `.js` suffixes.
- Use the installed `@mysten/sui` v2 APIs. Do not introduce v1 `SuiClient`
  patterns from memory; check the package documentation in `node_modules`.
- The client-signed nearby-commerce payment seam is
  `lib/commerce/payment.ts` plus `components/commerce/payment-action.tsx`.
  Treat edits there as security-sensitive and review the pair together.
- Models may propose structured intent but never receive URLs, keys, secrets, or
  transaction authority. Validate model output and fail closed before payment
  preparation.
- A real nearby-commerce testnet transfer requires a connected wallet, the
  testnet network, and a configured merchant address that canonically matches
  the preview merchant. Anything else remains an explicitly labelled preview.
- A real remittance testnet transfer additionally requires a mapped recipient,
  valid quote attestation, pinned asset and corridor, a fresh quote, a connected
  testnet wallet, and explicit user approval.
- The Protected Transfer plan endpoint accepts only a verified quote, deadline
  preset, and review note. Package/reviewer coordinates come from server-only
  config and fail closed. The response is unsigned channel provenance—not proof
  of publication, deployment, immutability, or on-chain state—and Pay does not
  consume it yet.
- A demo or prepared transaction is not settlement. A carried transaction ID
  alone is not independent chain verification. Sui settlement is not fiat payout.
- The remittance settlement verifier is server-only, fixed to Sui testnet, and
  read-only. It accepts no client RPC/network/coin override and makes at most one
  bounded transaction lookup.
- Verified receipt UI requires a strict response bound to the active receipt:
  successful transaction, exact digest, pinned testnet USDC, canonical recipient,
  and exact micro amount. Malformed, extra, stale, mismatched, not-found, or
  unavailable evidence cannot unlock share/export.
- Keep **Confirmed on Sui** distinct from **Awaiting family payout**. No worker
  may claim a live real-digest artifact or bank/cash payout without captured
  evidence.
- The offline commerce envelope is a transport envelope. Its checksum detects
  changes and its device-local consume-once nonce limits replay; it is not payer
  authorization or a signature.
- The remittance QR handoff carries an already attested quote. Its wrapper adds
  no outer checksum, signature, or replay authority; expiry, server attestation,
  recipient binding, and connected verification remain authoritative.
- Keep secrets in ignored environment files. Never print, embed, screenshot,
  stage, commit, or pass API keys to browser code or model prompts.
- Use the existing shadcn/Tailwind system. App-level icons use the existing
  Iconsax system. Do not introduce another visible icon family or base UI system.
- Honor `prefers-reduced-motion`. Animate transforms and opacity; avoid layout
  jank and decorative motion that delays task completion.
- Read the relevant Next.js documentation under `node_modules/next/dist/docs/`
  before using framework APIs that may have changed.

## Repository map

Keep this map aligned with `CLAUDE.md`; the extra entries identify current trust
boundaries that workers commonly miss.

- `app/` — product routes and typed APIs. `/` is Pay, `/qr-ferry` is Continue
  elsewhere, `/proof` is Receipts, and `/strategy` is Treasury.
- `app/api/remittance/settlement/verify/` — server-only, read-only Sui testnet
  settlement verification. It enforces the 16 KiB streamed body cap, at most one lookup,
  six-second abort, `no-store`, and a safe strict response union; it never signs
  or submits a transaction.
- `app/api/remittance/protected-transfer/plan/` — bounded, no-store execution
  plan issuance using the shared quote verifier and server-only candidate
  package/reviewer coordinates; no signer, RPC, submission, or deployment proof.
- `lib/http/` — the shared server-only bounded UTF-8 request reader. Keep raw
  byte, declared-length, stream-error, and UTF-8 policy here instead of cloning
  it into routes.
- `lib/commerce/` — nearby-commerce intent, payment, offline envelope, and proof
  verification.
- `lib/remittance/` — remittance intent, quotes, transfer constraints, receipt
  rules, and independent settlement evaluation. `sui-settlement-response.ts` is
  client-safe; `sui-settlement-verification.ts` is pure; and
  `sui-settlement.server.ts` owns the fixed testnet RPC boundary.
- `lib/protocol/hash.ts` — shared blake2b256 used by the offline checksum.
- `components/remittance/` — primary family-transfer journey.
- `components/commerce/` — nearby-commerce, cross-device handoff, and receipt UI.
- `components/wallet/`, `components/pwa/`, `components/landing/`, and
  `components/ui/` — wallet providers, PWA registration, presentation primitives,
  and the shared shadcn system respectively.

## Parallel ownership

Every worker receives explicit file ownership. Do not edit another worker's
files, revert unrelated changes, or clean a dirty tree. Shared merge points such
as `components/site-header.tsx`, `components/remittance/remittance-chat.tsx`,
`README.md`, and `ROADMAP.md` have one integration owner at a time.

Before editing:

1. Run `git status --short` and inspect the relevant diff.
2. Read the whole target component, its data module, and focused tests.
3. State the behavior and truth boundary being changed.
4. Prefer a new small module over adding business logic to a large UI component.

Workers do not commit or push unless the integration owner explicitly assigns
that responsibility. Never rewrite history, reset the worktree, or discard files
to make a lane appear clean.

## NASA-style implementation discipline

Apply the useful language-independent parts of high-reliability guidance:

- Keep control flow simple and bounded.
- Bound user input, collections, retries, polling, and external-call timeouts.
- Use one authoritative state model instead of overlapping booleans.
- Make invariants executable through schemas, guards, and tests.
- Keep functions small, explicit, and free of hidden mutation.
- Fail closed at payment, authentication, proof, and policy boundaries.
- Avoid clever abstractions, premature generalization, and duplicated paths.
- Delete dead branches and stale copy after a migration is proven.

Comments explain a non-obvious invariant or security boundary, not what readable
code already says. Do not add narration comments to satisfy a reviewer.

## UI and visual evidence gate

Visual work is not complete from DOM tests alone.

1. Use a hydrated app on `localhost`, not `127.0.0.1`, during Next.js development.
   The latter can trigger blocked development assets and misleading screenshots.
2. Prefer a production build for final evidence so developer tools are absent.
3. Capture desktop and 390px mobile entry, loading, success, error, and important
   expanded states. Check full pages, not only the first viewport.
4. Capture timed transition frames and verify that pixels actually change.
5. Exercise keyboard focus, touch targets, overflow, long values, and reduced
   motion.
6. Judge product copy, hierarchy, whitespace, speed, and task completion—not only
   aesthetic similarity.

Competitor evidence and comparisons stay outside this tracked repository. Convert
research into neutral product requirements before it enters code or documentation.

## Common GLM worker failure modes

GLM workers must check this list before returning work:

- **Stale-state edits:** assuming the branch is clean or replacing another lane's
  uncommitted work. Inspect status and diff first.
- **Training-data APIs:** writing old Next.js or Sui APIs without reading installed
  documentation.
- **Generated-file churn:** deleting or rewriting the Next.js agent-rules block
  in `CLAUDE.md`; `next dev` restores it, so preserve the generated block and
  investigate its generator before treating it as accidental text.
- **Surface-only fixes:** changing labels while leaving duplicated state machines,
  dead callbacks, or conflicting actions underneath.
- **Truth-boundary drift:** describing a checksum as authorization, an HMAC as a
  public signature, a carried digest alone as chain verification, or settlement as
  payout.
- **Demo leakage:** putting “mock,” “simulation,” SDK versions, server-only notes,
  or “not submitted” badges in the primary customer experience.
- **Screenshot false positives:** capturing an unhydrated page, a stale hot-reload
  frame, the wrong viewport, or identical transition frames and calling it a pass.
- **Mobile-only confidence:** validating 390px while leaving a sparse or broken
  desktop composition, or the reverse.
- **Large-component growth:** appending more business logic to already large UI
  files instead of extracting a typed module and focused tests.
- **Test-suite inflation:** adding dozens of route tests that duplicate parser,
  verifier, or domain-policy suites. Endpoint tests should prove adapter behavior;
  the module that owns a rule should own its exhaustive cases.
- **Double validation:** parsing or validating the same value in a route, shared
  verifier, and builder without a distinct trust-boundary reason. Choose one
  authoritative policy owner and keep adapters thin.
- **Comment-contract mismatch:** comments promise “every response,” “verified,”
  “server-issued,” or “immutable” while exceptions, unsigned payloads, missing
  deployment evidence, or unverified configuration make the statement false.
- **Weak assertions:** using `toBeTruthy`, substring leak checks, or self-parsing
  an output with the implementation's own schema instead of asserting exact
  pinned values and a strict public response shape.
- **Unsigned provenance drift:** treating a response returned by the server as a
  durable attestation. Response-channel provenance is not a signature and does
  not prove package deployment, package immutability, or later on-chain state.
- **Adapter policy duplication:** re-testing every quote, amount, expiry, HMAC,
  and recipient failure through each new endpoint instead of keeping one
  representative propagation test and relying on the policy owner's suite.
- **Spec expansion:** adding unrelated features, dependencies, routes, or visual
  systems because they are convenient.
- **Weak error handling:** unbounded retries, no timeout, optimistic fallbacks at a
  security boundary, or errors that reveal implementation details.
- **Persuasive self-review:** reporting a pass from summaries instead of raw diff,
  command output, screenshots, and runtime behavior.
- **Secret exposure:** echoing environment values, inserting keys into prompts,
  or placing credentials in tracked examples.
- **Partial-file reasoning:** editing the first matching function without reading
  the complete component, its caller, schemas, and focused tests.
- **Contract widening:** parsing a provider or API response with permissive
  strings, passthrough objects, unsafe casts, or defaults that turn malformed
  evidence into success.
- **Test-shaped implementation:** satisfying one visible fixture while omitting
  adversarial cases such as stale responses, identity mismatch, extra fields,
  cancellation, and repeated actions.
- **Formatting churn:** rewriting unrelated imports, prose, snapshots, or lockfile
  content and making a small behavior change impossible to review.
- **Invented completion:** claiming commands, browser states, screenshots, remote
  pushes, or live-chain evidence that the worker did not personally observe.
- **Mermaid breakage:** using punctuation, labels, or arrows that GitHub's Mermaid
  renderer rejects. Keep node IDs simple and validate every changed diagram.

If a required fact cannot be proved, label it as unverified and stop that action.
Do not invent evidence to keep a demo moving.

## Minimum GLM task packet

Do not send a GLM worker a goal-only prompt. Every assignment must include:

1. **Ownership:** exact files or subsystem it may edit, plus protected shared
   files it must not touch.
2. **Observed state:** current `git status --short`, relevant existing behavior,
   installed library version, generated framework instructions, and any
   concurrent work already in the tree.
3. **Contract:** required behavior, forbidden behavior, truth boundaries, input
   bounds, and explicit non-goals.
4. **Acceptance table:** success, failure, stale, malformed, and retry behavior
   with the expected customer-visible result.
5. **Evidence:** exact focused tests, typecheck or lint command, and runtime or
   screenshot states the worker must personally inspect.
6. **Return format:** changed files, concise rationale, raw command outcomes,
   observed limitations, and no commit or push unless explicitly authorized.

After a GLM return, a fresh critic must inspect the actual diff and rerun the
relevant evidence. Never accept the builder's summary as proof. For visual work,
the critic compares full desktop and mobile flows—including transitions—against
the current product bar, then returns the single largest remaining gap. The
builder/critic loop continues until the output passes; the integration owner
still performs the final truth, simplification, secret, and repository checks.

The critic must also ask four simplification questions:

1. Which module is the single owner of each policy?
2. Which tests repeat coverage already proved at that owner?
3. Which validation or parsing pass can be removed without weakening a trust
   boundary?
4. Which comment or product claim is stronger than the observable evidence?

## Handoff format

Return:

- files changed;
- behavior added or corrected;
- tests and commands run with exact outcomes;
- screenshots or runtime paths inspected;
- remaining limitations and truth boundaries;
- any shared file the integration owner still needs to update.

The integration owner performs a fresh spec review, code-quality review,
simplification pass, runtime dogfood pass, README/ROADMAP sync, secret scan, and
visual gate before committing and pushing.
