#[test_only]
module protected_transfer::recurring_cap_tests;

use sui::clock;
use sui::coin;
use sui::test_scenario;
use protected_transfer::recurring_cap::{Self, RecurringCap};

const COMMITMENT: vector<u8> = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const OWNER: address = @0xA11CE;
const BENEFICIARY: address = @0xB0B;

const E_TEST_SENTINEL_ABORT: u64 = 0xFFFFFFFFFFFFFFFF;

public struct TEST_COIN has drop {}

#[test]
fun beneficiary_collects_with_per_payment_and_total_caps() {
    let mut scenario = test_scenario::begin(OWNER);
    scenario.create_system_objects();

    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(900, scenario.ctx());
    recurring_cap::create<TEST_COIN>(
        coin,
        BENEFICIARY,
        300,
        600,
        1_000,
        10_000,
        COMMITMENT,
        &clock,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 1_000);
    let mut mandate = scenario.take_shared<RecurringCap<TEST_COIN>>();
    recurring_cap::collect(&mut mandate, 300, &clock, scenario.ctx());
    test_scenario::return_shared(mandate);
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let mut clock = scenario.take_shared<clock::Clock>();
    clock::set_for_testing(&mut clock, 2_000);
    let mut mandate = scenario.take_shared<RecurringCap<TEST_COIN>>();
    recurring_cap::collect(&mut mandate, 300, &clock, scenario.ctx());
    test_scenario::return_shared(mandate);
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let first = scenario.take_from_address<coin::Coin<TEST_COIN>>(BENEFICIARY);
    let second = scenario.take_from_address<coin::Coin<TEST_COIN>>(BENEFICIARY);
    assert!(first.value() + second.value() == 600, 1);
    coin::burn_for_testing(first);
    coin::burn_for_testing(second);

    scenario.next_tx(OWNER);
    let mandate = scenario.take_shared<RecurringCap<TEST_COIN>>();
    recurring_cap::revoke(mandate, scenario.ctx());

    scenario.next_tx(OWNER);
    let refund = scenario.take_from_address<coin::Coin<TEST_COIN>>(OWNER);
    assert!(refund.value() == 300, 2);
    coin::burn_for_testing(refund);
    scenario.end();
}

#[test, expected_failure(abort_code = ::protected_transfer::recurring_cap::EPerPaymentCapExceeded)]
fun per_payment_cap_is_enforced() {
    let mut scenario = test_scenario::begin(OWNER);
    scenario.create_system_objects();
    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(900, scenario.ctx());
    recurring_cap::create<TEST_COIN>(
        coin, BENEFICIARY, 300, 600, 1_000, 10_000, COMMITMENT, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let clock = scenario.take_shared<clock::Clock>();
    let mut mandate = scenario.take_shared<RecurringCap<TEST_COIN>>();
    recurring_cap::collect(&mut mandate, 301, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

#[test, expected_failure(abort_code = ::protected_transfer::recurring_cap::ETooSoon)]
fun minimum_interval_is_enforced() {
    let mut scenario = test_scenario::begin(OWNER);
    scenario.create_system_objects();
    let clock = scenario.take_shared<clock::Clock>();
    let coin = coin::mint_for_testing<TEST_COIN>(900, scenario.ctx());
    recurring_cap::create<TEST_COIN>(
        coin, BENEFICIARY, 300, 600, 1_000, 10_000, COMMITMENT, &clock, scenario.ctx(),
    );
    test_scenario::return_shared(clock);

    scenario.next_tx(BENEFICIARY);
    let clock = scenario.take_shared<clock::Clock>();
    let mut mandate = scenario.take_shared<RecurringCap<TEST_COIN>>();
    recurring_cap::collect(&mut mandate, 100, &clock, scenario.ctx());
    recurring_cap::collect(&mut mandate, 100, &clock, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}
