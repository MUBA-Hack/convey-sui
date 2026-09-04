module protected_transfer::evidence_access;

use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const EInvalidSealId: u64 = 0;
const EInvalidBlobId: u64 = 1;
const EInvalidReaders: u64 = 2;
const EDuplicateReader: u64 = 3;
const ENoAccess: u64 = 4;
const EWrongSealId: u64 = 5;

const MAX_READERS: u64 = 10;
const MAX_BLOB_ID_BYTES: u64 = 128;

/// Persistent access policy for one Seal ciphertext stored on Walrus. The
/// policy survives payment settlement, so an authorised reviewer can still
/// inspect the evidence behind a historical receipt.
public struct EvidenceAccess has key {
    id: UID,
    creator: address,
    seal_id: vector<u8>,
    walrus_blob_id: vector<u8>,
    readers: vector<address>,
}

public struct EvidenceAccessCreated has copy, drop {
    id: ID,
    creator: address,
    seal_id: vector<u8>,
    walrus_blob_id: vector<u8>,
    readers: vector<address>,
}

fun contains_address(values: &vector<address>, candidate: address): bool {
    let mut index = 0;
    while (index < values.length()) {
        if (values[index] == candidate) return true;
        index = index + 1;
    };
    false
}

fun assert_valid_readers(readers: &vector<address>) {
    let count = readers.length();
    assert!(count > 0 && count <= MAX_READERS, EInvalidReaders);
    let mut outer = 0;
    while (outer < count) {
        let current = readers[outer];
        assert!(current != @0x0, EInvalidReaders);
        let mut inner = outer + 1;
        while (inner < count) {
            assert!(current != readers[inner], EDuplicateReader);
            inner = inner + 1;
        };
        outer = outer + 1;
    };
}

public fun access_id(self: &EvidenceAccess): ID {
    object::uid_to_inner(&self.id)
}

public fun seal_id(self: &EvidenceAccess): &vector<u8> {
    &self.seal_id
}

public fun walrus_blob_id(self: &EvidenceAccess): &vector<u8> {
    &self.walrus_blob_id
}

public fun can_read(self: &EvidenceAccess, reader: address): bool {
    reader == self.creator || contains_address(&self.readers, reader)
}

/// Creates a public policy object. Only encrypted bytes go to Walrus; this
/// object contains the ciphertext identifier and its authorised readers.
public fun create(
    seal_id: vector<u8>,
    walrus_blob_id: vector<u8>,
    readers: vector<address>,
    ctx: &mut TxContext,
) {
    assert!(seal_id.length() == 32, EInvalidSealId);
    assert!(walrus_blob_id.length() > 0 && walrus_blob_id.length() <= MAX_BLOB_ID_BYTES, EInvalidBlobId);
    assert_valid_readers(&readers);
    let creator = tx_context::sender(ctx);
    let access = EvidenceAccess {
        id: object::new(ctx),
        creator,
        seal_id,
        walrus_blob_id,
        readers,
    };
    event::emit(EvidenceAccessCreated {
        id: object::uid_to_inner(&access.id),
        creator,
        seal_id: access.seal_id,
        walrus_blob_id: access.walrus_blob_id,
        readers: access.readers,
    });
    transfer::share_object(access);
}

/// Seal key servers dry-run this entry function. A key is issued only when the
/// transaction sender is the creator or an immutable reader and the requested
/// identity exactly matches this evidence object.
public entry fun seal_approve(id: vector<u8>, access: &EvidenceAccess, ctx: &TxContext) {
    assert!(id == access.seal_id, EWrongSealId);
    assert!(access.can_read(tx_context::sender(ctx)), ENoAccess);
}
