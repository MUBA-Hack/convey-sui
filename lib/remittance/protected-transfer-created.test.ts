import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import { describe, expect, it } from "vitest";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  evaluateProtectedTransferCreated,
  type ProtectedTransferCreatedExpectation,
} from "./protected-transfer-created";

const PACKAGE = "0x" + "44".repeat(32);
const PAYER = "0x" + "11".repeat(32);
const BENEFICIARY = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const COMMITMENT = "0x" + "ab".repeat(32);

const Created = suiBcs.struct("Created", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});

function expectation(
  overrides: Partial<ProtectedTransferCreatedExpectation> = {},
): ProtectedTransferCreatedExpectation {
  return {
    digest: DIGEST,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    amountMicro: "109000000",
    deadlineMs: 1_700_086_400_000,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  };
}

function event(
  overrides: Partial<{
    packageId: string;
    module: string;
    sender: string;
    eventType: string;
    id: string;
    payer: string;
    beneficiary: string;
    reviewer: string;
    amount: string;
    deadline: string;
    commitment: number[];
  }> = {},
): SuiClientTypes.Event {
  const value = {
    id: overrides.id ?? ESCROW,
    payer: overrides.payer ?? PAYER,
    beneficiary: overrides.beneficiary ?? BENEFICIARY,
    reviewer: overrides.reviewer ?? REVIEWER,
    amount: overrides.amount ?? "109000000",
    deadline: overrides.deadline ?? "1700086400000",
    evidence_commitment: overrides.commitment ?? Array(32).fill(0xab),
  };
  return {
    packageId: overrides.packageId ?? PACKAGE,
    module: overrides.module ?? "protected_transfer",
    sender: overrides.sender ?? PAYER,
    eventType:
      overrides.eventType ??
      `${PACKAGE}::protected_transfer::Created<${USDC_COIN_TYPE_TESTNET}>`,
    bcs: Created.serialize(value).toBytes(),
    json: { ignored: "BCS is authoritative" },
  };
}

function result(events: SuiClientTypes.Event[]): SuiClientTypes.TransactionResult<{ events: true }> {
  return {
    $kind: "Transaction",
    Transaction: {
      digest: DIGEST,
      signatures: [],
      epoch: null,
      status: { success: true, error: null },
      events,
      balanceChanges: undefined,
      effects: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };
}

describe("evaluateProtectedTransferCreated", () => {
  it("verifies one exact BCS Created event against every expected field", () => {
    expect(
      evaluateProtectedTransferCreated({
        expectation: expectation(),
        packageId: PACKAGE,
        reviewerAddress: REVIEWER,
        result: result([event()]),
      }),
    ).toEqual({
      kind: "verified",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      amountMicro: "109000000",
      deadlineMs: 1_700_086_400_000,
      evidenceCommitmentHex: COMMITMENT,
    });
  });

  it.each([
    ["payer", event({ payer: BENEFICIARY })],
    ["payer", event({ sender: BENEFICIARY })],
    ["beneficiary", event({ beneficiary: PAYER })],
    ["reviewer", event({ reviewer: BENEFICIARY })],
    ["amount", event({ amount: "108999999" })],
    ["deadline", event({ deadline: "1700086400001" })],
    ["commitment", event({ commitment: Array(32).fill(0xac) })],
    ["event_type", event({ eventType: `${PACKAGE}::protected_transfer::Created<0x2::sui::SUI>` })],
    ["event_type", event({ packageId: "0x" + "66".repeat(32) })],
    ["event_type", event({ module: "lookalike" })],
  ] as const)("rejects an exact %s mismatch", (reason, badEvent) => {
    expect(
      evaluateProtectedTransferCreated({
        expectation: expectation(),
        packageId: PACKAGE,
        reviewerAddress: REVIEWER,
        result: result([badEvent]),
      }),
    ).toEqual({ kind: "rejected", reason });
  });

  it("rejects missing and ambiguous Created events", () => {
    const input = {
      expectation: expectation(),
      packageId: PACKAGE,
      reviewerAddress: REVIEWER,
    };
    expect(evaluateProtectedTransferCreated({ ...input, result: result([]) })).toEqual({
      kind: "rejected",
      reason: "event_missing",
    });
    expect(
      evaluateProtectedTransferCreated({ ...input, result: result([event(), event()]) }),
    ).toEqual({ kind: "rejected", reason: "event_ambiguous" });
  });

  it("rejects malformed BCS and never trusts matching JSON", () => {
    const malformed = event();
    malformed.bcs = new Uint8Array([1, 2, 3]);
    malformed.json = {
      id: ESCROW,
      payer: PAYER,
      beneficiary: BENEFICIARY,
      reviewer: REVIEWER,
      amount: "109000000",
      deadline: "1700086400000",
      evidence_commitment: Array(32).fill(0xab),
    };
    expect(
      evaluateProtectedTransferCreated({
        expectation: expectation(),
        packageId: PACKAGE,
        reviewerAddress: REVIEWER,
        result: result([malformed]),
      }),
    ).toEqual({ kind: "rejected", reason: "event_fields" });
  });
});
