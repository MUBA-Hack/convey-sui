import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPTION_BOOK_ABI,
  getChainConfigById,
} from "@thetanuts-finance/thetanuts-client";
import { Interface, ZeroAddress, keccak256, toUtf8Bytes } from "ethers";
import {
  buildProtectionPurchasePlanId,
  type ProtectionPurchasePlanContent,
  type ProtectionPurchasePlanSummary,
} from "@/lib/strategy/protection-purchase";
import {
  __setProtectionPurchaseVerificationReaderFactoryForTest,
  evaluateProtectionPurchaseVerification,
  verifyProtectionPurchaseOnBase,
  type ProtectionPurchaseTransaction,
  type ProtectionPurchaseTransactionReceipt,
} from "@/lib/strategy/protection-purchase-verification.server";

const config = getChainConfigById(8453);
const optionBook = config.contracts.optionBook!.toLowerCase();
const collateralToken = config.tokens.USDC!.address.toLowerCase();
const maker = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const account = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const txHash = `0x${"12".repeat(32)}`;
const signature = "0x1234";
const nonce = 7n;
const orderExpiry = 2_000_000_000n;
const optionExpiry = 2_100_000_000n;
const strike = 2300_00000000n;
const price = 1_25000000n;
const numContracts = 2_000000n;
const premium = 2_500000n;
const fee = 10_000n;
const iface = new Interface(OPTION_BOOK_ABI);

const order = {
  maker,
  orderExpiryTimestamp: orderExpiry,
  collateral: collateralToken,
  isCall: false,
  priceFeed: config.priceFeeds.ETH,
  implementation: config.implementations.PUT!,
  isLong: true,
  maxCollateralUsable: 10_000000n,
  strikes: [strike],
  expiry: optionExpiry,
  price,
  numContracts,
  extraOptionData: "0x",
};
const fillData = iface.encodeFunctionData("fillOrder", [order, signature, ZeroAddress]);

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
    signatureHash: keccak256(signature).toLowerCase(),
    optionBook,
    collateralToken,
    maker,
    nonce: nonce.toString(),
    signedOrderExpirySeconds: orderExpiry.toString(),
    expirySeconds: optionExpiry.toString(),
    strikes8d: [strike.toString()],
    pricePerContract8d: price.toString(),
    premiumCapMicro: "3000000",
    estimatedPremiumMicro: premium.toString(),
    allowanceAmountMicro: "3000000",
    numContractsMicro: numContracts.toString(),
    referrer: ZeroAddress,
    fillDataHash: keccak256(fillData).toLowerCase(),
    ...contentOverrides,
  };
  return { ...content, planId: planId ?? buildProtectionPurchasePlanId(content) };
}

function selfAuthoredPlan(
  overrides: Partial<ProtectionPurchasePlanContent>,
): ProtectionPurchasePlanSummary {
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
  } as ProtectionPurchasePlanSummary;
}

function orderFilledLog(overrides: Record<string, unknown> = {}) {
  const values = {
    nonce,
    buyer: account,
    seller: maker,
    optionAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    premiumAmount: premium,
    feeCollected: fee,
    referrer: ZeroAddress,
    referralFeePaid: 0n,
    sellerWasMaker: true,
    ...overrides,
  };
  const encoded = iface.encodeEventLog(iface.getEvent("OrderFilled")!, [
    values.nonce,
    values.buyer,
    values.seller,
    values.optionAddress,
    values.premiumAmount,
    values.feeCollected,
    values.referrer,
    values.referralFeePaid,
    values.sellerWasMaker,
  ]);
  return { address: optionBook, topics: encoded.topics, data: encoded.data };
}

function transaction(overrides: Partial<ProtectionPurchaseTransaction> = {}): ProtectionPurchaseTransaction {
  return {
    hash: txHash,
    from: account,
    to: optionBook,
    data: fillData,
    value: 0n,
    chainId: 8453n,
    ...overrides,
  };
}

function receipt(
  overrides: Partial<ProtectionPurchaseTransactionReceipt> = {},
): ProtectionPurchaseTransactionReceipt {
  return {
    hash: txHash,
    from: account,
    to: optionBook,
    status: 1,
    blockNumber: 123,
    logs: [orderFilledLog()],
    ...overrides,
  };
}

function evaluate(
  planOverrides: Partial<ProtectionPurchasePlanSummary> = {},
  txOverrides: Partial<ProtectionPurchaseTransaction> = {},
  receiptOverrides: Partial<ProtectionPurchaseTransactionReceipt> = {},
  executionBlockTimestampSeconds = Math.floor(Date.parse("2026-08-31T00:00:20.000Z") / 1_000),
) {
  return evaluateProtectionPurchaseVerification({
    request: { txHash, plan: plan(planOverrides) },
    transaction: transaction(txOverrides),
    receipt: receipt(receiptOverrides),
    executionBlockTimestampSeconds,
    checkedAt: "2026-08-31T00:01:00.000Z",
  });
}

afterEach(() => {
  __setProtectionPurchaseVerificationReaderFactoryForTest(null);
});

describe("protection purchase exact evaluator", () => {
  it("verifies exact Base calldata and one exact OrderFilled event", () => {
    expect(evaluate()).toEqual({
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
    });
  });

  it("filters by exact address and topic before event cardinality", () => {
    const exact = orderFilledLog();
    const unrelated = {
      ...exact,
      address: "0xdddddddddddddddddddddddddddddddddddddddd",
    };
    expect(evaluate({}, {}, { logs: [unrelated, exact] }).kind).toBe("verified");
  });

  it("rejects two exact OrderFilled events as ambiguous", () => {
    expect(evaluate({}, {}, { logs: [orderFilledLog(), orderFilledLog()] })).toEqual({
      kind: "rejected",
      reason: "ambiguous_event",
    });
  });

  it("rejects failed transactions before accepting an event", () => {
    expect(evaluate({}, {}, { status: 0 })).toEqual({
      kind: "rejected",
      reason: "failed_transaction",
    });
  });

  it("rejects calldata, signature, target, account, and chain mismatches", () => {
    expect(evaluate({ fillDataHash: `0x${"99".repeat(32)}` }).kind).toBe("rejected");
    expect(evaluate({ signatureHash: `0x${"98".repeat(32)}` }).kind).toBe("rejected");
    expect(evaluate({}, { to: account }).kind).toBe("rejected");
    expect(evaluate({}, { from: maker }).kind).toBe("rejected");
    expect(evaluate({}, { chainId: 1n }).kind).toBe("rejected");
    expect(evaluate({}, { data: "not-hex" }).kind).toBe("rejected");
  });

  it("rejects otherwise matching calldata with opaque option data", () => {
    const opaqueFillData = iface.encodeFunctionData("fillOrder", [
      { ...order, extraOptionData: "0x1234" },
      signature,
      ZeroAddress,
    ]);
    expect(evaluate(
      { fillDataHash: keccak256(opaqueFillData).toLowerCase() },
      { data: opaqueFillData },
    )).toEqual({ kind: "rejected", reason: "transaction_mismatch" });
  });

  it("accepts execution mined after quote freshness while signed expiries remain live", () => {
    const oneSecondLate = Math.floor(Date.parse("2026-08-31T00:00:31.000Z") / 1_000);
    expect(evaluate({}, {}, {}, oneSecondLate).kind).toBe("verified");
  });

  it.each([
    ["signed order", Number(orderExpiry)],
    ["option", Number(optionExpiry)],
  ])("rejects execution at the %s expiry", (_label, executionBlockTimestampSeconds) => {
    expect(evaluate(
      { validUntil: "2040-01-01T00:00:00.000Z" },
      {},
      {},
      executionBlockTimestampSeconds,
    )).toEqual({ kind: "rejected", reason: "transaction_mismatch" });
  });

  it("rejects a plan id that does not bind the carried summary", () => {
    expect(evaluate({ planId: `0x${"99".repeat(32)}` })).toEqual({
      kind: "rejected",
      reason: "invalid_request",
    });
  });

  it.each([
    ["premium below the minimum", { premiumCapMicro: "999999", allowanceAmountMicro: "999999" }],
    ["premium above the maximum", { premiumCapMicro: "3000001", allowanceAmountMicro: "3000001" }],
    ["allowance above the cap", { allowanceAmountMicro: "3000001" }],
    ["estimated premium above the cap", { estimatedPremiumMicro: "3000001" }],
    ["zero estimated premium", { estimatedPremiumMicro: "0" }],
    ["zero contracts", { numContractsMicro: "0" }],
    ["premium inconsistent with price and contracts", { estimatedPremiumMicro: "2499999" }],
  ])("rejects forged plan economics: %s", (_label, overrides) => {
    const forged = selfAuthoredPlan(overrides);
    expect(evaluateProtectionPurchaseVerification({
      request: { txHash, plan: forged },
      transaction: transaction(),
      receipt: receipt(),
      executionBlockTimestampSeconds: Math.floor(Date.parse("2026-08-31T00:00:20.000Z") / 1_000),
    })).toEqual({ kind: "rejected", reason: "invalid_request" });
  });

  it("rejects event party, nonce, premium, referrer, and maker-side mismatches", () => {
    const cases = [
      orderFilledLog({ buyer: maker }),
      orderFilledLog({ seller: account }),
      orderFilledLog({ nonce: 8n }),
      orderFilledLog({ premiumAmount: premium + 1n }),
      orderFilledLog({ referrer: account }),
      orderFilledLog({ sellerWasMaker: false }),
    ];
    for (const log of cases) {
      expect(evaluate({}, {}, { logs: [log] })).toEqual({
        kind: "rejected",
        reason: "event_mismatch",
      });
    }
  });
});

describe("protection purchase Base reader", () => {
  it("performs exactly one transaction, receipt, and fixed receipt-block read", async () => {
    const getTransaction = vi.fn().mockResolvedValue(transaction());
    const getTransactionReceipt = vi.fn().mockResolvedValue(receipt());
    const getBlockTimestamp = vi.fn().mockResolvedValue(
      Math.floor(Date.parse("2026-08-31T00:00:20.000Z") / 1_000),
    );
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    await expect(verifyProtectionPurchaseOnBase({ txHash, plan: plan() })).resolves.toMatchObject({
      kind: "verified",
    });
    expect(getTransaction).toHaveBeenCalledTimes(1);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(getBlockTimestamp).toHaveBeenCalledOnce();
    expect(getBlockTimestamp).toHaveBeenCalledWith(123);
  });

  it("returns pending when transaction evidence is not yet available", async () => {
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction: vi.fn().mockResolvedValue(null),
      getTransactionReceipt: vi.fn().mockResolvedValue(null),
      getBlockTimestamp: vi.fn(),
    }));
    await expect(verifyProtectionPurchaseOnBase({ txHash, plan: plan() })).resolves.toEqual({
      kind: "pending",
      reason: "transaction_not_found",
    });
  });

  it("rejects forged plan economics before any Base RPC call", async () => {
    const getTransaction = vi.fn();
    const getTransactionReceipt = vi.fn();
    const getBlockTimestamp = vi.fn();
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    await expect(verifyProtectionPurchaseOnBase({
      txHash,
      plan: selfAuthoredPlan({ allowanceAmountMicro: "2999999" }),
    })).resolves.toEqual({ kind: "rejected", reason: "invalid_request" });
    expect(getTransaction).not.toHaveBeenCalled();
    expect(getTransactionReceipt).not.toHaveBeenCalled();
    expect(getBlockTimestamp).not.toHaveBeenCalled();
  });

  it("returns a known failed receipt without depending on a block lookup", async () => {
    const getBlockTimestamp = vi.fn().mockRejectedValue(new Error("offline"));
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction: vi.fn().mockResolvedValue(transaction()),
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt({ status: 0 })),
      getBlockTimestamp,
    }));
    await expect(verifyProtectionPurchaseOnBase({ txHash, plan: plan() })).resolves.toEqual({
      kind: "rejected",
      reason: "failed_transaction",
    });
    expect(getBlockTimestamp).not.toHaveBeenCalled();
  });

  it("returns unavailable on provider failure", async () => {
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction: vi.fn().mockRejectedValue(new Error("offline")),
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
      getBlockTimestamp: vi.fn(),
    }));
    await expect(verifyProtectionPurchaseOnBase({ txHash, plan: plan() })).resolves.toEqual({
      kind: "unavailable",
      reason: "rpc_unavailable",
    });
  });
});
