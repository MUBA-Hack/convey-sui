// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QrFerry, NONCE_STORAGE_KEY } from "@/components/commerce/qr-ferry";
import {
  createEnvelope,
  exportEnvelopeJson,
} from "@/lib/commerce/qr-ferry";
import { encodeHandoff, wrapQuote } from "@/lib/remittance/offline-handoff";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import type { ReactNode } from "react";

/**
 * Pay Offline — camera QR scanner.
 *
 * Proportional UI tests for the `Scan QR` camera entry in the import
 * subsection. The decoder and camera are mocked; no live device is used.
 * Covers: explicit click starts the scanner, the first decoded text enters
 * the existing strict import path (commerce + remittance), cancel/unmount
 * stops the camera controls, and denied permission leaves the paste/file
 * fallback available. No unrelated edge cases are expanded here.
 */

const MERCHANT = "0x".concat("11".repeat(32)) as `0x${string}`;
const NOW = 1_700_000_000_000;
const EXPIRY_MS = 60 * 60 * 1000;

const ADDR = "0x" + "ab".repeat(32);
const ACCOUNT = "0x" + "22".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };

// --- Hoisted mock decoder --------------------------------------------------
// A single controllable mock store shared with the mocked module. Each test
// resets it via `resetMockReader()`. The mock records `stop()` calls and
// lets tests deliver a decoded result via `emitDecoded(text)` or simulate a
// camera failure via `rejectNextStart(err)`.

type DecodeCallback = (
  result: { getText(): string } | undefined,
  error: unknown,
  controls: { stop: () => void },
) => void;

interface MockReaderState {
  startCalls: number;
  stopCalls: number;
  activeCallback: DecodeCallback | null;
  activeControls: { stop: () => void } | null;
  nextStartError: Error | null;
}

const mockState = vi.hoisted<MockReaderState>(() => ({
  startCalls: 0,
  stopCalls: 0,
  activeCallback: null,
  activeControls: null,
  nextStartError: null,
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = vi.fn(
      (
        _deviceId: string | undefined,
        _video: unknown,
        callback: DecodeCallback,
      ) => {
        mockState.startCalls += 1;
        if (mockState.nextStartError) {
          const err = mockState.nextStartError;
          mockState.nextStartError = null;
          return Promise.reject(err);
        }
        const controls = {
          stop: () => {
            mockState.stopCalls += 1;
            mockState.activeCallback = null;
            mockState.activeControls = null;
          },
        };
        mockState.activeCallback = callback;
        mockState.activeControls = controls;
        return Promise.resolve(controls);
      },
    );
  },
}));

function resetMockReader() {
  mockState.startCalls = 0;
  mockState.stopCalls = 0;
  mockState.activeCallback = null;
  mockState.activeControls = null;
  mockState.nextStartError = null;
}

function emitDecoded(text: string) {
  if (!mockState.activeCallback || !mockState.activeControls) {
    throw new Error("no active scan to emit into");
  }
  mockState.activeCallback(
    { getText: () => text },
    undefined,
    mockState.activeControls,
  );
}

function rejectNextStart(err: Error) {
  mockState.nextStartError = err;
}

// --- Wallet mocks (for remittance handoff path) ---------------------------

const { wallet, client } = vi.hoisted(() => ({
  wallet: {
    account: null as { address: string } | null,
    network: "testnet" as string,
    signAndExecuteTransaction: vi.fn(),
  },
  client: { waitForTransaction: vi.fn() },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
  useCurrentClient: () => client,
}));

vi.mock("@/components/wallet/connect-button", () => ({
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">Connect wallet</button>
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
    <div data-testid="dialog-content" role="dialog" aria-modal="true">{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div data-testid="dialog-footer">{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2 data-testid="dialog-title">{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p data-testid="dialog-description">{children}</p>,
}));

// --- Fixtures --------------------------------------------------------------

function craftCommerceJson(nonce: string): string {
  const env = createEnvelope({
    item: "Iced Coffee",
    quantity: 2,
    totalMist: 6_000_000_000n,
    merchantAddress: MERCHANT,
    nonce,
    createdAt: NOW,
    expiresAt: NOW + EXPIRY_MS,
  });
  return exportEnvelopeJson(env);
}

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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

beforeEach(() => {
  // Real timers so waitFor can poll the async decodeFromVideoDevice
  // promise; setSystemTime still pins Date.now() for deterministic
  // envelope/quote timestamps.
  vi.useRealTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  resetMockReader();
  wallet.account = { address: ACCOUNT };
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  wallet.signAndExecuteTransaction.mockResolvedValue({
    $kind: "Transaction",
    Transaction: { digest: "D", status: { success: true } },
  });
  client.waitForTransaction.mockReset();
  client.waitForTransaction.mockResolvedValue({
    digest: "D",
    effects: { status: { status: "success" as const } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

// ---------------------------------------------------------------------------

describe("Pay Offline — Scan QR camera entry", () => {
  it("renders a Scan QR button as the primary import action", () => {
    render(<QrFerry />);
    const scanBtn = screen.getByTestId("scan-qr-button");
    expect(scanBtn).toBeInTheDocument();
    expect(scanBtn.className).toMatch(/cv-btn-solid/);
    // Paste/file fallbacks live behind the collapsed "Enter manually"
    // disclosure; the disclosure trigger is present and collapsed by default.
    const manualTrigger = screen.getByTestId("manual-entry-disclosure");
    expect(manualTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Open from file/i)).not.toBeInTheDocument();
    // Opening the disclosure reveals the paste/file fallbacks.
    fireEvent.click(manualTrigger);
    expect(screen.getByPlaceholderText(/Paste payment code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Open from file/i)).toBeInTheDocument();
  });

  it("does not start the camera until the user clicks Scan QR", async () => {
    render(<QrFerry />);
    // No video element before clicking.
    expect(screen.queryByTestId("qr-scanner-video")).not.toBeInTheDocument();
    expect(mockState.startCalls).toBe(0);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));
    expect(screen.getByTestId("qr-scanner-video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel scan/i })).toBeInTheDocument();
  });

  it("routes a decoded commerce envelope through the strict import path", async () => {
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));

    const json = craftCommerceJson("nonce-scan-commerce-001");
    emitDecoded(json);

    await waitFor(() => {
      expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    });
    const review = screen.getByTestId("validated-envelope");
    expect(review).toHaveTextContent(/Iced Coffee/i);
    // The carried payment is now the whole page: the scanner (and its
    // manual paste textarea) are hidden, and no raw handoff JSON remains.
    expect(screen.queryByTestId("qr-scanner-video")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
    // Scanner returned to idle after decode.
    expect(screen.queryByTestId("qr-scanner-video")).not.toBeInTheDocument();
  });

  it("routes a decoded remittance quote through the strict import path (Quote carried / Not paid yet)", async () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(matchingAuth(quote))),
    );
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));

    emitDecoded(json);

    await waitFor(() => {
      expect(screen.getByTestId("remittance-handoff-card")).toBeInTheDocument();
    });
    // "Quote carried" appears both as the contextual page identity and in
    // the handoff card; assert at least one match for each label.
    expect(screen.getAllByText("Quote carried").length).toBeGreaterThan(0);
    expect(screen.getByText("Not paid yet")).toBeInTheDocument();
  });

  it("stops camera controls on Cancel scan", async () => {
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));
    expect(mockState.stopCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Cancel scan/i }));
    expect(mockState.stopCalls).toBe(1);
    expect(screen.queryByTestId("qr-scanner-video")).not.toBeInTheDocument();
    // Scan QR button is available again.
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
  });

  it("stops camera controls on unmount", async () => {
    const { unmount } = render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));
    expect(mockState.stopCalls).toBe(0);

    unmount();
    expect(mockState.stopCalls).toBe(1);
  });

  it("stops controls promptly after the first decode (no double emit)", async () => {
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));

    const json = craftCommerceJson("nonce-scan-once-001");
    emitDecoded(json);
    await waitFor(() => expect(screen.getByTestId("validated-envelope")).toBeInTheDocument());
    expect(mockState.stopCalls).toBe(1);

    // A second emit must be a no-op: the callback was cleared on stop.
    expect(() => emitDecoded(json)).toThrow();
  });

  it("denied permission shows a concise consumer error and keeps paste/file available", async () => {
    rejectNextStart(new DOMException("Permission denied", "NotAllowedError"));
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => {
      expect(screen.getByTestId("qr-scanner-error")).toBeInTheDocument();
    });
    const err = screen.getByTestId("qr-scanner-error");
    expect(err).toHaveTextContent(/camera permission denied/i);
    // No stack trace or implementation prose.
    expect(err.textContent).not.toMatch(/NotAllowedError|DOMException|zxing/i);
    // The scan card stays; the manual paste/file fallback remains reachable
    // behind the "Enter manually" disclosure.
    expect(screen.getByTestId("scan-card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
    expect(screen.getByPlaceholderText(/Paste payment code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Open from file/i)).toBeInTheDocument();
    // Scan QR is available again to retry.
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
  });

  it("no camera found shows a concise consumer error and keeps fallbacks", async () => {
    rejectNextStart(new DOMException("No camera", "NotFoundError"));
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => {
      expect(screen.getByTestId("qr-scanner-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("qr-scanner-error")).toHaveTextContent(/no camera found/i);
    // Fallback reachable via the manual disclosure.
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
    expect(screen.getByPlaceholderText(/Paste payment code/i)).toBeInTheDocument();
  });

  it("Scan QR is disabled while replay protection is degraded", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "corrupt-garbage{{{");
    render(<QrFerry />);

    const scanBtn = screen.getByTestId("scan-qr-button");
    expect(scanBtn).toBeDisabled();
    // The degraded warning is the only alert.
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
  });

  it("Scan QR is the dominant first-frame primary; Create payment QR is a collapsed secondary", () => {
    render(<QrFerry />);
    // Scan QR is the dominant import primary in the first frame.
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
    // Create payment QR lives behind the collapsed "Create a shop payment"
    // disclosure and is not in the first frame.
    expect(screen.queryByRole("button", { name: /Create payment QR/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    expect(screen.getByRole("button", { name: /Create payment QR/i })).toBeInTheDocument();
    // The paste/file Open payment is a quiet ghost fallback (inside the
    // manual disclosure).
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
    const approveBtn = screen.getByRole("button", { name: /Open payment/i });
    expect(approveBtn.className).toMatch(/cv-btn-ghost/);
  });

  it("a decoded remittance quote hides the scanner, manual controls, and creator, and Scan another resets", async () => {
    const quote = baseQuote();
    const json = encodeHandoff(wrapQuote(quote));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(matchingAuth(quote))),
    );
    render(<QrFerry />);

    fireEvent.click(screen.getByTestId("scan-qr-button"));
    await waitFor(() => expect(mockState.startCalls).toBe(1));
    emitDecoded(json);

    await waitFor(() => {
      expect(screen.getByTestId("remittance-handoff-card")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Quote carried").length).toBeGreaterThan(0);
    expect(screen.getByText("Not paid yet")).toBeInTheDocument();
    // The carried quote is the whole page: scanner, manual controls, and the
    // creator are hidden; no raw handoff JSON remains.
    expect(screen.queryByTestId("scan-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scan-qr-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("manual-entry-disclosure")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-shop-payment-disclosure")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();

    // Scan another clears only imported state and returns to the empty scanner.
    fireEvent.click(screen.getByTestId("scan-another"));
    expect(screen.queryByTestId("remittance-handoff-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("scan-card")).toBeInTheDocument();
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
  });
});
