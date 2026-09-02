import { describe, expect, it } from "vitest";
import {
  DEMO_THETANUTS_EXECUTION_FIXTURE,
  DemoExecutionJournalSchema,
  advanceDemoExecutionJournal,
  createDemoExecutionJournal,
} from "@/lib/strategy/thetanuts-demo-execution-journal";

const binding = {
  account: DEMO_THETANUTS_EXECUTION_FIXTURE.account,
  chainId: DEMO_THETANUTS_EXECUTION_FIXTURE.chainId,
  orderFingerprint: DEMO_THETANUTS_EXECUTION_FIXTURE.orderFingerprint,
};

function reviewedJournal() {
  return createDemoExecutionJournal(DEMO_THETANUTS_EXECUTION_FIXTURE);
}

function approvalConfirmedJournal() {
  const submitted = advanceDemoExecutionJournal(reviewedJournal(), {
    type: "submit_approval",
    at: "2026-09-02T12:00:10.000Z",
    ...binding,
    amountMicro: DEMO_THETANUTS_EXECUTION_FIXTURE.caps.spendMicro,
  });
  return advanceDemoExecutionJournal(submitted, {
    type: "confirm_approval",
    at: "2026-09-02T12:00:20.000Z",
    ...binding,
    amountMicro: DEMO_THETANUTS_EXECUTION_FIXTURE.caps.spendMicro,
  });
}

function pendingJournal() {
  const submitted = advanceDemoExecutionJournal(approvalConfirmedJournal(), {
    type: "submit_fill",
    at: "2026-09-02T12:00:30.000Z",
    ...binding,
    caps: DEMO_THETANUTS_EXECUTION_FIXTURE.caps,
  });
  return advanceDemoExecutionJournal(submitted, {
    type: "mark_pending_verification",
    at: "2026-09-02T12:00:40.000Z",
    ...binding,
    receiptId: DEMO_THETANUTS_EXECUTION_FIXTURE.receiptId,
  });
}

describe("Thetanuts demo execution journal", () => {
  it("records a deterministic simulated lifecycle without a transaction hash", () => {
    const pending = pendingJournal();
    const verified = advanceDemoExecutionJournal(pending, {
      type: "resolve_verification",
      at: "2026-09-02T12:00:50.000Z",
      ...binding,
      outcome: "verified",
      receiptId: DEMO_THETANUTS_EXECUTION_FIXTURE.receiptId,
      observedPremiumMicro: "2500000",
      observedMaximumLossMicro: "500000000",
      observedSpendMicro: "2500000",
    });

    expect(verified.status).toBe("verified");
    expect(verified.mode).toBe("demo");
    expect(verified.receipt).toEqual({
      mode: "demo",
      evidence: "simulated",
      receiptId: DEMO_THETANUTS_EXECUTION_FIXTURE.receiptId,
      account: binding.account,
      chainId: binding.chainId,
      orderFingerprint: binding.orderFingerprint,
      premiumMicro: "2500000",
      maximumLossMicro: "500000000",
      spendMicro: "2500000",
      verifiedAt: "2026-09-02T12:00:50.000Z",
    });
    expect(JSON.stringify(verified)).not.toContain("txHash");
    expect(verified.events.map((event) => event.status)).toEqual([
      "policy_reviewed",
      "approval_submitted",
      "approval_confirmed",
      "fill_submitted",
      "pending_verification",
      "verified",
    ]);
  });

  it.each([
    ["account", { account: "0x0000000000000000000000000000000000000002" }],
    ["chain", { chainId: 1 }],
    ["order", { orderFingerprint: `0x${"22".repeat(32)}` }],
  ])("rejects a mismatched %s binding", (_label, override) => {
    expect(() => advanceDemoExecutionJournal(reviewedJournal(), {
      type: "submit_approval",
      at: "2026-09-02T12:00:10.000Z",
      ...binding,
      ...override,
      amountMicro: DEMO_THETANUTS_EXECUTION_FIXTURE.caps.spendMicro,
    })).toThrow(/binding/i);
  });

  it.each([
    ["premium", { premiumMicro: "2999999" }],
    ["loss", { maximumLossMicro: "499999999" }],
    ["spend", { spendMicro: "2999999" }],
  ])("rejects a non-exact %s cap", (_label, override) => {
    expect(() => advanceDemoExecutionJournal(approvalConfirmedJournal(), {
      type: "submit_fill",
      at: "2026-09-02T12:00:30.000Z",
      ...binding,
      caps: { ...DEMO_THETANUTS_EXECUTION_FIXTURE.caps, ...override },
    })).toThrow(/caps/i);
  });

  it("rejects stale policy execution", () => {
    expect(() => advanceDemoExecutionJournal(reviewedJournal(), {
      type: "submit_approval",
      at: "2026-09-02T12:06:00.000Z",
      ...binding,
      amountMicro: DEMO_THETANUTS_EXECUTION_FIXTURE.caps.spendMicro,
    })).toThrow(/stale/i);
  });

  it("rejects malformed journal and command input", () => {
    expect(() => createDemoExecutionJournal({ mode: "live" })).toThrow();
    expect(() => advanceDemoExecutionJournal(reviewedJournal(), {
      type: "submit_approval",
      at: "not-a-date",
    })).toThrow();
  });

  it("rejects a forged terminal state without matching evidence", () => {
    expect(() => DemoExecutionJournalSchema.parse({
      ...pendingJournal(),
      status: "verified",
      receipt: null,
    })).toThrow(/status|receipt|event/i);
  });

  it("blocks rebroadcast while verification is pending", () => {
    expect(() => advanceDemoExecutionJournal(pendingJournal(), {
      type: "submit_fill",
      at: "2026-09-02T12:00:45.000Z",
      ...binding,
      caps: DEMO_THETANUTS_EXECUTION_FIXTURE.caps,
    })).toThrow(/pending verification/i);
  });

  it("retries only a rejected outcome with a fresh review window", () => {
    const rejected = advanceDemoExecutionJournal(pendingJournal(), {
      type: "resolve_verification",
      at: "2026-09-02T12:00:50.000Z",
      ...binding,
      outcome: "rejected",
      receiptId: DEMO_THETANUTS_EXECUTION_FIXTURE.receiptId,
      reason: "simulated receipt did not match policy",
    });
    const retried = advanceDemoExecutionJournal(rejected, {
      type: "retry",
      at: "2026-09-02T12:01:00.000Z",
      ...binding,
      validUntil: "2026-09-02T12:06:00.000Z",
    });

    expect(retried.status).toBe("policy_reviewed");
    expect(retried.attempt).toBe(2);
    expect(retried.receipt).toBeNull();
    expect(retried.events.at(-1)).toMatchObject({ status: "policy_reviewed", attempt: 2 });
    expect(() => advanceDemoExecutionJournal(retried, {
      type: "retry",
      at: "2026-09-02T12:01:10.000Z",
      ...binding,
      validUntil: "2026-09-02T12:06:00.000Z",
    })).toThrow(/rejected/i);
  });
});
