# Convey — agent guide

Minimal black-and-white Sui money movement built around one family-transfer
journey. **Pay** is primary: a spoken or typed request becomes a transparent
quote, Transfer checks, one wallet approval, and a portable receipt.
**Continue elsewhere** and **Receipts** are contextual branches of that
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
- The offline commerce envelope is a TRANSPORT envelope, not cryptographic payer
  authorization. The checksum detects tampering; the nonce registry defends
  against replay. No signature or authorization is implied.
- Icons: iconsax-react in app-level code (not lucide). shadcn/ui + Tailwind
  utilities; no custom CSS files.

## Layout

- `app/` — Next.js routes: `/` (family remittance), `/qr-ferry` (Continue
  elsewhere), `/proof` (Receipts), `/strategy` (Treasury), and typed APIs.
- `lib/commerce/` — intent parser, payment core, QR Ferry envelope, and proof
  verification.
- `lib/protocol/hash.ts` — shared blake2b256 used by the QR Ferry checksum.
- `components/remittance/` — the primary request, quote, Transfer checks,
  wallet approval, cross-device carry, and receipt journey.
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
