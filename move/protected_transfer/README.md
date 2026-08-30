# protected_transfer

Minimal Sui Move 2024 package implementing a single-milestone escrow:
`ProtectedTransfer<T>`.

## Authority model

- **Payer** funds the escrow with one `Coin<T>` (value > 0) and is the only
  party who can refund after the deadline.
- **Reviewer** is the only party who can release the full balance to the
  beneficiary before or at the deadline.
- **Beneficiary** is immutable and receives the full coin on release.
- **Payer** is immutable and receives the full coin on refund.
- No admin, AI/model, upgrade, pause, or governance path exists inside this
  module. There is no in-module bypass that can redirect the escrowed coin: the
  only public terminal paths (`release_funds`, `refund_payer`) atomically
  transfer the entire balance to the immutable destination inside the same
  function. No public function returns the escrowed coin to the caller, so a
  PTB cannot intercept or redirect it.
- Terminal `release_funds` / `refund_payer` deletes the object, making a second
  terminal action impossible.

### Upgrade authority caveat

Ordinary publication of this package creates an `UpgradeCap` owned by the
publisher. The absence of an in-module admin/model bypass does **not** remove
this publisher upgrade authority: the package owner can publish a new version of
the module unless the deployed package is made immutable and that immutability
transaction is captured as evidence. Consumers must verify package immutability
on-chain before treating the module logic as fixed.

### Evidence commitment

`evidence_commitment` is a 32-byte commitment stored immutably on the escrow at
creation. It is metadata only: storing it does not validate a preimage or prove
that any referenced evidence is truthful. Verification of the committed
preimage/evidence is an off-chain responsibility.

## Time boundary

- `create_escrow` requires `clock.timestamp_ms() < deadline` (strictly future).
- `release_funds` requires `clock.timestamp_ms() <= deadline`.
- `refund_payer` requires `clock.timestamp_ms() > deadline`.

The shared `Clock` (0x6) is the sole time source.

## Build and test

```powershell
& "$env:LOCALAPPDATA\bin\sui.exe" move build --path move/protected_transfer --warnings-are-errors
& "$env:LOCALAPPDATA\bin\sui.exe" move test --path move/protected_transfer
```

## Entry functions

| Function | Caller | Inputs | Effect |
|---|---|---|---|
| `create_escrow<T>` | payer | `Coin<T>`, beneficiary, reviewer, 32-byte commitment, deadline, `&Clock` | Shares a new `ProtectedTransfer<T>`, emits `Created<T>` |
| `release_funds<T>` | reviewer (at/before deadline) | `ProtectedTransfer<T>`, `&Clock` | Transfers full coin to beneficiary, deletes escrow, emits `Released<T>` |
| `refund_payer<T>` | payer (after deadline) | `ProtectedTransfer<T>`, `&Clock` | Transfers full coin to payer, deletes escrow, emits `Refunded<T>` |

## Events

`Created<T>`, `Released<T>`, `Refunded<T>` are asset-bound via `phantom T` so
the emitted event type tag carries the escrowed coin type. The terminal events
are emitted in the same public function that performs the enforced destination
transfer.

## Getters

`escrow_id`, `payer`, `beneficiary`, `reviewer`, `amount`,
`evidence_commitment`, `deadline`, `held_balance`. These are read-only and never
return the escrowed coin.
