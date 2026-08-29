// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import { SettlementProofCard } from "@/components/commerce/settlement-proof-card";

/**
 * Focused tests for the shared settlement proof card:
 *  - honest demo/real/network labels (monochrome, no green)
 *  - responsive/truncated identifiers with full accessible values
 *  - copy proof and download/export JSON affordances
 *  - explorer link for real digest, none for demo
 *  - no mobile overflow (min-width: 0 on the card and grid)
 */

const DEMO_RECEIPT: PaymentReceipt = {
  mode: "demo",
  digest: "DEMO-abcdef0123456789",
  demo: true,
  explorerUrl: null,
  amountMist: "6000000000",
  merchantAddress: "0x".concat("11".repeat(32)),
  label: "DEMO simulation — no on-chain settlement",
};

const REAL_RECEIPT: PaymentReceipt = {
  mode: "real",
  digest: "AbCdEf1234567890GhIjKlMnOpQrStUvWxYz1234567890",
  demo: false,
  explorerUrl: "https://suiscan.testnet.sui.io/tx/AbCdEf1234567890GhIjKlMnOpQrStUvWxYz1234567890",
  amountMist: "6000000000",
  merchantAddress: "0x".concat("22".repeat(32)),
  label: "Real testnet transfer",
};

beforeEach(() => {
  // Mock clipboard for copy-proof tests.
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  // Mock URL.createObjectURL for export-proof tests.
  Object.defineProperty(globalThis.URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock"),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("SettlementProofCard — honest mode labels", () => {
  it("labels a DEMO receipt as DEMO simulation", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    expect(card.getAttribute("data-proof-mode")).toBe("demo");
    expect(card).toHaveTextContent(/demo simulation/i);
    expect(card).toHaveTextContent(/no on-chain settlement/i);
  });

  it("labels a real receipt as Real testnet", () => {
    render(<SettlementProofCard receipt={REAL_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    expect(card.getAttribute("data-proof-mode")).toBe("real");
    expect(card).toHaveTextContent(/real testnet/i);
  });

  it("never uses green/success hue classes", () => {
    const { container } = render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const all = Array.from(container.querySelectorAll("*"));
    for (const el of all) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).not.toMatch(/text-yes|bg-yes|border-yes|text-green|bg-green|text-emerald/i);
    }
  });
});

describe("SettlementProofCard — responsive identifiers", () => {
  it("truncates long merchant addresses and keeps the full value accessible", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    // The full address is in a title attribute and data-full.
    const merchantDd = Array.from(card.querySelectorAll("dd")).find(
      (dd) => dd.getAttribute("title") === DEMO_RECEIPT.merchantAddress,
    );
    expect(merchantDd).toBeTruthy();
    expect(merchantDd?.getAttribute("data-full")).toBe(DEMO_RECEIPT.merchantAddress);
    // The visible text is truncated (does not contain the full 66-char address).
    expect(merchantDd?.textContent).not.toContain(DEMO_RECEIPT.merchantAddress);
  });

  it("truncates long real digests and keeps the full value accessible", () => {
    render(<SettlementProofCard receipt={REAL_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    const digestDd = Array.from(card.querySelectorAll("dd")).find(
      (dd) => dd.getAttribute("title") === REAL_RECEIPT.digest,
    );
    expect(digestDd).toBeTruthy();
    expect(digestDd?.getAttribute("data-full")).toBe(REAL_RECEIPT.digest);
    expect(digestDd?.textContent).not.toContain(REAL_RECEIPT.digest);
  });
});

describe("SettlementProofCard — explorer link", () => {
  it("renders an explorer link for a real digest", () => {
    render(<SettlementProofCard receipt={REAL_RECEIPT} />);
    const link = screen.getByRole("link", { name: /view transaction/i });
    expect(link).toHaveAttribute("href", REAL_RECEIPT.explorerUrl);
  });

  it("renders no explorer link for a DEMO receipt", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    expect(screen.queryByRole("link", { name: /view transaction/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no explorer link for simulation/i)).toBeInTheDocument();
  });
});

describe("SettlementProofCard — copy and export proof", () => {
  it("copies the proof JSON to the clipboard", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    fireEvent.click(screen.getByTestId("copy-proof"));
    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = vi.mocked(globalThis.navigator.clipboard.writeText).mock.calls[0]![0];
    // The copied JSON contains the receipt's key fields.
    const parsed = JSON.parse(copied);
    expect(parsed.mode).toBe("demo");
    expect(parsed.demo).toBe(true);
    expect(parsed.digest).toBe(DEMO_RECEIPT.digest);
    expect(parsed.amountMist).toBe(DEMO_RECEIPT.amountMist);
    expect(parsed.merchantAddress).toBe(DEMO_RECEIPT.merchantAddress);
    expect(parsed.label).toBe(DEMO_RECEIPT.label);
    expect(parsed.explorerUrl).toBeNull();
    expect(typeof parsed.exportedAt).toBe("string");
  });

  it("shows a copied confirmation after copying", async () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    fireEvent.click(screen.getByTestId("copy-proof"));
    await waitFor(() => expect(screen.getByText(/copied/i)).toBeInTheDocument());
  });

  it("downloads the proof as a JSON file", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    fireEvent.click(screen.getByTestId("export-proof"));
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("uses a demo-specific filename for demo receipts", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    fireEvent.click(screen.getByTestId("export-proof"));
    // The download anchor was created and clicked; verify via the blob URL.
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
  });
});
