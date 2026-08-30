// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { QrFerry } from "@/components/commerce/qr-ferry";
import { encodeHandoff, wrapQuote } from "@/lib/remittance/offline-handoff";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";

/**
 * Pay Offline — importing a `convey.remittance-quote` payload renders the
 * honest "Quote carried / Not paid yet" review surface, requires explicit
 * Review and approve before any signing, calls `/api/remittance/quote/verify`
 * before the wallet opens, and reuses the terminal settlement proof
 * (`Awaiting payout partner`). The existing commerce QR Ferry behavior is
 * not exercised here — it has its own test file.
 */

const ADDR = "0x" + "ab".repeat(32);
const ACCOUNT = "0x" + "22".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };

const { wallet, client } = vi.hoisted(() => ({
  wallet: {
    account: null as { address: string } | null,
    network: "testnet" as string,
    signAndExecuteTransaction: vi.fn(),
  },
  client: {
    waitForTransaction: vi.fn(),
  },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
  useCurrentClient: () => client,
}));

vi.mock("@/components/wallet/connect-button", () => ({
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">
      Connect wallet
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null,
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogOverlay: () => <div data-testid="dialog-overlay" />,
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-content" role="dialog" aria-modal="true">
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

vi.mock("@/lib/remittance/transfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remittance/transfer")>();
  return {
    ...actual,
    buildUsdcTransfer: vi.fn((input) => {
      actual.validateRecipientAddress(input.recipientAddress);
      if (input.coinType !== USDC_COIN_TYPE_TESTNET) throw new Error("Invalid coin type.");
      const micro = BigInt(input.usdcMicro);
      if (micro <= 0n) throw new Error("USDC micro amount must be greater than zero.");
      return { __dummy: true } as unknown as ReturnType<typeof actual.buildUsdcTransfer>;
    }),
  };
});

function baseQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
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
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: ADDR,
    beneficiaryRef: "R-ABCD1234",
    attestation: VALID_ATTESTATION,
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: null,
      maximumFamilyLimitMinor: null,
      ruleStatus: "not_set",
    },
    clarification: null,
    ...overrides,
  };
}

function matchingAuth(quote: QuoteEnvelope): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: quote.recipientAddress ?? ADDR,
    usdcMicro: quote.usdcMicro,
    coinType: USDC_COIN_TYPE_TESTNET,
    beneficiaryRef: quote.beneficiaryRef,
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
    corridor: quote.corridor,
    youPayMinor: quote.youPayMinor,
    familyReceivesMinor: quote.familyReceivesMinor,
    totalFeeMinor: quote.totalFeeMinor,
    myrPerUsdc: quote.provenance.myrPerUsdc,
    phpPerUsdc: quote.provenance.phpPerUsdc,
    fixedFeeMyr: quote.provenance.fixedFeeMyr,
    feeBps: quote.provenance.feeBps,
    recipient: quote.recipient,
    destinationCity: quote.destinationCity,
    purpose: quote.intentReview.purpose,
    maximumFamilyLimitMinor: quote.intentReview.maximumFamilyLimitMinor,
  };
}

const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

beforeEach(() => {
  localStorage.clear();
  wallet.account = { address: ACCOUNT };
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  wallet.signAndExecuteTransaction.mockResolvedValue({
    $kind: "Transaction",
    Transaction: { digest: VALID_DIGEST, status: { success: true } },
  });
  client.waitForTransaction.mockReset();
  client.waitForTransaction.mockResolvedValue({
    digest: VALID_DIGEST,
    effects: { status: { status: "success" as const } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe("Pay Offline — remittance quote import", () => {
  // The manual paste/file fallback is collapsed behind "Enter manually" by
  // default; open it before driving the manual import path.
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("renders Quote carried / Not paid yet and the verification disclosure on import", () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(matchingAuth(quote))),
    );
    render(<QrFerry />);
    openManual();

    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    expect(screen.getByTestId("remittance-handoff-card")).toBeInTheDocument();
    // "Quote carried" appears both as the contextual page identity and in
    // the handoff card.
    expect(screen.getAllByText("Quote carried").length).toBeGreaterThan(0);
    expect(screen.getByText("Not paid yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Before your wallet opens, we check the recipient, amount, expiry, and server seal on this quote/i),
    ).toBeInTheDocument();
    // The carried quote is the whole page: scanner, manual controls, and the
    // creator are hidden; no raw handoff JSON remains visible.
    expect(screen.queryByTestId("scan-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scan-qr-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("manual-entry-disclosure")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-shop-payment-disclosure")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
    // A quiet Scan another reset is present.
    expect(screen.getByTestId("scan-another")).toBeInTheDocument();
  });

  it("requires explicit Review and approve before any signing (no auto-sign on import)", () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    const fetchMock = vi.fn(() => jsonResponse(matchingAuth(quote)));
    vi.stubGlobal("fetch", fetchMock);
    render(<QrFerry />);
    openManual();

    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    // Importing the quote must NOT call verify or the wallet.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();

    // The explicit Review and approve CTA is present (not yet clicked).
    expect(screen.getByTestId("review-transfer")).toHaveTextContent(/Review and approve/i);
  });

  it("clicking Review and approve opens the checkout dialog and calls verify before signing", async () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    const fetchMock = vi.fn((url: string | Request | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/verify")) return jsonResponse(matchingAuth(quote));
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QrFerry />);
    openManual();

    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    fireEvent.click(screen.getByTestId("review-transfer"));

    // The checkout dialog opens with the consumer summary.
    await waitFor(() => {
      expect(screen.getByTestId("dialog-content")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dialog-title")).toHaveTextContent(/Review testnet transfer/i);

    // Confirm in the dialog triggers verify, then signs.
    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const verifyCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/verify"),
    );
    expect(verifyCall).toBeDefined();
    await waitFor(() => {
      expect(wallet.signAndExecuteTransaction).toHaveBeenCalled();
    });
  });

  it("reuses the terminal settlement proof with Awaiting payout partner semantics", async () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | Request | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/verify")) return jsonResponse(matchingAuth(quote));
        return jsonResponse({});
      }),
    );
    render(<QrFerry />);
    openManual();

    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    fireEvent.click(screen.getByTestId("review-transfer"));
    await waitFor(() => expect(screen.getByTestId("dialog-content")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    // The terminal settlement card appears with the exact payout status.
    await waitFor(() => {
      expect(screen.getAllByTestId("remittance-settlement").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/Awaiting payout partner/i).length).toBeGreaterThan(0);
    // Confirmed-only receipt actions appear exactly once after settlement is
    // confirmed. The in-dialog payment action suppresses its copy; the handoff
    // settlement card is the single source.
    expect(screen.getAllByTestId("remittance-receipt-actions")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Share receipt/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Export receipt/i })).toHaveLength(1);
  });

  it("does not expose receipt actions for a carried quote before settlement", () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(matchingAuth(quote))),
    );
    render(<QrFerry />);
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    // The handoff card is shown but no settlement has occurred yet.
    expect(screen.getByTestId("remittance-handoff-card")).toBeInTheDocument();
    expect(screen.queryByTestId("remittance-receipt-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share receipt/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export receipt/i })).not.toBeInTheDocument();
  });

  it("hides edit/refresh affordances for a carried quote — only scan another is offered", () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(matchingAuth(quote))),
    );
    render(<QrFerry />);
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    // The carried quote is not editable — no edit or refresh controls.
    expect(screen.queryByTestId("edit-transfer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refresh-quote")).not.toBeInTheDocument();
    // The honest "Scan another" action is present outside the card.
    expect(screen.getByTestId("scan-another")).toBeInTheDocument();
  });

  it("a commerce QR Ferry payload still imports through the existing path (no remittance card)", () => {
    // A non-remittance payload (wrong kind) must not render the remittance card.
    const foreign = JSON.stringify({ kind: "something-else", version: 1 });
    vi.stubGlobal("fetch", vi.fn());
    render(<QrFerry />);
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: foreign },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.queryByTestId("remittance-handoff-card")).not.toBeInTheDocument();
  });

  it("Scan another clears the carried quote and returns to the empty scanner state", () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(matchingAuth(quote))),
    );
    render(<QrFerry />);
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByTestId("remittance-handoff-card")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scan-another"));
    expect(screen.queryByTestId("remittance-handoff-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("scan-card")).toBeInTheDocument();
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
    // The page identity returns to the empty destination.
    expect(screen.getByRole("heading", { name: /Pay offline/i })).toBeInTheDocument();
  });
});
