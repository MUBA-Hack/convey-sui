// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProofVerifier } from "@/components/commerce/proof-verifier";
import { buildRemittanceReceipt } from "@/lib/remittance/receipt-proof";
import { buildExplorerUrl } from "@/lib/remittance/transfer";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { encodeRemittanceReceiptPayload } from "@/lib/remittance/receipt-proof";

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

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
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

// The JSON editor and verify action live under the Advanced details disclosure.
function openAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
}

describe("ProofVerifier — remittance receipt rendering", () => {
  it("renders a consumer-first result with Ana, Manila, USDC amount, status, rule, and payout", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ kind: "authorization" }));
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const result = await screen.findByTestId("remittance-result");
    // Hero leads with Ana + RM500 paid + PHP6,104 received — the family money
    // object, not the wallet USDC transfer.
    const stage = screen.getByTestId("remittance-stage");
    expect(stage).toHaveTextContent(/Ana/);
    expect(stage).toHaveTextContent(/500/);
    expect(stage).toHaveTextContent(/6,104/);
    expect(stage.textContent ?? "").not.toMatch(/USDC/i);
    // USDC/digest/chain evidence remains available but subordinate.
    expect(result).toHaveTextContent(/109/);
    expect(result).toHaveTextContent(/USDC/);
    expect(result).toHaveTextContent(/Manila/);
    // Truthful structural/receipt language — never "Settlement confirmed".
    expect(result).toHaveTextContent(/Receipt checked/i);
    expect(result.textContent ?? "").not.toMatch(/Settlement confirmed/i);
    expect(result).toHaveTextContent(/Awaiting payout partner/i);
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
    // Honest customer boundary: this page did not look up the transfer on Sui.
    expect(result).toHaveTextContent(/did not look up the transfer on sui/i);
    // The technical "did not check the Sui ledger" claim lives under Advanced.
    expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/did not check the sui ledger/i);
    // After the server check succeeds, the Family rule row in Advanced
    // upgrades to "Server seal verified" — the gated cryptographic claim.
    await waitFor(() =>
      expect(screen.getByTestId("remittance-technical")).toHaveTextContent(/Server seal verified/i),
    );
    // No demo/build language leaks into the remittance result.
    expect(result.textContent ?? "").not.toMatch(/DEMO|LOCAL\/DEMO|build/i);
  });

  it("leads with a black stage containing the RM paid and PHP received; digest mark is subordinate", () => {
    fetchMock.mockResolvedValue(jsonResponse({ kind: "authorization" }));
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const stage = screen.getByTestId("remittance-stage");
    expect(stage.className).toContain("bg-black");
    expect(stage.className).toContain("text-white");
    // Hero leads with RM paid + PHP received, not USDC.
    expect(stage).toHaveTextContent(/500/);
    expect(stage).toHaveTextContent(/6,104/);
    expect(stage.textContent ?? "").not.toMatch(/USDC/i);
    // Digest mark is subordinate — not in the hero stage.
    expect(stage.querySelector("[data-remittance-digest]")).toBeNull();
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
    fetchMock.mockResolvedValue(jsonResponse({ kind: "authorization" }));
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-result")).toHaveTextContent(/Quote re-verified/i),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.kind).toBe("quote");
    expect(body.recipient).toBe("Ana");
  });

  it("shows quote authorization as not re-verified when the server rejects", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ kind: "rejected", reason: "unverified" }));
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
  });

  it("shows an unavailable check when the server call throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
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
    fetchMock.mockResolvedValue(jsonResponse({ kind: "evidence", expired: true }));
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

describe("ProofVerifier — export availability only after confirmation", () => {
  it("exposes share and export controls for a confirmed remittance settlement", () => {
    fetchMock.mockResolvedValue(jsonResponse({ kind: "authorization" }));
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export proof/i })).toBeInTheDocument();
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
  });

  it("builds a share URL with the remittance payload param after confirmation", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    fetchMock.mockResolvedValue(jsonResponse({ kind: "authorization" }));
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: receiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy share link/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    const url = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
    expect(url).toContain("/proof?r=");
  });

  it("loads a shareable remittance URL payload and verifies it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ kind: "authorization" }));
    const doc = buildRemittanceReceipt({
      quote: quote(),
      settlement: settlement(),
      exportedAt: new Date(ISSUED_AT + 90_000).toISOString(),
    });
    const payload = encodeRemittanceReceiptPayload(doc);
    window.history.replaceState({}, "", `/proof?r=${payload}`);
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("remittance-result")).toBeInTheDocument());
    expect(screen.getByTestId("remittance-result")).toHaveTextContent(/Receipt checked/i);
    expect(screen.getByText(/encoded in this link/i)).toBeInTheDocument();
  });
});
