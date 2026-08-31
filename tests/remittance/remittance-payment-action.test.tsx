// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED,
  WalletStandardError,
} from "@wallet-standard/errors";

const ADDR = "0x" + "1234567890abcdef".repeat(4);
const ADDR_OTHER = "0x" + "abcdef1234567890".repeat(4);
const ACCOUNT = "0x" + "22".repeat(32);
const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };

const { wallet, client } = vi.hoisted(() => ({
  wallet: {
    account: null as { address: string } | null,
    network: "testnet" as string,
    signAndExecuteTransaction: vi.fn(),
  },
  client: {
    core: {
      waitForTransaction: vi.fn(),
    },
  },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
  useCurrentClient: () => client,
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
      if (micro > input.productCapMicro) throw new Error("USDC micro amount exceeds the product cap.");
      return { __dummy: true } as unknown as ReturnType<typeof actual.buildUsdcTransfer>;
    }),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const recordActivityMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity/storage", () => ({
  recordActivity: recordActivityMock,
}));

import { RemittancePaymentAction } from "@/components/remittance/remittance-payment-action";

function auth(overrides: Partial<CanonicalAuthorization> = {}): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: ADDR,
    usdcMicro: "109000000",
    coinType: USDC_COIN_TYPE_TESTNET,
    beneficiaryRef: "R-ABCD1234",
    issuedAt: 1_700_000_000_000,
    expiresAt: Date.now() + 120_000,
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
    purpose: null,
    maximumFamilyLimitMinor: null,
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  const issuedAt = Date.now();
  return {
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
    issuedAt,
    expiresAt: issuedAt + 120_000,
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
    ...overrides,
  };
}

function realQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  const q = quote({
    recipientAddress: ADDR,
    attestation: VALID_ATTESTATION,
    ...overrides,
  });
  return q;
}

function matchingAuth(q: QuoteEnvelope): CanonicalAuthorization {
  return auth({
    recipientAddress: q.recipientAddress!,
    usdcMicro: q.usdcMicro,
    beneficiaryRef: q.beneficiaryRef,
    issuedAt: q.issuedAt,
    expiresAt: q.expiresAt,
    youPayMinor: q.youPayMinor,
    familyReceivesMinor: q.familyReceivesMinor,
    totalFeeMinor: q.totalFeeMinor,
    myrPerUsdc: q.provenance.myrPerUsdc,
    phpPerUsdc: q.provenance.phpPerUsdc,
    fixedFeeMyr: q.provenance.fixedFeeMyr,
    feeBps: q.provenance.feeBps,
    recipient: q.recipient,
    destinationCity: q.destinationCity,
  });
}

function verifyResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  wallet.account = null;
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  client.core.waitForTransaction.mockReset();
  client.core.waitForTransaction.mockResolvedValue({
    $kind: "Transaction",
    Transaction: {
      digest: VALID_DIGEST,
      signatures: [],
      epoch: null,
      status: { success: true, error: null },
      balanceChanges: [
        { coinType: USDC_COIN_TYPE_TESTNET, address: ADDR, amount: "109000000" },
      ],
    },
  });
  fetchMock.mockReset();
  recordActivityMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RemittancePaymentAction — prepared mode", () => {
  it("shows Prepared and never produces a pseudo-digest", () => {
    render(<RemittancePaymentAction quote={quote()} />);
    expect(screen.getByTestId("remittance-prepared")).toBeInTheDocument();
    expect(screen.queryByTestId("remittance-digest")).not.toBeInTheDocument();
  });

  it("shows prepared when attestation is missing even with wallet + recipient", () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
    render(<RemittancePaymentAction quote={quote({ recipientAddress: ADDR, attestation: null })} />);
    expect(screen.getByTestId("remittance-prepared")).toBeInTheDocument();
    // Honest copy: no operator-configuration instructions are shown to the
    // customer (no "configure recipient", no "attestation missing").
    expect(screen.getByText(/Testnet transfer is unavailable/i)).toBeInTheDocument();
    const text = screen.getByTestId("remittance-prepared").textContent ?? "";
    expect(text).not.toMatch(/configure a recipient/i);
    expect(text).not.toMatch(/attestation/i);
  });
});

describe("RemittancePaymentAction — real path", () => {
  beforeEach(() => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
  });

  it("verifies, binds, signs, checks effects, and shows digest", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    const onSettled = vi.fn();
    render(<RemittancePaymentAction quote={q} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-digest")).toBeInTheDocument());
    expect(wallet.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(client.core.waitForTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        digest: VALID_DIGEST,
        include: { balanceChanges: true },
        timeout: 15_000,
        pollSchedule: [0, 300, 600, 1500, 3500],
      }),
    );
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("rejects structurally valid auth with substituted recipient before wallet", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(
      verifyResponse(matchingAuth(q) && auth({ ...matchingAuth(q), recipientAddress: ADDR_OTHER })),
    );
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified/i));
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("rejects structurally valid auth with substituted amount before wallet", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(
      verifyResponse({ ...matchingAuth(q), usdcMicro: "108000000" }),
    );
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified/i));
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("rejects malicious kind:authorization with invalid structure", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse({ kind: "authorization", recipientAddress: ADDR }));
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified/i));
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("typed wallet rejection unlocks for retry", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockRejectedValue(
      new WalletStandardError(WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED),
    );
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/canceled/i));
    expect(screen.getByRole("button", { name: /Confirm transfer/i })).not.toBeDisabled();
  });

  it("provider text containing reject is NOT treated as rejection after signing", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockRejectedValue(
      new Error("RPC rejected connection — insufficient peers"),
    );
    const onTerminal = vi.fn();
    render(<RemittancePaymentAction quote={q} onTerminal={onTerminal} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-unknown")).toBeInTheDocument());
    expect(screen.getByText(/Transfer outcome unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    expect(onTerminal).toHaveBeenCalledWith({ kind: "unknown" });
    expect(screen.getByRole("button", { name: /Outcome unknown/i })).toBeDisabled();
  });

  it("structural FailedTransaction unlocks", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "FailedTransaction",
      FailedTransaction: {
        digest: VALID_DIGEST,
        status: { success: false, error: { message: "move abort" } },
      },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Confirm transfer/i })).not.toBeDisabled();
  });

  it("invalid digest after signing locks unknown and never retries", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "not-a-valid-digest!!!", status: { success: true } },
    });
    const onTerminal = vi.fn();
    render(<RemittancePaymentAction quote={q} onTerminal={onTerminal} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-unknown")).toBeInTheDocument());
    expect(client.core.waitForTransaction).not.toHaveBeenCalled();
    expect(onTerminal).toHaveBeenCalledWith({ kind: "unknown" });
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
  });

  it("finality timeout with digest shows submitted pending and keeps lock", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockRejectedValue(new Error("timeout"));
    const onTerminal = vi.fn();
    render(<RemittancePaymentAction quote={q} onTerminal={onTerminal} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(
      within(screen.getByTestId("remittance-submitted-pending")).getByText(
        /Submitted — confirmation pending/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("remittance-digest")).toHaveAttribute("data-full", VALID_DIGEST);
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    expect(onTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "submitted", digest: VALID_DIGEST }),
    );
  });

  it("missing balance changes stays submitted pending (unverified, locked)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: true, error: null },
        balanceChanges: [],
      },
    });
    const onSettled = vi.fn();
    render(<RemittancePaymentAction quote={q} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(screen.queryByTestId("remittance-settlement")).not.toBeInTheDocument();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("a verified response for another digest stays submitted pending (digest mismatch)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "9WzSziM8bVKmJKyvHX3ivQcpbwEyKBZb5swuocPL7x4D",
        signatures: [],
        epoch: null,
        status: { success: true, error: null },
        balanceChanges: [
          { coinType: USDC_COIN_TYPE_TESTNET, address: ADDR, amount: "109000000" },
        ],
      },
    });
    const onSettled = vi.fn();
    render(<RemittancePaymentAction quote={q} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() =>
      expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument(),
    );
    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Confirm transfer/i })).not.toBeInTheDocument();
  });

  it("revalidates account and network after verification", async () => {
    const q = realQuote();
    let resolveVerify!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveVerify = resolve; }));
    const view = render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    wallet.account = { address: ADDR_OTHER };
    wallet.network = "mainnet";
    view.rerender(<RemittancePaymentAction quote={q} />);
    resolveVerify(verifyResponse(matchingAuth(q)));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified/i));
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("aborts verification and never opens the wallet after unmount", async () => {
    const q = realQuote();
    let resolveJson!: (value: CanonicalAuthorization) => void;
    const json = vi.fn(() => new Promise<CanonicalAuthorization>((resolve) => { resolveJson = resolve; }));
    fetchMock.mockResolvedValue({ ok: true, json } as unknown as Response);
    const view = render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(json).toHaveBeenCalled());
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolveJson(matchingAuth(q));
    await Promise.resolve();
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("unsuccessful status (Transaction arm, success=false) unlocks with truthful failure", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: false, error: { message: "InsufficientGas" } },
        balanceChanges: [],
      },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/InsufficientGas/i));
    expect(screen.getByRole("button", { name: /Confirm transfer/i })).not.toBeDisabled();
  });

  it("FailedTransaction arm from waitForTransaction unlocks with truthful failure", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "FailedTransaction",
      FailedTransaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: false, error: { message: "MoveAbort" } },
        balanceChanges: [],
      },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/MoveAbort/i));
    expect(screen.getByRole("button", { name: /Confirm transfer/i })).not.toBeDisabled();
  });

  it("wrong coin type in balance changes stays submitted pending (locked)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: true, error: null },
        balanceChanges: [
          { coinType: "0x2::sui::SUI", address: ADDR, amount: "109000000" },
        ],
      },
    });
    const onSettled = vi.fn();
    render(<RemittancePaymentAction quote={q} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("wrong recipient in balance changes stays submitted pending (locked)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: true, error: null },
        balanceChanges: [
          { coinType: USDC_COIN_TYPE_TESTNET, address: ADDR_OTHER, amount: "109000000" },
        ],
      },
    });
    const onSettled = vi.fn();
    render(<RemittancePaymentAction quote={q} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("amount mismatch (+1) in balance changes stays submitted pending (locked)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: true, error: null },
        balanceChanges: [
          { coinType: USDC_COIN_TYPE_TESTNET, address: ADDR, amount: "109000001" },
        ],
      },
    });
    const onSettled = vi.fn();
    render(<RemittancePaymentAction quote={q} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("prevents double-submit while pending", async () => {
    const q = realQuote();
    let resolveVerify!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise((res) => { resolveVerify = res; }));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Verifying/i })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Verifying/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveVerify(verifyResponse(matchingAuth(q)));
    await waitFor(() => expect(screen.getByTestId("remittance-digest")).toBeInTheDocument());
  });
});

describe("RemittancePaymentAction — expired / mode", () => {
  it("expired quote never calls wallet", () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
    render(
      <RemittancePaymentAction
        quote={realQuote({ issuedAt: Date.now() - 200_000, expiresAt: Date.now() - 100_000 })}
      />,
    );
    expect(screen.getByTestId("remittance-expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm transfer/i })).not.toBeInTheDocument();
  });

  it("mainnet is prepared", () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "mainnet";
    render(<RemittancePaymentAction quote={realQuote()} />);
    expect(screen.getByTestId("remittance-prepared")).toBeInTheDocument();
  });
});

describe("RemittancePaymentAction — Activity recording", () => {
  beforeEach(() => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
  });

  it("records one strict navigable Activity item on verified confirmed", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-settlement")).toBeInTheDocument());
    expect(recordActivityMock).toHaveBeenCalledTimes(1);
    const candidate = recordActivityMock.mock.calls[0]![0] as Record<string, string>;
    expect(candidate.id).toBe(`remittance:${VALID_DIGEST}`);
    expect(candidate.href).toMatch(/^\/proof\?r=[A-Za-z0-9_-]+$/);
    expect(candidate.title).toBe("Beneficiary transfer");
    expect(candidate.amountLabel).toBe("109 USDC");
    expect(candidate.detailLabel).toBe("Confirmed on Sui · Awaiting payout partner");
    expect(candidate.nextOwner).toBe("View receipt");
    expect(candidate.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("replaying the same verified outcome upserts the same id", async () => {
    const q = realQuote();
    // Fresh Response per fetch call — a Response body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(verifyResponse(matchingAuth(q))));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    const { unmount } = render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-settlement")).toBeInTheDocument());
    unmount();
    cleanup();
    // Second confirmed settlement with the same digest must reuse the id.
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-settlement")).toBeInTheDocument());
    expect(recordActivityMock).toHaveBeenCalledTimes(2);
    const ids = recordActivityMock.mock.calls.map(
      (c) => (c[0] as Record<string, string>).id,
    );
    expect(ids[0]).toBe(`remittance:${VALID_DIGEST}`);
    expect(ids[1]).toBe(`remittance:${VALID_DIGEST}`);
  });

  it("records zero items on submitted-pending (finality timeout)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockRejectedValue(new Error("timeout"));
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it("records zero items on unverified mismatch (missing balance changes)", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: true, error: null },
        balanceChanges: [],
      },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByTestId("remittance-submitted-pending")).toBeInTheDocument());
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it("records zero items on failed effects", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    client.core.waitForTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: VALID_DIGEST,
        signatures: [],
        epoch: null,
        status: { success: false, error: { message: "InsufficientGas" } },
        balanceChanges: [],
      },
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it("records zero items on typed wallet rejection", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockRejectedValue(
      new WalletStandardError(WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED),
    );
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/canceled/i));
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it("records zero items on prepared (no attestation)", () => {
    render(<RemittancePaymentAction quote={quote({ recipientAddress: ADDR, attestation: null })} />);
    expect(screen.getByTestId("remittance-prepared")).toBeInTheDocument();
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it("storage failure does not change the confirmed settlement UI", async () => {
    const q = realQuote();
    fetchMock.mockResolvedValue(verifyResponse(matchingAuth(q)));
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST, status: { success: true } },
    });
    recordActivityMock.mockImplementation(() => {
      throw new Error("storage denied");
    });
    render(<RemittancePaymentAction quote={q} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm transfer/i }));
    // Confirmed UI still renders despite recordActivity throwing.
    await waitFor(() => expect(screen.getByTestId("remittance-settlement")).toBeInTheDocument());
    expect(screen.getByTestId("remittance-digest")).toHaveAttribute("data-full", VALID_DIGEST);
  });
});
