import { bcs as suiBcs } from "@mysten/sui/bcs";
import { ObjectError, TransactionError, type SuiClientTypes } from "@mysten/sui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as POSTVerify } from "@/app/api/remittance/protected-transfer/terminal/verify/route";
import { POST as POSTOpen } from "@/app/api/remittance/protected-transfer/terminal/open/route";
import { createRateConcurrencyGate } from "@/lib/http/rate-concurrency-gate.server";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  __setProtectedTransferTerminalReaderFactoryForTest,
  __setProtectedTransferOpenReaderFactoryForTest,
  PROTECTED_TRANSFER_TERMINAL_TIMEOUT_MS,
  type ProtectedTransferTerminalReader,
  type ProtectedTransferOpenReader,
} from "@/lib/remittance/protected-transfer-terminal.server";
import {
  __setProtectedTransferTerminalGateForTest,
} from "@/lib/remittance/protected-transfer-terminal-gate.server";

const PACKAGE = "0x" + "44".repeat(32);
const PAYER = "0x" + "11".repeat(32);
const BENEFICIARY = "0x" + "22".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const COMMITMENT = "0x" + "ab".repeat(32);
const DEADLINE = 1_700_086_400_000;
const AMOUNT = "109000000";

const TerminalEvent = suiBcs.struct("TerminalEvent", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});

const UidBcs = suiBcs.struct("UID", { id: suiBcs.Address });
const BalanceBcs = suiBcs.struct("Balance", { value: suiBcs.u64() });
const ProtectedTransferBcs = suiBcs.struct("ProtectedTransfer", {
  id: UidBcs,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
  deadline: suiBcs.u64(),
  balance: BalanceBcs,
});

const getTransaction = vi.fn<ProtectedTransferTerminalReader["getTransaction"]>();
const getObject = vi.fn<ProtectedTransferOpenReader["getObject"]>();

function verifyRequest(overrides: Record<string, unknown> = {}) {
  return {
    action: "release",
    digest: DIGEST,
    packageId: PACKAGE,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    amountMicro: AMOUNT,
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  };
}

function openRequest(overrides: Record<string, unknown> = {}) {
  return {
    escrowObjectId: ESCROW,
    packageId: PACKAGE,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    amountMicro: AMOUNT,
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: COMMITMENT,
    ...overrides,
  };
}

function body(value: unknown, url: string): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function bodyWithContentType(
  value: unknown,
  url: string,
  contentType: string | null,
): Request {
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers,
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

/** Deterministic clock for the shared gate. Advanced manually in tests. */
let gateNow = 0;
function makeFreshGate() {
  gateNow = 1_000;
  return createRateConcurrencyGate({
    maxConcurrent: 2,
    maxRequestsPerWindow: 3,
    windowMs: 1_000,
    nowMs: () => gateNow,
  });
}

function terminalSuccessEvent(sender: string, eventType: string): SuiClientTypes.Event {
  return {
    packageId: PACKAGE,
    module: "protected_transfer",
    sender,
    eventType,
    bcs: TerminalEvent.serialize({
      id: ESCROW,
      payer: PAYER,
      beneficiary: BENEFICIARY,
      reviewer: REVIEWER,
      amount: AMOUNT,
      deadline: DEADLINE.toString(),
      evidence_commitment: Array(32).fill(0xab),
    }).toBytes(),
    json: null,
  };
}

function terminalResult(events: SuiClientTypes.Event[]): SuiClientTypes.TransactionResult<{ events: true }> {
  return {
    $kind: "Transaction",
    Transaction: {
      digest: DIGEST,
      signatures: [],
      epoch: null,
      status: { success: true, error: null },
      events,
      balanceChanges: undefined,
      effects: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };
}

function openObject(): SuiClientTypes.Object<{ content: true }> {
  return {
    objectId: ESCROW,
    version: "1",
    digest: "0x" + "0".repeat(32),
    owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } } as never,
    type: `${PACKAGE}::protected_transfer::ProtectedTransfer<${USDC_COIN_TYPE_TESTNET}>`,
    content: ProtectedTransferBcs.serialize({
      id: { id: ESCROW },
      payer: PAYER,
      beneficiary: BENEFICIARY,
      reviewer: REVIEWER,
      amount: AMOUNT,
      evidence_commitment: Array(32).fill(0xab),
      deadline: DEADLINE.toString(),
      balance: { value: AMOUNT },
    }).toBytes(),
    previousTransaction: undefined,
    objectBcs: undefined,
    json: undefined,
    display: undefined,
  };
}

beforeEach(() => {
  getTransaction.mockReset();
  getObject.mockReset();
  __setProtectedTransferTerminalReaderFactoryForTest(() => ({ getTransaction }));
  __setProtectedTransferOpenReaderFactoryForTest(() => ({ getObject }));
  __setProtectedTransferTerminalGateForTest(makeFreshGate());
  vi.stubEnv("PROTECTED_TRANSFER_PACKAGE_ID", PACKAGE);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_ADDRESS", REVIEWER);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "Convey Review Desk");
});

afterEach(() => {
  __setProtectedTransferTerminalReaderFactoryForTest(null);
  __setProtectedTransferOpenReaderFactoryForTest(null);
  __setProtectedTransferTerminalGateForTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST terminal/verify", () => {
  it.each([
    ["malformed JSON", "{"],
    ["extra field", verifyRequest({ rpcUrl: "https://evil.invalid" })],
    ["bad digest", verifyRequest({ digest: "nope" })],
    ["noncanonical payer", verifyRequest({ payerAddress: "0x11" })],
    ["oversized body", "x".repeat(4097)],
  ])("rejects %s before RPC", async (_label, payload) => {
    const res = await POSTVerify(body(payload, "/api/remittance/protected-transfer/terminal/verify"));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_request" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["text/plain", "text/plain"],
    ["application/x-www-form-urlencoded", "application/x-www-form-urlencoded"],
    ["missing", null],
    ["empty", ""],
    ["empty parameter", "application/json;"],
    ["unknown parameter", "application/json;foo=bar"],
    ["empty charset", "application/json;charset="],
    ["unsupported charset", "application/json;charset=iso-8859-1"],
    ["extra parameter", "application/json;charset=utf-8;foo=bar"],
    ["trailing junk", "application/json;charset=utf-8 junk"],
  ])("rejects %s content-type before RPC", async (_label, contentType) => {
    const res = await POSTVerify(
      bodyWithContentType(
        verifyRequest(),
        "/api/remittance/protected-transfer/terminal/verify",
        contentType,
      ),
    );
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_request" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("accepts application/json;charset=utf-8", async () => {
    getTransaction.mockResolvedValue(
      terminalResult([
        terminalSuccessEvent(
          REVIEWER,
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    );
    const res = await POSTVerify(
      bodyWithContentType(
        verifyRequest(),
        "/api/remittance/protected-transfer/terminal/verify",
        "application/json;charset=utf-8",
      ),
    );
    expect((await res.json()).kind).toBe("verified");
  });

  it("returns verified release evidence", async () => {
    getTransaction.mockResolvedValue(
      terminalResult([
        terminalSuccessEvent(
          REVIEWER,
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    );
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    const json = await res.json();
    expect(json).toEqual({
      kind: "verified",
      network: "testnet",
      action: "release",
      digest: DIGEST,
      escrowObjectId: ESCROW,
      actorAddress: REVIEWER,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      coinType: USDC_COIN_TYPE_TESTNET,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
      checkedAt: expect.any(String),
    });
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it("returns verified refund evidence", async () => {
    getTransaction.mockResolvedValue(
      terminalResult([
        terminalSuccessEvent(
          PAYER,
          `${PACKAGE}::protected_transfer::Refunded<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    );
    const res = await POSTVerify(body(verifyRequest({ action: "refund" }), "/api/remittance/protected-transfer/terminal/verify"));
    const json = await res.json();
    expect(json.kind).toBe("verified");
    expect(json.action).toBe("refund");
    expect(json.actorAddress).toBe(PAYER);
  });

  it("fails closed before RPC when config absent", async () => {
    vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "");
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "not_configured" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when request packageId != configured packageId", async () => {
    const res = await POSTVerify(body(verifyRequest({ packageId: "0x" + "99".repeat(32) }), "/api/remittance/protected-transfer/terminal/verify"));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "not_configured" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("maps typed not-found", async () => {
    getTransaction.mockRejectedValue(new TransactionError("notFound", DIGEST));
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect(await res.json()).toEqual({ kind: "not_found", reason: "transaction_not_found" });
  });

  it("bounds one hanging RPC read and never leaks provider details", async () => {
    vi.useFakeTimers();
    getTransaction.mockImplementation(({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("https://private-rpc.invalid sk-secret")));
      }),
    );
    const pending = POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    await vi.advanceTimersByTimeAsync(PROTECTED_TRANSFER_TERMINAL_TIMEOUT_MS);
    const res = await pending;
    const json = await res.json();
    expect(json).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(json)).not.toMatch(/private-rpc|secret|https?:/i);
  });

  it("maps an arbitrary provider failure to unavailable without leaking", async () => {
    getTransaction.mockRejectedValue(new Error("RPC https://secret.invalid token=abc"));
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    const json = await res.json();
    expect(json).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(json)).not.toMatch(/secret|token|https?:/i);
  });

  it("passes through a safe event mismatch with one lookup", async () => {
    getTransaction.mockResolvedValue(
      terminalResult([
        terminalSuccessEvent(
          BENEFICIARY, // wrong actor
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    );
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "sender" });
    expect(getTransaction).toHaveBeenCalledOnce();
  });
});

describe("POST terminal/open", () => {
  it.each([
    ["malformed JSON", "{"],
    ["extra field", openRequest({ rpcUrl: "https://evil.invalid" })],
    ["noncanonical escrow", openRequest({ escrowObjectId: "0x55" })],
    ["oversized body", "x".repeat(4097)],
  ])("rejects %s before RPC", async (_label, payload) => {
    const res = await POSTOpen(body(payload, "/api/remittance/protected-transfer/terminal/open"));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_request" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getObject).not.toHaveBeenCalled();
  });

  it.each([
    ["text/plain", "text/plain"],
    ["missing", null],
    ["empty parameter", "application/json;"],
    ["unknown parameter", "application/json;foo=bar"],
    ["empty charset", "application/json;charset="],
    ["unsupported charset", "application/json;charset=iso-8859-1"],
    ["extra parameter", "application/json;charset=utf-8;foo=bar"],
    ["trailing junk", "application/json;charset=utf-8 junk"],
  ])("rejects %s content-type before RPC", async (_label, contentType) => {
    const res = await POSTOpen(
      bodyWithContentType(
        openRequest(),
        "/api/remittance/protected-transfer/terminal/open",
        contentType,
      ),
    );
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_request" });
    expect(getObject).not.toHaveBeenCalled();
  });

  it("returns open when exact shared object matches", async () => {
    getObject.mockResolvedValue({ object: openObject() } as never);
    const res = await POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    const json = await res.json();
    expect(json).toEqual({
      kind: "open",
      network: "testnet",
      escrowObjectId: ESCROW,
      packageId: PACKAGE,
      payerAddress: PAYER,
      beneficiaryAddress: BENEFICIARY,
      reviewerAddress: REVIEWER,
      coinType: USDC_COIN_TYPE_TESTNET,
      amountMicro: AMOUNT,
      deadlineMs: DEADLINE,
      evidenceCommitmentHex: COMMITMENT,
      heldBalanceMicro: AMOUNT,
      checkedAt: expect.any(String),
    });
    expect(getObject).toHaveBeenCalledOnce();
  });

  it("maps object not-found to terminal_unknown, never open", async () => {
    getObject.mockRejectedValue(new ObjectError("notFound", "object not found", { reason: "notFound", objectId: ESCROW }));
    const res = await POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    expect(await res.json()).toEqual({ kind: "terminal_unknown", reason: "object_absent" });
  });

  it("maps object deleted to terminal_unknown", async () => {
    getObject.mockRejectedValue(new ObjectError("deleted", "object deleted", { reason: "deleted", objectId: ESCROW }));
    const res = await POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    expect(await res.json()).toEqual({ kind: "terminal_unknown", reason: "object_absent" });
  });

  it("maps a field mismatch to rejected", async () => {
    const obj = openObject();
    const tampered = ProtectedTransferBcs.serialize({
      id: { id: ESCROW },
      payer: BENEFICIARY, // mismatch
      beneficiary: BENEFICIARY,
      reviewer: REVIEWER,
      amount: AMOUNT,
      evidence_commitment: Array(32).fill(0xab),
      deadline: DEADLINE.toString(),
      balance: { value: AMOUNT },
    }).toBytes();
    obj.content = tampered as Uint8Array<ArrayBuffer>;
    getObject.mockResolvedValue({ object: obj } as never);
    const res = await POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "payer" });
  });

  it("maps a provider failure to unavailable without leaking", async () => {
    getObject.mockRejectedValue(new Error("RPC https://secret.invalid token=abc"));
    const res = await POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    const json = await res.json();
    expect(json).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(json)).not.toMatch(/secret|token|https?:/i);
  });

  it("bounds one hanging object read", async () => {
    vi.useFakeTimers();
    getObject.mockImplementation(({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("https://private-rpc.invalid sk-secret")));
      }),
    );
    const pending = POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    await vi.advanceTimersByTimeAsync(PROTECTED_TRANSFER_TERMINAL_TIMEOUT_MS);
    const res = await pending;
    const json = await res.json();
    expect(json).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(json)).not.toMatch(/private-rpc|secret|https?:/i);
  });
});

describe("shared rate + concurrency gate", () => {
  it("denies the 4th admission in one window as unavailable without calling RPC", async () => {
    getTransaction.mockResolvedValue(
      terminalResult([
        terminalSuccessEvent(
          REVIEWER,
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    );
    // maxRequestsPerWindow = 3 (see makeFreshGate). Three accepted, fourth denied.
    for (let i = 0; i < 3; i++) {
      const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
      expect((await res.json()).kind).toBe("verified");
    }
    const denied = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect(await denied.json()).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it("accepts again after the fixed rate window expires", async () => {
    getTransaction.mockResolvedValue(
      terminalResult([
        terminalSuccessEvent(
          REVIEWER,
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    );
    for (let i = 0; i < 3; i++) {
      await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    }
    const denied = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect((await denied.json()).kind).toBe("unavailable");
    // Advance the deterministic gate clock past the 1000ms window.
    gateNow += 1_000;
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect((await res.json()).kind).toBe("verified");
  });

  it("denies a 3rd concurrent in-flight admission as unavailable", async () => {
    // Hold two RPCs open with a controlled promise; the third admission is
    // denied because maxConcurrent = 2.
    let releaseFirst: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    getTransaction.mockImplementation(() => new Promise((resolve) => held.then(() => resolve(
      terminalResult([
        terminalSuccessEvent(
          REVIEWER,
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    ))));
    const p1 = POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    const p2 = POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    // Let both acquire admissions reach the mocked RPC.
    await Promise.resolve();
    await Promise.resolve();
    const denied = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect(await denied.json()).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(getTransaction).toHaveBeenCalledTimes(2);
    releaseFirst();
    const r1 = await p1;
    const r2 = await p2;
    expect((await r1.json()).kind).toBe("verified");
    expect((await r2.json()).kind).toBe("verified");
    // After both release, a new admission is accepted again.
    const res = await POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    expect((await res.json()).kind).toBe("verified");
  });

  it("shares the gate across both routes", async () => {
    // Two verify admissions fill the concurrency cap; an open admission is denied.
    let releaseFirst: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    getTransaction.mockImplementation(() => new Promise((resolve) => held.then(() => resolve(
      terminalResult([
        terminalSuccessEvent(
          REVIEWER,
          `${PACKAGE}::protected_transfer::Released<${USDC_COIN_TYPE_TESTNET}>`,
        ),
      ]),
    ))));
    getObject.mockResolvedValue({ object: openObject() } as never);
    const p1 = POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    const p2 = POSTVerify(body(verifyRequest(), "/api/remittance/protected-transfer/terminal/verify"));
    await Promise.resolve();
    await Promise.resolve();
    const denied = await POSTOpen(body(openRequest(), "/api/remittance/protected-transfer/terminal/open"));
    expect(await denied.json()).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(getObject).not.toHaveBeenCalled();
    releaseFirst();
    await p1;
    await p2;
  });
});
