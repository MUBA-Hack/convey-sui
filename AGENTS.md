# Convey agent guide

This file applies to every coding agent working in this repository. `CLAUDE.md`
remains the concise project baseline; this guide adds coordination, review, and
evidence rules for parallel agents.

## Product contract

Convey is a minimal black-and-white money app built around one coherent family
journey: express an intent, inspect the complete terms, approve in a wallet, and
keep a portable receipt. Pay, offline handoff, protection, and verification must
feel like parts of that journey rather than separate demos.

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
- Models may propose structured intent but never receive secrets or transaction
  authority. Validate model output and fail closed before payment preparation.
- A real transfer requires a connected wallet, the expected network, canonical
  addresses, a pinned asset type, and explicit user approval.
- A demo or prepared transaction is not settlement. A carried transaction ID is
  not independent chain verification. Sui settlement is not fiat payout.
- Offline QR data is a transport envelope. Its checksum detects changes and its
  consume-once nonce limits replay; it is not payer authorization or a signature.
- Keep secrets in ignored environment files. Never print, embed, screenshot,
  stage, commit, or pass API keys to browser code or model prompts.
- Use the existing shadcn/Tailwind system. App-level icons use the existing
  Iconsax system. Do not introduce another visible icon family or base UI system.
- Honor `prefers-reduced-motion`. Animate transforms and opacity; avoid layout
  jank and decorative motion that delays task completion.
- Read the relevant Next.js documentation under `node_modules/next/dist/docs/`
  before using framework APIs that may have changed.

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
- **Surface-only fixes:** changing labels while leaving duplicated state machines,
  dead callbacks, or conflicting actions underneath.
- **Truth-boundary drift:** describing a checksum as authorization, an HMAC as a
  public signature, a carried digest as chain verification, or settlement as
  payout.
- **Demo leakage:** putting “mock,” “simulation,” SDK versions, server-only notes,
  or “not submitted” badges in the primary customer experience.
- **Screenshot false positives:** capturing an unhydrated page, a stale hot-reload
  frame, the wrong viewport, or identical transition frames and calling it a pass.
- **Mobile-only confidence:** validating 390px while leaving a sparse or broken
  desktop composition, or the reverse.
- **Large-component growth:** appending more business logic to already large UI
  files instead of extracting a typed module and focused tests.
- **Spec expansion:** adding unrelated features, dependencies, routes, or visual
  systems because they are convenient.
- **Weak error handling:** unbounded retries, no timeout, optimistic fallbacks at a
  security boundary, or errors that reveal implementation details.
- **Persuasive self-review:** reporting a pass from summaries instead of raw diff,
  command output, screenshots, and runtime behavior.
- **Secret exposure:** echoing environment values, inserting keys into prompts,
  or placing credentials in tracked examples.

If a required fact cannot be proved, label it as unverified and stop that action.
Do not invent evidence to keep a demo moving.

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
