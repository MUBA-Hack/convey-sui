# Convey — agent guide

Minimal black-and-white Sui money movement built around one family-transfer
journey. **Pay** is primary: a spoken or typed request becomes a transparent
quote, Transfer checks, one wallet approval, and a portable receipt.
**Continue elsewhere** and **Activity** are contextual branches of that
journey. **Treasury** is separate conceptual planning and never implies that it
protects the remittance rate or payout.

## Commands

```bash
pnpm test          # vitest (lib/**, tests/**)
pnpm typecheck && pnpm lint && pnpm build
pnpm dev           # app on :3000
```

## Hard rules

- ESM everywhere; `@noble/hashes` v2 subpaths need `.js` suffixes.
- `@mysten/sui` is v2 — do not write v1 (`SuiClient`) API calls.
- Models never receive URLs, keys, or transaction authority; malformed
  intent output must never become a payment (fail closed).
- The client-signed payment seam lives in `lib/commerce/payment.ts` and
  `components/commerce/payment-action.tsx`; change them deliberately.
- A real nearby-commerce testnet transfer is allowed only when a wallet is
  connected, the network is testnet, and the configured merchant address
  canonically matches the preview merchant. Anything else is an explicitly
  labelled preview.
- A real remittance testnet transfer additionally requires a mapped recipient,
  valid quote attestation, pinned asset and corridor, a fresh quote, a connected
  testnet wallet, and explicit approval. Prepared or carried states are not
  settlement.
- Protected Transfer accepts only a verified quote, deadline preset, and review
  note; package/reviewer coordinates remain server-only and fail closed. The
  client builds and approves the pinned `create_escrow` call. Submission alone
  remains submitted or unknown. Only an exact independent `Created` event match
  creates the portable receipt and local Activity link. Freshly verified Created
  receipts may request a bounded two-model advisory Evidence Council review;
  models cannot release funds. Reviewer release and post-deadline payer refund
  remain explicit wallet actions with separate terminal verification. The Move
  package is still unpublished and unconfigured by default, so no live lifecycle
  artifact is claimed.
- A carried receipt or digest alone is not independent chain evidence. The
  server-only settlement route is fixed to Sui testnet and one read-only lookup;
  verified requires a successful transaction plus exact digest, pinned USDC,
  canonical recipient, and micro amount.
- Settlement responses use the shared strict client-safe schema and must bind to
  the active receipt before verified UI or share/export is allowed. Malformed,
  extra, stale, mismatched, not-found, and unavailable evidence fails closed.
- Sui settlement is never family bank or cash payout. Keep **Confirmed on Sui**
  and **Awaiting family payout** separate; no live real-digest release artifact
  is currently claimed.
- The offline commerce envelope is a TRANSPORT envelope, not cryptographic payer
  authorization. The checksum detects tampering; the nonce registry defends
  against replay. No signature or authorization is implied.
- Icons: iconsax-react in app-level code (not lucide). shadcn/ui + Tailwind
  utilities; no custom CSS files.

## Layout

- `app/` — Next.js routes: `/` (public product landing), `/app` (full-height
  companion workspace), `/pay` (Send money), `/qr-ferry` (Continue elsewhere),
  `/proof` (Activity and receipt verification), `/strategy` (Treasury), and typed
  APIs.
- `app/api/remittance/settlement/verify/` — fixed-testnet, read-only receipt
  verification; 16 KiB streamed body cap, one lookup, six-second abort,
  `no-store`, strict safe response, and no signer or payout authority.
- `app/api/remittance/protected-transfer/plan/` — bounded, no-store plan
  issuance from a verified quote plus server-only candidate coordinates; no
  signer, RPC, submission, or deployment proof.
- `lib/http/` — shared server-only bounded UTF-8 request reader used by typed
  remittance APIs.
- `lib/activity/` — strict bounded device-local receipt-link history. It is
  navigation convenience only and never proof, settlement, or authorization.
- `lib/commerce/` — intent parser, payment core, QR Ferry envelope, and proof
  verification.
- `lib/remittance/` — quote, transfer, and receipt rules plus the shared
  settlement response schema, pure exact-match evaluator, and server-only Sui
  reader; Protected Transfer includes the strict plan client and pinned
  `create_escrow` builder.
- `lib/protocol/hash.ts` — shared blake2b256 used by the QR Ferry checksum.
- `components/remittance/` — the primary request, quote, Transfer checks,
  direct wallet approval, family-review creation, cross-device carry, and
  receipt journey.
- `components/commerce/` — secondary nearby-commerce, handoff, and receipt
  infrastructure shared by the product.
- `components/wallet/` — dAppKit providers and connect button.
- `components/pwa/` — service-worker registration.
- `components/landing/` — footer, primitives, scroll-driver.
- `components/ui/` — shadcn/ui primitives.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
