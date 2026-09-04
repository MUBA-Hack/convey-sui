import { describe, expect, it } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { inspectSponsoredProtectedTransferKind } from "./sponsor-policy.server";

const PACKAGE = "0x" + "44".repeat(32);
const BENEFICIARY = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const COIN_TYPE = "0x2::sui::SUI";
const AMOUNT = "25000000";
const DEADLINE = 1_900_000_000_000;
const COMMITMENT = "0x" + "aa".repeat(32);
const SEAL_ID = "0x" + "55".repeat(32);
const WALRUS_BLOB_ID = "A_valid_testnet_blob_id_12345";

async function kindBytes(options: {
  amount?: string;
  target?: string;
  includeEvidence?: boolean;
  extraTransfer?: boolean;
  destroyZeroRemainder?: boolean;
} = {}): Promise<string> {
  const tx = new Transaction();
  const source = tx.objectRef({
    objectId: "0x" + "66".repeat(32),
    version: "1",
    digest: "11111111111111111111111111111111",
  });
  const [payment] = tx.splitCoins(source, [tx.pure.u64(options.amount ?? AMOUNT)]);
  if (options.destroyZeroRemainder) {
    tx.moveCall({
      target: "0x2::coin::destroy_zero",
      typeArguments: [COIN_TYPE],
      arguments: [source],
    });
  }
  tx.moveCall({
    target:
      options.target ?? `${PACKAGE}::protected_transfer::create_escrow`,
    typeArguments: [COIN_TYPE],
    arguments: [
      payment,
      tx.pure.address(BENEFICIARY),
      tx.pure.address(REVIEWER),
      tx.pure.vector("u8", new Uint8Array(32).fill(0xaa)),
      tx.pure.u64(DEADLINE),
      tx.object.clock(),
    ],
  });
  if (options.includeEvidence) {
    tx.moveCall({
      target: `${PACKAGE}::evidence_access::create`,
      arguments: [
        tx.pure.vector("u8", new Uint8Array(32).fill(0x55)),
        tx.pure.vector("u8", new TextEncoder().encode(WALRUS_BLOB_ID)),
        tx.pure.vector("address", [BENEFICIARY, REVIEWER]),
      ],
    });
  }
  if (options.extraTransfer) {
    tx.transferObjects([source], BENEFICIARY);
  }
  return toBase64(await tx.build({ onlyTransactionKind: true }));
}

function expectation(includeEvidence = false) {
  return {
    packageId: PACKAGE,
    coinType: COIN_TYPE,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    amountMicro: AMOUNT,
    deadlineMs: DEADLINE,
    commitmentHex: COMMITMENT,
    ...(includeEvidence
      ? { sealIdHex: SEAL_ID, walrusBlobId: WALRUS_BLOB_ID }
      : {}),
  };
}

describe("inspectSponsoredProtectedTransferKind", () => {
  it("accepts only the exact protected transfer command graph", async () => {
    const inspected = inspectSponsoredProtectedTransferKind(
      await kindBytes(),
      expectation(),
    );
    expect(inspected).toEqual({
      moveCallTargets: [`${PACKAGE}::protected_transfer::create_escrow`],
      inputObjectIds: ["0x" + "66".repeat(32), "0x" + "0".repeat(63) + "6"],
    });
  });

  it("accepts the exact paired Seal policy call", async () => {
    expect(
      inspectSponsoredProtectedTransferKind(
        await kindBytes({ includeEvidence: true }),
        expectation(true),
      ).moveCallTargets,
    ).toEqual([
      `${PACKAGE}::protected_transfer::create_escrow`,
      `${PACKAGE}::evidence_access::create`,
    ]);
  });

  it("accepts the SDK's exact destroy-zero cleanup for a fully consumed coin", async () => {
    expect(
      inspectSponsoredProtectedTransferKind(
        await kindBytes({ includeEvidence: true, destroyZeroRemainder: true }),
        expectation(true),
      ).moveCallTargets,
    ).toEqual([
      "0x" + "0".repeat(63) + "2::coin::destroy_zero",
      `${PACKAGE}::protected_transfer::create_escrow`,
      `${PACKAGE}::evidence_access::create`,
    ]);
  });

  it("rejects a changed target, amount, or unapproved command", async () => {
    const changedTarget = await kindBytes({
      target: `${PACKAGE}::protected_transfer::refund`,
    });
    const changedAmount = await kindBytes({ amount: "25000001" });
    const extraTransfer = await kindBytes({ extraTransfer: true });
    expect(() =>
      inspectSponsoredProtectedTransferKind(
        changedTarget,
        expectation(),
      ),
    ).toThrow(/command graph/i);
    expect(() =>
      inspectSponsoredProtectedTransferKind(
        changedAmount,
        expectation(),
      ),
    ).toThrow(/amount/i);
    expect(() =>
      inspectSponsoredProtectedTransferKind(
        extraTransfer,
        expectation(),
      ),
    ).toThrow(/command graph/i);
  });

  it("rejects evidence calls that are missing or not expected", async () => {
    const noEvidence = await kindBytes();
    const withEvidence = await kindBytes({ includeEvidence: true });
    expect(() =>
      inspectSponsoredProtectedTransferKind(noEvidence, expectation(true)),
    ).toThrow(/evidence/i);
    expect(() =>
      inspectSponsoredProtectedTransferKind(
        withEvidence,
        expectation(false),
      ),
    ).toThrow(/evidence/i);
  });
});
