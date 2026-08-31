import { describe, expect, it, vi } from "vitest";
import {
  requestProtectedTransferPlan,
  requestProtectedTransferOpen,
  requestProtectedTransferTerminalVerification,
  type ProtectedTransferPlanClientInput,
} from "@/lib/remittance/protected-transfer-client";
import {
  PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS,
  type ProtectedTransferPlanRequest,
} from "@/lib/remittance/protected-transfer";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";

const NOW = 1_700_000_000_000;
const PACKAGE = "0x" + "44".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const ACCOUNT = "0x" + "22".repeat(32);
const PAYER = "0x" + "11".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const COMMITMENT = "0x" + "ab".repeat(32);

function makeRequest(): ProtectedTransferPlanRequest {
  return {
    quote: {
      kind: "quote",
      recipient: "Ana",
      destinationCity: "manila",
      destinationCountry: "Philippines",
      youPayMinor: "50000",
      youPayCurrency: "MYR",
      familyReceivesMinor: "610400",
      familyReceivesCurrency: "PHP",
      exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.44 PHP" },
      totalFeeMinor: "950",
      feeCurrency: "MYR",
      fixedFeeMinor: "200",
      feeBps: 150,
      usdcMicro: "109000000",
      usdcAmount: "109",
      settlementRail: "Sui testnet USDC",
      payoutMethod: "Bank payout · Not available yet",
      estimatedArrival: "Within minutes after on-chain confirmation",
      payoutStatus: "Awaiting payout partner",
      issuedAt: NOW,
      expiresAt: NOW + 120_000,
      provenance: {
        pricing: "reference",
        sourceLabel: "Reference pricing — not a live rate",
        myrPerUsdc: "450",
        phpPerUsdc: "5600",
        fixedFeeMyr: "200",
        feeBps: 150,
      },
      corridor: { source: "MYR", destination: "PHP" },
      recipientAddress: ACCOUNT,
      beneficiaryRef: "R-ABCD1234",
      attestation: { v: 1, hmac: "0x" + "ab".repeat(32) },
      intentReview: {
        reviewer: "local",
        mode: "fallback",
        provider: "deterministic",
        fallbackReason: "not_configured",
        purpose: "school supplies",
        maximumFamilyLimitMinor: "52000",
        ruleStatus: "within_limit",
      },
      clarification: null,
    },
    deadlinePreset: "tomorrow",
    reviewNote: "  Hold until reviewed  ",
  };
}

function planResponse() {
  return {
    kind: "protected_transfer_execution_plan",
    authorization: {
      kind: "authorization",
      recipientAddress: ACCOUNT,
      usdcMicro: "109000000",
      coinType: USDC_COIN_TYPE_TESTNET,
      beneficiaryRef: "R-ABCD1234",
      issuedAt: NOW,
      expiresAt: NOW + 120_000,
      corridor: { source: "MYR", destination: "PHP" },
      youPayMinor: "50000",
      familyReceivesMinor: "610400",
      totalFeeMinor: "950",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
      recipient: "Ana",
      destinationCity: "manila",
      purpose: "school supplies",
      maximumFamilyLimitMinor: "52000",
    },
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS.tomorrow,
    reviewNote: "Hold until reviewed",
  } as const;
}

describe("requestProtectedTransferPlan", () => {
  it("posts the strict request and returns the strict plan response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(planResponse()), { status: 200 }));
    const input: ProtectedTransferPlanClientInput = { request: makeRequest(), fetchImpl };

    const result = await requestProtectedTransferPlan(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/remittance/protected-transfer/plan",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.stringContaining("\"deadlinePreset\":\"tomorrow\""),
      }),
    );
    expect(result).toEqual({
      response: planResponse(),
    });
  });

  it("returns safe rejections unchanged", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ kind: "rejected", reason: "not_configured" }), { status: 200 }),
    );

    const result = await requestProtectedTransferPlan({ request: makeRequest(), fetchImpl });

    expect(result).toEqual({
      response: { kind: "rejected", reason: "not_configured" },
    });
  });

  it("rejects a malformed request before fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(planResponse()), { status: 200 }));
    const bad = {
      ...makeRequest(),
      deadlinePreset: "tomorrow",
      extra: true,
    } as unknown as ProtectedTransferPlanRequest;

    await expect(
      requestProtectedTransferPlan({ request: bad, fetchImpl }),
    ).rejects.toThrow(/request failed strict schema/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when the response is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>nope</html>", { status: 200 }));

    await expect(
      requestProtectedTransferPlan({ request: makeRequest(), fetchImpl }),
    ).rejects.toThrow(/not valid json/i);
  });

  it("throws when the response breaks the strict schema", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ kind: "nope" }), { status: 200 }));

    await expect(
      requestProtectedTransferPlan({ request: makeRequest(), fetchImpl }),
    ).rejects.toThrow(/strict schema/i);
  });
});

describe("terminal client adapters", () => {
  const terminalRequest = {
    action: "release" as const,
    digest: DIGEST,
    packageId: PACKAGE,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: ACCOUNT,
    reviewerAddress: REVIEWER,
    amountMicro: "109000000",
    deadlineMs: NOW + 60_000,
    evidenceCommitmentHex: COMMITMENT,
  };
  const openRequest = {
    packageId: PACKAGE,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: ACCOUNT,
    reviewerAddress: REVIEWER,
    amountMicro: "109000000",
    deadlineMs: NOW + 60_000,
    evidenceCommitmentHex: COMMITMENT,
  };

  it("posts terminal verification and returns a strict response", async () => {
    const response = { kind: "not_found", reason: "transaction_not_found" } as const;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response)));
    await expect(requestProtectedTransferTerminalVerification({ request: terminalRequest, fetchImpl }))
      .resolves.toEqual({ response });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/remittance/protected-transfer/terminal/verify",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" } }),
    );
  });

  it("rejects a malformed terminal verification response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ kind: "verified" })));
    await expect(requestProtectedTransferTerminalVerification({ request: terminalRequest, fetchImpl }))
      .rejects.toThrow(/strict schema/i);
  });

  it("posts open-state lookup and returns a strict response", async () => {
    const response = { kind: "terminal_unknown", reason: "object_absent" } as const;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response)));
    await expect(requestProtectedTransferOpen({ request: openRequest, fetchImpl }))
      .resolves.toEqual({ response });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/remittance/protected-transfer/terminal/open",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" } }),
    );
  });

  it("rejects a malformed open-state response", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json"));
    await expect(requestProtectedTransferOpen({ request: openRequest, fetchImpl }))
      .rejects.toThrow(/not valid json/i);
  });
});
