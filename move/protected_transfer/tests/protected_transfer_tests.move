#[test_only]
module protected_transfer::protected_transfer_tests;

use sui::clock;
use sui::coin;
use sui::event;
use sui::test_scenario;
use protected_transfer::protected_transfer::{Self, ProtectedTransfer, Created, Released, Refunded};

const COMMITMENT_32: vector<u8> = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const COMMITMENT_31: vector<u8> = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

const PAYER: address = @0xA11CE;
const BENEFICIARY: address = @0xB0B;
const REVIEWER: address = @0xCAFE;
const ATTACKER: address = @0xBADE;

/// Test-only sentinel abort code that can never collide with any production
/// abort code (production codes are 0..=9). Every expected-failure test ends
/// with `abort E_TEST_SENTINEL_ABORT` instead of `abort 0`: if a production
/// guard is accidentally removed, the production call succeeds and the sentinel
/// fires with a code that does not match the `expected_failure` declaration,
/// correctly failing the test. With `abort 0` the zero-funding test was masked
/// because `EZeroFunding == 0`.
const E_TEST_SENTINEL_ABORT: u64 = 0xFFFFFFFFFFFFFFFF;

public struct TEST_COIN has drop {}

// === 1. create_escrow shares the escrow object ===

#[test]
fun test_create_shares_object() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(500, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    // The escrow realises into the shared inventory only after the tx ends.
    scenario.next_tx(PAYER);
    assert!(test_scenario::has_most_recent_shared<ProtectedTransfer<TEST_COIN>>(), 100);

    scenario.end();
}

// === 2. reviewer release delivers the full coin to the beneficiary, not the reviewer ===

#[test]
fun test_release_delivers_to_beneficiary_not_reviewer() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(700, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    // Reviewer is the only authorised caller; the coin must leave their tx
    // directly to the beneficiary.
    scenario.next_tx(REVIEWER);
    let clock = scenario.take_shared<clock::Clock>();
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::release_funds<TEST_COIN>(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    // Beneficiary inventory holds the exact-value coin; reviewer inventory does not.
    scenario.next_tx(BENEFICIARY);
    assert!(test_scenario::has_most_recent_for_address<coin::Coin<TEST_COIN>>(BENEFICIARY), 200);
    assert!(!test_scenario::has_most_recent_for_address<coin::Coin<TEST_COIN>>(REVIEWER), 201);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(BENEFICIARY);
    assert!(coin.value() == 700, 202);
    coin::burn_for_testing(coin);

    // Terminal object is gone: a second terminal action cannot be taken.
    assert!(!test_scenario::has_most_recent_shared<ProtectedTransfer<TEST_COIN>>(), 203);

    scenario.end();
}

// === 2b. reviewer release at exactly the deadline succeeds (boundary) ===

#[test]
fun test_release_at_deadline_delivers_to_beneficiary() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(300, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(REVIEWER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_000);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::release_funds<TEST_COIN>(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(BENEFICIARY);
    assert!(coin.value() == 300, 210);
    coin::burn_for_testing(coin);
    assert!(!test_scenario::has_most_recent_shared<ProtectedTransfer<TEST_COIN>>(), 211);

    scenario.end();
}

// === 3. payer refund after deadline delivers the full coin to the payer, not another account ===

#[test]
fun test_refund_after_deadline_delivers_to_payer() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(900, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    // Advance time past the deadline, then payer refunds in the same tx.
    scenario.next_tx(PAYER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_001);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::refund_payer<TEST_COIN>(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    // Payer inventory holds the exact-value coin; a different account does not.
    scenario.next_tx(PAYER);
    assert!(test_scenario::has_most_recent_for_address<coin::Coin<TEST_COIN>>(PAYER), 300);
    assert!(!test_scenario::has_most_recent_for_address<coin::Coin<TEST_COIN>>(ATTACKER), 301);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(PAYER);
    assert!(coin.value() == 900, 302);
    coin::burn_for_testing(coin);

    // Terminal object is gone: a second terminal action cannot be taken.
    assert!(!test_scenario::has_most_recent_shared<ProtectedTransfer<TEST_COIN>>(), 303);

    scenario.end();
}

// === 4. zero-value funding rejects via the public create path ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EZeroFunding)]
fun test_zero_funding_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(0, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 5. deadline not strictly in the future rejects via the public create path ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EDeadlineNotInFuture)]
fun test_deadline_not_in_future_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    // deadline == current timestamp (0): not strictly in the future
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 0, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 6. evidence commitment not exactly 32 bytes rejects via the public create path ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EInvalidEvidenceCommitment)]
fun test_invalid_evidence_commitment_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_31, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 7. unauthorized release rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EUnauthorizedRelease)]
fun test_unauthorized_release_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    // Attacker is not the reviewer.
    scenario.next_tx(ATTACKER);
    let clock = scenario.take_shared<clock::Clock>();
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::release_funds<TEST_COIN>(escrow, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

// === 8. release after deadline rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EReleaseAfterDeadline)]
fun test_release_after_deadline_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(REVIEWER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_001);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::release_funds<TEST_COIN>(escrow, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

// === 9. unauthorized refund rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EUnauthorizedRefund)]
fun test_unauthorized_refund_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    // Attacker is not the payer, even after the deadline has passed.
    scenario.next_tx(ATTACKER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_001);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::refund_payer<TEST_COIN>(escrow, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

// === 10. refund at or before deadline rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::ERefundBeforeDeadline)]
fun test_refund_at_deadline_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(PAYER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_000);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::refund_payer<TEST_COIN>(escrow, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::ERefundBeforeDeadline)]
fun test_refund_before_deadline_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(PAYER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 1_500);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::refund_payer<TEST_COIN>(escrow, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

// === 11. deterministic Created<T> event regression ===
//
// Exercises the production public `create_escrow` function and asserts every
// field of the emitted `Created<TEST_COIN>` event: payer, beneficiary,
// reviewer, amount, deadline, and the 32-byte evidence commitment. The event
// id is captured from the event and cross-checked against the actual shared
// escrow object's id in the next transaction. The generic `T = TEST_COIN` is
// part of the event type under test via `events_by_type<Created<TEST_COIN>>`.

#[test]
fun test_created_event_payload() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(500, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    // Assert the Created event payload in the same tx that emitted it.
    let events = event::events_by_type<Created<TEST_COIN>>();
    assert!(events.length() == 1, 400);
    let created_event = events[0];
    let (event_id, payer, beneficiary, reviewer, amount, deadline, evidence_commitment) =
        protected_transfer::created_fields(&created_event);
    assert!(payer == PAYER, 402);
    assert!(beneficiary == BENEFICIARY, 403);
    assert!(reviewer == REVIEWER, 404);
    assert!(amount == 500, 405);
    assert!(deadline == 2_000, 406);
    assert!(evidence_commitment == COMMITMENT_32, 407);
    let expected_id = event_id;

    // The event's id must match the actual shared escrow's id.
    scenario.next_tx(PAYER);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    assert!(escrow.escrow_id() == expected_id, 408);
    test_scenario::return_shared(escrow);

    // Cleanup: refund after deadline and burn the returned coin.
    scenario.next_tx(PAYER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_001);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    protected_transfer::refund_payer<TEST_COIN>(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    scenario.next_tx(PAYER);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(PAYER);
    coin::burn_for_testing(coin);

    scenario.end();
}

// === 12. deterministic Released<T> event regression ===
//
// Exercises the production public `release_funds` function and asserts every
// field of the emitted `Released<TEST_COIN>` event. The escrow id is read from
// the shared object before the terminal call and compared to the event's id
// field. The generic `T = TEST_COIN` is part of the event type under test.

#[test]
fun test_released_event_payload() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(700, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(REVIEWER);
    let clock = scenario.take_shared<clock::Clock>();
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    let escrow_id = escrow.escrow_id();
    protected_transfer::release_funds<TEST_COIN>(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    // Assert the Released event payload in the same tx that emitted it.
    let events = event::events_by_type<Released<TEST_COIN>>();
    assert!(events.length() == 1, 410);
    let released_event = events[0];
    let (event_id, payer, beneficiary, reviewer, amount, deadline, evidence_commitment) =
        protected_transfer::released_fields(&released_event);
    assert!(event_id == escrow_id, 411);
    assert!(payer == PAYER, 412);
    assert!(beneficiary == BENEFICIARY, 413);
    assert!(reviewer == REVIEWER, 414);
    assert!(amount == 700, 415);
    assert!(deadline == 2_000, 416);
    assert!(evidence_commitment == COMMITMENT_32, 417);

    // Cleanup: burn the coin delivered to the beneficiary.
    scenario.next_tx(BENEFICIARY);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(BENEFICIARY);
    assert!(coin.value() == 700, 418);
    coin::burn_for_testing(coin);

    scenario.end();
}

// === 13. deterministic Refunded<T> event regression ===
//
// Exercises the production public `refund_payer` function and asserts every
// field of the emitted `Refunded<TEST_COIN>` event. The escrow id is read from
// the shared object before the terminal call and compared to the event's id
// field. The generic `T = TEST_COIN` is part of the event type under test.

#[test]
fun test_refunded_event_payload() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(900, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(PAYER);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_001);
    let escrow = scenario.take_shared<ProtectedTransfer<TEST_COIN>>();
    let escrow_id = escrow.escrow_id();
    protected_transfer::refund_payer<TEST_COIN>(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    // Assert the Refunded event payload in the same tx that emitted it.
    let events = event::events_by_type<Refunded<TEST_COIN>>();
    assert!(events.length() == 1, 420);
    let refunded_event = events[0];
    let (event_id, payer, beneficiary, reviewer, amount, deadline, evidence_commitment) =
        protected_transfer::refunded_fields(&refunded_event);
    assert!(event_id == escrow_id, 421);
    assert!(payer == PAYER, 422);
    assert!(beneficiary == BENEFICIARY, 423);
    assert!(reviewer == REVIEWER, 424);
    assert!(amount == 900, 425);
    assert!(deadline == 2_000, 426);
    assert!(evidence_commitment == COMMITMENT_32, 427);

    // Cleanup: burn the coin returned to the payer.
    scenario.next_tx(PAYER);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(PAYER);
    assert!(coin.value() == 900, 428);
    coin::burn_for_testing(coin);

    scenario.end();
}

// === 14. zero beneficiary rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EZeroBeneficiary)]
fun test_zero_beneficiary_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, @0x0, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 15. zero reviewer rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::EZeroReviewer)]
fun test_zero_reviewer_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, @0x0, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 16. payer == beneficiary rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::ECollidingRoles)]
fun test_payer_equals_beneficiary_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, PAYER, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 17. payer == reviewer rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::ECollidingRoles)]
fun test_payer_equals_reviewer_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, BENEFICIARY, PAYER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}

// === 18. beneficiary == reviewer rejects with the named code ===

#[test, expected_failure(abort_code = ::protected_transfer::protected_transfer::ECollidingRoles)]
fun test_beneficiary_equals_reviewer_rejects() {
    let mut scenario = test_scenario::begin(PAYER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(100, scenario.ctx());
    protected_transfer::create_escrow<TEST_COIN>(
        coin, REVIEWER, REVIEWER, COMMITMENT_32, 2_000, &clock, scenario.ctx(),
    );
    abort E_TEST_SENTINEL_ABORT
}
