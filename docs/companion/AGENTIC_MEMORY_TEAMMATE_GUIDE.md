# Agentic Memory teammate guide

**Owner:** `oyw-code-sketch`

**Goal:** Build the pure, bounded storage layer that lets Convey remember confirmed people and recent financial context. Integration owner builds every UI surface.

**Parent:** GitHub issue #2

**Contract dependency:** GitHub issue #3, `lib/companion/memory.ts`, and `lib/companion/contracts.ts`

## Plain-language mental model

Think of memory as a small address book plus a list of recent verified interactions—not a dump of every chat message.

When user says “Give Dave 15 USDC,” companion tooling needs a safe answer to:

1. Which Dave?
2. Which previously confirmed wallet belongs to that Dave?
3. Why does Convey think this is the same person?
4. Has address changed?
5. Can user inspect or forget this memory?

Memory helps prepare a proposal. It never approves payment.

## Why this is the right long-term-memory design

An AI assistant does not gain reliable memory by feeding it an ever-growing chat transcript. That approach is expensive, hard to inspect, easy to poison, and makes old mistakes look like facts. Convey instead uses **structured memory**:

1. The browser stores a small set of user-confirmed facts.
2. Every fact has an explicit type, size limit and version.
3. The user can inspect, correct or delete it.
4. A request sends a bounded snapshot to the companion route.
5. Gonka sees only safe names, aliases, relationship labels and opaque IDs.
6. Deterministic code—not the model—maps the chosen ID back to an address.
7. The wallet still asks the user to approve any transaction.

This gives the product useful continuity (“Dave” still means the confirmed Dave) without turning model output into payment authority.

## Technologies: what they are and why we use them

### TypeScript

TypeScript is JavaScript with compile-time types. It catches mistakes such as passing a receipt where a contact is expected before the app runs. Use the memory types exported from `lib/companion/memory.ts`; do not duplicate interfaces in the store. The store should be a normal `.ts` module with no JSX.

### Zod

Zod is the runtime validation library already installed in this repo. TypeScript types disappear after compilation, so they cannot protect data read from `localStorage`. Zod checks real runtime values and rejects unknown fields because the companion schemas use `z.strictObject(...)`.

Use this pattern at every trust boundary:

```ts
const parsed = CompanionMemorySchema.safeParse(candidate);
if (!parsed.success) return EMPTY_COMPANION_MEMORY;
return parsed.data;
```

Use `safeParse`, not type assertions such as `value as CompanionMemory`. A type assertion only silences the compiler; it does not validate anything.

### Browser `localStorage`

`localStorage` is a small key/value store built into browsers. It persists across refreshes on the same browser profile and works offline, which is enough for the hackathon’s user-controlled memory. Values are strings, so the adapter serializes the validated envelope with `JSON.stringify` and parses it with `JSON.parse`.

Important limitations:

- It is device-local, not cloud sync.
- Any script running on the same site can access it, so never store secrets.
- Writes are synchronous, so keep the payload tiny.
- It may throw in private/restricted browser contexts, so reads and writes must fail safely.

### Dependency injection

Dependency injection means the store receives its storage object instead of importing the browser global directly. Production passes `window.localStorage`; tests pass an in-memory fake. This makes tests fast and stops server rendering from crashing because `window` does not exist on the server.

```ts
const store = createCompanionMemoryStore(window.localStorage);
```

Do not call that at module scope. The integration owner will call it inside a client-side React boundary.

### Vitest

Vitest is the repository’s unit-test runner. It understands TypeScript and the `@/` path alias. Store tests should not render React or start Next.js. Use a fake object implementing `getItem`, `setItem`, and `removeItem`, then create a fresh store instance to prove persistence behavior.

```ts
const values = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => void values.set(key, value),
  removeItem: (key) => void values.delete(key),
};
```

### Next.js and React boundary

Next.js is the app framework and React renders the UI. This issue deliberately does not use either. Keeping memory as a pure TypeScript adapter lets the same rules work from Home, future receipt flows, and tests. The integration owner will add the React provider and visual controls after this module lands.

### Gonka Router boundary

Gonka Router is the OpenAI-compatible inference endpoint used by the server companion route. The storage layer never calls Gonka. It only produces a validated snapshot. Server tooling creates a redacted manifest for Gonka, receives an opaque contact ID, then deterministic code rebinds that ID to the full local record. This separation prevents an LLM from inventing or changing a wallet address.

### Technologies not needed in Wave 1

Do not add LangChain, LlamaIndex, embeddings, a vector database, Redis, Postgres, Prisma or a hosted memory service. Those tools solve semantic retrieval and multi-device persistence at larger scale. They add migrations, privacy surface and failure modes without improving the immediate “who is Dave?” problem. A future encrypted sync layer can replace the injected storage adapter without changing the companion contracts.

## Read these files first

1. `CLAUDE.md` — product truth and commands.
2. `AGENTS.md` — coordination and security rules.
3. `docs/plans/2026-09-02-companion-tooling-wave-1.md` — dependency/ownership plan.
4. `lib/companion/memory.ts` — exact persisted memory schema and exported types.
5. `lib/companion/contracts.ts` — exact input and outcome accepted by the companion route.
6. `lib/companion/contact-resolution.ts` — how names/aliases are resolved.
7. `lib/activity/storage.ts` — good pattern for bounded, versioned, fail-closed localStorage.
8. `lib/activity/types.ts` — good pattern for explicit local-only truth boundaries.
9. `tests/companion/contact-resolution.test.ts` — cases your storage must preserve.

If `lib/companion/*` files are still landing, wait for integration owner’s commit before coding against guessed shapes.

## Files you own

- `lib/companion/memory-store.ts`
- `tests/companion/memory-store.test.ts`

Do not create or edit React components, visual styles, Home/chat, payment, wallet, navigation, screenshots, README or roadmap files. Integration owner owns all UI and connects your pure storage adapter later.

## What to store

Store only structured, bounded facts already accepted by `CompanionMemorySchema`:

- opaque contact ID;
- display name;
- aliases such as `Dave`, `David`, `club treasurer`;
- relationship label chosen by user;
- canonical wallet address only after explicit confirmation;
- confirmation state and timestamp;
- IDs of recent verified receipts that justify “last paid”; never copy full receipt payload;
- a bounded interaction record: ID, contact ID, `payment | split | mission | strategy`, timestamp and an optional 120-character user-facing summary.

Do not store:

- private keys, seed phrases, auth tokens or API keys;
- transaction bytes;
- raw receipt images;
- full chat transcript;
- medical documents;
- claims that someone is safe/scammer;
- model confidence as identity proof.

## Required behavior

### First contact

User says Dave’s name, but memory has no Dave. Snapshot returns no match. Companion asks user to choose/add a contact.

### Confirmed contact

User explicitly confirms Dave Lim and a canonical Sui address matching `^0x[0-9a-f]{64}$`. Store state as confirmed. Next request may prefill Dave in payment review, but wallet approval remains required.

### Two Daves

Never pick most recent automatically. Keep both records. Resolver returns ambiguous so UI asks which Dave.

### Address change

Do not overwrite confirmed address silently. Preserve previous address and surface `changed_address` until user explicitly reconfirms.

### Forget

User can delete one contact or clear all memory. Update must be immediate. No hidden backup or resurrection from old chat.

### Corrupt storage

If localStorage is malformed, oversized or wrong version, return empty memory. Never partly trust corrupt records.

## Storage design

Use one versioned envelope and one key. Do not create a database, embeddings, vector search, cookies or server session for Wave 1:

```ts
const COMPANION_MEMORY_STORAGE_KEY = "convey.companion-memory.v1";

interface CompanionMemory {
  version: "convey.companion-memory.v1";
  ownerLabel: string | null;
  contacts: CompanionContact[];
  interactions: CompanionInteraction[];
}
```

Parse every read and every proposed write with `CompanionMemorySchema`. Keep at most 20 contacts and 20 newest interactions. Reject duplicate contact IDs. Never merge two contacts merely because their display names or aliases match: two Daves are legitimate and ambiguity is handled by `resolveContact`.

### Persistence seam

Keep browser persistence replaceable and tests deterministic:

```ts
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createCompanionMemoryStore(storage: KeyValueStorage): CompanionMemoryStore;
```

Do not read global `window.localStorage` at module import time. The integration owner will pass it from a client component. Tests should use a tiny in-memory fake.

### Suggested file skeleton

```ts
import {
  CompanionContactSchema,
  CompanionInteractionSchema,
  CompanionMemorySchema,
  EMPTY_COMPANION_MEMORY,
  type CompanionContact,
  type CompanionInteraction,
  type CompanionMemory,
} from "./memory";

export const COMPANION_MEMORY_STORAGE_KEY = "convey.companion-memory.v1";
const MAX_RAW_BYTES = 32 * 1024;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createCompanionMemoryStore(storage: KeyValueStorage) {
  // Put the six small operations described below here.
  // Validate the complete envelope immediately before every setItem.
}
```

Keep helpers private unless tests genuinely need a public operation. Small functions such as `parseStoredMemory`, `persist`, and `hasUniqueIds` are enough.

## Storage adapter API

Expose small operations:

```ts
interface CompanionMemoryStore {
  read(): CompanionMemory;
  rememberContact(input: CompanionContact): MemoryWriteResult;
  confirmContact(input: {
    contactId: string;
    address: string;
    confirmedAt: number;
  }): MemoryWriteResult;
  recordInteraction(input: CompanionInteraction): MemoryWriteResult;
  forgetContact(contactId: string): MemoryWriteResult;
  clearAll(): MemoryWriteResult;
}
```

No React, DOM, hooks or general `setState` export. UI components must not be able to bypass invariants.

Suggested result shape:

```ts
type MemoryWriteResult =
  | { ok: true; memory: CompanionMemory }
  | { ok: false; code: "invalid" | "duplicate" | "address_changed" | "not_found" };
```

Use this exact idea or an equally small typed union. Never throw for ordinary user-data problems.

## Algorithms to implement

### `read()`

1. Read `convey.companion-memory.v1`.
2. Missing key → return `EMPTY_COMPANION_MEMORY`.
3. Reject a raw string larger than 32 KiB before JSON parsing.
4. Parse JSON inside `try/catch`.
5. Validate with `CompanionMemorySchema`.
6. Check contact IDs are unique and interaction IDs are unique.
7. Any failure → return empty memory; never return a partially parsed object.

### `rememberContact(contact)`

1. Read current valid memory.
2. Validate the new contact through `CompanionContactSchema`.
3. Reject an existing contact ID instead of silently overwriting it.
4. Append and validate the complete envelope.
5. Persist only after validation succeeds.

### `confirmContact({ contactId, address, confirmedAt })`

1. Find contact by opaque ID, never display name.
2. Reject a missing contact.
3. Validate canonical lowercase Sui address.
4. If contact already has a different confirmed address, return `address_changed`; do not mutate storage.
5. Otherwise set address, `confirmation: "confirmed"` and `confirmedAt`.
6. A later product flow will explicitly approve an address rotation; it is outside this issue.

### `recordInteraction(interaction)`

1. Validate the interaction.
2. Require its `contactId` to exist.
3. Reject duplicate interaction ID.
4. Insert newest first, sort by `occurredAt` descending and keep the newest 20.
5. Accept only the contract's bounded summary field; never store a full transcript, receipt body, document, address, or model reasoning in it.

### `forgetContact(contactId)`

Remove the contact and every interaction that refers to it, then validate and persist. This prevents forgotten relationships from surviving indirectly.

### `clearAll()`

Remove the storage key or write the canonical empty envelope. A following `read()` must return `EMPTY_COMPANION_MEMORY`.

## Connecting to companion tooling

Integration owner will wrap your storage adapter in a React provider, then call:

```ts
await fetch("/api/companion/turn", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message,
    localeHint: navigator.language,
    memory: memoryStore.read(),
  }),
});
```

Server sends only safe contact labels, aliases, relationship and opaque IDs to Gonka. It does not send wallet addresses. After model returns contact ID, deterministic `lib/companion/contact-resolution.ts` rebinds it against the full snapshot.

The integration owner will subscribe/re-read after successful writes and render memory controls. You do not need an event emitter, React context or UI callback. Returning the updated memory from each successful operation is enough.

## Acceptance tests

- empty first load;
- exact round trip;
- malformed JSON, wrong version and raw payload over 32 KiB → empty;
- 21st contact rejected and interactions evicted to newest 20;
- duplicate ID rejection;
- two Daves remain separate;
- canonical first address confirmation succeeds;
- different confirmed address returns `address_changed` without mutation;
- unknown interaction contact rejected;
- forgetting a contact also removes its interactions;
- clear all survives a new store instance;
- strict schemas reject extra secret/raw-image/transcript fields;
- typecheck passes.

Write tests first. Demonstrate the missing module or failing behavior before implementation, then make each case pass.

## Commands

```powershell
pnpm vitest run tests/companion/memory-store.test.ts
pnpm typecheck
```

Before handoff, also run:

```powershell
git diff -- lib/companion/memory-store.ts tests/companion/memory-store.test.ts
git status --short
```

Only the two owned files should be changed by this task.

## Definition of done

- Storage is a small deterministic TypeScript module, not an “AI memory framework.”
- Every persisted byte is schema-validated and bounded.
- A model cannot create, confirm, rotate or forget contacts by itself.
- Address changes fail closed.
- Users can later inspect and delete everything through UI owned by integration owner.
- Focused tests and typecheck pass with raw command results in the handoff comment.

## Handoff format

Return:

- changed files;
- behavior added;
- raw focused test/typecheck outcomes;
- limitations;
- confirmation that no React/UI/Home/payment files were touched.
