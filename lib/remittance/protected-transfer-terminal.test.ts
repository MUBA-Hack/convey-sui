import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import { describe, expect, it } from "vitest";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  buildProtectedTransferTerminal,
  evaluateProtectedTransferTerminal,
  PROTECTED_TRANSFER_RELEASE_FUNCTION,
  PROTECTED_TRANSFER_REFUND_FUNCTION,
  PROTECTED_TRANSFER_TERMINAL_MODULE,
  type ProtectedTransferTerminalSource,
  type ProtectedTransferTerminalVerifyRequest,
} from "./protected-transfer-terminal";

const PACKAGE = "0x" + "44".repeat(32);
const PAYER = "0x" + "11".repeat(32);
const BENEFICIARY = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const COMMITMENT = "0x" + "ab".repeat(32);
const DEADLINE = 1_700_086_400_000;
const AMOUNT = "109000000";

const TerminalEvent = suiBcs.struct("TerminalEvent", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});

function source(overrides: Partial<ProtectedTransferTerminalSource> = {}): ProtectedTransferTerminalSource {
  return {
    action: "release",
    packageId: PACKAGE,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: AMOUNT,
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  };
}

function expectation(overrides: Partial<ProtectedTransferTerminalVerifyRequest> = {}): ProtectedTransferTerminalVerifyRequest {
  return {
    action: "release",
    digest: DIGEST,
    packageId: PACKAGE,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: AMOUNT,
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  } as ProtectedTransferTerminalVerifyRequest;
}

function event(overrides: Partial<{
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
}> = {}): SuiClientTypes.Event {
  const value = {
    id: overrides.id ?? ESCROW,
    payer: overrides.payer ?? PAYER,
    beneficiary: overrides.beneficiary ?? BENEFICIARY,
    reviewer: overrides.reviewer ?? REVIEWER,
    amount: overrides.amount ?? AMOUNT,
    deadline: overrides.deadline ?? DEADLINE.toString(),
    evidence_commitment: overrides.commitment ?? Array(32).fill(0xab),
  };
  return {
    packageId: overrides.packageId ?? PACKAGE,
    module: overrides.module ?? "protected_transfer",
    sender: overrides.sender ?? REVIEWER,
    eventType:
      overrides.eventType ??
      `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
    bcs: TerminalEvent.serialize(value).toBytes(),
    json: null,
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

describe("buildProtectedTransferTerminal", () => {
  it("builds one release MoveCall with escrow + Clock args and reviewer sender", () => {
    const { metadata, transaction } = buildProtectedTransferTerminal({
      source: source(),
      sender: REVIEWER,
      nowMs: DEADLINE,
    });
    expect(metadata.action).toBe("release");
    expect(metadata.function).toBe(PROTECTED_TRANSFER_RELEASE_FUNCTION);
    expect(metadata.module).toBe(PROTECTED_TRANSFER_TERMINAL_MODULE);
    expect(metadata.sender).toBe(REVIEWER);
    expect(metadata.target).toBe(`${PACKAGE}::protected_transfer::release_funds`);
    const data = transaction.getData() as {
      sender: string;
      commands: { $kind: string; MoveCall?: { arguments: { $kind: string; type?: string }[] } }[];
    };
    expect(data.sender).toBe(REVIEWER);
    const moveCall = data.commands.find((c) => c.$kind === "MoveCall");
    expect(moveCall?.MoveCall?.arguments.length).toBe(2);
  });

  it("builds one refund MoveCall with payer sender", () => {
    const { metadata } = buildProtectedTransferTerminal({
      source: source({ action: "refund" }),
      sender: PAYER,
      nowMs: DEADLINE + 1,
    });
    expect(metadata.action).toBe("refund");
    expect(metadata.function).toBe(PROTECTED_TRANSFER_REFUND_FUNCTION);
    expect(metadata.sender).toBe(PAYER);
  });

  it.each([
    ["release wrong sender", "release", BENEFICIARY, DEADLINE, /reviewer/i],
    ["release after deadline", "release", REVIEWER, DEADLINE + 1, /deadline/i],
    ["refund wrong sender", "refund", REVIEWER, DEADLINE + 1, /payer/i],
    ["refund at deadline", "refund", PAYER, DEADLINE, /deadline/i],
    ["refund before deadline", "refund", PAYER, DEADLINE - 1, /deadline/i],
  ] as const)(
    "preflight rejects %s",
    (_label, action, sender, nowMs, re) => {
      expect(() =>
        buildProtectedTransferTerminal({ source: source({ action }), sender, nowMs }),
      ).toThrow(re);
    },
  );

  it.each([
    ["zero payer", source({ payerAddress: "0x" + "0".repeat(64) })],
    ["zero beneficiary", source({ beneficiaryAddress: "0x" + "0".repeat(64) })],
    ["zero reviewer", source({ reviewerAddress: "0x" + "0".repeat(64) })],
    ["payer equals beneficiary", source({ beneficiaryAddress: PAYER })],
    ["payer equals reviewer", source({ reviewerAddress: PAYER })],
    ["beneficiary equals reviewer", source({ reviewerAddress: BENEFICIARY })],
    ["bad packageId", { ...source(), packageId: "nope" }],
    ["bad amount", { ...source(), amountMicro: "0" }],
    ["extra field", { ...source(), extra: "x" }],
  ])("rejects %s before PTB", (_label, badSource) => {
    expect(() =>
      buildProtectedTransferTerminal({ source: badSource as never, sender: REVIEWER, nowMs: DEADLINE }),
    ).toThrow();
  });
});

describe("evaluateProtectedTransferTerminal", () => {
  it("verifies one exact BCS Released event", () => {
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation(),
        packageId: PACKAGE,
        result: result([event()]),
      }),
    ).toEqual({
      kind: "verified",
      action: "release",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      actorAddress: REVIEWER,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
    });
  });

  it("verifies one exact BCS Refunded event with payer sender", () => {
    const refundEvent = event({
      sender: PAYER,
      eventType: `${PACKAGE}::protected_transfer::Refunded<${USDC_COIN_TYPE_TESTNET}>`,
    });
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation({ action: "refund" }),
        packageId: PACKAGE,
        result: result([refundEvent]),
      }),
    ).toEqual({
      kind: "verified",
      action: "refund",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      actorAddress: PAYER,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
    });
  });

  it.each([
    ["digest", event(), expectation({ digest: "X".repeat(44) })],
    ["sender", event({ sender: PAYER }), expectation()],
    ["escrow", event({ id: PAYER }), expectation()],
    ["payer", event({ payer: BENEFICIARY }), expectation()],
    ["beneficiary", event({ beneficiary: PAYER }), expectation()],
    ["reviewer", event({ reviewer: BENEFICIARY }), expectation()],
    ["amount", event({ amount: "108999999" }), expectation()],
    ["deadline", event({ deadline: (DEADLINE + 1).toString() }), expectation()],
    ["commitment", event({ commitment: Array(32).fill(0xac) }), expectation()],
    ["event_missing", event({ eventType: `${PACKAGE}::protected_transfer::Created<${USDC_COIN_TYPE_TESTNET}>` }), expectation()],
    ["event_missing", event({ packageId: "0x" + "66".repeat(32) }), expectation()],
    ["event_missing", event({ module: "lookalike" }), expectation()],
  ] as const)("rejects an exact %s mismatch", (reason, badEvent, exp) => {
    expect(
      evaluateProtectedTransferTerminal({
        expectation: exp,
        packageId: PACKAGE,
        result: result([badEvent]),
      }),
    ).toEqual({ kind: "rejected", reason });
  });

  it("rejects a refund actor mismatch (sender is reviewer not payer)", () => {
    const refundEvent = event({
      sender: REVIEWER,
      eventType: `${PACKAGE}::protected_transfer::Refunded<${USDC_COIN_TYPE_TESTNET}>`,
    });
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation({ action: "refund" }),
        packageId: PACKAGE,
        result: result([refundEvent]),
      }),
    ).toEqual({ kind: "rejected", reason: "sender" });
  });

  it("rejects missing and ambiguous terminal events", () => {
    const input = { expectation: expectation(), packageId: PACKAGE };
    expect(evaluateProtectedTransferTerminal({ ...input, result: result([]) })).toEqual({
      kind: "rejected",
      reason: "event_missing",
    });
    expect(
      evaluateProtectedTransferTerminal({ ...input, result: result([event(), event()]) }),
    ).toEqual({ kind: "rejected", reason: "event_ambiguous" });
  });

  it("ignores an unrelated same-name event from another package", () => {
    const other = event({
      packageId: "0x" + "99".repeat(32),
      eventType: `${"0x" + "99".repeat(32)}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
    });
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation(),
        packageId: PACKAGE,
        result: result([other]),
      }),
    ).toEqual({ kind: "rejected", reason: "event_missing" });
  });

  it("verifies one exact event when an unrelated event is also present", () => {
    const other = event({
      packageId: "0x" + "99".repeat(32),
      eventType: `${"0x" + "99".repeat(32)}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
    });
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation(),
        packageId: PACKAGE,
        result: result([other, event()]),
      }),
    ).toMatchObject({ kind: "verified", digest: DIGEST, escrowObjectId: ESCROW });
  });

  it("rejects malformed BCS", () => {
    const malformed = event();
    malformed.bcs = new Uint8Array([1, 2, 3]);
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation(),
        packageId: PACKAGE,
        result: result([malformed]),
      }),
    ).toEqual({ kind: "rejected", reason: "event_fields" });
  });

  it("rejects a failed transaction", () => {
    const failed: SuiClientTypes.TransactionResult<{ events: true }> = {
      $kind: "FailedTransaction",
      FailedTransaction: {
        digest: DIGEST,
        signatures: [],
        epoch: null,
        status: { success: false, error: { abortCode: "5" } } as never,
        events: [],
        balanceChanges: undefined,
        effects: undefined,
        objectTypes: undefined,
        transaction: undefined,
        bcs: undefined,
      },
    };
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation(),
        packageId: PACKAGE,
        result: failed,
      }),
    ).toEqual({ kind: "rejected", reason: "failed" });
  });

  it("rejects when the trusted packageId does not match the expectation", () => {
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation({ packageId: "0x" + "99".repeat(32) }),
        packageId: PACKAGE,
        result: result([event()]),
      }),
    ).toEqual({ kind: "rejected", reason: "package" });
  });

  it("verifies when the trusted packageId equals the expectation packageId", () => {
    expect(
      evaluateProtectedTransferTerminal({
        expectation: expectation(),
        packageId: PACKAGE,
        result: result([event()]),
      }),
    ).toEqual({
      kind: "verified",
      action: "release",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      actorAddress: REVIEWER,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
    });
  });
});
