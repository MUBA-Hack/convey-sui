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
  recipientAddress: null,
  beneficiaryRef: "R-ABCD1234",
  attestation: null,
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
    purpose: quote.intentReview.purpose,
    maximumFamilyLimitMinor: quote.intentReview.maximumFamilyLimitMinor,
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

// The inline "Preview only" state renders the wallet connect control when no
// wallet is connected. Mock it to a deterministic button so the chat test does
// not boot the dapp-kit/enoki wallet network.
vi.mock("@/components/wallet/connect-button", () => ({
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">
      Connect wallet
    </button>
  ),
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
  it("defaults to Send abroad and shows the money sheet, no first-fold mode pills", () => {
    render(<PayWorkspace />);
    // The amount-first money sheet dominates the first viewport.
    expect(screen.getByTestId("remittance-hero")).toBeInTheDocument();
    // The amount is an editable RM control (not static text), defaulted to 500.
    const amount = screen.getByTestId("hero-amount") as HTMLInputElement;
    expect(amount.tagName).toBe("INPUT");
    expect(amount.value).toMatch(/500/);
    // The recipient chip reads as a designed identity.
    expect(screen.getByTestId("hero-recipient")).toHaveTextContent(/Ana.*Manila/i);
    // No competing first-fold mode pills — Buy nearby is not a tab in the first
    // fold. There is no tablist at all on the home money sheet.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Send abroad/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Buy nearby/i })).not.toBeInTheDocument();
    // The tactile primary Get quote action is present — never "Send".
    const entryCta = screen.getByTestId("see-quote");
    expect(entryCta).toHaveTextContent(/Get quote · RM500 to Ana/i);
    expect(entryCta.textContent ?? "").not.toMatch(/\bsend\b/i);
  });

  it("Buy nearby is reachable only via a quiet secondary link and renders the existing commerce composer unchanged", () => {
    render(<PayWorkspace />);
    // Buy nearby is a quiet secondary link on the money sheet, not a tab.
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    fireEvent.click(screen.getByTestId("switch-to-buy"));
    // CommerceChat's golden prompt and composer are intact.
    expect(
      screen.getByText(/Buy two iced coffees under 8 SUI from River Cafe/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Purchase composer/i)).toBeInTheDocument();
  });

  it("switching back to Send abroad restores the remittance surface", () => {
    render(<PayWorkspace />);
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    fireEvent.click(screen.getByTestId("switch-to-buy"));
    fireEvent.click(screen.getByTestId("switch-to-send"));
    expect(screen.getByTestId("remittance-hero")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PayWorkspace — premium money sheet visual round
// ---------------------------------------------------------------------------

describe("PayWorkspace — premium money sheet visual round", () => {
  it("typesets the editable amount in financial sans, not mono/slashed-zero", () => {
    render(<PayWorkspace />);
    const amount = screen.getByTestId("hero-amount");
    // No mono numerals on primary MYR money; tabular sans, strong weight.
    expect(amount.className).not.toMatch(/font-mono/);
    expect(amount.className).toMatch(/font-sans/);
    expect(amount.className).toMatch(/tabular-nums/);
    // No native number stepper: a text input with inputMode=decimal.
    expect(amount.tagName).toBe("INPUT");
    expect(amount).toHaveAttribute("inputmode", "decimal");
    expect(amount).not.toHaveAttribute("type", "number");
  });

  it("frames the amount in a black tile with strong visual depth", () => {
    render(<PayWorkspace />);
    const slab = screen.getByTestId("hero-money-slab");
    // The black amount tile is the financial focal point of the sheet.
    expect(slab).toHaveAttribute("data-money-slab", "dual-currency");
    expect(slab).toHaveTextContent(/You send/i);
    expect(slab).toHaveTextContent(/Ana · estimated receive/i);
    expect(screen.getByTestId("hero-amount")).toHaveValue("500.00");
    expect(screen.getByTestId("hero-payout")).toHaveTextContent("PHP 6,104.00");
    const values = slab.querySelectorAll('[data-money-value="true"]');
    expect(values).toHaveLength(2);
    expect(values[0]?.className).toBe(values[1]?.className);
  });

  it("updates the receive estimate before requesting a quote", () => {
    render(<PayWorkspace />);
    fireEvent.change(screen.getByTestId("hero-amount"), { target: { value: "750" } });
    expect(screen.getByTestId("hero-payout")).toHaveTextContent("PHP 9,168.44");
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("edits a raw amount on focus, restores fixed decimals on blur, and requests that amount", async () => {
    const quote750: QuoteEnvelope = {
      ...QUOTE,
      youPayMinor: "75000",
      familyReceivesMinor: "916844",
      totalFeeMinor: "1325",
    };
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(quote750));
    render(<PayWorkspace />);

    const amount = screen.getByTestId("hero-amount");
    expect(amount).toHaveValue("500.00");
    fireEvent.focus(amount);
    expect(amount).toHaveValue("500");
    fireEvent.change(amount, { target: { value: "750" } });
    expect(amount).toHaveValue("750");
    fireEvent.blur(amount);
    expect(amount).toHaveValue("750.00");

    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({
          method: "POST",
          body: expect.stringMatching(/Send RM750 to Ana in Manila/i),
        }),
      ),
    );
    expect(await screen.findByTestId("quote-you-pay")).toHaveTextContent("RM750.00");
  });

  it("renders the recipient as a designed circular portrait chip", () => {
    render(<PayWorkspace />);
    const hero = screen.getByTestId("remittance-hero");
    const portrait = hero.querySelector(".cv-contact-portrait");
    expect(portrait).not.toBeNull();
    expect(portrait?.querySelector(".cv-contact-portrait__head")).not.toBeNull();
    expect(portrait?.querySelector(".cv-contact-portrait__body")).not.toBeNull();
    expect(screen.getByTestId("hero-recipient")).toHaveTextContent(/Ana.*Manila/i);
  });

  it("hides Malay and Buy nearby below the first fold — not inside the hero", () => {
    render(<PayWorkspace />);
    const hero = screen.getByTestId("remittance-hero");
    // Both secondary paths stay reachable but are NOT first-fold controls on
    // the money sheet itself.
    expect(hero.querySelector('[data-testid="use-example-malay"]')).toBeNull();
    expect(hero.querySelector('[data-testid="switch-to-buy"]')).toBeNull();
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    expect(screen.getByTestId("use-example-malay")).toBeInTheDocument();
    expect(screen.getByTestId("switch-to-buy")).toBeInTheDocument();
  });

  it("keeps exactly one primary first-fold action (See quote) with voice attached to the request row", () => {
    render(<PayWorkspace />);
    const hero = screen.getByTestId("remittance-hero");
    // One tactile full-width primary.
    const seeQuote = screen.getByTestId("see-quote");
    expect(seeQuote.className).toMatch(/min-h-\[48px\]/);
    expect(seeQuote.className).toMatch(/w-full/);
    // Voice is attached to the Type a request row inside the sheet, not an
    // orphan header circle.
    expect(hero.querySelector('[aria-label="Microphone"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — composer, send, quote fields
// ---------------------------------------------------------------------------

describe("RemittanceChat — composer, send, quote fields", () => {
  it("shows a clear mic action on the sheet; Type a request reveals the composer", () => {
    render(<RemittanceChat />);
    // Voice is a clear icon/action on the sheet, always visible.
    expect(screen.getByRole("button", { name: /microphone/i })).toBeInTheDocument();
    // The editable RM amount is the only textbox on the sheet; the
    // natural-language composer is behind a quiet disclosure, not a competing
    // always-visible control.
    expect(screen.queryByLabelText(/Remittance command/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    expect(screen.getByLabelText(/Remittance command/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();
  });

  it("posts to /api/remittance/quote and renders all quote fields with exact two-decimal money", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    // The primary See quote action submits the built golden prompt.
    fireEvent.click(screen.getByTestId("see-quote"));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(within(preview).getByTestId("quote-recipient")).toHaveTextContent("Ana");
    expect(within(preview).getByTestId("quote-destination")).toHaveTextContent(/Manila/i);
    // Primary hierarchy with FIXED two decimals: RM500.00 and ₱6,104.00.
    expect(within(preview).getByTestId("quote-you-pay")).toHaveTextContent(/RM500\.00/i);
    expect(within(preview).getByTestId("quote-family-receives")).toHaveTextContent(/6,104\.00/i);
    // Primary money is typeset in financial sans (no mono/slashed zeros); the
    // rate is a technical reference and may stay mono.
    expect(within(preview).getByTestId("quote-you-pay").className).not.toMatch(/font-mono/);
    expect(within(preview).getByTestId("quote-you-pay").className).toMatch(/font-sans/);
    expect(within(preview).getByTestId("quote-family-receives").className).not.toMatch(/font-mono/);
    expect(within(preview).getByTestId("quote-fee").className).not.toMatch(/font-mono/);
    expect(within(preview).queryByTestId("quote-converted")).not.toBeInTheDocument();
    expect(preview.querySelector(".cv-contact-portrait")).not.toBeNull();
    // The wallet USDC transfer is a technical detail: not above the fold.
    expect(within(preview).queryByTestId("quote-usdc")).not.toBeInTheDocument();

    expect(within(preview).getByTestId("quote-fee")).toHaveTextContent(/RM9\.50/);
    expect(within(preview).getByTestId("quote-rate")).toHaveTextContent(/12.44 PHP/i);
    expect(within(preview).getByTestId("quote-expiry")).toBeInTheDocument();
    expect(within(preview).queryByTestId("quote-payout-method")).not.toBeInTheDocument();

    // Deeper technical fields (rail, USDC, reference) remain in the collapsed
    // "Transfer details" disclosure.
    fireEvent.click(within(preview).getByRole("button", { name: /Transfer details/i }));
    await waitFor(() =>
      expect(within(preview).getByTestId("quote-rail")).toHaveTextContent(/Sui testnet USDC/i),
    );
    expect(within(preview).getByTestId("quote-usdc")).toHaveTextContent(/109.*USDC/i);
    expect(within(preview).getByTestId("quote-reference")).toBeInTheDocument();
    expect(within(preview).getByTestId("quote-converted")).toHaveTextContent(/RM490\.50/);
    expect(within(preview).getByTestId("quote-payout-method")).toBeInTheDocument();
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
    // Use the Type a request disclosure to send a natural-language command
    // without an amount.
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    fireEvent.change(screen.getByLabelText(/Remittance command/i), { target: { value: "Send to Ana in Manila" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByText(/Send amount is required/i)).toBeInTheDocument(),
    );
    // No Review transfer gate for a clarification.
    expect(
      screen.queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("renders an error banner with retry on a fetch failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("network down"));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — two confirmation gates
// ---------------------------------------------------------------------------

describe("RemittanceChat — confirmation gate", () => {
  const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

  it("Review transfer opens the dialog directly at Confirm transfer", async () => {
    const addr = "0x" + "1234567890abcdef".repeat(4);
    const account = "0x" + "22".repeat(32);
    wallet.account = { address: account };
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION }),
    );

    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    // The single gate opens the checkout dialog straight at the wallet Confirm
    // transfer control — no intermediate "Continue to payment" step.
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A real testnet USDC transfer/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /Confirm transfer/i }),
      ).toBeInTheDocument(),
    );
    // No duplicate intermediate step.
    expect(
      within(dialog).queryByRole("button", { name: /Continue to payment/i }),
    ).not.toBeInTheDocument();
  });

  it("an unmapped quote offers an Add payout details primary and never opens the transfer dialog", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    // Primary next action is Add Ana's payout details (wired to the edit form) — never
    // a black payout/review forward CTA in the repair state.
    const setup = within(preview).getByTestId("edit-transfer");
    expect(setup).toHaveTextContent(/Add Ana's payout details/i);
    expect(setup.className).toContain("cv-btn-solid");
    expect(within(preview).queryByTestId("preview-demo-payout")).not.toBeInTheDocument();
    expect(within(preview).queryByTestId("demo-payout-receipt")).not.toBeInTheDocument();
    // No dead-end payment modal for an unmapped quote.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("remittance-digest")).not.toBeInTheDocument();
    // No receipt actions for an unconfirmed quote.
    expect(screen.queryByTestId("remittance-receipt-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share receipt/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export receipt/i })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));

    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-settlement")).toBeInTheDocument(),
    );
    expect(within(dialog).getByTestId("remittance-digest")).toHaveAttribute(
      "data-full",
      VALID_DIGEST,
    );
    expect(within(dialog).getByRole("link", { name: /SuiScan/i })).toBeInTheDocument();
    // Confirmed-only receipt actions appear after settlement is confirmed.
    expect(within(dialog).getByTestId("remittance-receipt-actions")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Share receipt/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Export receipt/i })).toBeInTheDocument();
    // The originating preview is confirmed: its Review transfer gate is gone.
    expect(
      screen.queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());
    // No settlement, no digest.
    expect(within(dialog).queryByTestId("remittance-digest")).not.toBeInTheDocument();
    // The originating preview still shows its Review transfer gate (not confirmed).
    expect(
      screen.getByRole("button", { name: /Review transfer/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — voice, keyboard, hit targets, forbidden copy
// ---------------------------------------------------------------------------

describe("RemittanceChat — voice, keyboard, hit targets, copy", () => {
  it("voice onFinal populates the composer and never submits", () => {
    render(<RemittanceChat />);
    // Voice opens the Type a request disclosure and populates its composer.
    act(() => voice.onFinal?.("Hantar RM500 kepada Ana di Manila"));
    const input = screen.getByLabelText(/Remittance command/i) as HTMLTextAreaElement;
    expect(input.value).toBe("Hantar RM500 kepada Ana di Manila");
    // No fetch fired by voice alone.
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("Enter submits the composer (keyboard use)", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    const input = screen.getByLabelText(/Remittance command/i);
    fireEvent.change(input, { target: { value: GOLDEN } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("Get quote submits the golden prompt in one click (one POST, no wallet action, never Send)", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    const seeQuote = screen.getByTestId("see-quote");
    // The primary home CTA reads "Get quote", never "Send".
    expect(seeQuote).toHaveTextContent(/Get quote · RM500 to Ana/i);
    expect(seeQuote.textContent ?? "").not.toMatch(/\bsend\b/i);
    fireEvent.click(seeQuote);
    // One click submits exactly one POST to the quote endpoint — no wallet
    // sign/execute is touched on a Get quote action.
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("the Malay example opens a user-controlled prefilled request", () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    fireEvent.click(screen.getByTestId("use-example-malay"));
    expect(screen.getByLabelText(/Remittance command/i)).toHaveValue(
      "Hantar RM750 kepada Maria di Cebu",
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("send, mic, and See quote buttons use at least 44px hit targets", () => {
    render(<RemittanceChat />);
    // Mic is a clear action on the sheet.
    const mic = screen.getByRole("button", { name: /microphone/i });
    expect(mic.className).toContain("h-11");
    // See quote is the tactile full-width primary.
    const seeQuote = screen.getByTestId("see-quote");
    expect(seeQuote.className).toContain("min-h-[48px]");
    // Send lives behind the Type a request disclosure.
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    const send = screen.getByRole("button", { name: /^send$/i });
    expect(send.className).toContain("h-11");
  });

  it("mobile composer is a single 44px line — no stepper, scroll arrows, or wrapped placeholder", () => {
    render(<RemittanceChat />);
    // The composer lives behind the Type a request disclosure.
    fireEvent.click(screen.getByTestId("type-request-toggle"));
    const composer = screen.getByLabelText(/Remittance composer/i);
    // The composer is a single horizontal row (input · send).
    expect(composer.className).toContain("cv-composer");
    // No number stepper: the input is a textarea, never a number input.
    const input = screen.getByLabelText(/Remittance command/i) as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    expect(input).not.toHaveAttribute("type", "number");
    // Single 44px line: fixed height, one row, no inner scroll arrows.
    expect(input.className).toContain("h-[44px]");
    expect(input).toHaveAttribute("rows", "1");
    expect(input.className).toContain("overflow-hidden");
    // The composer has exactly one send button (mic is on the sheet, not here).
    const buttons = within(composer).getAllByRole("button");
    expect(buttons).toHaveLength(1); // send only
    // Placeholder is a single short line, not a wrapped paragraph.
    expect(input).toHaveAttribute("placeholder", "Send RM500 to Ana in Manila");
  });

  it("Review transfer and Edit transfer use at least 44px hit targets", async () => {
    const addr = "0x" + "1234567890abcdef".repeat(4);
    const account = "0x" + "22".repeat(32);
    wallet.account = { address: account };
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    const review = screen.getByRole("button", { name: /Review transfer/i });
    const edit = screen.getByTestId("edit-transfer");
    expect(review.className).toContain("h-11");
    expect(edit.className).toContain("h-11");
  });

  it("Edit transfer opens a structured form prefilled from the quote; Update quote submits a fresh command", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");

    // One Edit transfer action (not three identical pencils).
    expect(within(preview).queryAllByTestId("edit-amount")).toHaveLength(0);
    expect(within(preview).queryAllByTestId("edit-recipient")).toHaveLength(0);
    expect(within(preview).queryAllByTestId("edit-destination")).toHaveLength(0);
    fireEvent.click(within(preview).getByTestId("edit-transfer"));

    const form = await screen.findByTestId("edit-transfer-form");
    // Structured amount / recipient / destination fields, prefilled.
    const amountField = within(form).getByTestId("edit-amount-field") as HTMLInputElement;
    const recipientField = within(form).getByTestId("edit-recipient-field") as HTMLInputElement;
    const destinationField = within(form).getByTestId("edit-destination-field") as HTMLSelectElement;
    expect(amountField.value).toMatch(/500/);
    expect(recipientField.value).toBe("Ana");
    expect(destinationField.value).toBe("manila");

    // Edit the amount, then submit a fresh quote request through the existing
    // endpoint (no local quote mutation).
    fireEvent.change(amountField, { target: { value: "750" } });
    fireEvent.click(within(form).getByTestId("update-quote"));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({
          method: "POST",
          body: expect.stringMatching(/Send RM750 to Ana in Manila/i),
        }),
      ),
    );
  });

  it("Edit transfer Cancel exits the form without submitting", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    fireEvent.click(within(preview).getByTestId("edit-transfer"));
    const form = await screen.findByTestId("edit-transfer-form");
    fireEvent.click(within(form).getByRole("button", { name: /Cancel/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("edit-transfer-form")).not.toBeInTheDocument(),
    );
  });

  it("Edit transfer validates the amount against the parser/schema bounds", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    fireEvent.click(within(preview).getByTestId("edit-transfer"));
    const form = await screen.findByTestId("edit-transfer-form");
    const amountField = within(form).getByTestId("edit-amount-field") as HTMLInputElement;
    // Clear the initial quote fetch so the assertions below only observe new
    // calls made by the edit form.
    vi.mocked(globalThis.fetch).mockClear();

    // Below the 1 MYR minimum: blocked, no fetch.
    fireEvent.change(amountField, { target: { value: "0.50" } });
    fireEvent.click(within(form).getByTestId("update-quote"));
    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent(/minimum/i),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();

    // Above the 1,000 MYR maximum: blocked.
    fireEvent.change(amountField, { target: { value: "1500" } });
    fireEvent.click(within(form).getByTestId("update-quote"));
    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent(/maximum/i),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
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

  it("uses the shared dual-currency quote slab without promised-outcome language", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    const text = preview.textContent ?? "";
    // Forbidden promised-outcome labels and language.
    expect(text).not.toMatch(/\byou pay\b/i);
    expect(text).not.toMatch(/family receives/i);
    expect(text).not.toMatch(/within minutes/i);
    // Required honest framing is present: primary hierarchy + truth note.
    expect(text).toMatch(/You send/i);
    expect(text).toMatch(/Ana · estimated receive/i);
    expect(text).toMatch(/no MYR charge until you approve/i);
    expect(text).not.toMatch(/Payout method/i);
    const slab = within(preview).getByTestId("quote-money-slab");
    expect(slab).toHaveAttribute("data-money-slab", "dual-currency");
    expect(within(slab).getByTestId("quote-you-pay")).toHaveTextContent("RM500.00");
    expect(within(slab).getByTestId("quote-family-receives")).toHaveTextContent("PHP 6,104.00");
    const values = slab.querySelectorAll('[data-money-value="true"]');
    expect(values).toHaveLength(2);
    expect(values[0]?.className).toBe(values[1]?.className);
  });

  it("does not show Sign in when other blockers exist (unmapped recipient, no wallet)", async () => {
    // QUOTE has recipientAddress: null and attestation: null, so a missing
    // wallet is NOT the sole blocker. Sign in would be a misleading dead end.
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    // Unmapped recipient: the primary is Add Ana's payout details, not a Sign-in dead end.
    expect(within(preview).getByTestId("edit-transfer")).toHaveTextContent(/Add Ana's payout details/i);
    // No Connect wallet / Sign in dead end when the corridor or recipient is
    // the blocker.
    expect(within(preview).queryByTestId("wallet-connect")).not.toBeInTheDocument();
    // No black payout/review forward CTA in the repair state.
    expect(within(preview).queryByTestId("preview-demo-payout")).not.toBeInTheDocument();
    // No operator-configuration instructions are shown to the customer.
    const text = preview.textContent ?? "";
    expect(text).not.toMatch(/configure a recipient/i);
    expect(text).not.toMatch(/attestation/i);
    expect(text).not.toMatch(/\benv\b/i);
    expect(text).not.toMatch(/\bapi\b/i);
  });

  it("shows Connect wallet only when a wallet is the sole missing prerequisite", async () => {
    // Recipient mapped + valid attestation, but no wallet connected: a
    // connected testnet wallet is the only thing standing between the customer
    // and a real transfer.
    const addr = "0x" + "1234567890abcdef".repeat(4);
    wallet.account = null;
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-preview-only")).toBeInTheDocument(),
    );
    // Sign in (Connect wallet) is the honest primary action here.
    expect(screen.getByTestId("wallet-connect")).toBeInTheDocument();
    expect(screen.getByTestId("edit-transfer")).toBeInTheDocument();
    // No Review gate until a wallet is connected.
    expect(
      screen.queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("Refresh quote requests a fresh quote for the same entered values when expired", async () => {
    // An already-expired quote: the pending block must offer Refresh quote and
    // never reach the wallet.
    const expiredQuote: QuoteEnvelope = {
      ...QUOTE,
      issuedAt: Date.now() - 200_000,
      expiresAt: Date.now() - 100_000,
    };
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(expiredQuote));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    await waitFor(() =>
      expect(within(preview).getByTestId("remittance-expired")).toBeInTheDocument(),
    );
    // No Review gate for an expired quote.
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();

    // Refresh quote submits a fresh command for the same entered values.
    vi.mocked(globalThis.fetch).mockClear();
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    fireEvent.click(within(preview).getByTestId("refresh-quote"));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/remittance/quote",
        expect.objectContaining({
          method: "POST",
          body: expect.stringMatching(/Send RM500 to Ana in Manila/i),
        }),
      ),
    );
  });

  it("uses a centered desktop instrument with no left marketing rail", () => {
    render(<RemittanceChat />);
    const section = screen.getByTestId("remittance-chat");
    expect(section.className).toContain("max-w-[1320px]");
    // The large left marketing rail is gone; the hero is the centered dominant object.
    expect(screen.queryByTestId("remittance-promise")).not.toBeInTheDocument();
    // Compact product heading sits immediately above the instrument.
    const heading = screen.getByTestId("remittance-entry-heading");
    expect(heading).toHaveTextContent(/Send money home/i);
    const hero = screen.getByTestId("remittance-hero");
    expect(hero.className).toContain("rounded-2xl");
    // The hero's wrapper centers the instrument at ~1040px on desktop.
    const wrapper = hero.parentElement;
    expect(wrapper?.className).toContain("lg:max-w-[1040px]");
    expect(wrapper?.className).toContain("mx-auto");
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — one mutable quote session (defect 1)
// ---------------------------------------------------------------------------

describe("RemittanceChat — one mutable quote session", () => {
  const ADDR = "0x" + "1234567890abcdef".repeat(4);
  const ACCOUNT = "0x" + "22".repeat(32);
  const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

  function executableQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
    return { ...QUOTE, recipientAddress: ADDR, attestation: VALID_ATTESTATION, ...overrides };
  }

  beforeEach(() => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
  });

  it("a second quote supersedes the first — exactly one active quote card and one action set", async () => {
    const q1 = executableQuote({ youPayMinor: "50000" });
    const q2 = executableQuote({
      youPayMinor: "75000",
      totalFeeMinor: "1325",
      usdcMicro: "163722222",
      usdcAmount: "163.722222",
      familyReceivesMinor: "916844",
      beneficiaryRef: "R-NEW12345",
    });
    vi.mocked(globalThis.fetch).mockReturnValueOnce(jsonResponse(q1));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    // One quote card, one Review gate, one Edit transfer — no stale duplicate.
    expect(screen.getAllByTestId("remittance-quote-preview")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Review transfer/i })).toHaveLength(1);
    expect(screen.getAllByTestId("edit-transfer")).toHaveLength(1);
    expect(screen.getByTestId("quote-you-pay")).toHaveTextContent(/RM500\.00/i);

    // Edit to a fresh amount → the second quote supersedes the first.
    vi.mocked(globalThis.fetch).mockReturnValueOnce(jsonResponse(q2));
    fireEvent.click(screen.getByTestId("edit-transfer"));
    const form = await screen.findByTestId("edit-transfer-form");
    fireEvent.change(within(form).getByTestId("edit-amount-field"), { target: { value: "750" } });
    fireEvent.click(within(form).getByTestId("update-quote"));

    await waitFor(() =>
      expect(screen.getByTestId("quote-you-pay")).toHaveTextContent(/RM750\.00/i),
    );
    // Still exactly one quote card / Review gate / Edit transfer — the first
    // card's actions disappeared, they did not linger.
    expect(screen.getAllByTestId("remittance-quote-preview")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Review transfer/i })).toHaveLength(1);
    expect(screen.getAllByTestId("edit-transfer")).toHaveLength(1);
  });

  it("a clarification after a quote supersedes the quote card — no stale Review/Edit/Refresh", async () => {
    const q1 = executableQuote();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(jsonResponse(q1));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );

    // A retry that the server answers with a clarification must not resurrect
    // the stale quote's Review/Edit/Refresh actions.
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      jsonResponse({
        kind: "clarification",
        clarification: {
          code: "amount_too_small",
          reason: "Send amount must be at least 1 MYR.",
        },
        action: null,
        amountMinor: null,
        currency: null,
        recipient: null,
        destinationCity: null,
      }),
    );
    fireEvent.click(screen.getByTestId("edit-transfer"));
    const form = await screen.findByTestId("edit-transfer-form");
    fireEvent.change(within(form).getByTestId("edit-amount-field"), { target: { value: "750" } });
    fireEvent.click(within(form).getByTestId("update-quote"));

    await waitFor(() =>
      expect(screen.getByText(/Send amount must be at least 1 MYR/i)).toBeInTheDocument(),
    );
    // The quote card and every stale action are gone; only the clarification
    // status line remains.
    expect(screen.queryByTestId("remittance-quote-preview")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-transfer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refresh-quote")).not.toBeInTheDocument();
  });

  it("terminal settlement evidence is not replaced by a new request (fail closed)", async () => {
    const q = executableQuote();
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    vi.mocked(globalThis.fetch).mockImplementation(quoteAndVerifyFetch(q, matchingAuth(q)));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-settlement")).toBeInTheDocument(),
    );
    const callsBefore = vi.mocked(globalThis.fetch).mock.calls.length;

    // While the quote is terminal, the money sheet (and its See quote / Malay
    // / Type a request entry points) is gone, so no new request can supersede
    // the evidence. The settlement evidence stays visible.
    expect(screen.queryByTestId("remittance-hero")).not.toBeInTheDocument();
    const settlements = screen.getAllByTestId("remittance-settlement");
    expect(settlements.length).toBeGreaterThanOrEqual(1);
    const digests = screen.getAllByTestId("remittance-digest");
    expect(digests.some((d) => d.getAttribute("data-full") === VALID_DIGEST)).toBe(true);
    // No new quote request was fired after confirmation.
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — exact blocker copy (defect 2)
// ---------------------------------------------------------------------------

describe("RemittanceChat — exact blocker copy", () => {
  const ADDR = "0x" + "1234567890abcdef".repeat(4);
  const ACCOUNT = "0x" + "22".repeat(32);

  it("unmapped recipient offers an Add payout details primary wired to edit, no forward payout CTA, honest payout label", async () => {
    // Golden default — recipientAddress null, no wallet.
    wallet.account = null;
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    const setup = within(preview).getByTestId("edit-transfer");
    expect(setup).toHaveTextContent(/Add Ana's payout details/i);
    expect(setup.className).toContain("cv-btn-solid");
    // No black payout/review forward CTA in the repair state.
    expect(within(preview).queryByTestId("preview-demo-payout")).not.toBeInTheDocument();
    expect(within(preview).queryByTestId("demo-payout-receipt")).not.toBeInTheDocument();
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
    expect(within(preview).queryByTestId("wallet-connect")).not.toBeInTheDocument();
    // Add Ana's payout details is wired to the existing edit form (onEdit).
    fireEvent.click(setup);
    await waitFor(() =>
      expect(within(preview).getByTestId("edit-transfer-form")).toBeInTheDocument(),
    );
    fireEvent.click(within(preview).getByRole("button", { name: /Transfer details/i }));
    expect(within(preview).getByTestId("quote-payout-method")).toHaveTextContent(/Not available yet/i);
    expect(within(preview).getByTestId("quote-payout-method").textContent ?? "").not.toMatch(/^Bank payout$/);
  });

  it("treats a schema-valid short recipient address as unmapped", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: "0x1", attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(within(preview).getByTestId("edit-transfer")).toHaveTextContent(/Add Ana's payout details/i);
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("unapproved attestation (mapped recipient, no attestation): says the quote cannot be approved; offers Refresh + Edit; no Sign in", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: null }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(
      within(preview).getByText(/cannot be approved for wallet settlement/i),
    ).toBeInTheDocument();
    expect(within(preview).getByTestId("refresh-quote")).toBeInTheDocument();
    expect(within(preview).getByTestId("edit-transfer")).toBeInTheDocument();
    expect(within(preview).queryByTestId("wallet-connect")).not.toBeInTheDocument();
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("wrong network (mapped + attested + wallet on mainnet): says switch to Sui testnet; never signs; no Connect wallet", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "mainnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(
      within(preview).getByText(/Switch your wallet to Sui testnet to continue/i),
    ).toBeInTheDocument();
    expect(within(preview).queryByTestId("wallet-connect")).not.toBeInTheDocument();
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("wallet sole blocker (mapped + attested + testnet, no wallet): shows Connect wallet and Edit transfer", async () => {
    wallet.account = null;
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(within(preview).getByTestId("wallet-connect")).toBeInTheDocument();
    expect(within(preview).getByTestId("edit-transfer")).toBeInTheDocument();
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — family-rule panel and settlement rule-verified copy
// ---------------------------------------------------------------------------

describe("RemittanceChat — family-rule panel and verified rule copy", () => {
  const ADDR = "0x" + "1234567890abcdef".repeat(4);
  const ACCOUNT = "0x" + "22".repeat(32);
  const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

  function ruleQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
    return {
      ...QUOTE,
      recipientAddress: ADDR,
      attestation: VALID_ATTESTATION,
      intentReview: {
        reviewer: "local",
        mode: "fallback",
        provider: "deterministic",
        fallbackReason: "not_configured",
        purpose: "school supplies",
        maximumFamilyLimitMinor: "52000",
        ruleStatus: "within_limit",
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
  });

  it("renders the Family-rule identity and a substantial rule module (purpose headline, cap metric, reviewer) with no stored-policy claim", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(ruleQuote()));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");

    // Page identity — compact eyebrow + H1, only for a rule quote.
    const identity = await screen.findByTestId("family-rule-identity");
    expect(identity).toHaveTextContent(/Family rule/i);
    expect(identity).toHaveTextContent(/Send to Ana/i);

    // Rule module — purpose is the semantic headline, cap the prominent
    // metric, reviewer status subordinate.
    const panel = within(preview).getByTestId("family-rule-panel");
    expect(within(panel).getByTestId("family-rule-purpose")).toHaveTextContent(
      /School supplies/i,
    );
    expect(within(panel).getByTestId("family-rule-limit")).toHaveTextContent(
      /Within RM520/i,
    );
    expect(within(panel).getByTestId("family-rule-reviewer")).toBeInTheDocument();
    // The old thin "Transfer rule" strip label is gone.
    expect(within(panel).queryByTestId("family-rule-label")).not.toBeInTheDocument();
    // Never claims a stored account-wide family policy.
    const text = panel.textContent ?? "";
    expect(text).not.toMatch(/your.*family limit/i);
    expect(text).not.toMatch(/account.*policy/i);
  });

  it("renders NO rule identity or rule panel for an ordinary transfer with no purpose or cap", async () => {
    // Base QUOTE carries purpose: null and maximumFamilyLimitMinor: null.
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(within(preview).queryByTestId("family-rule-panel")).not.toBeInTheDocument();
    // No Family-rule page identity for a no-rule transfer.
    expect(screen.queryByTestId("family-rule-identity")).not.toBeInTheDocument();
    // No reviewer label leaks for a no-rule transfer.
    expect(within(preview).queryByText(/Checked locally/i)).not.toBeInTheDocument();
    expect(within(preview).queryByText(/Reviewed by Gonka/i)).not.toBeInTheDocument();
  });

  it("renders a Rule verified / purpose / cap line in the settlement receipt", async () => {
    const q = ruleQuote();
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    vi.mocked(globalThis.fetch).mockImplementation(quoteAndVerifyFetch(q, matchingAuth(q)));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-rule-verified")).toBeInTheDocument(),
    );
    const ruleLine = within(dialog).getByTestId("remittance-rule-verified");
    expect(ruleLine).toHaveTextContent(/Rule verified/i);
    expect(ruleLine).toHaveTextContent(/School supplies/i);
    expect(ruleLine).toHaveTextContent(/Within RM520 maximum/i);
  });

  it("renders NO Rule verified row for an ordinary transfer with no purpose or cap", async () => {
    // Base QUOTE carries purpose: null and maximumFamilyLimitMinor: null;
    // matchingAuth mirrors those nulls in the verified authorization.
    const q: QuoteEnvelope = {
      ...QUOTE,
      recipientAddress: ADDR,
      attestation: VALID_ATTESTATION,
    };
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    vi.mocked(globalThis.fetch).mockImplementation(quoteAndVerifyFetch(q, matchingAuth(q)));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-settlement")).toBeInTheDocument(),
    );
    expect(
      within(dialog).queryByTestId("remittance-rule-verified"),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Rule verified/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — blocker matrix: one primary next action per blocker
// ---------------------------------------------------------------------------

describe("RemittanceChat — blocker matrix: one primary next action per blocker", () => {
  const ADDR = "0x" + "1234567890abcdef".repeat(4);
  const ACCOUNT = "0x" + "22".repeat(32);

  function solidButtons(container: HTMLElement): HTMLElement[] {
    return within(container)
      .getAllByRole("button")
      .filter((b) => b.className.includes("cv-btn-solid"));
  }

  it("unmapped → Add payout details is the sole solid primary; no payout/review forward CTA", async () => {
    wallet.account = null;
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    const solids = solidButtons(preview);
    expect(solids).toHaveLength(1);
    expect(solids[0]).toHaveTextContent(/Add Ana's payout details/i);
    expect(solids[0]).toHaveAttribute("data-testid", "edit-transfer");
    expect(within(preview).queryByTestId("preview-demo-payout")).not.toBeInTheDocument();
  });

  it("unapproved → Refresh quote is the sole solid primary; no Review forward CTA", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: null }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    const solids = solidButtons(preview);
    expect(solids).toHaveLength(1);
    expect(solids[0]).toHaveAttribute("data-testid", "refresh-quote");
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("wallet sole blocker → Connect wallet is the primary; no Review forward CTA", async () => {
    wallet.account = null;
    wallet.network = "testnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(within(preview).getByTestId("wallet-connect")).toBeInTheDocument();
    // No competing black forward CTA — Review transfer is not offered.
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("wrong network → Switch network copy is the focal; no Review/Connect forward CTA", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "mainnet";
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...QUOTE, recipientAddress: ADDR, attestation: VALID_ATTESTATION }),
    );
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    expect(
      within(preview).getByText(/Switch your wallet to Sui testnet to continue/i),
    ).toBeInTheDocument();
    // No competing forward CTAs for the wrong-network blocker.
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
    expect(within(preview).queryByTestId("wallet-connect")).not.toBeInTheDocument();
    expect(solidButtons(preview).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RemittanceChat — desktop workspace, two groups, and mobile order
// ---------------------------------------------------------------------------

describe("RemittanceChat — desktop workspace, two groups, and mobile order", () => {
  it("entry layout centers the instrument on desktop with min-height, no two-column rail", () => {
    render(<RemittanceChat />);
    const section = screen.getByTestId("remittance-chat");
    const flex = section.querySelector(".flex.w-full.flex-1");
    expect(flex).not.toBeNull();
    expect(flex?.className).not.toMatch(/grid-cols/);
    expect(flex?.className).toContain("items-center");
    expect(flex?.className).toMatch(/lg:min-h-/);
    // The instrument wrapper centers at ~1040px on desktop.
    const wrapper = flex?.querySelector(".mx-auto") as HTMLElement | null;
    expect(wrapper?.className).toContain("lg:max-w-[1040px]");
  });

  it("entry CTA reads Get quote and never Send", () => {
    render(<RemittanceChat />);
    const cta = screen.getByTestId("see-quote");
    expect(cta).toHaveTextContent(/Get quote/i);
    expect(cta.textContent ?? "").not.toMatch(/\bsend\b/i);
  });

  it("quote workspace widens to ~1040px on desktop and recomposes into two balanced groups", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    // Outer workspace widens to ~1040px on desktop (bounded below lg).
    const workspace = preview.parentElement;
    expect(workspace?.className).toContain("max-w-[760px]");
    expect(workspace?.className).toContain("lg:max-w-[1040px]");
    // Two desktop groups inside a two-column grid.
    const grid = within(preview).getByTestId("quote-workspace-grid");
    expect(grid.className).toContain("lg:grid-cols-2");
    const left = within(preview).getByTestId("quote-left-group");
    const right = within(preview).getByTestId("quote-right-group");
    // Left group carries recipient + amounts + summary.
    expect(within(left).getByTestId("quote-recipient")).toBeInTheDocument();
    expect(within(left).getByTestId("quote-you-pay")).toBeInTheDocument();
    expect(within(left).getByTestId("quote-fee")).toBeInTheDocument();
    // Right group carries the guardian, truth line, primary action, details.
    expect(within(right).getByTestId("family-guardian-card")).toBeInTheDocument();
    expect(within(right).getByTestId("quote-truth")).toBeInTheDocument();
    expect(within(right).getByTestId("edit-transfer")).toBeInTheDocument();
    expect(within(right).getByTestId("transfer-details-trigger")).toBeInTheDocument();
    // Left group never carries the action or guardian.
    expect(within(left).queryByTestId("family-guardian-card")).toBeNull();
    expect(within(left).queryByTestId("edit-transfer")).toBeNull();
  });

  it("mobile order below lg: recipient → amount → summary → checks → truth → action → details", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(QUOTE));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    const preview = await screen.findByTestId("remittance-quote-preview");
    // QUOTE has no family rule, so family-rule-panel is absent; the order is
    // recipient → amount → summary → checks → truth → action → details.
    const order = [
      "quote-recipient",
      "quote-you-pay",
      "quote-fee",
      "family-guardian-card",
      "quote-truth",
      "edit-transfer",
      "transfer-details-trigger",
    ];
    const els = order.map((id) => within(preview).getByTestId(id));
    for (let i = 0; i < els.length - 1; i++) {
      const rel = els[i]!.compareDocumentPosition(els[i + 1]!);
      // The next element must follow the current one in document order.
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("lifecycle gating: a submitted quote keeps the two groups, locks the right group, and never shows the guardian", async () => {
    const addr = "0x" + "1234567890abcdef".repeat(4);
    const account = "0x" + "22".repeat(32);
    const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
    wallet.account = { address: account };
    wallet.network = "testnet";
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    const q = { ...QUOTE, recipientAddress: addr, attestation: VALID_ATTESTATION };
    vi.mocked(globalThis.fetch).mockImplementation(quoteAndVerifyFetch(q, matchingAuth(q)));
    render(<RemittanceChat />);
    fireEvent.click(screen.getByTestId("see-quote"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Review transfer/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Review transfer/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() =>
      expect(within(dialog).getByTestId("remittance-settlement")).toBeInTheDocument(),
    );
    // After confirmation the preview is locked: two groups still present, the
    // guardian is gone, and no Review/Set up recipient action is offered.
    const preview = screen.getByTestId("remittance-quote-preview");
    expect(within(preview).getByTestId("quote-left-group")).toBeInTheDocument();
    expect(within(preview).getByTestId("quote-right-group")).toBeInTheDocument();
    expect(within(preview).queryByTestId("family-guardian-card")).toBeNull();
    expect(
      within(preview).queryByRole("button", { name: /Review transfer/i }),
    ).not.toBeInTheDocument();
    expect(within(preview).queryByTestId("edit-transfer")).not.toBeInTheDocument();
  });
});
