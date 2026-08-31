import { describe, expect, it, vi } from "vitest";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import {
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  buildProtectedTransfer,
  type ProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import type {
  ProtectedTransferCreatedVerifyRequest,
  ProtectedTransferCreatedVerifyResponse,
} from "@/lib/remittance/protected-transfer-created";
import {
  buildProtectedTransferCreatedReceipt,
  type ProtectedTransferCreatedReceiptDocument,
} from "@/lib/remittance/protected-transfer-created-receipt";
import type {
  ProtectedTransferOpenRequest,
  ProtectedTransferOpenResponse,
} from "@/lib/remittance/protected-transfer-open";
import type {
  ProtectedTransferTerminalVerifyRequest,
  ProtectedTransferTerminalVerifyResponse,
} from "@/lib/remittance/protected-transfer-terminal";
import {
  buildProtectedTransferTerminalReceipt,
  encodeProtectedTransferTerminalReceiptPayload,
} from "@/lib/remittance/protected-transfer-terminal-receipt";
import { resolveProtectedTransferTerminalLifecycle } from "@/lib/remittance/protected-transfer-terminal-lifecycle";

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const CREATED_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const RELEASE_DIGEST = "EnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eZ";
const CREATED_ENDPOINT = "http://localhost/api/created/verify";
const TERMINAL_ENDPOINT = "http://localhost/api/terminal/verify";
const OPEN_ENDPOINT = "http://localhost/api/terminal/open";

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

function openResponse(
  overrides: Partial<Extract<ProtectedTransferOpenResponse, { kind: "open" }>> = {},
): Extract<ProtectedTransferOpenResponse, { kind: "open" }> {
  const cr = createdReceipt();
  return {
    kind: "open",
    network: "testnet",
    escrowObjectId: cr.transfer.escrowObjectId,
    packageId: cr.transfer.packageId,
    payerAddress: cr.transfer.payerAddress,
    beneficiaryAddress: cr.transfer.beneficiaryAddress,
    reviewerAddress: cr.transfer.reviewerAddress,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: cr.transfer.amountMicro,
    deadlineMs: cr.transfer.deadlineMs,
    evidenceCommitmentHex: cr.transfer.evidenceCommitmentHex,
    heldBalanceMicro: cr.transfer.amountMicro,
    checkedAt: new Date(NOW + 90_000).toISOString(),
    ...overrides,
  };
}

function payload(): string {
  const doc = buildProtectedTransferTerminalReceipt({
    createdReceipt: createdReceipt(),
    terminal: terminalResponse(),
    exportedAt: new Date(NOW + 120_000).toISOString(),
  });
  return encodeProtectedTransferTerminalReceiptPayload(doc);
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a fetchImpl that routes by endpoint URL and returns canned responses.
 * The `created` and `terminal` factories receive the parsed request body so
 * tests can assert routing or mutate the response.
 */
function fetchImpl(
  created: (req: ProtectedTransferCreatedVerifyRequest) => ProtectedTransferCreatedVerifyResponse,
  terminal: (req: ProtectedTransferTerminalVerifyRequest) => ProtectedTransferTerminalVerifyResponse,
  open?: (req: ProtectedTransferOpenRequest) => ProtectedTransferOpenResponse,
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as never) : ({} as never);
    if (url === CREATED_ENDPOINT) return jsonResponse(created(body));
    if (url === TERMINAL_ENDPOINT) return jsonResponse(terminal(body));
    if (url === OPEN_ENDPOINT && open) return jsonResponse(open(body));
    throw new Error(`unexpected endpoint ${url}`);
  }) as unknown as typeof fetch;
}

describe("resolveProtectedTransferTerminalLifecycle", () => {
  it("returns verified when both fresh checks verify and bind to the receipt", async () => {
    const cr = createdReceipt();
    const tr = terminalResponse();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => tr,
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(result.created.digest).toBe(CREATED_DIGEST);
      expect(result.terminal.digest).toBe(RELEASE_DIGEST);
      expect(result.receipt.transfer.digest).toBe(RELEASE_DIGEST);
    }
  });

  it("does not return pending when terminal is not_found but the exact escrow is not verified open", async () => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        () => ({ kind: "terminal_unknown", reason: "object_absent" }),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
      openEndpoint: OPEN_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "not_open" });
  });

  it("returns pending only when Created binds, terminal is not_found, and the exact escrow is verified open", async () => {
    const cr = createdReceipt();
    const open = openResponse();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        (request) => {
          expect(request).toEqual({
            escrowObjectId: cr.transfer.escrowObjectId,
            packageId: cr.transfer.packageId,
            payerAddress: cr.transfer.payerAddress,
            beneficiaryAddress: cr.transfer.beneficiaryAddress,
            reviewerAddress: cr.transfer.reviewerAddress,
            amountMicro: cr.transfer.amountMicro,
            deadlineMs: cr.transfer.deadlineMs,
            evidenceCommitmentHex: cr.transfer.evidenceCommitmentHex,
          });
          return open;
        },
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
      openEndpoint: OPEN_ENDPOINT,
    });
    expect(result).toEqual({ kind: "pending", created: cr.created, open });
  });

  it("returns unavailable when the open-state response is malformed", async () => {
    const cr = createdReceipt();
    const malformedOpen = { ...openResponse(), heldBalanceMicro: "0" };
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        () => malformedOpen as never,
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
      openEndpoint: OPEN_ENDPOINT,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("returns unavailable when the open-state check is unavailable", async () => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        () => ({ kind: "unavailable", reason: "rpc_unavailable" }),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
      openEndpoint: OPEN_ENDPOINT,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("returns rejected open_rejected when the open-state check rejects", async () => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        () => ({ kind: "rejected", reason: "balance" }),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
      openEndpoint: OPEN_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "open_rejected" });
  });

  it.each([
    ["escrow object", { escrowObjectId: "0x" + "66".repeat(32) }],
    ["package", { packageId: "0x" + "66".repeat(32) }],
    ["payer", { payerAddress: "0x" + "66".repeat(32) }],
    ["beneficiary", { beneficiaryAddress: "0x" + "66".repeat(32) }],
    ["reviewer", { reviewerAddress: "0x" + "66".repeat(32) }],
    ["amount", { amountMicro: "108999999" }],
    ["deadline", { deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 1 }],
    ["evidence", { evidenceCommitmentHex: "0x" + "66".repeat(32) }],
    ["held balance", { heldBalanceMicro: "108999999" }],
  ] as const)("rejects an open response with mismatched %s binding", async (_field, overrides) => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        () => openResponse(overrides),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
      openEndpoint: OPEN_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "mismatch" });
  });

  it("returns rejected invalid_receipt for a malformed payload", async () => {
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: "not!base64url!",
      fetchImpl: fetchImpl(() => createdReceipt().created, () => terminalResponse()),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "invalid_receipt" });
  });

  it("returns rejected invalid_receipt for an empty payload", async () => {
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: "",
      fetchImpl: fetchImpl(() => createdReceipt().created, () => terminalResponse()),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "invalid_receipt" });
  });

  it("returns rejected created_rejected when the Created check rejects", async () => {
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => ({ kind: "rejected", reason: "amount" }),
        () => terminalResponse(),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "created_rejected" });
  });

  it("returns rejected created_rejected when the Created digest is not found", async () => {
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
        () => terminalResponse(),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "created_rejected" });
  });

  it("returns rejected terminal_rejected when the terminal check rejects", async () => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "rejected", reason: "sender" }),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "terminal_rejected" });
  });

  it("returns rejected mismatch when the fresh Created response does not bind to the receipt", async () => {
    const cr = createdReceipt();
    const tamperedCreated: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
      ...cr.created,
      amountMicro: "108999999",
    };
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(() => tamperedCreated, () => terminalResponse()),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "mismatch" });
  });

  it("returns rejected mismatch when the fresh terminal response does not bind to the receipt", async () => {
    const cr = createdReceipt();
    const tamperedTerminal = terminalResponse({ actorAddress: PAYER });
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(() => cr.created, () => tamperedTerminal),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "rejected", reason: "mismatch" });
  });

  it("returns unavailable when the Created check returns unavailable", async () => {
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => ({ kind: "unavailable", reason: "rpc_unavailable" }),
        () => terminalResponse(),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("returns unavailable when the terminal check returns unavailable", async () => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "unavailable", reason: "rpc_unavailable" }),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("returns unavailable when fetch throws", async () => {
    const failing = vi.fn(async () => new Response("<html>", { status: 500 }));
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: failing,
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("never claims open/current from terminal not_found without a fresh exact open read", async () => {
    const cr = createdReceipt();
    const result = await resolveProtectedTransferTerminalLifecycle({
      payload: payload(),
      fetchImpl: fetchImpl(
        () => cr.created,
        () => ({ kind: "not_found", reason: "transaction_not_found" }),
      ),
      createdEndpoint: CREATED_ENDPOINT,
      terminalEndpoint: TERMINAL_ENDPOINT,
    });
    expect(result).toEqual({ kind: "unavailable" });
  });
});
