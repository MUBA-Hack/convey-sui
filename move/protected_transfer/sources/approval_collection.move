module protected_transfer::approval_collection;

use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const EZeroFunding: u64 = 0;
const EInvalidDeadline: u64 = 1;
const EInvalidCommitment: u64 = 2;
const EInvalidApprovers: u64 = 3;
const EInvalidThreshold: u64 = 4;
const EDuplicateApprover: u64 = 5;
const EUnauthorizedApprover: u64 = 6;
const EAlreadyApproved: u64 = 7;
const EApprovalAfterDeadline: u64 = 8;
const EThresholdNotMet: u64 = 9;
const EUnauthorizedRelease: u64 = 10;
const EReleaseAfterDeadline: u64 = 11;
const EUnauthorizedRefund: u64 = 12;
const ERefundBeforeDeadline: u64 = 13;
const EInvalidBeneficiary: u64 = 14;

const MAX_APPROVERS: u64 = 10;

/// A funded agreement whose immutable beneficiary can receive the balance only
/// after an on-chain M-of-N approval threshold is reached.
public struct ApprovalCollection<phantom T> has key {
    id: UID,
    creator: address,
    beneficiary: address,
    approvers: vector<address>,
    approvals: vector<address>,
    threshold: u64,
    amount: u64,
    intent_commitment: vector<u8>,
    deadline: u64,
    balance: Balance<T>,
}

public struct CollectionCreated<phantom T> has copy, drop {
    id: ID,
    creator: address,
    beneficiary: address,
    approvers: vector<address>,
    threshold: u64,
    amount: u64,
    intent_commitment: vector<u8>,
    deadline: u64,
}

public struct CollectionApproved<phantom T> has copy, drop {
    id: ID,
    approver: address,
    approval_count: u64,
    threshold: u64,
}

public struct CollectionReleased<phantom T> has copy, drop {
    id: ID,
    creator: address,
    beneficiary: address,
    amount: u64,
    approval_count: u64,
    threshold: u64,
    intent_commitment: vector<u8>,
}

public struct CollectionRefunded<phantom T> has copy, drop {
    id: ID,
    creator: address,
    amount: u64,
    intent_commitment: vector<u8>,
}

fun contains_address(values: &vector<address>, candidate: address): bool {
    let mut index = 0;
    while (index < values.length()) {
        if (values[index] == candidate) return true;
        index = index + 1;
    };
    false
}

fun assert_valid_approvers(
    approvers: &vector<address>,
    creator: address,
    beneficiary: address,
) {
    let count = approvers.length();
    assert!(count > 0 && count <= MAX_APPROVERS, EInvalidApprovers);
    let mut outer = 0;
    while (outer < count) {
        let current = approvers[outer];
        assert!(current != @0x0 && current != beneficiary, EInvalidApprovers);
        let mut inner = outer + 1;
        while (inner < count) {
            assert!(current != approvers[inner], EDuplicateApprover);
            inner = inner + 1;
        };
        outer = outer + 1;
    };
    // Creator may be an approver. This supports a two-person account where the
    // creator and a second guardian both approve, without weakening threshold.
    let _ = creator;
}

public fun collection_id<T>(self: &ApprovalCollection<T>): ID {
    object::uid_to_inner(&self.id)
}

public fun approval_count<T>(self: &ApprovalCollection<T>): u64 {
    self.approvals.length()
}

public fun required_approvals<T>(self: &ApprovalCollection<T>): u64 {
    self.threshold
}

public fun held_balance<T>(self: &ApprovalCollection<T>): u64 {
    self.balance.value()
}

public fun create<T>(
    coin: Coin<T>,
    beneficiary: address,
    approvers: vector<address>,
    threshold: u64,
    intent_commitment: vector<u8>,
    deadline: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let amount = coin.value();
    let creator = tx_context::sender(ctx);
    assert!(amount > 0, EZeroFunding);
    assert!(beneficiary != @0x0 && beneficiary != creator, EInvalidBeneficiary);
    assert!(clock.timestamp_ms() < deadline, EInvalidDeadline);
    assert!(intent_commitment.length() == 32, EInvalidCommitment);
    assert_valid_approvers(&approvers, creator, beneficiary);
    assert!(threshold > 0 && threshold <= approvers.length(), EInvalidThreshold);

    let collection = ApprovalCollection<T> {
        id: object::new(ctx),
        creator,
        beneficiary,
        approvers,
        approvals: vector[],
        threshold,
        amount,
        intent_commitment,
        deadline,
        balance: coin.into_balance(),
    };
    event::emit(CollectionCreated<T> {
        id: object::uid_to_inner(&collection.id),
        creator,
        beneficiary,
        approvers: collection.approvers,
        threshold,
        amount,
        intent_commitment,
        deadline,
    });
    transfer::share_object(collection);
}

public fun approve<T>(
    self: &mut ApprovalCollection<T>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let approver = tx_context::sender(ctx);
    assert!(clock.timestamp_ms() <= self.deadline, EApprovalAfterDeadline);
    assert!(contains_address(&self.approvers, approver), EUnauthorizedApprover);
    assert!(!contains_address(&self.approvals, approver), EAlreadyApproved);
    self.approvals.push_back(approver);
    event::emit(CollectionApproved<T> {
        id: object::uid_to_inner(&self.id),
        approver,
        approval_count: self.approvals.length(),
        threshold: self.threshold,
    });
}

public fun release<T>(
    self: ApprovalCollection<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let caller = tx_context::sender(ctx);
    assert!(clock.timestamp_ms() <= self.deadline, EReleaseAfterDeadline);
    assert!(contains_address(&self.approvers, caller), EUnauthorizedRelease);
    assert!(self.approvals.length() >= self.threshold, EThresholdNotMet);

    let ApprovalCollection<T> {
        id,
        creator,
        beneficiary,
        approvers: _,
        approvals,
        threshold,
        amount,
        intent_commitment,
        deadline: _,
        balance,
    } = self;
    let collection_id = object::uid_to_inner(&id);
    let approval_count = approvals.length();
    id.delete();
    transfer::public_transfer(coin::from_balance(balance, ctx), beneficiary);
    event::emit(CollectionReleased<T> {
        id: collection_id,
        creator,
        beneficiary,
        amount,
        approval_count,
        threshold,
        intent_commitment,
    });
}

public fun refund<T>(
    self: ApprovalCollection<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(tx_context::sender(ctx) == self.creator, EUnauthorizedRefund);
    assert!(clock.timestamp_ms() > self.deadline, ERefundBeforeDeadline);
    let ApprovalCollection<T> {
        id,
        creator,
        beneficiary: _,
        approvers: _,
        approvals: _,
        threshold: _,
        amount,
        intent_commitment,
        deadline: _,
        balance,
    } = self;
    let collection_id = object::uid_to_inner(&id);
    id.delete();
    transfer::public_transfer(coin::from_balance(balance, ctx), creator);
    event::emit(CollectionRefunded<T> {
        id: collection_id,
        creator,
        amount,
        intent_commitment,
    });
}
