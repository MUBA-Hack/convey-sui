# Convey — agent guide

Minimal black-and-white Sui voice commerce: chat, voice, client-signed
checkout, and Offline QR Ferry. Chat/voice submits free text to the typed
`/api/commerce/intent` endpoint; a validated preview opens a checkout dialog
that builds and signs a SUI transfer (or an explicitly labelled DEMO
simulation) on the client. The Offline QR Ferry carries a tamper-evident
envelope across an air gap.

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
- Real testnet transfer is allowed only when a wallet is connected, the
  network is testnet, and the configured merchant address canonically
  matches the preview merchant. Anything else is an explicitly labelled
  DEMO simulation — never claim on-chain settlement for DEMO.
- The QR Ferry envelope is a TRANSPORT envelope, not cryptographic payer
  authorization. The checksum detects tampering; the nonce registry defends
  against replay. No signature or authorization is implied.
- Icons: iconsax-react in app-level code (not lucide). shadcn/ui + Tailwind
  utilities; no custom CSS files.

## Layout

- `app/` — Next.js routes: `/` (commerce chat), `/qr-ferry`, `/build-progress`,
  `/offline`, and `app/api/commerce/intent`.
- `lib/commerce/` — intent parser, payment core, QR Ferry envelope, build
  progress parser.
- `lib/protocol/hash.ts` — shared blake2b256 used by the QR Ferry checksum.
- `components/commerce/` — chat, preview, checkout dialog, payment action,
  QR Ferry UI, voice input.
- `components/wallet/` — dAppKit providers and connect button.
- `components/pwa/` — service-worker registration.
- `components/landing/` — footer, primitives, scroll-driver.
- `components/ui/` — shadcn/ui primitives.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
