#[test_only]
module protected_transfer::evidence_access_tests;

use sui::test_scenario;
use protected_transfer::evidence_access::{Self, EvidenceAccess};

const CREATOR: address = @0xA11CE;
const REVIEWER: address = @0xCAFE;
const OUTSIDER: address = @0xBADE;
const SEAL_ID: vector<u8> = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const BLOB_ID: vector<u8> = b"testnet-walrus-blob-id";
const E_TEST_SENTINEL_ABORT: u64 = 0xFFFFFFFFFFFFFFFF;

#[test]
fun creator_and_reader_can_request_seal_key() {
    let mut scenario = test_scenario::begin(CREATOR);
    evidence_access::create(SEAL_ID, BLOB_ID, vector[REVIEWER], scenario.ctx());

    scenario.next_tx(REVIEWER);
    let access = scenario.take_shared<EvidenceAccess>();
    evidence_access::seal_approve(SEAL_ID, &access, scenario.ctx());
    test_scenario::return_shared(access);

    scenario.next_tx(CREATOR);
    let access = scenario.take_shared<EvidenceAccess>();
    evidence_access::seal_approve(SEAL_ID, &access, scenario.ctx());
    test_scenario::return_shared(access);
    scenario.end();
}

#[test, expected_failure(abort_code = ::protected_transfer::evidence_access::ENoAccess)]
fun outsider_cannot_request_seal_key() {
    let mut scenario = test_scenario::begin(CREATOR);
    evidence_access::create(SEAL_ID, BLOB_ID, vector[REVIEWER], scenario.ctx());

    scenario.next_tx(OUTSIDER);
    let access = scenario.take_shared<EvidenceAccess>();
    evidence_access::seal_approve(SEAL_ID, &access, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}

#[test, expected_failure(abort_code = ::protected_transfer::evidence_access::EWrongSealId)]
fun wrong_seal_id_rejects() {
    let mut scenario = test_scenario::begin(CREATOR);
    evidence_access::create(SEAL_ID, BLOB_ID, vector[REVIEWER], scenario.ctx());

    scenario.next_tx(REVIEWER);
    let access = scenario.take_shared<EvidenceAccess>();
    evidence_access::seal_approve(b"wrong", &access, scenario.ctx());
    abort E_TEST_SENTINEL_ABORT
}
