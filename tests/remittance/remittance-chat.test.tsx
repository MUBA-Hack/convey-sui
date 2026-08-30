// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { PayWorkspace } from "@/components/commerce/pay-workspace";
import { RemittanceChat } from "@/components/remittance/remittance-chat";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED,
  WalletStandardError,
} from "@wallet-standard/errors";

/**
 * DOM tests for the Send-abroad remittance surface and the Pay workspace mode
 * switch. fetch, the voice hook, and the dapp-kit v2 hooks are mocked; the
 * real quote preview, checkout dialog, and USDC payment action run for real.
 *
 * Covers: default remittance mode, all quote fields, mode switching, the two
 * confirmation gates (Review details → Confirm transfer), missing
 * configuration → Prepared state, wallet rejection, real digest, no
 * pseudo-receipt, 44px hit targets, keyboard use, and the absence of
 * forbidden customer copy (DEMO / simulation / judge / hackathon / build
 * progress / competitor names / repository names).
 */

const GOLDEN = "Send RM500 to Ana in Manila";

const QUOTE: QuoteEnvelope = {
  kind: "quote",
  recipient: "Ana",
  destinationCity: "manila",
  destinationCountry: "Philippines",
  youPayMinor: "50000",
  youPayCurrency: "MYR",
  familyReceivesMinor: "610400",
  familyReceivesCurrency: "PHP",
  exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.44 PHP" },
  totalFeeMinor: "950",
  feeCurrency: "MYR",
  fixedFeeMinor: "200",
  feeBps: 150,
  usdcMicro: "109000000",
  usdcAmount: "109",
  settlementRail: "Sui testnet USDC",
  payoutMethod: "Bank deposit (reference)",
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
  recipientAddress: null,
  beneficiaryRef: "R-ABCD1234",
  attestation: null,
  clarification: null,
};

const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };

function matchingAuth(quote: QuoteEnvelope): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: quote.recipientAddress ?? ("0x" + "1234567890abcdef".repeat(4)),
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
  };
}

const { voice, wallet, client } = vi.hoisted(() => ({
  voice: {
    supported: true,
    listening: false,
    interimTranscript: "",
    error: null as string | null,
    start: vi.fn(),
    stop: vi.fn(),
    onFinal: undefined as ((text: string) => void) | undefined,
  },
  wallet: {
    account: null as { address: string } | null,
    network: "testnet" as string,
    signAndExecuteTransaction: vi.fn(),
  },
  client: {
    waitForTransaction: vi.fn(async ({ digest }: { digest: string }) => ({
      digest,
      effects: { status: { status: "success" as const } },
    })),
  },
}));

vi.mock("@/components/commerce/use-voice-input", () => ({
  useVoiceInput: (opts?: { onFinal?: (text: string) => void }) => {
    voice.onFinal = opts?.onFinal;
    return {
      supported: voice.supported,
      listening: voice.listening,
      interimTranscript: voice.interimTranscript,
      error: voice.error,
      start: voice.start,
      stop: voice.stop,
    };
  },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
  useCurrentClient: () => client,
}));

// Mock buildUsdcTransfer to avoid the CoinWithBalance intent requiring a real
// client for serialization in jsdom.
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

// Inline Dialog primitives so portals/focus traps don't run in jsdom.
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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

/** A fetch mock that returns the quote for /quote and the authorization for /verify. */
function quoteAndVerifyFetch(quote: QuoteEnvelope, auth: CanonicalAuthorization) {
  return vi.fn((url: string | Request | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/verify")) {
      return jsonResponse(auth);
    }
    return jsonResponse(quote);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  voice.supported = true;
  voice.listening = false;
  voice.interimTranscript = "";
  voice.error = null;
  voice.start.mockReset();
  voice.stop.mockReset();
  voice.onFinal = undefined;
  wallet.account = null;
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  client.waitForTransaction.mockReset();
  client.waitForTransaction.mockImplementation(async ({ digest }: { digest: string }) => ({
    digest,
    effects: { status: { status: "success" as const } },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

// ---------------------------------------------------------------------------
// PayWorkspace — default mode and mode switching
// ---------------------------------------------------------------------------

describe("PayWorkspace — default mode and switching", () => {
  it("defaults to Send abroad and shows the remittance hero", () => {
    render(<PayWorkspace />);
    expect(screen.getByRole("tab", { name: /Send abroad/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText(/Send money home by voice/i)).toBeInTheDocument();
  });

  it("Buy nearby mode renders the existing commerce composer unchanged", () => {
    render(<PayWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: /Buy nearby/i }));
    expect(screen.getByRole("tab", { name: /Buy nearby/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // CommerceChat's golden prompt and composer are intact.
    expect(
      screen.getByText(/Buy two iced coffees under 8 SUI from River Cafe/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Purchase composer/i)).toBeInTheDocument();
  });

  it("switching back to Send abroad restores the remittance surface", () => {
    render(<PayWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: /Buy nearby/i }));
    fireEvent.click(screen.getByRole("tab", { name: /Send abroad/i }));
    expect(screen.getByText(/Send money home by voice/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — composer, send, quote fields
// ---------------------------------------------------------------------------

describe("RemittanceChat — composer and quote rendering", () => {
  it("renders a text input, send button, and mic button", () => {
    render(<RemittanceChat />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /microphone/i })).toBeInTheDocument();
  });

  it("posts to /api/remittance/quote and renders all quote fields", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(within(preview).getByTestId("quote-recipient")).toHaveTextContent("Ana");
    expect(within(preview).getByTestId("quote-destination")).toHaveTextContent(/Manila/i);
    expect(within(preview).getByTestId("quote-you-pay")).toHaveTextContent(/500 MYR/i);
    expect(within(preview).getByTestId("quote-family-receives")).toHaveTextContent(/6104 PHP/i);
    expect(within(preview).getByTestId("quote-rate")).toHaveTextContent(/12.44 PHP/i);
    expect(within(preview).getByTestId("quote-fee")).toHaveTextContent(/9.5 MYR/i);
    expect(within(preview).getByTestId("quote-arrival")).toBeInTheDocument();
    expect(within(preview).getByTestId("quote-payout-method")).toBeInTheDocument();
    expect(within(preview).getByTestId("quote-rail")).toHaveTextContent(/Sui testnet USDC/i);
    expect(within(preview).getByTestId("quote-usdc")).toHaveTextContent(/109 USDC/i);
  });

  it("renders a clarification message for a missing amount", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({
        kind: "clarification",
        clarification: { code: "missing_amount", reason: "Send amount is required." },
        action: null,
        amountMinor: null,
        currency: null,
        recipient: null,
        destinationCity: null,
      }),
    );
    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Send to Ana in Manila" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByText(/Send amount is required/i)).toBeInTheDocument(),
    );
    // No Review details gate for a clarification.
    expect(screen.queryByRole("button", { name: /Review details/i })).not.toBeInTheDocument();
  });

  it("renders an error banner with retry on a fetch failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("network down"));
    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — two confirmation gates
// ---------------------------------------------------------------------------

describe("RemittanceChat — two confirmation gates", () => {
  const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

  it("Review details opens the dialog; Continue to payment reaches Confirm transfer", async () => {
    const addr = "0x" + "1234567890abcdef".repeat(4);
    const account = "0x" + "22".repeat(32);
    wallet.account = { address: account };
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION }),
    );

    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review details/i })).toBeInTheDocument(),
    );
    // Gate 1: Review details opens the checkout dialog (review step).
    fireEvent.click(screen.getByRole("button", { name: /Review details/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Review the validated quote/i)).toBeInTheDocument();

    // Gate 2: Continue to payment renders the wallet Confirm transfer control.
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue to payment/i }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /Confirm transfer/i }),
      ).toBeInTheDocument(),
    );
  });

  it("without a configured recipient, the payment step shows Prepared (no pseudo-receipt)", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review details/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review details/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue to payment/i }));
    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-prepared")).toBeInTheDocument(),
    );
    expect(within(dialog).queryByTestId("remittance-digest")).not.toBeInTheDocument();
  });

  it("on a real digest, the inline preview is confirmed and shows the settlement", async () => {
    const addr = "0x" + "1234567890abcdef".repeat(4);
    const account = "0x" + "22".repeat(32);
    wallet.account = { address: account };
    wallet.network = "testnet";
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    const q = { ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION };
    vi.mocked(globalThis.fetch).mockImplementation(
      quoteAndVerifyFetch(q, matchingAuth(q)),
    );

    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review details/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review details/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue to payment/i }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /Confirm transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));

    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-settlement")).toBeInTheDocument(),
    );
    expect(within(dialog).getByTestId("remittance-digest")).toHaveAttribute(
      "data-full",
      VALID_DIGEST,
    );
    expect(within(dialog).getByRole("link", { name: /SuiScan/i })).toBeInTheDocument();
    // The originating preview is confirmed: its Review details gate is gone.
    expect(screen.queryByRole("button", { name: /Review details/i })).not.toBeInTheDocument();
  });

  it("wallet rejection keeps the dialog open and never confirms the preview", async () => {
    const addr = "0x" + "1234567890abcdef".repeat(4);
    const account = "0x" + "22".repeat(32);
    wallet.account = { address: account };
    wallet.network = "testnet";
    wallet.signAndExecuteTransaction.mockRejectedValue(
      new WalletStandardError(WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED),
    );
    const q = { ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION };
    vi.mocked(globalThis.fetch).mockImplementation(
      quoteAndVerifyFetch(q, matchingAuth(q)),
    );

    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review details/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review details/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue to payment/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());
    // No settlement, no digest.
    expect(within(dialog).queryByTestId("remittance-digest")).not.toBeInTheDocument();
    // The originating preview still shows its Review details gate (not confirmed).
    expect(screen.getByRole("button", { name: /Review details/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — voice, keyboard, hit targets, forbidden copy
// ---------------------------------------------------------------------------

describe("RemittanceChat — voice, keyboard, hit targets, copy", () => {
  it("voice onFinal populates the composer and never submits", () => {
    render(<RemittanceChat />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    act(() => voice.onFinal?.("Hantar RM500 kepada Ana di Manila"));
    expect(input.value).toBe("Hantar RM500 kepada Ana di Manila");
    // No fetch fired by voice alone.
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("Enter submits the composer (keyboard use)", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: GOLDEN } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("example prompts populate the composer without submitting", () => {
    render(<RemittanceChat />);
    const examples = screen.getAllByTestId("example-prompt");
    expect(examples.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(examples[0]!);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value.length).toBeGreaterThan(0);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("send and mic buttons use at least 44px hit targets", () => {
    render(<RemittanceChat />);
    const send = screen.getByRole("button", { name: /^send$/i });
    const mic = screen.getByRole("button", { name: /microphone/i });
    expect(send.className).toContain("h-11");
    expect(mic.className).toContain("h-11");
  });

  it("Review details and Cancel use at least 44px hit targets", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review details/i })).toBeInTheDocument(),
    );
    const review = screen.getByRole("button", { name: /Review details/i });
    const cancel = screen.getByRole("button", { name: /Cancel/i });
    expect(review.className).toContain("h-11");
    expect(cancel.className).toContain("h-11");
  });

  it("never shows forbidden customer copy", () => {
    render(<RemittanceChat />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bdemo\b/i);
    expect(text).not.toMatch(/simulation/i);
    expect(text).not.toMatch(/\bjudge\b/i);
    expect(text).not.toMatch(/hackathon/i);
    expect(text).not.toMatch(/build progress/i);
  });
});
