import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZeroAddress, keccak256, toUtf8Bytes } from "ethers";

vi.mock("@/lib/strategy/protection-purchase-verification.server", () => ({
  verifyProtectionPurchaseOnBase: vi.fn(),
}));
vi.mock("@/lib/strategy/strategy-base-gate.server", () => ({
  acquireStrategyBaseGate: vi.fn(),
  releaseStrategyBaseGate: vi.fn(),
}));

import { POST } from "@/app/api/strategy/protection/verify/route";
import {
  buildProtectionPurchasePlanId,
  type ProtectionPurchasePlanContent,
} from "@/lib/strategy/protection-purchase";
import { verifyProtectionPurchaseOnBase } from "@/lib/strategy/protection-purchase-verification.server";
import {
  acquireStrategyBaseGate,
  releaseStrategyBaseGate,
} from "@/lib/strategy/strategy-base-gate.server";

const txHash = `0x${"12".repeat(32)}`;
const account = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const maker = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function plan(overrides: Partial<ProtectionPurchasePlanContent> = {}) {
  const content: ProtectionPurchasePlanContent = {
    version: 1,
    issuedAt: "2026-08-31T00:00:00.000Z",
    validUntil: "2026-08-31T00:00:30.000Z",
    chainId: 8453,
    account,
    asset: "ETH",
    orderFingerprint: `0x${"31".repeat(32)}`,
    signatureHash: `0x${"41".repeat(32)}`,
    optionBook: "0x1bdff855d6811728acadc00989e79143a2bdfded",
    collateralToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    maker,
    nonce: "7",
    signedOrderExpirySeconds: "2000000000",
    expirySeconds: "2100000000",
    strikes8d: ["230000000000"],
    pricePerContract8d: "125000000",
    premiumCapMicro: "3000000",
    estimatedPremiumMicro: "2500000",
    allowanceAmountMicro: "3000000",
    numContractsMicro: "2000000",
    referrer: ZeroAddress,
    fillDataHash: `0x${"51".repeat(32)}`,
    ...overrides,
  };
  return { ...content, planId: buildProtectionPurchasePlanId(content) };
}

function selfAuthoredPlan(overrides: Partial<ProtectionPurchasePlanContent>) {
  const valid = plan();
  const validContent: ProtectionPurchasePlanContent = valid;
  const content = { ...validContent, ...overrides };
  const canonical = [
    content.version,
    content.issuedAt,
    content.validUntil,
    content.chainId,
    content.account,
    content.asset,
    content.orderFingerprint,
    content.signatureHash,
    content.optionBook,
    content.collateralToken,
    content.maker,
    content.nonce,
    content.signedOrderExpirySeconds,
    content.expirySeconds,
    content.strikes8d,
    content.pricePerContract8d,
    content.premiumCapMicro,
    content.estimatedPremiumMicro,
    content.allowanceAmountMicro,
    content.numContractsMicro,
    content.referrer,
    content.fillDataHash,
  ];
  return {
    ...content,
    planId: keccak256(toUtf8Bytes(JSON.stringify(canonical))).toLowerCase(),
  };
}

function request(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/strategy/protection/verify", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const acquire = vi.mocked(acquireStrategyBaseGate);
const release = vi.mocked(releaseStrategyBaseGate);
const verify = vi.mocked(verifyProtectionPurchaseOnBase);

beforeEach(() => {
  acquire.mockReset();
  release.mockReset();
  verify.mockReset();
  acquire.mockReturnValue("accepted");
  verify.mockResolvedValue({ kind: "pending", reason: "transaction_not_found" });
});

describe("POST /api/strategy/protection/verify", () => {
  it("strict-parses, gates, verifies, releases, and disables caching", async () => {
    const response = await POST(request({ txHash, plan: plan() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      kind: "pending",
      reason: "transaction_not_found",
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or unsupported content types before admission", async () => {
    for (const contentType of ["text/plain", "application/json; profile=x"]) {
      const response = await POST(request({ txHash, plan: plan() }, contentType));
      await expect(response.json()).resolves.toEqual({
        kind: "rejected",
        reason: "invalid_request",
      });
    }
    expect(acquire).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, extra fields, and over-cap bodies", async () => {
    const malformed = await POST(request("{"));
    const extra = await POST(request({ txHash, plan: plan(), extra: true }));
    const oversized = await POST(request(JSON.stringify({ padding: "x".repeat(5_000) })));
    for (const response of [malformed, extra, oversized]) {
      await expect(response.json()).resolves.toEqual({
        kind: "rejected",
        reason: "invalid_request",
      });
    }
    expect(acquire).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a self-authored plan with forged economics before admission or RPC", async () => {
    const response = await POST(request({
      txHash,
      plan: selfAuthoredPlan({
        premiumCapMicro: "3000001",
        allowanceAmountMicro: "3000001",
        estimatedPremiumMicro: "2500000",
      }),
    }));
    await expect(response.json()).resolves.toEqual({
      kind: "rejected",
      reason: "invalid_request",
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("maps denied admission to unavailable without verifier work", async () => {
    acquire.mockReturnValue("concurrency_limited");
    const response = await POST(request({ txHash, plan: plan() }));
    await expect(response.json()).resolves.toEqual({
      kind: "unavailable",
      reason: "rpc_unavailable",
    });
    expect(verify).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("releases admission after verifier failure", async () => {
    verify.mockRejectedValue(new Error("unexpected"));
    const response = await POST(request({ txHash, plan: plan() }));
    await expect(response.json()).resolves.toEqual({
      kind: "unavailable",
      reason: "rpc_unavailable",
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
