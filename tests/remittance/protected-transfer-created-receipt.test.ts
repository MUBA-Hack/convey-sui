import { describe, expect, it } from "vitest";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import {
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  buildProtectedTransfer,
  type ProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import type { ProtectedTransferCreatedVerifyResponse } from "@/lib/remittance/protected-transfer-created";
import {
  PROTECTED_TRANSFER_CREATED_RECEIPT_KIND,
  PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_BYTES,
  PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_PAYLOAD_LENGTH,
  PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM,
  buildProtectedTransferCreatedReceipt,
  decodeProtectedTransferCreatedReceiptPayload,
  encodeProtectedTransferCreatedReceiptPayload,
  verifyProtectedTransferCreatedReceipt,
  type ProtectedTransferCreatedReceiptDocument,
} from "@/lib/remittance/protected-transfer-created-receipt";
import { sniffProofKind } from "@/lib/remittance/receipt-proof";
import { buildExplorerUrl } from "@/lib/remittance/transfer";

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

function authorization(): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: BENEFICIARY,
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
  };
}

function plan(): ProtectedTransferExecutionPlan {
  return {
    kind: "protected_transfer_execution_plan",
    authorization: authorization(),
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    reviewerName: "Convey Review",
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS,
    reviewNote: "Hold until Ana confirms delivery",
  };
}

function fixture() {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  const verification: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
    kind: "verified",
    network: "testnet",
    digest: DIGEST,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewer: { name: "Convey Review", address: REVIEWER },
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "109000000",
    deadlineMs: executionPlan.deadlineMs,
    evidenceCommitmentHex: metadata.commitmentHex,
    checkedAt: new Date(NOW + 30_000).toISOString(),
  };
  return { executionPlan, metadata, verification };
}

function receipt(): ProtectedTransferCreatedReceiptDocument {
  const { executionPlan, metadata, verification } = fixture();
  return buildProtectedTransferCreatedReceipt({
    verification,
    plan: executionPlan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
}

describe("Protected Transfer Created receipt", () => {
  it("builds judge-readable terms only from a verified Created response and bound plan metadata", () => {
    const document = receipt();
    const result = verifyProtectedTransferCreatedReceipt(document);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("protected_transfer_created");
    expect(result.claim).toMatch(/created event/i);
    expect(result.claim).toMatch(/carried verification response/i);
    expect(result.claim).not.toMatch(/released|refunded|paid out/i);
    expect(document.kind).toBe(PROTECTED_TRANSFER_CREATED_RECEIPT_KIND);
    expect(document.transfer).toEqual({
      digest: DIGEST,
      explorerUrl: buildExplorerUrl(DIGEST),
      escrowObjectId: ESCROW,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      recipient: "Ana",
      reviewerName: "Convey Review",
      reviewerAddress: REVIEWER,
      packageId: PACKAGE,
      coinType: USDC_COIN_TYPE_TESTNET,
      amountMicro: "109000000",
      deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS,
      evidenceCommitmentHex: fixture().metadata.commitmentHex,
      reviewNote: "Hold until Ana confirms delivery",
      createdCheckedAt: new Date(NOW + 30_000).toISOString(),
    });
  });

  it.each([
    ["digest", { digest: "5N2mQ8vDYu7gCHjJHML1RPNqS5tpUka3JzG5E3u7e2JB" }],
    ["escrowObjectId", { escrowObjectId: "0x" + "66".repeat(32) }],
    ["payerAddress", { payerAddress: "0x" + "66".repeat(32) }],
    ["beneficiaryAddress", { beneficiaryAddress: "0x" + "66".repeat(32) }],
    ["reviewerName", { reviewerName: "Another reviewer" }],
    ["reviewerAddress", { reviewerAddress: "0x" + "66".repeat(32) }],
    ["coinType", { coinType: `${PACKAGE}::fake::COIN` }],
    ["amountMicro", { amountMicro: "1" }],
    ["deadlineMs", { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 1 }],
    ["evidenceCommitmentHex", { evidenceCommitmentHex: "0x" + "ab".repeat(32) }],
    ["createdCheckedAt", { createdCheckedAt: new Date(NOW + 31_000).toISOString() }],
  ])("rejects a %s mismatch against the independently checked Created response", (field, change) => {
    const base = receipt();
    const result = verifyProtectedTransferCreatedReceipt({
      ...base,
      transfer: { ...base.transfer, ...change },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(new RegExp(field, "i"));
  });

  it("rejects a non-canonical explorer URL and export before the Created check", () => {
    const base = receipt();
    const wrongExplorer = verifyProtectedTransferCreatedReceipt({
      ...base,
      transfer: { ...base.transfer, explorerUrl: "https://example.com/tx" },
    });
    expect(wrongExplorer.ok).toBe(false);
    if (!wrongExplorer.ok) expect(wrongExplorer.errors.join(" ")).toMatch(/explorer/i);

    const earlyExport = verifyProtectedTransferCreatedReceipt({
      ...base,
      exportedAt: new Date(NOW).toISOString(),
    });
    expect(earlyExport.ok).toBe(false);
    if (!earlyExport.ok) expect(earlyExport.errors.join(" ")).toMatch(/exportedAt/i);
  });

  it("rejects plan/metadata mismatches before producing a receipt", () => {
    const { executionPlan, metadata, verification } = fixture();
    expect(() =>
      buildProtectedTransferCreatedReceipt({
        verification,
        plan: { ...executionPlan, reviewNote: "Changed note" },
        metadata,
      }),
    ).toThrow(/review note/i);
    expect(() =>
      buildProtectedTransferCreatedReceipt({
        verification,
        plan: executionPlan,
        metadata: { ...metadata, commitmentHex: "0x" + "ab".repeat(32) },
      }),
    ).toThrow(/commitment/i);
  });

  it.each([
    ["package", (base: ProtectedTransferCreatedReceiptDocument) => ({
      ...base,
      plan: { ...base.plan, packageId: "0x" + "66".repeat(32) },
    })],
    ["recipient", (base: ProtectedTransferCreatedReceiptDocument) => ({
      ...base,
      plan: {
        ...base.plan,
        authorization: { ...base.plan.authorization, recipient: "Mara" },
      },
    })],
    ["review note", (base: ProtectedTransferCreatedReceiptDocument) => ({
      ...base,
      plan: { ...base.plan, reviewNote: "Different terms" },
    })],
  ])("rejects reopened proof when its strict %s plan binding is changed", (_label, mutate) => {
    const result = verifyProtectedTransferCreatedReceipt(mutate(receipt()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/plan|commitment|transfer/i);
  });

  it("strictly rejects unexpected document and nested fields", () => {
    const base = receipt();
    const top = verifyProtectedTransferCreatedReceipt({ ...base, extra: true });
    expect(top.ok).toBe(false);
    const nested = verifyProtectedTransferCreatedReceipt({
      ...base,
      transfer: { ...base.transfer, extra: true },
    });
    expect(nested.ok).toBe(false);
  });

  it("round-trips through a bounded URL-safe payload for /proof", () => {
    const document = receipt();
    const payload = encodeProtectedTransferCreatedReceiptPayload(document);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_PAYLOAD_LENGTH);
    expect(decodeProtectedTransferCreatedReceiptPayload(payload)).toEqual(document);
    expect(PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM).toBe("c");
  });

  it("fails closed for malformed and oversized URL payloads", () => {
    expect(() => decodeProtectedTransferCreatedReceiptPayload("not-a-receipt")).toThrow(/payload/i);
    expect(() =>
      decodeProtectedTransferCreatedReceiptPayload(
        "A".repeat(PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_PAYLOAD_LENGTH + 1),
      ),
    ).toThrow(/too large|payload/i);

    const hugeJson = JSON.stringify({ value: "x".repeat(PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_BYTES) });
    const hugePayload = Buffer.from(hugeJson).toString("base64url");
    expect(() => decodeProtectedTransferCreatedReceiptPayload(hugePayload)).toThrow(/too large|payload/i);
  });

  it("extends proof kind sniffing without weakening existing kinds", () => {
    expect(sniffProofKind(JSON.stringify(receipt()))).toBe("protected-transfer-created-receipt");
    expect(sniffProofKind(JSON.stringify({ kind: "convey.remittance-receipt" }))).toBe("remittance-receipt");
    expect(sniffProofKind(JSON.stringify({ mode: "demo", digest: "x" }))).toBe("commerce");
  });
});

describe("Protected Transfer Created receipt — optional custody manifest digest", () => {
  const CUSTODY_DIGEST = "0x" + "aa".repeat(32);

  function planWithDigest(): ProtectedTransferExecutionPlan {
    return { ...plan(), custodyManifestDigest: CUSTODY_DIGEST };
  }

  function fixtureWithDigest() {
    const executionPlan = planWithDigest();
    const metadata = buildProtectedTransfer({
      plan: executionPlan,
      sender: PAYER,
      nowMs: NOW,
    }).metadata;
    const verification: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
      kind: "verified",
      network: "testnet",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewer: { name: "Convey Review", address: REVIEWER },
      coinType: USDC_COIN_TYPE_TESTNET,
      amountMicro: "109000000",
      deadlineMs: executionPlan.deadlineMs,
      evidenceCommitmentHex: metadata.commitmentHex,
      checkedAt: new Date(NOW + 30_000).toISOString(),
    };
    return { executionPlan, metadata, verification };
  }

  function receiptWithDigest(): ProtectedTransferCreatedReceiptDocument {
    const { executionPlan, metadata, verification } = fixtureWithDigest();
    return buildProtectedTransferCreatedReceipt({
      verification,
      plan: executionPlan,
      metadata,
      exportedAt: new Date(NOW + 60_000).toISOString(),
    });
  }

  it("carries the optional digest in transfer terms and round-trips through a payload", () => {
    const document = receiptWithDigest();
    expect(document.transfer.custodyManifestDigest).toBe(CUSTODY_DIGEST);
    expect(document.plan.custodyManifestDigest).toBe(CUSTODY_DIGEST);
    const payload = encodeProtectedTransferCreatedReceiptPayload(document);
    expect(decodeProtectedTransferCreatedReceiptPayload(payload)).toEqual(document);
  });

  it("rejects a transfer digest that does not match the plan digest", () => {
    const base = receiptWithDigest();
    const tampered = verifyProtectedTransferCreatedReceipt({
      ...base,
      transfer: {
        ...base.transfer,
        custodyManifestDigest: "0x" + "bb".repeat(32),
      },
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.errors.join(" ")).toMatch(/custodyManifestDigest/i);
    }
  });

  it("rejects a plan digest change through the commitment rebuild", () => {
    const base = receiptWithDigest();
    const tampered = verifyProtectedTransferCreatedReceipt({
      ...base,
      plan: { ...base.plan, custodyManifestDigest: "0x" + "bb".repeat(32) },
    });
    expect(tampered.ok).toBe(false);
  });

  it("omits custodyManifestDigest when the plan omits it", () => {
    const document = receipt();
    expect(document.transfer).not.toHaveProperty("custodyManifestDigest");
    expect(document.plan).not.toHaveProperty("custodyManifestDigest");
  });
});
