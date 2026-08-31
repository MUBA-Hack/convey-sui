import { describe, expect, it } from "vitest";
import { ZeroAddress } from "ethers";
import {
  buildProtectionPurchasePlanId,
  type ProtectionPurchasePlanContent,
  type ProtectionPurchasePlanSummary,
} from "@/lib/strategy/protection-purchase";
import {
  ProtectionPurchaseReceiptSchema,
  buildBaseScanTransactionUrl,
  buildProtectionPurchaseReceipt,
  decodeProtectionPurchaseReceiptPayload,
  encodeProtectionPurchaseReceiptPayload,
  type VerifiedProtectionPurchase,
} from "@/lib/strategy/protection-purchase-receipt";

const account = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const maker = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const txHash = `0x${"12".repeat(32)}`;

function plan(overrides: Partial<ProtectionPurchasePlanSummary> = {}): ProtectionPurchasePlanSummary {
  const { planId, ...contentOverrides } = overrides;
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
    ...contentOverrides,
  };
  return { ...content, planId: planId ?? buildProtectionPurchasePlanId(content) };
}

function purchase(
  overrides: Partial<VerifiedProtectionPurchase> = {},
): VerifiedProtectionPurchase {
  return {
    kind: "verified",
    network: "base-mainnet",
    chainId: 8453,
    txHash,
    blockNumber: 123,
    buyerAddress: account,
    makerAddress: maker,
    optionAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    nonce: "7",
    premiumAmountMicro: "2500000",
    feeCollectedMicro: "10000",
    referralFeePaidMicro: "0",
    referrerAddress: ZeroAddress,
    sellerWasMaker: true,
    checkedAt: "2026-08-31T00:01:00.000Z",
    ...overrides,
  };
}

describe("protection purchase receipt", () => {
  it("builds, encodes, and decodes a verified portable receipt", () => {
    const document = buildProtectionPurchaseReceipt({
      plan: plan(),
      purchase: purchase(),
      approvalTxHash: `0x${"61".repeat(32)}`,
      exportedAt: "2026-08-31T00:01:01.000Z",
    });
    expect(decodeProtectionPurchaseReceiptPayload(
      encodeProtectionPurchaseReceiptPayload(document),
    )).toEqual(document);
  });

  it("binds chain, buyer, maker, nonce, premium, and referrer to the plan", () => {
    const cases: Array<Partial<VerifiedProtectionPurchase>> = [
      { buyerAddress: maker },
      { makerAddress: account },
      { nonce: "8" },
      { premiumAmountMicro: "2500001" },
      { referrerAddress: account },
    ];
    for (const override of cases) {
      expect(() =>
        buildProtectionPurchaseReceipt({
          plan: plan(),
          purchase: purchase(override),
          exportedAt: "2026-08-31T00:01:01.000Z",
        }),
      ).toThrow();
    }
  });

  it("rejects an export timestamp before verification", () => {
    expect(
      ProtectionPurchaseReceiptSchema.safeParse({
        kind: "convey.protection-purchase-receipt",
        version: 1,
        plan: plan(),
        purchase: purchase(),
        approvalTxHash: null,
        exportedAt: "2026-08-31T00:00:59.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects receipts carrying forged plan economics", () => {
    const forgedPlan = {
      ...plan(),
      estimatedPremiumMicro: "2499999",
    };
    expect(ProtectionPurchaseReceiptSchema.safeParse({
      kind: "convey.protection-purchase-receipt",
      version: 1,
      plan: forgedPlan,
      purchase: purchase({ premiumAmountMicro: "2499999" }),
      approvalTxHash: null,
      exportedAt: "2026-08-31T00:01:01.000Z",
    }).success).toBe(false);
  });

  it("derives the canonical BaseScan URL from a strict transaction hash", () => {
    expect(buildBaseScanTransactionUrl(txHash)).toBe(`https://basescan.org/tx/${txHash}`);
    expect(buildBaseScanTransactionUrl(`0x${"A".repeat(64)}`)).toBe(
      `https://basescan.org/tx/0x${"a".repeat(64)}`,
    );
    expect(() => buildBaseScanTransactionUrl("0x1234")).toThrow();
  });

  it("rejects malformed portable payloads", () => {
    expect(() => decodeProtectionPurchaseReceiptPayload("not+base64")).toThrow();
    expect(() => decodeProtectionPurchaseReceiptPayload("a".repeat(24_577))).toThrow();
  });
});
