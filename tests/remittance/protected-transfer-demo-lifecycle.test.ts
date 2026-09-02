import { describe, expect, it } from "vitest";
import {
  createProtectedTransferDemo,
  expireProtectedTransferDemo,
  refundProtectedTransferDemo,
  releaseProtectedTransferDemo,
  reviewProtectedTransferDemoEvidence,
} from "@/lib/remittance/protected-transfer-demo-lifecycle";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";

const PAYER = `0x${"1".repeat(64)}`;
const BENEFICIARY = `0x${"2".repeat(64)}`;
const REVIEWER = `0x${"3".repeat(64)}`;
const COMMITMENT = `0x${"a".repeat(64)}`;
const CREATED_AT = 1_800_000_000_000;
const DEADLINE = CREATED_AT + 86_400_000;

function createInput() {
  return {
    mode: "demo" as const,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "25000000",
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    createdAtMs: CREATED_AT,
    requestId: "create-001",
  } as const;
}

describe("protected transfer demo lifecycle", () => {
  it("creates, approves evidence, then releases to the beneficiary without claiming settlement", () => {
    const first = createProtectedTransferDemo(createInput());
    const duplicate = createProtectedTransferDemo(createInput());

    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({
      mode: "demo",
      status: "created",
      settlement: "not_submitted",
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
    });
    expect(first.demoId).toMatch(/^demo_pt_[0-9a-f]{24}$/);
    expect(first.events[0]?.eventId).toMatch(/^demo_evt_[0-9a-f]{24}$/);

    const reviewed = reviewProtectedTransferDemoEvidence(first, {
      mode: "demo",
      actorAddress: REVIEWER,
      decision: "approve",
      evidenceCommitmentHex: COMMITMENT,
      nowMs: CREATED_AT + 1_000,
      requestId: "review-001",
    });
    const released = releaseProtectedTransferDemo(reviewed, {
      mode: "demo",
      actorAddress: REVIEWER,
      nowMs: CREATED_AT + 2_000,
      requestId: "release-001",
    });

    expect(released.status).toBe("released");
    expect(released.settlement).toBe("not_submitted");
    expect(released.truthNotice).toMatch(/simulation/i);
    expect(released.events.map((event) => event.kind)).toEqual([
      "demo_transfer_created",
      "demo_evidence_approved",
      "demo_transfer_released",
    ]);
    expect(released.events.at(-1)).toMatchObject({
      actorAddress: REVIEWER,
      destinationAddress: BENEFICIARY,
      amountMicro: "25000000",
    });
  });

  it("rejects release by anyone except the configured reviewer", () => {
    const created = createProtectedTransferDemo(createInput());
    const reviewed = reviewProtectedTransferDemoEvidence(created, {
      mode: "demo",
      actorAddress: REVIEWER,
      decision: "approve",
      evidenceCommitmentHex: COMMITMENT,
      nowMs: CREATED_AT + 1_000,
      requestId: "review-001",
    });

    expect(() =>
      releaseProtectedTransferDemo(reviewed, {
        mode: "demo",
        actorAddress: PAYER,
        nowMs: CREATED_AT + 2_000,
        requestId: "release-unauthorized",
      }),
    ).toThrowError(/demo_unauthorized_release/);
  });

  it("rejects refund at or before the deadline", () => {
    const created = createProtectedTransferDemo(createInput());

    expect(() =>
      refundProtectedTransferDemo(created, {
        mode: "demo",
        actorAddress: PAYER,
        nowMs: DEADLINE,
        requestId: "refund-early",
      }),
    ).toThrowError(/demo_refund_too_early/);
  });

  it("rejects release after expiry", () => {
    const created = createProtectedTransferDemo(createInput());
    const reviewed = reviewProtectedTransferDemoEvidence(created, {
      mode: "demo",
      actorAddress: REVIEWER,
      decision: "approve",
      evidenceCommitmentHex: COMMITMENT,
      nowMs: DEADLINE,
      requestId: "review-at-deadline",
    });
    const expired = expireProtectedTransferDemo(reviewed, {
      mode: "demo",
      nowMs: DEADLINE + 1,
      requestId: "expire-001",
    });

    expect(() =>
      releaseProtectedTransferDemo(expired, {
        mode: "demo",
        actorAddress: REVIEWER,
        nowMs: DEADLINE + 1,
        requestId: "release-expired",
      }),
    ).toThrowError(/demo_terminal_state/);
  });

  it("expires then refunds only to the payer", () => {
    const created = createProtectedTransferDemo(createInput());
    const expired = expireProtectedTransferDemo(created, {
      mode: "demo",
      nowMs: DEADLINE + 1,
      requestId: "expire-001",
    });
    const refunded = refundProtectedTransferDemo(expired, {
      mode: "demo",
      actorAddress: PAYER,
      nowMs: DEADLINE + 2,
      requestId: "refund-001",
    });

    expect(refunded.status).toBe("refunded");
    expect(refunded.events.at(-1)).toMatchObject({
      kind: "demo_transfer_refunded",
      destinationAddress: PAYER,
      amountMicro: "25000000",
    });
  });

  it("rejects replayed request IDs and every action after a terminal result", () => {
    const created = createProtectedTransferDemo(createInput());

    expect(() =>
      reviewProtectedTransferDemoEvidence(created, {
        mode: "demo",
        actorAddress: REVIEWER,
        decision: "approve",
        evidenceCommitmentHex: COMMITMENT,
        nowMs: CREATED_AT + 1_000,
        requestId: "create-001",
      }),
    ).toThrowError(/demo_replay/);

    const reviewed = reviewProtectedTransferDemoEvidence(created, {
      mode: "demo",
      actorAddress: REVIEWER,
      decision: "approve",
      evidenceCommitmentHex: COMMITMENT,
      nowMs: CREATED_AT + 1_000,
      requestId: "review-001",
    });
    const released = releaseProtectedTransferDemo(reviewed, {
      mode: "demo",
      actorAddress: REVIEWER,
      nowMs: CREATED_AT + 2_000,
      requestId: "release-001",
    });

    expect(() =>
      refundProtectedTransferDemo(released, {
        mode: "demo",
        actorAddress: PAYER,
        nowMs: DEADLINE + 1,
        requestId: "refund-after-release",
      }),
    ).toThrowError(/demo_terminal_state/);
  });

  it("rejects malformed input at the strict runtime boundary", () => {
    expect(() =>
      createProtectedTransferDemo({
        ...createInput(),
        amountMicro: "0",
      }),
    ).toThrowError();

    expect(() =>
      createProtectedTransferDemo({
        ...createInput(),
        unexpected: "not accepted",
      } as ReturnType<typeof createInput>),
    ).toThrowError();
  });
});
