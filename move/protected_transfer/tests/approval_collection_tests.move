#[test_only]
module protected_transfer::approval_collection_tests;

use sui::clock;
use sui::coin;
use sui::test_scenario;
use protected_transfer::approval_collection::{Self, ApprovalCollection};

const COMMITMENT: vector<u8> = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const CREATOR: address = @0xA11CE;
const BENEFICIARY: address = @0xB0B;
const APPROVER_ONE: address = @0xCAFE;
const APPROVER_TWO: address = @0xD00D;

const E_TEST_SENTINEL_ABORT: u64 = 0xFFFFFFFFFFFFFFFF;

public struct TEST_COIN has drop {}

#[test]
fun threshold_approval_releases_exact_balance() {
    let mut scenario = test_scenario::begin(CREATOR);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(1_000, scenario.ctx());
    approval_collection::create<TEST_COIN>(
        coin,
        BENEFICIARY,
        vector[APPROVER_ONE, APPROVER_TWO],
        2,
        COMMITMENT,
        10_000,
        &clock,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(APPROVER_ONE);
    let clock = scenario.take_shared<clock::Clock>();
    let mut collection = scenario.take_shared<ApprovalCollection<TEST_COIN>>();
    approval_collection::approve(&mut collection, &clock, scenario.ctx());
    test_scenario::return_shared(collection);
    test_scenario::return_shared(clock);

    scenario.next_tx(APPROVER_TWO);
    let clock = scenario.take_shared<clock::Clock>();
    let mut collection = scenario.take_shared<ApprovalCollection<TEST_COIN>>();
    approval_collection::approve(&mut collection, &clock, scenario.ctx());
    approval_collection::release(collection, &clock, scenario.ctx());
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let coin = scenario.take_from_address<coin::Coin<TEST_COIN>>(BENEFICIARY);
    assert!(coin.value() == 1_000, 1);
    coin::burn_for_testing(coin);
    scenario.end();
}

#[test, expected_failure(abort_code = ::protected_transfer::approval_collection::EThresholdNotMet)]
fun release_before_threshold_rejects() {
    let mut scenario = test_scenario::begin(CREATOR);
    scenario.create_system_objects();
    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(1_000, scenario.ctx());
    approval_collection::create<TEST_COIN>(
        coin,
        BENEFICIARY,
        vector[APPROVER_ONE, APPROVER_TWO],
        2,
        COMMITMENT,
        10_000,
        &clock,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(APPROVER_ONE);
    let clock = scenario.take_shared<clock::Clock>();
    let mut collection = scenario.take_shared<ApprovalCollection<TEST_COIN>>();
    approval_collection::approve(&mut collection, &clock, scenario.ctx());
    approval_collection::release(collection, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

#[test, expected_failure(abort_code = ::protected_transfer::approval_collection::EAlreadyApproved)]
fun duplicate_approval_rejects() {
    let mut scenario = test_scenario::begin(CREATOR);
    scenario.create_system_objects();
    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(1_000, scenario.ctx());
    approval_collection::create<TEST_COIN>(
        coin,
        BENEFICIARY,
        vector[APPROVER_ONE, APPROVER_TWO],
        2,
        COMMITMENT,
        10_000,
        &clock,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(APPROVER_ONE);
    let clock = scenario.take_shared<clock::Clock>();
    let mut collection = scenario.take_shared<ApprovalCollection<TEST_COIN>>();
    approval_collection::approve(&mut collection, &clock, scenario.ctx());
    approval_collection::approve(&mut collection, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}
