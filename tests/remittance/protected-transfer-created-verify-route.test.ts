import { bcs as suiBcs } from "@mysten/sui/bcs";
import { TransactionError, type SuiClientTypes } from "@mysten/sui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/remittance/protected-transfer/created/verify/route";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  __setProtectedTransferCreatedReaderFactoryForTest,
  PROTECTED_TRANSFER_CREATED_TIMEOUT_MS,
  type ProtectedTransferCreatedReader,
} from "@/lib/remittance/protected-transfer-created.server";

const PACKAGE = "0x" + "44".repeat(32);
const PAYER = "0x" + "11".repeat(32);
const BENEFICIARY = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const COMMITMENT = "0x" + "ab".repeat(32);
const DEADLINE = 1_700_086_400_000;

const Created = suiBcs.struct("Created", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});
const getTransaction = vi.fn<ProtectedTransferCreatedReader["getTransaction"]>();

function requestBody(value: unknown): Request {
  return new Request("http://localhost/api/remittance/protected-transfer/created/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    digest: DIGEST,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    amountMicro: "109000000",
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  };
}

function success(): SuiClientTypes.TransactionResult<{ events: true }> {
  return {
    $kind: "Transaction",
    Transaction: {
      digest: DIGEST,
      signatures: [],
      epoch: null,
      status: { success: true, error: null },
      events: [
        {
          packageId: PACKAGE,
          module: "protected_transfer",
          sender: PAYER,
          eventType: `${PACKAGE}::protected_transfer::Created<${USDC_COIN_TYPE_TESTNET}>`,
          bcs: Created.serialize({
            id: ESCROW,
            payer: PAYER,
            beneficiary: BENEFICIARY,
            reviewer: REVIEWER,
            amount: "109000000",
            deadline: DEADLINE.toString(),
            evidence_commitment: Array(32).fill(0xab),
          }).toBytes(),
          json: null,
        },
      ],
      balanceChanges: undefined,
      effects: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };
}

beforeEach(() => {
  getTransaction.mockReset();
  __setProtectedTransferCreatedReaderFactoryForTest(() => ({ getTransaction }));
  vi.stubEnv("PROTECTED_TRANSFER_PACKAGE_ID", PACKAGE);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_ADDRESS", REVIEWER);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "Convey Review Desk");
});

afterEach(() => {
  __setProtectedTransferCreatedReaderFactoryForTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST Protected Transfer Created verification", () => {
  it.each([
    ["malformed JSON", "{"],
    ["extra field", request({ rpcUrl: "https://evil.invalid" })],
    ["wrong digest", request({ digest: "not-a-digest" })],
    ["noncanonical payer", request({ payerAddress: "0x11" })],
    ["oversized body", "x".repeat(4097)],
  ])("rejects %s before RPC", async (_label, body) => {
    const response = await POST(requestBody(body));
    expect(await response.json()).toEqual({ kind: "rejected", reason: "invalid_request" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("returns independently verified Created evidence and named reviewer metadata", async () => {
    getTransaction.mockResolvedValue(success());

    const response = await POST(requestBody(request()));
    const body = await response.json();

    expect(body).toEqual({
      kind: "verified",
      network: "testnet",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewer: { name: "Convey Review Desk", address: REVIEWER },
      coinType: USDC_COIN_TYPE_TESTNET,
      amountMicro: "109000000",
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
      checkedAt: expect.any(String),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).toHaveBeenCalledOnce();
    expect(getTransaction).toHaveBeenCalledWith({
      digest: DIGEST,
      include: { events: true },
      signal: expect.any(AbortSignal),
    });
  });

  it("fails closed before RPC when any server trust root is absent", async () => {
    vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "");
    const response = await POST(requestBody(request()));
    expect(await response.json()).toEqual({ kind: "rejected", reason: "not_configured" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("preserves a bounded 80-code-point reviewer identity", async () => {
    const reviewerName = "👩".repeat(80);
    vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", reviewerName);
    getTransaction.mockResolvedValue(success());
    const response = await POST(requestBody(request()));
    expect((await response.json()).reviewer).toEqual({ name: reviewerName, address: REVIEWER });
  });

  it("passes through a safe event mismatch without a second lookup", async () => {
    getTransaction.mockResolvedValue(success());
    const response = await POST(requestBody(request({ amountMicro: "108999999" })));
    expect(await response.json()).toEqual({ kind: "rejected", reason: "amount" });
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it("maps typed not-found separately", async () => {
    getTransaction.mockRejectedValue(new TransactionError("notFound", DIGEST));
    const response = await POST(requestBody(request()));
    expect(await response.json()).toEqual({
      kind: "not_found",
      reason: "transaction_not_found",
    });
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it("bounds one hanging RPC read and never leaks provider details", async () => {
    vi.useFakeTimers();
    getTransaction.mockImplementation(({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new Error("https://private-rpc.invalid sk-secret")),
        );
      }),
    );
    const pending = POST(requestBody(request()));
    await vi.advanceTimersByTimeAsync(PROTECTED_TRANSFER_CREATED_TIMEOUT_MS);
    const response = await pending;
    const body = await response.json();
    expect(body).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/private-rpc|secret|https?:/i);
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it("maps an arbitrary provider failure to the same secret-free union arm", async () => {
    getTransaction.mockRejectedValue(new Error("RPC https://secret.invalid token=abc"));
    const response = await POST(requestBody(request()));
    const body = await response.json();
    expect(body).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/secret|token|https?:/i);
    expect(getTransaction).toHaveBeenCalledOnce();
  });
});
