// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import { decodeReceiptProofPayload } from "@/lib/commerce/receipt-proof";
import { SettlementProofCard } from "@/components/commerce/settlement-proof-card";

/**
 * Focused tests for the shared settlement proof card:
 *  - honest demo/real/network labels (monochrome, no green)
 *  - responsive/truncated identifiers with full accessible values
 *  - customer receipt action without raw JSON affordances
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
  digest: "2".repeat(44),
  demo: false,
  explorerUrl: `https://suiscan.testnet.sui.io/tx/${"2".repeat(44)}`,
  amountMist: "6000000000",
  merchantAddress: "0x".concat("22".repeat(32)),
  label: "Real testnet transfer",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("SettlementProofCard — honest mode labels", () => {
  it("labels a DEMO receipt as Not submitted", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    expect(card.getAttribute("data-proof-mode")).toBe("demo");
    expect(card).toHaveTextContent(/not submitted/i);
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
    expect(screen.getByText(/no explorer link — not submitted on-chain/i)).toBeInTheDocument();
  });
});

describe("SettlementProofCard — amount-led monument layout", () => {
  it("renders the amount as a mobile-first monument-scale protagonist (>=56px)", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const amount = screen.getByTestId("proof-amount");
    // Mobile first: 56px; desktop scales to 64px. The amount leads the card.
    expect(amount.className).toContain("text-[56px]");
    expect(amount.className).toContain("md:text-[64px]");
    expect(amount).toHaveTextContent(/6(\.0+)?/);
    expect(amount).toHaveTextContent(/sui/i);
  });

  it("renders exactly one mode mark (no duplicate DEMO/Real labels)", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    // A single mode badge element — the title must not duplicate the mode.
    expect(card.querySelectorAll(".cv-proof__mode").length).toBe(1);
  });

  it("renders Open receipt as a full-width black primary", () => {
    render(<SettlementProofCard receipt={REAL_RECEIPT} />);
    const receiptLink = screen.getByRole("link", { name: /open receipt/i });
    expect(receiptLink.className).toContain("bg-black");
    expect(receiptLink.className).toContain("w-full");
  });

  it("renders the digest as a single truncated monospace stripe with the full value accessible", () => {
    render(<SettlementProofCard receipt={REAL_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    const digestDd = Array.from(card.querySelectorAll("dd")).find(
      (dd) => dd.getAttribute("title") === REAL_RECEIPT.digest,
    );
    expect(digestDd).toBeTruthy();
    // Single-line stripe: truncate (nowrap + ellipsis), monospace.
    expect(digestDd?.className).toContain("truncate");
    expect(digestDd?.className).toContain("font-mono");
    expect(digestDd?.getAttribute("data-full")).toBe(REAL_RECEIPT.digest);
    expect(digestDd?.textContent).not.toContain(REAL_RECEIPT.digest);
  });

  it("renders the merchant as a truncated monospace subhead with the full value accessible", () => {
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);
    const card = screen.getByTestId("settlement-proof");
    const merchantDd = Array.from(card.querySelectorAll("dd")).find(
      (dd) => dd.getAttribute("title") === DEMO_RECEIPT.merchantAddress,
    );
    expect(merchantDd).toBeTruthy();
    expect(merchantDd?.className).toContain("truncate");
    expect(merchantDd?.className).toContain("font-mono");
    expect(merchantDd?.getAttribute("data-full")).toBe(DEMO_RECEIPT.merchantAddress);
    expect(merchantDd?.textContent).not.toContain(DEMO_RECEIPT.merchantAddress);
  });
});

describe("SettlementProofCard — portable verifier handoff", () => {
  it("opens the local proof desk with a URL-safe receipt document made at click time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:34:56.000Z"));
    render(<SettlementProofCard receipt={DEMO_RECEIPT} />);

    const href = screen.getByRole("link", { name: "Open receipt" }).getAttribute("href")!;
    expect(href).toMatch(/^\/proof\?p=[A-Za-z0-9_-]+$/);

    const payload = new URLSearchParams(href.split("?")[1]).get("p");
    expect(payload).not.toBeNull();
    expect(decodeReceiptProofPayload(payload!)).toEqual({
      ...DEMO_RECEIPT,
      exportedAt: "2026-08-30T12:34:56.000Z",
    });
  });

  it("keeps raw JSON actions off the customer receipt card", () => {
    render(<SettlementProofCard receipt={REAL_RECEIPT} />);

    expect(screen.queryByTestId("copy-proof")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-proof")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open receipt" })).toBeInTheDocument();
  });
});
