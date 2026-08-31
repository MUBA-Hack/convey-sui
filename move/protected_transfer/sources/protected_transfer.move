module protected_transfer::protected_transfer;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::{Self, Clock};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

/// Funding coin has zero value.
const EZeroFunding: u64 = 0;
/// Deadline is not strictly in the future relative to the shared Clock.
const EDeadlineNotInFuture: u64 = 1;
/// Evidence commitment is not exactly 32 bytes.
const EInvalidEvidenceCommitment: u64 = 2;
/// Caller is not the reviewer authorised to release.
const EUnauthorizedRelease: u64 = 3;
/// Caller is not the payer authorised to refund.
const EUnauthorizedRefund: u64 = 4;
/// Release attempted after the deadline has passed.
const EReleaseAfterDeadline: u64 = 5;
/// Refund attempted at or before the deadline.
const ERefundBeforeDeadline: u64 = 6;
/// Beneficiary is the zero address.
const EZeroBeneficiary: u64 = 7;
/// Reviewer is the zero address.
const EZeroReviewer: u64 = 8;
/// Payer, beneficiary, and reviewer must be pairwise distinct.
const ECollidingRoles: u64 = 9;

/// Single-milestone escrow: payer locks one `Coin<T>`, reviewer releases to
/// beneficiary before/at deadline, payer refunds after deadline. Terminal
/// action deletes the object so it can never be acted on twice.
public struct ProtectedTransfer<phantom T> has key {
    id: UID,
    payer: address,
    beneficiary: address,
    reviewer: address,
    amount: u64,
    evidence_commitment: vector<u8>,
    deadline: u64,
    balance: Balance<T>,
}

/// Asset-bound lifecycle events. The `phantom T` tag makes the emitted event
/// type carry the escrowed coin type so consumers can filter by asset.
public struct Created<phantom T> has copy, drop {
    id: ID,
    payer: address,
    beneficiary: address,
    reviewer: address,
    amount: u64,
    deadline: u64,
    evidence_commitment: vector<u8>,
}

public struct Released<phantom T> has copy, drop {
    id: ID,
    payer: address,
    beneficiary: address,
    reviewer: address,
    amount: u64,
    deadline: u64,
    evidence_commitment: vector<u8>,
}

public struct Refunded<phantom T> has copy, drop {
    id: ID,
    payer: address,
    beneficiary: address,
    reviewer: address,
    amount: u64,
    deadline: u64,
    evidence_commitment: vector<u8>,
}

// === Read-only getters ===

public fun escrow_id<T>(self: &ProtectedTransfer<T>): ID {
    object::uid_to_inner(&self.id)
}

public fun payer<T>(self: &ProtectedTransfer<T>): address {
    self.payer
}

public fun beneficiary<T>(self: &ProtectedTransfer<T>): address {
    self.beneficiary
}

public fun reviewer<T>(self: &ProtectedTransfer<T>): address {
    self.reviewer
}

public fun amount<T>(self: &ProtectedTransfer<T>): u64 {
    self.amount
}

public fun evidence_commitment<T>(self: &ProtectedTransfer<T>): &vector<u8> {
    &self.evidence_commitment
}

public fun deadline<T>(self: &ProtectedTransfer<T>): u64 {
    self.deadline
}

public fun held_balance<T>(self: &ProtectedTransfer<T>): u64 {
    self.balance.value()
}

// === Production-public entry functions ===
//
// These are the only paths that can move the escrowed coin. Each function
// atomically validates inputs, destructures the escrow exactly once, enforces
// transfer of the entire balance to the immutable destination, deletes the
// object, and emits the terminal event in the same function that performs the
// transfer. No public function returns the escrowed coin or the escrow object
// to the caller, and no private bypass exists that could redirect the coin.

/// Payer funds the escrow and shares it. The funding coin is absorbed.
public fun create_escrow<T>(
    coin: Coin<T>,
    beneficiary: address,
    reviewer: address,
    evidence_commitment: vector<u8>,
    deadline: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroFunding);
    assert!(clock::timestamp_ms(clock) < deadline, EDeadlineNotInFuture);
    assert!(evidence_commitment.length() == 32, EInvalidEvidenceCommitment);
    assert!(beneficiary != @0x0, EZeroBeneficiary);
    assert!(reviewer != @0x0, EZeroReviewer);

    let payer = tx_context::sender(ctx);
    assert!(payer != beneficiary, ECollidingRoles);
    assert!(payer != reviewer, ECollidingRoles);
    assert!(beneficiary != reviewer, ECollidingRoles);
    let balance = coin::into_balance(coin);
    let escrow = ProtectedTransfer<T> {
        id: object::new(ctx),
        payer,
        beneficiary,
        reviewer,
        amount,
        evidence_commitment,
        deadline,
        balance,
    };
    event::emit(Created<T> {
        id: object::uid_to_inner(&escrow.id),
        payer,
        beneficiary,
        reviewer,
        amount,
        deadline,
        evidence_commitment,
    });
    transfer::share_object(escrow);
}

/// Reviewer releases the entire balance to the immutable beneficiary before or
/// at the deadline. The escrow is destructured once and deleted; the terminal
/// `Released` event is emitted here, in the same function that performs the
/// enforced transfer to the beneficiary.
public fun release_funds<T>(
    self: ProtectedTransfer<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let ProtectedTransfer<T> {
        id, payer, beneficiary, reviewer, amount, evidence_commitment, deadline, balance,
    } = self;
    assert!(tx_context::sender(ctx) == reviewer, EUnauthorizedRelease);
    assert!(clock::timestamp_ms(clock) <= deadline, EReleaseAfterDeadline);
    let escrow_id = object::uid_to_inner(&id);
    let coin = coin::from_balance(balance, ctx);
    id.delete();
    transfer::public_transfer(coin, beneficiary);
    event::emit(Released<T> {
        id: escrow_id,
        payer,
        beneficiary,
        reviewer,
        amount,
        deadline,
        evidence_commitment,
    });
}

/// Payer refunds the entire balance to the immutable payer after the deadline.
/// The escrow is destructured once and deleted; the terminal `Refunded` event
/// is emitted here, in the same function that performs the enforced transfer
/// to the payer.
public fun refund_payer<T>(
    self: ProtectedTransfer<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let ProtectedTransfer<T> {
        id, payer, beneficiary, reviewer, amount, evidence_commitment, deadline, balance,
    } = self;
    assert!(tx_context::sender(ctx) == payer, EUnauthorizedRefund);
    assert!(clock::timestamp_ms(clock) > deadline, ERefundBeforeDeadline);
    let escrow_id = object::uid_to_inner(&id);
    let coin = coin::from_balance(balance, ctx);
    id.delete();
    transfer::public_transfer(coin, payer);
    event::emit(Refunded<T> {
        id: escrow_id,
        payer,
        beneficiary,
        reviewer,
        amount,
        deadline,
        evidence_commitment,
    });
}

// === Test-only event field accessors ===
//
// Event structs have `copy, drop` but their fields are module-private. These
// `#[test_only]` accessors return each event's full payload as a single tuple
// so tests can destructure and assert every field. They are stripped from
// published bytecode and do not enlarge the public API.

#[test_only]
public fun created_fields<T>(
    e: &Created<T>,
): (ID, address, address, address, u64, u64, vector<u8>) {
    (e.id, e.payer, e.beneficiary, e.reviewer, e.amount, e.deadline, e.evidence_commitment)
}

#[test_only]
public fun released_fields<T>(
    e: &Released<T>,
): (ID, address, address, address, u64, u64, vector<u8>) {
    (e.id, e.payer, e.beneficiary, e.reviewer, e.amount, e.deadline, e.evidence_commitment)
}

#[test_only]
public fun refunded_fields<T>(
    e: &Refunded<T>,
): (ID, address, address, address, u64, u64, vector<u8>) {
    (e.id, e.payer, e.beneficiary, e.reviewer, e.amount, e.deadline, e.evidence_commitment)
}
