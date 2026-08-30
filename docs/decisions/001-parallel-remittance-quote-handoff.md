# ADR-001: Parallel remittance quote handoff wrapper

## Status

Accepted

## Date

2026-08-30

## Context

Convey ships two offline QR transports that share the `/qr-ferry` (Pay offline)
surface and the same camera scanner, but carry fundamentally different payloads
and trust semantics:

1. **Commerce QR Ferry v1** (`lib/commerce/qr-ferry.ts`) — a tamper-evident
   transport envelope for a native-SUI purchase intent. It carries its own
   `blake2b256` checksum, versioned shape, nonce, expiry, and a device-local
   consume-once replay registry. It is explicitly **not** payer authorization:
   the checksum detects tampering and the nonce registry defends against local
   replay, but no signature or global replay authority is implied.

2. **Remittance signed quote** (`lib/remittance/quote-schema.ts`,
   `lib/remittance/attestation.server.ts`) — an already-strict `QuoteEnvelope`
   with server-only HMAC-SHA256 attestation, expiry, recipient/corridor/amount
   binding, and a separate connected `/api/remittance/quote/verify` endpoint
   that re-checks all of those plus the Family Rule before transaction
   building. This is the authoritative quote integrity control for the Ana
   remittance journey.

A new requirement emerged: carry the exact signed remittance quote by QR to a
connected device, camera-scan it, server-verify it, and let the customer
explicitly approve it — without funds moving during the carry. The question was
how to add this carry path without weakening either existing control.

Three options were considered:

- Mutate the commerce QR Ferry v1 schema to also carry a remittance quote.
- Relabel the commerce QR Ferry v1 envelope as the remittance handoff.
- Add a separate, discriminated remittance-quote handoff wrapper that contains
  the existing strict `QuoteEnvelope` and adds no new cryptographic or replay
  promises of its own.

## Decision

Add a separate, discriminated **remittance quote handoff wrapper**
(`lib/remittance/offline-handoff.ts`) that contains the existing strict
`QuoteEnvelope` and adds **no** outer signature, checksum, or replay promise.

The wrapper is a minimal discriminated object:

```text
{
  kind: "convey.remittance-quote",
  version: 1,
  quote: <existing strict QuoteEnvelope>
}
```

`sniffHandoffKind` discriminates `convey.remittance-quote` from commerce
`qr-ferry` envelopes and unknown payloads before any import logic runs, so the
camera scanner (`components/commerce/qr-scanner.tsx`, `@zxing/browser`) can feed
both payload types into the same strict import discrimination without one path
masquerading as the other. The camera begins only on an explicit **Scan QR**
tap.

The wrapper deliberately reuses the existing strict `QuoteEnvelopeSchema` for
its inner payload. Quote attestation/expiry and the connected
`/api/remittance/quote/verify` endpoint remain the authoritative integrity
controls for the carried quote. The connected `RemittanceHandoffCard` re-runs
the same blocker resolution (recipient mapping, attestation, wallet, testnet)
and the same checkout dialog as the home quote ticket.

## Alternatives considered

### Mutate the commerce QR Ferry v1 schema

- Pros: one envelope shape, one import path.
- Cons: the commerce envelope's checksum, nonce registry, and 24-hour lifetime
  are designed for a native-SUI purchase intent with a merchant address and
  MIST amount. Bolting a USDC quote onto it would either duplicate those fields
  (inviting ambiguity about which integrity control applies) or silently drop
  them (weakening the commerce path). It would also blur the documented
  boundary that the commerce envelope is **not** payer authorization — exactly
  the boundary this build is meant to preserve.
- Rejected: it would weaken the commerce envelope's invariants and obscure the
  trust boundary between a tamper-evident transport and an attested quote.

### Relabel the commerce QR Ferry v1 envelope as the remittance handoff

- Pros: no new code.
- Cons: the commerce envelope carries no HMAC attestation, no Family Rule, no
  corridor/recipient/amount binding, and no connected verify endpoint. Relabeling
  it would imply the carry itself authorizes the remittance, which is false. It
  would also erase the secondary commerce capability (River Cafe native-SUI
  purchases) by overloading its only transport.
- Rejected: it would create a false authorization claim and erase a working
  secondary flow.

## Consequences

- The remittance carry path inherits the existing strict `QuoteEnvelope` schema,
  HMAC attestation, expiry, and connected verification — no new cryptographic
  surface to audit.
- The commerce QR Ferry v1 envelope keeps its checksum/nonce/expiry invariants
  unchanged and remains the transport for native-SUI purchase intents only.
- The camera scanner and Pay offline surface serve both payloads through one
  strict kind discrimination, with no auto-start and no cross-payload
  reinterpretation.
- The wrapper is small, versioned, and bounded (16 KB cap) so it stays
  QR-friendly.

### Explicit no-new-authorization / no-replay semantics

This decision adds **no** new authorization or replay semantics:

- The wrapper is **not** a payer signature. It does not authorize the USDC
  transfer; only the connected wallet does.
- The wrapper adds **no** outer checksum. Tamper detection for the carried
  quote comes from the inner `QuoteEnvelope` attestation and the connected
  verify endpoint, not from the wrapper.
- The wrapper adds **no** replay protection. The commerce QR Ferry v1
  device-local nonce registry is **not** applied to remittance handoffs; replay
  authority for the carried quote comes from quote expiry and connected
  verification, not from a wrapper-level nonce.
- The wrapper adds **no** cross-device replay authority. Cross-device replay
  protection remains a future milestone for both transports.

If cross-device replay authority is later required for the remittance carry, it
should be added as a separate, explicitly signed mechanism (for example, a
payer-signed offline intent) in a new ADR, not by retrofitting a nonce onto
this wrapper.
