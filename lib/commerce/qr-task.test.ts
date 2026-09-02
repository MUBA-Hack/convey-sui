import { describe, expect, it } from "vitest";
import { parseQrTaskEnvelope } from "./qr-task";

const valid = {
  kind: "convey.qr-task",
  version: 1,
  task: "split",
  createdAt: "2026-09-03T12:00:00.000Z",
  reviewRequired: true,
  recipient: "Maya",
  amount: "12.43",
  asset: "USDC",
  note: "Dinner",
  expiresAt: "2026-09-10T12:00:00.000Z",
};

describe("QR task envelope", () => {
  it("accepts a personal split request", () => {
    expect(parseQrTaskEnvelope(JSON.stringify(valid))).toMatchObject({ task: "split", recipient: "Maya", amount: "12.43" });
  });

  it("rejects unknown fields and missing review requirement", () => {
    expect(parseQrTaskEnvelope(JSON.stringify({ ...valid, reviewRequired: false }))).toBeNull();
    expect(parseQrTaskEnvelope(JSON.stringify({ ...valid, secret: "unexpected" }))).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseQrTaskEnvelope("not-json")).toBeNull();
  });
});
