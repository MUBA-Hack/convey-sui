import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import { describe, expect, it } from "vitest";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  evaluateProtectedTransferOpen,
  type ProtectedTransferOpenRequest,
} from "./protected-transfer-open";

const PACKAGE = "0x" + "44".repeat(32);
const PAYER = "0x" + "11".repeat(32);
const BENEFICIARY = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const COMMITMENT = "0x" + "ab".repeat(32);
const DEADLINE = 1_700_086_400_000;
const AMOUNT = "109000000";

const UidBcs = suiBcs.struct("UID", { id: suiBcs.Address });
const BalanceBcs = suiBcs.struct("Balance", { value: suiBcs.u64() });
const ProtectedTransferBcs = suiBcs.struct("ProtectedTransfer", {
  id: UidBcs,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
  deadline: suiBcs.u64(),
  balance: BalanceBcs,
});

function expectation(overrides: Partial<ProtectedTransferOpenRequest> = {}): ProtectedTransferOpenRequest {
  return {
    escrowObjectId: ESCROW,
    packageId: PACKAGE,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    amountMicro: AMOUNT,
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  };
}

function object(overrides: Partial<{
  type: string;
  ownerKind: string;
  content: Uint8Array;
}> = {}): SuiClientTypes.Object<{ content: true }> {
  const value = {
    id: { id: ESCROW },
    payer: PAYER,
    beneficiary: BENEFICIARY,
    reviewer: REVIEWER,
    amount: AMOUNT,
    evidence_commitment: Array(32).fill(0xab),
    deadline: DEADLINE.toString(),
    balance: { value: AMOUNT },
  };
  return {
    objectId: ESCROW,
    version: "1",
    digest: "0x" + "0".repeat(32),
    owner: { $kind: overrides.ownerKind ?? "Shared", Shared: { initialSharedVersion: "1" } } as never,
    type: overrides.type ?? `${PACKAGE}::protected_transfer::ProtectedTransfer<${USDC_COIN_TYPE_TESTNET}>`,
    content: (overrides.content ?? ProtectedTransferBcs.serialize(value).toBytes()) as Uint8Array<ArrayBuffer>,
    previousTransaction: undefined,
    objectBcs: undefined,
    json: undefined,
    display: undefined,
  };
}

describe("evaluateProtectedTransferOpen", () => {
  it("returns open when exact shared object/type/fields/balance match", () => {
    expect(
      evaluateProtectedTransferOpen({
        expectation: expectation(),
        packageId: PACKAGE,
        object: object(),
      }),
    ).toEqual({
      kind: "open",
      escrowObjectId: ESCROW,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
      heldBalanceMicro: AMOUNT,
    });
  });

  it.each([
    ["type (wrong struct)", object({ type: `${PACKAGE}::other::ProtectedTransfer<${USDC_COIN_TYPE_TESTNET}>` })],
    ["type (wrong package)", object({ type: `${"0x" + "99".repeat(32)}::protected_transfer::ProtectedTransfer<${USDC_COIN_TYPE_TESTNET}>` })],
    ["owner (not shared)", object({ ownerKind: "Immutable" })],
  ] as const)("rejects %s", (_label, badObject) => {
    expect(
      evaluateProtectedTransferOpen({
        expectation: expectation(),
        packageId: PACKAGE,
        object: badObject,
      }),
    ).toEqual({ kind: "rejected", reason: "type" });
  });

  it.each([
    ["payer", { payer: BENEFICIARY }],
    ["beneficiary", { beneficiary: PAYER }],
    ["reviewer", { reviewer: BENEFICIARY }],
    ["amount", { amount: "108999999" }],
    ["deadline", { deadline: (DEADLINE + 1).toString() }],
    ["commitment", { evidence_commitment: Array(32).fill(0xac) }],
    ["balance", { balance: { value: "108999999" } }],
  ] as const)("rejects an exact %s field mismatch", (reason, overrides) => {
    const value = {
      id: { id: ESCROW },
      payer: PAYER,
      beneficiary: BENEFICIARY,
      reviewer: REVIEWER,
      amount: AMOUNT,
      evidence_commitment: Array(32).fill(0xab),
      deadline: DEADLINE.toString(),
      balance: { value: AMOUNT },
      ...overrides,
    };
    expect(
      evaluateProtectedTransferOpen({
        expectation: expectation(),
        packageId: PACKAGE,
        object: object({ content: ProtectedTransferBcs.serialize(value).toBytes() }),
      }),
    ).toEqual({ kind: "rejected", reason });
  });

  it("rejects malformed content BCS", () => {
    expect(
      evaluateProtectedTransferOpen({
        expectation: expectation(),
        packageId: PACKAGE,
        object: object({ content: new Uint8Array([1, 2, 3]) }),
      }),
    ).toEqual({ kind: "rejected", reason: "type" });
  });

  it("rejects when the trusted packageId does not match the expectation", () => {
    expect(
      evaluateProtectedTransferOpen({
        expectation: expectation({ packageId: "0x" + "99".repeat(32) }),
        packageId: PACKAGE,
        object: object(),
      }),
    ).toEqual({ kind: "rejected", reason: "package" });
  });

  it("verifies when the trusted packageId equals the expectation packageId", () => {
    expect(
      evaluateProtectedTransferOpen({
        expectation: expectation(),
        packageId: PACKAGE,
        object: object(),
      }),
    ).toEqual({
      kind: "open",
      escrowObjectId: ESCROW,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
      heldBalanceMicro: AMOUNT,
    });
  });
});
