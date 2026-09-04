module protected_transfer::recurring_cap;

use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const EZeroFunding: u64 = 0;
const EInvalidBeneficiary: u64 = 1;
const EInvalidPerPaymentCap: u64 = 2;
const EInvalidTotalCap: u64 = 3;
const EInvalidInterval: u64 = 4;
const EInvalidExpiry: u64 = 5;
const EInvalidCommitment: u64 = 6;
const EUnauthorizedBeneficiary: u64 = 7;
const EZeroCollection: u64 = 8;
const EPerPaymentCapExceeded: u64 = 9;
const ETotalCapExceeded: u64 = 10;
const ETooSoon: u64 = 11;
const EExpired: u64 = 12;
const EUnauthorizedRevoke: u64 = 13;

/// A pre-funded recurring mandate. The beneficiary can collect only within an
/// immutable per-payment cap, total cap, minimum interval, and expiry. The
/// owner may revoke at any time and receives every unspent unit.
public struct RecurringCap<phantom T> has key {
    id: UID,
    owner: address,
    beneficiary: address,
    per_payment_cap: u64,
    total_cap: u64,
    paid_amount: u64,
    interval_ms: u64,
    next_collection_after: u64,
    expiry: u64,
    intent_commitment: vector<u8>,
    balance: Balance<T>,
}

public struct RecurringCapCreated<phantom T> has copy, drop {
    id: ID,
    owner: address,
    beneficiary: address,
    funded_amount: u64,
    per_payment_cap: u64,
    total_cap: u64,
    interval_ms: u64,
    expiry: u64,
    intent_commitment: vector<u8>,
}

public struct RecurringPaymentCollected<phantom T> has copy, drop {
    id: ID,
    beneficiary: address,
    amount: u64,
    paid_amount: u64,
    remaining_total_cap: u64,
    next_collection_after: u64,
    intent_commitment: vector<u8>,
}

public struct RecurringCapRevoked<phantom T> has copy, drop {
    id: ID,
    owner: address,
    refunded_amount: u64,
    paid_amount: u64,
    intent_commitment: vector<u8>,
}

public fun mandate_id<T>(self: &RecurringCap<T>): ID {
    object::uid_to_inner(&self.id)
}

public fun paid_amount<T>(self: &RecurringCap<T>): u64 {
    self.paid_amount
}

public fun remaining_total_cap<T>(self: &RecurringCap<T>): u64 {
    self.total_cap - self.paid_amount
}

public fun held_balance<T>(self: &RecurringCap<T>): u64 {
    self.balance.value()
}

public fun create<T>(
    coin: Coin<T>,
    beneficiary: address,
    per_payment_cap: u64,
    total_cap: u64,
    interval_ms: u64,
    expiry: u64,
    intent_commitment: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let funded_amount = coin.value();
    let owner = tx_context::sender(ctx);
    let now = clock.timestamp_ms();
    assert!(funded_amount > 0, EZeroFunding);
    assert!(beneficiary != @0x0 && beneficiary != owner, EInvalidBeneficiary);
    assert!(per_payment_cap > 0, EInvalidPerPaymentCap);
    assert!(total_cap >= per_payment_cap && total_cap <= funded_amount, EInvalidTotalCap);
    assert!(interval_ms > 0, EInvalidInterval);
    assert!(expiry > now, EInvalidExpiry);
    assert!(intent_commitment.length() == 32, EInvalidCommitment);

    let mandate = RecurringCap<T> {
        id: object::new(ctx),
        owner,
        beneficiary,
        per_payment_cap,
        total_cap,
        paid_amount: 0,
        interval_ms,
        next_collection_after: now,
        expiry,
        intent_commitment,
        balance: coin.into_balance(),
    };
    event::emit(RecurringCapCreated<T> {
        id: object::uid_to_inner(&mandate.id),
        owner,
        beneficiary,
        funded_amount,
        per_payment_cap,
        total_cap,
        interval_ms,
        expiry,
        intent_commitment,
    });
    transfer::share_object(mandate);
}

public fun collect<T>(
    self: &mut RecurringCap<T>,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    assert!(tx_context::sender(ctx) == self.beneficiary, EUnauthorizedBeneficiary);
    assert!(now <= self.expiry, EExpired);
    assert!(now >= self.next_collection_after, ETooSoon);
    assert!(amount > 0, EZeroCollection);
    assert!(amount <= self.per_payment_cap, EPerPaymentCapExceeded);
    assert!(self.paid_amount + amount <= self.total_cap, ETotalCapExceeded);

    self.paid_amount = self.paid_amount + amount;
    self.next_collection_after = now + self.interval_ms;
    let payment = self.balance.split(amount);
    transfer::public_transfer(coin::from_balance(payment, ctx), self.beneficiary);
    event::emit(RecurringPaymentCollected<T> {
        id: object::uid_to_inner(&self.id),
        beneficiary: self.beneficiary,
        amount,
        paid_amount: self.paid_amount,
        remaining_total_cap: self.total_cap - self.paid_amount,
        next_collection_after: self.next_collection_after,
        intent_commitment: self.intent_commitment,
    });
}

public fun revoke<T>(self: RecurringCap<T>, ctx: &mut TxContext) {
    assert!(tx_context::sender(ctx) == self.owner, EUnauthorizedRevoke);
    let RecurringCap<T> {
        id,
        owner,
        beneficiary: _,
        per_payment_cap: _,
        total_cap: _,
        paid_amount,
        interval_ms: _,
        next_collection_after: _,
        expiry: _,
        intent_commitment,
        balance,
    } = self;
    let mandate_id = object::uid_to_inner(&id);
    let refunded_amount = balance.value();
    id.delete();
    transfer::public_transfer(coin::from_balance(balance, ctx), owner);
    event::emit(RecurringCapRevoked<T> {
        id: mandate_id,
        owner,
        refunded_amount,
        paid_amount,
        intent_commitment,
    });
}
