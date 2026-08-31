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
  buildProtectedTransferCreatedReceipt,
  type ProtectedTransferCreatedReceiptDocument,
} from "@/lib/remittance/protected-transfer-created-receipt";
import type { ProtectedTransferTerminalVerifyResponse } from "@/lib/remittance/protected-transfer-terminal";
import {
  PROTECTED_TRANSFER_TERMINAL_RECEIPT_KIND,
  PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_BYTES,
  PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM,
  buildProtectedTransferTerminalReceipt,
  decodeProtectedTransferTerminalReceiptPayload,
  encodeProtectedTransferTerminalReceiptPayload,
  verifyProtectedTransferTerminalReceipt,
  type ProtectedTransferTerminalReceiptDocument,
} from "@/lib/remittance/protected-transfer-terminal-receipt";
import { buildExplorerUrl } from "@/lib/remittance/transfer";

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const CREATED_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const RELEASE_DIGEST = "EnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eZ";

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

function createdReceipt(): ProtectedTransferCreatedReceiptDocument {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  const verification: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
    kind: "verified",
    network: "testnet",
    digest: CREATED_DIGEST,
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
  return buildProtectedTransferCreatedReceipt({
    verification,
    plan: executionPlan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
}

function terminalResponse(
  overrides: Partial<Extract<ProtectedTransferTerminalVerifyResponse, { kind: "verified" }>> = {},
): Extract<ProtectedTransferTerminalVerifyResponse, { kind: "verified" }> {
  const cr = createdReceipt();
  return {
    kind: "verified",
    network: "testnet",
    action: "release",
    digest: RELEASE_DIGEST,
    escrowObjectId: cr.transfer.escrowObjectId,
    actorAddress: REVIEWER,
    payerAddress: cr.transfer.payerAddress,
    beneficiaryAddress: cr.transfer.beneficiaryAddress,
    reviewerAddress: cr.transfer.reviewerAddress,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: cr.transfer.amountMicro,
    deadlineMs: cr.transfer.deadlineMs,
    evidenceCommitmentHex: cr.transfer.evidenceCommitmentHex,
    checkedAt: new Date(NOW + 90_000).toISOString(),
    ...overrides,
  };
}

function receipt(): ProtectedTransferTerminalReceiptDocument {
  return buildProtectedTransferTerminalReceipt({
    createdReceipt: createdReceipt(),
    terminal: terminalResponse(),
    exportedAt: new Date(NOW + 120_000).toISOString(),
  });
}

describe("buildProtectedTransferTerminalReceipt", () => {
  it("produces a strict terminal receipt bound to Created and terminal response", () => {
    const doc = receipt();
    expect(doc.kind).toBe(PROTECTED_TRANSFER_TERMINAL_RECEIPT_KIND);
    expect(doc.version).toBe(1);
    expect(doc.transfer.action).toBe("release");
    expect(doc.transfer.digest).toBe(RELEASE_DIGEST);
    expect(doc.transfer.explorerUrl).toBe(buildExplorerUrl(RELEASE_DIGEST));
    expect(doc.transfer.actorAddress).toBe(REVIEWER);
    expect(doc.transfer.terminalCheckedAt).toBe(doc.terminal.checkedAt);
  });

  it.each([
    ["escrowObjectId", terminalResponse({ escrowObjectId: "0x" + "66".repeat(32) })],
    ["payerAddress", terminalResponse({ payerAddress: BENEFICIARY })],
    ["beneficiaryAddress", terminalResponse({ beneficiaryAddress: PAYER })],
    ["reviewerAddress", terminalResponse({ reviewerAddress: BENEFICIARY })],
    ["amountMicro", terminalResponse({ amountMicro: "108999999" })],
    ["deadlineMs", terminalResponse({ deadlineMs: receipt().transfer.deadlineMs + 1 })],
    ["evidenceCommitmentHex", terminalResponse({ evidenceCommitmentHex: "0x" + "cd".repeat(32) })],
  ] as const)("rejects a terminal/Created %s mismatch", (_label, terminal) => {
    expect(() =>
      buildProtectedTransferTerminalReceipt({
        createdReceipt: createdReceipt(),
        terminal,
        exportedAt: new Date(NOW + 120_000).toISOString(),
      }),
    ).toThrow();
  });

  it("rejects a release terminal response whose actor is not the reviewer", () => {
    const bad = terminalResponse({ actorAddress: PAYER });
    expect(() =>
      buildProtectedTransferTerminalReceipt({
        createdReceipt: createdReceipt(),
        terminal: bad,
        exportedAt: new Date(NOW + 120_000).toISOString(),
      }),
    ).toThrow(/actor/i);
  });

  it("rejects an exportedAt preceding the terminal check", () => {
    expect(() =>
      buildProtectedTransferTerminalReceipt({
        createdReceipt: createdReceipt(),
        terminal: terminalResponse(),
        exportedAt: new Date(NOW - 1).toISOString(),
      }),
    ).toThrow(/exportedAt|precede/i);
  });

  it("rejects a terminal check preceding the Created check", () => {
    const early = terminalResponse({ checkedAt: new Date(NOW - 100_000).toISOString() });
    expect(() =>
      buildProtectedTransferTerminalReceipt({
        createdReceipt: createdReceipt(),
        terminal: early,
        exportedAt: new Date(NOW + 120_000).toISOString(),
      }),
    ).toThrow(/precede/i);
  });
});

describe("verifyProtectedTransferTerminalReceipt", () => {
  it("verifies a carried receipt and reports a non-durable claim", () => {
    const doc = receipt();
    const result = verifyProtectedTransferTerminalReceipt(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("protected_transfer_terminal");
      expect(result.document.transfer.digest).toBe(RELEASE_DIGEST);
      expect(result.claim).toMatch(/not repeated/i);
    }
  });

  it("rejects a tampered action", () => {
    const doc = receipt();
    const tampered = { ...doc, transfer: { ...doc.transfer, action: "refund" as const } };
    const result = verifyProtectedTransferTerminalReceipt(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /action/i.test(e))).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = verifyProtectedTransferTerminalReceipt("{not json");
    expect(result.ok).toBe(false);
  });

  it("rejects an oversized string", () => {
    const result = verifyProtectedTransferTerminalReceipt("x".repeat(PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /too large/i.test(e))).toBe(true);
  });
});

describe("terminal receipt payload roundtrip", () => {
  it("encodes and decodes URL-safe base64url roundtrip", () => {
    const doc = receipt();
    const payload = encodeProtectedTransferTerminalReceiptPayload(doc);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain("+");
    expect(payload).not.toContain("/");
    expect(payload).not.toContain("=");
    const decoded = decodeProtectedTransferTerminalReceiptPayload(payload);
    expect(decoded).toEqual(doc);
  });

  it("uses query param t", () => {
    expect(PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM).toBe("t");
  });

  it("rejects a malformed payload", () => {
    expect(() => decodeProtectedTransferTerminalReceiptPayload("not!base64url!")).toThrow();
  });

  it("rejects an oversized payload", () => {
    const huge = "A".repeat(30_000);
    expect(() => decodeProtectedTransferTerminalReceiptPayload(huge)).toThrow();
  });
});
