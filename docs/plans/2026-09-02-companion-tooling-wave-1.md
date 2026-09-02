# Companion Tooling Wave 1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the safe tooling foundation for Convey's relationship-aware AI companion, then give `oyw-code-sketch` an implementation-ready Agentic Memory lane that connects to it.

**Architecture:** A strict companion turn accepts bounded user text plus a bounded client memory snapshot. GonkaRouter sees only non-sensitive contact labels, aliases, and opaque contact IDs; it selects one allowlisted proposal tool. Deterministic code rebinds the opaque ID to the full memory record, checks required fields, and returns a typed clarification or proposal. No Wave 1 tool signs, submits, releases funds, trades, or persists memory server-side.

**Tech Stack:** Next.js 16 route handlers, TypeScript 5.9, Zod 4, existing Gonka structured-router core, Vitest, device-local storage in teammate lane.

---

## Product slice and truth boundary

First demoable command:

> “Give Dave 15 USDC for dinner.”

Expected result:

1. Companion proposes `payments.propose`.
2. Model references opaque contact ID, never wallet address.
3. Deterministic resolver finds Dave in supplied memory.
4. If Dave is uniquely confirmed and has a canonical Sui address, API returns a payment proposal.
5. If Dave is missing, ambiguous, inferred-only, or changed, API returns clarification/hold.
6. Proposal is not a payment. Existing wallet review/payment paths remain separate.

## Dependency graph

```text
Task 1 contracts
├── Task 2 memory/contact resolver
│   ├── Task 3 tool registry/resolver
│   │   ├── Task 4 Gonka companion wrapper
│   │   │   └── Task 5 API route
│   │   └── Teammate Agentic Memory store/UI
│   └── Teammate contact confirmation UI
└── GitHub issue/handoff docs

Task 6 integration tests/docs → Tasks 1–5
```

## Ownership

### Integration owner — current implementation

- `lib/companion/contracts.ts`
- `lib/companion/contact-resolution.ts`
- `lib/companion/tool-registry.ts`
- `lib/companion/turn.ts`
- `lib/gonka/companion.ts`
- `app/api/companion/turn/route.ts`
- focused tests for these modules/routes

### `oyw-code-sketch` — Agentic Memory lane

- `lib/companion/memory-store.ts`
- `tests/companion/memory-store.test.ts`

This lane is domain/storage only. `oyw-code-sketch` must not edit React components, visual styles, Home, chat, navigation, screenshots, or any other UI.

### Integration owner — companion UI lane

- `components/companion/memory-provider.tsx`
- `components/companion/memory-inspector.tsx`
- `components/companion/companion-chat.tsx`
- `components/companion/companion-message.tsx`
- `components/companion/companion-composer.tsx`
- Home integration and all focused component tests

### Protected shared files

Teammate should not edit these until integration owner explicitly hands them over:

- `components/commerce/commerce-chat.tsx`
- `components/remittance/remittance-chat.tsx`
- `components/site-header.tsx`
- `app/page.tsx`
- `README.md`
- `ROADMAP.md`
- `CLAUDE.md`
- `AGENTS.md`

## Task 1: Define bounded companion contracts

**Objective:** Create strict schemas for memory context, contacts, turns, tool candidates and public outcomes.

**Files:**

- Create: `lib/companion/contracts.ts`
- Test: `tests/companion/contracts.test.ts`

**Steps:**

1. Write failing tests for strict-object rejection, collection caps, Unicode/byte bounds, canonical addresses and duplicate contact IDs.
2. Run `pnpm test -- tests/companion/contracts.test.ts`; expect failures because module does not exist.
3. Implement strict Zod schemas and exported inferred types.
4. Ensure full memory may contain canonical wallet addresses but model manifest type cannot.
5. Run focused test; expect pass.

**Key invariants:**

- max 20 contacts, 5 aliases/contact, 20 recent interactions;
- no extra fields;
- no secrets, URLs, transaction bytes or raw receipts;
- memory version pinned to `convey.companion-memory.v1`;
- request message bounded by Unicode code points and UTF-8 bytes;
- model candidates use only allowlisted tool IDs and missing-field enums.

## Task 2: Resolve people deterministically

**Objective:** Resolve model/user references to `unknown`, `ambiguous`, `inferred`, `confirmed`, or `changed_address` without trusting model confidence.

**Files:**

- Create: `lib/companion/contact-resolution.ts`
- Test: `tests/companion/contact-resolution.test.ts`

**Steps:**

1. Write failing tests for exact name, alias, duplicate Dave, missing address, inferred-only, changed address and Unicode normalization.
2. Run focused test; expect module-not-found failure.
3. Implement pure normalizer and resolver.
4. Never choose between multiple matches by recency alone.
5. Run focused test; expect pass.

## Task 3: Register proposal-only tools

**Objective:** Define one allowlisted registry and deterministic candidate-to-outcome resolver.

**Files:**

- Create: `lib/companion/tool-registry.ts`
- Create: `lib/companion/turn.ts`
- Test: `tests/companion/turn.test.ts`

**Allowlisted Wave 1 tools:**

- `contacts.resolve` — context only;
- `payments.propose` — proposal only;
- `splits.propose` — proposal placeholder;
- `missions.propose` — proposal placeholder;
- `strategies.propose` — proposal placeholder;
- `clarify` — no action.

**Steps:**

1. Test unknown tool rejection and exact registry metadata.
2. Test `payments.propose` clarifies missing amount/asset/person.
3. Test ambiguous/changed person holds.
4. Test confirmed contact produces a typed proposal labelled `requires_user_approval`.
5. Implement minimal registry/resolver.
6. Run focused tests.

## Checkpoint: Tasks 1–3

- [ ] Contract, contact and turn tests pass.
- [ ] Model-facing manifest cannot contain wallet address.
- [ ] No function signs, submits, fetches chain state or persists memory.
- [ ] Confirmed-contact proposal is demoable as pure data.

## Task 4: Add Gonka companion domain wrapper

**Objective:** Reuse hardened Gonka transport to return a strict tool candidate referencing only manifest contact IDs.

**Files:**

- Create: `lib/gonka/companion.ts`
- Modify: `lib/gonka/index.ts`
- Test: `tests/gonka/companion.test.ts`

**Steps:**

1. Write failing schema/router tests using existing `tests/gonka/fake-fetch.ts` pattern.
2. Build model manifest from memory with only `contactId`, display name, aliases, relationship label and confirmation state.
3. Define strict system/repair prompts: tool selection only, no wallet/transaction authority, no invented contacts.
4. Validate every candidate contact ID against manifest.
5. Test model mismatch, missing request ID, invalid schema and unknown contact ID fail closed.
6. Run focused test.

## Task 5: Add bounded companion turn API

**Objective:** Expose model proposal plus deterministic resolution through one no-store route.

**Files:**

- Create: `app/api/companion/turn/route.ts`
- Test: `tests/companion/turn-route.test.ts`

**Steps:**

1. Write failing tests for invalid JSON, oversized body, unconfigured Gonka, valid proposal and ambiguous person.
2. Reuse `readBoundedUtf8Body`; do not clone stream parsing.
3. Resolve server-only Gonka config through existing `gonkaConfigFromEnv`.
4. Return strict safe outcomes with `Cache-Control: no-store`.
5. Do not echo provider errors, API keys or raw model output.
6. Run focused test.

## Task 6: Teammate Agentic Memory storage slice

**Objective:** A returning user’s bounded contact and interaction memory can be stored, read, updated and forgotten through a pure, tested storage adapter.

**Files:**

- Create: `lib/companion/memory-store.ts`
- Test: `tests/companion/memory-store.test.ts`

**Steps:**

1. Read `docs/companion/AGENTIC_MEMORY_TEAMMATE_GUIDE.md` and companion contracts.
2. Write failing storage tests for empty state, canonical save, duplicate merge, malformed storage, cap eviction and forget.
3. Implement versioned localStorage adapter; fail closed to empty on malformed data.
4. Export pure operations for `read`, `rememberContact`, `confirmContact`, `recordInteraction`, `forgetContact`, and `clearAll` without importing React.
5. Do not create or edit any component, CSS, screenshot, route, Home/chat integration, navigation, README, or ROADMAP.
6. Run focused tests and typecheck.

## Task 6A: Integration-owner companion UI slice

**Objective:** Ship the chat-first Home UI and connect it to companion turn tooling plus the memory-store adapter.

**Files:**

- Create: `components/companion/memory-provider.tsx`
- Create: `components/companion/memory-inspector.tsx`
- Create: `components/companion/companion-chat.tsx`
- Create: `components/companion/companion-message.tsx`
- Create: `components/companion/companion-composer.tsx`
- Test: `tests/companion/memory-provider.test.tsx`
- Test: `tests/companion/memory-inspector.test.tsx`
- Test: `tests/companion/companion-chat.test.tsx`
- Modify: Home integration only after core tooling and storage contracts are green

**Steps:**

1. Build provider adapter around teammate’s pure storage module.
2. Build finished consumer chat: text, voice, camera/QR affordances and typed action cards.
3. Show memory explanations in a user-owned disclosure, never raw schemas/tool calls.
4. Add loading, clarification, proposal, unavailable and error states.
5. Ensure actions only open review; never submit automatically.
6. Validate desktop, 390 px mobile, keyboard, reduced motion and timed transitions.
7. Refresh README screenshots in same integration diff after visual pass.

## Checkpoint: Tasks 4–6

- [ ] Gonka wrapper/route tests pass.
- [ ] Agentic Memory storage stores only bounded structured data.
- [ ] Integration-owner UI lets user inspect/edit/forget memory.
- [ ] Contact resolution remains deterministic after memory snapshot arrives.
- [ ] Primary wallet action remains outside companion route.

## Task 7: Integration and quality gate

**Objective:** Merge first-wave tooling without weakening current money paths.

**Files:**

- Modify docs only where current behavior changes.
- Do not add primary UI until memory lane returns and separate visual plan is approved.

**Commands:**

```powershell
pnpm test -- tests/companion tests/gonka/companion.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

**Acceptance:**

- all commands pass;
- secret scan clean;
- no competitor-name leakage;
- no model-facing address/key/transaction data;
- route cannot execute money;
- README/ROADMAP claim only implemented behavior;
- code review confirms one owner per policy and no duplicate validation.

## Later waves—not Wave 1

- receipt image upload/OCR;
- obligation ledger and split arithmetic;
- multi-agent scam/risk council;
- additional Home chat intents beyond Wave 1;
- cross-device encrypted memory sync;
- autonomous Thetanuts isolated executor;
- portable on-chain reputation credentials.

Each later wave receives its own vertical ticket and proof gate.
