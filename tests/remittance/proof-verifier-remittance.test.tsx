// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProofVerifier } from "@/components/commerce/proof-verifier";
import { buildRemittanceReceipt } from "@/lib/remittance/receipt-proof";
import { buildExplorerUrl } from "@/lib/remittance/transfer";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { encodeRemittanceReceiptPayload } from "@/lib/remittance/receipt-proof";
import {
  USDC_COIN_TYPE_MAINNET,
  USDC_COIN_TYPE_TESTNET,
} from "@/lib/remittance/constants";

const RECIPIENT_ADDRESS = "0x" + "1234567890abcdef".repeat(4);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };
const ISSUED_AT = 1_700_000_000_000;

function quote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.444444 PHP" },
    totalFeeMinor: "950",
    feeCurrency: "MYR",
    fixedFeeMinor: "200",
    feeBps: 150,
    usdcMicro: "109000000",
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
    recipientAddress: RECIPIENT_ADDRESS,
    beneficiaryRef: "R-ABCD1234",
    attestation: ATTESTATION,
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
    ...overrides,
  };
}

function settlement() {
  const q = quote();
  return {
    digest: DIGEST,
    explorerUrl: buildExplorerUrl(DIGEST),
    recipientAddress: q.recipientAddress!,
    usdcMicro: q.usdcMicro,
    beneficiaryRef: q.beneficiaryRef,
    quoteExpiresAt: q.expiresAt,
    payoutStatus: q.payoutStatus,
    purpose: q.intentReview.purpose,
    maximumFamilyLimitMinor: q.intentReview.maximumFamilyLimitMinor,
    confirmedAt: q.issuedAt + 60_000,
  };
}

function receiptJson(): string {
  return JSON.stringify(
    buildRemittanceReceipt({
      quote: quote(),
      settlement: settlement(),
      exportedAt: new Date(ISSUED_AT + 90_000).toISOString(),
    }),
    null,
    2,
  );
}

function receiptJsonForDigest(digest: string): string {
  return JSON.stringify(
    buildRemittanceReceipt({
      quote: quote(),
      settlement: {
        ...settlement(),
        digest,
        explorerUrl: buildExplorerUrl(digest),
      },
      exportedAt: new Date(ISSUED_AT + 90_000).toISOString(),
    }),
    null,
    2,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mockEndpoints();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function verifiedSettlement(digest = DIGEST) {
  return {
    kind: "verified",
    network: "testnet",
    digest,
    coinType: USDC_COIN_TYPE_TESTNET,
    recipientAddress: RECIPIENT_ADDRESS,
    receivedMicro: "109000000",
    checkedAt: "2026-08-31T12:00:00.000Z",
  };
}

function mockEndpoints({
  quoteResponse = { kind: "authorization" },
  settlementResponse = verifiedSettlement(),
}: {
  quoteResponse?: unknown;
  settlementResponse?: unknown;
} = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    Promise.resolve(
      jsonResponse(
        String(input).includes("/api/remittance/settlement/verify")
          ? settlementResponse
          : quoteResponse,
      ),
    ),
  );
}

// The JSON editor and verify action live under the Advanced details disclosure.
function openAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
}

describe("ProofVerifier — remittance receipt rendering", () => {
  it("renders a consumer-first result with Ana, Manila, USDC amount, status, rule, and payout", async () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const result = await screen.findByTestId("remittance-result");
    const transferStatus = screen.getByTestId("remittance-transfer-status");
    expect(result).not.toHaveAttribute("aria-live");
    expect(transferStatus).toHaveAttribute("aria-live", "polite");
    expect(transferStatus.parentElement?.closest("[aria-live]")).toBeNull();
    const stage = screen.getByTestId("remittance-stage");
    expect(stage).toHaveAttribute("data-money-slab", "dual-currency");
    expect(stage).toHaveTextContent(/You send/i);
    expect(stage).toHaveTextContent(/Ana · estimated receive/i);
    expect(stage).toHaveTextContent("RM500.00");
    expect(stage).toHaveTextContent("PHP 6,104.00");
    expect(stage).toHaveTextContent(/Ana/);
    expect(stage).toHaveTextContent(/500/);
    expect(stage).toHaveTextContent(/6,104/);
    expect(stage.textContent ?? "").not.toMatch(/USDC/i);
    // USDC/digest/chain evidence remains available but subordinate.
    expect(result).toHaveTextContent(/109/);
    expect(result).toHaveTextContent(/USDC/);
    expect(result).toHaveTextContent(/Manila/);
    // Truthful structural/receipt language — never "Settlement confirmed".
    expect(result).toHaveTextContent(/Receipt details checked/i);
    expect(result.textContent ?? "").not.toMatch(/Settlement confirmed/i);
    expect(result).toHaveTextContent(/Awaiting family payout/i);
    // The customer-facing Family rule row is present (purpose + limit, no
    // seal language in the primary view).
    expect(result).toHaveTextContent(/Family rule/i);
    expect(result).toHaveTextContent(/Rent/);
    // Signed/verified authorization wording appears only after the server
    // check succeeds (mocked to return authorization here).
    await waitFor(() =>
      expect(screen.getByTestId("remittance-authorization-verified")).toBeInTheDocument(),
    );
    expect(result).toHaveTextContent(/Quote re-verified/i);
    await waitFor(() => expect(result).toHaveTextContent(/Confirmed on Sui/i));
    expect(result).toHaveTextContent(/bank or cash payout has not been confirmed/i);
    expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/independent Sui check matched/i);
    // After the server check succeeds, the Family rule row in Advanced
    // upgrades to "Server seal verified" — the gated cryptographic claim.
    await waitFor(() =>
      expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/Server seal verified/i),
    );
    // No demo/build language leaks into the remittance result.
    expect(result.textContent ?? "").not.toMatch(/DEMO|LOCAL\/DEMO|build/i);
  });

  it("leads with the primary black money stage after the Sui transfer is verified", async () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Confirmed on Sui/i,
      ),
    );
    const stage = screen.getByTestId("remittance-stage");
    const transferStatus = screen.getByTestId("remittance-transfer-status");
    expect(stage.className).toContain("bg-black");
    expect(stage.className).toContain("text-white");
    expect(stage).toHaveAttribute("data-money-slab", "dual-currency");
    expect(stage).toHaveAttribute("data-money-tone", "primary");
    expect(transferStatus).toHaveAttribute("data-status-tone", "subordinate");
    expect(stage.compareDocumentPosition(transferStatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stage).toHaveTextContent(/500/);
    expect(stage).toHaveTextContent(/6,104/);
    expect(stage.textContent ?? "").not.toMatch(/USDC/i);
    // Digest mark is subordinate — not in the hero stage.
    expect(stage.querySelector("[data-remittance-digest]")).toBeNull();
    const values = stage.querySelectorAll('[data-money-value="true"]');
    expect(values).toHaveLength(2);
    expect(values[0]?.className).toBe(values[1]?.className);
    // Digest remains available in the full result detail rows.
    const result = screen.getByTestId("remittance-result");
    const digestEl = result.querySelector("[data-remittance-digest]");
    expect(digestEl).not.toBeNull();
    expect(digestEl?.getAttribute("title")).toBe(DIGEST);
    expect(digestEl?.getAttribute("data-full")).toBe(DIGEST);
  });
});

describe("ProofVerifier — server quote verification", () => {
  it("shows quote authorization as re-verified when the server returns authorization", async () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-result")).toHaveTextContent(/Quote re-verified/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const quoteCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/remittance/quote/verify"),
    );
    const body = JSON.parse((quoteCall![1] as RequestInit).body as string);
    expect(body.kind).toBe("quote");
    expect(body.recipient).toBe("Ana");
  });

  it("shows quote authorization as not re-verified when the server rejects", async () => {
    mockEndpoints({ quoteResponse: { kind: "rejected", reason: "unverified" } });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-result")).toHaveTextContent(/Quote could not be re-verified/i),
    );
    // Honest boundary: a rejected check renders the boundary element, never
    // the verified-authorization element.
    expect(screen.getByTestId("remittance-authorization-boundary")).toBeInTheDocument();
    expect(screen.queryByTestId("remittance-authorization-verified")).not.toBeInTheDocument();
    // The Family rule row in Advanced uses structural language only — never
    // "Server seal verified" (that claim is gated on server verification).
    const technical = screen.getByTestId("remittance-technical");
    expect(technical).toHaveTextContent(/Includes server seal/i);
    expect(technical.textContent ?? "").not.toMatch(/Server seal verified/i);
    expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
      /Confirmed on Sui/i,
    );
  });

  it("shows an unavailable check when the server call throws", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes("/api/remittance/settlement/verify")
        ? Promise.resolve(jsonResponse(verifiedSettlement()))
        : Promise.reject(new Error("network down")),
    );
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-result")).toHaveTextContent(/Quote check unavailable/i),
    );
    expect(screen.getByTestId("remittance-authorization-boundary")).toBeInTheDocument();
    expect(screen.queryByTestId("remittance-authorization-verified")).not.toBeInTheDocument();
  });

  it("shows historical evidence wording for an expired-but-genuine quote", async () => {
    mockEndpoints({ quoteResponse: { kind: "evidence", expired: true } });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    // Historical evidence gets its own testid, distinct from executable re-verification.
    await waitFor(() =>
      expect(screen.getByTestId("remittance-authorization-evidence")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("remittance-authorization-verified")).not.toBeInTheDocument();
    expect(screen.getByTestId("remittance-authorization-evidence")).toHaveTextContent(
      /historical record — no longer valid for payment/i,
    );
  });
});

describe("ProofVerifier — independent Sui settlement status", () => {
  it.each([
    ["an extra field", { ...verifiedSettlement(), extra: true }],
    ["a different network", { ...verifiedSettlement(), network: "mainnet" }],
    [
      "a different digest",
      verifiedSettlement("9WzSziM8bVKmJKyvHX3ivQcpbwEyKBZb5swuocPL7x4D"),
    ],
    ["a different coin type", { ...verifiedSettlement(), coinType: USDC_COIN_TYPE_MAINNET }],
    [
      "a different recipient",
      { ...verifiedSettlement(), recipientAddress: `0x${"34".repeat(32)}` },
    ],
    ["a different amount", { ...verifiedSettlement(), receivedMicro: "109000001" }],
    ["an invalid checkedAt", { ...verifiedSettlement(), checkedAt: "not-a-date" }],
    ["a malformed body", { kind: "verified", network: "testnet" }],
  ])("fails closed when a verified response contains %s", async (_label, response) => {
    mockEndpoints({ settlementResponse: response });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), {
      target: { value: receiptJson() },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Sui check unavailable/i,
      ),
    );
    expect(screen.queryByText(/^Confirmed on Sui$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();
    expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/invalid_response/i);
  });

  it("treats invalid response JSON as invalid_response and withholds actions", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes("/api/remittance/settlement/verify")
        ? Promise.resolve(new Response("{", { status: 200 }))
        : Promise.resolve(jsonResponse({ kind: "authorization" })),
    );
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), {
      target: { value: receiptJson() },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Sui check unavailable/i,
      ),
    );
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();
    expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/invalid_response/i);
  });

  it("shows checking before a matching Sui response confirms the receipt", async () => {
    let resolveSettlement: (response: Response) => void = () => {};
    const settlementRequest = new Promise<Response>((resolve) => {
      resolveSettlement = resolve;
    });
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes("/api/remittance/settlement/verify")
        ? settlementRequest
        : Promise.resolve(jsonResponse({ kind: "authorization" })),
    );
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
      /Checking transfer on Sui/i,
    );
    expect(screen.getByTestId("remittance-transfer-status")).toHaveAttribute(
      "data-status-tone",
      "dominant",
    );
    expect(screen.getByTestId("remittance-stage")).toHaveAttribute(
      "data-money-tone",
      "subordinate",
    );
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(
      /Checking this transfer/i,
    );
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    const settlementCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/remittance/settlement/verify"),
    );
    expect(settlementCall).toBeDefined();
    expect((settlementCall![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    const postedReceipt = JSON.parse(
      (settlementCall![1] as RequestInit).body as string,
    );
    expect(postedReceipt.kind).toBe("convey.remittance-receipt");
    expect(postedReceipt.settlement.digest).toBe(DIGEST);

    resolveSettlement(jsonResponse(verifiedSettlement()));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Confirmed on Sui/i,
      ),
    );
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
  });

  it("rejects a mismatched receipt, withholds share/export, and opens details", async () => {
    mockEndpoints({ settlementResponse: { kind: "rejected", reason: "amount" } });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Receipt doesn’t match Sui/i,
      ),
    );
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(
      /This transfer needs review/i,
    );
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();
    expect(screen.getByRole("button", { name: /advanced details/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: /review details/i }));
    expect(screen.getByRole("button", { name: /advanced details/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/amount/i);
  });

  it("keeps a transaction-not-found response explicitly unconfirmed", async () => {
    mockEndpoints({
      settlementResponse: { kind: "not_found", reason: "transaction_not_found" },
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Transaction not found on Sui testnet/i,
      ),
    );
    const pageTitle = screen.getByTestId("receipt-page-title");
    const moneySlab = screen.getByTestId("remittance-stage");
    const transferStatus = screen.getByTestId("remittance-transfer-status");
    expect(pageTitle).toHaveTextContent(/This transfer needs review/i);
    expect(screen.getByTestId("receipt-page-intro")).toHaveTextContent(
      /could not find this transaction on Sui testnet/i,
    );
    expect(pageTitle.compareDocumentPosition(moneySlab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(transferStatus.compareDocumentPosition(moneySlab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(transferStatus).toHaveAttribute("data-status-tone", "dominant");
    expect(transferStatus.className).toContain("bg-black");
    expect(moneySlab).toHaveAttribute("data-money-tone", "subordinate");
    expect(moneySlab.className).toContain("bg-neutral-50");
    expect(moneySlab.className).not.toContain("bg-black");
    expect(screen.getByText("Receipt created")).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed$/i)).toBeNull();
    expect(screen.queryByText(/^Confirmed on Sui$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
  });

  it("retries an unavailable check and enables actions only after verification", async () => {
    let settlementCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (!String(input).includes("/api/remittance/settlement/verify")) {
        return Promise.resolve(jsonResponse({ kind: "authorization" }));
      }
      settlementCalls += 1;
      return Promise.resolve(
        jsonResponse(
          settlementCalls === 1
            ? { kind: "unavailable", reason: "rpc_unavailable" }
            : verifiedSettlement(),
        ),
      );
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Sui check unavailable/i,
      ),
    );
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(
      /Transfer status unavailable/i,
    );
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Confirmed on Sui/i,
      ),
    );
    expect(settlementCalls).toBe(2);
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
  });

  it("ignores a late settlement response for a superseded receipt", async () => {
    const secondDigest = "9WzSziM8bVKmJKyvHX3ivQcpbwEyKBZb5swuocPL7x4D";
    let resolveFirst: (response: Response) => void = () => {};
    const firstRequest = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let settlementCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (!String(input).includes("/api/remittance/settlement/verify")) {
        return Promise.resolve(jsonResponse({ kind: "authorization" }));
      }
      settlementCalls += 1;
      return settlementCalls === 1
        ? firstRequest
        : Promise.resolve(jsonResponse({ kind: "rejected", reason: "recipient" }));
    });
    render(<ProofVerifier />);
    openAdvanced();
    const editor = screen.getByLabelText(/receipt json/i);
    fireEvent.change(editor, { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    fireEvent.change(editor, { target: { value: receiptJsonForDigest(secondDigest) } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
        /Receipt doesn’t match Sui/i,
      ),
    );
    resolveFirst(jsonResponse(verifiedSettlement()));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId("remittance-transfer-status")).toHaveTextContent(
      /Receipt doesn’t match Sui/i,
    );
  });

  it("always separates family payout from Sui confirmation", async () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const payout = screen.getByTestId("remittance-family-payout");
    expect(payout).toHaveTextContent(/Awaiting family payout/i);
    await waitFor(() => expect(payout).toHaveTextContent(/USDC is confirmed on Sui/i));
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(
      /Transfer confirmed on Sui/i,
    );
    expect(screen.getByTestId("receipt-page-intro")).toHaveTextContent(
      /Family payout remains a separate status/i,
    );
    expect(screen.getByText("Receipt created")).toBeInTheDocument();
    expect(payout).toHaveTextContent(/bank or cash payout has not been confirmed/i);
    expect(payout.textContent ?? "").not.toMatch(/paid|delivered|complete/i);
  });
});

describe("ProofVerifier — export availability only after confirmation", () => {
  it("exposes share and export controls for a confirmed remittance settlement", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    return waitFor(() => {
      expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /export proof/i })).toBeInTheDocument();
    });
  });

  it("never exposes share or export controls for an unconfirmed remittance quote", () => {
    const handoff = JSON.stringify({
      kind: "convey.remittance-quote",
      version: 1,
      quote: quote(),
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: handoff } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    expect(screen.getByText(/quote, not a settlement/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy share link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export proof/i })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/remittance/settlement/verify"),
      ),
    ).toHaveLength(0);
  });

  it("makes no settlement call for a structurally invalid remittance receipt", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), {
      target: {
        value: JSON.stringify({ kind: "convey.remittance-receipt", version: 1 }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/remittance/settlement/verify"),
      ),
    ).toHaveLength(0);
  });

  it("never exposes the remittance export control for a commerce proof", () => {
    const commerce = JSON.stringify({
      mode: "demo",
      demo: true,
      digest: "DEMO-abcdef0123456789",
      amountMist: "2500000000",
      merchantAddress: "0x" + "11".repeat(32),
      explorerUrl: null,
      label: "DEMO simulation — no on-chain settlement",
      exportedAt: "2026-08-30T00:00:00.000Z",
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: commerce } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    // Commerce keeps its own share link; the remittance export is absent.
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export proof/i })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/remittance/settlement/verify"),
      ),
    ).toHaveLength(0);
  });

  it("builds a share URL with the remittance payload param after confirmation", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /copy share link/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    const url = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
    expect(url).toContain("/proof?r=");
  });

  it("loads a shareable remittance URL payload and verifies it", async () => {
    const doc = buildRemittanceReceipt({
      quote: quote(),
      settlement: settlement(),
      exportedAt: new Date(ISSUED_AT + 90_000).toISOString(),
    });
    const payload = encodeRemittanceReceiptPayload(doc);
    window.history.replaceState({}, "", `/proof?r=${payload}`);
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("remittance-result")).toBeInTheDocument());
    expect(screen.getByTestId("remittance-result")).toHaveTextContent(/Receipt details checked/i);
    expect(screen.getByText(/encoded in this link/i)).toBeInTheDocument();
  });
});
