import { describe, expect, it } from "vitest";
import {
  decodeReceiptProofPayload,
  encodeReceiptProofPayload,
  type ReceiptProofDocument,
  verifyReceiptProof,
} from "@/lib/commerce/receipt-proof";

const merchant = `0x${"11".repeat(32)}`;
const realDigest = "4vQpX9GmY8KcT2dW7rHsN3aZ6jLfP5uE1bCxRkAq";

const demoProof: ReceiptProofDocument = {
  mode: "demo",
  demo: true,
  digest: "DEMO-abcdef0123456789",
  amountMist: "2500000000",
  merchantAddress: merchant,
  explorerUrl: null,
  label: "DEMO simulation — no on-chain settlement",
  exportedAt: "2026-08-30T00:00:00.000Z",
};

describe("receipt proof verification", () => {
  it("accepts a canonical demo receipt as structure-only evidence", () => {
    const result = verifyReceiptProof(JSON.stringify(demoProof));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("demo_structure");
    expect(result.receipt.demo).toBe(true);
    expect(result.claim).toMatch(/no chain query/i);
  });

  it("accepts a consistent real testnet export without claiming it was queried", () => {
    const proof = {
      ...demoProof,
      mode: "real",
      demo: false,
      digest: realDigest,
      explorerUrl: `https://suiscan.testnet.sui.io/tx/${realDigest}`,
      label: "Real testnet transfer",
    };
    const result = verifyReceiptProof(proof);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("real_testnet_structure");
    expect(result.claim).toMatch(/not queried/i);
  });

  it.each([
    [{ ...demoProof, amountMist: "2.5" }, /amount/i],
    [{ ...demoProof, merchantAddress: merchant.toUpperCase() }, /canonical/i],
    [{ ...demoProof, demo: false }, /mode/i],
    [{ ...demoProof, explorerUrl: "https://example.com/fake" }, /explorer/i],
    [{ ...demoProof, unexpected: "field" }, /unrecognized|unexpected/i],
  ])("rejects inconsistent or non-canonical proof %#", (proof, expected) => {
    const result = verifyReceiptProof(proof);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(expected);
  });

  it("rejects a real receipt whose explorer URL does not match its digest", () => {
    const result = verifyReceiptProof({
      ...demoProof,
      mode: "real",
      demo: false,
      digest: realDigest,
      explorerUrl: "https://suiscan.testnet.sui.io/tx/anotherDigest",
      label: "Real testnet transfer",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/explorer.*digest/i);
  });
});

describe("receipt proof URL payloads", () => {
  it("round-trips a proof as URL-safe data without storage", () => {
    const payload = encodeReceiptProofPayload(demoProof);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeReceiptProofPayload(payload)).toEqual(demoProof);
  });

  it("fails closed for malformed payloads", () => {
    expect(() => decodeReceiptProofPayload("not-a-proof")).toThrow(/payload/i);
  });
});
