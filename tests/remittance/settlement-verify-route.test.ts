import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionError, type SuiClientTypes } from "@mysten/sui/client";
import { POST } from "@/app/api/remittance/settlement/verify/route";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  buildRemittanceReceipt,
  REMITTANCE_RECEIPT_MAX_BYTES,
  type RemittanceReceiptDocument,
} from "@/lib/remittance/receipt-proof";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import {
  __setSuiSettlementReaderFactoryForTest,
  SUI_SETTLEMENT_TIMEOUT_MS,
  type SuiSettlementReader,
} from "@/lib/remittance/sui-settlement.server";
import { buildExplorerUrl } from "@/lib/remittance/transfer";

const RECIPIENT = "0x" + "1234567890abcdef".repeat(4);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const ISSUED_AT = 1_700_000_000_000;
const USDC_MICRO = "109000000";

type TxResult = SuiClientTypes.TransactionResult<{ balanceChanges: true }>;
type TxArm = SuiClientTypes.Transaction<{ balanceChanges: true }>;

const getTransaction = vi.fn<SuiSettlementReader["getTransaction"]>();

function quote(): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: {
      fromCurrency: "MYR",
      toCurrency: "PHP",
      rateText: "1 MYR = 12.444444 PHP",
    },
    totalFeeMinor: "950",
    feeCurrency: "MYR",
    fixedFeeMinor: "200",
    feeBps: 150,
    usdcMicro: USDC_MICRO,
    usdcAmount: "109",
    settlementRail: "Sui testnet USDC",
    payoutMethod: "Bank payout · Not available yet",
    estimatedArrival: "Within minutes after on-chain confirmation",
    payoutStatus: "Awaiting payout partner",
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: RECIPIENT,
    beneficiaryRef: "R-ABCD1234",
    attestation: { v: 1, hmac: "0x" + "ab".repeat(32) },
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: "rent",
      maximumFamilyLimitMinor: "50000",
      ruleStatus: "within_limit",
    },
    clarification: null,
  };
}

function receipt(): RemittanceReceiptDocument {
  const q = quote();
  return buildRemittanceReceipt({
    quote: q,
    settlement: {
      digest: DIGEST,
      explorerUrl: buildExplorerUrl(DIGEST),
      recipientAddress: RECIPIENT,
      usdcMicro: USDC_MICRO,
      beneficiaryRef: q.beneficiaryRef,
      quoteExpiresAt: q.expiresAt,
      payoutStatus: "Awaiting payout partner",
      purpose: "rent",
      maximumFamilyLimitMinor: "50000",
      confirmedAt: ISSUED_AT + 60_000,
    },
    exportedAt: new Date(ISSUED_AT + 90_000).toISOString(),
  });
}

function arm(
  balanceChanges: SuiClientTypes.BalanceChange[],
  status: SuiClientTypes.ExecutionStatus = { success: true, error: null },
): TxArm {
  return {
    digest: DIGEST,
    signatures: [],
    epoch: null,
    status,
    balanceChanges,
    effects: undefined,
    events: undefined,
    objectTypes: undefined,
    transaction: undefined,
    bcs: undefined,
  };
}

function success(amount = USDC_MICRO): TxResult {
  return {
    $kind: "Transaction",
    Transaction: arm([{ coinType: USDC_COIN_TYPE_TESTNET, address: RECIPIENT, amount }]),
  };
}

function failed(): TxResult {
  return {
    $kind: "FailedTransaction",
    FailedTransaction: arm([], {
      success: false,
      error: { message: "private RPC failure", $kind: "Unknown", Unknown: null },
    }),
  };
}

function requestBody(body: string): Request {
  return new Request("http://localhost/api/remittance/settlement/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function request(value: unknown): Request {
  return requestBody(JSON.stringify(value));
}

beforeEach(() => {
  getTransaction.mockReset();
  __setSuiSettlementReaderFactoryForTest(() => ({ getTransaction }));
});

afterEach(() => {
  __setSuiSettlementReaderFactoryForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/remittance/settlement/verify — input gate", () => {
  it.each([
    ["malformed JSON", "{"],
    ["oversize raw body", "x".repeat(REMITTANCE_RECEIPT_MAX_BYTES + 1)],
    ["strict invalid receipt", JSON.stringify({ ...receipt(), rpcUrl: "https://evil.invalid" })],
    ["wrong network", JSON.stringify({ ...receipt(), network: "mainnet" })],
  ])("rejects %s before any RPC lookup", async (_name, body) => {
    const res = await POST(requestBody(body));
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_receipt" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/remittance/settlement/verify — independent Sui read", () => {
  it("returns strict verified evidence for one exact pinned-USDC credit", async () => {
    getTransaction.mockResolvedValue(success());

    const res = await POST(request(receipt()));
    const body = await res.json();

    expect(body).toEqual({
      kind: "verified",
      network: "testnet",
      digest: DIGEST,
      coinType: USDC_COIN_TYPE_TESTNET,
      recipientAddress: RECIPIENT,
      receivedMicro: USDC_MICRO,
      checkedAt: expect.any(String),
    });
    expect(Date.parse(body.checkedAt)).not.toBeNaN();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).toHaveBeenCalledOnce();
    expect(getTransaction).toHaveBeenCalledWith({
      digest: DIGEST,
      include: { effects: true, balanceChanges: true, transaction: true },
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps explicit chain failure distinct from an amount mismatch", async () => {
    getTransaction.mockResolvedValueOnce(failed()).mockResolvedValueOnce(success("108999999"));

    const failedBody = await (await POST(request(receipt()))).json();
    const mismatchBody = await (await POST(request(receipt()))).json();

    expect(failedBody).toEqual({ kind: "rejected", reason: "failed" });
    expect(mismatchBody).toEqual({ kind: "rejected", reason: "amount" });
    expect(JSON.stringify(failedBody)).not.toContain("private RPC failure");
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns not_found only for the SDK's typed transaction error", async () => {
    getTransaction.mockRejectedValue(new TransactionError("notFound", DIGEST));

    const res = await POST(request(receipt()));

    expect(await res.json()).toEqual({
      kind: "not_found",
      reason: "transaction_not_found",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it("bounds a hanging provider and returns a secret-free unavailable result", async () => {
    vi.useFakeTimers();
    getTransaction.mockImplementation(({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("https://private-rpc.invalid sk-secret-value"));
        });
      }),
    );

    const pending = POST(request(receipt()));
    await vi.advanceTimersByTimeAsync(SUI_SETTLEMENT_TIMEOUT_MS);
    const res = await pending;
    const body = await res.json();

    expect(body).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/private-rpc|sk-secret|https?:/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it("maps an arbitrary provider error to unavailable without leaking it", async () => {
    getTransaction.mockRejectedValue(new Error("RPC endpoint https://secret.invalid token=abc"));

    const body = await (await POST(request(receipt()))).json();

    expect(body).toEqual({ kind: "unavailable", reason: "rpc_unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/secret|endpoint|token|https?:/i);
    expect(getTransaction).toHaveBeenCalledOnce();
  });
});
