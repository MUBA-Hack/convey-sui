import { describe, expect, it } from "vitest";
import { parseQrTaskEnvelope } from "@/lib/commerce/qr-task";
import { createReceiptSplitShare } from "@/lib/remittance/receipt-split-share";

describe("receipt split share", () => {
  it("carries the exact participant, micro amount, asset, note, expiry, and review gate", () => {
    const share = createReceiptSplitShare({
      origin: "https://convey.example",
      participant: "Dave · Work",
      amountMicro: "1",
      asset: "USDC",
      note: "River Cafe receipt split",
      createdAt: Date.parse("2026-09-04T12:00:00.000Z"),
      expiresAt: Date.parse("2026-09-11T12:00:00.000Z"),
    });

    const reviewUrl = new URL(share.reviewUrl);
    const parsed = parseQrTaskEnvelope(reviewUrl.searchParams.get("code")!);
    expect(parsed).toEqual({
      kind: "convey.qr-task",
      version: 1,
      task: "split",
      createdAt: "2026-09-04T12:00:00.000Z",
      reviewRequired: true,
      recipient: "Dave · Work",
      amount: "0.000001",
      asset: "USDC",
      note: "River Cafe receipt split",
      expiresAt: "2026-09-11T12:00:00.000Z",
    });
    expect(share.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(new URL(share.whatsappUrl).searchParams.get("text")).toContain(share.reviewUrl);
  });

  it("rejects zero amounts and expired requests", () => {
    const base = {
      origin: "https://convey.example",
      participant: "Ana",
      amountMicro: "0",
      asset: "USDC" as const,
      note: "Dinner",
      createdAt: 1000,
      expiresAt: 2000,
    };
    expect(() => createReceiptSplitShare(base)).toThrow(/greater than zero/i);
    expect(() => createReceiptSplitShare({ ...base, amountMicro: "1", expiresAt: 1000 })).toThrow(/after/i);
  });
});
