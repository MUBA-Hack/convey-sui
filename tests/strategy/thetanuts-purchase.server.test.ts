import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import {
  buildProtectionOrderFingerprint,
  ProtectionPurchasePlanResponseSchema,
} from "@/lib/strategy/protection-purchase";
import {
  prepareProtectionPurchasePlanWith,
  PROTECTION_PURCHASE_REFERRER,
  type ThetanutsPurchaseReader,
} from "@/lib/strategy/thetanuts-purchase.server";

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1_000;
const ACCOUNT = "0x" + "9".repeat(40);
const MAKER = "0x" + "a".repeat(40);
const OPTION_BOOK = "0x" + "b".repeat(40);
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PUT = "0x" + "d".repeat(40);
const ETH_FEED = "0x" + "e".repeat(40);
const BTC_FEED = "0x" + "f".repeat(40);

function order(): OrderWithSignature {
  return {
    order: {
      maker: MAKER,
      taker: "0x" + "0".repeat(40),
      option: "",
      isBuyer: false,
      numContracts: 0n,
      price: 120_000_000n,
      expiry: BigInt(NOW + 30 * 86_400),
      nonce: 7n,
      optionType: 1,
      strikes: [400_000_000_000n],
      collateralToken: USDC,
      underlyingToken: "0x" + "1".repeat(40),
    },
    signature: "0x" + "5".repeat(130),
    availableAmount: 20_000_000_000n,
    makerAddress: MAKER,
    rawApiData: {
      collateral: USDC,
      priceFeed: ETH_FEED,
      implementation: PUT,
      strikes: ["400000000000"],
      isCall: false,
      isLong: true,
      orderExpiryTimestamp: NOW + 3_600,
      extraOptionData: "0x",
      maxCollateralUsable: "20000000000",
      optionBookAddress: OPTION_BOOK,
    },
  };
}

function reader(entry = order(), allowance = 0n): ThetanutsPurchaseReader {
  return {
    optionBook: OPTION_BOOK,
    collateralToken: USDC,
    putImplementation: PUT,
    priceFeeds: { ETH: ETH_FEED, BTC: BTC_FEED },
    fetchOrders: vi.fn().mockResolvedValue([entry]),
    previewFillOrder: vi.fn().mockReturnValue({
      numContracts: 2_500_000n,
      maxContracts: 5_000_000n,
      collateralToken: USDC,
      pricePerContract: 120_000_000n,
      totalCollateral: 3_000_000n,
      referrer: PROTECTION_PURCHASE_REFERRER,
      maker: MAKER,
      expiry: entry.order.expiry,
      isCall: false,
      strikes: [400_000_000_000n],
    }),
    getAllowance: vi.fn().mockResolvedValue(allowance),
    encodeApprove: vi.fn().mockReturnValue({ to: USDC, data: "0xabcd" }),
    encodeFillOrder: vi.fn().mockReturnValue({ to: OPTION_BOOK, data: "0x1234" }),
  };
}

function request(entry = order()) {
  return {
    goal: "Protect ETH downside for 30 days",
    premiumBudgetUsd: 3,
    account: ACCOUNT,
    offerFingerprint: buildProtectionOrderFingerprint(entry, OPTION_BOOK),
  };
}

describe("prepareProtectionPurchasePlanWith", () => {
  it("returns exact approval calldata and a content-bound fresh plan", async () => {
    const entry = order();
    const source = reader(entry);
    const result = await prepareProtectionPurchasePlanWith(source, request(entry), { nowMs: NOW_MS });
    expect(result.kind).toBe("ready_approval");
    expect(ProtectionPurchasePlanResponseSchema.safeParse(result).success).toBe(true);
    if (result.kind !== "ready_approval") return;
    expect(result.transaction).toEqual({
      from: ACCOUNT,
      to: USDC.toLowerCase(),
      data: "0xabcd",
      value: "0x0",
      chainId: "0x2105",
    });
    expect(result.plan.premiumCapMicro).toBe("3000000");
    expect(result.plan.estimatedPremiumMicro).toBe("3000000");
    expect(result.plan.numContractsMicro).toBe("2500000");
    expect(result.plan.validUntil).toBe(new Date(NOW_MS + 30_000).toISOString());
    expect(source.encodeApprove).toHaveBeenCalledWith(USDC, OPTION_BOOK, 3_000_000n);
    expect(source.encodeFillOrder).toHaveBeenCalledWith(entry, 3_000_000n, PROTECTION_PURCHASE_REFERRER);
  });

  it("returns fill calldata only after sufficient allowance", async () => {
    const entry = order();
    const source = reader(entry, 3_000_000n);
    const result = await prepareProtectionPurchasePlanWith(source, request(entry), { nowMs: NOW_MS });
    expect(result.kind).toBe("ready_fill");
    if (result.kind === "ready_fill") expect(result.transaction.data).toBe("0x1234");
    expect(source.encodeApprove).not.toHaveBeenCalled();
  });

  it("returns changed when any fingerprint-bound order field changes", async () => {
    const discovered = order();
    const changed = order();
    changed.signature = "0x" + "6".repeat(130);
    const result = await prepareProtectionPurchasePlanWith(reader(changed), request(discovered), { nowMs: NOW_MS });
    expect(result.kind).toBe("changed");
  });

  it("requires fifteen seconds of signed-order submit runway", async () => {
    const unsafe = order();
    unsafe.rawApiData!.orderExpiryTimestamp = NOW + 14;
    expect((await prepareProtectionPurchasePlanWith(reader(unsafe), request(unsafe), { nowMs: NOW_MS })).kind).toBe("changed");

    const boundary = order();
    boundary.rawApiData!.orderExpiryTimestamp = NOW + 15;
    expect((await prepareProtectionPurchasePlanWith(reader(boundary), request(boundary), { nowMs: NOW_MS })).kind).toBe("ready_approval");
  });

  it.each(["0x00", "0x1234"]) (
    "rejects unsupported opaque option data %s",
    async (extraOptionData) => {
      const unsafe = order();
      unsafe.rawApiData!.extraOptionData = extraOptionData;
      const result = await prepareProtectionPurchasePlanWith(reader(unsafe), request(unsafe), { nowMs: NOW_MS });
      expect(result.kind).toBe("changed");
    },
  );

  it("rejects missing option data instead of treating it as vanilla", async () => {
    const unsafe = order();
    const purchaseRequest = request(unsafe);
    const raw = unsafe.rawApiData! as { extraOptionData?: string };
    delete raw.extraOptionData;
    const result = await prepareProtectionPurchasePlanWith(reader(unsafe), purchaseRequest, { nowMs: NOW_MS });
    expect(result.kind).toBe("changed");
  });

  it.each([
    ["stale signed order", (entry: OrderWithSignature) => { entry.rawApiData!.orderExpiryTimestamp = NOW; }],
    ["wrong implementation", (entry: OrderWithSignature) => { entry.rawApiData!.implementation = ACCOUNT; }],
    ["wrong target", (entry: OrderWithSignature) => { entry.rawApiData!.optionBookAddress = ACCOUNT; }],
    ["wrong collateral", (entry: OrderWithSignature) => { entry.rawApiData!.collateral = ACCOUNT; }],
    ["short option expiry", (entry: OrderWithSignature) => { entry.order.expiry -= 1n; }],
  ])("fails closed for %s", async (_name, mutate) => {
    const entry = order();
    mutate(entry);
    const result = await prepareProtectionPurchasePlanWith(reader(entry), request(entry), { nowMs: NOW_MS });
    expect(result.kind).toBe("changed");
  });

  it("rejects capped preview instead of presenting cap as exact fill", async () => {
    const entry = order();
    const source = reader(entry);
    vi.mocked(source.previewFillOrder).mockReturnValue({
      ...source.previewFillOrder(entry, 3_000_000n, PROTECTION_PURCHASE_REFERRER),
      numContracts: 2_000_000n,
      maxContracts: 2_000_000n,
    });
    const result = await prepareProtectionPurchasePlanWith(source, request(entry), { nowMs: NOW_MS });
    expect(result.kind).toBe("no_match");
    expect(source.getAllowance).not.toHaveBeenCalled();
  });

  it("rejects invalid input before provider access", async () => {
    const source = reader();
    const result = await prepareProtectionPurchasePlanWith(source, { ...request(), premiumBudgetUsd: 4 }, { nowMs: NOW_MS });
    expect(result.kind).toBe("rejected");
    expect(source.fetchOrders).not.toHaveBeenCalled();
  });

  it("bounds the whole provider path by one timeout", async () => {
    const source = reader();
    source.fetchOrders = vi.fn(() => new Promise<never>(() => undefined));
    const result = await prepareProtectionPurchasePlanWith(source, request(), { nowMs: NOW_MS, timeoutMs: 5 });
    expect(result.kind).toBe("unavailable");
  });
});
